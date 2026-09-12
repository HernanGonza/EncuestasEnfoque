-- Rollback de 20260912120000_encuestas_subdominio.sql

alter table public.encuestas drop constraint if exists encuestas_subdominio_formato;
alter table public.encuestas drop column if exists subdominio;
