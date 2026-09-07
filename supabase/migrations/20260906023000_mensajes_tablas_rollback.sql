-- Rollback de 20260906023000_mensajes_tablas.sql

drop policy if exists "encuestador marca sus propios mensajes como leidos" on public.mensajes_destinatarios;
drop policy if exists "encuestador ve sus propios destinatarios" on public.mensajes_destinatarios;
drop policy if exists "encuestador ve mensajes que le llegaron" on public.mensajes;

drop index if exists public.idx_mensajes_destinatarios_encuestador;

drop table if exists public.mensajes_destinatarios;
drop table if exists public.mensajes;
