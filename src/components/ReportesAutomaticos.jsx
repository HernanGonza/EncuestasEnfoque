import { useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { REPORTES_DEFS, calcularReporte, PALETA_REPORTES } from '../lib/reportesAutomaticos'
import { generarPDF } from '../lib/generarPDF'

// Reportes automáticos — Sección 8 del plan. A diferencia de "Reportes" (el
// generador manual con cruces armados a mano por el admin), acá el admin
// solo elige, de esta lista fija de 11, cuál quiere ver o descargar: el
// agrupar/sumar/ordenar/porcentaje lo calcula `reportesAutomaticos.js`.
//
// El PDF se genera con Puppeteer vía /api/pdf (ver src/lib/generarPDF.js)
// — con fallback a window.print() si el endpoint falla.

function tablaHTML({ columnas, filas, totalFila }) {
  const th = columnas.map(c => `<th style="text-align:${c.num ? 'right' : 'left'}">${c.label}</th>`).join('')
  // `_bg`/`_fg` en una fila (p. ej. "Competitividad por zona", que colorea
  // según nivel de reñidez) pisan el zebra-striping por defecto.
  const filasHTML = filas.map((f, i) => `<tr style="background:${f._bg || (i % 2 === 0 ? '#fff' : '#fafaf8')}${f._fg ? `;color:${f._fg}` : ''}">${
    columnas.map(c => `<td style="text-align:${c.num ? 'right' : 'left'}">${f[c.key] ?? '—'}</td>`).join('')
  }</tr>`).join('')
  const footer = totalFila ? `<tr style="font-weight:700;border-top:2px solid #1a472a">${
    columnas.map(c => `<td style="text-align:${c.num ? 'right' : 'left'}">${totalFila[c.key] ?? ''}</td>`).join('')
  }</tr>` : ''
  return `<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:18px">
    <thead><tr style="background:#f3f4f6">${th}</tr></thead>
    <tbody>${filasHTML}${footer}</tbody>
  </table>`
}

// Gráfico de línea SVG simple para "evolución horaria" — 24 puntos
// hora×acumulado. Inline porque Puppeteer no ejecuta scripts del HTML que
// se le manda (nada de Chart.js acá).
function graficoLineaSVG(filas) {
  const w = 640, h = 160, pad = 32
  const max = Math.max(1, ...filas.map(f => f.acumulado))
  const stepX = filas.length > 1 ? (w - pad * 2) / (filas.length - 1) : 0
  const puntos = filas.map((f, i) => {
    const x = pad + i * stepX
    const y = h - pad - (f.acumulado / max) * (h - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const ejeX = filas.map((f, i) => {
    if (i % 3 !== 0) return ''
    const x = pad + i * stepX
    return `<text x="${x.toFixed(1)}" y="${h - 8}" font-size="9" fill="#888" text-anchor="middle">${f.hora}</text>`
  }).join('')
  return `<svg width="${w}" height="${h}" style="margin-bottom:18px">
    <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="#e5e7eb"/>
    <polyline points="${puntos.join(' ')}" fill="none" stroke="#52B788" stroke-width="2"/>
    ${puntos.map(p => `<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="2.5" fill="#1a472a"/>`).join('')}
    ${ejeX}
  </svg>`
}

// Barras apiladas SVG — "Corte generacional" (14): una barra por grupo
// etario, apilada por candidato, en % (matrizPct ya viene calculado así).
function svgBarrasApiladas({ grupos, candidatos, matrizPct }) {
  const w = Math.max(420, grupos.length * 100), h = 260, pad = 40, legendH = 30
  const anchoGrupo = (w - pad * 2) / grupos.length
  const barW = Math.min(60, anchoGrupo - 20)
  const altoChart = h - pad * 2 - legendH
  const bars = matrizPct.map((g, i) => {
    const cx = pad + i * anchoGrupo + anchoGrupo / 2
    let acumulado = 0
    const rects = g.valores.map((v, ci) => {
      const alto = (v / 100) * altoChart
      const y = h - pad - acumulado - alto
      acumulado += alto
      return `<rect x="${(cx - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${alto.toFixed(1)}" fill="${PALETA_REPORTES[ci % PALETA_REPORTES.length]}"/>`
    }).join('')
    return `${rects}<text x="${cx.toFixed(1)}" y="${h - pad + 14}" font-size="9" fill="#888" text-anchor="middle">${String(g.grupo).slice(0, 14)}</text>`
  }).join('')
  const legend = candidatos.map((c, i) => `<g transform="translate(${pad + i * 140},${legendH - 16})">
    <rect width="10" height="10" fill="${PALETA_REPORTES[i % PALETA_REPORTES.length]}"/><text x="14" y="9" font-size="10" fill="#555">${String(c).slice(0, 18)}</text>
  </g>`).join('')
  return `<svg width="${w}" height="${h}" style="margin-bottom:18px">
    <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="#e5e7eb"/>
    ${bars}
    ${legend}
  </svg>`
}

// Múltiples líneas SVG — "Evolución por encuestador" (17): una serie por
// encuestador (acumulado x hora), mismo patrón que graficoLineaSVG pero con
// varias polylines y referencias de color.
function svgLineasEncuestadores(series) {
  if (!series?.length) return ''
  const w = 640, h = 200, pad = 32, legendH = 20
  const max = Math.max(1, ...series.flatMap(s => s.puntos.map(p => p.acumulado)))
  const stepX = (w - pad * 2) / 23
  const altoChart = h - pad - (pad + legendH)
  const lineas = series.map(s => {
    const puntos = s.puntos.map(p => {
      const x = pad + p.hora * stepX
      const y = (h - pad) - (p.acumulado / max) * altoChart
      return `${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
    return `<polyline points="${puntos}" fill="none" stroke="${s.color}" stroke-width="2"/>`
  }).join('')
  const ejeX = Array.from({ length: 24 }, (_, hora) => {
    if (hora % 3 !== 0) return ''
    const x = pad + hora * stepX
    return `<text x="${x.toFixed(1)}" y="${h - 6}" font-size="9" fill="#888" text-anchor="middle">${hora}h</text>`
  }).join('')
  const legend = series.map((s, i) => `<g transform="translate(${pad + i * 130},10)">
    <rect width="10" height="10" fill="${s.color}"/><text x="14" y="9" font-size="10" fill="#555">${String(s.encuestador).slice(0, 16)}</text>
  </g>`).join('')
  return `<svg width="${w}" height="${h}" style="margin-bottom:18px">
    <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="#e5e7eb"/>
    ${lineas}
    ${ejeX}
    ${legend}
  </svg>`
}

// Barra horizontal SVG — usada en el resumen ejecutivo (candidatos, top
// problemas) en vez de un gráfico armado con Chart.js/canvas.
function barraSVG(pct, color, width = 280, height = 16) {
  const w = Math.max(2, Math.round((Math.min(100, pct) / 100) * width))
  return `<svg width="${width}" height="${height}" style="vertical-align:middle">
    <rect x="0" y="0" width="${width}" height="${height}" fill="#f3f4f6" rx="3"/>
    <rect x="0" y="0" width="${w}" height="${height}" fill="${color}" rx="3"/>
  </svg>`
}

function filaBarra(nombre, pct, color) {
  return `<div style="display:flex;align-items:center;gap:14px;margin-bottom:10px">
    <div style="width:200px;font-size:14px;font-weight:600;text-align:right">${nombre}</div>
    ${barraSVG(pct, color)}
    <div style="width:50px;font-size:15px;font-weight:800;color:${color}">${pct}%</div>
  </div>`
}

// Resumen ejecutivo — una sola carilla, fuente grande, sin tablas
// detalladas (Cambio 3). Forma propia { tipo: 'resumen', ... }, distinta
// del resto de los reportes ({ columnas, filas } / { secciones }).
function cuerpoResumenEjecutivo(r) {
  const bloques = []
  bloques.push(`<div style="display:flex;gap:24px;margin-bottom:28px">
    ${[['Completadas', r.completadas], ['Total intentos', r.total], ['Participación', `${r.tasaParticipacion}%`]]
      .map(([label, val]) => `<div style="flex:1;background:#f9faf9;border-radius:10px;padding:16px;text-align:center">
        <div style="font-size:28px;font-weight:800;color:#1a472a">${val}</div>
        <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-top:4px">${label}</div>
      </div>`).join('')}
  </div>`)

  if (r.candidatoIntendente) {
    bloques.push(`<div class="sec">Intención de voto — Intendente</div>${r.candidatoIntendente.top.map((c, i) => filaBarra(c.nombre, c.pct, ['#1a472a', '#52B788', '#94a3b8'][i] || '#94a3b8')).join('')}`)
  }
  if (r.candidatoGobernador) {
    bloques.push(`<div class="sec">Intención de voto — Gobernador</div>${r.candidatoGobernador.top.map((c, i) => filaBarra(c.nombre, c.pct, ['#1a472a', '#52B788'][i] || '#94a3b8')).join('')}`)
  }
  if (r.evaluacionGestion) {
    const ev = r.evaluacionGestion
    bloques.push(`<div class="sec">Evaluación de gestión</div>
      ${filaBarra('Positiva', ev.positivo, '#2d8f4e')}
      ${filaBarra('Neutra', ev.neutro, '#b45309')}
      ${filaBarra('Negativa', ev.negativo, '#c0392b')}`)
  }
  if (r.problemaPrincipal) {
    bloques.push(`<div class="sec">Principal problema</div>${r.problemaPrincipal.top.map((c, i) => filaBarra(c.nombre, c.pct, ['#7c3aed', '#9f7aea', '#c4b5fd'][i] || '#c4b5fd')).join('')}`)
  }
  return bloques.join('')
}

// Tabla resumen de "Agenda temática por zona" (13) — candidato ganador →
// principal problema entre las zonas que gana, antes del detalle zona x zona.
function tablaResumenAgendaHTML(resumen) {
  if (!resumen?.length) return ''
  const rows = resumen.map((r, i) => `<tr style="background:${i % 2 === 0 ? '#fff' : '#fafaf8'}">
    <td>${r.candidato}</td><td>${r.problema}</td><td style="text-align:right">${r.pct}%</td>
  </tr>`).join('')
  return `<div class="sec">Resumen por candidato ganador</div>
  <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:18px">
    <thead><tr style="background:#f3f4f6"><th style="text-align:left">Candidato ganador</th><th style="text-align:left">Principal problema</th><th style="text-align:right">%</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`
}

// "Consistencia interna" (16) — forma propia { tipo: 'consistencia', reglas }
// distinta del resto: una sección por regla heurística, con su descripción
// y una muestra de sesiones afectadas.
function cuerpoConsistenciaInterna(r) {
  return r.reglas.map(regla => `
    <div class="sec">${regla.nombre}</div>
    <div class="callout">${regla.descripcion}</div>
    <div style="font-size:13px;margin-bottom:10px"><b>${regla.cantidad}</b> sesión${regla.cantidad === 1 ? '' : 'es'} afectada${regla.cantidad === 1 ? '' : 's'} (${regla.pct}% del total de completadas).</div>
    ${regla.muestra.length ? `<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:20px">
      <thead><tr style="background:#f3f4f6"><th style="text-align:left">Zona</th><th style="text-align:left">Encuestador</th></tr></thead>
      <tbody>${regla.muestra.map((m, i) => `<tr style="background:${i % 2 === 0 ? '#fff' : '#fafaf8'}"><td>${m.zona}</td><td>${m.encuestador}</td></tr>`).join('')}</tbody>
    </table>` : ''}
  `).join('')
}

// "Perfil del votante por candidato" (20) — forma propia { tipo:
// 'perfil_votante', candidatos }: una sección por candidato con sus 4
// distribuciones, reusando filaBarra/barraSVG (mismos widgets que el
// resumen ejecutivo, para no inventar un cuarto tipo de barra).
function seccionDistribucionHTML(titulo, dist, color) {
  if (!dist?.length) return ''
  return `<div style="font-size:12px;font-weight:700;color:#555;margin:10px 0 6px">${titulo}</div>${dist.map(d => filaBarra(d.opcion, d.pct, color)).join('')}`
}

function cuerpoPerfilVotante(r) {
  const callout = r.sintesis ? `<div class="callout">${r.sintesis}</div>` : ''
  const secciones = r.candidatos.map(c => `
    <div class="sec">${c.nombre} <span style="font-weight:400;color:#888;font-size:11px">(n=${c.n})</span></div>
    ${seccionDistribucionHTML('Edad', c.edad, '#1a472a')}
    ${seccionDistribucionHTML('Género', c.genero, '#0369a1')}
    ${seccionDistribucionHTML('Nivel educativo', c.educacion, '#7c3aed')}
    ${seccionDistribucionHTML('Situación laboral', c.laboral, '#b45309')}
  `).join('')
  return callout + secciones
}

function generarHTMLReporte(def, resultado, encuesta) {
  const fecha = new Date().toLocaleString('es-AR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  let cuerpo
  if (resultado.tipo === 'resumen') {
    cuerpo = cuerpoResumenEjecutivo(resultado)
  } else if (resultado.tipo === 'consistencia') {
    cuerpo = cuerpoConsistenciaInterna(resultado)
  } else if (resultado.tipo === 'perfil_votante') {
    cuerpo = cuerpoPerfilVotante(resultado)
  } else if (resultado.secciones) {
    // completo_pregunta_zona: índice al principio con links internos a
    // cada sección de pregunta (Cambio 5). mapa_tematico (18) usa la misma
    // forma { secciones } — una por pregunta — pero sin índice, porque
    // suele tener menos secciones y va casi siempre a pantalla completa.
    const indice = def.id === 'completo_pregunta_zona'
      ? `<div style="margin-bottom:20px;font-size:12px"><b>Índice:</b> ${
          resultado.secciones.map((s, i) => `<a href="#preg${i}" style="color:#1a472a;margin-right:12px">${i + 1}. ${s.titulo}</a>`).join('')
        }</div>`
      : ''
    cuerpo = indice + resultado.secciones.map((s, i) =>
      `<div class="sec" id="preg${i}">${s.titulo}</div>${tablaHTML(s)}`
    ).join('')
  } else {
    // Callout con la síntesis en texto (competitividad_zona, agenda_tematica,
    // indice_participacion, no_respuesta_geo) — antes que nada.
    const callout = resultado.sintesis ? `<div class="callout">${resultado.sintesis}</div>` : ''
    let grafico = ''
    if (def.id === 'evolucion_horaria') grafico = graficoLineaSVG(resultado.filas)
    else if (def.id === 'corte_generacional') grafico = svgBarrasApiladas(resultado)
    else if (def.id === 'evolucion_encuestador') grafico = svgLineasEncuestadores(resultado.series)
    // agenda_tematica: tabla-resumen por candidato ganador antes del
    // detalle zona x zona.
    const resumen = def.id === 'agenda_tematica' ? tablaResumenAgendaHTML(resultado.resumenPorCandidato) : ''
    cuerpo = callout + resumen + grafico + tablaHTML(resultado)
  }

  const css = `*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;color:#1a1a1a;background:#fff;padding:40px;font-size:13px}
.header{border-bottom:3px solid #52B788;padding-bottom:20px;margin-bottom:24px}
h1{font-size:20px;font-weight:800;color:#1a472a;margin:8px 0 4px}
.meta{font-size:11px;color:#888;margin-top:6px}
.sec{font-size:13px;font-weight:700;color:#1a472a;margin:20px 0 10px;padding-bottom:6px;border-bottom:2px solid #e5e7eb}
.callout{background:#f0f9f4;border-left:4px solid #52B788;padding:12px 16px;margin-bottom:18px;font-size:13px;color:#1a472a;border-radius:0 8px 8px 0}
table td,table th{border:1px solid #e5e7eb;padding:6px 10px}
footer{margin-top:28px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:10px;color:#bbb;display:flex;justify-content:space-between}
@media print{body{padding:20px}}`

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${def.titulo} — ${encuesta?.nombre || ''}</title><style>${css}</style></head><body>
<div class="header">
  <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#52B788;text-transform:uppercase">METR1KA · Reporte automático</div>
  <h1>${def.titulo}</h1>
  <div style="font-size:13px;color:#555">${encuesta?.nombre || ''}</div>
  <div class="meta">Generado el ${fecha}</div>
</div>
${cuerpo}
<footer><span>METR1KA — metr1ka.com</span><span>${fecha}</span></footer>
</body></html>`
}

export default function ReportesAutomaticos({ encuesta, preguntas, statsZona, onCargarZonas, loadingZonas }) {
  const [crudo, setCrudo]       = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError]       = useState('')
  const [abierto, setAbierto]   = useState(null) // id del reporte mostrado en pantalla

  // Los reportes se calculan sobre statsZona (por zona/encuestador) + crudo
  // (get_respuestas_crudas, con zona/lat/lng — necesario para candidatos,
  // demográficos, horario y geografía). Ambos se piden solo al entrar a
  // esta pestaña, no en la carga inicial de la encuesta.
  async function cargarDatos() {
    if (crudo || cargando) return
    setCargando(true); setError('')
    try {
      if (!statsZona) await onCargarZonas?.()
      const { data, error: rpcErr } = await supabase.rpc('get_respuestas_crudas', {
        p_encuesta_id: encuesta.id, p_org_id: encuesta.organizacion_id,
        p_equipo_id: null, p_encuestador_id: null, p_fecha_desde: null, p_fecha_hasta: null,
      })
      if (rpcErr) throw rpcErr
      setCrudo(data || { columnas: [], filas: [] })
    } catch (e) {
      console.error('ReportesAutomaticos.cargarDatos:', e)
      setError('No se pudieron cargar los datos para los reportes.')
    }
    setCargando(false)
  }

  const ctx = useMemo(() => ({ preguntas, statsZona, crudo }), [preguntas, statsZona, crudo])

  const resultados = useMemo(() => {
    if (!crudo) return {}
    const out = {}
    for (const def of REPORTES_DEFS) out[def.id] = calcularReporte(def.id, ctx)
    return out
  }, [crudo, ctx])

  function descargarPDF(def) {
    const resultado = resultados[def.id]
    if (!resultado) return
    const html = generarHTMLReporte(def, resultado, encuesta)
    const nombreArchivo = `${def.id}-${(encuesta?.nombre || 'reporte').replace(/[^\w-]+/g, '_')}.pdf`
    generarPDF(html, nombreArchivo)
  }

  if (!crudo) {
    return (
      <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', padding: 24, textAlign: 'center' }}>
        {error && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</div>}
        <p style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 14 }}>
          Los reportes automáticos se calculan en el momento a partir de las respuestas actuales.
        </p>
        <button onClick={cargarDatos} disabled={cargando || loadingZonas} style={{
          padding: '10px 20px', background: 'var(--accent)', color: '#fff', border: 'none',
          borderRadius: 'var(--r)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Sans',
        }}>
          {cargando || loadingZonas ? 'Cargando…' : 'Cargar reportes'}
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {REPORTES_DEFS.map(def => {
          const resultado = resultados[def.id]
          const disponible = !!resultado && (
            resultado.tipo === 'resumen' ? true :
            resultado.tipo === 'consistencia' ? resultado.reglas.length > 0 :
            resultado.tipo === 'perfil_votante' ? resultado.candidatos.length > 0 :
            resultado.secciones ? resultado.secciones.length > 0 : resultado.filas?.length > 0
          )
          return (
            <div key={def.id} style={{
              background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r2)',
              padding: 16, display: 'flex', flexDirection: 'column', gap: 8, opacity: disponible ? 1 : 0.5,
            }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{def.titulo}</div>
              <div style={{ fontSize: 12, color: 'var(--ink3)', flex: 1 }}>{def.descripcion}</div>
              {!disponible && <div style={{ fontSize: 11, color: 'var(--ink3)', fontStyle: 'italic' }}>No disponible para esta encuesta.</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setAbierto(abierto === def.id ? null : def.id)} disabled={!disponible} style={{
                  flex: 1, padding: '7px 10px', background: 'var(--surface)', border: '1.5px solid var(--border2)',
                  borderRadius: 'var(--r)', fontSize: 12, fontWeight: 600, cursor: disponible ? 'pointer' : 'default', fontFamily: 'DM Sans',
                }}>{abierto === def.id ? 'Ocultar' : 'Ver'}</button>
                <button onClick={() => descargarPDF(def)} disabled={!disponible} style={{
                  flex: 1, padding: '7px 10px', background: 'var(--accent)', color: '#fff', border: 'none',
                  borderRadius: 'var(--r)', fontSize: 12, fontWeight: 700, cursor: disponible ? 'pointer' : 'default', fontFamily: 'DM Sans',
                }}>↓ PDF</button>
              </div>
            </div>
          )
        })}
      </div>

      {abierto && resultados[abierto] && (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', padding: 18, overflowX: 'auto' }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{REPORTES_DEFS.find(d => d.id === abierto)?.titulo}</div>
          <VistaResultado resultado={resultados[abierto]} />
        </div>
      )}
    </div>
  )
}

// Vista previa en pantalla — corta a las primeras 20 filas (Cambio 5). El
// HTML que se manda a /api/pdf (generarHTMLReporte → tablaHTML) sigue
// llevando el reporte completo, esto es solo para no colgar la pantalla
// con reportes de cientos de filas.
const MAX_FILAS_PREVIEW = 20

function VistaTabla({ columnas, filas, totalFila }) {
  const recortado = filas.length > MAX_FILAS_PREVIEW
  const filasVista = recortado ? filas.slice(0, MAX_FILAS_PREVIEW) : filas
  return (
    <>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: recortado ? 4 : 16 }}>
        <thead>
          <tr style={{ background: 'var(--surface)' }}>
            {columnas.map(c => <th key={c.key} style={{ padding: '8px 10px', textAlign: c.num ? 'right' : 'left', fontWeight: 700 }}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {filasVista.map((f, i) => (
            <tr key={i} style={{ background: f._bg || (i % 2 === 0 ? 'var(--paper)' : 'var(--surface)'), color: f._fg || 'inherit', borderBottom: '1px solid var(--border)' }}>
              {columnas.map(c => <td key={c.key} style={{ padding: '8px 10px', textAlign: c.num ? 'right' : 'left' }}>{f[c.key] ?? '—'}</td>)}
            </tr>
          ))}
          {totalFila && (
            <tr style={{ fontWeight: 700, borderTop: '2px solid var(--accent)' }}>
              {columnas.map(c => <td key={c.key} style={{ padding: '8px 10px', textAlign: c.num ? 'right' : 'left' }}>{totalFila[c.key] ?? ''}</td>)}
            </tr>
          )}
        </tbody>
      </table>
      {recortado && (
        <div style={{ fontSize: 11, color: 'var(--ink3)', fontStyle: 'italic', marginBottom: 16 }}>
          Mostrando {MAX_FILAS_PREVIEW} de {filas.length} filas — el PDF descargado incluye el reporte completo.
        </div>
      )}
    </>
  )
}

function VistaResumenEjecutivo({ r }) {
  const fila = (nombre, pct, color) => (
    <div key={nombre} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
      <div style={{ width: 140, fontSize: 12, fontWeight: 600, textAlign: 'right' }}>{nombre}</div>
      <div style={{ flex: 1, background: 'var(--surface)', borderRadius: 4, height: 12, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, pct)}%`, background: color, height: '100%' }} />
      </div>
      <div style={{ width: 44, fontSize: 13, fontWeight: 800, color }}>{pct}%</div>
    </div>
  )
  return (
    <div>
      <div style={{ display: 'flex', gap: 14, marginBottom: 18 }}>
        {[['Completadas', r.completadas], ['Total intentos', r.total], ['Participación', `${r.tasaParticipacion}%`]].map(([label, val]) => (
          <div key={label} style={{ flex: 1, background: 'var(--surface)', borderRadius: 10, padding: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent2)' }}>{val}</div>
            <div style={{ fontSize: 10, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
          </div>
        ))}
      </div>
      {r.candidatoIntendente && (<>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent2)', marginBottom: 8 }}>Intención de voto — Intendente</div>
        {r.candidatoIntendente.top.map((c, i) => fila(c.nombre, c.pct, ['#1a472a', '#52B788', '#94a3b8'][i] || '#94a3b8'))}
      </>)}
      {r.candidatoGobernador && (<>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent2)', margin: '18px 0 8px' }}>Intención de voto — Gobernador</div>
        {r.candidatoGobernador.top.map((c, i) => fila(c.nombre, c.pct, ['#1a472a', '#52B788'][i] || '#94a3b8'))}
      </>)}
      {r.evaluacionGestion && (<>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent2)', margin: '18px 0 8px' }}>Evaluación de gestión</div>
        {fila('Positiva', r.evaluacionGestion.positivo, '#2d8f4e')}
        {fila('Neutra', r.evaluacionGestion.neutro, '#b45309')}
        {fila('Negativa', r.evaluacionGestion.negativo, '#c0392b')}
      </>)}
      {r.problemaPrincipal && (<>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent2)', margin: '18px 0 8px' }}>Principal problema</div>
        {r.problemaPrincipal.top.map((c, i) => fila(c.nombre, c.pct, ['#7c3aed', '#9f7aea', '#c4b5fd'][i] || '#c4b5fd'))}
      </>)}
    </div>
  )
}

const CALLOUT_STYLE = { background: 'var(--surface)', borderLeft: '4px solid var(--accent)', borderRadius: '0 8px 8px 0', padding: '10px 14px', fontSize: 12, color: 'var(--ink2)', marginBottom: 16 }

function VistaConsistenciaInterna({ r }) {
  return (
    <div>
      {r.reglas.map((regla, i) => (
        <div key={i} style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent2)', marginBottom: 6 }}>{regla.nombre}</div>
          <div style={CALLOUT_STYLE}>{regla.descripcion}</div>
          <div style={{ fontSize: 12, marginBottom: 8 }}><b>{regla.cantidad}</b> sesión{regla.cantidad === 1 ? '' : 'es'} afectada{regla.cantidad === 1 ? '' : 's'} ({regla.pct}% del total de completadas).</div>
          {regla.muestra.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--surface)' }}>
                  <th style={{ padding: '6px 10px', textAlign: 'left' }}>Zona</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left' }}>Encuestador</th>
                </tr>
              </thead>
              <tbody>
                {regla.muestra.map((m, j) => (
                  <tr key={j} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 10px' }}>{m.zona}</td>
                    <td style={{ padding: '6px 10px' }}>{m.encuestador}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  )
}

function VistaPerfilVotante({ r }) {
  const fila = (nombre, pct, color) => (
    <div key={nombre} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
      <div style={{ width: 130, fontSize: 11, fontWeight: 600, textAlign: 'right' }}>{nombre}</div>
      <div style={{ flex: 1, background: 'var(--surface)', borderRadius: 4, height: 10, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, pct)}%`, background: color, height: '100%' }} />
      </div>
      <div style={{ width: 38, fontSize: 12, fontWeight: 800, color }}>{pct}%</div>
    </div>
  )
  const seccion = (titulo, dist, color) => dist?.length > 0 && (
    <div key={titulo} style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', marginBottom: 4 }}>{titulo}</div>
      {dist.map(d => fila(d.opcion, d.pct, color))}
    </div>
  )
  return (
    <div>
      {r.sintesis && <div style={CALLOUT_STYLE}>{r.sintesis}</div>}
      {r.candidatos.map(c => (
        <div key={c.nombre} style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent2)', marginBottom: 8 }}>
            {c.nombre} <span style={{ fontWeight: 400, color: 'var(--ink3)', fontSize: 11 }}>(n={c.n})</span>
          </div>
          {seccion('Edad', c.edad, '#1a472a')}
          {seccion('Género', c.genero, '#0369a1')}
          {seccion('Nivel educativo', c.educacion, '#7c3aed')}
          {seccion('Situación laboral', c.laboral, '#b45309')}
        </div>
      ))}
    </div>
  )
}

function VistaResultado({ resultado }) {
  if (resultado.tipo === 'resumen') return <VistaResumenEjecutivo r={resultado} />
  if (resultado.tipo === 'consistencia') return <VistaConsistenciaInterna r={resultado} />
  if (resultado.tipo === 'perfil_votante') return <VistaPerfilVotante r={resultado} />
  if (resultado.secciones) {
    return resultado.secciones.map((s, i) => (
      <div key={i} style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent2)', marginBottom: 8 }}>{s.titulo}</div>
        <VistaTabla {...s} />
      </div>
    ))
  }
  return (
    <>
      {resultado.sintesis && <div style={CALLOUT_STYLE}>{resultado.sintesis}</div>}
      {resultado.resumenPorCandidato && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent2)', marginBottom: 8 }}>Resumen por candidato ganador</div>
          <VistaTabla
            columnas={[{ key: 'candidato', label: 'Candidato ganador' }, { key: 'problema', label: 'Principal problema' }, { key: 'pct', label: '%', num: true }]}
            filas={resultado.resumenPorCandidato}
          />
        </div>
      )}
      <VistaTabla {...resultado} />
    </>
  )
}
