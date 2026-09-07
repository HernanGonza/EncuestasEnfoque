import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from "react";
import { supabase } from "../../lib/supabase";
import { Spinner, ConfirmDialog } from "../../components/ui";
import { puntoInicioAleatorio } from "./MapaManzanas";

const CONFIG_DEFAULT = {
  intervalo_salto: 2,
  tipo_reemplazo: "inmediato",
  max_intentos: 2,
  sentido_recorrido: "horario",
  cuota_por_manzana: 10,
  // Antes esto no estaba en el default: el slider de "Cuota por encuestador"
  // mostraba "50" con el fallback `config.cuota_por_encuestador || 50`, pero
  // si el admin nunca arrastraba el control ese valor jamás se guardaba en
  // encuestas.config_muestreo. get_estado_encuesta_callejera() entonces caía
  // al fallback siguiente (cuota_por_manzana, un número distinto y sin
  // relación) y el encuestador veía una cuota que nadie configuró a propósito.
  cuota_por_encuestador: 50,
  casas_por_lado: 10, // estimado de casas por lado de manzana para calcular navegación
  razon_no_respuesta_extra: [],
};

// ════════════════════════════════════════════════
// HELPER: Comparar GeoJSON para detectar cambios
// ════════════════════════════════════════════════
function sonIgualesGeoJSON(a, b) {
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

async function initMapLibs() {
  const L = (await import("leaflet")).default;
  await import("leaflet/dist/leaflet.css");
  await import("@geoman-io/leaflet-geoman-free");
  await import("@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css");
  return L;
}

async function fetchCatastro(bounds, typeName) {
  const { south, west, north, east } = bounds;
  const { data, error } = await supabase.functions.invoke("catastro-proxy", {
    method: "POST",
    body: { bbox: { south, west, north, east }, typeName },
  });
  if (error) throw new Error(error.message || `Error al cargar ${typeName}`);
  if (!data?.features) throw new Error(`Respuesta inválida para ${typeName}`);
  return data.features || [];
}

async function fetchManzanasCatastro(bounds) {
  const features = await fetchCatastro(bounds, "mapa:manzanas");
  if (!features.length)
    throw new Error("No se encontraron manzanas en esta zona");
  console.log(
    "[catastro] Primer feature recibido:",
    JSON.stringify(features[0]?.properties),
  );
  return features;
}

async function fetchParcelasCatastro(bounds) {
  try {
    return await fetchCatastro(bounds, "mapa:parcela_urbana");
  } catch {
    return [];
  }
}

function getExteriorRing(geom) {
  if (!geom) return null;
  const g = geom.geometry || geom;
  if (g.type === "Polygon") return g.coordinates?.[0] || null;
  if (g.type === "MultiPolygon") return g.coordinates?.[0]?.[0] || null;
  return null;
}

function getCentroid(f) {
  const ring = getExteriorRing(f);
  if (!ring?.length) return null;
  const pts = ring.filter(
    (c) =>
      Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number",
  );
  if (pts.length < 3) return null;
  return [
    pts.reduce((s, c) => s + c[0], 0) / pts.length,
    pts.reduce((s, c) => s + c[1], 0) / pts.length,
  ];
}

function pointInRing(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function filtrarDentroDeZona(features, zonaGeoJSON) {
  const zonaFeat =
    zonaGeoJSON?.type === "FeatureCollection"
      ? zonaGeoJSON.features?.[0]
      : zonaGeoJSON;
  const zonaRing = getExteriorRing(zonaFeat);
  if (!zonaRing || zonaRing.length < 3) {
    console.warn("[filtrar] Sin anillo de zona válido, devolviendo todas");
    return features;
  }
  return features.filter((f) => {
    try {
      const c = getCentroid(f);
      if (!c) return false;
      return pointInRing(c[0], c[1], zonaRing);
    } catch {
      return false;
    }
  });
}

// ════════════════════════════════════════════════
// MAPA COMPLETO — todas las zonas con encuestadores
// ════════════════════════════════════════════════
function MapaCompleto({ zonas, fullSize = false }) {
  const mapRef = useRef(null);
  const instRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!mapRef.current) return;
      const L = await initMapLibs();
      if (!mounted) return;

      if (!instRef.current) {
        instRef.current = L.map(mapRef.current, {
          zoomControl: false,
          attributionControl: false,
        }).setView([-27.37, -55.9], 13);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
        }).addTo(instRef.current);
      }

      // Limpiar layers anteriores excepto tiles
      instRef.current.eachLayer((l) => {
        if (!(l instanceof L.TileLayer)) {
          try {
            instRef.current.removeLayer(l);
          } catch {}
        }
      });

      const bounds = [];

      zonas.forEach((zona) => {
        if (!zona.geojson?.features) return;
        const zonaFeat = zona.geojson.features.find(
          (f) => f.properties?.tipo === "zona",
        );
        if (!zonaFeat) return;

        // Polígono de la zona
        L.geoJSON(zonaFeat, {
          style: {
            color: zona.color,
            fillColor: zona.color,
            fillOpacity: 0.12,
            weight: 2,
          },
        }).addTo(instRef.current);

        // Manzanas seleccionadas
        const manzanasSel = (zona.geojson.features || []).filter(
          (f) =>
            f.properties?.tipo === "manzana" &&
            f.properties?.seleccionada === true,
        );
        if (manzanasSel.length > 0) {
          L.geoJSON(
            { type: "FeatureCollection", features: manzanasSel },
            {
              style: {
                color: zona.color,
                fillColor: zona.color,
                fillOpacity: 0.4,
                weight: 1.5,
              },
            },
          ).addTo(instRef.current);
        }

        // Centroide para encuestadores
        const coords = zonaFeat.geometry?.coordinates?.[0];
        if (coords?.length) {
          const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
          const lng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
          bounds.push([lat, lng]);

          // Marker de la zona con nombre
          const icono = L.divIcon({
            className: "",
            html: `<div style="background:${zona.color};color:#fff;border-radius:100px;padding:2px 7px;font-size:9px;font-weight:700;font-family:DM Sans,sans-serif;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.3);border:1.5px solid #fff">${zona.nombre}</div>`,
            iconAnchor: [0, 8],
          });
          L.marker([lat, lng], { icon: icono, interactive: false }).addTo(
            instRef.current,
          );

          // Markers de encuestadores
          (zona.encuestadores || []).forEach((nombre, i) => {
            const offsetLat =
              (i - (zona.encuestadores.length - 1) / 2) * 0.0004;
            const iconoEnc = L.divIcon({
              className: "",
              html: `<div style="background:rgba(255,255,255,.92);color:${zona.color};border:1.5px solid ${zona.color};border-radius:100px;padding:2px 6px;font-size:9px;font-weight:700;font-family:DM Sans,sans-serif;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.2)">👤 ${nombre.split(" ")[0]}</div>`,
              iconAnchor: [0, 8],
            });
            L.marker([lat + offsetLat - 0.0008, lng], {
              icon: iconoEnc,
              interactive: false,
            }).addTo(instRef.current);
          });
        }
      });

      if (bounds.length > 0) {
        instRef.current.fitBounds(L.latLngBounds(bounds), {
          padding: [20, 20],
          maxZoom: 14,
        });
        setTimeout(() => {
          if (instRef.current) instRef.current.invalidateSize();
        }, 100);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [zonas]);

  useEffect(
    () => () => {
      if (instRef.current) {
        instRef.current.remove();
        instRef.current = null;
      }
    },
    [],
  );

  return (
    <div
      ref={mapRef}
      style={{
        height: fullSize ? "100%" : 180,
        flex: fullSize ? 1 : undefined,
        borderRadius: "var(--r)",
        border: "1px solid var(--border)",
        overflow: "hidden",
      }}
    />
  );
}

// ════════════════════════════════════════════════
// MAPA EMBEBIDO
// ════════════════════════════════════════════════
const MapaZona = forwardRef(function MapaZona(
  {
    encuestaId,
    zonaActual,
    manzanasSeleccionadas,
    onZonaChange,
    onManzanasChange,
    sinManzanas = false,
    colorZona = "#1a472a",
    todasLasZonas = [],
    encuestadoresAsignados = [], // [{ id, nombre }]
  },
  ref,
) {
  const mapRef = useRef(null);
  const mapInst = useRef(null);
  const Lref = useRef(null);
  const zonaRef = useRef(null);
  const manzGrpRef = useRef(null);
  const encGrpRef = useRef(null); // capa de encuestadores
  const manzFeatRef = useRef([]); // features del catastro en memoria
  const parcelaRef = useRef([]); // parcelas del catastro en memoria
  const dragTimerRef = useRef(null); // debounce post-drag
  const selRef = useRef(
    new Set(manzanasSeleccionadas?.map((f) => f.properties?.gid || f.id) || []),
  );

  const [listo, setListo] = useState(false);
  const [modo, setModo] = useState("idle");
  const [loading, setLoading] = useState(false);
  const [errorMap, setErrorMap] = useState("");
  const [nManz, setNManz] = useState(0);
  const [nSel, setNSel] = useState(selRef.current.size);

  // Capa de pins de encuestadores asignados
  const pinsEncRef = useRef(null);

  // Actualizar pins de encuestadores cuando cambian las asignaciones o el mapa está listo
  useEffect(() => {
    const L = Lref.current;
    const map = mapInst.current;
    if (!L || !map) return;

    // Limpiar pins anteriores
    if (pinsEncRef.current) {
      map.removeLayer(pinsEncRef.current);
      pinsEncRef.current = null;
    }
    if (!encuestadoresAsignados.length) return;

    // Calcular centroide — desde zonaRef o desde zonaActual prop
    let centroide = null;
    const zonaFeat = zonaRef.current?.toGeoJSON?.();
    if (zonaFeat) {
      centroide = getCentroid(zonaFeat);
    }
    if (!centroide && zonaActual?.features) {
      const zf = zonaActual.features.find((f) => f.properties?.tipo === "zona");
      if (zf) centroide = getCentroid(zf);
    }
    if (!centroide) return;

    const grupo = L.layerGroup();
    const n = encuestadoresAsignados.length;

    encuestadoresAsignados.forEach((enc, i) => {
      // Distribuir pins en círculo alrededor del centroide
      const angulo = (2 * Math.PI * i) / Math.max(n, 1);
      const radio = n > 1 ? 0.00015 : 0;
      const lat = centroide[1] + radio * Math.cos(angulo);
      const lng = centroide[0] + radio * Math.sin(angulo);

      const iniciales = enc.nombre
        .split(" ")
        .map((p) => p[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
      const icono = L.divIcon({
        className: "",
        html: `<div style="
          width:32px;height:32px;border-radius:50%;
          background:${colorZona};color:#fff;
          display:flex;align-items:center;justify-content:center;
          font-weight:800;font-size:12px;font-family:DM Sans,sans-serif;
          border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);
          cursor:default;
        ">${iniciales}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
      L.marker([lat, lng], { icon: icono })
        .bindTooltip(enc.nombre, {
          permanent: false,
          direction: "top",
          offset: [0, -18],
        })
        .addTo(grupo);
    });

    grupo.addTo(map);
    pinsEncRef.current = grupo;
  }, [encuestadoresAsignados, listo]);

  // Exponer getZonaActual al padre via ref
  useImperativeHandle(ref, () => ({
    getZonaActual: () => {
      if (!zonaRef.current) return null;
      const zonaFeat = zonaRef.current.toGeoJSON?.();
      if (!zonaFeat) return null;
      const manzanas = [];
      if (manzGrpRef.current) {
        manzGrpRef.current.eachLayer((l) => {
          if (l.feature) manzanas.push(l.feature);
        });
      }
      const features = [];
      features.push({
        ...zonaFeat,
        properties: { ...zonaFeat.properties, tipo: "zona" },
      });
      manzanas.forEach((f) => {
        const canonId = f.properties?.gid ?? f.properties?.id;
        features.push({
          ...f,
          properties: {
            ...f.properties,
            tipo: "manzana",
            seleccionada:
              canonId !== undefined ? selRef.current.has(canonId) : false,
          },
        });
      });
      // Parcelas no se incluyen — las maneja guardar-parcelas edge function
      return { type: "FeatureCollection", features };
    },
  }));

  useEffect(() => {
    let mounted = true;
    async function setup() {
      if (!mapRef.current || mapInst.current) return;
      const L = await initMapLibs();
      if (!mounted) return;
      Lref.current = L;

      const map = L.map(mapRef.current, {
        center: [-27.3671, -55.8974],
        zoom: 13,
        preferCanvas: true,
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
        maxZoom: 19,
      }).addTo(map);

      map.pm.setLang("es");
      map.pm.setGlobalOptions({
        snappable: true,
        allowSelfIntersection: false,
        pathOptions: {
          color: "#1a472a",
          fillColor: "#1a472a",
          fillOpacity: 0.1,
          weight: 2,
        },
      });
      map.pm.removeControls({
        drawMarker: true,
        drawCircle: true,
        drawRectangle: true,
        drawPolyline: true,
        drawCircleMarker: true,
        cutPolygon: true,
        editMode: true,
        dragMode: true,
        removalMode: true,
        rotateMode: true,
      });

      if (zonaActual?.features) {
        const zonaFeat = zonaActual.features.find(
          (f) => f.properties?.tipo === "zona",
        );
        const manzFeat = zonaActual.features.filter(
          (f) => f.properties?.tipo === "manzana",
        );
        if (zonaFeat) {
          const zl = L.geoJSON(zonaFeat, {
            style: {
              color: "#1a472a",
              fillColor: "#1a472a",
              fillOpacity: 0.08,
              weight: 2,
              dashArray: "8,5",
            },
          }).addTo(map);
          zonaRef.current = zl.getLayers()[0];
          map.fitBounds(zl.getBounds(), { padding: [30, 30] });
          _activarDragEnZona(zonaRef.current, L, map);
        }
        if (manzFeat.length > 0) {
          const idsSel = new Set(
            manzFeat
              .filter((f) => f.properties?.seleccionada === true)
              .map((f) => f.properties?.gid ?? f.properties?.id)
              .filter((id) => id !== undefined),
          );
          manzFeatRef.current = manzFeat;
          selRef.current = idsSel;
          setNSel(idsSel.size);
          renderManzanas(L, map, manzFeat, idsSel);
          setNManz(manzFeat.length);

          // Las parcelas se guardan por la edge function guardar-parcelas, no hace falta fetchear aquí
        }
      }

      map.on("pm:create", async (e) => {
        if (!mounted) return;
        if (zonaRef.current && map.hasLayer(zonaRef.current))
          map.removeLayer(zonaRef.current);
        if (manzGrpRef.current) {
          try {
            manzGrpRef.current.eachLayer((l) => {
              if (l?.pm) l.pm.disable();
            });
          } catch {}
          map.removeLayer(manzGrpRef.current);
          manzGrpRef.current = null;
        }
        e.layer.setStyle({
          color: "#1a472a",
          fillColor: "#1a472a",
          fillOpacity: 0.08,
          weight: 2,
          dashArray: "8,5",
        });
        zonaRef.current = e.layer;
        selRef.current = new Set();
        setNSel(0);
        setNManz(0);
        manzFeatRef.current = [];
        parcelaRef.current = [];
        _activarDragEnZona(e.layer, L, map);
        setModo("idle");
        await cargarManzanasAuto(L, map, e.layer);
      });
      map.on("pm:drawend", () => {
        if (mounted) setModo("idle");
      });
      map.on("pm:actioncancel", () => {
        if (mounted) setModo("idle");
      });

      mapInst.current = map;
      setListo(true);
      setTimeout(() => {
        if (mounted && mapInst.current) mapInst.current.invalidateSize();
      }, 100);
    }
    setup();
    return () => {
      mounted = false;
      if (dragTimerRef.current) clearTimeout(dragTimerRef.current);
      if (mapInst.current) {
        mapInst.current.off();
        mapInst.current.remove();
        mapInst.current = null;
      }
      zonaRef.current = null;
      manzGrpRef.current = null;
    };
  }, []);

  // ── Capa de encuestadores: un marcador por encuestador en el centroide de su zona ──
  useEffect(() => {
    const map = mapInst.current;
    const L = Lref.current;
    if (!map || !L || !listo) return;

    // Limpiar capa anterior
    if (encGrpRef.current) {
      try {
        map.removeLayer(encGrpRef.current);
      } catch {}
    }
    encGrpRef.current = null;

    const grp = L.layerGroup().addTo(map);
    encGrpRef.current = grp;

    todasLasZonas.forEach((zona) => {
      if (!zona.encuestadores?.length) return;
      // Calcular centroide de la zona a partir del geojson
      let lat = null,
        lng = null;
      try {
        const feats = zona.geojson?.features || [];
        const zonaFeat =
          feats.find((f) => f.properties?.tipo === "zona") || feats[0];
        if (zonaFeat?.geometry?.coordinates?.[0]) {
          const coords = zonaFeat.geometry.coordinates[0];
          lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
          lng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
        }
      } catch {}
      if (!lat || !lng) return;

      zona.encuestadores.forEach((nombre, i) => {
        // Offset pequeño para que no se superpongan si hay más de uno
        const offsetLat = (i - (zona.encuestadores.length - 1) / 2) * 0.0003;
        const icono = L.divIcon({
          className: "",
          html: `<div style="
            background:${zona.color};color:#fff;border-radius:100px;
            padding:3px 8px;font-size:10px;font-weight:700;font-family:DM Sans,sans-serif;
            white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.3);
            border:2px solid #fff;display:flex;align-items:center;gap:4px;
          ">
            <span style="font-size:9px">👤</span> ${nombre.split(" ")[0]}
          </div>`,
          iconAnchor: [0, 10],
        });
        L.marker([lat + offsetLat, lng], { icon: icono, interactive: false })
          .bindTooltip(
            `${nombre}<br><small style="color:#999">${zona.nombre}</small>`,
            { direction: "top" },
          )
          .addTo(grp);
      });
    });
  }, [todasLasZonas, listo]);

  // Activa drag en la capa zona y recarga manzanas 800ms después de soltar
  function _activarDragEnZona(layer, L, map) {
    if (!layer?.pm) return;
    layer.pm.enableLayerDrag();
    layer.on("pm:dragend", () => {
      if (dragTimerRef.current) clearTimeout(dragTimerRef.current);
      dragTimerRef.current = setTimeout(() => {
        cargarManzanasAuto(L || Lref.current, map || mapInst.current, layer);
      }, 800);
    });
  }

  function renderManzanas(L, map, features, selSet) {
    if (manzGrpRef.current) {
      // Deshabilitar pm en cada layer antes de remover para evitar error de classList con canvas renderer
      try {
        manzGrpRef.current.eachLayer((l) => {
          if (l?.pm) l.pm.disable();
        });
      } catch {}
      map.removeLayer(manzGrpRef.current);
      manzGrpRef.current = null;
    }
    const grp = L.geoJSON(features, {
      renderer: L.canvas(),
      pmIgnore: true,
      style: (f) =>
        estiloManzana(selSet.has(f.properties?.gid ?? f.properties?.id)),
      onEachFeature: (feature, layer) => {
        const id = feature.properties?.gid ?? feature.properties?.id;
        layer.on("click", () => {
          const next = new Set(selRef.current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          selRef.current = next;
          setNSel(next.size);
          grp.eachLayer((l) => {
            const lid = l.feature?.properties?.gid ?? l.feature?.properties?.id;
            if (lid !== undefined) l.setStyle(estiloManzana(next.has(lid)));
          });
          emitirCambio(features, next);
        });
        layer.on("mouseover", () => {
          if (!selRef.current.has(id))
            layer.setStyle({ ...estiloManzana(false), fillOpacity: 0.35 });
        });
        layer.on("mouseout", () => {
          layer.setStyle(estiloManzana(selRef.current.has(id)));
        });
      },
    }).addTo(map);
    manzGrpRef.current = grp;
  }

  async function cargarManzanasAuto(L, map, zonaLayer) {
    setLoading(true);
    setErrorMap("");
    try {
      const bounds = zonaLayer.getBounds();
      const latPad = (bounds.getNorth() - bounds.getSouth()) * 0.15;
      const lngPad = (bounds.getEast() - bounds.getWest()) * 0.15;
      const bbox = {
        south: bounds.getSouth() - latPad,
        west: bounds.getWest() - lngPad,
        north: bounds.getNorth() + latPad,
        east: bounds.getEast() + lngPad,
      };
      const zonaGeoJSON = zonaLayer.toGeoJSON();
      // Traemos manzanas para todos los tipos de encuesta
      const todasManzanas = await fetchManzanasCatastro(bbox);
      const manzanas = filtrarDentroDeZona(todasManzanas, zonaGeoJSON);
      if (!manzanas.length) {
        setErrorMap(
          `No se encontraron manzanas en la zona (el catastro devolvió ${todasManzanas.length})`,
        );
        setLoading(false);
        return;
      }
      manzFeatRef.current = manzanas;
      parcelaRef.current = [];
      selRef.current = new Set();
      setNSel(0);
      setNManz(manzanas.length);
      renderManzanas(L, map, manzanas, new Set());
      emitirCambioCompleto(zonaGeoJSON, manzanas, new Set());
    } catch (err) {
      setErrorMap(err.message);
    }
    setLoading(false);
  }

  function emitirCambio(manzanasFeatures, sel) {
    const zonaFeat = zonaRef.current?.toGeoJSON?.();
    emitirCambioCompleto(zonaFeat, manzanasFeatures, sel);
  }

  function emitirCambioCompleto(zonaFeat, manzanas, sel) {
    const features = [];
    if (zonaFeat)
      features.push({
        ...zonaFeat,
        properties: { ...zonaFeat.properties, tipo: "zona" },
      });
    manzanas.forEach((f) => {
      const canonId = f.properties?.gid ?? f.properties?.id;
      features.push({
        ...f,
        properties: {
          ...f.properties,
          tipo: "manzana",
          seleccionada: sel.has(canonId),
        },
      });
    });
    // Las parcelas NO se incluyen en el geojson local — las fetchea y guarda guardar-parcelas edge function
    const geojson = { type: "FeatureCollection", features };
    onZonaChange(geojson);
    onManzanasChange(
      manzanas.filter((f) => sel.has(f.properties?.gid ?? f.properties?.id)),
    );
  }

  function estiloManzana(sel) {
    return sel
      ? {
          color: "#1a472a",
          fillColor: "#1a472a",
          fillOpacity: 0.45,
          weight: 2.5,
        }
      : {
          color: "#64748b",
          fillColor: "#94a3b8",
          fillOpacity: 0.15,
          weight: 1.5,
        };
  }

  // ── Acciones toolbar ──

  function activarDibujar() {
    if (!mapInst.current) return;
    if (modo === "dibujando") {
      mapInst.current.pm.disableDraw("Polygon");
      setModo("idle");
      return;
    }
    if (modo === "editando") cancelarEdicion();
    mapInst.current.pm.enableDraw("Polygon", {
      allowSelfIntersection: false,
      snappable: true,
    });
    setModo("dibujando");
    setErrorMap("");
  }

  function activarEditar() {
    if (!mapInst.current || !zonaRef.current) return;
    if (modo === "editando") {
      cancelarEdicion();
      return;
    }
    if (modo === "dibujando") mapInst.current.pm.disableDraw("Polygon");
    if (zonaRef.current.pm?.enable) {
      zonaRef.current.pm.enable({ allowSelfIntersection: false });
    } else if (zonaRef.current.eachLayer) {
      zonaRef.current.eachLayer((l) =>
        l.pm?.enable?.({ allowSelfIntersection: false }),
      );
    }
    setModo("editando");
    setErrorMap("");
  }

  function cancelarEdicion() {
    if (!mapInst.current) return;
    if (zonaRef.current?.pm?.disable) zonaRef.current.pm.disable();
    else if (zonaRef.current?.eachLayer)
      zonaRef.current.eachLayer((l) => l.pm?.disable?.());
    mapInst.current.pm.disableDraw("Polygon");
    setModo("idle");
  }

  function borrarZona() {
    if (!mapInst.current) return;
    if (manzGrpRef.current) {
      try {
        manzGrpRef.current.eachLayer((l) => {
          if (l?.pm) l.pm.disable();
        });
      } catch {}
      mapInst.current.removeLayer(manzGrpRef.current);
      manzGrpRef.current = null;
    }
    if (zonaRef.current) {
      mapInst.current.removeLayer(zonaRef.current);
      zonaRef.current = null;
    }
    manzFeatRef.current = [];
    parcelaRef.current = [];
    selRef.current = new Set();
    setNManz(0);
    setNSel(0);
    setModo("idle");
    setErrorMap("");
    onZonaChange(null);
    onManzanasChange([]);
  }

  function seleccionarTodas() {
    if (!manzGrpRef.current || !manzFeatRef.current.length) return;
    const todos = new Set(
      manzFeatRef.current
        .map((f) => f.properties?.gid ?? f.properties?.id)
        .filter(Boolean),
    );
    selRef.current = todos;
    setNSel(todos.size);
    manzGrpRef.current.eachLayer((l) => {
      const lid = l.feature?.properties?.gid ?? l.feature?.properties?.id;
      if (lid !== undefined) l.setStyle(estiloManzana(true));
    });
    emitirCambio(manzFeatRef.current, todos);
  }

  function deseleccionarTodas() {
    if (!manzGrpRef.current) return;
    selRef.current = new Set();
    setNSel(0);
    manzGrpRef.current.eachLayer((l) => {
      const lid = l.feature?.properties?.gid ?? l.feature?.properties?.id;
      if (lid !== undefined) l.setStyle(estiloManzana(false));
    });
    emitirCambio(manzFeatRef.current, new Set());
  }

  async function recargarManzanas() {
    if (!zonaRef.current || !mapInst.current) return;
    await cargarManzanasAuto(Lref.current, mapInst.current, zonaRef.current);
  }

  const tieneZona =
    !!zonaRef.current ||
    !!zonaActual?.features?.find((f) => f.properties?.tipo === "zona");
  const todasSel = nManz > 0 && nSel === nManz;

  const btnT = (active, danger = false) => ({
    padding: "6px 13px",
    borderRadius: "var(--r)",
    cursor: "pointer",
    fontSize: 12,
    fontFamily: "DM Sans",
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: 5,
    transition: "all .15s",
    border: `1.5px solid ${danger ? "#fca5a5" : active ? "var(--accent)" : "var(--border2)"}`,
    background: danger
      ? "var(--danger-light)"
      : active
        ? "var(--accent)"
        : "var(--paper)",
    color: danger ? "#c0392b" : active ? "#fff" : "var(--ink)",
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        borderRadius: "var(--r2)",
        overflow: "hidden",
        border: "1px solid var(--border2)",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          padding: "8px 12px",
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
          flexShrink: 0,
        }}
      >
        {/* Grupo zona */}
        <button onClick={activarDibujar} style={btnT(modo === "dibujando")}>
          🖊️{" "}
          {modo === "dibujando"
            ? "Dibujando..."
            : tieneZona
              ? "Redibujar"
              : "Dibujar zona"}
        </button>
        {tieneZona && modo === "idle" && (
          <button onClick={activarEditar} style={btnT(false)}>
            ✏️ Editar
          </button>
        )}
        {tieneZona && modo === "idle" && (
          <button onClick={borrarZona} style={btnT(false, true)}>
            🗑️ Borrar zona
          </button>
        )}
        {modo === "editando" && (
          <>
            <button
              onClick={recargarManzanas}
              disabled={loading}
              style={{
                ...btnT(false),
                background: "var(--accent)",
                color: "#fff",
                borderColor: "var(--accent)",
              }}
            >
              {loading ? "⏳" : "🔄"} Recargar manzanas
            </button>
            <button
              onClick={cancelarEdicion}
              style={{ ...btnT(false), color: "var(--ink3)" }}
            >
              ESC
            </button>
          </>
        )}

        {/* Separador */}
        {nManz > 0 && (
          <div
            style={{
              width: 1,
              height: 20,
              background: "var(--border2)",
              margin: "0 2px",
            }}
          />
        )}

        {/* Grupo selección */}
        {nManz > 0 && !todasSel && (
          <button onClick={seleccionarTodas} style={btnT(false)}>
            ☑️ Todas
          </button>
        )}
        {nManz > 0 && nSel > 0 && (
          <button onClick={deseleccionarTodas} style={btnT(false)}>
            🔲 Ninguna
          </button>
        )}
        {nManz > 0 && (
          <span style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 600 }}>
            {nSel}/{nManz}
          </span>
        )}
      </div>

      {/* Banner instrucciones */}
      {modo !== "idle" && (
        <div
          style={{
            padding: "5px 12px",
            background: "var(--accent)",
            color: "#fff",
            fontSize: 11,
            fontWeight: 600,
            textAlign: "center",
            flexShrink: 0,
          }}
        >
          {modo === "dibujando" &&
            "🖊️ Clic para agregar puntos · Doble clic para cerrar · Las manzanas se cargan automáticamente"}
          {modo === "editando" &&
            "🔧 Arrastrá los puntos azules para editar · Arrastrá la zona para moverla (manzanas se actualizan al soltar)"}
        </div>
      )}

      {/* Mapa */}
      <div style={{ flex: 1, position: "relative" }}>
        {(!listo || loading) && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 5,
              background: "rgba(242,241,238,.9)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
            }}
          >
            <Spinner center size="lg" />
            {loading && (
              <span
                style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 500 }}
              >
                Cargando manzanas...
              </span>
            )}
          </div>
        )}
        <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
      </div>

      {/* Footer leyenda */}
      <div
        style={{
          padding: "6px 12px",
          background: "var(--paper)",
          borderTop: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexShrink: 0,
          minHeight: 32,
        }}
      >
        {nManz > 0 ? (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                color: "var(--ink3)",
              }}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  background: "#1a472a",
                  borderRadius: 2,
                }}
              />{" "}
              Seleccionada
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                color: "var(--ink3)",
              }}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  background: "#94a3b8",
                  borderRadius: 2,
                }}
              />{" "}
              Sin seleccionar
            </div>
            <span
              style={{ fontSize: 11, color: "var(--ink3)", marginLeft: "auto" }}
            >
              Arrastrá la zona para moverla · manzanas se actualizan solas
            </span>
          </>
        ) : (
          <span style={{ fontSize: 11, color: "var(--ink3)" }}>
            {tieneZona
              ? "Dibujá la zona para cargar manzanas"
              : "Dibujá el área para cargar las manzanas automáticamente"}
          </span>
        )}
        {errorMap && (
          <span
            style={{
              fontSize: 12,
              color: "var(--danger)",
              fontWeight: 500,
              marginLeft: "auto",
            }}
          >
            ⚠ {errorMap}
          </span>
        )}
      </div>
    </div>
  );
});
// ════════════════════════════════════════════════
// SELECTOR DE RAZONES
// ════════════════════════════════════════════════
function RazonesSelector({ organizacionId, seleccionadas, onChangeSel }) {
  const [razones, setRazones] = useState([]);
  const [nuevaRazon, setNuevaRazon] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!organizacionId) return;
    supabase
      .from("razones_no_respuesta")
      .select("id, label, organizacion_id")
      .or(`organizacion_id.eq.${organizacionId},organizacion_id.is.null`)
      .eq("activa", true)
      .order("orden")
      .then(({ data }) => setRazones(data || []));
  }, [organizacionId]);

  function toggle(id) {
    if (seleccionadas.includes(id))
      onChangeSel(seleccionadas.filter((x) => x !== id));
    else onChangeSel([...seleccionadas, id]);
  }

  async function agregarPersonalizada() {
    const label = nuevaRazon.trim();
    if (!label || !organizacionId) return;
    setSaving(true);
    const { data } = await supabase
      .from("razones_no_respuesta")
      .insert({
        organizacion_id: organizacionId,
        label,
        orden: razones.length + 1,
      })
      .select()
      .single();
    if (data) {
      setRazones((prev) => [...prev, data]);
      onChangeSel([...seleccionadas, data.id]);
    }
    setNuevaRazon("");
    setSaving(false);
  }

  const nSel = seleccionadas.length;
  const secStyle = {
    background: "var(--paper)",
    border: `1px solid ${nSel < 2 ? "#fca5a5" : "var(--border)"}`,
    borderRadius: "var(--r)",
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  };

  return (
    <div style={secStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>
          Razones de no-respuesta
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: nSel < 2 ? "#c0392b" : "var(--accent2)",
            background: nSel < 2 ? "#fef2f2" : "var(--accent-light)",
            padding: "2px 8px",
            borderRadius: 100,
          }}
        >
          {nSel} seleccionada{nSel !== 1 ? "s" : ""}{" "}
          {nSel < 2 ? "· mín. 2" : "✓"}
        </span>
      </div>
      <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: -6 }}>
        Seleccioná las que van a aparecer en la app cuando el encuestador
        registre una no-respuesta.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {razones.map((r) => {
          const sel = seleccionadas.includes(r.id);
          const esSistema = r.organizacion_id === null;
          return (
            <div
              key={r.id}
              onClick={() => toggle(r.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderRadius: "var(--r)",
                cursor: "pointer",
                border: `1.5px solid ${sel ? "var(--accent)" : "var(--border2)"}`,
                background: sel ? "var(--accent-light)" : "var(--paper)",
                transition: "all .15s",
              }}
            >
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  flexShrink: 0,
                  border: `2px solid ${sel ? "var(--accent)" : "var(--border2)"}`,
                  background: sel ? "var(--accent)" : "var(--paper)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {sel && (
                  <span
                    style={{ color: "#fff", fontSize: 10, fontWeight: 700 }}
                  >
                    ✓
                  </span>
                )}
              </div>
              <span
                style={{
                  flex: 1,
                  fontSize: 12,
                  color: sel ? "var(--accent2)" : "var(--ink2)",
                  fontWeight: sel ? 600 : 400,
                }}
              >
                {r.label}
              </span>
              {!esSistema && (
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    await supabase
                      .from("razones_no_respuesta")
                      .delete()
                      .eq("id", r.id);
                    setRazones((prev) => prev.filter((x) => x.id !== r.id));
                    onChangeSel(seleccionadas.filter((x) => x !== r.id));
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--danger)",
                    fontSize: 14,
                    padding: "0 2px",
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          value={nuevaRazon}
          onChange={(e) => setNuevaRazon(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && agregarPersonalizada()}
          placeholder="Agregar razón personalizada..."
          style={{
            flex: 1,
            padding: "6px 10px",
            border: "1.5px solid var(--border2)",
            borderRadius: "var(--r)",
            fontSize: 12,
            fontFamily: "DM Sans",
            outline: "none",
          }}
        />
        <button
          onClick={agregarPersonalizada}
          disabled={saving || !nuevaRazon.trim()}
          style={{
            padding: "6px 12px",
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            borderRadius: "var(--r)",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "DM Sans",
            opacity: !nuevaRazon.trim() ? 0.5 : 1,
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════
// PANEL CONFIG
// ════════════════════════════════════════════════
function PanelConfig({ config, onChange, organizacionId }) {
  const k = config.intervalo_salto || 2;
  function update(key, val) {
    onChange({ ...config, [key]: val });
  }
  const secStyle = {
    background: "var(--paper)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r)",
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  };
  const labelStyle = { fontSize: 13, fontWeight: 700, color: "var(--ink)" };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        height: "100%",
        overflowY: "auto",
        paddingRight: 2,
      }}
    >
      <div style={secStyle}>
        <div style={labelStyle}>Intervalo de salto (k = {k})</div>
        <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: -6 }}>
          Casas a saltar entre encuestas.
        </div>
        <input
          type="range"
          min={1}
          max={10}
          value={k}
          onChange={(e) => update("intervalo_salto", parseInt(e.target.value))}
          style={{ accentColor: "var(--accent)" }}
        />
        <div style={{ display: "flex", gap: 4 }}>
          {Array.from({ length: Math.min(k + 3, 8) }, (_, i) => {
            const enc = i === 0 || i === k + 1;
            return (
              <div
                key={i}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 4,
                  border: `2px solid ${enc ? "var(--accent)" : "var(--border2)"}`,
                  background: enc ? "var(--accent)" : "var(--paper)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  fontWeight: 700,
                  color: enc ? "#fff" : "var(--ink3)",
                }}
              >
                {enc ? "✔" : i + 1}
              </div>
            );
          })}
        </div>
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}
      >
        <div style={secStyle}>
          <div style={labelStyle}>Cuota / manzana</div>
          <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: -6 }}>
            Encuestas a tomar por manzana.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="range"
              min={1}
              max={50}
              value={config.cuota_por_manzana || 10}
              onChange={(e) =>
                update("cuota_por_manzana", parseInt(e.target.value))
              }
              style={{ flex: 1, accentColor: "var(--accent)" }}
            />
            <span
              style={{
                fontFamily: "Syne",
                fontSize: 20,
                fontWeight: 800,
                color: "var(--accent)",
                minWidth: 28,
                textAlign: "center",
              }}
            >
              {config.cuota_por_manzana || 10}
            </span>
          </div>
        </div>
        <div style={secStyle}>
          <div style={labelStyle}>Casas por lado</div>
          <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: -6 }}>
            Estimado para calcular el recorrido.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="range"
              min={2}
              max={30}
              value={config.casas_por_lado || 10}
              onChange={(e) =>
                update("casas_por_lado", parseInt(e.target.value))
              }
              style={{ flex: 1, accentColor: "var(--accent)" }}
            />
            <span
              style={{
                fontFamily: "Syne",
                fontSize: 20,
                fontWeight: 800,
                color: "var(--accent)",
                minWidth: 28,
                textAlign: "center",
              }}
            >
              {config.casas_por_lado || 10}
            </span>
          </div>
        </div>
        <div style={secStyle}>
          <div style={labelStyle}>Máx. intentos</div>
          <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: -6 }}>
            Visitas por parcela antes de reemplazar.
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                onClick={() => update("max_intentos", n)}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  borderRadius: "var(--r)",
                  border: `2px solid ${config.max_intentos === n ? "var(--accent)" : "var(--border2)"}`,
                  background:
                    config.max_intentos === n
                      ? "var(--accent-light)"
                      : "var(--paper)",
                  color:
                    config.max_intentos === n ? "var(--accent)" : "var(--ink3)",
                  fontFamily: "Syne",
                  fontSize: 18,
                  fontWeight: 800,
                  cursor: "pointer",
                  transition: "all .15s",
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={secStyle}>
        <div style={labelStyle}>Tipo de reemplazo</div>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
        >
          {[
            {
              key: "inmediato",
              icon: "→",
              label: "Inmediato",
              desc: "Ir a la siguiente puerta",
            },
            {
              key: "salto",
              icon: "⇒",
              label: "Por salto",
              desc: `Aplicar intervalo k=${k}`,
            },
          ].map((op) => (
            <div
              key={op.key}
              onClick={() => update("tipo_reemplazo", op.key)}
              style={{
                padding: "10px 12px",
                border: `2px solid ${config.tipo_reemplazo === op.key ? "var(--accent)" : "var(--border2)"}`,
                borderRadius: "var(--r)",
                background:
                  config.tipo_reemplazo === op.key
                    ? "var(--accent-light)"
                    : "var(--paper)",
                cursor: "pointer",
                transition: "all .15s",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color:
                    config.tipo_reemplazo === op.key
                      ? "var(--accent)"
                      : "var(--ink)",
                }}
              >
                {op.icon} {op.label}
              </div>
              <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 3 }}>
                {op.desc}
              </div>
            </div>
          ))}
        </div>
      </div>

      <RazonesSelector
        organizacionId={organizacionId}
        seleccionadas={config.razones_seleccionadas || []}
        onChangeSel={(ids) => update("razones_seleccionadas", ids)}
      />
    </div>
  );
}

// ════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ════════════════════════════════════════════════
// ════════════════════════════════════════════════
// MODAL DE MANZANAS POR EQUIPO
// ════════════════════════════════════════════════
// ════════════════════════════════════════════════
// MODAL UNIFICADO: ZONAS + MUESTREO + DRAG&DROP
// ════════════════════════════════════════════════

// ════════════════════════════════════════════════
// MODAL UNIFICADO: ZONAS POR EQUIPO + MUESTREO
// Nueva lógica: equipo → zonas → encuestadores arrastrados al mapa
// ════════════════════════════════════════════════
export function ZonasYMuestreoModal({ encuesta, equipos, onClose, onSaved }) {
  const COLORES_ZONA = [
    "#1a472a",
    "#7c3aed",
    "#b45309",
    "#1e40af",
    "#9f1239",
    "#065f46",
    "#0891b2",
    "#dc2626",
  ];

  // ── Vista: 'equipos' | 'mapa' ──
  const [vista, setVista] = useState("equipos");
  const [equipoActivo, setEquipoActivo] = useState(null); // { id, nombre }
  const [encuestadoresEquipo, setEncuestadoresEquipo] = useState([]); // [{ id, nombre }]
  // Cuota individual (sección 6 del plan): override por encuestador de
  // config.cuota_por_encuestador. { [encuestador_id]: cuota } — solo trae
  // entrada si hay override; sin ella se usa la cuota general.
  const [cuotasIndividuales, setCuotasIndividuales] = useState({});
  const [cuotaEditando, setCuotaEditando] = useState(null); // encuestador_id en edición

  // ── Estado zonas del equipo activo ──
  const [zonas, setZonas] = useState([]); // [{ id, nombre, equipo_id, area_geojson }]
  const [zonaActiva, setZonaActiva] = useState(null);
  const [loadingZonas, setLoadingZonas] = useState(false);

  // ── Asignaciones encuestadores por zona ──
  const [asignaciones, setAsignaciones] = useState({}); // { zona_id: [{ id, nombre }] }

  // ── Muestreo ──
  const [config, setConfig] = useState(CONFIG_DEFAULT);
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [tiempoObjetivo, setTiempoObjetivo] = useState(""); // minutos, string vacío = sin objetivo

  // ── Drag encuestador ──
  const [draggingEnc, setDraggingEnc] = useState(null); // { id, nombre }
  const [dropTarget, setDropTarget] = useState(null); // zona_id hover

  // ── UI ──
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("zonas");
  const [toastMsg, setToastMsg] = useState("");
  const [zonaAEliminar, setZonaAEliminar] = useState(null); // { id, nombre }

  // ════════════════════════════════════════════════
  // Zonas "huérfanas": quedan con equipo_id = null cuando se borra el
  // equipo dueño (FK ON DELETE SET NULL). Como abrirEquipo() sólo busca
  // zonas .eq('equipo_id', equipo.id), estas zonas nunca aparecían en el
  // panel — pero el polígono y las asignaciones siguen existiendo, por
  // eso la app móvil las seguía mostrando con normalidad.
  // ════════════════════════════════════════════════
  const [zonasHuerfanas, setZonasHuerfanas] = useState([]); // [{ id, nombre, equipo_nombre }]

  const cargarZonasHuerfanas = useCallback(async () => {
    const { data } = await supabase
      .from("encuesta_zonas")
      .select("id, nombre, equipo_nombre")
      .eq("encuesta_id", encuesta.id)
      .is("equipo_id", null)
      .order("orden");
    setZonasHuerfanas(data || []);
  }, [encuesta.id]);

  useEffect(() => {
    cargarZonasHuerfanas();
  }, [cargarZonasHuerfanas]);

  async function reasignarZonaHuerfana(zonaId, nuevoEquipoId) {
    if (!nuevoEquipoId) return;
    await supabase
      .from("encuesta_zonas")
      .update({ equipo_id: nuevoEquipoId })
      .eq("id", zonaId);
    // Asegurar el vínculo encuestas_equipo del equipo destino (mismo fix
    // que abrirEquipo aplica al abrir un equipo por primera vez).
    await supabase
      .from("encuestas_equipo")
      .upsert(
        { encuesta_id: encuesta.id, equipo_id: nuevoEquipoId },
        { onConflict: "encuesta_id,equipo_id" },
      );
    mostrarToast("✅ Zona reasignada");
    cargarZonasHuerfanas();
  }

  // ════════════════════════════════════════════════
  // NUEVO: Estado para rastrear zonas modificadas
  // ════════════════════════════════════════════════
  const [zonasModificadas, setZonasModificadas] = useState(new Set());

  const [encuestasEquipoId, setEncuestasEquipoId] = useState(null);
  const encuestasEquipoIdRef = useRef(null);
  const mapaRef = useRef(null);
  const zonasDataRef = useRef({});

  function mostrarToast(msg) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(""), 3500);
  }

  // Cargar config de muestreo al montar
  useEffect(() => {
    supabase
      .from("encuestas")
      .select("config_muestreo, fecha_inicio, fecha_fin, tiempo_objetivo_minutos")
      .eq("id", encuesta.id)
      .single()
      .then(({ data }) => {
        if (data?.config_muestreo)
          setConfig((c) => ({ ...c, ...data.config_muestreo }));
        if (data?.fecha_inicio) setFechaInicio(data.fecha_inicio);
        if (data?.fecha_fin) setFechaFin(data.fecha_fin);
        if (data?.tiempo_objetivo_minutos != null)
          setTiempoObjetivo(String(data.tiempo_objetivo_minutos));
      });
  }, [encuesta.id]);

  // ── Abrir mapa de un equipo ──
  async function abrirEquipo(equipo) {
    setEquipoActivo(equipo);
    setLoadingZonas(true);
    setVista("mapa");
    zonasDataRef.current = {};

    try {
      const [
        { data: zs },
        { data: miembros },
        { data: eeData },
        { data: coordinadores },
      ] = await Promise.all([
        supabase
          .from("encuesta_zonas")
          .select("*")
          .eq("encuesta_id", encuesta.id)
          .eq("equipo_id", equipo.id)
          .order("orden"),
        supabase
          .from("equipo_encuestadores")
          .select("encuestador_id, perfiles(nombre_completo)")
          .eq("equipo_id", equipo.id),
        supabase
          .from("encuestas_equipo")
          .select("id")
          .eq("encuesta_id", encuesta.id)
          .eq("equipo_id", equipo.id)
          .maybeSingle(),
        supabase
          .from("equipo_coordinadores")
          .select("coordinador_id, perfiles(nombre_completo)")
          .eq("equipo_id", equipo.id),
      ]);

      // Si el equipo todavía no tiene el vínculo encuestas_equipo para esta
      // encuesta, crearlo ahora. Sin esto, la encuesta se ve "asignada" acá
      // (porque ya tiene zonas) pero get_encuestas_encuestador() nunca la
      // devuelve en la app del encuestador, porque esa función exige el
      // vínculo en encuestas_equipo además de las zonas.
      let equipoLinkId = eeData?.id || null;
      if (!equipoLinkId) {
        const { data: nuevoLink, error: linkErr } = await supabase
          .from("encuestas_equipo")
          .upsert(
            { encuesta_id: encuesta.id, equipo_id: equipo.id },
            { onConflict: "encuesta_id,equipo_id" },
          )
          .select("id")
          .single();
        if (linkErr) setError(linkErr.message);
        else equipoLinkId = nuevoLink?.id || null;
      }

      setEncuestasEquipoId(equipoLinkId);
      encuestasEquipoIdRef.current = equipoLinkId;

      const lista = zs || [];
      setZonas(lista);
      lista.forEach((z) => {
        if (z.area_geojson) zonasDataRef.current[z.id] = z.area_geojson;
      });
      if (lista.length > 0) setZonaActiva(lista[0].id);

      const encs = (miembros || []).map((m) => ({
        id: m.encuestador_id,
        nombre: m.perfiles?.nombre_completo || m.encuestador_id,
        esCoordinador: false,
      }));
      const coords = (coordinadores || []).map((c) => ({
        id: c.coordinador_id,
        nombre: c.perfiles?.nombre_completo || c.coordinador_id,
        esCoordinador: true,
      }));
      const todosLosPerfiles = [...encs, ...coords];
      // Combinar encuestadores + coordinadores, sin duplicados por id
      const idsVistos = new Set();
      const todosAsignables = [...encs, ...coords].filter((p) => {
        if (idsVistos.has(p.id)) return false;
        idsVistos.add(p.id);
        return true;
      });
      setEncuestadoresEquipo(todosAsignables);

      // Cargar overrides de cuota individual (sección 6) de este equipo
      if (encs.length > 0) {
        const { data: cuotasRows } = await supabase
          .from("cuotas_individuales")
          .select("encuestador_id, cuota")
          .eq("encuesta_id", encuesta.id)
          .in(
            "encuestador_id",
            encs.map((e) => e.id),
          );
        const mapaCuotas = {};
        (cuotasRows || []).forEach((r) => {
          mapaCuotas[r.encuestador_id] = r.cuota;
        });
        setCuotasIndividuales(mapaCuotas);
      } else {
        setCuotasIndividuales({});
      }

      // Cargar asignaciones existentes
      if (lista.length > 0) {
        const { data: aes } = await supabase
          .from("asignaciones_encuesta")
          .select("encuesta_zona_id, encuestador_id")
          .in(
            "encuesta_zona_id",
            lista.map((z) => z.id),
          );
        if (aes) {
          const mapa = {};
          aes.forEach((ae) => {
            const encNombre =
              todosLosPerfiles.find((e) => e.id === ae.encuestador_id)
                ?.nombre || ae.encuestador_id;
            if (!mapa[ae.encuesta_zona_id]) mapa[ae.encuesta_zona_id] = [];
            mapa[ae.encuesta_zona_id].push({
              id: ae.encuestador_id,
              nombre: encNombre,
            });
          });
          setAsignaciones(mapa);
        }
      }
    } catch (e) {
      setError(e.message);
    }
    setLoadingZonas(false);
  }

  // ── Cuota individual (sección 6): override por encuestador de la cuota
  // general de config.cuota_por_encuestador. valor vacío/null = quitar el
  // override y volver a la cuota general.
  async function guardarCuotaIndividual(encuestadorId, valor) {
    const cuota = valor === "" || valor == null ? null : parseInt(valor, 10);
    try {
      if (cuota == null || Number.isNaN(cuota)) {
        const { error } = await supabase.rpc("quitar_cuota_individual", {
          p_encuesta_id: encuesta.id,
          p_encuestador_id: encuestadorId,
        });
        if (error) throw error;
        setCuotasIndividuales((c) => {
          const copia = { ...c };
          delete copia[encuestadorId];
          return copia;
        });
      } else {
        const { error } = await supabase.rpc("set_cuota_individual", {
          p_encuesta_id: encuesta.id,
          p_encuestador_id: encuestadorId,
          p_cuota: cuota,
        });
        if (error) throw error;
        setCuotasIndividuales((c) => ({ ...c, [encuestadorId]: cuota }));
      }
      mostrarToast("✅ Cuota actualizada");
    } catch (e) {
      setError(e.message);
    }
    setCuotaEditando(null);
  }

  // ── Agregar nueva zona ──
  async function agregarZona() {
    guardarSnapshotActual();
    const orden = zonas.length + 1;
    const { data, error: err } = await supabase
      .from("encuesta_zonas")
      .insert({
        encuesta_id: encuesta.id,
        equipo_id: equipoActivo.id,
        nombre: `Zona ${orden}`,
        orden,
      })
      .select()
      .single();
    // Antes esto fallaba en silencio (p.ej. equipo_id de un equipo ya
    // borrado/recreado, con la pantalla vieja en memoria) y no avisaba nada.
    if (err || !data) {
      console.error("[agregarZona]", err);
      mostrarToast(
        "❌ No se pudo crear la zona — recargá la página e intentá de nuevo (" +
          (err?.message || "sin datos") +
          ")",
      );
      return;
    }
    setZonas((prev) => [...prev, data]);
    setZonaActiva(data.id);
  }

  async function renombrarZona(id, nombre) {
    setZonas((prev) => prev.map((z) => (z.id === id ? { ...z, nombre } : z)));
    // ════════════════════════════════════════════
    // MARCAR ZONA COMO MODIFICADA al cambiar nombre
    // ════════════════════════════════════════════
    setZonasModificadas((prev) => new Set(prev).add(id));
    await supabase.from("encuesta_zonas").update({ nombre }).eq("id", id);
  }

  function pedirEliminarZona(id, nombre) {
    setZonaAEliminar({ id, nombre });
  }

  async function eliminarZona(id) {
    // OJO: .delete() de supabase-js NO tira excepción si la fila no se borra
    // (p.ej. bloqueada por RLS) — hay que chequear { error, count } a mano,
    // si no la UI queda como si hubiese borrado algo que en realidad sigue en la DB.
    const { error, count } = await supabase
      .from("encuesta_zonas")
      .delete({ count: "exact" })
      .eq("id", id);
    if (error) throw error;
    if (!count) {
      throw new Error(
        "No se pudo eliminar la zona (permisos insuficientes o la fila ya no existe).",
      );
    }
    delete zonasDataRef.current[id];
    const restantes = zonas.filter((z) => z.id !== id);
    setZonas(restantes);
    setZonaActiva(restantes.length > 0 ? restantes[0].id : null);
    setAsignaciones((prev) => {
      const n = { ...prev };
      delete n[id];
      return n;
    });
    // Remover de modificadas si estaba
    setZonasModificadas((prev) => {
      const nueva = new Set(prev);
      nueva.delete(id);
      return nueva;
    });
  }

  async function confirmarEliminarZona() {
    if (!zonaAEliminar) return;
    try {
      await eliminarZona(zonaAEliminar.id);
      mostrarToast("✅ Zona eliminada");
    } catch (e) {
      console.error("[eliminarZona]", e);
      mostrarToast("❌ " + (e.message || "No se pudo eliminar la zona"));
    } finally {
      setZonaAEliminar(null);
      cargarZonasHuerfanas();
    }
  }

  // ════════════════════════════════════════════════
  // ACTUALIZADO: guardarSnapshotActual con detección de cambios
  // ════════════════════════════════════════════════
  function guardarSnapshotActual() {
    if (mapaRef.current && zonaActiva) {
      const data = mapaRef.current.getZonaActual();
      if (data) {
        // Solo marcar como modificada si realmente cambió
        const anterior = zonasDataRef.current[zonaActiva];
        if (!sonIgualesGeoJSON(anterior, data)) {
          zonasDataRef.current[zonaActiva] = data;
          setZonasModificadas((prev) => new Set(prev).add(zonaActiva));
        }
      }
    }
  }

  function cambiarZonaActiva(id) {
    guardarSnapshotActual();
    setZonaActiva(id);
  }

  // ── Drag encuestadores al mapa ──
  // El drop se detecta en los botones de zona del sidebar (fallback)
  // y también via HTML5 drag sobre el mapa (detectando zona por coordenadas)

  // Asignación solo actualiza estado local — se persiste al guardar
  async function asignarEncAZona(encId, encNombre, zonaId) {
    const yaAsignado = (asignaciones[zonaId] || []).some((e) => e.id === encId);
    if (yaAsignado) return;
    setAsignaciones((prev) => ({
      ...prev,
      [zonaId]: [...(prev[zonaId] || []), { id: encId, nombre: encNombre }],
    }));
    // Guardar directo en DB sin esperar handleSave
    await supabase.from("asignaciones_encuesta").upsert(
      {
        encuesta_zona_id: zonaId,
        encuestador_id: encId,
        activo: true,
        ...(encuestasEquipoIdRef.current
          ? { encuestas_equipo_id: encuestasEquipoIdRef.current }
          : {}),
      },
      { onConflict: "encuesta_zona_id,encuestador_id", ignoreDuplicates: true },
    );
    mostrarToast(
      `✅ ${encNombre} → ${zonas.find((z) => z.id === zonaId)?.nombre}`,
    );
  }

  async function quitarEncDeZona(encId, zonaId) {
    setAsignaciones((prev) => ({
      ...prev,
      [zonaId]: (prev[zonaId] || []).filter((e) => e.id !== encId),
    }));
    // Borrar directo en DB
    await supabase
      .from("asignaciones_encuesta")
      .delete()
      .eq("encuesta_zona_id", zonaId)
      .eq("encuestador_id", encId);
  }

  // ════════════════════════════════════════════════
  // MODIFICADO: handleSave con guardado selectivo de zonas
  // ════════════════════════════════════════════════
  async function handleSave() {
    setSaving(true);
    setError("");

    try {
      guardarSnapshotActual();

      // ════════════════════════════════════════════
      // Solo guardar zonas que fueron modificadas
      // ════════════════════════════════════════════
      const zonasAGuardar = zonas.filter((z) => zonasModificadas.has(z.id));

      if (zonasAGuardar.length > 0) {
        console.log(`Guardando ${zonasAGuardar.length} zonas modificadas...`);

        // Guardar una por una o en batches pequeños (mejor control)
        for (const zona of zonasAGuardar) {
          const geojson = zonasDataRef.current[zona.id];
          if (!geojson) continue;

          const { error } = await supabase
            .from("encuesta_zonas")
            .update({
              area_geojson: geojson,
              geofencing_activo: !!(geojson.features || []).find(
                (f) => f.properties?.tipo === "zona",
              ),
            })
            .eq("id", zona.id);

          if (error) throw error;
        }
      }

      // Sincronizar asignaciones — borrar las eliminadas, upsert las nuevas
      if (zonas.length > 0) {
        const zonaIds = zonas.map((z) => z.id);

        // Construir lista de pares (zona_id, encuestador_id) que deben existir
        const debeExistir = new Set();
        const nuevasAsig = [];
        zonas.forEach((zona) => {
          (asignaciones[zona.id] || []).forEach((enc) => {
            debeExistir.add(`${zona.id}|${enc.id}`);
            nuevasAsig.push({
              encuesta_zona_id: zona.id,
              encuestador_id: enc.id,
              activo: true,
              ...(encuestasEquipoIdRef.current
                ? { encuestas_equipo_id: encuestasEquipoIdRef.current }
                : {}),
            });
          });
        });

        // Leer asignaciones actuales en DB para estas zonas
        const { data: asigActuales } = await supabase
          .from("asignaciones_encuesta")
          .select("id, encuesta_zona_id, encuestador_id")
          .in("encuesta_zona_id", zonaIds);

        // Borrar las que ya no deben existir
        const paraEliminar = (asigActuales || [])
          .filter(
            (a) =>
              !debeExistir.has(`${a.encuesta_zona_id}|${a.encuestador_id}`),
          )
          .map((a) => a.id);

        if (paraEliminar.length > 0) {
          await supabase
            .from("asignaciones_encuesta")
            .delete()
            .in("id", paraEliminar);
        }

        // Upsert las que deben existir
        if (nuevasAsig.length > 0) {
          const { error: asigErr } = await supabase
            .from("asignaciones_encuesta")
            .upsert(nuevasAsig, {
              onConflict: "encuesta_zona_id,encuestador_id",
              ignoreDuplicates: true,
            });
          if (asigErr) throw asigErr;
        }
      }

      // Guardar config muestreo y fechas
      const { error: configErr } = await supabase
        .from("encuestas")
        .update({
          config_muestreo: config,
          fecha_inicio: fechaInicio || null,
          fecha_fin: fechaFin || null,
          tiempo_objetivo_minutos: tiempoObjetivo ? parseInt(tiempoObjetivo) : null,
        })
        .eq("id", encuesta.id);
      if (configErr) throw configErr;

      // Disparar parcelas en background (solo domiciliaria)
      if (encuesta.tipo_encuesta !== "callejera") {
        zonas.forEach((zona) => {
          if (zonasDataRef.current[zona.id]) {
            supabase.functions
              .invoke("guardar-parcelas", {
                body: { encuesta_zona_id: zona.id },
              })
              .then(({ error: e }) => {
                if (e) console.error("[guardar-parcelas]", e);
              });
          }
        });
      }

      // ════════════════════════════════════════════
      // Limpiar modificadas después de guardar exitosamente
      // ════════════════════════════════════════════
      setZonasModificadas(new Set());

      // Refrescar la foto de equipos/zonas de la encuesta (para reportes y vista en vivo)
      // Nota: el builder de supabase-js sólo implementa .then(), no .catch(),
      // así que un .catch() encadenado directo revienta con "is not a function".
      try {
        const { error: snapErr } = await supabase.rpc(
          "capturar_snapshot_encuesta",
          { p_encuesta_id: encuesta.id, p_origen: "config_muestreo" },
        );
        if (snapErr) console.error("[snapshot]", snapErr);
      } catch (e) {
        console.error("[snapshot]", e);
      }

      onSaved();
      onClose();
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const COLOR_ZONA = (idx) => COLORES_ZONA[idx % COLORES_ZONA.length];
  const zonaActivaIdx = zonas.findIndex((z) => z.id === zonaActiva);
  const todasLasZonasData = zonas.map((z, zi) => ({
    id: z.id,
    nombre: z.nombre,
    color: COLOR_ZONA(zi),
    geojson: zonasDataRef.current[z.id] || z.area_geojson || null,
    encuestadores: (asignaciones[z.id] || []).map((e) => e.nombre),
  }));

  const [vistaGeneral, setVistaGeneral] = useState(false);

  const tabBtn = (key, label) => ({
    padding: "6px 18px",
    cursor: "pointer",
    fontFamily: "DM Sans",
    fontSize: 13,
    fontWeight: 600,
    border: "none",
    background: "none",
    borderBottom: `2.5px solid ${tab === key ? "var(--accent)" : "transparent"}`,
    color: tab === key ? "var(--accent)" : "var(--ink3)",
    transition: "all .15s",
  });

  // ════════ RENDER ════════
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.65)",
        zIndex: 500,
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
        padding: 12,
      }}
    >
      <div
        style={{
          background: "var(--paper)",
          borderRadius: "var(--r2)",
          width: "100%",
          maxWidth: 1200,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 80px rgba(0,0,0,.3)",
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            padding: "12px 20px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexShrink: 0,
            background: "var(--surface)",
          }}
        >
          {vista === "mapa" && (
            <button
              onClick={() => {
                guardarSnapshotActual();
                setVista("equipos");
                setZonas([]);
                setZonaActiva(null);
                setAsignaciones({});
              }}
              style={{
                padding: "5px 12px",
                background: "none",
                border: "1.5px solid var(--border2)",
                borderRadius: "var(--r)",
                cursor: "pointer",
                fontSize: 13,
                fontFamily: "DM Sans",
                color: "var(--ink3)",
              }}
            >
              ← Equipos
            </button>
          )}
          <div style={{ flex: 1 }}>
            <h3
              style={{
                fontFamily: "Syne",
                fontSize: 15,
                fontWeight: 700,
                margin: 0,
              }}
            >
              {encuesta.nombre}
            </h3>
            <p
              style={{ fontSize: 11, color: "var(--ink3)", margin: "2px 0 0" }}
            >
              {vista === "mapa" && equipoActivo
                ? `🟢 ${equipoActivo.nombre}`
                : "Seleccioná un equipo para configurar sus zonas"}
            </p>
          </div>
          {error && (
            <span
              style={{ fontSize: 12, color: "var(--danger)", fontWeight: 500 }}
            >
              Error: {error}
            </span>
          )}
          <button
            onClick={onClose}
            style={{
              padding: "6px 14px",
              background: "none",
              border: "1.5px solid var(--border2)",
              borderRadius: "var(--r)",
              cursor: "pointer",
              fontSize: 13,
              fontFamily: "DM Sans",
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: "6px 20px",
              background: saving ? "var(--surface2)" : "var(--accent)",
              color: "#fff",
              border: "none",
              borderRadius: "var(--r)",
              cursor: saving ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: 700,
              fontFamily: "DM Sans",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Guardando..." : "Guardar todo"}
          </button>
        </div>

        {/* ── Tabs (solo en vista mapa, solo zonas) ── */}
        {vista === "mapa" && (
          <div
            style={{
              display: "flex",
              borderBottom: "1px solid var(--border)",
              paddingLeft: 20,
              flexShrink: 0,
              background: "var(--surface)",
            }}
          >
            {encuesta.tipo_encuesta !== "telefonica" && (
              <button
                style={tabBtn("zonas", "Zonas")}
                onClick={() => setTab("zonas")}
              >
                {encuesta.tipo_encuesta === "callejera"
                  ? "Zonas y geofencing"
                  : "Zonas y manzanas"}
              </button>
            )}
          </div>
        )}

        {/* ── Toast ── */}
        {toastMsg && (
          <div
            style={{
              position: "fixed",
              bottom: 32,
              left: "50%",
              transform: "translateX(-50%)",
              background: "#1a1a1a",
              color: "#fff",
              padding: "10px 20px",
              borderRadius: 100,
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "DM Sans",
              zIndex: 9999,
              boxShadow: "0 4px 20px rgba(0,0,0,.3)",
              pointerEvents: "none",
            }}
          >
            {toastMsg}
          </div>
        )}

        {/* Confirmar eliminación de zona */}
        {zonaAEliminar && (
          <ConfirmDialog
            title="Eliminar zona"
            message={`¿Eliminar la zona "${zonaAEliminar.nombre}"? Se borran sus manzanas y asignaciones.`}
            confirmLabel="Eliminar"
            onConfirm={confirmarEliminarZona}
            onCancel={() => setZonaAEliminar(null)}
          />
        )}

        {/* ════ VISTA: LISTA DE EQUIPOS ════ */}
        {vista === "equipos" && (
          <div style={{ flex: 1, overflow: "auto", padding: 28 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "var(--ink3)",
                textTransform: "uppercase",
                letterSpacing: 1,
                marginBottom: 16,
              }}
            >
              Equipos de la encuesta
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {(equipos || []).length === 0 && (
                <div
                  style={{
                    padding: "40px 0",
                    textAlign: "center",
                    color: "var(--ink3)",
                    fontSize: 14,
                  }}
                >
                  No hay equipos en esta organización.
                </div>
              )}
              {(equipos || []).map((eq) => {
                const zonasEq = []; // contamos desde DB — se carga al abrir
                return (
                  <div
                    key={eq.id}
                    style={{
                      background: "var(--paper)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--r2)",
                      padding: "16px 20px",
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                    }}
                  >
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: "50%",
                        background: "var(--accent-light)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 18,
                        flexShrink: 0,
                      }}
                    >
                      👥
                    </div>
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 700,
                          color: "var(--ink)",
                        }}
                      >
                        {eq.nombre}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--ink3)",
                          marginTop: 2,
                        }}
                      >
                        Tocá para configurar zonas, manzanas y encuestadores
                      </div>
                    </div>
                    <button
                      onClick={() => abrirEquipo(eq)}
                      style={{
                        padding: "8px 18px",
                        background: "var(--accent)",
                        color: "#fff",
                        border: "none",
                        borderRadius: "var(--r)",
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: "pointer",
                        fontFamily: "DM Sans",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      🗺️ Configurar zonas
                    </button>
                  </div>
                );
              })}
            </div>

            {zonasHuerfanas.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "var(--danger)",
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    marginBottom: 8,
                  }}
                >
                  ⚠️ Zonas sin equipo
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    color: "var(--ink3)",
                    marginBottom: 12,
                  }}
                >
                  El equipo dueño de estas zonas fue eliminado, pero la zona
                  (con su polígono, manzanas y asignaciones) sigue existiendo.
                  Asignalas a otro equipo o eliminalas.
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {zonasHuerfanas.map((z) => (
                    <div
                      key={z.id}
                      style={{
                        background: "var(--paper)",
                        border: "1px dashed var(--danger)",
                        borderRadius: "var(--r2)",
                        padding: "14px 20px",
                        display: "flex",
                        alignItems: "center",
                        gap: 16,
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div
                          style={{
                            fontSize: 15,
                            fontWeight: 700,
                            color: "var(--ink)",
                          }}
                        >
                          {z.nombre}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: "var(--ink3)",
                            marginTop: 2,
                          }}
                        >
                          Antes de{" "}
                          {z.equipo_nombre || "un equipo eliminado"}
                        </div>
                      </div>
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) {
                            reasignarZonaHuerfana(z.id, e.target.value);
                          }
                        }}
                        style={{
                          padding: "8px 10px",
                          borderRadius: "var(--r)",
                          border: "1.5px solid var(--border2)",
                          background: "var(--surface)",
                          color: "var(--ink)",
                          fontSize: 13,
                          fontFamily: "DM Sans",
                        }}
                      >
                        <option value="">Reasignar a…</option>
                        {(equipos || []).map((eq) => (
                          <option key={eq.id} value={eq.id}>
                            {eq.nombre}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => pedirEliminarZona(z.id, z.nombre)}
                        style={{
                          padding: "8px 14px",
                          background: "none",
                          color: "var(--danger)",
                          border: "1.5px solid var(--danger)",
                          borderRadius: "var(--r)",
                          fontSize: 13,
                          fontWeight: 700,
                          cursor: "pointer",
                          fontFamily: "DM Sans",
                        }}
                      >
                        Eliminar
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Config muestreo acceso directo */}
            <div style={{ marginTop: 24 }}>
              <button
                onClick={() => setTab("muestreo")}
                style={{
                  padding: "8px 18px",
                  background:
                    tab === "muestreo" ? "var(--accent)" : "var(--surface)",
                  border: `1.5px solid ${tab === "muestreo" ? "var(--accent)" : "var(--border2)"}`,
                  borderRadius: "var(--r)",
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "DM Sans",
                  color: tab === "muestreo" ? "#fff" : "var(--ink2)",
                  fontWeight: 600,
                }}
              >
                ⚙️ Configuración de muestreo
              </button>
              {tab === "muestreo" && (
                <button
                  onClick={() => setTab("zonas")}
                  style={{
                    marginLeft: 8,
                    padding: "8px 14px",
                    background: "none",
                    border: "1.5px solid var(--border2)",
                    borderRadius: "var(--r)",
                    fontSize: 13,
                    cursor: "pointer",
                    fontFamily: "DM Sans",
                    color: "var(--ink3)",
                  }}
                >
                  ✕ Cerrar
                </button>
              )}
            </div>

            {/* Panel muestreo inline */}
            {tab === "muestreo" && (
              <div style={{ marginTop: 20, maxWidth: 720 }}>
                {/* Programación */}
                <div
                  style={{
                    background: "var(--paper)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--r2)",
                    padding: "18px 20px",
                    marginBottom: 20,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "var(--ink3)",
                      textTransform: "uppercase",
                      letterSpacing: 1,
                      marginBottom: 4,
                    }}
                  >
                    Programación
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--ink3)",
                      marginBottom: 16,
                      lineHeight: 1.5,
                    }}
                  >
                    La encuesta se <strong>desbloquea automáticamente</strong>{" "}
                    para los encuestadores en la fecha de inicio.
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 16,
                    }}
                  >
                    <div>
                      <label
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: "var(--ink2)",
                          display: "block",
                          marginBottom: 6,
                        }}
                      >
                        📅 Fecha de inicio
                      </label>
                      <input
                        type="date"
                        value={fechaInicio}
                        onChange={(e) => setFechaInicio(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "9px 12px",
                          border: "1.5px solid var(--border2)",
                          borderRadius: "var(--r)",
                          fontSize: 13,
                          fontFamily: "DM Sans",
                          background: "var(--surface)",
                          color: "var(--ink)",
                          outline: "none",
                        }}
                      />
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--ink4)",
                          marginTop: 4,
                        }}
                      >
                        Dejar vacío = disponible inmediatamente
                      </div>
                    </div>
                    <div>
                      <label
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: "var(--ink2)",
                          display: "block",
                          marginBottom: 6,
                        }}
                      >
                        🔚 Fecha de cierre
                      </label>
                      <input
                        type="date"
                        value={fechaFin}
                        onChange={(e) => setFechaFin(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "9px 12px",
                          border: "1.5px solid var(--border2)",
                          borderRadius: "var(--r)",
                          fontSize: 13,
                          fontFamily: "DM Sans",
                          background: "var(--surface)",
                          color: "var(--ink)",
                          outline: "none",
                        }}
                      />
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--ink4)",
                          marginTop: 4,
                        }}
                      >
                        Dejar vacío = sin fecha de cierre
                      </div>
                    </div>
                  </div>
                  {fechaInicio && (
                    <div
                      style={{
                        marginTop: 14,
                        padding: "10px 14px",
                        background: "var(--accent-light)",
                        borderRadius: "var(--r)",
                        fontSize: 13,
                        color: "var(--accent2)",
                        borderLeft: "3px solid var(--accent2)",
                      }}
                    >
                      🔒 Esta encuesta se desbloqueará el{" "}
                      <strong>
                        {new Date(fechaInicio + "T12:00:00").toLocaleDateString(
                          "es-AR",
                          {
                            weekday: "long",
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                          },
                        )}
                      </strong>
                      {fechaFin &&
                        ` y cerrará el ${new Date(fechaFin + "T12:00:00").toLocaleDateString("es-AR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`}
                      .
                    </div>
                  )}
                  <div style={{ marginTop: 16 }}>
                    <label
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: "var(--ink2)",
                        display: "block",
                        marginBottom: 6,
                      }}
                    >
                      ⏱️ Tiempo objetivo por encuesta (minutos)
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={tiempoObjetivo}
                      onChange={(e) => setTiempoObjetivo(e.target.value)}
                      placeholder="Sin objetivo"
                      style={{
                        width: "100%",
                        maxWidth: 200,
                        padding: "9px 12px",
                        border: "1.5px solid var(--border2)",
                        borderRadius: "var(--r)",
                        fontSize: 13,
                        fontFamily: "DM Sans",
                        background: "var(--surface)",
                        color: "var(--ink)",
                        outline: "none",
                      }}
                    />
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--ink4)",
                        marginTop: 4,
                      }}
                    >
                      Vacío = sin objetivo, no se muestra alerta de tiempo en la app ni en el panel.
                    </div>
                  </div>
                </div>
                {(encuesta?.tipo_encuesta === "callejera" ||
                  encuesta?.tipo_encuesta === "telefonica") && (
                  <>
                    <div
                      style={{
                        background: "var(--paper)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--r2)",
                        padding: "18px 20px",
                        marginBottom: 20,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: "var(--ink3)",
                          textTransform: "uppercase",
                          letterSpacing: 1,
                          marginBottom: 4,
                        }}
                      >
                        Cuota por encuestador
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                        }}
                      >
                        <input
                          type="range"
                          min={1}
                          max={200}
                          value={config.cuota_por_encuestador || 50}
                          onChange={(e) =>
                            setConfig((c) => ({
                              ...c,
                              cuota_por_encuestador: parseInt(e.target.value),
                            }))
                          }
                          style={{ flex: 1, accentColor: "var(--accent)" }}
                        />
                        <span
                          style={{
                            fontFamily: "Syne",
                            fontSize: 28,
                            fontWeight: 800,
                            color: "var(--accent)",
                            minWidth: 48,
                            textAlign: "center",
                          }}
                        >
                          {config.cuota_por_encuestador || 50}
                        </span>
                      </div>
                    </div>
                    <RazonesSelector
                      organizacionId={encuesta?.organizacion_id}
                      seleccionadas={config.razones_seleccionadas || []}
                      onChangeSel={(ids) =>
                        setConfig((c) => ({ ...c, razones_seleccionadas: ids }))
                      }
                    />
                  </>
                )}
                {encuesta?.tipo_encuesta === "domiciliaria" && (
                  <PanelConfig
                    config={config}
                    onChange={setConfig}
                    organizacionId={encuesta?.organizacion_id}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* ════ VISTA: MAPA DEL EQUIPO ════ */}
        {vista === "mapa" && tab === "zonas" && (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              overflow: "hidden",
            }}
          >
            {loadingZonas ? (
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Spinner size="lg" />
              </div>
            ) : (
              <>
                {/* ── Sidebar: encuestadores + zonas en dos columnas ── */}
<div style={{ width: 480, flexShrink: 0, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "row", overflow: "hidden", background: "var(--surface)" }}>

  {/* Columna encuestadores */}
  <div style={{ width: 180, flexShrink: 0, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", overflowY: "auto", padding: "12px 10px" }}>
    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--ink3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>👤 Encuestadores</div>
    <div style={{ fontSize: 10, color: "var(--ink3)", marginBottom: 8, lineHeight: 1.4 }}>
      {draggingEnc ? <span style={{ color: "var(--accent)", fontWeight: 700 }}>✓ {draggingEnc.nombre.split(" ")[0]} — tocá una zona</span> : "Tocá uno para asignar"}
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {encuestadoresEquipo.length === 0 && <div style={{ fontSize: 11, color: "var(--ink3)", fontStyle: "italic" }}>Sin encuestadores</div>}
      {encuestadoresEquipo.map(enc => {
        const seleccionado = draggingEnc?.id === enc.id;
        const cuotaOverride = cuotasIndividuales[enc.id];
        return (
          <div key={enc.id}>
            <div onClick={() => setDraggingEnc(seleccionado ? null : enc)}
              style={{ padding: "6px 8px", borderRadius: "var(--r)", fontSize: 12, fontWeight: 600, background: seleccionado ? "var(--accent)" : "var(--paper)", color: seleccionado ? "#fff" : "var(--ink)", border: `1.5px solid ${seleccionado ? "var(--accent)" : "var(--border2)"}`, cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 5, transition: "all .15s" }}>
              <span style={{ flexShrink: 0 }}>{seleccionado ? "✓" : "+"}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{enc.nombre}</span>
              {enc.esCoordinador && <span style={{ fontSize: 9, fontWeight: 700, background: "#7c3aed22", color: "#7c3aed", border: "1px solid #7c3aed44", borderRadius: 100, padding: "1px 4px", flexShrink: 0 }}>C</span>}
            </div>
            {/* Cuota individual (sección 6): override de cuota_por_encuestador
                solo para encuestadores, no aplica a coordinadores. */}
            {!enc.esCoordinador && (
              cuotaEditando === enc.id ? (
                <div onClick={(ev) => ev.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 8px 4px" }}>
                  <input
                    type="number"
                    min={1}
                    autoFocus
                    defaultValue={cuotaOverride ?? ""}
                    placeholder="general"
                    style={{ width: 56, fontSize: 11, padding: "2px 4px", borderRadius: 4, border: "1px solid var(--border2)" }}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter") guardarCuotaIndividual(enc.id, ev.target.value);
                      if (ev.key === "Escape") setCuotaEditando(null);
                    }}
                    onBlur={(ev) => guardarCuotaIndividual(enc.id, ev.target.value)}
                  />
                </div>
              ) : (
                <div
                  onClick={(ev) => { ev.stopPropagation(); setCuotaEditando(enc.id); }}
                  title="Cuota individual — vacío usa la cuota general"
                  style={{ fontSize: 10, color: cuotaOverride != null ? "var(--accent)" : "var(--ink3)", fontWeight: cuotaOverride != null ? 700 : 500, padding: "0 8px 4px", cursor: "pointer" }}
                >
                  {cuotaOverride != null ? `Cuota: ${cuotaOverride} ✎` : "Cuota general ✎"}
                </div>
              )
            )}
          </div>
        );
      })}
    </div>
  </div>

  {/* Columna zonas */}
  <div style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto", padding: "10px 10px" }}>
    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--ink3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Zonas ({zonas.length})</div>
    {zonas.map((z, zi) => {
      const color = COLOR_ZONA(zi);
      const asigs = asignaciones[z.id] || [];
      const esActiva = z.id === zonaActiva;
      const puedeAsignar = !!draggingEnc && !asigs.some(e => e.id === draggingEnc.id);
      const fueModificada = zonasModificadas.has(z.id);
      return (
        <div key={z.id}
          onDragOver={e => { e.preventDefault(); setDropTarget(z.id); }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={e => { e.preventDefault(); const encId = e.dataTransfer.getData("encId"); const encNombre = e.dataTransfer.getData("encNombre"); setDropTarget(null); if (encId) asignarEncAZona(encId, encNombre, z.id); }}
          onClick={e => { if (draggingEnc) { asignarEncAZona(draggingEnc.id, draggingEnc.nombre, z.id); setDraggingEnc(null); } }}
          style={{ marginBottom: 8, borderRadius: "var(--r2)", border: `2px solid ${puedeAsignar ? color : dropTarget === z.id ? color : esActiva ? color : "var(--border)"}`, background: puedeAsignar ? `${color}15` : dropTarget === z.id ? `${color}18` : esActiva ? `${color}0a` : "var(--paper)", transition: "all .15s", cursor: draggingEnc ? "pointer" : "default", position: "relative" }}>
          {fueModificada && <div style={{ position: "absolute", top: 4, right: 4, width: 7, height: 7, borderRadius: "50%", background: "#f59e0b", border: "2px solid #fff" }} title="Pendiente de guardar" />}
          <div style={{ padding: "14px 10px", minHeight: 48, display: "flex", alignItems: "center", gap: 5, cursor: "pointer", borderBottom: (esActiva || asigs.length > 0 || puedeAsignar) ? `1px solid ${color}25` : "none" }} onClick={() => cambiarZonaActiva(z.id)}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
            <input value={z.nombre} onChange={e => renombrarZona(z.id, e.target.value)} onClick={e => e.stopPropagation()} style={{ flex: 1, border: "none", background: "transparent", fontSize: 13, fontWeight: 600, color: "#111", fontFamily: "DM Sans", outline: "none", cursor: "text", minWidth: 0, height: 28, lineHeight: "28px" }} />
            <button onClick={e => { e.stopPropagation(); pedirEliminarZona(z.id, z.nombre); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink3)", fontSize: 13, padding: "0 2px", lineHeight: 1, flexShrink: 0 }}>×</button>
          </div>
          {asigs.length > 0 && (
            <div onClick={e => e.stopPropagation()} style={{ padding: "4px 8px 6px 8px", display: "flex", flexDirection: "column", gap: 3 }}>
              {asigs.map(enc => (
                <div key={enc.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 8px", borderRadius: 6, background: `${color}18`, border: `1px solid ${color}50`, fontSize: 11, fontWeight: 600, color: "#111" }}>
                  <span>👤 {enc.nombre}</span>
                  <button onClick={e => { e.stopPropagation(); quitarEncDeZona(enc.id, z.id); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#888", fontSize: 15, padding: "0 0 0 8px", lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>
          )}
          {puedeAsignar && <div style={{ padding: "3px 8px", fontSize: 10, color, fontWeight: 700, fontStyle: "italic" }}>✓ Tocá para asignar</div>}
          {dropTarget === z.id && !puedeAsignar && <div style={{ padding: "3px 8px", fontSize: 10, color, fontWeight: 600, fontStyle: "italic" }}>Soltar aquí →</div>}
        </div>
      );
    })}
    <button onClick={agregarZona} style={{ width: "100%", padding: "7px 0", border: "1.5px dashed var(--border2)", borderRadius: "var(--r)", background: "none", cursor: "pointer", fontSize: 11, color: "var(--ink3)", fontFamily: "DM Sans", marginTop: 2, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
      + Nueva zona
    </button>
  </div>
</div>

                {/* ── Mapa ── */}
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    minWidth: 0,
                  }}
                >
                  {/* Toggle vista general */}
                  <div
                    style={{
                      padding: "6px 10px",
                      background: "var(--surface)",
                      borderBottom: "1px solid var(--border)",
                      display: "flex",
                      gap: 6,
                      flexShrink: 0,
                    }}
                  >
                    <button
                      onClick={() => {
                        guardarSnapshotActual();
                        setVistaGeneral(false);
                      }}
                      style={{
                        padding: "4px 12px",
                        fontSize: 11,
                        fontFamily: "DM Sans",
                        fontWeight: 600,
                        cursor: "pointer",
                        borderRadius: "var(--r)",
                        border: `1.5px solid ${!vistaGeneral ? "var(--accent)" : "var(--border2)"}`,
                        background: !vistaGeneral
                          ? "var(--accent)"
                          : "var(--surface)",
                        color: !vistaGeneral ? "#fff" : "var(--ink3)",
                      }}
                    >
                      ✏️ Editar zona
                    </button>
                    <button
                      onClick={() => {
                        guardarSnapshotActual();
                        setVistaGeneral(true);
                      }}
                      style={{
                        padding: "4px 12px",
                        fontSize: 11,
                        fontFamily: "DM Sans",
                        fontWeight: 600,
                        cursor: "pointer",
                        borderRadius: "var(--r)",
                        border: `1.5px solid ${vistaGeneral ? "var(--accent)" : "var(--border2)"}`,
                        background: vistaGeneral
                          ? "var(--accent)"
                          : "var(--surface)",
                        color: vistaGeneral ? "#fff" : "var(--ink3)",
                      }}
                    >
                      🗺️ Vista general
                    </button>
                  </div>

                  {vistaGeneral ? (
                    <MapaCompleto zonas={todasLasZonasData} fullSize />
                  ) : zonaActiva ? (
                    <MapaZona
                      key={zonaActiva}
                      ref={mapaRef}
                      encuestaId={encuesta.id}
                      zonaActual={zonasDataRef.current[zonaActiva] || null}
                      manzanasSeleccionadas={[]}
                      onZonaChange={(geojson) => {
                        if (geojson) {
                          zonasDataRef.current[zonaActiva] = geojson;
                          setZonasModificadas((prev) =>
                            new Set(prev).add(zonaActiva),
                          );
                        }
                      }}
                      onManzanasChange={() => {}}
                      colorZona={COLOR_ZONA(zonaActivaIdx)}
                      todasLasZonas={todasLasZonasData}
                      encuestadoresAsignados={asignaciones[zonaActiva] || []}
                    />
                  ) : (
                    <div
                      style={{
                        flex: 1,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexDirection: "column",
                        gap: 12,
                        color: "var(--ink3)",
                      }}
                    >
                      <div style={{ fontSize: 40 }}>🗺️</div>
                      <p style={{ fontSize: 14, fontWeight: 600 }}>
                        Agregá una zona para comenzar
                      </p>
                      <button
                        onClick={agregarZona}
                        style={{
                          padding: "8px 20px",
                          background: "var(--accent)",
                          color: "#fff",
                          border: "none",
                          borderRadius: "var(--r)",
                          cursor: "pointer",
                          fontSize: 14,
                          fontWeight: 600,
                          fontFamily: "DM Sans",
                        }}
                      >
                        + Agregar primera zona
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}