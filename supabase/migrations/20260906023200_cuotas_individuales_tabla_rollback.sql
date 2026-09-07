-- Rollback de 20260906023200_cuotas_individuales_tabla.sql

DROP POLICY IF EXISTS "ver cuotas individuales de la propia organizacion" ON public.cuotas_individuales;
DROP TABLE IF EXISTS public.cuotas_individuales;
