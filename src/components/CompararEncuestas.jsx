import { useState, useEffect, useRef, useMemo } from 'react'
import Chart from 'chart.js/auto'
import { supabase } from '../lib/supabase'
import { generarPDF } from '../lib/generarPDF'
import { buscarPregunta, distribucionCompleta } from '../lib/reportesAutomaticos'
import { ArrowLeft, Download } from 'lucide-react'

// Comparación entre dos encuestas (Cambio 2) + Panel de seguimiento
// temporal (Reporte 21, atado al Cambio 2 — no vive en REPORTES_DEFS).
//
// Ojo con el nombre: esto es distinto de la tab "🔀 Cruzar datos" que ya
// existe dentro del detalle de UNA encuesta (Reportes.jsx, vistaActiva ===
// 'comparar') — esa cruza dos PREGUNTAS de la misma encuesta. Esto compara
// la MISMA pregunta entre DOS encuestas distintas, así que va como vista
// de nivel superior, separada del selector de encuesta única.
//
// Igual que el resto del módulo: Chart.js solo para el gráfico interactivo
// en pantalla — el PDF (vía Puppeteer, /api/pdf) usa SVG inline porque
// page.setContent(html, { waitUntil: 'networkidle0' }) no ejecuta scripts.

const COLOR_A = '#1a472a'
const COLOR_B = '#0369a1'

const inp = { padding: '8px 12px', borderRadius: 'var(--r)', border: '1.5px solid var(--border2)', fontSize: 13, fontFamily: 'DM Sans', background: 'var(--surface)', color: 'var(--ink)', width: '100%' }
const box = { background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', padding: 20 }

async function cargarLado(encuestaId, orgId) {
  const [{ data: full, error: e1 }, { data: crudo, error: e2 }] = await Promise.all([
    supabase.rpc('get_encuesta_full', { p_encuesta_id: encuestaId, p_org_id: orgId }),
    supabase.rpc('get_respuestas_crudas', {
      p_encuesta_id: encuestaId, p_org_id: orgId,
      p_equipo_id: null, p_encuestador_id: null, p_fecha_desde: null, p_fecha_hasta: null,
    }),
  ])
  if (e1 || e2) throw e1 || e2
  return { preguntas: full?.preguntas || [], crudo: crudo || { columnas: [], filas: [] } }
}

// Mergea la distribución de una misma pregunta (por clave_base) entre las
// dos encuestas, opción por opción — asume mismo set de opciones (misma
// clave_base → mismo tipo de pregunta en el diseño de la encuesta).
function mergeDistribuciones(distA, distB) {
  const porOpcionB = Object.fromEntries(distB.filas.map(f => [f.opcion, f]))
  return distA.filas.map(fa => {
    const fb = porOpcionB[fa.opcion] || { n: 0, pct: 0 }
    return { opcion: fa.opcion, nA: fa.n, pctA: fa.pct, nB: fb.n, pctB: fb.pct, diff: Math.round((fb.pct - fa.pct) * 10) / 10 }
  })
}

function tablaComparacionHTML(filas, labelA, labelB) {
  const rows = filas.map((f, i) => {
    const signo = f.diff > 0 ? '+' : ''
    const color = f.diff > 0 ? '#2d8f4e' : f.diff < 0 ? '#c0392b' : '#888'
    return `<tr style="background:${i % 2 === 0 ? '#fff' : '#fafaf8'}">
      <td>${f.opcion}</td>
      <td style="text-align:right">${f.nA} (${f.pctA}%)</td>
      <td style="text-align:right">${f.nB} (${f.pctB}%)</td>
      <td style="text-align:right;color:${color};font-weight:700">${signo}${f.diff}pp</td>
    </tr>`
  }).join('')
  return `<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px">
    <thead><tr style="background:#f3f4f6">
      <th style="text-align:left">Opción</th><th style="text-align:right">${labelA}</th><th style="text-align:right">${labelB}</th><th style="text-align:right">Diferencia</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`
}

// Barras agrupadas SVG — dos barras (A/B) por opción, escaladas al máximo
// de la serie. Reemplaza al Chart.js de pantalla para el PDF.
function barrasAgrupadasSVG(filas, labelA, labelB) {
  const w = Math.max(420, filas.length * 90), h = 220, pad = 36
  const max = Math.max(10, ...filas.map(f => Math.max(f.pctA, f.pctB)))
  const grupoW = (w - pad * 2) / filas.length
  const barW = Math.min(28, grupoW / 3)
  const bars = filas.map((f, i) => {
    const cx = pad + i * grupoW + grupoW / 2
    const hA = (f.pctA / max) * (h - pad * 2)
    const hB = (f.pctB / max) * (h - pad * 2)
    const xA = cx - barW - 2, xB = cx + 2
    const yA = h - pad - hA, yB = h - pad - hB
    return `<rect x="${xA.toFixed(1)}" y="${yA.toFixed(1)}" width="${barW}" height="${hA.toFixed(1)}" fill="${COLOR_A}" rx="2"/>
      <rect x="${xB.toFixed(1)}" y="${yB.toFixed(1)}" width="${barW}" height="${hB.toFixed(1)}" fill="${COLOR_B}" rx="2"/>
      <text x="${cx.toFixed(1)}" y="${h - pad + 14}" font-size="9" fill="#888" text-anchor="middle">${String(f.opcion).slice(0, 14)}</text>`
  }).join('')
  return `<svg width="${w}" height="${h}" style="margin-bottom:18px">
    <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="#e5e7eb"/>
    ${bars}
    <g transform="translate(${pad},14)">
      <rect width="10" height="10" fill="${COLOR_A}"/><text x="14" y="9" font-size="10" fill="#555">${labelA}</text>
      <rect x="120" width="10" height="10" fill="${COLOR_B}"/><text x="134" y="9" font-size="10" fill="#555">${labelB}</text>
    </g>
  </svg>`
}

const CSS_PDF = `*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;color:#1a1a1a;background:#fff;padding:40px;font-size:13px}
.header{border-bottom:3px solid #52B788;padding-bottom:20px;margin-bottom:24px}
h1{font-size:20px;font-weight:800;color:#1a472a;margin:8px 0 4px}
.meta{font-size:11px;color:#888;margin-top:6px}
.sec{font-size:13px;font-weight:700;color:#1a472a;margin:20px 0 10px;padding-bottom:6px;border-bottom:2px solid #e5e7eb}
table td,table th{border:1px solid #e5e7eb;padding:6px 10px}
footer{margin-top:28px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:10px;color:#bbb;display:flex;justify-content:space-between}
@media print{body{padding:20px}}`

function shellPDF(titulo, subtitulo, cuerpo) {
  const fecha = new Date().toLocaleString('es-AR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${titulo}</title><style>${CSS_PDF}</style></head><body>
<div class="header">
  <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#52B788;text-transform:uppercase">METR1KA · Comparación entre encuestas</div>
  <h1>${titulo}</h1>
  <div style="font-size:13px;color:#555">${subtitulo}</div>
  <div class="meta">Generado el ${fecha}</div>
</div>
${cuerpo}
<footer><span>METR1KA — metr1ka.com</span><span>${fecha}</span></footer>
</body></html>`
}

function fechaCorta(iso) {
  return iso ? new Date(iso).toLocaleDateString('es-AR') : ''
}

export default function CompararEncuestas({ encuestas, perfil, onVolver }) {
  const [idA, setIdA] = useState('')
  const [idB, setIdB] = useState('')
  // `id` guarda de qué encuesta son `preguntas`/`crudo` — así se puede
  // derivar "cargando" (idX seleccionado pero la data todavía es de otra
  // encuesta o no llegó) sin guardarlo como estado aparte que un efecto
  // tendría que ir corrigiendo.
  const [ladoA, setLadoA] = useState({ id: null, preguntas: [], crudo: null, error: '' })
  const [ladoB, setLadoB] = useState({ id: null, preguntas: [], crudo: null, error: '' })
  const [claveBase, setClaveBase] = useState('')
  const chartRef = useRef(null)
  const chartInst = useRef(null)

  const encA = encuestas.find(e => e.id === idA)
  const encB = encuestas.find(e => e.id === idB)

  // El reset a vacío pasa en el onChange del <select> (evento de usuario),
  // no acá — el efecto solo sincroniza con el servidor, y solo llama
  // setState dentro de los callbacks async (ver "you might not need an
  // effect": nada de setState síncrono al tope del efecto).
  useEffect(() => {
    if (!idA) return
    let cancelado = false
    cargarLado(idA, perfil.organizacion_id)
      .then(r => { if (!cancelado) setLadoA({ id: idA, ...r, error: '' }) })
      .catch(e => { console.error('CompararEncuestas, ladoA:', e); if (!cancelado) setLadoA({ id: idA, preguntas: [], crudo: null, error: 'No se pudo cargar la encuesta.' }) })
    return () => { cancelado = true }
  }, [idA, perfil.organizacion_id])

  useEffect(() => {
    if (!idB) return
    let cancelado = false
    cargarLado(idB, perfil.organizacion_id)
      .then(r => { if (!cancelado) setLadoB({ id: idB, ...r, error: '' }) })
      .catch(e => { console.error('CompararEncuestas, ladoB:', e); if (!cancelado) setLadoB({ id: idB, preguntas: [], crudo: null, error: 'No se pudo cargar la encuesta.' }) })
    return () => { cancelado = true }
  }, [idB, perfil.organizacion_id])

  function elegirA(id) {
    setIdA(id)
    if (!id) setLadoA({ id: null, preguntas: [], crudo: null, error: '' })
  }
  function elegirB(id) {
    setIdB(id)
    if (!id) setLadoB({ id: null, preguntas: [], crudo: null, error: '' })
  }

  const cargandoA = !!idA && ladoA.id !== idA && !ladoA.error
  const cargandoB = !!idB && ladoB.id !== idB && !ladoB.error
  const ambasCargadas = !!(idA && idB && ladoA.id === idA && ladoB.id === idB && ladoA.crudo && ladoB.crudo)

  const preguntasComunes = useMemo(() => {
    if (!ambasCargadas) return []
    return ladoA.preguntas.filter(p => p.clave_base && ladoB.preguntas.some(q => q.clave_base === p.clave_base))
  }, [ambasCargadas, ladoA.preguntas, ladoB.preguntas])

  // Pregunta activa: la elegida por el usuario si sigue entre las comunes,
  // si no la primera disponible — derivado en render, sin efecto que
  // "corrija" el estado después del hecho.
  const claveBaseActiva = useMemo(() => {
    if (!preguntasComunes.length) return ''
    return preguntasComunes.some(p => p.clave_base === claveBase) ? claveBase : preguntasComunes[0].clave_base
  }, [preguntasComunes, claveBase])

  const preguntaA = useMemo(() => buscarPregunta(ladoA.preguntas, claveBaseActiva), [ladoA.preguntas, claveBaseActiva])
  const preguntaB = useMemo(() => buscarPregunta(ladoB.preguntas, claveBaseActiva), [ladoB.preguntas, claveBaseActiva])

  const filasComparacion = useMemo(() => {
    if (!preguntaA || !preguntaB || !ladoA.crudo || !ladoB.crudo) return []
    const pParticipaA = buscarPregunta(ladoA.preguntas, 'participa')
    const pParticipaB = buscarPregunta(ladoB.preguntas, 'participa')
    const distA = distribucionCompleta(preguntaA, ladoA.preguntas, ladoA.crudo, pParticipaA)
    const distB = distribucionCompleta(preguntaB, ladoB.preguntas, ladoB.crudo, pParticipaB)
    return mergeDistribuciones(distA, distB)
  }, [preguntaA, preguntaB, ladoA, ladoB])

  useEffect(() => {
    if (!chartRef.current || !filasComparacion.length) return
    if (chartInst.current) chartInst.current.destroy()
    chartInst.current = new Chart(chartRef.current.getContext('2d'), {
      type: 'bar',
      data: {
        labels: filasComparacion.map(f => f.opcion),
        datasets: [
          { label: encA?.nombre || 'Encuesta A', data: filasComparacion.map(f => f.pctA), backgroundColor: COLOR_A, borderRadius: 4 },
          { label: encB?.nombre || 'Encuesta B', data: filasComparacion.map(f => f.pctB), backgroundColor: COLOR_B, borderRadius: 4 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 10 } } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 30 } },
          y: { beginAtZero: true, ticks: { font: { size: 10 }, callback: v => `${v}%` } },
        },
      },
    })
    return () => chartInst.current?.destroy()
  }, [filasComparacion, encA?.nombre, encB?.nombre])

  function descargarPDFPregunta() {
    if (!filasComparacion.length || !preguntaA) return
    const cuerpo = `${tablaComparacionHTML(filasComparacion, encA.nombre, encB.nombre)}${barrasAgrupadasSVG(filasComparacion, encA.nombre, encB.nombre)}`
    const html = shellPDF(preguntaA.texto || 'Comparación', `${encA.nombre} (${fechaCorta(encA.creado_en)}) vs ${encB.nombre} (${fechaCorta(encB.creado_en)})`, cuerpo)
    generarPDF(html, `comparacion-${(preguntaA.texto || 'pregunta').replace(/[^\w-]+/g, '_')}.pdf`)
  }

  // Reporte 21 — Panel de seguimiento: todas las preguntas comunes, con
  // página de resumen (top 5 variaciones) al principio.
  function descargarPanelSeguimiento() {
    if (!ambasCargadas || !preguntasComunes.length) return
    const pParticipaA = buscarPregunta(ladoA.preguntas, 'participa')
    const pParticipaB = buscarPregunta(ladoB.preguntas, 'participa')

    const secciones = preguntasComunes.map(pA => {
      const pB = buscarPregunta(ladoB.preguntas, pA.clave_base)
      const distA = distribucionCompleta(pA, ladoA.preguntas, ladoA.crudo, pParticipaA)
      const distB = distribucionCompleta(pB, ladoB.preguntas, ladoB.crudo, pParticipaB)
      const filas = mergeDistribuciones(distA, distB)
      return { titulo: pA.texto || pA.clave_base, filas }
    }).filter(s => s.filas.length)

    const variaciones = secciones.flatMap(s => s.filas.map(f => ({ pregunta: s.titulo, opcion: f.opcion, diff: f.diff })))
    const top5 = variaciones.slice().sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 5)

    const resumen = `<div style="page-break-after:always">
      <div class="sec">Resumen — variaciones más significativas</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#f3f4f6"><th style="text-align:left">Pregunta</th><th style="text-align:left">Opción</th><th style="text-align:right">Variación</th></tr></thead>
        <tbody>${top5.map((v, i) => {
          const signo = v.diff > 0 ? '+' : ''
          const color = v.diff > 0 ? '#2d8f4e' : v.diff < 0 ? '#c0392b' : '#888'
          return `<tr style="background:${i % 2 === 0 ? '#fff' : '#fafaf8'}"><td>${v.pregunta}</td><td>${v.opcion}</td><td style="text-align:right;color:${color};font-weight:700">${signo}${v.diff}pp</td></tr>`
        }).join('')}</tbody>
      </table>
    </div>`

    const cuerpoSecciones = secciones.map(s =>
      `<div class="sec">${s.titulo}</div>${tablaComparacionHTML(s.filas, encA.nombre, encB.nombre)}${barrasAgrupadasSVG(s.filas, encA.nombre, encB.nombre)}`
    ).join('')

    const html = shellPDF('Panel de seguimiento temporal', `${encA.nombre} (${fechaCorta(encA.creado_en)}) vs ${encB.nombre} (${fechaCorta(encB.creado_en)})`, resumen + cuerpoSecciones)
    generarPDF(html, `panel-seguimiento-${(encA.nombre + '_' + encB.nombre).replace(/[^\w-]+/g, '_')}.pdf`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onVolver} style={{ background: 'none', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--ink3)', fontFamily: 'DM Sans', display: 'flex', alignItems: 'center', gap: 6 }}>
          <ArrowLeft size={13} /> Volver
        </button>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>⚖️ Comparar encuestas</span>
      </div>

      <div style={{ ...box, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', display: 'block', marginBottom: 4 }}>Encuesta A</label>
          <select value={idA} onChange={e => elegirA(e.target.value)} style={inp}>
            <option value="">Elegir encuesta…</option>
            {encuestas.map(enc => <option key={enc.id} value={enc.id} disabled={enc.id === idB}>{enc.nombre}</option>)}
          </select>
          {cargandoA && <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 6 }}>Cargando…</div>}
          {ladoA.error && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>{ladoA.error}</div>}
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', display: 'block', marginBottom: 4 }}>Encuesta B</label>
          <select value={idB} onChange={e => elegirB(e.target.value)} style={inp}>
            <option value="">Elegir encuesta…</option>
            {encuestas.map(enc => <option key={enc.id} value={enc.id} disabled={enc.id === idA}>{enc.nombre}</option>)}
          </select>
          {cargandoB && <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 6 }}>Cargando…</div>}
          {ladoB.error && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>{ladoB.error}</div>}
        </div>
      </div>

      {ambasCargadas && preguntasComunes.length === 0 && (
        <div style={{ ...box, textAlign: 'center', color: 'var(--ink3)', fontSize: 13 }}>
          Estas dos encuestas no tienen ninguna pregunta con la misma clasificación (clave_base) — no hay nada para comparar.
        </div>
      )}

      {ambasCargadas && preguntasComunes.length > 0 && (
        <>
          <div style={{ ...box, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)' }}>Pregunta a comparar</label>
            <select value={claveBaseActiva} onChange={e => setClaveBase(e.target.value)} style={{ ...inp, width: 'auto', flex: 1, minWidth: 240 }}>
              {preguntasComunes.map(p => <option key={p.clave_base} value={p.clave_base}>{p.texto || p.clave_base}</option>)}
            </select>
            <button onClick={descargarPDFPregunta} disabled={!filasComparacion.length}
              style={{ padding: '8px 14px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r)', fontSize: 12, fontWeight: 700, cursor: filasComparacion.length ? 'pointer' : 'not-allowed', opacity: filasComparacion.length ? 1 : 0.5, fontFamily: 'DM Sans', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Download size={13} /> Descargar PDF
            </button>
            <button onClick={descargarPanelSeguimiento}
              style={{ padding: '8px 14px', background: 'var(--surface)', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans', color: 'var(--ink2)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Download size={13} /> Exportar panel de seguimiento
            </button>
          </div>

          {filasComparacion.length === 0 ? (
            <div style={{ ...box, textAlign: 'center', color: 'var(--ink3)', fontSize: 13 }}>
              Ninguna de las dos encuestas tiene respuestas completadas para esta pregunta todavía.
            </div>
          ) : (
            <div style={box}>
              <div style={{ height: 260, marginBottom: 20 }}><canvas ref={chartRef} /></div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--ink3)', fontSize: 11, textTransform: 'uppercase' }}>Opción</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--ink3)', fontSize: 11, textTransform: 'uppercase' }}>{encA.nombre}</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--ink3)', fontSize: 11, textTransform: 'uppercase' }}>{encB.nombre}</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--ink3)', fontSize: 11, textTransform: 'uppercase' }}>Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  {filasComparacion.map(f => (
                    <tr key={f.opcion} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px' }}>{f.opcion}</td>
                      <td style={{ padding: '8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{f.nA} ({f.pctA}%)</td>
                      <td style={{ padding: '8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{f.nB} ({f.pctB}%)</td>
                      <td style={{ padding: '8px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: f.diff > 0 ? 'var(--accent2)' : f.diff < 0 ? 'var(--danger)' : 'var(--ink3)' }}>
                        {f.diff > 0 ? '+' : ''}{f.diff}pp
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
