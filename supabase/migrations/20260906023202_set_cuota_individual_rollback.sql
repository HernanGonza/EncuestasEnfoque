-- Rollback de 20260906023202_set_cuota_individual.sql

DROP FUNCTION IF EXISTS public.set_cuota_individual(uuid, uuid, integer);
