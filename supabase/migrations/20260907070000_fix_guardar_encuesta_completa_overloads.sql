-- Fix urgente — guardar_encuesta_completa() quedó con 3 overloads ambiguos
--
-- Las migraciones 20260906022901 y 20260906023101 agregaron parámetros
-- (p_iniciada_en, después p_idempotency_key) asumiendo que "CREATE OR
-- REPLACE alcanza, no cambia la identidad de la función" — eso es correcto
-- solo cuando la lista de parámetros es idéntica. Agregar un parámetro
-- cambia la firma, así que cada CREATE OR REPLACE creó una función nueva en
-- vez de reemplazar la anterior. Quedaron las tres coexistiendo:
--   guardar_encuesta_completa(uuid,numeric,numeric,jsonb,text,uuid,uuid)
--   guardar_encuesta_completa(uuid,numeric,numeric,jsonb,text,uuid,uuid,timestamptz)
--   guardar_encuesta_completa(uuid,numeric,numeric,jsonb,text,uuid,uuid,timestamptz,uuid)
--
-- Como las tres comparten los mismos 7 nombres de parámetro iniciales, todo
-- llamado por notación con nombres (como hace supabase-js) que no incluya
-- p_idempotency_key es ambiguo para Postgres → "function ... is not
-- unique". Confirmado en prod el 7/sep/2026: la app ya instalada (que llama
-- sin p_idempotency_key) no puede guardar ninguna encuesta.
--
-- Fix: dejar una sola función (la más nueva, con p_iniciada_en y
-- p_idempotency_key, ambos con default null) y borrar las dos anteriores.
-- Es un superset compatible: default null en ambos parámetros nuevos
-- reproduce el comportamiento de las versiones viejas. No toca datos —
-- solo definiciones de función.
--
-- Rollback: 20260907070000_fix_guardar_encuesta_completa_overloads_rollback.sql
-- (recrea las dos firmas viejas — no hace falta en la práctica porque la
-- que sobrevive es un superset, pero se deja por si hace falta volver atrás
-- a ciegas).

drop function if exists public.guardar_encuesta_completa(
  uuid, numeric, numeric, jsonb, text, uuid, uuid
);

drop function if exists public.guardar_encuesta_completa(
  uuid, numeric, numeric, jsonb, text, uuid, uuid, timestamptz
);
