-- get_estado_encuesta_callejera(): usar cuotas_individuales como override
-- de la cuota general (config_muestreo.cuota_por_encuestador) cuando exista
-- una fila para (encuesta_id, encuestador_id de la asignación).
--
-- Único cambio real respecto a la versión original (ver
-- backups/metr1ka-20260902-211401.schema.sql:1338-1414): se resuelve
-- v_encuestador_id primero (para poder buscar el override y porque ya se
-- usaba, sin nombre, dentro del subselect de v_todas_asignaciones — ahora
-- se reutiliza esa misma variable en vez de repetir el subselect), y
-- v_cuota se calcula con COALESCE contra cuotas_individuales antes de caer
-- a config_muestreo.
--
-- Ver PLAN-tiempo-encuestas-y-mensajes.md, sección 6.
-- Rollback: 20260906023201_get_estado_encuesta_callejera_cuota_individual_rollback.sql

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
  -- Obtener config, encuesta_id y encuestador_id desde la asignación
  SELECT e.config_muestreo, ez.encuesta_id, ae.encuestador_id
  INTO v_config, v_encuesta_id, v_encuestador_id
  FROM asignaciones_encuesta ae
  JOIN encuesta_zonas ez ON ez.id = ae.encuesta_zona_id
  JOIN encuestas e ON e.id = ez.encuesta_id
  WHERE ae.id = p_asignacion_id;

  -- Override individual (sección 6): si existe una fila en
  -- cuotas_individuales para este encuestador en esta encuesta, se usa esa
  -- cuota; si no, cae a la cuota general de config_muestreo como antes.
  SELECT cuota INTO v_cuota
  FROM cuotas_individuales
  WHERE encuesta_id = v_encuesta_id AND encuestador_id = v_encuestador_id;

  v_cuota := COALESCE(v_cuota,
             (v_config->>'cuota_por_encuestador')::int,
             (v_config->>'cuota_por_manzana')::int, 50);

  -- Obtener TODAS las asignaciones del mismo encuestador en esta encuesta
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
