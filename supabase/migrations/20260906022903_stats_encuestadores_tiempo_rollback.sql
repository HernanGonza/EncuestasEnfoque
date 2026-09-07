-- Rollback de 20260906022903_stats_encuestadores_tiempo.sql
-- Restaura la firma anterior (sin promedio_segundos).

DROP FUNCTION IF EXISTS public.get_stats_encuestadores_por_encuesta(uuid, uuid);

CREATE FUNCTION public.get_stats_encuestadores_por_encuesta(p_encuesta_id uuid, p_equipo_id uuid DEFAULT NULL::uuid) RETURNS TABLE(encuestador_id uuid, completadas integer, no_respuesta integer, total integer, cuota integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH v_hay_participa AS (
    SELECT EXISTS (
      SELECT 1 FROM preguntas WHERE encuesta_id = p_encuesta_id AND clave_base = 'participa'
    ) AS hay
  ),
  sesiones AS (
    SELECT
      ae.encuestador_id,
      sr.id AS sesion_id,
      CASE
        WHEN NOT (SELECT hay FROM v_hay_participa) THEN true
        WHEN EXISTS (
          SELECT 1 FROM respuestas r JOIN preguntas p ON p.id = r.pregunta_id
          WHERE r.sesion_id = sr.id AND p.clave_base = 'participa' AND r.valor_texto = 'Sí'
        ) THEN true
        ELSE false
      END AS es_completada
    FROM sesiones_respuesta sr
    JOIN asignaciones_encuesta ae ON ae.id = sr.asignacion_id
    JOIN encuesta_zonas ez ON ez.id = ae.encuesta_zona_id
    WHERE ez.encuesta_id = p_encuesta_id
      AND (p_equipo_id IS NULL OR ez.equipo_id = p_equipo_id)
      AND sr.completada_en IS NOT NULL
  )
  SELECT
    ae.encuestador_id,
    COUNT(s.sesion_id) FILTER (WHERE s.es_completada)::int     AS completadas,
    COUNT(s.sesion_id) FILTER (WHERE NOT s.es_completada)::int AS no_respuesta,
    COUNT(s.sesion_id)::int                                     AS total,
    COALESCE((e.config_muestreo->>'cuota_por_encuestador')::int, 50) AS cuota
  FROM asignaciones_encuesta ae
  JOIN encuesta_zonas ez ON ez.id = ae.encuesta_zona_id
  JOIN encuestas e ON e.id = ez.encuesta_id
  LEFT JOIN sesiones s ON s.encuestador_id = ae.encuestador_id
  WHERE ez.encuesta_id = p_encuesta_id
    AND (p_equipo_id IS NULL OR ez.equipo_id = p_equipo_id)
    AND ae.activo = true
  GROUP BY ae.encuestador_id, e.config_muestreo;
$$;
