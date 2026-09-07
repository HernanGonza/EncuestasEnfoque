-- Rollback de 20260906023100_sesiones_respuesta_idempotency_key.sql

drop index if exists public.sesiones_respuesta_idempotency_key_key;
alter table public.sesiones_respuesta drop column if exists idempotency_key;
