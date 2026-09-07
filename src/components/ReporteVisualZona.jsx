import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { Bar, Pie } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  ArcElement, Tooltip, Legend,
} from 'chart.js'
import { cacheGet, cacheSet } from '../lib/cache'
import { normalizarTexto } from '../lib/fuzzyMatch'
import {
  buscarPregunta, opcionesDe, esCompletada, valorFusionadoConSeguimiento,
  buscarSeguimientoOtro,
} from '../lib/reportesAutomaticos'
import { generarPDF } from '../lib/generarPDF'
import { Select } from './ui'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

// Reporte Visual Interactivo por Zona — módulo de la Sección 8 del plan.
//
// Reusa toda la infraestructura ya existente en vez de las dos piezas que
// pedía el prompt original y que no están en este stack:
//   - Gráficos con react-chartjs-2/Chart.js (como el resto del panel), no
//     Recharts — Recharts no es una dependencia del proyecto.
//   - Mapa capturado a imagen con html2canvas (data: URL, autocontenida)
//     antes de armar el HTML — el PDF sale por /api/pdf (Puppeteer +
//     @sparticuz/chromium, ver src/lib/generarPDF.js), con el mismo
//     fallback a window.print() que el resto de los reportes si el
//     endpoint falla.
// Fuentes de datos: get_respuestas_crudas (respuestas resueltas + zona_id
// por sesión, ya usada por los reportes automáticos) y get_zonas_con_sesiones
// (polígonos de zona, ya usada por Reportes.jsx para el mapa de calor).

// Paleta nominal: un color por familia de matiz (rojo, naranja, dorado,
// oliva, verde, azul, violeta, magenta, marrón, vino), sin repetir ningún
// matiz — antes había dos azules (#0369a1 y #0891b2) y dos naranjas/marrones
// (#b45309 y #d97706) que se confundían entre sí, sobre todo en el PDF
// exportado (ver que el mapa no tiene leyenda de color propia, así que la
// única referencia son estos chips). 10 colores para cubrir hasta 10
// opciones con color propio sin repetir (ver construirMapaColores: recién
// arriba de 10 opciones se agrupan en "Otros").
const PALETA_NOMINAL = ['#2563eb','#dc2626','#ea580c','#ca8a04','#65a30d','#15803d','#7c3aed','#db2777','#78350f','#9f1239']
const GRIS_OTROS      = '#94a3b8'
const GRIS_ESPECIAL   = '#cbd5e1'
const GRIS_SIN_DATOS  = '#e2e8f0'

// Detección de preguntas "de escala" (Muy buena/Buena/Regular/Mala/Muy mala
// y variantes) para usar semáforo verde→rojo en vez de la paleta nominal.
const PASOS_ESCALA = [
  { test: t => /muy\s*buen|excelente/.test(t),        color: '#2d6a4f' },
  { test: t => /muy\s*mal|pesim/.test(t),              color: '#dc2626' },
  { test: t => /^buen|satisfech/.test(t),              color: '#74c69d' },
  { test: t => /^mal|insatisfech/.test(t),             color: '#f97316' },
  { test: t => /regular|^normal$/.test(t),             color: '#fbbf24' },
]

function esEspecial(opcion) {
  const t = normalizarTexto(opcion)
  return /no sabe|no contesta|ns\s*\/?\s*nc|blanco/.test(t)
}

function colorEscala(opcion) {
  const t = normalizarTexto(opcion)
  const paso = PASOS_ESCALA.find(p => p.test(t))
  return paso?.color || null
}

function esEscalaLike(opcionesNormales) {
  const hits = PASOS_ESCALA.filter(p => opcionesNormales.some(o => p.test(normalizarTexto(o)))).length
  return hits >= 3
}

// Arma { [opcion]: color } para las opciones "oficiales" de la pregunta.
// - Escala: semáforo por palabra clave.
// - Nominal: paleta fija ordenada por votos globales; si hay más de 10
//   opciones con votos, las 8 más votadas quedan con color propio y el
//   resto (más cualquier respuesta que no matchee ninguna opción, ver
//   valorFusionadoConSeguimiento) cae en "Otros".
// Las opciones "especiales" (No sabe/No contesta, Voto en blanco) siempre
// van en gris, sin competir por lugar en la paleta.
function construirMapaColores(opciones, globalCounts) {
  const especiales = opciones.filter(esEspecial)
  const normales   = opciones.filter(o => !esEspecial(o))
  const escalaLike = esEscalaLike(normales)
  const mapa = {}
  if (escalaLike) {
    normales.forEach(o => { mapa[o] = colorEscala(o) || GRIS_OTROS })
  } else {
    const ordenadas = normales.slice().sort((a, b) => (globalCounts[b] || 0) - (globalCounts[a] || 0))
    const top = ordenadas.length > 10 ? ordenadas.slice(0, 8) : ordenadas
    top.forEach((o, i) => { mapa[o] = PALETA_NOMINAL[i % PALETA_NOMINAL.length] })
  }
  mapa['Otros'] = GRIS_OTROS // balde de cualquier valor que no haya quedado mapeado arriba
  especiales.forEach(o => { mapa[o] = GRIS_ESPECIAL })
  return { mapa, escalaLike }
}

// Cualquier valor sin color propio (más allá de las 8 opciones top, o texto
// libre que no fusionó con ninguna opción conocida) se re-etiqueta "Otros".
function bucketearConteo(conteo, colores) {
  const out = {}
  for (const [k, n] of Object.entries(conteo)) {
    const key = colores[k] ? k : 'Otros'
    out[key] = (out[key] || 0) + n
  }
  return out
}

function ganadorDeZona(conteo) {
  if (!conteo) return null
  let mejor = null
  for (const [opcion, n] of Object.entries(conteo)) {
    if (!mejor || n > mejor.n) mejor = { opcion, n }
  }
  return mejor
}

// Cálculo puro (sin tocar estado) — se usa tanto para lo que se ve en
// pantalla (memoizado sobre la pregunta seleccionada) como, sin memoizar,
// para las tablas del PDF cuando se exportan todas las preguntas: así no
// hace falta cambiar `preguntaId` y esperar un re-render por cada una.
function calcularDatosPregunta(pregunta, preguntas, crudo) {
  if (!pregunta || !crudo) return null
  const opciones = opcionesDe(pregunta)
  const pParticipa = buscarPregunta(preguntas, 'participa')
  const pSeguimiento = buscarSeguimientoOtro(preguntas, pregunta)
  const porZonaRaw = {}
  const globalRaw = {}
  for (const fila of crudo.filas || []) {
    if (!fila.zona_id || !esCompletada(fila, pParticipa)) continue
    const valor = valorFusionadoConSeguimiento(fila, pregunta, opciones, pSeguimiento)
    if (!valor) continue
    globalRaw[valor] = (globalRaw[valor] || 0) + 1
    porZonaRaw[fila.zona_id] = porZonaRaw[fila.zona_id] || {}
    porZonaRaw[fila.zona_id][valor] = (porZonaRaw[fila.zona_id][valor] || 0) + 1
  }
  const { mapa: colores, escalaLike } = construirMapaColores(opciones, globalRaw)
  const porZona = {}
  for (const [zid, conteo] of Object.entries(porZonaRaw)) porZona[zid] = bucketearConteo(conteo, colores)
  const global = bucketearConteo(globalRaw, colores)

  const especiales = opciones.filter(esEspecial)
  const normalesConColor = Object.keys(colores).filter(o => o !== 'Otros' && !especiales.includes(o))
  const ordenLegend = [
    ...normalesConColor.sort((a, b) => (global[b] || 0) - (global[a] || 0)),
    ...(global['Otros'] ? ['Otros'] : []),
    ...especiales.filter(o => global[o] != null),
  ]

  return { porZona, global, colores, escalaLike, opciones, ordenLegend }
}

/* ── Tablas HTML para el PDF (mismo look que ReportesAutomaticos.jsx) ── */
function tablaHTMLGenerica(columnas, filas) {
  const th = columnas.map(c => `<th style="text-align:${c.num ? 'right' : 'left'}">${c.label}</th>`).join('')
  const filasHTML = filas.map((f, i) => `<tr style="background:${i % 2 === 0 ? '#fff' : '#fafaf8'}">${
    columnas.map(c => `<td style="text-align:${c.num ? 'right' : 'left'}">${f[c.key] ?? '—'}</td>`).join('')
  }</tr>`).join('')
  return `<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:14px">
    <thead><tr style="background:#f3f4f6">${th}</tr></thead><tbody>${filasHTML}</tbody>
  </table>`
}

function tablaResumenHTML(zonas, datos) {
  const filas = zonas.filter(z => datos.porZona[z.id]).map(z => {
    const conteo = datos.porZona[z.id]
    const total = Object.values(conteo).reduce((a, b) => a + b, 0)
    const ganador = ganadorDeZona(conteo)
    return { zona: z.nombre, ganador: ganador?.opcion || '—', pct: total > 0 ? `${Math.round(ganador.n / total * 100)}%` : '—', total }
  }).sort((a, b) => b.total - a.total)
  return tablaHTMLGenerica(
    [{ key: 'zona', label: 'Zona' }, { key: 'ganador', label: 'Opción ganadora' }, { key: 'pct', label: '%', num: true }, { key: 'total', label: 'Total completadas', num: true }],
    filas
  )
}

function tablaCompletaHTML(zonas, datos) {
  const filas = zonas.filter(z => datos.porZona[z.id]).map(z => {
    const conteo = datos.porZona[z.id]
    const total = Object.values(conteo).reduce((a, b) => a + b, 0)
    const fila = { zona: z.nombre, total }
    datos.ordenLegend.forEach(op => { fila[op] = conteo[op] || 0 })
    return fila
  }).sort((a, b) => b.total - a.total)
  return tablaHTMLGenerica(
    [{ key: 'zona', label: 'Zona' }, ...datos.ordenLegend.map(op => ({ key: op, label: op, num: true })), { key: 'total', label: 'Total', num: true }],
    filas
  )
}

// Referencias de color para el PDF — en pantalla esto lo muestra <Leyenda>,
// pero exportarPDF() arma el HTML aparte (no renderiza el componente React),
// así que sin esto el PDF no explica qué representa cada color del mapa.
function leyendaHTML(datos) {
  const chips = datos.ordenLegend.map(op => `
    <span style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:100px;background:#f3f4f6;font-size:10px;margin:0 6px 6px 0">
      <span style="width:8px;height:8px;border-radius:50%;background:${datos.colores[op] || GRIS_OTROS};display:inline-block;flex-shrink:0"></span>
      ${op} <span style="color:#9ca3af">(${datos.global[op] || 0})</span>
    </span>`).join('')
  return `<div style="margin-bottom:12px">${chips}</div>`
}

function generarHTMLVisual(secciones, encuesta, esCompleto) {
  const fecha = new Date().toLocaleString('es-AR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })
  const cuerpo = secciones.map(s => `
    <div class="sec">${s.titulo}</div>
    ${s.img ? `<img src="${s.img}" style="width:100%;max-height:420px;object-fit:contain;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:10px" />` : ''}
    <div style="font-size:11px;font-weight:700;color:#555;margin-bottom:4px">Referencias</div>
    ${s.leyendaHTML}
    <div style="font-size:11px;font-weight:700;color:#555;margin-bottom:4px">Resumen por zona</div>
    ${s.resumenHTML}
    <div style="font-size:11px;font-weight:700;color:#555;margin-bottom:4px">Detalle completo por zona</div>
    ${s.completoHTML}
  `).join('<div style="page-break-before:always"></div>')

  const css = `*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;color:#1a1a1a;background:#fff;padding:15mm;font-size:12px}
  .header{border-bottom:3px solid #52B788;padding-bottom:16px;margin-bottom:20px}
  h1{font-size:18px;font-weight:800;color:#1a472a;margin:6px 0 4px}
  .meta{font-size:10px;color:#888;margin-top:4px}
  .sec{font-size:13px;font-weight:700;color:#1a472a;margin:16px 0 10px;padding-bottom:6px;border-bottom:2px solid #e5e7eb}
  table td,table th{border:1px solid #e5e7eb;padding:5px 8px}
  footer{margin-top:20px;padding-top:8px;border-top:1px solid #e5e7eb;font-size:9px;color:#bbb;display:flex;justify-content:space-between}
  @page{size:A4;margin:15mm}
  @media print{body{padding:0}}`

  const titulo = esCompleto ? `Reporte visual completo — ${encuesta?.nombre || ''}` : `Reporte visual — ${secciones[0]?.titulo || ''}`

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${titulo}</title><style>${css}</style></head><body>
  <div class="header">
    <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#52B788;text-transform:uppercase">METR1KA · Reporte visual interactivo por zona</div>
    <h1>${titulo}</h1>
    <div class="meta">Generado el ${fecha} (UTC-3)</div>
  </div>
  ${cuerpo}
  <footer><span>METR1KA — metr1ka.com</span><span>${fecha}</span></footer>
  </body></html>`
}

/* ── Mapa coroplético por zona ── */
function MapaChoropleth({ containerRef, zonas, datos, onClickZona }) {
  const instRef   = useRef(null)
  const capasRef  = useRef([])
  const fittedRef = useRef(false)
  const [L, setL] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const leaflet = (await import('leaflet')).default
      await import('leaflet/dist/leaflet.css')
      if (!cancelled) setL(leaflet)
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!L || !containerRef.current) return
    const initMap = () => {
      if (instRef.current) return
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect || rect.width === 0 || rect.height === 0) return
      // `preferCanvas: true` — sin esto Leaflet dibuja los polígonos (capa
      // geoJSON de zonas) con su renderer SVG por defecto, y html2canvas
      // (usado en capturarMapa() para el PDF, más abajo) no captura bien
      // el overlay SVG anidado de Leaflet: en el PDF salen los tiles del
      // mapa pero los polígonos pintados quedan vacíos/transparentes. Con
      // canvas, todo el overlay es un único <canvas> que html2canvas sí
      // copia pixel a pixel.
      instRef.current = L.map(containerRef.current, { zoomControl: true, preferCanvas: true }).setView([-27.5, -55.8], 12)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(instRef.current)
      ro.disconnect()
    }
    const ro = new ResizeObserver(initMap)
    ro.observe(containerRef.current)
    initMap()
    return () => { ro.disconnect(); if (instRef.current) { instRef.current.remove(); instRef.current = null } }
  }, [L])

  useEffect(() => {
    const mapa = instRef.current
    if (!mapa || !L) return
    capasRef.current.forEach(lg => { try { mapa.removeLayer(lg) } catch { /* noop */ } })
    capasRef.current = []
    ;(zonas || []).forEach(z => {
      const feat = z.area_geojson?.features?.find(f => f.properties?.tipo === 'zona') || z.area_geojson?.features?.[0]
      if (!feat) return
      const conteo = datos?.porZona?.[z.id]
      const ganador = ganadorDeZona(conteo)
      const total = conteo ? Object.values(conteo).reduce((a, b) => a + b, 0) : 0
      const color = ganador ? (datos.colores[ganador.opcion] || GRIS_OTROS) : null
      const layer = L.geoJSON(feat, {
        style: { color: '#374151', weight: 1.5, fillColor: color || GRIS_SIN_DATOS, fillOpacity: color ? 0.65 : 0.35 },
      })
      const pct = total > 0 && ganador ? Math.round(ganador.n / total * 100) : 0
      const tooltip = ganador
        ? `<div style="font-family:'DM Sans',sans-serif;font-size:12px;line-height:1.5"><b>${z.nombre}</b><br/><span style="color:${color}">${ganador.opcion}</span>: ${ganador.n} (${pct}%)<br/><span style="color:#9ca3af;font-size:10px">Total: ${total} respuestas</span></div>`
        : `<div style="font-family:'DM Sans',sans-serif;font-size:12px"><b>${z.nombre}</b><br/><span style="color:#9ca3af">Sin datos</span></div>`
      layer.bindTooltip(tooltip, { sticky: true })
      layer.on('click', () => onClickZona?.({ zona: z, conteo: conteo || {}, total }))
      layer.on('mouseover', () => layer.setStyle({ weight: 3 }))
      layer.on('mouseout', () => layer.setStyle({ weight: 1.5 }))
      layer.addTo(mapa)
      capasRef.current.push(layer)
    })
    if (capasRef.current.length > 0 && !fittedRef.current) {
      const grupo = L.featureGroup(capasRef.current)
      const bounds = grupo.getBounds()
      if (bounds.isValid()) { mapa.fitBounds(bounds, { padding: [30, 30] }); fittedRef.current = true }
    }
  }, [L, zonas, datos, onClickZona])

  return null
}

function ModalZonaDetalle({ info, colores, onClose }) {
  if (!info) return null
  const { zona, conteo, total } = info
  const especiales = Object.keys(conteo).filter(esEspecial)
  const normales = Object.keys(conteo).filter(o => !esEspecial(o)).sort((a, b) => conteo[b] - conteo[a])
  const filas = [...normales, ...especiales].map(op => ({
    opcion: op, n: conteo[op], pct: total > 0 ? Math.round(conteo[op] / total * 100) : 0,
  }))
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--paper)', borderRadius: 'var(--r2)', padding: 22, maxWidth: 480, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{zona.nombre}</div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--ink3)' }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 14 }}>{total} respuestas</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--surface)' }}>
              <th style={{ padding: '6px 10px', textAlign: 'left' }}>Opción</th>
              <th style={{ padding: '6px 10px', textAlign: 'right' }}>Cant.</th>
              <th style={{ padding: '6px 10px', textAlign: 'right' }}>%</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={f.opcion} style={{ background: i % 2 === 0 ? 'var(--paper)' : 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: colores[f.opcion] || GRIS_OTROS, flexShrink: 0 }} />
                  {f.opcion}
                </td>
                <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600 }}>{f.n}</td>
                <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--ink3)' }}>{f.pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Leyenda({ datos }) {
  if (!datos) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {datos.ordenLegend.map(op => (
        <div key={op} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 100, background: 'var(--surface)', fontSize: 12 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: datos.colores[op] || GRIS_OTROS, flexShrink: 0 }} />
          <span>{op}</span>
          <span style={{ color: 'var(--ink3)' }}>({datos.global[op] || 0})</span>
        </div>
      ))}
    </div>
  )
}

/* ── Vista Gráficos ── */
const TIPOS_GRAFICO_VISUAL = [
  { value: 'torta', label: '◕ Torta' },
  { value: 'barh',  label: '▬ Barras horizontales' },
  { value: 'barv',  label: '▌ Barras verticales' },
]

function construirChartData(entries, colores) {
  const labels = entries.map(([op]) => op)
  const data   = entries.map(([, n]) => n)
  return { labels, datasets: [{ data, backgroundColor: labels.map(l => colores[l] || GRIS_OTROS), borderRadius: 4, borderWidth: 0 }] }
}

function GraficosZona({ zonas, datos, tipoGrafico, comparativa, opcionComparativa, setOpcionComparativa }) {
  const zonasConDatos = useMemo(() => (zonas || []).filter(z => datos?.porZona?.[z.id]), [zonas, datos])

  const chartOptionsBase = useMemo(() => ({
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: tipoGrafico === 'torta', position: 'bottom', labels: { font: { family: 'DM Sans', size: 10 }, boxWidth: 10 } },
      tooltip: {
        callbacks: {
          label: ctx => {
            const val = ctx.parsed?.x ?? ctx.parsed?.y ?? ctx.parsed
            const total = (ctx.dataset?.data || []).reduce((a, b) => a + b, 0) || 1
            return ` ${ctx.label}: ${val} (${Math.round(val / total * 100)}%)`
          },
        },
      },
    },
    indexAxis: tipoGrafico === 'barh' ? 'y' : 'x',
    scales: tipoGrafico === 'torta' ? {} : {
      x: { grid: { display: false }, ticks: { font: { family: 'DM Sans', size: 10 } } },
      y: { beginAtZero: true, ticks: { font: { family: 'DM Sans', size: 10 } } },
    },
  }), [tipoGrafico])

  if (!datos) return null

  if (comparativa) {
    const labels = zonasConDatos.map(z => z.nombre)
    const values = zonasConDatos.map(z => datos.porZona[z.id]?.[opcionComparativa] || 0)
    const chartData = { labels, datasets: [{ label: opcionComparativa, data: values, backgroundColor: datos.colores[opcionComparativa] || GRIS_OTROS, borderRadius: 6 }] }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)' }}>Opción a comparar</label>
          <Select value={opcionComparativa} onChange={e => setOpcionComparativa(e.target.value)}
            style={{ width: 'auto', minWidth: 180, padding: '6px 10px', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 13, fontFamily: 'DM Sans' }}>
            {datos.ordenLegend.map(op => <option key={op} value={op}>{op}</option>)}
          </Select>
        </div>
        <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', padding: 16, height: 380 }}>
          <Bar data={chartData} options={{ ...chartOptionsBase, indexAxis: tipoGrafico === 'barh' ? 'y' : 'x', plugins: { ...chartOptionsBase.plugins, legend: { display: false } } }} />
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
      {zonasConDatos.map(z => {
        const conteo = datos.porZona[z.id]
        const entries = datos.ordenLegend.filter(op => conteo[op] != null).map(op => [op, conteo[op]])
        const chartData = construirChartData(entries, datos.colores)
        const total = entries.reduce((s, [, n]) => s + n, 0)
        const ChartComp = tipoGrafico === 'torta' ? Pie : Bar
        return (
          <div key={z.id} style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', padding: '14px 16px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{z.nombre}</div>
            <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 10 }}>{total} respuestas</div>
            <div style={{ height: 200 }}>
              <ChartComp data={chartData} options={chartOptionsBase} />
            </div>
          </div>
        )
      })}
      {zonasConDatos.length === 0 && (
        <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 30, color: 'var(--ink3)', fontSize: 13 }}>Sin respuestas todavía para esta pregunta.</div>
      )}
    </div>
  )
}

/* ── Componente principal ── */
export default function ReporteVisualZona({ encuesta, preguntas }) {
  const [crudo, setCrudo]     = useState(null)
  const [zonas, setZonas]     = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError]     = useState('')

  const [preguntaId, setPreguntaId] = useState(null)
  const [vista, setVista]           = useState('mapa') // mapa | graficos
  const [tipoGrafico, setTipoGrafico] = useState('barv')
  const [comparativa, setComparativa] = useState(false)
  const [opcionComparativa, setOpcionComparativa] = useState(null)
  const [modalZona, setModalZona] = useState(null)
  const [exportando, setExportando] = useState(false)

  const mapDivRef = useRef(null)

  const preguntasElegibles = useMemo(() =>
    (preguntas || []).filter(p => ['opcion_multiple', 'si_no'].includes(p.tipo) && p.clave_base !== 'participa'),
    [preguntas]
  )

  useEffect(() => {
    if (!preguntaId && preguntasElegibles.length > 0) setPreguntaId(preguntasElegibles[0].id)
  }, [preguntasElegibles, preguntaId])

  // Carga de datos — cacheados 2 minutos para no pegarle a Supabase por
  // cada cambio de pregunta/vista durante un operativo activo (la
  // encuesta entera se trae una sola vez, el filtrado por pregunta es
  // todo en memoria).
  useEffect(() => {
    if (!encuesta?.id) return
    let cancelled = false
    async function cargar() {
      setCargando(true); setError('')
      try {
        const keyCrudo = `rvz:crudo:${encuesta.id}`
        const keyZonas = `rvz:zonas:${encuesta.id}`
        let c = cacheGet(keyCrudo)
        let z = cacheGet(keyZonas)
        if (!c) {
          const { data, error: e1 } = await supabase.rpc('get_respuestas_crudas', {
            p_encuesta_id: encuesta.id, p_org_id: encuesta.organizacion_id,
            p_equipo_id: null, p_encuestador_id: null, p_fecha_desde: null, p_fecha_hasta: null,
          })
          if (e1) throw e1
          c = data || { columnas: [], filas: [] }
          cacheSet(keyCrudo, c, 120_000)
        }
        if (!z) {
          const { data, error: e2 } = await supabase.rpc('get_zonas_con_sesiones', { p_encuesta_id: encuesta.id })
          if (e2) throw e2
          z = Array.isArray(data) ? data : []
          cacheSet(keyZonas, z, 120_000)
        }
        if (!cancelled) { setCrudo(c); setZonas(z) }
      } catch (e) {
        console.error('ReporteVisualZona.cargar:', e)
        if (!cancelled) setError('No se pudieron cargar los datos del reporte visual.')
      }
      if (!cancelled) setCargando(false)
    }
    cargar()
    return () => { cancelled = true }
  }, [encuesta?.id])

  const preguntaActual = useMemo(() => preguntasElegibles.find(p => p.id === preguntaId) || null, [preguntasElegibles, preguntaId])

  const datos = useMemo(() => calcularDatosPregunta(preguntaActual, preguntas, crudo), [preguntaActual, preguntas, crudo])

  useEffect(() => {
    if (datos && (!opcionComparativa || !datos.ordenLegend.includes(opcionComparativa))) {
      setOpcionComparativa(datos.ordenLegend[0] || null)
    }
  }, [datos, opcionComparativa])

  async function capturarMapa() {
    if (!mapDivRef.current) return null
    await new Promise(r => setTimeout(r, 700)) // deja pintar tiles + polígonos recoloreados
    try {
      const { default: html2canvas } = await import('html2canvas')
      const canvas = await html2canvas(mapDivRef.current, { useCORS: true, allowTaint: true, logging: false, backgroundColor: '#ffffff', scale: 2 })
      return canvas.toDataURL('image/png')
    } catch (e) {
      console.error('captura mapa visual:', e)
      return null
    }
  }

  async function exportarPDF(modo) {
    if (!crudo || !zonas) return
    setExportando(true)
    const preguntaOriginal = preguntaId
    try {
      const lista = modo === 'todas' ? preguntasElegibles : [preguntaActual]
      const secciones = []
      for (const p of lista) {
        if (p.id !== preguntaId) { setPreguntaId(p.id); await new Promise(r => setTimeout(r, 50)) }
        const img = await capturarMapa()
        const d = calcularDatosPregunta(p, preguntas, crudo)
        secciones.push({ titulo: p.texto, img, leyendaHTML: leyendaHTML(d), resumenHTML: tablaResumenHTML(zonas, d), completoHTML: tablaCompletaHTML(zonas, d) })
      }
      if (preguntaId !== preguntaOriginal) setPreguntaId(preguntaOriginal)
      const html = generarHTMLVisual(secciones, encuesta, modo === 'todas')
      await generarPDF(html, `reporte-visual-${(encuesta?.nombre || 'encuesta').replace(/[^\w-]+/g, '_')}.pdf`)
    } catch (e) {
      console.error('exportarPDF visual:', e)
    }
    setExportando(false)
  }

  if (preguntasElegibles.length === 0) {
    return <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink3)', fontSize: 13 }}>Esta encuesta no tiene preguntas de opción múltiple para analizar por zona.</div>
  }

  if (!crudo || !zonas) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink3)', fontSize: 13 }}>
        {error ? <span style={{ color: 'var(--danger)' }}>{error}</span> : cargando ? 'Cargando datos…' : ''}
      </div>
    )
  }

  const btnGhost = { padding: '7px 12px', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', background: 'var(--paper)', fontSize: 12, fontFamily: 'DM Sans', cursor: 'pointer' }
  const btnActivo = (activo) => ({ ...btnGhost, borderColor: activo ? 'var(--accent)' : 'var(--border2)', background: activo ? 'var(--accent-light)' : 'var(--paper)', color: activo ? 'var(--accent)' : 'var(--ink3)', fontWeight: activo ? 700 : 400 })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Selector de pregunta + exportar */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', padding: '12px 16px' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>Pregunta</label>
          <Select value={preguntaId || ''} onChange={e => setPreguntaId(e.target.value)}
            style={{ padding: '8px 10px', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 13, fontFamily: 'DM Sans', background: 'var(--surface)' }}>
            {preguntasElegibles.map(p => <option key={p.id} value={p.id}>{p.texto}</option>)}
          </Select>
        </div>
        <button onClick={() => exportarPDF('actual')} disabled={exportando} style={btnGhost}>{exportando ? 'Generando…' : '↓ PDF (esta pregunta)'}</button>
        <button onClick={() => exportarPDF('todas')} disabled={exportando} style={{ ...btnGhost, background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 700 }}>{exportando ? 'Generando…' : '↓ PDF (todas las preguntas)'}</button>
      </div>

      {/* Toggle vista + tipo de gráfico */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button style={btnActivo(vista === 'mapa')} onClick={() => setVista('mapa')}>🗺️ Mapa</button>
        <button style={btnActivo(vista === 'graficos')} onClick={() => setVista('graficos')}>📊 Gráficos</button>
        {vista === 'graficos' && (
          <>
            <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
            {TIPOS_GRAFICO_VISUAL.map(t => (
              <button key={t.value} style={btnActivo(tipoGrafico === t.value)} onClick={() => setTipoGrafico(t.value)}>{t.label}</button>
            ))}
            <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
            <button style={btnActivo(comparativa)} onClick={() => setComparativa(v => !v)}>⇄ Vista comparativa</button>
          </>
        )}
      </div>

      {vista === 'mapa' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Leyenda datos={datos} />
          <div ref={mapDivRef} style={{ height: 520, width: '100%', borderRadius: 'var(--r2)', border: '1px solid var(--border)', overflow: 'hidden' }}>
            <MapaChoropleth containerRef={mapDivRef} zonas={zonas} datos={datos} onClickZona={setModalZona} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink3)' }}>Hacé clic en una zona para ver el detalle completo de respuestas.</div>
        </div>
      )}

      {vista === 'graficos' && (
        <GraficosZona zonas={zonas} datos={datos} tipoGrafico={tipoGrafico} comparativa={comparativa}
          opcionComparativa={opcionComparativa} setOpcionComparativa={setOpcionComparativa} />
      )}

      <ModalZonaDetalle info={modalZona} colores={datos?.colores || {}} onClose={() => setModalZona(null)} />
    </div>
  )
}
