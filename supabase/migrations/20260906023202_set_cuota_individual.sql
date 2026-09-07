-- RPC set_cuota_individual — upsert en cuotas_individuales.
--
-- Autorización:
--   - admin/gestor/superadmin: siempre, siempre que la encuesta y el
--     encuestador pertenezcan a la propia organización.
--   - coordinador: solo si el encuestador pertenece a alguno de sus
--     propios equipos (equipo_encuestadores + equipo_coordinadores), mismo
--     criterio que enviar_mensaje_encuestadores (sección 2).
--   - cualquier otro rol: rechazado.
--
-- p_cuota debe ser > 0 (la tabla ya lo valida con CHECK, pero se valida acá
-- también para dar un mensaje de error más claro que "violates check
-- constraint").
--
-- Ver PLAN-tiempo-encuestas-y-mensajes.md, sección 6.
-- Rollback: 20260906023202_set_cuota_individual_rollback.sql

CREATE FUNCTION public.set_cuota_individual(
  p_encuesta_id uuid,
  p_encuestador_id uuid,
  p_cuota integer
) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_rol rol_tipo;
  v_org uuid;
BEGIN
  v_rol := mi_rol();
  v_org := mi_organizacion();

  IF v_rol IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF p_cuota IS NULL OR p_cuota <= 0 THEN
    RAISE EXCEPTION 'La cuota debe ser un entero mayor a cero';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM encuestas WHERE id = p_encuesta_id AND organizacion_id = v_org
  ) THEN
    RAISE EXCEPTION 'Encuesta no encontrada en la organización';
  END IF;

  IF v_rol IN ('admin', 'gestor', 'superadmin') THEN
    IF NOT EXISTS (
      SELECT 1 FROM perfiles WHERE id = p_encuestador_id AND organizacion_id = v_org AND rol = 'encuestador'
    ) THEN
      RAISE EXCEPTION 'Encuestador no encontrado en la organización';
    END IF;
  ELSIF v_rol = 'coordinador' THEN
    IF NOT EXISTS (
      SELECT 1 FROM equipo_encuestadores ee
      JOIN equipo_coordinadores ec ON ec.equipo_id = ee.equipo_id
      WHERE ee.encuestador_id = p_encuestador_id AND ec.coordinador_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Ese encuestador no pertenece a tu equipo';
    END IF;
  ELSE
    RAISE EXCEPTION 'Rol no autorizado para fijar cuotas individuales';
  END IF;

  INSERT INTO cuotas_individuales (encuesta_id, encuestador_id, cuota, actualizado_en)
  VALUES (p_encuesta_id, p_encuestador_id, p_cuota, now())
  ON CONFLICT (encuesta_id, encuestador_id)
  DO UPDATE SET cuota = EXCLUDED.cuota, actualizado_en = now();
END;
$$;
