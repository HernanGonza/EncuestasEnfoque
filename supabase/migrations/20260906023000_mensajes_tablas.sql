-- Migración — tablas base de "mensajes a pantalla completa"
--
-- mensajes: un registro por envío (admin/gestor/coordinador → destinatarios).
-- mensajes_destinatarios: fan-out, una fila por destinatario, creada al
-- momento del envío (si el encuestador cambia de equipo después, no afecta
-- la entrega ya hecha — la fila queda igual).
--
-- Nadie inserta directo en ninguna de las dos tablas: todo pasa por la RPC
-- enviar_mensaje_encuestadores (ver 20260906023001_enviar_mensaje_encuestadores.sql),
-- que corre como security definer y resuelve destinatarios en el momento.
-- El encuestador solo puede leer sus propios mensajes y marcar sus propias
-- filas de mensajes_destinatarios como leídas.
--
-- Ver PLAN-tiempo-encuestas-y-mensajes.md, sección 2.
-- Rollback: 20260906023000_mensajes_tablas_rollback.sql

create table public.mensajes (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones(id),
  remitente_id    uuid not null references public.perfiles(id),
  titulo          text not null,
  texto           text not null,
  creado_en       timestamptz not null default now()
);

create table public.mensajes_destinatarios (
  id              uuid primary key default gen_random_uuid(),
  mensaje_id      uuid not null references public.mensajes(id) on delete cascade,
  encuestador_id  uuid not null references public.perfiles(id),
  leido_en        timestamptz null
);

-- Para el query de "pendientes" al loguear/reanudar y el filtro del canal
-- Realtime (encuestador_id=eq.<uid>).
create index idx_mensajes_destinatarios_encuestador on public.mensajes_destinatarios(encuestador_id);

alter table public.mensajes enable row level security;
alter table public.mensajes_destinatarios enable row level security;

create policy "encuestador ve mensajes que le llegaron"
  on public.mensajes for select
  using (
    exists (
      select 1 from public.mensajes_destinatarios md
      where md.mensaje_id = mensajes.id and md.encuestador_id = auth.uid()
    )
  );

create policy "encuestador ve sus propios destinatarios"
  on public.mensajes_destinatarios for select
  using (encuestador_id = auth.uid());

create policy "encuestador marca sus propios mensajes como leidos"
  on public.mensajes_destinatarios for update
  using (encuestador_id = auth.uid())
  with check (encuestador_id = auth.uid());
