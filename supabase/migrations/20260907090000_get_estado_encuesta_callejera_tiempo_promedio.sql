-- get_estado_encuesta_callejera(): sumar tiempo_promedio_segundos al jsonb
-- de respuesta — promedio de duración (completada_en - iniciada_en) de las
-- encuestas COMPLETADAS de este encuestador en esta encuesta (mismo
-- criterio de "completada" que ya se usaba para v_completadas: con o sin
-- pregunta 'participa' según corresponda).
--
-- No cambia la firma de la función (sigue siendo get_estado_encuesta_callejera
-- (p_asignacion_id uuid)) — CREATE OR REPLACE acá SÍ reemplaza la función
-- existente sin crear un overload nuevo, a diferencia del bug arreglado en
-- 20260907070000 (ese caso agregaba un parámetro; este solo agrega una
-- clave al jsonb que devuelve).
--
-- Se usa para mostrar, en la app, tanto el objetivo configurado
-- (tiempo_objetivo_minutos, que ya se mandaba en get_encuesta_full) como el
-- promedio real del encuestador, con indicador arriba/abajo del objetivo —
-- en la pantalla de mapa y en la de fin. Ver
-- PLAN-tiempo-encuestas-y-mensajes.md, sección 1, y feedback 7/sep/2026.
--
-- Rollback: 20260907090000_get_estado_encuesta_callejera_tiempo_promedio_rollback.sql

CREATE OR REPLACE FUNCTION public.get_estado_encuesta_callejera(p_asignacion_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_config       jsonb;
  v_cuota        int;
  v_completadas  int;
  v_no_respuesta int;
  v_tiempo_promedio_segundos numeric;
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

    SELECT AVG(EXTRACT(EPOCH FROM (sr.completada_en - sr.iniciada_en))) INTO v_tiempo_promedio_segundos
    FROM sesiones_respuesta sr
    WHERE sr.asignacion_id = ANY(v_todas_asignaciones)
      AND sr.completada_en IS NOT NULL
      AND sr.iniciada_en IS NOT NULL
      AND EXISTS (
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

    SELECT AVG(EXTRACT(EPOCH FROM (sr.completada_en - sr.iniciada_en))) INTO v_tiempo_promedio_segundos
    FROM sesiones_respuesta sr
    WHERE sr.asignacion_id = ANY(v_todas_asignaciones)
      AND sr.completada_en IS NOT NULL
      AND sr.iniciada_en IS NOT NULL
      AND EXISTS (SELECT 1 FROM respuestas r WHERE r.sesion_id = sr.id);
  END IF;

  RETURN jsonb_build_object(
    'puede_encuestar', v_completadas < v_cuota,
    'completadas',     v_completadas,
    'no_respuesta',    v_no_respuesta,
    'total',           v_completadas + v_no_respuesta,
    'cuota',           v_cuota,
    'restantes',       GREATEST(0, v_cuota - v_completadas),
    'config',          v_config,
    'tiempo_promedio_segundos', v_tiempo_promedio_segundos
  );
END;
$$;
