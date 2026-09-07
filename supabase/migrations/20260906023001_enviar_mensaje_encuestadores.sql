-- RPC enviar_mensaje_encuestadores — único punto de inserción para
-- mensajes/mensajes_destinatarios (ninguna de las dos tablas tiene policy
-- de insert, ver 20260906023000_mensajes_tablas.sql).
--
-- p_alcance: 'org' | 'equipo' | 'individual'
--   - admin/gestor/superadmin: puede usar cualquier alcance.
--       'org'        → todos los encuestadores activos de la organización.
--       'equipo'     → todos los encuestadores del equipo p_equipo_id.
--       'individual' → solo p_encuestador_id.
--   - coordinador: NO puede usar 'org'. Solo:
--       'equipo'     → p_equipo_id debe ser uno de sus propios equipos
--                       (equipo_coordinadores).
--       'individual' → p_encuestador_id debe pertenecer a alguno de sus
--                       propios equipos (equipo_encuestadores).
--   - cualquier otro rol: rechazado.
--
-- Devuelve el id del mensaje creado.
--
-- Ver PLAN-tiempo-encuestas-y-mensajes.md, sección 2.
-- Rollback: 20260906023001_enviar_mensaje_encuestadores_rollback.sql

CREATE FUNCTION public.enviar_mensaje_encuestadores(
  p_titulo text,
  p_texto text,
  p_alcance text,
  p_equipo_id uuid DEFAULT NULL,
  p_encuestador_id uuid DEFAULT NULL
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_rol rol_tipo;
  v_org uuid;
  v_mensaje_id uuid;
BEGIN
  v_rol := mi_rol();
  v_org := mi_organizacion();

  IF v_rol IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF p_titulo IS NULL OR btrim(p_titulo) = '' THEN
    RAISE EXCEPTION 'El título es obligatorio';
  END IF;
  IF p_texto IS NULL OR btrim(p_texto) = '' THEN
    RAISE EXCEPTION 'El texto es obligatorio';
  END IF;
  IF p_alcance NOT IN ('org', 'equipo', 'individual') THEN
    RAISE EXCEPTION 'Alcance inválido: %', p_alcance;
  END IF;

  IF v_rol IN ('admin', 'gestor', 'superadmin') THEN
    -- admin/gestor: cualquier alcance, pero equipo/individual deben
    -- pertenecer a la propia organización.
    IF p_alcance = 'equipo' AND NOT EXISTS (
      SELECT 1 FROM equipos WHERE id = p_equipo_id AND organizacion_id = v_org
    ) THEN
      RAISE EXCEPTION 'Equipo no encontrado en la organización';
    END IF;
    IF p_alcance = 'individual' AND NOT EXISTS (
      SELECT 1 FROM perfiles WHERE id = p_encuestador_id AND organizacion_id = v_org AND rol = 'encuestador'
    ) THEN
      RAISE EXCEPTION 'Encuestador no encontrado en la organización';
    END IF;
  ELSIF v_rol = 'coordinador' THEN
    IF p_alcance = 'org' THEN
      RAISE EXCEPTION 'Un coordinador no puede enviar mensajes a toda la organización';
    ELSIF p_alcance = 'equipo' THEN
      IF NOT EXISTS (
        SELECT 1 FROM equipo_coordinadores
        WHERE equipo_id = p_equipo_id AND coordinador_id = auth.uid()
      ) THEN
        RAISE EXCEPTION 'No coordinás ese equipo';
      END IF;
    ELSIF p_alcance = 'individual' THEN
      IF NOT EXISTS (
        SELECT 1 FROM equipo_encuestadores ee
        JOIN equipo_coordinadores ec ON ec.equipo_id = ee.equipo_id
        WHERE ee.encuestador_id = p_encuestador_id AND ec.coordinador_id = auth.uid()
      ) THEN
        RAISE EXCEPTION 'Ese encuestador no pertenece a tu equipo';
      END IF;
    END IF;
  ELSE
    RAISE EXCEPTION 'Rol no autorizado para enviar mensajes';
  END IF;

  INSERT INTO mensajes (organizacion_id, remitente_id, titulo, texto)
  VALUES (v_org, auth.uid(), btrim(p_titulo), btrim(p_texto))
  RETURNING id INTO v_mensaje_id;

  IF p_alcance = 'org' THEN
    INSERT INTO mensajes_destinatarios (mensaje_id, encuestador_id)
    SELECT v_mensaje_id, id FROM perfiles
    WHERE organizacion_id = v_org AND rol = 'encuestador' AND activo = true;
  ELSIF p_alcance = 'equipo' THEN
    INSERT INTO mensajes_destinatarios (mensaje_id, encuestador_id)
    SELECT v_mensaje_id, ee.encuestador_id
    FROM equipo_encuestadores ee
    JOIN perfiles p ON p.id = ee.encuestador_id
    WHERE ee.equipo_id = p_equipo_id AND p.activo = true;
  ELSIF p_alcance = 'individual' THEN
    INSERT INTO mensajes_destinatarios (mensaje_id, encuestador_id)
    VALUES (v_mensaje_id, p_encuestador_id);
  END IF;

  RETURN v_mensaje_id;
END;
$$;
