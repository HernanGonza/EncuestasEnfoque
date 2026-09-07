import { useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { REPORTES_DEFS, calcularReporte } from '../lib/reportesAutomaticos'

// Reportes automáticos — Sección 8 del plan. A diferencia de "Reportes" (el
// generador manual con cruces armados a mano por el admin), acá el admin
// solo elige, de esta lista fija de 10, cuál quiere ver o descargar: el
// agrupar/sumar/ordenar/porcentaje lo calcula `reportesAutomaticos.js`.
//
// Reusa el mismo mecanismo de PDF que ya existe en Reportes.jsx
// (`window.print()` sobre una ventana con HTML armado del lado del
// cliente) en vez del pipeline nuevo con Puppeteer + Vercel Serverless
// Function que proponía el plan — ver nota en el resumen final de sesión.

function tablaHTML({ columnas, filas, totalFila }) {
  const th = columnas.map(c => `<th style="text-align:${c.num ? 'right' : 'left'}">${c.label}</th>`).join('')
  const filasHTML = filas.map((f, i) => `<tr style="background:${i % 2 === 0 ? '#fff' : '#fafaf8'}">${
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

function generarHTMLReporte(def, resultado, encuesta) {
  const fecha = new Date().toLocaleString('es-AR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const cuerpo = resultado.secciones
    ? resultado.secciones.map(s => `<div class="sec">${s.titulo}</div>${tablaHTML(s)}`).join('')
    : tablaHTML(resultado)

  const css = `*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;color:#1a1a1a;background:#fff;padding:40px;font-size:13px}
.header{border-bottom:3px solid #52B788;padding-bottom:20px;margin-bottom:24px}
h1{font-size:20px;font-weight:800;color:#1a472a;margin:8px 0 4px}
.meta{font-size:11px;color:#888;margin-top:6px}
.sec{font-size:13px;font-weight:700;color:#1a472a;margin:20px 0 10px;padding-bottom:6px;border-bottom:2px solid #e5e7eb}
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
    const win = window.open('', '_blank')
    win.document.write(html); win.document.close(); win.focus()
    setTimeout(() => win.print(), 600)
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
          const disponible = !!resultado && (resultado.secciones ? resultado.secciones.length > 0 : resultado.filas?.length > 0)
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

function VistaTabla({ columnas, filas, totalFila }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 16 }}>
      <thead>
        <tr style={{ background: 'var(--surface)' }}>
          {columnas.map(c => <th key={c.key} style={{ padding: '8px 10px', textAlign: c.num ? 'right' : 'left', fontWeight: 700 }}>{c.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {filas.map((f, i) => (
          <tr key={i} style={{ background: i % 2 === 0 ? 'var(--paper)' : 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
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
  )
}

function VistaResultado({ resultado }) {
  if (resultado.secciones) {
    return resultado.secciones.map((s, i) => (
      <div key={i} style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent2)', marginBottom: 8 }}>{s.titulo}</div>
        <VistaTabla {...s} />
      </div>
    ))
  }
  return <VistaTabla {...resultado} />
}
