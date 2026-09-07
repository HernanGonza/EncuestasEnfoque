-- Cuota individual por encuestador (override de config_muestreo.cuota_por_encuestador)
--
-- Se guarda por (encuesta_id, encuestador_id) y NO por asignacion_id: un
-- mismo encuestador puede tener varias filas en asignaciones_encuesta (una
-- por zona) dentro de la misma encuesta, y la cuota es a nivel encuesta —
-- mismo criterio que get_estado_encuesta_callejera ya usa al sumar
-- v_todas_asignaciones.
--
-- No tiene policies de insert/update/delete: todo pasa por las RPCs
-- set_cuota_individual / quitar_cuota_individual (security definer), que
-- validan el rol y la pertenencia al equipo antes de tocar la tabla.
--
-- Ver PLAN-tiempo-encuestas-y-mensajes.md, sección 6.
-- Rollback: 20260906023200_cuotas_individuales_tabla_rollback.sql

CREATE TABLE public.cuotas_individuales (
  encuesta_id     uuid NOT NULL REFERENCES public.encuestas(id) ON DELETE CASCADE,
  encuestador_id  uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
  cuota           integer NOT NULL CHECK (cuota > 0),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (encuesta_id, encuestador_id)
);

ALTER TABLE public.cuotas_individuales ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier miembro de la organización dueña de la encuesta (admin,
-- gestor, superadmin, coordinador) puede ver los overrides; el propio
-- encuestador también puede ver el suyo (para debug/soporte, no se expone
-- en la UI móvil ya que no lo necesita — ver punto 4 del plan).
CREATE POLICY "ver cuotas individuales de la propia organizacion"
  ON public.cuotas_individuales FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.encuestas e
      WHERE e.id = cuotas_individuales.encuesta_id
        AND e.organizacion_id = mi_organizacion()
    )
    OR encuestador_id = auth.uid()
  );
