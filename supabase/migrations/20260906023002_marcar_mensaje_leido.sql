-- RPC marcar_mensaje_leido — marca una fila de mensajes_destinatarios como
-- leída. Aunque la policy de update de mensajes_destinatarios ya permite al
-- encuestador marcar sus propias filas directo con `.update()`, se ofrece
-- esta RPC para que el cliente no tenga que calcular now() y para dejar
-- server-side la validación de que la fila es propia.
--
-- Ver PLAN-tiempo-encuestas-y-mensajes.md, sección 2.
-- Rollback: 20260906023002_marcar_mensaje_leido_rollback.sql

CREATE FUNCTION public.marcar_mensaje_leido(p_destinatario_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE mensajes_destinatarios
  SET leido_en = now()
  WHERE id = p_destinatario_id AND encuestador_id = auth.uid() AND leido_en IS NULL;
END;
$$;
