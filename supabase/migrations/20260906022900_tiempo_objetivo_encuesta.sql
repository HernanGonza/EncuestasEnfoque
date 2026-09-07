-- Migración — encuestas.tiempo_objetivo_minutos
--
-- Columna nueva para configurar, por encuesta (no por encuestador), cuánto
-- debería tardar en promedio completarse una encuesta. `null` = sin objetivo
-- configurado, no se muestra ninguna alerta de tiempo ni en el panel ni en
-- la app. Ver PLAN-tiempo-encuestas-y-mensajes.md, sección 1.
--
-- Cambio aditivo, no rompe nada existente.
-- Rollback: 20260906022900_tiempo_objetivo_encuesta_rollback.sql

alter table public.encuestas
  add column if not exists tiempo_objetivo_minutos integer null;
