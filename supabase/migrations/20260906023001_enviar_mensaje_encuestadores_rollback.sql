-- Rollback de 20260906023001_enviar_mensaje_encuestadores.sql

DROP FUNCTION IF EXISTS public.enviar_mensaje_encuestadores(text, text, text, uuid, uuid);
