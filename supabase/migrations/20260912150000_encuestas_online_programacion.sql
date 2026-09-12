-- Migración — programación de apertura/cierre de encuestas online
--
-- Motivo original (cuota de 50 dominios en Vercel) no aplica: el wildcard
-- *.metr1ka.com cuenta como una sola entrada, así que cerrar y liberar el
-- subdominio no es necesario por cuota — pero sigue siendo útil como
-- feature de ciclo de vida (permitir que una organización reuse el mismo
-- subdominio en su próxima campaña, y cerrar solas las encuestas con fecha
-- de corte sin depender de que alguien entre al panel a hacerlo a mano).
--
-- publicar_desde / publicar_hasta son independientes de estado_produccion:
-- el superadmin puede dejar la encuesta en 'publicada' desde antes, y estas
-- columnas deciden si en este momento puntual está realmente accesible
-- (obtener_encuesta_publica / guardar_respuesta_online las chequean). El
-- cierre automático (pg_cron, cada 10 min) además mueve estado_produccion a
-- 'completada' y libera el subdominio para que se pueda reasignar.
--
-- Rollback: 20260912150000_encuestas_online_programacion_rollback.sql

alter table public.encuestas
  add column publicar_desde timestamptz,
  add column publicar_hasta timestamptz;

alter table public.encuestas
  add constraint encuestas_publicar_rango_check
  check (publicar_desde is null or publicar_hasta is null or publicar_hasta > publicar_desde);

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
    and activo
    and (publicar_desde is null or now() >= publicar_desde)
    and (publicar_hasta is null or now() <= publicar_hasta);

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

-- ── Cierre automático ──
create or replace function public.cerrar_encuestas_online_vencidas()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update encuestas
  set estado_produccion = 'completada', subdominio = null
  where tipo_encuesta = 'online'
    and estado_produccion = 'publicada'
    and publicar_hasta is not null
    and publicar_hasta < now();
end;
$$;

create extension if not exists pg_cron;

select cron.schedule(
  'cerrar-encuestas-online-vencidas',
  '*/10 * * * *',
  $$select public.cerrar_encuestas_online_vencidas();$$
);
