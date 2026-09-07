-- Rollback de 20260906023300_get_respuestas_crudas_zona.sql
-- Restaura el body original (backups/metr1ka-20260902-211401.schema.sql:1728-1785),
-- sin zona_id/zona_nombre.

CREATE OR REPLACE FUNCTION public.get_respuestas_crudas(p_encuesta_id uuid, p_org_id uuid, p_equipo_id uuid DEFAULT NULL::uuid, p_encuestador_id uuid DEFAULT NULL::uuid, p_fecha_desde date DEFAULT NULL::date, p_fecha_hasta date DEFAULT NULL::date, p_zona_ids uuid[] DEFAULT NULL::uuid[]) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'columnas', (
      SELECT jsonb_agg(jsonb_build_object('id', pq.id, 'texto', pq.texto, 'tipo', pq.tipo) ORDER BY pq.orden)
      FROM preguntas pq
      WHERE pq.encuesta_id = p_encuesta_id AND pq.clave_base IS DISTINCT FROM 'participa'
    ),
    'filas', (
      SELECT jsonb_agg(jsonb_build_object(
        'sesion_id',   sr.id,
        'fecha',       sr.completada_en,
        'lat',         sr.latitud,
        'lng',         sr.longitud,
        'encuestador', p.nombre_completo,
        'equipo',      eq.nombre,
        'respuestas',  (
          SELECT jsonb_object_agg(
            r.pregunta_id::text,
            CASE
              WHEN r.valor_booleano IS NOT NULL THEN CASE r.valor_booleano WHEN true THEN 'Sí' ELSE 'No' END
              WHEN r.opcion_id IS NOT NULL THEN (SELECT op.texto FROM opciones_pregunta op WHERE op.id = r.opcion_id)
              WHEN r.valor_numero IS NOT NULL THEN r.valor_numero::text
              ELSE r.valor_texto
            END
          )
          FROM respuestas r WHERE r.sesion_id = sr.id
        )
      ) ORDER BY sr.completada_en DESC)
      FROM sesiones_respuesta sr
      JOIN asignaciones_encuesta a  ON a.id = sr.asignacion_id
      JOIN encuesta_zonas ez        ON ez.id = a.encuesta_zona_id
      JOIN encuestas en             ON en.id = ez.encuesta_id
      JOIN perfiles p               ON p.id = a.encuestador_id
      LEFT JOIN equipo_encuestadores ee ON ee.encuestador_id = a.encuestador_id
      LEFT JOIN equipos eq          ON eq.id = ee.equipo_id
      WHERE ez.encuesta_id    = p_encuesta_id
        AND en.organizacion_id = p_org_id
        AND sr.completada_en IS NOT NULL
        AND (p_equipo_id      IS NULL OR ee.equipo_id     = p_equipo_id)
        AND (p_encuestador_id IS NULL OR a.encuestador_id = p_encuestador_id)
        AND (p_fecha_desde    IS NULL OR sr.completada_en::date >= p_fecha_desde)
        AND (p_fecha_hasta    IS NULL OR sr.completada_en::date <= p_fecha_hasta)
        AND (p_zona_ids IS NULL OR (
          sr.latitud IS NOT NULL AND sr.longitud IS NOT NULL AND
          EXISTS (
            SELECT 1 FROM encuesta_zonas ez2
            WHERE ez2.id = ANY(p_zona_ids)
              AND ez2.area_geojson IS NOT NULL
              AND ST_Contains(
                ST_SetSRID(ST_GeomFromGeoJSON(ez2.area_geojson->'features'->0->>'geometry'), 4326),
                ST_SetSRID(ST_MakePoint(sr.longitud, sr.latitud), 4326)
              )
          )
        ))
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;
