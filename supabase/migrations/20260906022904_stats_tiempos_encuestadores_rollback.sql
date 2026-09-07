-- Rollback de 20260906022904_stats_tiempos_encuestadores.sql
-- Función nueva, aditiva: el rollback es simplemente borrarla.

DROP FUNCTION IF EXISTS public.get_stats_tiempos_encuestadores(uuid);
