-- Rollback de 20260906022901_guardar_encuesta_completa_iniciada_en.sql
-- Restaura la versión anterior (7 parámetros, sin p_iniciada_en).

create or replace function public.guardar_encuesta_completa(p_asignacion_id uuid DEFAULT NULL::uuid, p_latitud numeric DEFAULT NULL::numeric, p_longitud numeric DEFAULT NULL::numeric, p_respuestas jsonb DEFAULT NULL::jsonb, p_razon_no_respuesta text DEFAULT NULL::text, p_participa_pregunta_id uuid DEFAULT NULL::uuid, p_encuestador_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_sesion_id uuid;
  v_encuestador_id uuid;
BEGIN
  SET LOCAL statement_timeout = '90s';

  v_encuestador_id := COALESCE(
    p_encuestador_id,
    (SELECT ae.encuestador_id FROM asignaciones_encuesta ae WHERE ae.id = p_asignacion_id),
    auth.uid()
  );

  INSERT INTO sesiones_respuesta (asignacion_id, encuestador_id, latitud, longitud, iniciada_en, completada_en)
  VALUES (p_asignacion_id, v_encuestador_id, p_latitud, p_longitud, now(), now())
  RETURNING id INTO v_sesion_id;

  IF p_razon_no_respuesta IS NOT NULL AND p_participa_pregunta_id IS NOT NULL THEN
    INSERT INTO respuestas (sesion_id, pregunta_id, valor_texto)
    VALUES (v_sesion_id, p_participa_pregunta_id, p_razon_no_respuesta);
    RETURN v_sesion_id;
  END IF;

  IF p_respuestas IS NOT NULL AND jsonb_array_length(p_respuestas) > 0 THEN
    INSERT INTO respuestas (sesion_id, pregunta_id, opcion_id, valor_texto, valor_numero, valor_booleano)
    SELECT
      v_sesion_id,
      (elem->>'pregunta_id')::uuid,
      NULLIF(trim(elem->>'opcion_id'), '')::uuid,
      CASE WHEN elem ? 'valor_texto'    AND elem->>'valor_texto'    IS NOT NULL THEN elem->>'valor_texto'    ELSE NULL END,
      CASE WHEN elem ? 'valor_numero'   AND elem->>'valor_numero'   IS NOT NULL THEN (elem->>'valor_numero')::numeric ELSE NULL END,
      CASE WHEN elem ? 'valor_booleano' AND elem->>'valor_booleano' IS NOT NULL THEN (elem->>'valor_booleano')::boolean ELSE NULL END
    FROM jsonb_array_elements(p_respuestas) AS elem
    WHERE elem->>'pregunta_id' IS NOT NULL;
  END IF;

  RETURN v_sesion_id;
END;
$$;
