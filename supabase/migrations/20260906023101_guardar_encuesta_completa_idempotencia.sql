-- Migración — guardar_encuesta_completa(): idempotencia vía p_idempotency_key
--
-- Bug B (PLAN-tiempo-encuestas-y-mensajes.md, sección 5): si
-- guardar_encuesta_completa ya insertó la sesión pero registrar_visita falla
-- después (típico en campo: se corta la conexión entre una llamada y la
-- otra), el cliente trata todo el intento como fallido y lo reintenta más
-- tarde desde la cola offline — sin esto, ese reintento vuelve a insertar
-- una segunda fila en sesiones_respuesta para la misma encuesta.
--
-- Con p_idempotency_key: el cliente manda una clave estable (generada una
-- sola vez por intento, reusada en el reintento si cae a la cola offline).
-- Si ya existe una sesión con esa key, se devuelve su id sin insertar de
-- nuevo. El insert además está protegido contra la carrera de dos llamadas
-- concurrentes con la misma key (unique_violation → se relee y devuelve la
-- fila que ganó la carrera).
--
-- Parámetro nuevo al final con default null: compatible con la versión de
-- la app ya instalada (llama con 8 argumentos, sin el 9no). CREATE OR
-- REPLACE alcanza, no cambia el tipo de retorno.
--
-- Ver PLAN-tiempo-encuestas-y-mensajes.md, sección 5.
-- Rollback: 20260906023101_guardar_encuesta_completa_idempotencia_rollback.sql

create or replace function public.guardar_encuesta_completa(
  p_asignacion_id uuid default null::uuid,
  p_latitud numeric default null::numeric,
  p_longitud numeric default null::numeric,
  p_respuestas jsonb default null::jsonb,
  p_razon_no_respuesta text default null::text,
  p_participa_pregunta_id uuid default null::uuid,
  p_encuestador_id uuid default null::uuid,
  p_iniciada_en timestamptz default null::timestamptz,
  p_idempotency_key uuid default null::uuid
) returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_sesion_id uuid;
  v_encuestador_id uuid;
begin
  set local statement_timeout = '90s';

  -- Idempotencia: si ya existe una sesión con esta key, devolverla tal cual
  -- (no insertar de nuevo, no pisar respuestas ya guardadas).
  if p_idempotency_key is not null then
    select id into v_sesion_id
    from sesiones_respuesta
    where idempotency_key = p_idempotency_key;

    if v_sesion_id is not null then
      return v_sesion_id;
    end if;
  end if;

  v_encuestador_id := coalesce(
    p_encuestador_id,
    (select ae.encuestador_id from asignaciones_encuesta ae where ae.id = p_asignacion_id),
    auth.uid()
  );

  begin
    insert into sesiones_respuesta (asignacion_id, encuestador_id, latitud, longitud, iniciada_en, completada_en, idempotency_key)
    values (p_asignacion_id, v_encuestador_id, p_latitud, p_longitud, coalesce(p_iniciada_en, now()), now(), p_idempotency_key)
    returning id into v_sesion_id;
  exception when unique_violation then
    -- Carrera: otra llamada con la misma key insertó primero. Devolver esa.
    select id into v_sesion_id
    from sesiones_respuesta
    where idempotency_key = p_idempotency_key;
    return v_sesion_id;
  end;

  -- Caso No Responde
  if p_razon_no_respuesta is not null and p_participa_pregunta_id is not null then
    insert into respuestas (sesion_id, pregunta_id, valor_texto)
    values (v_sesion_id, p_participa_pregunta_id, p_razon_no_respuesta);
    return v_sesion_id;
  end if;

  if p_respuestas is not null and jsonb_array_length(p_respuestas) > 0 then
    insert into respuestas (sesion_id, pregunta_id, opcion_id, valor_texto, valor_numero, valor_booleano)
    select
      v_sesion_id,
      (elem->>'pregunta_id')::uuid,
      nullif(trim(elem->>'opcion_id'), '')::uuid,
      case when elem ? 'valor_texto'    and elem->>'valor_texto'    is not null then elem->>'valor_texto'    else null end,
      case when elem ? 'valor_numero'   and elem->>'valor_numero'   is not null then (elem->>'valor_numero')::numeric else null end,
      case when elem ? 'valor_booleano' and elem->>'valor_booleano' is not null then (elem->>'valor_booleano')::boolean else null end
    from jsonb_array_elements(p_respuestas) as elem
    where elem->>'pregunta_id' is not null;
  end if;

  return v_sesion_id;
end;
$$;
