-- Migración — columna idempotency_key en sesiones_respuesta
--
-- Base para el fix de idempotencia de guardar_encuesta_completa (ver
-- 20260906023101_guardar_encuesta_completa_idempotencia.sql). Nullable +
-- índice único parcial: las filas viejas (sin key) no compiten entre sí,
-- solo se exige unicidad cuando la key viene informada.
--
-- Ver PLAN-tiempo-encuestas-y-mensajes.md, sección 5 (Bug B).
-- Rollback: 20260906023100_sesiones_respuesta_idempotency_key_rollback.sql

alter table public.sesiones_respuesta
  add column idempotency_key uuid null;

create unique index sesiones_respuesta_idempotency_key_key
  on public.sesiones_respuesta (idempotency_key)
  where idempotency_key is not null;
