-- Migración — obtener_encuesta_publica ahora también devuelve `condicionales`
--
-- El frontend online (encuestas-online) necesita esta columna para respetar
-- las reglas armadas en el constructor (ej. "si contesta No a ¿Participa?,
-- finalizar la encuesta"). Sin esto, el JSON no traía `condicionales` y el
-- frontend no tenía forma de saber que existían — las preguntas con reglas
-- se mostraban igual, en orden, ignorando la regla.
--
-- Rollback: 20260912160000_encuestas_online_condicionales_rollback.sql

create or replace function public.obtener_encuesta_publica(p_subdominio text)
returns json
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_encuesta json;
  v_preguntas json;
begin
  select row_to_json(e) into v_encuesta
  from (
    select id, nombre, descripcion, tema_visual, titulo_publico, subtitulo_publico
    from encuestas
    where subdominio = p_subdominio
      and tipo_encuesta = 'online'
      and estado_produccion = 'publicada'
      and activo
      and (publicar_desde is null or now() >= publicar_desde)
      and (publicar_hasta is null or now() <= publicar_hasta)
  ) e;

  if v_encuesta is null then
    return json_build_object('error', 'no_encontrada');
  end if;

  select json_agg(
    json_build_object(
      'id', p.id, 'texto', p.texto, 'tipo', p.tipo,
      'requerida', p.requerida, 'orden', p.orden,
      'config_matriz', p.config_matriz,
      'condicionales', p.condicionales,
      'opciones', coalesce(opts.opciones, '[]'::json)
    ) order by p.orden
  ) into v_preguntas
  from preguntas p
  left join (
    select o.pregunta_id,
      json_agg(json_build_object('id', o.id, 'texto', o.texto, 'orden', o.orden) order by o.orden) as opciones
    from opciones_pregunta o
    group by o.pregunta_id
  ) opts on opts.pregunta_id = p.id
  where p.encuesta_id = (v_encuesta->>'id')::uuid;

  return json_build_object('encuesta', v_encuesta, 'preguntas', coalesce(v_preguntas, '[]'::json));
end;
$$;
