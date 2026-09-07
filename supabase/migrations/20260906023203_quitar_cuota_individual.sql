-- RPC quitar_cuota_individual — borra el override y vuelve a la cuota
-- general de config_muestreo. Misma autorización que set_cuota_individual.
--
-- Ver PLAN-tiempo-encuestas-y-mensajes.md, sección 6.
-- Rollback: 20260906023203_quitar_cuota_individual_rollback.sql

CREATE FUNCTION public.quitar_cuota_individual(
  p_encuesta_id uuid,
  p_encuestador_id uuid
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
    RAISE EXCEPTION 'Rol no autorizado para quitar cuotas individuales';
  END IF;

  DELETE FROM cuotas_individuales
  WHERE encuesta_id = p_encuesta_id AND encuestador_id = p_encuestador_id;
END;
$$;
