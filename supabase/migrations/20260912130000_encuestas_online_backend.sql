-- Migración — backend público de encuestas online
--
-- Segundo paso del plan de encuestas online (después de
-- 20260912120000_encuestas_subdominio.sql). Acá se abre el único camino
-- público de la plataforma: nadie se loguea para responder una encuesta
-- online, así que en vez de dar grants sobre las tablas a `anon` (encuestas,
-- preguntas, sesiones_respuesta, respuestas siguen con RLS activado y sin
-- ningún grant a anon), se exponen dos funciones security definer bien
-- acotadas:
--
--   - obtener_encuesta_publica(subdominio): solo devuelve algo si la
--     encuesta es tipo_encuesta='online', está 'publicada' y activa.
--   - guardar_respuesta_online(...): misma validación + 3 capas de
--     antifraude (cookie/token de navegador, IP, fingerprint), todas
--     evaluadas por encuesta (no global) para minimizar falsos positivos.
--
-- sesiones_respuesta suma columnas para poder distinguir un envío online de
-- uno de campo sin romper nada de lo que ya lee guardar_encuesta_completa /
-- get_encuesta_full / los reportes automáticos (todas nullable, todas
-- ignoradas por el código existente).
--
-- Rollback: 20260912130000_encuestas_online_backend_rollback.sql

alter table public.sesiones_respuesta
  add column origen text not null default 'app',
  add column ip text,
  add column pais text,
  add column ciudad text,
  add column latitud_ip double precision,
  add column longitud_ip double precision,
  add column token_navegador uuid,
  add column fingerprint text;

alter table public.sesiones_respuesta
  add constraint sesiones_respuesta_origen_check check (origen in ('app', 'online'));

comment on column public.sesiones_respuesta.origen is
  'app = encuestador de campo (mobile). online = respondente anónimo vía subdominio.';

-- ── Antifraude: un registro por intento exitoso, usado para bloquear reintentos ──
create table public.intentos_encuesta_online (
  id              uuid primary key default gen_random_uuid(),
  encuesta_id     uuid not null references public.encuestas(id) on delete cascade,
  token_navegador uuid,
  fingerprint     text,
  ip              text,
  creado_en       timestamptz not null default now()
);

-- Únicos parciales: null nunca choca, así que una capa que no llegó (ej. el
-- navegador bloqueó el fingerprint) no impide que las otras dos sigan
-- protegiendo.
create unique index intentos_online_token_uniq
  on public.intentos_encuesta_online (encuesta_id, token_navegador)
  where token_navegador is not null;
create unique index intentos_online_ip_uniq
  on public.intentos_encuesta_online (encuesta_id, ip)
  where ip is not null;
create unique index intentos_online_fingerprint_uniq
  on public.intentos_encuesta_online (encuesta_id, fingerprint)
  where fingerprint is not null;

alter table public.intentos_encuesta_online enable row level security;
-- Sin policies para anon/authenticated a propósito: esta tabla solo se lee/
-- escribe desde dentro de guardar_respuesta_online (security definer).

-- ── Lectura pública de una encuesta online publicada ──
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

grant execute on function public.obtener_encuesta_publica(text) to anon;

-- ── Guardar una respuesta online (con antifraude) ──
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

  -- Registrar el intento recién ahora (post-insert): si algo de arriba
  -- falla, no se consume el "cupo" de esta persona.
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

grant execute on function public.guardar_respuesta_online(text, jsonb, uuid, text, text, text, text, double precision, double precision) to anon;
