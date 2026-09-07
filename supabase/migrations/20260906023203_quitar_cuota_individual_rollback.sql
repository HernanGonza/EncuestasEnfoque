-- Rollback de 20260906023203_quitar_cuota_individual.sql

DROP FUNCTION IF EXISTS public.quitar_cuota_individual(uuid, uuid);
