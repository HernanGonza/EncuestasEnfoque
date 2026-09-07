-- get_respuestas_crudas(): volver a usar la zona/encuestador/equipo
-- denormalizados en sesiones_respuesta en vez de derivarlos por INNER JOIN
-- contra asignaciones_encuesta.
--
-- Bug detectado en producción (Campo Grande, set/2026): la versión vigente
-- (de 20260906023300_get_respuestas_crudas_zona.sql) arma zona_id/zona_nombre
-- así:
--   JOIN asignaciones_encuesta a ON a.id = sr.asignacion_id
--   JOIN encuesta_zonas ez       ON ez.id = a.encuesta_zona_id
-- Como son INNER JOIN, cualquier sesión completada cuyo asignacion_id no
-- matchee una fila viva de asignaciones_encuesta (asignación borrada,
-- reasignada, etc.) desaparece ENTERA del resultado — no solo pierde la
-- zona, se cae de golpe de todos los reportes por zona (el mapa interactivo
-- y los reportes automáticos de candidatos/completo/no-respuesta/geográfico).
-- Verificado en Supabase (encuesta "Campo Grande - Septiembre 2026",
-- cb2fba09-5f48-4197-b82e-65e3c9451fb9): 154 de 568 sesiones completadas
-- (27%) tienen asignacion_id huérfano y quedaban afuera — de ahí que varias
-- zonas (11, 3, 7, 18, 10, 9, 8, 4, etc.) mostraran "sin datos" para
-- preguntas que sí tenían respuestas cargadas.
--
-- Además: sesiones_respuesta YA trae zona_id/zona_nombre/encuestador_id/
-- equipo_id/equipo_nombre propios, resueltos por GPS al completar la
-- sesión (columnas zona_por_gps/zona_metodo) — es la fuente que job de
-- captura llena sí o sí, sin depender de que la asignación administrativa
-- siga existiendo. Se vio además que, para sesiones donde la asignación SÍ
-- matchea, la zona de la asignación puede no coincidir con la zona real
-- detectada por GPS de esa sesión puntual (el encuestador terminó
-- encuestando en la zona vecina) — otra razón para confiar en el dato de
-- la sesión, no en el de la asignación.
--
-- Esta versión es la misma que estaba antes de 20260906023300 (ver
-- backups/metr1ka-20260902-211401.schema.sql y el rollback de esa
-- migración) pero sumando zona_id/zona_nombre al jsonb de cada fila, que
-- es lo que ReporteVisualZona.jsx y reportesAutomaticos.js ya esperan.
--
-- Rollback: 20260907150000_get_respuestas_crudas_zona_denormalizada_rollback.sql

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
        'equipo',      coalesce(sr.equipo_nombre, eq.nombre),
        'zona_id',     sr.zona_id,
        'zona_nombre', coalesce(sr.zona_nombre, ez.nombre),
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
      JOIN encuestas en                 ON en.id = sr.encuesta_id
      LEFT JOIN perfiles p              ON p.id = sr.encuestador_id
      LEFT JOIN encuesta_zonas ez       ON ez.id = sr.zona_id
      LEFT JOIN equipo_encuestadores ee ON ee.encuestador_id = sr.encuestador_id
      LEFT JOIN equipos eq              ON eq.id = coalesce(sr.equipo_id, ez.equipo_id, ee.equipo_id)
      WHERE sr.encuesta_id     = p_encuesta_id
        AND en.organizacion_id = p_org_id
        AND sr.completada_en IS NOT NULL
        AND (p_equipo_id      IS NULL OR coalesce(sr.equipo_id, ez.equipo_id, ee.equipo_id) = p_equipo_id)
        AND (p_encuestador_id IS NULL OR sr.encuestador_id = p_encuestador_id)
        AND (p_fecha_desde    IS NULL OR sr.completada_en::date >= p_fecha_desde)
        AND (p_fecha_hasta    IS NULL OR sr.completada_en::date <= p_fecha_hasta)
        AND (p_zona_ids       IS NULL OR sr.zona_id = ANY(p_zona_ids))
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;
