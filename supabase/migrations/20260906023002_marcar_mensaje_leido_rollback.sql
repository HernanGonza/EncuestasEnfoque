-- Rollback de 20260906023002_marcar_mensaje_leido.sql

DROP FUNCTION IF EXISTS public.marcar_mensaje_leido(uuid);
