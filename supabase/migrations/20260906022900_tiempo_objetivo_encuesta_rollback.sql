-- Rollback de 20260906022900_tiempo_objetivo_encuesta.sql

alter table public.encuestas
  drop column if exists tiempo_objetivo_minutos;
