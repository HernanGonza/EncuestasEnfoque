-- Rollback de 20260906023201_get_estado_encuesta_callejera_cuota_individual.sql
-- Restaura el body original (backups/metr1ka-20260902-211401.schema.sql:1338-1414),
-- sin el override de cuotas_individuales.

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
  v_hay_participa boolean;
  v_todas_asignaciones uuid[];
BEGIN
  SELECT e.config_muestreo, ez.encuesta_id
  INTO v_config, v_encuesta_id
  FROM asignaciones_encuesta ae
  JOIN encuesta_zonas ez ON ez.id = ae.encuesta_zona_id
  JOIN encuestas e ON e.id = ez.encuesta_id
  WHERE ae.id = p_asignacion_id;

  v_cuota := COALESCE((v_config->>'cuota_por_encuestador')::int,
             COALESCE((v_config->>'cuota_por_manzana')::int, 50));

  SELECT array_agg(ae.id) INTO v_todas_asignaciones
  FROM asignaciones_encuesta ae
  JOIN encuesta_zonas ez ON ez.id = ae.encuesta_zona_id
  WHERE ae.encuestador_id = (SELECT encuestador_id FROM asignaciones_encuesta WHERE id = p_asignacion_id)
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
