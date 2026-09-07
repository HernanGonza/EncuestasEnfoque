-- Migración — get_resultados_encuesta_filtrado(): promedio de tiempo + objetivo
--
-- Suma al jsonb de salida:
--   - promedio_segundos: promedio de (completada_en - iniciada_en) en las
--     sesiones del filtro. Se excluyen las sesiones donde completada_en =
--     iniciada_en (dato viejo, de antes de esta migración, cuando la RPC
--     insertaba las dos con el mismo now() — incluirlas con duración 0
--     falsearía el promedio hacia abajo).
--   - tiempo_objetivo_minutos: el configurado en encuestas, para comparar en
--     el panel/app (mismo verde/rojo de la app).
--
-- Esta función ya se llama en vivo desde EncuestaDetalle.jsx vía Realtime a
-- INSERT en sesiones_respuesta, así que el dato queda en vivo gratis.
-- Ver PLAN-tiempo-encuestas-y-mensajes.md, sección 1.
--
-- Solo agrega keys al jsonb de salida (no cambia el tipo de retorno de la
-- función) — CREATE OR REPLACE alcanza.
-- Rollback: 20260906022902_resultados_encuesta_tiempo_rollback.sql

CREATE OR REPLACE FUNCTION public.get_resultados_encuesta_filtrado(p_encuesta_id uuid, p_equipo_id uuid DEFAULT NULL::uuid, p_zona_id uuid DEFAULT NULL::uuid, p_encuestador_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_result             jsonb;
  v_hay_participa      boolean;
  v_participa_guardada boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM preguntas WHERE encuesta_id = p_encuesta_id AND clave_base = 'participa'
  ) INTO v_hay_participa;

  SELECT EXISTS (
    SELECT 1 FROM respuestas r
    JOIN preguntas p ON p.id = r.pregunta_id
    JOIN sesiones_respuesta sr ON sr.id = r.sesion_id
    JOIN asignaciones_encuesta ae ON ae.id = sr.asignacion_id
    JOIN encuesta_zonas ez ON ez.id = ae.encuesta_zona_id
    WHERE ez.encuesta_id = p_encuesta_id AND p.clave_base = 'participa'
  ) INTO v_participa_guardada;

  SELECT jsonb_build_object(
    'total_sesiones',    COUNT(DISTINCT sr.id),
    'total_completadas', COUNT(DISTINCT sr.id) FILTER (WHERE
      CASE
        WHEN v_hay_participa AND v_participa_guardada THEN EXISTS (
          SELECT 1 FROM respuestas r JOIN preguntas p ON p.id = r.pregunta_id
          WHERE r.sesion_id = sr.id AND p.clave_base = 'participa' AND r.valor_texto = 'Sí'
        )
        ELSE EXISTS (
          SELECT 1 FROM respuestas r JOIN preguntas p ON p.id = r.pregunta_id
          WHERE r.sesion_id = sr.id AND (p.clave_base IS NULL OR p.clave_base != 'participa')
        )
      END
    ),
    'total_no_respuesta', COUNT(DISTINCT sr.id) FILTER (WHERE
      CASE
        WHEN v_hay_participa AND v_participa_guardada THEN NOT EXISTS (
          SELECT 1 FROM respuestas r JOIN preguntas p ON p.id = r.pregunta_id
          WHERE r.sesion_id = sr.id AND p.clave_base = 'participa' AND r.valor_texto = 'Sí'
        )
        ELSE NOT EXISTS (
          SELECT 1 FROM respuestas r JOIN preguntas p ON p.id = r.pregunta_id
          WHERE r.sesion_id = sr.id AND (p.clave_base IS NULL OR p.clave_base != 'participa')
        )
      END
    ),
    'total_hoy', COUNT(DISTINCT sr.id) FILTER (WHERE
      sr.completada_en::date = CURRENT_DATE AND
      CASE
        WHEN v_hay_participa AND v_participa_guardada THEN EXISTS (
          SELECT 1 FROM respuestas r JOIN preguntas p ON p.id = r.pregunta_id
          WHERE r.sesion_id = sr.id AND p.clave_base = 'participa' AND r.valor_texto = 'Sí'
        )
        ELSE EXISTS (
          SELECT 1 FROM respuestas r JOIN preguntas p ON p.id = r.pregunta_id
          WHERE r.sesion_id = sr.id AND (p.clave_base IS NULL OR p.clave_base != 'participa')
        )
      END
    ),
    'promedio_segundos', (
      SELECT AVG(EXTRACT(EPOCH FROM (sr4.completada_en - sr4.iniciada_en)))
      FROM sesiones_respuesta sr4
      JOIN asignaciones_encuesta ae4 ON ae4.id = sr4.asignacion_id
      JOIN encuesta_zonas ez4 ON ez4.id = ae4.encuesta_zona_id
      WHERE ez4.encuesta_id = p_encuesta_id
        AND (p_equipo_id      IS NULL OR ez4.equipo_id      = p_equipo_id)
        AND (p_zona_id        IS NULL OR ez4.id             = p_zona_id)
        AND (p_encuestador_id IS NULL OR ae4.encuestador_id = p_encuestador_id)
        AND sr4.completada_en IS NOT NULL
        AND sr4.iniciada_en   IS NOT NULL
        AND sr4.completada_en > sr4.iniciada_en
    ),
    'tiempo_objetivo_minutos', (SELECT e.tiempo_objetivo_minutos FROM encuestas e WHERE e.id = p_encuesta_id),
    'respuestas', (
      SELECT jsonb_agg(jsonb_build_object(
        'pregunta_id',    r.pregunta_id,
        'valor_texto',    r.valor_texto,
        'valor_numero',   r.valor_numero,
        'valor_booleano', r.valor_booleano,
        'opcion_id',      r.opcion_id
      ))
      FROM respuestas r
      JOIN sesiones_respuesta sr2 ON sr2.id = r.sesion_id
      JOIN asignaciones_encuesta ae2 ON ae2.id = sr2.asignacion_id
      JOIN encuesta_zonas ez2 ON ez2.id = ae2.encuesta_zona_id
      JOIN preguntas p2 ON p2.id = r.pregunta_id
      WHERE ez2.encuesta_id = p_encuesta_id
        AND (p_equipo_id      IS NULL OR ez2.equipo_id      = p_equipo_id)
        AND (p_zona_id        IS NULL OR ez2.id             = p_zona_id)
        AND (p_encuestador_id IS NULL OR ae2.encuestador_id = p_encuestador_id)
        AND sr2.completada_en IS NOT NULL
        AND (p2.clave_base IS NULL OR p2.clave_base != 'participa')
    ),
    'por_dia', (
      SELECT jsonb_agg(jsonb_build_object('dia', fecha_dia, 'total', total) ORDER BY fecha_dia)
      FROM (
        SELECT sr3.completada_en::date AS fecha_dia, COUNT(*) AS total
        FROM sesiones_respuesta sr3
        JOIN asignaciones_encuesta ae3 ON ae3.id = sr3.asignacion_id
        JOIN encuesta_zonas ez3 ON ez3.id = ae3.encuesta_zona_id
        WHERE ez3.encuesta_id = p_encuesta_id
          AND (p_equipo_id      IS NULL OR ez3.equipo_id      = p_equipo_id)
          AND (p_zona_id        IS NULL OR ez3.id             = p_zona_id)
          AND (p_encuestador_id IS NULL OR ae3.encuestador_id = p_encuestador_id)
          AND sr3.completada_en IS NOT NULL
          AND CASE
            WHEN v_hay_participa AND v_participa_guardada THEN EXISTS (
              SELECT 1 FROM respuestas r JOIN preguntas p ON p.id = r.pregunta_id
              WHERE r.sesion_id = sr3.id AND p.clave_base = 'participa' AND r.valor_texto = 'Sí'
            )
            ELSE EXISTS (
              SELECT 1 FROM respuestas r JOIN preguntas p ON p.id = r.pregunta_id
              WHERE r.sesion_id = sr3.id AND (p.clave_base IS NULL OR p.clave_base != 'participa')
            )
          END
        GROUP BY fecha_dia ORDER BY fecha_dia DESC LIMIT 14
      ) sub
    )
  ) INTO v_result
  FROM sesiones_respuesta sr
  JOIN asignaciones_encuesta ae ON ae.id = sr.asignacion_id
  JOIN encuesta_zonas ez ON ez.id = ae.encuesta_zona_id
  WHERE ez.encuesta_id = p_encuesta_id
    AND (p_equipo_id      IS NULL OR ez.equipo_id      = p_equipo_id)
    AND (p_zona_id        IS NULL OR ez.id             = p_zona_id)
    AND (p_encuestador_id IS NULL OR ae.encuestador_id = p_encuestador_id)
    AND sr.completada_en IS NOT NULL;

  RETURN v_result;
END;
$$;
