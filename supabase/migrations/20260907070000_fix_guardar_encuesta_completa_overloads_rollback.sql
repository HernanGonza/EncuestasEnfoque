-- Rollback de 20260907070000_fix_guardar_encuesta_completa_overloads.sql
--
-- Recrea las dos firmas viejas de guardar_encuesta_completa tal como
-- estaban antes del fix (7 y 8 argumentos). OJO: aplicar esto vuelve a
-- introducir la ambigüedad — solo usar si hace falta revertir a ciegas.

create function public.guardar_encuesta_completa(
  p_asignacion_id uuid default null::uuid,
  p_latitud numeric default null::numeric,
  p_longitud numeric default null::numeric,
  p_respuestas jsonb default null::jsonb,
  p_razon_no_respuesta text default null::text,
  p_participa_pregunta_id uuid default null::uuid,
  p_encuestador_id uuid default null::uuid
) returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_sesion_id uuid;
  v_encuestador_id uuid;
begin
  set local statement_timeout = '90s';

  v_encuestador_id := coalesce(
    p_encuestador_id,
    (select ae.encuestador_id from asignaciones_encuesta ae where ae.id = p_asignacion_id),
    auth.uid()
  );

  insert into sesiones_respuesta (asignacion_id, encuestador_id, latitud, longitud, iniciada_en, completada_en)
  values (p_asignacion_id, v_encuestador_id, p_latitud, p_longitud, now(), now())
  returning id into v_sesion_id;

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

create function public.guardar_encuesta_completa(
  p_asignacion_id uuid default null::uuid,
  p_latitud numeric default null::numeric,
  p_longitud numeric default null::numeric,
  p_respuestas jsonb default null::jsonb,
  p_razon_no_respuesta text default null::text,
  p_participa_pregunta_id uuid default null::uuid,
  p_encuestador_id uuid default null::uuid,
  p_iniciada_en timestamptz default null::timestamptz
) returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_sesion_id uuid;
  v_encuestador_id uuid;
begin
  set local statement_timeout = '90s';

  v_encuestador_id := coalesce(
    p_encuestador_id,
    (select ae.encuestador_id from asignaciones_encuesta ae where ae.id = p_asignacion_id),
    auth.uid()
  );

  insert into sesiones_respuesta (asignacion_id, encuestador_id, latitud, longitud, iniciada_en, completada_en)
  values (p_asignacion_id, v_encuestador_id, p_latitud, p_longitud, coalesce(p_iniciada_en, now()), now())
  returning id into v_sesion_id;

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
