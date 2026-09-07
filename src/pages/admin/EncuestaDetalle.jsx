import { useState, useEffect, useRef, useMemo, Fragment } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Topbar } from '../../components/layout'
import { Spinner, Select } from '../../components/ui'
import { Bar, Pie, Line, Doughnut } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  ArcElement, PointElement, LineElement, Tooltip, Legend, Filler
} from 'chart.js'
import { cacheGet, cacheSet, cacheClear } from '../../lib/cache'
import ReportesAutomaticos from '../../components/ReportesAutomaticos'
import ReporteVisualZona from '../../components/ReporteVisualZona'
import styles from './Page.module.css'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, PointElement, LineElement, Tooltip, Legend, Filler)

const ESTADO_CONFIG = {
  pendiente:    { label: 'Pendiente',    color: '#b45309', bg: 'var(--warning-light)' },
  en_proceso:   { label: 'En proceso',   color: '#0369a1', bg: 'var(--info-light)' },
  para_revisar: { label: 'Para revisar', color: '#7c3aed', bg: 'rgba(124,58,237,0.1)' },
  publicada:    { label: 'Publicada',    color: 'var(--accent)', bg: 'var(--accent-light)' },
  completada: { label: 'Completada', color: 'var(--ink2)', bg: 'var(--surface2)' },
}

// Paleta variada — cada índice de pregunta recibe colores distintos
const PALETAS = [
  ['#1a472a','#2d6a4f','#40916c','#52b788','#74c69d','#95d5b2'],
  ['#0369a1','#0284c7','#0ea5e9','#38bdf8','#7dd3fc','#bae6fd'],
  ['#7c3aed','#8b5cf6','#a78bfa','#c4b5fd','#6d28d9','#5b21b6'],
  ['#b45309','#d97706','#f59e0b','#fbbf24','#fcd34d','#fde68a'],
  ['#be185d','#db2777','#ec4899','#f472b6','#f9a8d4','#fce7f3'],
  ['#047857','#059669','#10b981','#34d399','#6ee7b7','#a7f3d0'],
]

const TIPOS_GRAFICO = [
  { value: 'bar',      label: '▌ Barras' },
  { value: 'pie',      label: '◕ Torta' },
  { value: 'doughnut', label: '◎ Rosquilla' },
  { value: 'line',     label: '↗ Líneas' },
]

const DEFAULT_TIPO = {
  si_no:           'doughnut',
  escala:          'bar',
  opcion_multiple: 'bar',
  texto_libre:     null,
}

/* ── Encabezado de columna ordenable (flechita ▲▼) ── */
function ThSort({ label, campo, sort, onSort, align = 'left' }) {
  const activo = sort.campo === campo
  return (
    <th
      onClick={() => onSort(campo)}
      style={{
        padding: '10px 16px', textAlign: align, fontSize: 12, fontWeight: 700,
        color: activo ? 'var(--ink)' : 'var(--ink3)', cursor: 'pointer',
        userSelect: 'none', whiteSpace: 'nowrap',
      }}
    >
      {label}
      <span style={{ marginLeft: 4, opacity: activo ? 1 : 0.3 }}>
        {activo ? (sort.dir === 'asc' ? '▲' : '▼') : '▲'}
      </span>
    </th>
  )
}

function alternarOrden(campo, setSort) {
  setSort(prev => prev.campo === campo ? { campo, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { campo, dir: 'desc' })
}

function ordenarLista(lista, sort, getValor) {
  if (!sort.campo) return lista
  const dir = sort.dir === 'asc' ? 1 : -1
  return [...lista].sort((a, b) => {
    const va = getValor(a, sort.campo)
    const vb = getValor(b, sort.campo)
    if (typeof va === 'string' || typeof vb === 'string') {
      return String(va ?? '').localeCompare(String(vb ?? '')) * dir
    }
    return ((va ?? 0) - (vb ?? 0)) * dir
  })
}

/* ── Tabla para preguntas de tipo Matriz ── */
function MatrizTabla({ pregunta, filas, color }) {
  const filasDef    = (pregunta.config_matriz?.filas    || []).map(f => typeof f === 'string' ? f : f.texto || f)
  const columnasDef = (pregunta.config_matriz?.columnas || []).map(c => typeof c === 'string' ? c : c.texto || c)

  const conteo = {}
  filasDef.forEach(f => {
    conteo[f] = {}
    columnasDef.forEach(c => { conteo[f][c] = 0 })
  })

  filas.forEach(resp => {
    try {
      const val = typeof resp.valor_texto === 'string' 
        ? JSON.parse(resp.valor_texto) 
        : resp.valor_texto
      
      if (val && typeof val === 'object') {
        Object.entries(val).forEach(([fi, col]) => {
          const filaTexto = isNaN(Number(fi)) ? fi : filasDef[Number(fi)]
          if (filaTexto && conteo[filaTexto] && columnasDef.includes(col)) {
            conteo[filaTexto][col] = (conteo[filaTexto][col] || 0) + Number(resp.cantidad || 1)
          }
        })
      }
    } catch (e) {
      console.warn('Error parseando respuesta de matriz:', e)
    }
  })

  if (!filasDef.length || !columnasDef.length) {
    return (
      <div style={{ 
        color: 'var(--ink3)', 
        fontSize: 13, 
        padding: '40px 0', 
        textAlign: 'center' 
      }}>
        Sin configuración de matriz
      </div>
    )
  }

  const totalesFila = filasDef.map(f => 
    columnasDef.reduce((s, c) => s + (conteo[f]?.[c] || 0), 0)
  )

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ 
        borderCollapse: 'collapse', 
        fontSize: 12, 
        width: '100%', 
        minWidth: `${columnasDef.length * 85 + 200}px` 
      }}>
        <thead>
          <tr style={{ background: 'var(--surface)', borderBottom: '2px solid var(--border)' }}>
            <th style={{ 
              padding: '10px 14px', 
              textAlign: 'left', 
              fontSize: 11, 
              fontWeight: 700, 
              color: 'var(--ink3)', 
              textTransform: 'uppercase', 
              letterSpacing: 0.5,
              width: 200 
            }} />
            {columnasDef.map(col => (
              <th key={col} style={{ 
                padding: '10px 12px', 
                textAlign: 'center', 
                fontSize: 11, 
                fontWeight: 700, 
                color: 'var(--ink3)', 
                textTransform: 'uppercase', 
                letterSpacing: 0.5 
              }}>
                {col}
              </th>
            ))}
            <th style={{ 
              padding: '10px 12px', 
              textAlign: 'center', 
              fontSize: 11, 
              fontWeight: 700, 
              color: 'var(--ink3)' 
            }}>
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {filasDef.map((fila, fi) => {
            const totalFila = totalesFila[fi]
            return (
              <tr key={fi} style={{ 
                borderBottom: '1px solid var(--border)', 
                background: fi % 2 === 0 ? 'var(--paper)' : 'var(--surface)' 
              }}>
                <td style={{ 
                  padding: '10px 14px', 
                  fontSize: 13, 
                  fontWeight: 600, 
                  color: 'var(--ink)', 
                  verticalAlign: 'middle' 
                }}>
                  {fila}
                </td>
                {columnasDef.map(col => {
                  const n = conteo[fila]?.[col] || 0
                  const pct = totalFila > 0 ? Math.round(n / totalFila * 100) : 0
                  return (
                    <td key={col} style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                      <div style={{ 
                        fontSize: 15, 
                        fontWeight: 700, 
                        color: n > 0 ? color : 'var(--ink3)' 
                      }}>
                        {n}
                      </div>
                      {n > 0 && (
                        <div style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 1 }}>
                          {pct}%
                        </div>
                      )}
                    </td>
                  )
                })}
                <td style={{ 
                  padding: '10px 12px', 
                  textAlign: 'center', 
                  fontFamily: 'var(--font-num)', 
                  fontSize: 13, 
                  fontWeight: 500, 
                  fontVariantNumeric: 'tabular-nums', 
                  color: 'var(--ink2)' 
                }}>
                  {totalFila}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Dispatcher — evita hooks condicionales: cada rama es su propio componente.
function PreguntaChart({ pregunta, filas, paletaIdx }) {
  if (pregunta.tipo === 'matriz') return <PreguntaMatriz pregunta={pregunta} filas={filas} paletaIdx={paletaIdx} />
  return <PreguntaChartBase pregunta={pregunta} filas={filas} paletaIdx={paletaIdx} />
}

function PreguntaMatriz({ pregunta, filas, paletaIdx }) {
  const colorPrincipal = PALETAS[paletaIdx % PALETAS.length][0]
  const totalRespuestas = (filas || []).reduce((sum, f) => sum + Number(f.cantidad || 1), 0)
  return (
    <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', padding: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: colorPrincipal, flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{pregunta.texto}</div>
          <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>Matriz · {totalRespuestas} respuestas</div>
        </div>
      </div>
      <MatrizTabla pregunta={pregunta} filas={filas || []} color={colorPrincipal} />
    </div>
  )
}

function PreguntaChartBase({ pregunta, filas, paletaIdx }) {
  const { tipo } = pregunta
  const paleta = PALETAS[paletaIdx % PALETAS.length]
  const opciones  = pregunta.opciones_pregunta || []
  const [tipoGrafico, setTipoGrafico] = useState(DEFAULT_TIPO[tipo] || 'bar')

  const datos = useMemo(() => {
    if (tipo === 'texto_libre') return null
    const conteo = {}

    if (tipo === 'si_no') {
      filas.forEach(f => {
        let key = null
        if (f.valor_texto === 'Sí' || f.valor_booleano === true)  key = 'Sí'
        if (f.valor_texto === 'No' || f.valor_booleano === false)  key = 'No'
        if (key) conteo[key] = (conteo[key] || 0) + Number(f.cantidad)
      })
      if (!('Sí' in conteo)) conteo['Sí'] = 0
      if (!('No' in conteo)) conteo['No'] = 0

    } else if (tipo === 'escala') {
      const valores = [...new Set(filas.map(f => Number(f.valor_numero)).filter(v => !isNaN(v) && v > 0))].sort((a,b) => a-b)
      valores.forEach(v => {
        const fila = filas.find(f => Number(f.valor_numero) === v)
        conteo[String(v)] = fila ? Number(fila.cantidad) : 0
      })

    } else if (tipo === 'opcion_multiple' || tipo === 'opcion_simple') {
      opciones.forEach(op => {
        const fila = filas.find(f =>
          f.valor_texto === op.texto ||           
          f.opcion_texto === op.texto ||           
          f.opcion_id === op.id                    
        )
        conteo[op.texto] = fila ? Number(fila.cantidad) : 0
      })

    } else {
      return null
    }

    const labels = Object.keys(conteo)
    const values = Object.values(conteo)
    const total  = values.reduce((a, b) => a + b, 0)
    if (total === 0) return null

    const isPie  = tipoGrafico === 'pie' || tipoGrafico === 'doughnut'
    const isLine = tipoGrafico === 'line'
    const isBar  = tipoGrafico === 'bar'

    return {
      labels,
      datasets: [{
        label: pregunta.texto,
        data: values,
        backgroundColor: isPie
          ? paleta.slice(0, labels.length)
          : isLine
            ? `${paleta[0]}33`
            : paleta.slice(0, labels.length),
        borderColor: isLine ? paleta[0] : isPie ? '#fff' : undefined,
        borderWidth: isPie ? 2 : isLine ? 2.5 : 0,
        borderRadius: isBar ? 6 : 0,
        borderSkipped: false,
        fill: isLine,
        tension: 0.4,
        pointBackgroundColor: isLine ? paleta[0] : undefined,
        pointRadius: isLine ? 5 : undefined,
        pointHoverRadius: isLine ? 7 : undefined,
      }],
      total,
    }
  }, [filas, opciones, tipo, tipoGrafico, paleta, pregunta.texto])

  const chartOptions = useMemo(() => {
    const isPie  = tipoGrafico === 'pie' || tipoGrafico === 'doughnut'
    const total  = datos?.total || 1
    return {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: {
          display: isPie,
          position: 'bottom',
          labels: { font: { family: 'DM Sans', size: 11 }, padding: 14, boxWidth: 12 },
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const val = ctx.parsed?.y ?? ctx.parsed
              return ` ${ctx.label}: ${val} (${Math.round(val / total * 100)}%)`
            }
          },
          bodyFont: { family: 'DM Sans' },
          titleFont: { family: 'DM Sans' },
        },
      },
      scales: isPie ? {} : {
        x: { grid: { display: false }, ticks: { font: { family: 'DM Sans', size: 11 } } },
        y: { beginAtZero: true, grid: { color: 'var(--surface2)' }, ticks: { stepSize: 1, font: { family: 'DM Sans', size: 11 } } },
      },
    }
  }, [tipoGrafico, datos?.total])

  const card = { background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', padding: '16px 20px' }
  const btnStyle = (v) => ({
    padding: '3px 10px', borderRadius: 100, fontSize: 11, fontFamily: 'DM Sans', cursor: 'pointer',
    border: `1.5px solid ${tipoGrafico === v ? paleta[0] : 'var(--border2)'}`,
    background: tipoGrafico === v ? `${paleta[0]}18` : 'var(--paper)',
    color: tipoGrafico === v ? paleta[0] : 'var(--ink3)',
    fontWeight: tipoGrafico === v ? 700 : 400,
    transition: 'all .15s',
  })

  // Texto libre
  if (tipo === 'texto_libre') {
    const textos = filas.filter(f => f.valor_texto?.trim())
    const total  = textos.reduce((s, f) => s + Number(f.cantidad), 0)
    return (
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: paleta[0], flexShrink: 0 }} />
          <div style={{ fontSize: 13, fontWeight: 700 }}>{pregunta.texto}</div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 8 }}>{total} respuestas · texto libre</div>
        {textos.length === 0
          ? <div style={{ fontSize: 13, color: 'var(--ink3)' }}>Sin respuestas aún</div>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 200, overflowY: 'auto' }}>
              {textos.slice(0, 20).map((f, i) => (
                <div key={i} style={{ fontSize: 12, padding: '6px 10px', background: `${paleta[0]}10`, borderLeft: `3px solid ${paleta[0]}`, borderRadius: '0 var(--r) var(--r) 0', color: 'var(--ink2)' }}>
                  "{f.valor_texto}"
                </div>
              ))}
              {textos.length > 20 && <div style={{ fontSize: 11, color: 'var(--ink3)', textAlign: 'center' }}>+ {textos.length - 20} más</div>}
            </div>
        }
      </div>
    )
  }

  const tiposDisponibles = tipo === 'escala' ? TIPOS_GRAFICO : TIPOS_GRAFICO.filter(t => t.value !== 'line')
  const ChartComp = { bar: Bar, pie: Pie, doughnut: Doughnut, line: Line }[tipoGrafico]
  const chartHeight = (tipoGrafico === 'pie' || tipoGrafico === 'doughnut') ? 220 : 190

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: paleta[0], flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{pregunta.texto}</div>
            {datos && <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>{datos.total} respuestas</div>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {tiposDisponibles.map(t => (
            <button key={t.value} style={btnStyle(t.value)} onClick={() => setTipoGrafico(t.value)}>{t.label}</button>
          ))}
        </div>
      </div>
      {!datos
        ? <div style={{ fontSize: 13, color: 'var(--ink3)', padding: '20px 0', textAlign: 'center' }}>Sin respuestas aún</div>
        : <div style={{ height: chartHeight }}>
            <ChartComp data={datos} options={chartOptions} />
          </div>
      }
    </div>
  )
}

function VistaProduccion({ encuesta, preguntas }) {
  const cfg = ESTADO_CONFIG[encuesta.estado_produccion] || ESTADO_CONFIG.pendiente
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: cfg.bg, border: `1px solid ${cfg.color}40`, borderRadius: 'var(--r2)', padding: '20px 24px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: cfg.color, marginBottom: 4 }}>Estado: {cfg.label}</div>
        <div style={{ fontSize: 13, color: 'var(--ink2)' }}>
          {encuesta.estado_produccion === 'pendiente'    && 'Tu solicitud fue recibida. Nuestro equipo está trabajando en el diseño.'}
          {encuesta.estado_produccion === 'en_proceso'   && 'Estamos armando las preguntas y configurando la encuesta.'}
          {encuesta.estado_produccion === 'para_revisar' && 'La encuesta está lista para tu revisión y aprobación.'}
        </div>
      </div>
      {encuesta.descripcion && (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', padding: '16px 20px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)', marginBottom: 6 }}>Descripción</div>
          <div style={{ fontSize: 13, color: 'var(--ink2)' }}>{encuesta.descripcion}</div>
        </div>
      )}
      {(encuesta.fecha_inicio || encuesta.fecha_fin) && (
        <div style={{ background: 'var(--accent-light)', border: '1px solid #b7e4c7', borderRadius: 'var(--r2)', padding: '14px 18px', display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent2)' }}>📅 Programación</span>
          {encuesta.fecha_inicio && (
            <span style={{ fontSize: 13, color: 'var(--accent2)' }}>
              Inicio: <strong>{new Date(encuesta.fecha_inicio + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>
            </span>
          )}
          {encuesta.fecha_fin && (
            <span style={{ fontSize: 13, color: 'var(--accent2)' }}>
              Cierre: <strong>{new Date(encuesta.fecha_fin + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>
            </span>
          )}
        </div>
      )}
      {preguntas.length > 0 && (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', padding: '16px 20px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)', marginBottom: 12 }}>Vista previa — {preguntas.length} preguntas</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {preguntas.map((p, i) => (
              <div key={p.id} style={{ display: 'flex', gap: 12, padding: '10px 12px', background: 'var(--surface)', borderRadius: 'var(--r)' }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{p.texto}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>
                    {p.tipo === 'escala' && 'Escala 1-10'}
                    {p.tipo === 'si_no' && 'Sí / No'}
                    {p.tipo === 'opcion_multiple' && `Opción múltiple (${p.opciones_pregunta?.length || 0} opciones)`}
                    {p.tipo === 'texto_libre' && 'Respuesta libre'}
                    {!p.requerida && ' · Opcional'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Mapa de respuestas GPS para EncuestaDetalle ── */
const PALETA_MAPA_DET = ['#1a472a','#0369a1','#7c3aed','#b45309','#be185d','#047857','#dc2626','#d97706','#0891b2','#6d28d9']

function MapaEncuesta({ sesiones, columnas, onCargar, loading }) {
  const mapRef    = useRef(null)
  const instRef   = useRef(null)
  const capasRef  = useRef([])
  const fittedRef = useRef(false)
  const [L, setL] = useState(null)
  const [listo, setListo] = useState(0)
  const [filtroCol, setFiltroCol] = useState('')
  const [capas, setCapas] = useState({})

  const valoresUnicos = useMemo(() => {
    if (!filtroCol) return []
    return [...new Set((sesiones||[]).map(s => s.respuestas?.[filtroCol]).filter(Boolean))].sort()
  }, [filtroCol, sesiones])

  useEffect(() => {
    const e = {}; valoresUnicos.forEach(v => { e[v] = true }); setCapas(e)
  }, [valoresUnicos.join('|')])

  const colorPorValor = useMemo(() => {
    const m = {}; valoresUnicos.forEach((v,i) => { m[v] = PALETA_MAPA_DET[i % PALETA_MAPA_DET.length] }); return m
  }, [valoresUnicos.join('|')])

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
    if (!L || !mapRef.current) return
    const loadScript = (url) => new Promise(res => {
      if (document.querySelector(`script[src="${url}"]`)) return res()
      const s = document.createElement('script'); s.src = url; s.onload = res; s.onerror = res; document.head.appendChild(s)
    })
    const loadCSS = (url) => {
      if (!document.querySelector(`link[href="${url}"]`)) {
        const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = url; document.head.appendChild(l)
      }
    }
    loadCSS('https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.Default.min.css')
    loadCSS('https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.min.css')
    const initMap = () => {
      if (instRef.current) return
      const rect = mapRef.current?.getBoundingClientRect()
      if (!rect || rect.width === 0 || rect.height === 0) return
      instRef.current = L.map(mapRef.current, { zoomControl: true }).setView([-27.5, -55.8], 12)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(instRef.current)
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.min.js')
        .then(() => setListo(p => p + 1))
      ro.disconnect()
    }
    const ro = new ResizeObserver(initMap)
    ro.observe(mapRef.current)
    initMap()
    return () => { ro.disconnect(); if (instRef.current) { instRef.current.remove(); instRef.current = null } }
  }, [L])

  useEffect(() => {
    const mapa = instRef.current; if (!mapa) return
    capasRef.current.forEach(lg => { try { mapa.removeLayer(lg) } catch {} })
    capasRef.current = []
    const puntos = (sesiones||[]).filter(s => s.lat && s.lng)
    if (!puntos.length) return
    const grupos = {}
    puntos.forEach(s => {
      const resp = filtroCol ? (s.respuestas?.[filtroCol]||null) : '__all__'
      if (filtroCol && !resp) return
      if (filtroCol && resp && capas[resp] === false) return
      if (!grupos[resp]) grupos[resp] = []
      grupos[resp].push(s)
    })
    const todosVisibles = []
    const tieneCluster = !!window.L?.MarkerClusterGroup
    Object.entries(grupos).forEach(([resp, pts]) => {
      const color = (resp !== '__all__' && filtroCol) ? (colorPorValor[resp] || 'var(--ink4)') : 'var(--accent)'
      const layer = tieneCluster
        ? L.markerClusterGroup({ maxClusterRadius: 50, showCoverageOnHover: false,
            iconCreateFunction: (cluster) => {
              const n = cluster.getChildCount(); const sz = n < 10 ? 34 : n < 100 ? 40 : 46
              return L.divIcon({ className: '', html: `<div style="width:${sz}px;height:${sz}px;border-radius:50%;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${sz<38?12:14}px;border:3px solid rgba(255,255,255,.9);box-shadow:0 2px 8px rgba(0,0,0,.35)">${n}</div>`, iconSize: [sz,sz], iconAnchor: [sz/2,sz/2] }) }})
        : L.layerGroup()
      pts.forEach(s => {
        todosVisibles.push(s)
        const icono = L.divIcon({ className: '', html: `<div style="width:13px;height:13px;border-radius:50%;background:${color};border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>`, iconSize:[13,13], iconAnchor:[6,6] })
        const popup = `<div style="font-family:DM Sans,sans-serif;font-size:12px;line-height:1.6"><b>${s.encuestador||'—'}</b>${resp!=='__all__'?`<br><span style="color:${color};font-weight:700">${resp}</span>`:''}<br><span style="color:#9ca3af;font-size:10px">${s.fecha?new Date(s.fecha).toLocaleDateString('es-AR',{day:'2-digit',month:'short',year:'numeric'}):'—'}</span></div>`
        L.marker([s.lat, s.lng], { icon: icono }).bindPopup(popup).addTo(layer)
      })
      layer.addTo(mapa); capasRef.current.push(layer)
    })
    if (todosVisibles.length > 0 && !fittedRef.current) {
      mapa.fitBounds(L.latLngBounds(todosVisibles.map(s => [s.lat, s.lng])), { padding: [40,40], maxZoom: 16 })
      fittedRef.current = true
    }
  }, [sesiones, filtroCol, capas, colorPorValor, listo, L])

  useEffect(() => () => {
    capasRef.current.forEach(lg => { try { if (instRef.current) instRef.current.removeLayer(lg) } catch {} })
    if (instRef.current) { instRef.current.remove(); instRef.current = null }
  }, [])

  const puntos = (sesiones||[]).filter(s => s.lat && s.lng)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', padding: '14px 16px' }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>Colorear por respuesta a</label>
          <Select value={filtroCol} onChange={e => { setFiltroCol(e.target.value); setCapas({}) }}
            style={{ padding: '8px 10px', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 13, fontFamily: 'DM Sans', background: 'var(--surface)', color: 'var(--ink)', outline: 'none' }}>
            <option value="">— Todos los puntos (un color) —</option>
            {columnas.map(c => <option key={c.id} value={c.id}>{c.texto?.slice(0,68)}</option>)}
          </Select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, paddingBottom: 2 }}>
          <strong>{puntos.length}</strong> con GPS
          {(sesiones||[]).length - puntos.length > 0 && <span style={{ color: 'var(--ink4)' }}>· {(sesiones||[]).length - puntos.length} sin GPS</span>}
        </div>
        {puntos.length === 0 && !loading && (
          <button onClick={onCargar} style={{ padding: '7px 14px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Sans' }}>
            Cargar mapa
          </button>
        )}
      </div>
      {loading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink3)' }}>Cargando datos GPS...</div>}
      {!loading && puntos.length === 0 && (sesiones||[]).length === 0 && (
        <div style={{ textAlign: 'center', padding: 64, color: 'var(--ink3)', fontSize: 14, background: 'var(--paper)', borderRadius: 'var(--r2)', border: '1px solid var(--border)' }}>
          📍 Hacé clic en "Cargar mapa" para ver las respuestas georreferenciadas
        </div>
      )}
      <div ref={mapRef} style={{ height: 520, width: '100%', borderRadius: 'var(--r2)', border: '1px solid var(--border)', overflow: 'hidden', display: puntos.length === 0 ? 'none' : 'block' }} />
    </div>
  )
}


function PorZonaTabla({ statsZona, loading, onCargar }) {
  const [abiertas, setAbiertas] = useState({})
  const [sort, setSort] = useState({ campo: null, dir: 'desc' })
  useEffect(() => { if (!statsZona && !loading) onCargar() }, [])

  if (loading && !statsZona) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink3)', fontSize: 13 }}>Cargando zonas…</div>
  if (!statsZona) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink3)', fontSize: 13 }}><button onClick={onCargar} style={{ padding: '6px 14px', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', background: 'var(--paper)', cursor: 'pointer', fontSize: 13 }}>Cargar estadísticas por zona</button></div>

  const zonas = ordenarLista(statsZona.por_zona || [], sort, (z, campo) => z[campo])
  const tot   = statsZona.totales || {}
  const td = { padding: '9px 16px', fontSize: 13 }
  const tdR = { ...td, textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-num)', fontVariantNumeric: 'tabular-nums' }
  const nz = (n, col) => ({ ...tdR, color: n === 0 ? 'var(--metric-zero)' : col })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: 'var(--ink2)' }}>
        <span><b style={{ fontFamily: 'var(--font-num)', fontSize: 16, fontWeight: 500 }}>{tot.total ?? 0}</b> encuestas</span>
        <span style={{ color: 'var(--accent)' }}><b style={{ fontFamily: 'var(--font-num)', fontSize: 16, fontWeight: 500 }}>{tot.completadas ?? 0}</b> completadas</span>
        <span style={{ color: 'var(--danger)' }}><b style={{ fontFamily: 'var(--font-num)', fontSize: 16, fontWeight: 500 }}>{tot.no_respuesta ?? 0}</b> no respuesta</span>
        {tot.sin_zona > 0 && <span style={{ color: 'var(--gold)' }}><b style={{ fontFamily: 'var(--font-num)', fontSize: 16, fontWeight: 500 }}>{tot.sin_zona}</b> sin zona</span>}
        {tot.fuera_de_poligono > 0 && <span style={{ color: 'var(--ink3)' }} title="El GPS cayó fuera del polígono; se asignó la zona más cercana">{tot.fuera_de_poligono} fuera de polígono</span>}
      </div>
      <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
              <ThSort label="Zona" campo="zona_nombre" sort={sort} onSort={c => alternarOrden(c, setSort)} />
              <ThSort label="Equipo" campo="equipo_nombre" sort={sort} onSort={c => alternarOrden(c, setSort)} />
              <ThSort label="Completadas" campo="completadas" sort={sort} onSort={c => alternarOrden(c, setSort)} align="right" />
              <ThSort label="No respuesta" campo="no_respuesta" sort={sort} onSort={c => alternarOrden(c, setSort)} align="right" />
              <ThSort label="Total" campo="total" sort={sort} onSort={c => alternarOrden(c, setSort)} align="right" />
            </tr>
          </thead>
          <tbody>
            {zonas.map((z, i) => {
              const key = z.zona_id || 'sin-zona'
              const open = !!abiertas[key]
              return (
                <Fragment key={key}>
                  <tr onClick={() => setAbiertas(p => ({ ...p, [key]: !p[key] }))}
                    style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--paper)' : 'var(--surface)', cursor: 'pointer' }}>
                    <td style={{ ...td, fontWeight: 600 }}>
                      <span style={{ display: 'inline-block', width: 14, color: 'var(--ink3)' }}>{open ? '▾' : '▸'}</span>
                      {z.zona_nombre}
                      {z.fuera_de_poligono > 0 && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--ink3)' }}>({z.fuera_de_poligono} aprox.)</span>}
                    </td>
                    <td style={{ ...td, color: 'var(--ink3)' }}>{z.equipo_nombre || '—'}</td>
                    <td style={nz(z.completadas, 'var(--accent)')}>{z.completadas}</td>
                    <td style={nz(z.no_respuesta, 'var(--danger)')}>{z.no_respuesta}</td>
                    <td style={{ ...tdR, color: 'var(--ink2)' }}>{z.total}</td>
                  </tr>
                  {open && (z.encuestadores || []).map(e => (
                    <tr key={key + e.encuestador_id} style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
                      <td style={{ ...td, paddingLeft: 38, color: 'var(--ink2)' }} colSpan={2}>{e.nombre || '—'}</td>
                      <td style={nz(e.completadas, 'var(--accent)')}>{e.completadas}</td>
                      <td style={nz(e.no_respuesta, 'var(--danger)')}>{e.no_respuesta}</td>
                      <td style={{ ...tdR, color: 'var(--ink2)' }}>{e.total}</td>
                    </tr>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SnapshotLista({ titulo, items, color }) {
  if (!items?.length) return null
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{titulo} ({items.length})</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {items.map(x => <span key={x.id || x.zona_id} style={{ fontSize: 12, background: color, color: 'var(--ink2)', borderRadius: 100, padding: '3px 10px' }}>{x.nombre || x.zona_nombre}</span>)}
      </div>
    </div>
  )
}

function EquiposSnapshot({ snap }) {
  if (!snap) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink3)', fontSize: 13 }}>Todavía no hay foto de equipos para esta encuesta. Se genera al publicarla.</div>
  const equipos = snap.equipos || []
  const sinEquipo = snap.zonas_sin_equipo || []
  const Lista = SnapshotLista
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 12, color: 'var(--ink3)' }}>
        Configuración registrada {snap.capturado_en ? `el ${new Date(snap.capturado_en).toLocaleDateString('es-AR')}` : ''} — no cambia aunque se reconfiguren los equipos para otras encuestas.
      </div>
      {equipos.map((eq, i) => (
        <div key={eq.equipo_id || i} style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', padding: '14px 18px' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>{eq.equipo_nombre}</div>
          <Lista titulo="Coordinadores" items={eq.coordinadores} color="var(--metric-c-bg)" />
          <Lista titulo="Encuestadores del equipo" items={eq.encuestadores} color="var(--surface2)" />
          <Lista titulo="Encuestadores que trabajaron" items={eq.encuestadores_que_trabajaron} color="var(--metric-a-bg)" />
          <Lista titulo="Zonas" items={eq.zonas} color="var(--metric-b-bg)" />
        </div>
      ))}
      {sinEquipo.length > 0 && (
        <div style={{ background: 'var(--paper)', border: '1px dashed var(--border2)', borderRadius: 'var(--r2)', padding: '12px 18px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink3)' }}>Zonas sin equipo asignado</div>
          <Lista titulo="Zonas" items={sinEquipo} color="var(--surface)" />
        </div>
      )}
    </div>
  )
}

function VistaResultados({ encuesta, preguntas, resumen, respuestas, encuestadores, equipos, filtros, onFiltroChange, loadingR, sesionesGPS, onCargarMapa, loadingGPS, statsZona, onCargarZonas, loadingZonas, configSnapshot, tiempoStats }) {
  const [vista, setVista] = useState('resumen')
  const [subVistaAnalisis, setSubVistaAnalisis] = useState('visual') // 'visual' | 'reportes' — sub-selector de la tab fusionada "Análisis y reportes"
  const [encZonasAbiertas, setEncZonasAbiertas] = useState({})
  const [sortEnc, setSortEnc] = useState({ campo: null, dir: 'desc' })

  const filasPorPregunta = useMemo(() => {
    const map = {}
    preguntas.forEach(p => { map[String(p.id)] = [] })
    // Incluir TODAS las respuestas, incluso de preguntas base (participa, edad, etc.)
    respuestas.forEach(f => {
      if (!map[String(f.pregunta_id)]) map[String(f.pregunta_id)] = []
      map[String(f.pregunta_id)].push(f)
    })
    return map
  }, [respuestas, preguntas])

  // Razones de no respuesta (pregunta con clave_base = 'participa', valores != 'Sí')
  const razonesNoResp = useMemo(() => {
    const pregParticipa = preguntas.find(p => p.clave_base === 'participa')
    if (!pregParticipa) return []
    const filas = filasPorPregunta[String(pregParticipa.id)] || []
    return filas.filter(f => f.valor_texto && f.valor_texto !== 'Sí')
  }, [preguntas, filasPorPregunta])

  const encuestadoresFiltrados = useMemo(() =>
    filtros.equipo_id ? encuestadores.filter(e => e.equipo_id === filtros.equipo_id) : encuestadores,
    [encuestadores, filtros.equipo_id]
  )

  const encuestadoresOrdenados = useMemo(() =>
    ordenarLista(encuestadoresFiltrados, sortEnc, (e, campo) =>
      campo === 'completadas' ? (e.completadas ?? e.total) : e[campo]
    ),
    [encuestadoresFiltrados, sortEnc]
  )

  const kpis = [
    { label: 'Respuestas',       value: resumen?.total_participaron || 0, color: 'var(--metric-a)' },
    { label: 'Encuestadores',    value: resumen?.encuestadores      || 0, color: 'var(--metric-b)' },
    { label: 'Equipos activos',  value: resumen?.equipos            || 0, color: 'var(--metric-c)' },
    { label: 'Última respuesta', value: resumen?.ultima_respuesta ? new Date(resumen.ultima_respuesta).toLocaleDateString('es-AR') : '—', color: 'var(--metric-d)' },
  ]

  const promedioSeg     = tiempoStats?.promedio_segundos != null ? Number(tiempoStats.promedio_segundos) : null
  const objetivoMin     = tiempoStats?.tiempo_objetivo_minutos ?? null
  const dentroObjetivo  = promedioSeg != null && objetivoMin != null ? promedioSeg <= objetivoMin * 60 : null
  const formatMinSeg = (seg) => {
    const m = Math.floor(seg / 60)
    const s = Math.round(seg % 60)
    return `${m}m ${s}s`
  }

  const hayFiltros = filtros.equipo_id || filtros.encuestador_id || filtros.fecha_desde || filtros.fecha_hasta
  const inp = { padding: '6px 10px', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 13, fontFamily: 'DM Sans', background: 'var(--paper)' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {kpis.map((k, i) => (
          <div key={i} style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', padding: '14px 18px', borderTop: `3px solid ${k.color}` }}>
            <div style={{ fontFamily: 'var(--font-num)', fontSize: 24, fontWeight: 500, color: (k.value === 0 || k.value === '0') ? 'var(--metric-zero)' : k.color, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>{k.value}</div>
            <div style={{ fontSize: 12, color: 'var(--ink3)', fontWeight: 600, marginTop: 2 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Tiempo promedio vs. objetivo */}
      {promedioSeg != null && (
        <div style={{
          background: objetivoMin == null ? 'var(--paper)' : dentroObjetivo ? '#d8f3dc' : '#fee2e2',
          border: `1px solid ${objetivoMin == null ? 'var(--border)' : dentroObjetivo ? '#1a472a' : '#991b1b'}`,
          borderRadius: 'var(--r2)', padding: '14px 18px',
          display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1 }}>⏱️ Tiempo promedio</div>
            <div style={{ fontFamily: 'var(--font-num)', fontSize: 22, fontWeight: 600, marginTop: 2 }}>{formatMinSeg(promedioSeg)}</div>
          </div>
          {objetivoMin != null && (
            <div style={{ fontSize: 13, fontWeight: 600, color: dentroObjetivo ? '#1a472a' : '#991b1b' }}>
              {dentroObjetivo ? '🟢 Dentro del objetivo' : '🔴 Por encima del objetivo'} (objetivo: {objetivoMin} min)
            </div>
          )}
        </div>
      )}

      {/* Filtros */}
      <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', padding: '12px 16px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)' }}>Equipo</label>
          <Select value={filtros.equipo_id || ''} onChange={e => onFiltroChange('equipo_id', e.target.value || null)} style={inp}>
            <option value="">Todos</option>
            {equipos.map(eq => <option key={eq.id} value={eq.id}>{eq.nombre}</option>)}
          </Select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)' }}>Encuestador</label>
          <Select value={filtros.encuestador_id || ''} onChange={e => onFiltroChange('encuestador_id', e.target.value || null)} disabled={!filtros.equipo_id} style={inp}>
            <option value="">Todos</option>
            {encuestadoresFiltrados.map(e => <option key={e.encuestador_id} value={e.encuestador_id}>{e.nombre_completo}</option>)}
          </Select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)' }}>Desde</label>
          <input type="date" value={filtros.fecha_desde || ''} onChange={e => onFiltroChange('fecha_desde', e.target.value || null)} style={inp} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)' }}>Hasta</label>
          <input type="date" value={filtros.fecha_hasta || ''} onChange={e => onFiltroChange('fecha_hasta', e.target.value || null)} style={inp} />
        </div>
        {hayFiltros && <button onClick={() => onFiltroChange('_reset', null)} style={{ ...inp, cursor: 'pointer', alignSelf: 'flex-end' }}>Limpiar</button>}
        {loadingR && <span style={{ fontSize: 11, color: 'var(--ink3)', alignSelf: 'flex-end', paddingBottom: 8 }}>Actualizando...</span>}
      </div>

      {/* Razones de no respuesta */}
      {razonesNoResp.length > 0 && (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--danger)', borderRadius: 'var(--r2)', padding: '14px 18px', borderLeft: '4px solid var(--danger)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            📋 Razones de no-respuesta — {razonesNoResp.reduce((s, f) => s + Number(f.cantidad), 0)} registros
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {razonesNoResp.map((f, i) => (
              <div key={i} style={{ background: 'var(--danger-light)', borderRadius: 'var(--r)', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 600 }}>{f.valor_texto}</span>
                <span style={{ fontSize: 16, fontWeight: 500, color: 'var(--danger)', fontFamily: 'var(--font-num)', fontVariantNumeric: 'tabular-nums' }}>{f.cantidad}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)' }}>
        {[['resumen','Resumen'],['preguntas','Por pregunta'],['encuestadores','Encuestadores'],['zonas','📍 Por zona'],['equipos','👥 Equipos'],['mapa','🗺️ Mapa'],['analisis','📊 Análisis y reportes']].map(([v, label]) => (
          <button key={v} onClick={() => setVista(v)} style={{
            padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 13, fontFamily: 'DM Sans', marginBottom: -1,
            fontWeight: vista === v ? 700 : 400,
            color: vista === v ? 'var(--accent)' : 'var(--ink3)',
            borderBottom: vista === v ? '2px solid var(--accent)' : '2px solid transparent',
          }}>{label}</button>
        ))}
      </div>

      {vista === 'resumen' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 }}>
          {preguntas.filter(p => !p.clave_base || p.clave_base === 'edad' || p.clave_base === 'sexo').slice(0, 4).map((p, i) => (
            <PreguntaChart key={p.id} pregunta={p} filas={filasPorPregunta[String(p.id)] || []} paletaIdx={i} />
          ))}
        </div>
      )}

      {vista === 'preguntas' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {preguntas.filter(p => p.clave_base !== 'participa').map((p, i) => (
            <PreguntaChart key={p.id} pregunta={p} filas={filasPorPregunta[String(p.id)] || []} paletaIdx={i} />
          ))}
        </div>
      )}

      {vista === 'encuestadores' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {equipos.length > 1 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button onClick={() => onFiltroChange('equipo_id', null)}
                style={{ padding: '5px 12px', borderRadius: 100, border: `1.5px solid ${!filtros.equipo_id ? 'var(--accent)' : 'var(--border2)'}`, background: !filtros.equipo_id ? 'var(--accent-light)' : 'var(--paper)', color: !filtros.equipo_id ? 'var(--accent)' : 'var(--ink3)', fontSize: 12, cursor: 'pointer', fontFamily: 'DM Sans' }}>
                Todos
              </button>
              {equipos.map(eq => (
                <button key={eq.id} onClick={() => onFiltroChange('equipo_id', eq.id)}
                  style={{ padding: '5px 12px', borderRadius: 100, border: `1.5px solid ${filtros.equipo_id === eq.id ? 'var(--accent)' : 'var(--border2)'}`, background: filtros.equipo_id === eq.id ? 'var(--accent-light)' : 'var(--paper)', color: filtros.equipo_id === eq.id ? 'var(--accent)' : 'var(--ink3)', fontSize: 12, cursor: 'pointer', fontFamily: 'DM Sans' }}>
                  {eq.nombre}
                </button>
              ))}
            </div>
          )}
          <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
  <thead>
    <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
      <ThSort label="Encuestador" campo="nombre_completo" sort={sortEnc} onSort={c => alternarOrden(c, setSortEnc)} />
      <ThSort label="Equipo" campo="equipo_nombre" sort={sortEnc} onSort={c => alternarOrden(c, setSortEnc)} />
      <ThSort label="Zonas" campo="zonas" sort={sortEnc} onSort={c => alternarOrden(c, setSortEnc)} />
      <ThSort label="Completadas" campo="completadas" sort={sortEnc} onSort={c => alternarOrden(c, setSortEnc)} align="right" />
      <ThSort label="No respuesta" campo="no_respuesta" sort={sortEnc} onSort={c => alternarOrden(c, setSortEnc)} align="right" />
      <ThSort label="Total" campo="total" sort={sortEnc} onSort={c => alternarOrden(c, setSortEnc)} align="right" />
    </tr>
  </thead>
  <tbody>
    {encuestadoresOrdenados.map((enc, i) => {
      const key = enc.encuestador_id || i
      const zonas = (enc.por_zona || []).slice().sort((a, b) => b.total - a.total)
      const open = !!encZonasAbiertas[key]
      return (
      <Fragment key={key}>
      <tr onClick={() => zonas.length && setEncZonasAbiertas(p => ({ ...p, [key]: !p[key] }))}
          style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--paper)' : 'var(--surface)', cursor: zonas.length ? 'pointer' : 'default' }}>
        <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600 }}>
          {zonas.length > 0 && <span style={{ display: 'inline-block', width: 14, color: 'var(--ink3)' }}>{open ? '▾' : '▸'}</span>}
          {enc.nombre_completo}
        </td>
        <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--ink3)' }}>{enc.equipo_nombre || '—'}</td>
        <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--ink2)' }}>{enc.zonas || '—'}</td>
        {[[enc.completadas ?? enc.total, 'var(--accent)'], [enc.no_respuesta ?? 0, 'var(--danger)'], [enc.total, 'var(--ink2)']].map(([n, c], j) => (
          <td key={j} style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-num)', fontVariantNumeric: 'tabular-nums', color: n === 0 ? 'var(--metric-zero)' : c, textAlign: 'right' }}>{n}</td>
        ))}
      </tr>
      {open && zonas.map(z => (
        <tr key={key + (z.zona_id || 'sz')} style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
          <td style={{ padding: '8px 16px 8px 38px', fontSize: 12, color: 'var(--ink2)' }} colSpan={3}>{z.zona_nombre}</td>
          {[[z.completadas, 'var(--accent)'], [z.no_respuesta, 'var(--danger)'], [z.total, 'var(--ink2)']].map(([n, c], j) => (
            <td key={j} style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-num)', fontVariantNumeric: 'tabular-nums', color: n === 0 ? 'var(--metric-zero)' : c, textAlign: 'right' }}>{n}</td>
          ))}
        </tr>
      ))}
      </Fragment>
      )
    })}
  </tbody>
</table>
          </div>
        </div>
      )}

      {vista === 'zonas' && (
        <PorZonaTabla statsZona={statsZona} loading={loadingZonas} onCargar={onCargarZonas} />
      )}

      {vista === 'equipos' && <EquiposSnapshot snap={configSnapshot} />}

      {vista === 'mapa' && (
        <MapaEncuesta
          sesiones={sesionesGPS || []}
          columnas={preguntas.filter(p => ['opcion_multiple','si_no'].includes(p.tipo) && p.clave_base !== 'participa')}
          onCargar={onCargarMapa}
          loading={loadingGPS}
        />
      )}

      {vista === 'analisis' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {[['visual', 'Reporte visual por zona'], ['reportes', 'Reportes descargables']].map(([v, label]) => (
              <button key={v} onClick={() => setSubVistaAnalisis(v)}
                style={{ padding: '5px 12px', borderRadius: 100, border: `1.5px solid ${subVistaAnalisis === v ? 'var(--accent)' : 'var(--border2)'}`, background: subVistaAnalisis === v ? 'var(--accent-light)' : 'var(--paper)', color: subVistaAnalisis === v ? 'var(--accent)' : 'var(--ink3)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans' }}>
                {label}
              </button>
            ))}
          </div>
          {subVistaAnalisis === 'visual' && (
            <ReporteVisualZona encuesta={encuesta} preguntas={preguntas} />
          )}
          {subVistaAnalisis === 'reportes' && (
            <ReportesAutomaticos
              encuesta={encuesta} preguntas={preguntas}
              statsZona={statsZona} onCargarZonas={onCargarZonas} loadingZonas={loadingZonas}
            />
          )}
        </div>
      )}
    </div>
  )
}

export default function EncuestaDetalle() {
  const { id }     = useParams()
  const navigate   = useNavigate()
  const { perfil } = useAuth()

  const [encuesta,      setEncuesta]      = useState(null)
  const [preguntas,     setPreguntas]     = useState([])
  const [resumen,       setResumen]       = useState(null)
  const [respuestas,    setRespuestas]    = useState([])
  const [encuestadores, setEncuestadores] = useState([])
  const [equipos,       setEquipos]       = useState([])
  const [loading,       setLoading]       = useState(true)
  const [loadingR,      setLoadingR]      = useState(false)
  const [error,         setError]         = useState('')
  const [sesionesGPS,   setSesionesGPS]   = useState([])
  const [loadingGPS,    setLoadingGPS]    = useState(false)
  const [statsZona,     setStatsZona]     = useState(null)
  const [loadingZonas,  setLoadingZonas]  = useState(false)
  const [configSnapshot, setConfigSnapshot] = useState(null)
  const [tiempoStats,   setTiempoStats]   = useState(null) // { promedio_segundos, tiempo_objetivo_minutos }

  const [filtroEquipo,      setFiltroEquipo]      = useState(null)
  const [filtroEncuestador, setFiltroEncuestador] = useState(null)
  const [filtroDesde,       setFiltroDesde]       = useState(null)
  const [filtroHasta,       setFiltroHasta]       = useState(null)

  const filtrosKey = `${filtroEquipo || ''}-${filtroEncuestador || ''}-${filtroDesde || ''}-${filtroHasta || ''}`
  const hayFiltros = filtroEquipo || filtroEncuestador || filtroDesde || filtroHasta
  const filtros    = { equipo_id: filtroEquipo, encuestador_id: filtroEncuestador, fecha_desde: filtroDesde, fecha_hasta: filtroHasta }

  useEffect(() => {
    if (perfil?.organizacion_id && id) fetchBase()
  }, [id, perfil?.organizacion_id])

  // Realtime — detectar sesiones nuevas SIN pisar lo que el admin está mirando.
  // Antes esto recargaba resumen/respuestas/encuestadores en el momento, lo que
  // durante un operativo en vivo (muchas respuestas seguidas) hacía molesto
  // quedarse leyendo la encuesta. Ahora solo guardamos los datos frescos y
  // prendemos un aviso; el admin decide cuándo aplicarlos con "↻ Actualizar".
  const [hayNuevos, setHayNuevos]     = useState(false)
  const pendingRef                    = useRef(null)
  const totalRef                      = useRef(0)

  useEffect(() => { totalRef.current = resumen?.total_participaron ?? 0 }, [resumen])

  useEffect(() => {
    if (!id || !perfil?.organizacion_id) return

    let debounce = null

    async function revisarNuevos() {
      try {
        const { data } = await supabase.rpc('get_encuesta_full', {
          p_encuesta_id: id,
          p_org_id: perfil.organizacion_id,
          p_equipo_id: null, p_encuestador_id: null,
          p_fecha_desde: null, p_fecha_hasta: null,
        })
        if (data && !data.error) {
          const nuevoTotal = data.resumen?.total_participaron ?? 0
          if (nuevoTotal !== totalRef.current) {
            pendingRef.current = data
            setHayNuevos(true)
          }
        }
      } catch (e) { console.error('[realtime reload]', e) }
    }

    const channel = supabase
      .channel(`encuesta-live-${id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'sesiones_respuesta',
      }, () => {
        // Debounce 800ms para no chequear por cada respuesta de un batch
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(revisarNuevos, 800)
      })
      .subscribe((status) => {
        console.log('[realtime encuesta-detalle]', status)
      })

    // Polling cada 20s como fallback (más agresivo que 30s)
    const interval = setInterval(revisarNuevos, 20_000)

    return () => {
      if (debounce) clearTimeout(debounce)
      clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [id, perfil?.organizacion_id])

  function aplicarNuevos() {
    const data = pendingRef.current
    if (data) {
      if (data.resumen)        setResumen(data.resumen)
      if (data.respuestas)     setRespuestas(data.respuestas)
      if (data.encuestadores)  setEncuestadores(data.encuestadores)
      cacheClear(`enc_base:${id}`)
      cacheClear(`enc_resp:${id}:base`)
      cacheSet(`enc_resp:${id}:base`, data.respuestas || [], 60_000)
      pendingRef.current = null
      fetchTiempoStats()
    } else {
      cacheClear(`enc_base:${id}`)
      cacheClear(`enc_resp:${id}`)
      fetchBase()
    }
    setHayNuevos(false)
  }

  const debounceRef = useRef(null)
  useEffect(() => {
    if (!encuesta || encuesta.estado_produccion !== 'publicada') return
    if (!hayFiltros) return
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { fetchRespuestas(); fetchTiempoStats() }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [filtrosKey, encuesta?.id])

  async function fetchBase() {
    pendingRef.current = null
    setHayNuevos(false)
    const cacheKey = `enc_base:${id}`
    const cached   = cacheGet(cacheKey)
    if (cached) {
      setEncuesta(cached.encuesta); setPreguntas(cached.preguntas)
      setResumen(cached.resumen);   setEncuestadores(cached.encuestadores)
      setEquipos(cached.equipos);   setRespuestas(cacheGet(`enc_resp:${id}:base`) || [])
      setConfigSnapshot(cached.configSnapshot || null)
      setLoading(false); return
    }
    setLoading(true); setError('')
    try {
      const { data, error: rpcErr } = await supabase.rpc('get_encuesta_full', {
        p_encuesta_id: id, p_org_id: perfil.organizacion_id,
      })
      if (rpcErr) throw rpcErr
      if (!data || data.error === 'not_found') { navigate('/encuestas'); return }
      const payload = {
        encuesta: data.encuesta, preguntas: data.preguntas || [],
        resumen: data.resumen || null, encuestadores: data.encuestadores || [], equipos: data.equipos || [],
        configSnapshot: data.config_snapshot || null,
      }
      cacheSet(cacheKey, payload, 300_000)
      const respBase = data.respuestas || []
      cacheSet(`enc_resp:${id}:base`, respBase, 300_000)
      setEncuesta(payload.encuesta); setPreguntas(payload.preguntas)
      setResumen(payload.resumen);   setEncuestadores(payload.encuestadores)
      setEquipos(payload.equipos);   setRespuestas(respBase)
      setConfigSnapshot(payload.configSnapshot)
      fetchTiempoStats()
    } catch (e) { console.error(e); setError(e.message) }
    setLoading(false)
  }

  async function fetchRespuestas() {
    if (!id) return
    const cacheKey = `enc_resp:${id}:${filtrosKey}`
    const cached   = cacheGet(cacheKey)
    if (cached) { setRespuestas(cached); return }
    setLoadingR(true)
    try {
      const { data, error: rpcErr } = await supabase.rpc('get_encuesta_full', {
        p_encuesta_id: id, p_org_id: perfil.organizacion_id,
        p_equipo_id: filtroEquipo || null, p_encuestador_id: filtroEncuestador || null,
        p_fecha_desde: filtroDesde || null, p_fecha_hasta: filtroHasta || null,
      })
      if (rpcErr) throw rpcErr
      const result = data?.respuestas || []
      if (result.length > 0) cacheSet(cacheKey, result, 300_000)
      setRespuestas(result)
    } catch (e) { console.error('fetchRespuestas:', e) }
    setLoadingR(false)
  }

  // Tiempo promedio vs. objetivo. Nota: get_resultados_encuesta_filtrado no
  // soporta p_fecha_desde/p_fecha_hasta (solo equipo/zona/encuestador), así
  // que el promedio no se recorta por rango de fechas como el resto de
  // "respuestas" — queda igual mientras solo cambien los filtros de fecha.
  async function fetchTiempoStats(overrides = {}) {
    if (!id) return
    const equipoId      = 'equipo_id'      in overrides ? overrides.equipo_id      : filtroEquipo
    const encuestadorId = 'encuestador_id' in overrides ? overrides.encuestador_id : filtroEncuestador
    try {
      const { data, error: rpcErr } = await supabase.rpc('get_resultados_encuesta_filtrado', {
        p_encuesta_id: id, p_equipo_id: equipoId || null, p_encuestador_id: encuestadorId || null,
      })
      if (rpcErr) throw rpcErr
      if (data) setTiempoStats({ promedio_segundos: data.promedio_segundos, tiempo_objetivo_minutos: data.tiempo_objetivo_minutos })
    } catch (e) { console.error('fetchTiempoStats:', e) }
  }

  async function cargarSesionesGPS() {
    if (!id || !perfil?.organizacion_id) return
    setLoadingGPS(true)
    try {
      const { data } = await supabase.rpc('get_respuestas_crudas', {
        p_encuesta_id:    id,
        p_org_id:         perfil.organizacion_id,
        p_equipo_id:      null,
        p_encuestador_id: null,
        p_fecha_desde:    null,
        p_fecha_hasta:    null,
      })
      setSesionesGPS((data?.filas || []).filter(f => f.lat && f.lng))
    } catch (e) { console.error('cargarSesionesGPS:', e) }
    setLoadingGPS(false)
  }

  async function cargarStatsZona() {
    if (!id) return
    setLoadingZonas(true)
    try {
      const { data } = await supabase.rpc('get_stats_por_zona', { p_encuesta_id: id })
      setStatsZona(data || null)
    } catch (e) { console.error('cargarStatsZona:', e) }
    setLoadingZonas(false)
  }

  function handleFiltroChange(campo, valor) {
    if (campo === '_reset') {
      setFiltroEquipo(null); setFiltroEncuestador(null); setFiltroDesde(null); setFiltroHasta(null)
      const base = cacheGet(`enc_resp:${id}:base`)
      if (base) setRespuestas(base)
      fetchTiempoStats({ equipo_id: null, encuestador_id: null })
      return
    }
    if (campo === 'equipo_id')      { setFiltroEquipo(valor); setFiltroEncuestador(null); return }
    if (campo === 'encuestador_id') { setFiltroEncuestador(valor); return }
    if (campo === 'fecha_desde')    { setFiltroDesde(valor); return }
    if (campo === 'fecha_hasta')    { setFiltroHasta(valor); return }
  }

  if (loading) return (
    <div className={styles.page}>
      <Topbar title="Encuesta" back={{ label: 'Volver', onClick: () => navigate('/encuestas') }} />
      <div className={styles.content} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
        <Spinner center size="lg" />
      </div>
    </div>
  )
  if (!encuesta) return null

  const cfg = ESTADO_CONFIG[encuesta.estado_produccion] || ESTADO_CONFIG.pendiente

  return (
    <div className={styles.page}>
      <Topbar
        title={encuesta.nombre}
        back={{ label: 'Encuestas', onClick: () => navigate('/encuestas') }}
        badge={{ label: cfg.label, color: cfg.color, bg: cfg.bg }}
        action={encuesta.estado_produccion === 'publicada' ? {
  label: hayNuevos ? '🔴 Actualizar (hay respuestas nuevas)' : '↻ Actualizar',
  onClick: aplicarNuevos,
} : null}
      />
      <div className={styles.content}>
        {error && <div style={{ padding: '10px 16px', background: 'var(--danger-light)', border: '1px solid var(--danger)', borderRadius: 'var(--r)', fontSize: 13, color: 'var(--danger)', marginBottom: 12 }}>Error: {error}</div>}
        {['publicada', 'completada'].includes(encuesta.estado_produccion)
          ? <VistaResultados encuesta={encuesta} preguntas={preguntas} resumen={resumen} respuestas={respuestas}
              encuestadores={encuestadores} equipos={equipos} filtros={filtros}
              onFiltroChange={handleFiltroChange} loadingR={loadingR}
              sesionesGPS={sesionesGPS} onCargarMapa={cargarSesionesGPS} loadingGPS={loadingGPS}
              statsZona={statsZona} onCargarZonas={cargarStatsZona} loadingZonas={loadingZonas}
              configSnapshot={configSnapshot} tiempoStats={tiempoStats} />
          : <VistaProduccion encuesta={encuesta} preguntas={preguntas} />
        }
      </div>
    </div>
  )
}