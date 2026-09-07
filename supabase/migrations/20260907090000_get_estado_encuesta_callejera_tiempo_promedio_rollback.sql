-- Rollback de 20260907090000_get_estado_encuesta_callejera_tiempo_promedio.sql
--
-- Vuelve a la versión sin tiempo_promedio_segundos (idéntica a
-- 20260906023201_get_estado_encuesta_callejera_cuota_individual.sql).

CREATE OR REPLACE FUNCTION public.get_estado_encuesta_callejera(p_asignacion_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_config       jsonb;
  v_cuota        int;
  v_completadas  int;
  v_no_respuesta int;
  v_encuesta_id  uuid;
  v_encuestador_id uuid;
  v_hay_participa boolean;
  v_todas_asignaciones uuid[];
BEGIN
  SELECT e.config_muestreo, ez.encuesta_id, ae.encuestador_id
  INTO v_config, v_encuesta_id, v_encuestador_id
  FROM asignaciones_encuesta ae
  JOIN encuesta_zonas ez ON ez.id = ae.encuesta_zona_id
  JOIN encuestas e ON e.id = ez.encuesta_id
  WHERE ae.id = p_asignacion_id;

  SELECT cuota INTO v_cuota
  FROM cuotas_individuales
  WHERE encuesta_id = v_encuesta_id AND encuestador_id = v_encuestador_id;

  v_cuota := COALESCE(v_cuota,
             (v_config->>'cuota_por_encuestador')::int,
             (v_config->>'cuota_por_manzana')::int, 50);

  SELECT array_agg(ae.id) INTO v_todas_asignaciones
  FROM asignaciones_encuesta ae
  JOIN encuesta_zonas ez ON ez.id = ae.encuesta_zona_id
  WHERE ae.encuestador_id = v_encuestador_id
    AND ez.encuesta_id = v_encuesta_id
    AND ae.activo = true;

  SELECT EXISTS (
    SELECT 1 FROM preguntas p
    WHERE p.encuesta_id = v_encuesta_id AND p.clave_base = 'participa'
  ) INTO v_hay_participa;

  IF v_hay_participa THEN
    SELECT COUNT(*)::int INTO v_completadas
    FROM sesiones_respuesta sr
    WHERE sr.asignacion_id = ANY(v_todas_asignaciones)
      AND sr.completada_en IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM respuestas r JOIN preguntas p ON p.id = r.pregunta_id
        WHERE r.sesion_id = sr.id AND p.clave_base = 'participa' AND r.valor_texto = 'Sí'
      );

    SELECT COUNT(*)::int INTO v_no_respuesta
    FROM sesiones_respuesta sr
    WHERE sr.asignacion_id = ANY(v_todas_asignaciones)
      AND sr.completada_en IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM respuestas r JOIN preguntas p ON p.id = r.pregunta_id
        WHERE r.sesion_id = sr.id AND p.clave_base = 'participa' AND r.valor_texto = 'Sí'
      );
  ELSE
    SELECT COUNT(*)::int INTO v_completadas
    FROM sesiones_respuesta sr
    WHERE sr.asignacion_id = ANY(v_todas_asignaciones)
      AND sr.completada_en IS NOT NULL
      AND EXISTS (SELECT 1 FROM respuestas r WHERE r.sesion_id = sr.id);

    SELECT COUNT(*)::int INTO v_no_respuesta
    FROM sesiones_respuesta sr
    WHERE sr.asignacion_id = ANY(v_todas_asignaciones)
      AND sr.completada_en IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM respuestas r WHERE r.sesion_id = sr.id);
  END IF;

  RETURN jsonb_build_object(
    'puede_encuestar', v_completadas < v_cuota,
    'completadas',     v_completadas,
    'no_respuesta',    v_no_respuesta,
    'total',           v_completadas + v_no_respuesta,
    'cuota',           v_cuota,
    'restantes',       GREATEST(0, v_cuota - v_completadas),
    'config',          v_config
  );
END;
$$;
