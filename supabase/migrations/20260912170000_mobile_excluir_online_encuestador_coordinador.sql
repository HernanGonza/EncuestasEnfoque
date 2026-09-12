-- Migración — las encuestas online nunca deben llegar a encuestador/coordinador
--
-- Estructuralmente ya era imposible (get_encuestas_encuestador y
-- auto_asignar_encuestador solo recorren encuesta_zonas/equipo_encuestadores,
-- y una encuesta online nunca tiene zona ni equipo) — se agrega el filtro
-- explícito igual, a pedido, como defensa en profundidad por si en el
-- futuro alguien linkea una encuesta online a un equipo por error.
--
-- El otro lado del pedido (que gestor tampoco vea encuestas online, aunque
-- comparte las mismas pantallas que admin en el mobile) se resolvió en
-- metr1ka-app/app/(admin)/encuestas.tsx y (coordinador)/encuestas.tsx
-- directamente, no acá — ahí sí hacía falta un cambio real.
--
-- Rollback: 20260912170000_mobile_excluir_online_encuestador_coordinador_rollback.sql

create or replace function public.get_encuestas_encuestador()
 returns table(id uuid, nombre text, descripcion text, tipo_encuesta text, estado_produccion text, config_muestreo jsonb, asignacion_id uuid, zona_id uuid, zona_nombre text, zona_geojson jsonb, geofencing_activo boolean, equipo_id uuid, fecha_inicio date, fecha_fin date, todas_las_zonas jsonb)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_rol rol_tipo := mi_rol();
begin
  if v_rol = 'coordinador' then
    return query
    select distinct on (e.id)
      e.id, e.nombre, e.descripcion, e.tipo_encuesta::text,
      e.estado_produccion::text, e.config_muestreo,
      null::uuid, ez.id, ez.nombre, ez.area_geojson, ez.geofencing_activo, ez.equipo_id,
      e.fecha_inicio, e.fecha_fin,
      (
        select jsonb_agg(jsonb_build_object(
          'asignacion_id', null,
          'zona_id', ez2.id,
          'zona_nombre', ez2.nombre,
          'zona_geojson', ez2.area_geojson
        ) order by ez2.nombre)
        from encuesta_zonas ez2
        where ez2.encuesta_id = e.id
          and ez2.equipo_id in (
            select ec.equipo_id from equipo_coordinadores ec where ec.coordinador_id = auth.uid()
          )
      ) as todas_las_zonas
    from equipo_coordinadores ec
    join encuesta_zonas ez on ez.equipo_id = ec.equipo_id
    join encuestas e on e.id = ez.encuesta_id
    where ec.coordinador_id = auth.uid()
      and e.estado_produccion = 'publicada'::estado_produccion_tipo
      and e.tipo_encuesta <> 'online'::tipo_encuesta_tipo
      and (e.fecha_inicio is null or e.fecha_inicio <= current_date)
      and (e.fecha_fin    is null or e.fecha_fin    >= current_date)
    order by e.id, ez.orden;
  else
    return query
    select distinct on (e.id)
      e.id, e.nombre, e.descripcion, e.tipo_encuesta::text,
      e.estado_produccion::text, e.config_muestreo,
      ae.id, ez.id, ez.nombre, ez.area_geojson, ez.geofencing_activo, ez.equipo_id,
      e.fecha_inicio, e.fecha_fin,
      (
        select jsonb_agg(jsonb_build_object(
          'asignacion_id', ae2.id,
          'zona_id', ez2.id,
          'zona_nombre', ez2.nombre,
          'zona_geojson', ez2.area_geojson
        ) order by ez2.nombre)
        from asignaciones_encuesta ae2
        join encuesta_zonas ez2 on ez2.id = ae2.encuesta_zona_id
        where ae2.encuestador_id = auth.uid()
          and ae2.activo = true
          and ez2.encuesta_id = e.id
      ) as todas_las_zonas
    from equipo_encuestadores ee
    join (
      select encuestas_equipo.encuesta_id, encuestas_equipo.equipo_id from encuestas_equipo
      union
      select encuesta_zonas.encuesta_id, encuesta_zonas.equipo_id from encuesta_zonas where encuesta_zonas.equipo_id is not null
    ) eet on eet.equipo_id = ee.equipo_id
    join encuestas e on e.id = eet.encuesta_id
    left join encuesta_zonas ez on ez.encuesta_id = e.id and ez.equipo_id = ee.equipo_id
    left join asignaciones_encuesta ae on ae.encuesta_zona_id = ez.id and ae.encuestador_id = auth.uid() and ae.activo = true
    where ee.encuestador_id = auth.uid()
      and e.estado_produccion = 'publicada'::estado_produccion_tipo
      and e.tipo_encuesta <> 'online'::tipo_encuesta_tipo
      and (e.fecha_inicio is null or e.fecha_inicio <= current_date)
      and (e.fecha_fin    is null or e.fecha_fin    >= current_date)
    order by e.id, ae.id nulls last, ez.orden;
  end if;
end;
$function$;

create or replace function public.auto_asignar_encuestador()
 returns table(zona_id uuid, asignacion_id uuid, es_nueva boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_encuestador_id uuid := auth.uid();
  v_zona           record;
  v_asignacion_id  uuid;
  v_es_nueva       boolean;
BEGIN
  FOR v_zona IN
    SELECT ez.id AS zona_id, ez.encuesta_id
    FROM equipo_encuestadores ee
    JOIN encuesta_zonas ez ON ez.equipo_id = ee.equipo_id
    JOIN encuestas e       ON e.id = ez.encuesta_id
    WHERE ee.encuestador_id = v_encuestador_id
      AND e.estado_produccion = 'publicada'
      AND e.tipo_encuesta <> 'online'
      AND (e.fecha_inicio IS NULL OR e.fecha_inicio <= CURRENT_DATE)
      AND (e.fecha_fin    IS NULL OR e.fecha_fin    >= CURRENT_DATE)
  LOOP
    IF EXISTS (
      SELECT 1 FROM asignaciones_encuesta ae
      JOIN encuesta_zonas ez2 ON ez2.id = ae.encuesta_zona_id
      WHERE ae.encuestador_id = v_encuestador_id
        AND ez2.encuesta_id = v_zona.encuesta_id
        AND ae.activo = true
    ) THEN
      SELECT id INTO v_asignacion_id
      FROM asignaciones_encuesta
      WHERE encuestador_id   = v_encuestador_id
        AND encuesta_zona_id = v_zona.zona_id
        AND activo = true
      LIMIT 1;

      IF v_asignacion_id IS NOT NULL THEN
        zona_id       := v_zona.zona_id;
        asignacion_id := v_asignacion_id;
        es_nueva      := false;
        RETURN NEXT;
      END IF;
      CONTINUE;
    END IF;

    SELECT id INTO v_asignacion_id
    FROM asignaciones_encuesta
    WHERE encuestador_id   = v_encuestador_id
      AND encuesta_zona_id = v_zona.zona_id
      AND activo = true
    LIMIT 1;

    IF v_asignacion_id IS NULL THEN
      INSERT INTO asignaciones_encuesta (encuestador_id, encuesta_zona_id, activo)
      VALUES (v_encuestador_id, v_zona.zona_id, true)
      RETURNING id INTO v_asignacion_id;
      v_es_nueva := true;
    ELSE
      v_es_nueva := false;
    END IF;

    zona_id       := v_zona.zona_id;
    asignacion_id := v_asignacion_id;
    es_nueva      := v_es_nueva;
    RETURN NEXT;
  END LOOP;
END;
$function$;
