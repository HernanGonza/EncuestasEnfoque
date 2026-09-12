-- Migración — encuestas.subdominio
--
-- Primer paso del plan de encuestas online: cada encuesta tipo_encuesta =
-- 'online' se publica en <subdominio>.metr1ka.com (DNS wildcard ya
-- configurado del lado de Vercel/registro). El superadmin lo asigna al
-- armar la encuesta en el constructor separado (EncuestaBuilderOnline.jsx).
--
-- Se guarda en `encuestas` (no en `organizaciones`) porque el subdominio es
-- por encuesta: una organización puede reciclarlo para su próxima encuesta
-- online una vez cerrada la anterior, sin quedar atado 1:1 a la org.
--
-- Formato: solo minúsculas/números/guiones, sin guion inicial, 1 a 63
-- caracteres (límite de un label DNS). Único en toda la plataforma.
--
-- Rollback: 20260912120000_encuestas_subdominio_rollback.sql

alter table public.encuestas
  add column subdominio text unique;

alter table public.encuestas
  add constraint encuestas_subdominio_formato
  check (subdominio is null or subdominio ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$');

comment on column public.encuestas.subdominio is
  'Subdominio público (sin ".metr1ka.com") para encuestas tipo_encuesta = online. Asignado por el superadmin. Único en toda la plataforma.';
