-- Rollback de 20260912150000_encuestas_online_programacion.sql

select cron.unschedule('cerrar-encuestas-online-vencidas');
drop function if exists public.cerrar_encuestas_online_vencidas();

-- Revertir obtener_encuesta_publica / guardar_respuesta_online a la versión
-- sin chequeo de ventana (20260912130000_encuestas_online_backend.sql).
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
    select id, nombre, descripcion
    from encuestas
    where subdominio = p_subdominio
      and tipo_encuesta = 'online'
      and estado_produccion = 'publicada'
      and activo
  ) e;

  if v_encuesta is null then
    return json_build_object('error', 'no_encontrada');
  end if;

  select json_agg(
    json_build_object(
      'id', p.id, 'texto', p.texto, 'tipo', p.tipo,
      'requerida', p.requerida, 'orden', p.orden,
      'config_matriz', p.config_matriz,
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

create or replace function public.guardar_respuesta_online(
  p_subdominio      text,
  p_respuestas      jsonb,
  p_token_navegador uuid,
  p_fingerprint     text default null,
  p_ip              text default null,
  p_pais            text default null,
  p_ciudad          text default null,
  p_latitud_ip      double precision default null,
  p_longitud_ip     double precision default null
) returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_encuesta_id uuid;
  v_sesion_id   uuid;
  r             jsonb;
begin
  set local statement_timeout = '30s';

  select id into v_encuesta_id
  from encuestas
  where subdominio = p_subdominio
    and tipo_encuesta = 'online'
    and estado_produccion = 'publicada'
    and activo;

  if v_encuesta_id is null then
    raise exception 'encuesta_no_disponible';
  end if;

  if p_token_navegador is not null and exists (
    select 1 from intentos_encuesta_online
    where encuesta_id = v_encuesta_id and token_navegador = p_token_navegador
  ) then
    raise exception 'respuesta_duplicada';
  end if;

  if p_ip is not null and exists (
    select 1 from intentos_encuesta_online
    where encuesta_id = v_encuesta_id and ip = p_ip
  ) then
    raise exception 'respuesta_duplicada';
  end if;

  if p_fingerprint is not null and exists (
    select 1 from intentos_encuesta_online
    where encuesta_id = v_encuesta_id and fingerprint = p_fingerprint
  ) then
    raise exception 'respuesta_duplicada';
  end if;

  insert into sesiones_respuesta (
    encuesta_id, origen, ip, pais, ciudad, latitud_ip, longitud_ip,
    token_navegador, fingerprint, iniciada_en, completada_en
  ) values (
    v_encuesta_id, 'online', p_ip, p_pais, p_ciudad, p_latitud_ip, p_longitud_ip,
    p_token_navegador, p_fingerprint, now(), now()
  ) returning id into v_sesion_id;

  insert into intentos_encuesta_online (encuesta_id, token_navegador, fingerprint, ip)
  values (v_encuesta_id, p_token_navegador, p_fingerprint, p_ip);

  for r in select * from jsonb_array_elements(coalesce(p_respuestas, '[]'::jsonb))
  loop
    insert into respuestas (sesion_id, pregunta_id, valor_texto, valor_numero, opcion_id)
    values (
      v_sesion_id,
      (r->>'pregunta_id')::uuid,
      r->>'valor_texto',
      nullif(r->>'valor_numero', '')::numeric,
      nullif(r->>'opcion_id', '')::uuid
    );
  end loop;

  return v_sesion_id;
end;
$$;

alter table public.encuestas drop constraint if exists encuestas_publicar_rango_check;
alter table public.encuestas drop column if exists publicar_desde;
alter table public.encuestas drop column if exists publicar_hasta;
