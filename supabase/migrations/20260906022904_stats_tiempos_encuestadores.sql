-- Migración — get_stats_tiempos_encuestadores(): promedio general de tiempo
-- por encuestador, sumando todas las encuestas de la organización.
--
-- Para Encuestadores.jsx (panel web). Función nueva, aditiva.
-- Ver PLAN-tiempo-encuestas-y-mensajes.md, sección 1.
--
-- Mismo criterio de exclusión de sesiones sin timing real que las anteriores.
-- Rollback: 20260906022904_stats_tiempos_encuestadores_rollback.sql

CREATE OR REPLACE FUNCTION public.get_stats_tiempos_encuestadores(p_organizacion_id uuid)
RETURNS TABLE(encuestador_id uuid, promedio_segundos numeric, total_completadas integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    ae.encuestador_id,
    AVG(EXTRACT(EPOCH FROM (sr.completada_en - sr.iniciada_en)))
      FILTER (WHERE sr.completada_en > sr.iniciada_en) AS promedio_segundos,
    COUNT(sr.id)::int AS total_completadas
  FROM sesiones_respuesta sr
  JOIN asignaciones_encuesta ae ON ae.id = sr.asignacion_id
  JOIN encuesta_zonas ez        ON ez.id = ae.encuesta_zona_id
  JOIN encuestas e              ON e.id  = ez.encuesta_id
  WHERE e.organizacion_id = p_organizacion_id
    AND sr.completada_en IS NOT NULL
  GROUP BY ae.encuestador_id;
$$;
