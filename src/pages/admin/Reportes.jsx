import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Topbar } from '../../components/layout'
import { Spinner } from '../../components/ui'
import Chart from 'chart.js/auto'
import { generarPDF } from '../../lib/generarPDF'
import CompararEncuestas from '../../components/CompararEncuestas'
import styles from './Page.module.css'
import { BarChart2, PieChart, FileText, Download, Filter, RefreshCw, ChevronDown, ChevronUp, Zap, Plus, Trash2, MapPin, Scale } from 'lucide-react'

const PALETA = ['#1a472a','#0369a1','#7c3aed','#b45309','#be185d','#047857','#2d6a4f','#0284c7','#dc2626','#d97706']

/* ── Componente de gráfico individual ── */
function MiniChart({ pregunta, filas, tipo = 'bar', color = 'var(--accent)' }) {
  const ref = useRef(null)
  const chartRef = useRef(null)

  const datos = useMemo(() => {
    if (!filas?.length) return null
    const conteo = {}
    if (pregunta.tipo === 'si_no') {
      filas.forEach(f => {
        const key = f.valor_texto === 'Sí' || f.valor_booleano === true ? 'Sí' : 'No'
        conteo[key] = (conteo[key] || 0) + Number(f.cantidad)
      })
    } else if (pregunta.tipo === 'escala') {
      filas.forEach(f => {
        if (f.valor_numero) conteo[String(f.valor_numero)] = Number(f.cantidad)
      })
    } else if (pregunta.tipo === 'opcion_multiple') {
      ;(pregunta.opciones_pregunta || []).forEach(op => {
        const f = filas.find(r => r.opcion_id === op.id || r.valor_texto === op.texto || r.opcion_texto === op.texto)
        conteo[op.texto] = f ? Number(f.cantidad) : 0
      })
    }
    return conteo
  }, [filas, pregunta])

  useEffect(() => {
    if (!ref.current || !datos) return
    if (chartRef.current) chartRef.current.destroy()
    const labels = Object.keys(datos)
    const values = Object.values(datos)
    const total  = values.reduce((a, b) => a + b, 0)
    const isPie  = tipo === 'pie' || tipo === 'doughnut'

    chartRef.current = new Chart(ref.current.getContext('2d'), {
      type: isPie ? 'doughnut' : tipo === 'horizontal' ? 'bar' : 'bar',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: isPie ? PALETA.slice(0, labels.length) : color,
          borderRadius: isPie ? 0 : 5,
          borderSkipped: false,
          borderWidth: isPie ? 2 : 0,
          borderColor: isPie ? '#fff' : undefined,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        indexAxis: tipo === 'horizontal' ? 'y' : 'x',
        plugins: {
          legend: { display: isPie, position: 'bottom', labels: { font: { size: 10 }, boxWidth: 10 } },
          tooltip: {
            callbacks: {
              label: ctx => {
                const pct = total ? Math.round(ctx.raw / total * 100) : 0
                return ` ${ctx.raw} respuestas (${pct}%)`
              }
            }
          }
        },
        scales: isPie ? {} : {
          x: { grid: { display: false }, ticks: { font: { size: 10 }, color: 'var(--ink4)', maxRotation: 30 } },
          y: { display: tipo !== 'horizontal', beginAtZero: true, ticks: { font: { size: 10 } } },
        }
      }
    })
    return () => chartRef.current?.destroy()
  }, [datos, tipo, color])

  if (!datos || Object.values(datos).every(v => v === 0)) {
    return <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink4)', fontSize: 13 }}>Sin datos</div>
  }

  return <div style={{ height: 140 }}><canvas ref={ref} /></div>
}

/* ── Vista Por Pregunta con selector de tipo de gráfico ── */
/* ── Tabla de resultados para preguntas de tipo matriz ── */
function MatrizTabla({ pregunta, filas, color }) {
  const filasDef   = (pregunta.config_matriz?.filas    || []).map(f => typeof f === 'string' ? f : f.texto)
  const columnasDef = (pregunta.config_matriz?.columnas || []).map(c => typeof c === 'string' ? c : c.texto)

  // Contar respuestas: cada respuesta es un JSON con { fila: columna }
  const conteo = {}
  filasDef.forEach(f => { conteo[f] = {}; columnasDef.forEach(c => { conteo[f][c] = 0 }) })

  filas.forEach(resp => {
    try {
      const val = typeof resp.valor_texto === 'string' ? JSON.parse(resp.valor_texto) : resp.valor_texto
      if (val && typeof val === 'object') {
        Object.entries(val).forEach(([fi, col]) => {
          // fi puede ser índice numérico o texto de fila
          const filaTexto = isNaN(Number(fi)) ? fi : filasDef[Number(fi)]
          if (filaTexto && conteo[filaTexto] && columnasDef.includes(col)) {
            conteo[filaTexto][col] = (conteo[filaTexto][col] || 0) + 1
          }
        })
      }
    } catch {}
  })

  if (!filasDef.length || !columnasDef.length) return (
    <div style={{ color: 'var(--ink3)', fontSize: 13 }}>Sin configuración de matriz</div>
  )

  const totalesFila = filasDef.map(f => columnasDef.reduce((s, c) => s + (conteo[f]?.[c] || 0), 0))
  const maxTotal = Math.max(...totalesFila, 1)

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%', minWidth: `${columnasDef.length * 80 + 180}px` }}>
        <thead>
          <tr style={{ background: 'var(--surface)', borderBottom: '2px solid var(--border)' }}>
            <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 0.5, width: 180 }} />
            {columnasDef.map(col => (
              <th key={col} style={{ padding: '8px 10px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{col}</th>
            ))}
            <th style={{ padding: '8px 10px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {filasDef.map((fila, fi) => {
            const totalFila = totalesFila[fi]
            return (
              <tr key={fi} style={{ borderBottom: '1px solid var(--border)', background: fi % 2 === 0 ? 'var(--paper)' : 'var(--surface)' }}>
                <td style={{ padding: '9px 12px', fontSize: 13, fontWeight: 600, color: 'var(--ink)', verticalAlign: 'middle' }}>{fila}</td>
                {columnasDef.map(col => {
                  const n = conteo[fila]?.[col] || 0
                  const pct = totalFila > 0 ? Math.round(n / totalFila * 100) : 0
                  return (
                    <td key={col} style={{ padding: '9px 10px', textAlign: 'center', verticalAlign: 'middle' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: n > 0 ? color : 'var(--ink3)' }}>{n}</div>
                      {n > 0 && <div style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 1 }}>{pct}%</div>}
                    </td>
                  )
                })}
                <td style={{ padding: '9px 10px', textAlign: 'center', verticalAlign: 'middle' }}>
                  <span style={{ fontFamily: 'var(--font-num)', fontSize: 13, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: 'var(--ink2)' }}>{totalFila}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ── Clasificación manual de preguntas de texto libre ── */
function TextoLibreClasificado({ pregunta, filas, color, encuestaId }) {
  const [categorias, setCategorias]   = useState([])
  const [loading, setLoading]         = useState(true)
  const [nuevaCat, setNuevaCat]       = useState('')
  const [nuevaCant, setNuevaCant]     = useState('')
  const [editando, setEditando]       = useState(null)
  const [saving, setSaving]           = useState(false)
  const [mostrarResp, setMostrarResp] = useState(false)
  const chartRef  = useRef(null)
  const chartInst = useRef(null)

  const textos           = filas.filter(f => f.valor_texto?.trim())
  const totalClasificado = categorias.reduce((s, c) => s + c.cantidad, 0)

  useEffect(() => {
    if (!encuestaId || !pregunta?.id) return
    supabase.from('clasificaciones_texto_libre').select('*')
      .eq('encuesta_id', encuestaId).eq('pregunta_id', pregunta.id).order('orden')
      .then(({ data }) => { setCategorias(data || []); setLoading(false) })
  }, [encuestaId, pregunta?.id])

  useEffect(() => {
    if (!chartRef.current || !categorias.length) return
    if (chartInst.current) { chartInst.current.destroy(); chartInst.current = null }
    const sorted = [...categorias].sort((a, b) => b.cantidad - a.cantidad)
    const COLS = ['#1a472a','#0369a1','#7c3aed','#b45309','#be185d','#047857','#dc2626','#d97706']
    chartInst.current = new Chart(chartRef.current, {
      type: 'bar',
      data: {
        labels: sorted.map(c => c.categoria),
        datasets: [{ data: sorted.map(c => c.cantidad), backgroundColor: sorted.map((_,i) => COLS[i%COLS.length]+'cc'), borderRadius: 6, borderSkipped: false }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => { const pct = totalClasificado > 0 ? Math.round(ctx.parsed.x/totalClasificado*100) : 0; return ` ${ctx.parsed.x} (${pct}%)` } } } },
        scales: {
          x: { beginAtZero: true, grid: { color: 'var(--surface2)' }, ticks: { stepSize: 1, font: { family: 'DM Sans', size: 11 } } },
          y: { grid: { display: false }, ticks: { font: { family: 'DM Sans', size: 12 } } },
        }
      }
    })
    return () => { if (chartInst.current) { chartInst.current.destroy(); chartInst.current = null } }
  }, [categorias, totalClasificado])

  async function agregar() {
    const cat = nuevaCat.trim(); const cant = parseInt(nuevaCant)
    if (!cat || isNaN(cant) || cant < 0) return
    setSaving(true)
    const { data, error } = await supabase.from('clasificaciones_texto_libre')
      .upsert({ encuesta_id: encuestaId, pregunta_id: pregunta.id, categoria: cat, cantidad: cant, orden: categorias.length }, { onConflict: 'encuesta_id,pregunta_id,categoria' })
      .select().single()
    if (!error && data) {
      setCategorias(prev => { const e = prev.findIndex(c => c.id === data.id); return e >= 0 ? prev.map(c => c.id === data.id ? data : c) : [...prev, data] })
      setNuevaCat(''); setNuevaCant('')
    }
    setSaving(false)
  }

  async function actualizar(id, campo, valor) {
    const update = { [campo]: campo === 'cantidad' ? parseInt(valor) || 0 : valor }
    setCategorias(prev => prev.map(c => c.id === id ? { ...c, ...update } : c))
    await supabase.from('clasificaciones_texto_libre').update(update).eq('id', id)
  }

  async function eliminar(id) {
    setCategorias(prev => prev.filter(c => c.id !== id))
    await supabase.from('clasificaciones_texto_libre').delete().eq('id', id)
  }

  if (loading) return <div style={{ padding: '12px 0', color: 'var(--ink3)', fontSize: 13 }}>Cargando...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Gráfico */}
      {categorias.length > 0 && (
        <div style={{ height: Math.max(120, categorias.length * 44) }}>
          <canvas ref={chartRef} />
        </div>
      )}
      {/* Chips */}
      {categorias.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {[...categorias].sort((a,b) => b.cantidad - a.cantidad).map(c => {
            const pct = totalClasificado > 0 ? Math.round(c.cantidad / totalClasificado * 100) : 0
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 100, background: `${color}12`, border: `1.5px solid ${color}40` }}>
                {editando === c.id ? (
                  <>
                    <input defaultValue={c.categoria} autoFocus onBlur={e => { actualizar(c.id, 'categoria', e.target.value); setEditando(null) }} style={{ border: 'none', background: 'transparent', fontSize: 12, fontWeight: 700, color, outline: 'none', width: 120 }} />
                    <input defaultValue={c.cantidad} type="number" min="0" onBlur={e => { actualizar(c.id, 'cantidad', e.target.value); setEditando(null) }} style={{ border: 'none', background: 'transparent', fontSize: 12, fontWeight: 800, color, outline: 'none', width: 40, textAlign: 'right' }} />
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 12, fontWeight: 700, color }}>{c.categoria}</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color, fontFamily: 'var(--font-num)', fontVariantNumeric: 'tabular-nums' }}>{c.cantidad}</span>
                    <span style={{ fontSize: 10, color: `${color}99` }}>{pct}%</span>
                    <button onClick={() => setEditando(c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: `${color}88`, fontSize: 11, padding: '0 2px' }}>✏️</button>
                    <button onClick={() => eliminar(c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef444488', fontSize: 12, padding: '0 2px', lineHeight: 1 }}>×</button>
                  </>
                )}
              </div>
            )
          })}
          <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{totalClasificado} clasificadas · {textos.length} total</span>
        </div>
      )}
      {/* Formulario */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={nuevaCat} onChange={e => setNuevaCat(e.target.value)} onKeyDown={e => e.key === 'Enter' && agregar()} placeholder="Categoría (ej. Empleo)" style={{ flex: 1, minWidth: 180, padding: '7px 10px', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 13, fontFamily: 'DM Sans', outline: 'none', background: 'var(--surface)' }} />
        <input value={nuevaCant} onChange={e => setNuevaCant(e.target.value)} onKeyDown={e => e.key === 'Enter' && agregar()} placeholder="Cantidad" type="number" min="0" style={{ width: 90, padding: '7px 10px', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 13, fontFamily: 'DM Sans', outline: 'none', background: 'var(--surface)' }} />
        <button onClick={agregar} disabled={saving || !nuevaCat.trim() || !nuevaCant} style={{ padding: '7px 16px', background: color, color: '#fff', border: 'none', borderRadius: 'var(--r)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Sans', opacity: (!nuevaCat.trim() || !nuevaCant) ? 0.5 : 1 }}>
          {saving ? '...' : '+ Agregar'}
        </button>
      </div>
      {/* Respuestas originales */}
      <div>
        <button onClick={() => setMostrarResp(p => !p)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--ink3)', fontFamily: 'DM Sans', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
          {mostrarResp ? '▾' : '▸'} Ver {textos.length} respuestas originales
        </button>
        {mostrarResp && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 220, overflowY: 'auto', marginTop: 8 }}>
            {textos.map((f, j) => (
              <div key={j} style={{ fontSize: 12, padding: '6px 10px', background: 'var(--surface)', borderRadius: 'var(--r)', borderLeft: `3px solid ${color}`, color: 'var(--ink2)' }}>
                "{f.valor_texto}"
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PorPregunta({ preguntas, respuestasMap, encuestaId }) {
  const [tiposGrafico, setTiposGrafico] = useState({})

  function setTipo(pregId, tipo) {
    setTiposGrafico(prev => ({ ...prev, [pregId]: tipo }))
  }

  const tiposDisponibles = (preg) => {
    if (preg.tipo === 'si_no') return [['doughnut','Dona'],['bar','Barras']]
    if (preg.tipo === 'opcion_multiple') return [['horizontal','Barras horiz.'],['bar','Barras vert.'],['doughnut','Dona']]
    if (preg.tipo === 'escala') return [['bar','Barras'],['horizontal','Barras horiz.']]
    return []
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {preguntas.filter(p => p.clave_base !== 'participa').map((p, i) => {
        const tipos = tiposDisponibles(p)
        const tipoActual = tiposGrafico[p.id] || (tipos[0]?.[0] ?? 'bar')
        const total = (respuestasMap[p.id] || []).reduce((s, f) => s + Number(f.cantidad), 0)
        return (
          <div key={p.id} style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', padding: 20, borderLeft: `3px solid ${PALETA[i % PALETA.length]}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.4 }}>{p.texto}</div>
                <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>
                  {p.tipo} · {total} respuestas
                </div>
              </div>
              {tipos.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  {tipos.map(([v, label]) => (
                    <button key={v} onClick={() => setTipo(p.id, v)}
                      style={{ padding: '4px 10px', fontSize: 11, fontFamily: 'DM Sans', border: '1.5px solid', borderRadius: 'var(--r)', cursor: 'pointer', transition: 'all .15s',
                        borderColor: tipoActual === v ? PALETA[i % PALETA.length] : 'var(--border2)',
                        background:  tipoActual === v ? PALETA[i % PALETA.length] + '15' : 'var(--surface)',
                        color:       tipoActual === v ? PALETA[i % PALETA.length] : 'var(--ink3)',
                        fontWeight:  tipoActual === v ? 700 : 500,
                      }}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {p.tipo === 'texto_libre' ? (
              <TextoLibreClasificado
                pregunta={p}
                filas={respuestasMap[p.id] || []}
                color={PALETA[i % PALETA.length]}
                encuestaId={encuestaId}
              />
            ) : p.tipo === 'matriz' ? (
              <MatrizTabla pregunta={p} filas={respuestasMap[p.id] || []} color={PALETA[i % PALETA.length]} />
            ) : (
              <MiniChart pregunta={p} filas={respuestasMap[p.id] || []} tipo={tipoActual} color={PALETA[i % PALETA.length]} />
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ── Cruce de datos entre dos preguntas en un único gráfico ── */
function GraficoCruce({ preguntas, sesiones, onRemove, onCruceChange, index }) {
  const [pregA, setPregA] = useState('')
  const [pregB, setPregB] = useState('')
  const [tipoGrafico, setTipoGrafico] = useState('stacked')
  const chartRef = useRef(null)
  const chartInst = useRef(null)

  const pA = preguntas.find(p => p.id === pregA)
  const pB = preguntas.find(p => p.id === pregB)
  const comparables = preguntas.filter(p =>
    ['si_no','escala','opcion_multiple'].includes(p.tipo) && p.clave_base !== 'participa'
  )

  const datosCruce = useMemo(() => {
    if (!pA || !pB || !sesiones?.length) return null

    if (tipoGrafico === 'scatter') {
      const pts = sesiones.map(s => {
        const va = s.respuestas?.[pA.id]
        const vb = s.respuestas?.[pB.id]
        const na = parseFloat(va)
        const nb = parseFloat(vb)
        return isNaN(na) || isNaN(nb) ? null : { x: na, y: nb }
      }).filter(Boolean)
      return pts.length ? { tipo: 'scatter', puntos: pts } : null
    }

    const valoresA = [...new Set(sesiones.map(s => s.respuestas?.[pA.id]).filter(Boolean))].sort()
    const valoresB = [...new Set(sesiones.map(s => s.respuestas?.[pB.id]).filter(Boolean))].sort()
    if (!valoresA.length || !valoresB.length) return null

    const matriz = {}
    valoresA.forEach(va => {
      matriz[va] = {}
      valoresB.forEach(vb => { matriz[va][vb] = 0 })
    })
    sesiones.forEach(s => {
      const va = s.respuestas?.[pA.id]
      const vb = s.respuestas?.[pB.id]
      if (va && vb && matriz[va] !== undefined) {
        matriz[va][vb] = (matriz[va][vb] || 0) + 1
      }
    })
    return { tipo: 'bar', labelsX: valoresA, seriesY: valoresB, matriz }
  }, [pA?.id, pB?.id, tipoGrafico, sesiones])

  // El canvas siempre está en el DOM — si lo condicionamos, el ref llega null cuando se monta
  useEffect(() => {
    if (!chartRef.current || !datosCruce) return
    if (chartInst.current) { chartInst.current.destroy(); chartInst.current = null }
    const ctx = chartRef.current.getContext('2d')

    if (datosCruce.tipo === 'scatter') {
      chartInst.current = new Chart(ctx, {
        type: 'scatter',
        data: {
          datasets: [{
            label: `${pA.texto.slice(0,25)} vs ${pB.texto.slice(0,25)}`,
            data: datosCruce.puntos,
            backgroundColor: PALETA[index % PALETA.length] + 'cc',
            pointRadius: 6, pointHoverRadius: 8,
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: c => `(${c.parsed.x}, ${c.parsed.y})` } }
          },
          scales: {
            x: { title: { display: true, text: pA.texto.slice(0,45), font: { size: 11 } }, grid: { color: 'rgba(0,0,0,0.05)' } },
            y: { title: { display: true, text: pB.texto.slice(0,45), font: { size: 11 } }, grid: { color: 'rgba(0,0,0,0.05)' } },
          }
        }
      })
    } else {
      const { labelsX, seriesY, matriz } = datosCruce
      const stacked = tipoGrafico === 'stacked'
      chartInst.current = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labelsX,
          datasets: seriesY.map((vb, i) => ({
            label: vb,
            data: labelsX.map(va => matriz[va]?.[vb] || 0),
            backgroundColor: PALETA[i % PALETA.length],
            borderRadius: stacked ? 0 : 4,
            borderSkipped: false,
          }))
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { font: { size: 11 }, padding: 12, boxWidth: 12 } } },
          scales: {
            x: { stacked, title: { display: true, text: pA.texto.slice(0,50), font: { size: 11 } }, grid: { display: false } },
            y: { stacked, ticks: { stepSize: 1 }, grid: { color: 'rgba(0,0,0,0.05)' } },
          }
        }
      })
    }
  }, [datosCruce])

  // Notificar al padre cuando cambia el cruce para que pueda exportarlo
  useEffect(() => {
    if (onCruceChange) {
      onCruceChange({ pA, pB, datosCruce })
    }
  }, [pA?.id, pB?.id, datosCruce])

  // Cleanup solo al desmontar
  useEffect(() => {
    return () => { if (chartInst.current) { chartInst.current.destroy(); chartInst.current = null } }
  }, [])

  const sel = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 12, background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'DM Sans', outline: 'none' }

  return (
    <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: PALETA[index % PALETA.length] }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1 }}>
            Cruce {index + 1}
          </span>
        </div>
        <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink3)', padding: 4, borderRadius: 6 }}>
          <Trash2 size={14} />
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Pregunta — eje X</label>
          <select value={pregA} onChange={e => setPregA(e.target.value)} style={sel}>
            <option value="">Seleccionar...</option>
            {comparables.map(p => <option key={p.id} value={p.id}>{p.texto.slice(0,55)}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Cruzar con</label>
          <select value={pregB} onChange={e => setPregB(e.target.value)} style={sel}>
            <option value="">Seleccionar...</option>
            {comparables.filter(p => p.id !== pregA).map(p => <option key={p.id} value={p.id}>{p.texto.slice(0,55)}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Tipo</label>
          <select value={tipoGrafico} onChange={e => setTipoGrafico(e.target.value)} style={{ ...sel, width: 'auto', minWidth: 140 }}>
            <option value="stacked">Barras apiladas</option>
            <option value="grouped">Barras agrupadas</option>
            <option value="scatter">Dispersión</option>
          </select>
        </div>
      </div>

      {/* Canvas siempre en el DOM para que el ref esté disponible cuando cambia datosCruce */}
      <div style={{ height: 340, position: 'relative', display: datosCruce ? 'block' : 'none' }}>
        <canvas ref={chartRef} />
      </div>

      {!datosCruce && pA && pB && (
        <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink3)', fontSize: 13 }}>
          Sin datos suficientes para este cruce.{tipoGrafico === 'scatter' ? ' Para dispersión ambas preguntas deben ser numéricas.' : ''}
        </div>
      )}
      {(!pA || !pB) && (
        <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink3)', fontSize: 13, border: '1.5px dashed var(--border2)', borderRadius: 'var(--r)' }}>
          Seleccioná dos preguntas para ver el cruce de datos en un único gráfico
        </div>
      )}
    </div>
  )
}

/* ── Tabla de datos crudos con sort, filter y scroll propio ── */
function TablaDatosCrudos({ datosExport, loadingDatos, onActualizar, onExportarCSV }) {
  const [sortCol,   setSortCol]   = useState(null)
  const [sortDir,   setSortDir]   = useState('asc')
  const [filtroGlobal, setFiltroGlobal] = useState('')

  const columnas = datosExport?.columnas || []
  const filas    = datosExport?.filas    || []

  const filasFiltradas = useMemo(() => {
    let f = filas
    if (filtroGlobal.trim()) {
      const q = filtroGlobal.toLowerCase()
      f = f.filter(fila =>
        [fila.encuestador, fila.equipo, ...columnas.map(col => (fila.respuestas||{})[col.id])]
          .some(v => v && String(v).toLowerCase().includes(q))
      )
    }
    if (sortCol) {
      f = [...f].sort((a, b) => {
        const va = sortCol === 'encuestador' ? a.encuestador
          : sortCol === 'equipo' ? a.equipo
          : sortCol === 'lat' ? a.lat
          : sortCol === 'lng' ? a.lng
          : (a.respuestas||{})[sortCol]
        const vb = sortCol === 'encuestador' ? b.encuestador
          : sortCol === 'equipo' ? b.equipo
          : sortCol === 'lat' ? b.lat
          : sortCol === 'lng' ? b.lng
          : (b.respuestas||{})[sortCol]
        const na = parseFloat(va), nb = parseFloat(vb)
        const cmp = !isNaN(na) && !isNaN(nb)
          ? na - nb
          : String(va||'').localeCompare(String(vb||''), 'es')
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return f
  }, [filas, filtroGlobal, sortCol, sortDir])

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const thStyle = (col) => ({
    position: 'sticky', top: 0, zIndex: 2,
    background: 'var(--surface)',
    padding: '9px 14px', textAlign: 'left',
    fontSize: 10, fontWeight: 700, color: sortCol === col ? 'var(--accent)' : 'var(--ink3)',
    textTransform: 'uppercase', letterSpacing: 0.5,
    whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none',
    borderBottom: '2px solid var(--border)',
  })

  const sortIndicator = (col) => sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  return (
    <div style={{
      /* Romper el max-width del contenedor padre con márgenes negativos */
      marginLeft: '-28px', marginRight: '-28px',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Barra de herramientas */}
      <div style={{ padding: '12px 28px', background: 'var(--paper)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center' }}>
        <input
          placeholder="Buscar en todas las columnas..."
          value={filtroGlobal}
          onChange={e => setFiltroGlobal(e.target.value)}
          style={{ flex: 1, padding: '7px 12px', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 12, fontFamily: 'DM Sans', background: 'var(--surface)', color: 'var(--ink)', outline: 'none', maxWidth: 340 }}
        />
        {filtroGlobal && (
          <span style={{ fontSize: 12, color: 'var(--ink3)' }}>{filasFiltradas.length} de {filas.length}</span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={onActualizar} disabled={loadingDatos}
            style={{ padding: '6px 12px', background: 'var(--surface)', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 12, cursor: 'pointer', fontFamily: 'DM Sans', color: 'var(--ink2)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <RefreshCw size={12} /> Actualizar
          </button>
          <button onClick={onExportarCSV} disabled={!filas.length}
            style={{ padding: '6px 12px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Sans', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Download size={12} /> Exportar CSV
          </button>
        </div>
      </div>

      {/* Tabla */}
      {loadingDatos ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spinner size="md" /></div>
      ) : !filas.length ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink3)', fontSize: 13 }}>
          No hay datos todavía. Hacé clic en Actualizar.
        </div>
      ) : (
        <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 240px)' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, width: 'max-content', minWidth: '100%' }}>
            <thead>
              <tr>
                {[['encuestador','Encuestador'],['equipo','Equipo'],['lat','Lat'],['lng','Lng']].map(([col, label]) => (
                  <th key={col} onClick={() => toggleSort(col)} style={thStyle(col)}>
                    {label}{sortIndicator(col)}
                  </th>
                ))}
                {columnas.map(col => (
                  <th key={col.id} onClick={() => toggleSort(col.id)} style={thStyle(col.id)}>
                    {col.texto}{sortIndicator(col.id)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filasFiltradas.map((fila, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--paper)' : 'var(--surface)' }}>
                  <td style={{ padding: '8px 14px', fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{fila.encuestador || '—'}</td>
                  <td style={{ padding: '8px 14px', color: 'var(--ink2)', whiteSpace: 'nowrap' }}>{fila.equipo || '—'}</td>
                  <td style={{ padding: '8px 14px', color: 'var(--ink3)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{fila.lat ? Number(fila.lat).toFixed(5) : '—'}</td>
                  <td style={{ padding: '8px 14px', color: 'var(--ink3)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{fila.lng ? Number(fila.lng).toFixed(5) : '—'}</td>
                  {columnas.map(col => {
                    const val = (fila.respuestas||{})[col.id]
                    // Si es una matriz (JSON), mostrar "Fila: Columna" resumido
                    let display = val || '—'
                    if (col.tipo === 'matriz' && val) {
                      try {
                        const parsed = typeof val === 'string' ? JSON.parse(val) : val
                        if (typeof parsed === 'object') {
                          const filasDef = (col.config_matriz?.filas || []).map(f => typeof f === 'string' ? f : f.texto)
                          display = Object.entries(parsed)
                            .map(([fi, respuesta]) => {
                              const filaTexto = isNaN(Number(fi)) ? fi : (filasDef[Number(fi)] || fi)
                              return `${filaTexto}: ${respuesta}`
                            }).join(' | ')
                        }
                      } catch { display = val }
                    }
                    return (
                      <td key={col.id} style={{ padding: '8px 14px', color: 'var(--ink2)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={typeof display === 'string' ? display : ''}>
                        {display}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ── KPI Card ── */
function KpiCard({ label, value, sub, color, icon }) {
  return (
    <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', padding: '16px 20px', borderLeft: `4px solid ${color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
        {icon}{label}
      </div>
      <div style={{ fontFamily: 'var(--font-num)', fontSize: 25, fontWeight: 500, color: (value === 0 || value === '0') ? 'var(--metric-zero)' : color, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

/* ── Exportar HTML/PDF ── */
function generarHTML(encuesta, preguntas, respuestas, resumen, cruces, datosCrudos, sesiones, mapaImgSrc, cfg, clasificaciones) {
  const filasPorPregunta = {}
  preguntas.forEach(p => { filasPorPregunta[String(p.id)] = [] })
  respuestas.forEach(f => { if (filasPorPregunta[String(f.pregunta_id)]) filasPorPregunta[String(f.pregunta_id)].push(f) })

  const promedioEscala = (() => {
    const fe = respuestas.filter(f => f.tipo === 'escala' && f.valor_numero != null)
    if (!fe.length) return '—'
    const suma = fe.reduce((s, f) => s + Number(f.valor_numero) * Number(f.cantidad), 0)
    const total = fe.reduce((s, f) => s + Number(f.cantidad), 0)
    return total ? (suma / total).toFixed(1) : '—'
  })()

  const fecha = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })

  const preguntasHTML = preguntas.filter(p => p.clave_base !== 'participa').map((p, idx) => {
    const filas = filasPorPregunta[String(p.id)] || []
    const color = PALETA[idx % PALETA.length]
    const opciones = p.opciones_pregunta || []

    // ── Texto libre ──
    if (p.tipo === 'texto_libre') {
      const clases = (clasificaciones || []).filter(c => c.pregunta_id === p.id)
      if (clases.length > 0) {
        // Mostrar gráfico de barras SVG + tabla de categorías
        const sorted = [...clases].sort((a, b) => b.cantidad - a.cantidad)
        const totalClasif = sorted.reduce((s, c) => s + c.cantidad, 0)
        const maxVal = sorted[0]?.cantidad || 1
        const COLS = ['#1a472a','#0369a1','#7c3aed','#b45309','#be185d','#047857','#dc2626','#d97706']
        const barH = 28
        const barGap = 8
        const chartH = sorted.length * (barH + barGap)
        const chartW = 480
        const labelW = 160
        const barMaxW = chartW - labelW - 60

        const bars = sorted.map((c, i) => {
          const col = COLS[i % COLS.length]
          const pct = totalClasif > 0 ? Math.round(c.cantidad / totalClasif * 100) : 0
          const bw = Math.round(c.cantidad / maxVal * barMaxW)
          const y = i * (barH + barGap)
          const label = c.categoria.length > 22 ? c.categoria.slice(0,21)+'…' : c.categoria
          return `
            <text x="${labelW - 6}" y="${y + barH/2 + 4}" text-anchor="end" font-family="sans-serif" font-size="11" fill="#444">${label}</text>
            <rect x="${labelW}" y="${y}" width="${bw}" height="${barH}" fill="${col}" rx="3"/>
            <text x="${labelW + bw + 6}" y="${y + barH/2 + 4}" font-family="sans-serif" font-size="11" fill="#555" font-weight="600">${c.cantidad} <tspan fill="#999" font-weight="400">${pct}%</tspan></text>
          `
        }).join('')

        return `<div class="preg"><div class="preg-h" style="border-color:${color}"><b>${p.texto}</b> <span class="badge">Texto libre · ${filas.length} resp. · ${clases.length} categorías</span></div>
          <svg xmlns="http://www.w3.org/2000/svg" width="${chartW}" height="${chartH}" style="overflow:visible;margin-bottom:8px">${bars}</svg>
        </div>`
      }
      // Sin clasificaciones: mostrar lista de respuestas
      const textos = filas.filter(f => f.valor_texto?.trim()).slice(0, 8)
      return `<div class="preg"><div class="preg-h" style="border-color:${color}"><b>${p.texto}</b> <span class="badge">Texto libre · ${filas.length} resp.</span></div>${textos.map(f => `<div class="txt" style="border-color:${color}">"${f.valor_texto}"</div>`).join('')}${filas.length > 8 ? `<p style="font-size:10px;color:#999;margin-top:6px">... y ${filas.length - 8} respuestas más</p>` : ''}</div>`
    }

    // ── Matriz ──
    if (p.tipo === 'matriz') {
      const filasDef = (p.config_matriz?.filas || []).map(f => typeof f === 'string' ? f : f.texto)
      const colsDef  = (p.config_matriz?.columnas || []).map(c => typeof c === 'string' ? c : c.texto)
      const cont = {}
      filasDef.forEach(f => { cont[f] = {}; colsDef.forEach(c => { cont[f][c] = 0 }) })
      filas.forEach(r => {
        try {
          const v = typeof r.valor_texto === 'string' ? JSON.parse(r.valor_texto) : r.valor_texto
          if (v && typeof v === 'object') {
            Object.entries(v).forEach(([fi, col]) => {
              const ft = isNaN(Number(fi)) ? fi : (filasDef[Number(fi)] || fi)
              if (ft && cont[ft] && colsDef.includes(col)) cont[ft][col] = (cont[ft][col] || 0) + 1
            })
          }
        } catch {}
      })
      const total = Object.values(cont).reduce((s, row) => s + Object.values(row).reduce((a,b)=>a+b, 0), 0)
      const thCols = colsDef.map(c => `<th style="padding:6px 10px;font-size:10px;color:#666;text-align:center;background:#f9fafb">${c}</th>`).join('')
      const rows = filasDef.map(f => {
        const rowTot = colsDef.reduce((s, c) => s + (cont[f]?.[c] || 0), 0)
        const celdas = colsDef.map(c => {
          const n = cont[f]?.[c] || 0
          const pct = rowTot > 0 ? Math.round(n / rowTot * 100) : 0
          const bg = pct > 50 ? `${color}22` : pct > 25 ? `${color}11` : 'transparent'
          return `<td style="padding:6px 10px;text-align:center;background:${bg};font-size:12px">${n > 0 ? `<b>${n}</b> <span style="font-size:10px;color:#999">${pct}%</span>` : '—'}</td>`
        }).join('')
        return `<tr><td style="padding:6px 10px;font-size:12px;font-weight:600;border-right:1px solid #e5e7eb">${f}</td>${celdas}</tr>`
      }).join('')
      return `<div class="preg"><div class="preg-h" style="border-color:${color}"><b>${p.texto}</b> <span class="badge">Matriz · ${total} respuestas</span></div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr><th style="padding:6px 10px;background:#f9fafb"></th>${thCols}</tr></thead>
        <tbody>${rows}</tbody>
      </table></div></div>`
    }

    // ── Opciones / Si-No / Escala ──
    const conteo = {}
    if (p.tipo === 'si_no') {
      filas.forEach(f => {
        const k = f.valor_texto === 'Sí' || f.valor_booleano === true ? 'Sí' : 'No'
        conteo[k] = (conteo[k] || 0) + Number(f.cantidad)
      })
    } else if (p.tipo === 'escala') {
      for (let i = 1; i <= 10; i++) {
        const f = filas.find(r => Number(r.valor_numero) === i)
        if (f) conteo[String(i)] = Number(f.cantidad)
      }
    } else {
      opciones.forEach(op => {
        const f = filas.find(r => r.opcion_id === op.id || r.valor_texto === op.texto || r.opcion_texto === op.texto)
        conteo[op.texto] = f ? Number(f.cantidad) : 0
      })
    }

    const total = Object.values(conteo).reduce((a,b)=>a+b, 0)
    if (!total) return `<div class="preg"><div class="preg-h" style="border-color:${color}"><b>${p.texto}</b></div><p class="empty">Sin respuestas</p></div>`

    const barras = Object.entries(conteo)
      .filter(([,v]) => v > 0)
      .sort((a,b) => b[1]-a[1])
      .map(([l, v]) => {
        const pct = Math.round(v / total * 100)
        return `<div class="row"><span class="lbl">${l}</span><div class="track"><div class="fill" style="width:${pct}%;background:${color}"></div></div><span class="pct">${pct}% <span style="color:#999">(${v})</span></span></div>`
      }).join('')

    return `<div class="preg"><div class="preg-h" style="border-color:${color}"><b>${p.texto}</b> <span class="badge">${p.tipo} · ${total} resp.</span></div><div class="barras">${barras}</div></div>`
  }).join('')

  // ── Cruces ──
  const crucesHTML = (() => {
    const activos = (cruces || []).filter(c => c._pA && c._pB && c._datos)
    if (!activos.length) return ''
    const COLS_CRUCE = ['#1a472a','#0369a1','#7c3aed','#b45309','#be185d','#047857','#dc2626','#d97706','#0891b2','#6d28d9']
    const items = activos.map(c => {
      const { labelsX, seriesY, matriz } = c._datos
      if (!labelsX?.length || !seriesY?.length) return ''

      // ── Tabla de contingencia ──
      const thX = labelsX.map(l => `<th style="padding:5px 8px;font-size:10px;color:#666;text-align:center;max-width:80px;word-break:break-word">${l}</th>`).join('')
      const rows = seriesY.map(vy => {
        const celdas = labelsX.map(vx => {
          const n = matriz?.[vx]?.[vy] || 0
          const tot = labelsX.reduce((s, x) => s + (matriz?.[x]?.[vy] || 0), 0)
          const pct = tot > 0 ? Math.round(n / tot * 100) : 0
          const bg = pct > 40 ? 'rgba(26,71,42,0.12)' : pct > 20 ? 'rgba(26,71,42,0.06)' : 'transparent'
          return `<td style="padding:5px 8px;text-align:center;font-size:11px;background:${bg}">${n > 0 ? `<b>${n}</b><br><span style="font-size:9px;color:#999">${pct}%</span>` : '—'}</td>`
        }).join('')
        return `<tr><td style="padding:5px 8px;font-size:11px;font-weight:600;border-right:1px solid #e5e7eb;max-width:120px">${vy}</td>${celdas}</tr>`
      }).join('')

      // ── Gráfico de barras agrupadas SVG ──
      const barW = 18
      const gap = 4
      const groupW = seriesY.length * (barW + gap) + 12
      const chartW = Math.min(labelsX.length * (groupW + 16) + 60, 700)
      const chartH = 180
      const maxVal = Math.max(...labelsX.flatMap(vx => seriesY.map(vy => matriz?.[vx]?.[vy] || 0)), 1)
      const scaleY = (chartH - 50) / maxVal

      // Leyenda
      const leyenda = seriesY.map((vy, si) => {
        const col = COLS_CRUCE[si % COLS_CRUCE.length]
        return `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:12px;font-size:10px;color:#555">
          <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${col}"></span>${vy}
        </span>`
      }).join('')

      // Barras
      const barsGrp = labelsX.map((vx, xi) => {
        const x0 = 50 + xi * (groupW + 16)
        const bars = seriesY.map((vy, si) => {
          const n = matriz?.[vx]?.[vy] || 0
          const h = Math.max(n * scaleY, n > 0 ? 3 : 0)
          const y = chartH - 30 - h
          const col = COLS_CRUCE[si % COLS_CRUCE.length]
          const bx = x0 + si * (barW + gap)
          return `<rect x="${bx}" y="${y}" width="${barW}" height="${h}" fill="${col}" rx="2"/>
          ${n > 0 ? `<text x="${bx + barW/2}" y="${y - 3}" text-anchor="middle" font-size="9" fill="#555">${n}</text>` : ''}`
        }).join('')
        // Etiqueta eje X
        const label = vx.length > 12 ? vx.slice(0,11)+'…' : vx
        const labelX = x0 + (groupW - gap) / 2
        return `${bars}<text x="${labelX}" y="${chartH - 8}" text-anchor="middle" font-size="9" fill="#888">${label}</text>`
      }).join('')

      // Líneas de guía
      const guias = [0.25, 0.5, 0.75, 1].map(f => {
        const y = chartH - 30 - f * (chartH - 50)
        const v = Math.round(maxVal * f)
        return `<line x1="44" y1="${y}" x2="${chartW}" y2="${y}" stroke="#f0f0f0" stroke-width="1"/>
        <text x="40" y="${y + 3}" text-anchor="end" font-size="8" fill="#bbb">${v}</text>`
      }).join('')

      const svgGrafico = `<svg xmlns="http://www.w3.org/2000/svg" width="${chartW}" height="${chartH}" style="overflow:visible">
        ${guias}${barsGrp}
        <line x1="44" y1="${chartH-30}" x2="${chartW}" y2="${chartH-30}" stroke="#ddd" stroke-width="1"/>
      </svg>`

      return `<div class="preg" style="page-break-inside:avoid">
        <div class="preg-h" style="border-color:#1a472a">
          <b>${c._pA.texto}</b> <span style="color:#999;margin:0 4px">×</span> <b>${c._pB.texto}</b>
        </div>
        <div style="margin-bottom:10px;overflow-x:auto">${svgGrafico}</div>
        <div style="margin-bottom:10px;line-height:1.8">${leyenda}</div>
        <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead><tr><th style="padding:5px 8px;background:#f9fafb;font-size:10px;color:#666"></th>${thX}</tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>`
    }).join('')
    return `<div class="sec" style="margin-top:28px">Cruzamientos de datos</div>${items}`
  })()

  // ── Mapa ──
  const mapaHTML = mapaImgSrc?.img
    ? (() => {
        const ley = (mapaImgSrc.leyenda||[])
          .filter(l => l.cant > 0)
          .map(l => `<span style="display:inline-flex;align-items:center;gap:6px;margin:3px 8px 3px 0;font-size:11px;color:#333">
            <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${l.color};flex-shrink:0"></span>
            <b>${l.valor}</b> <span style="color:#999">(${l.cant})</span>
          </span>`).join('')
        const titulo = mapaImgSrc.titulo ? `<div style="font-size:11px;color:#666;margin-bottom:10px"><b>Filtro:</b> ${mapaImgSrc.titulo}</div>` : ''
        return `<div class="sec" style="margin-top:28px;page-break-before:always">Mapa de respuestas georreferenciadas</div>
          <div class="preg">
            ${titulo}
            ${ley ? `<div style="margin-bottom:12px;line-height:2">${ley}</div>` : ''}
            <img src="${mapaImgSrc.img}" style="width:100%;border-radius:8px;max-height:500px;object-fit:contain" />
          </div>`
      })()
    : ''

  // ── Datos crudos ──
  const datosHTML = (() => {
    if (!datosCrudos?.filas?.length) return ''
    const cols = datosCrudos.columnas || []
    const filas = datosCrudos.filas.slice(0, 50)
    const header = `<tr><th>Fecha</th><th>Encuestador</th><th>Equipo</th>${cols.map(c=>`<th>${c.texto?.slice(0,25)}</th>`).join('')}</tr>`
    const rows = filas.map(f => `<tr><td>${f.fecha?new Date(f.fecha).toLocaleDateString('es-AR'):''}</td><td>${f.encuestador||''}</td><td>${f.equipo||''}</td>${cols.map(c=>`<td>${(f.respuestas||{})[c.id]||''}</td>`).join('')}</tr>`).join('')
    return `<div class="sec" style="margin-top:28px;page-break-before:always">Datos crudos (${filas.length} de ${datosCrudos.filas.length} filas)</div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:10px">
      <thead style="background:#f9fafb;position:sticky;top:0">${header}</thead>
      <tbody>${rows}</tbody>
    </table></div>`
  })()

  const css = `*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;color:#1a1a1a;background:#fff;padding:40px;font-size:13px}
.header{border-bottom:3px solid #1a472a;padding-bottom:20px;margin-bottom:28px}
h1{font-size:22px;font-weight:800;color:#1a472a;margin:8px 0 4px}
.meta{font-size:12px;color:#888;display:flex;gap:16px;flex-wrap:wrap;margin-top:8px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:28px}
.kpi{background:#fafaf8;border:1px solid #e5e7eb;border-radius:10px;padding:14px;border-top:3px solid}
.kpi-v{font-size:26px;font-weight:800;margin-bottom:3px}.kpi-l{font-size:10px;color:#777;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.sec{font-size:13px;font-weight:700;color:#1a472a;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #e5e7eb}
.preg{margin-bottom:20px;padding:16px;border:1px solid #e5e7eb;border-radius:10px;page-break-inside:avoid}
.preg-h{padding-left:10px;border-left:3px solid;margin-bottom:12px}.badge{font-size:10px;color:#888;background:#f3f4f6;padding:2px 8px;border-radius:100px}
.row{display:flex;align-items:center;gap:8px;margin-bottom:7px}.lbl{font-size:11px;width:160px;flex-shrink:0}
.track{flex:1;height:14px;background:#f3f4f6;border-radius:4px;overflow:hidden}.fill{height:100%;border-radius:4px}
.pct{font-size:11px;font-weight:700;width:80px;text-align:right}.txt{font-size:11px;padding:7px 10px;background:#fafaf8;border-left:3px solid;margin-bottom:5px;border-radius:0 4px 4px 0}
.empty{font-size:12px;color:#bbb;font-style:italic}
table td,table th{border:1px solid #e5e7eb;padding:6px 8px;text-align:left}
footer{margin-top:32px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:10px;color:#bbb;display:flex;justify-content:space-between}
@media print{body{padding:20px}.preg{page-break-inside:avoid}img{max-width:100%!important}}`

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Reporte — ${cfg?.titulo || encuesta.nombre}</title>
<style>${css}</style></head><body>
<div class="header">
  <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#1a472a;text-transform:uppercase">METR1KA · Reporte</div>
  <h1>${cfg?.titulo || encuesta.nombre}</h1>
  ${cfg?.subtitulo ? `<div style="font-size:14px;color:#555;margin-top:4px;font-weight:500">${cfg.subtitulo}</div>` : ''}
  <div class="meta"><span>📅 ${fecha}</span>${(resumen?.total_participaron || resumen?.total_sesiones) ? `<span>📊 ${resumen.total_participaron || resumen.total_sesiones} respuestas</span>` : ''}${cfg?.poblacion ? `<span>👥 Población: ${Number(cfg.poblacion).toLocaleString('es-AR')}</span>` : ''}${cfg?.electores ? `<span>🗳️ Electores: ${Number(cfg.electores).toLocaleString('es-AR')}</span>` : ''}</div>
</div>
<div class="kpis">
  <div class="kpi" style="border-top-color:#1a472a"><div class="kpi-v" style="color:#1a472a">${resumen?.total_participaron || resumen?.total_sesiones || 0}</div><div class="kpi-l">Total respuestas</div></div>
  <div class="kpi" style="border-top-color:#ef4444"><div class="kpi-v" style="color:#ef4444">${resumen?.total_no_respondieron||0}</div><div class="kpi-l">No respondieron</div></div>
  <div class="kpi" style="border-top-color:#7c3aed"><div class="kpi-v" style="color:#7c3aed">${(resumen?.total_participaron || resumen?.total_sesiones || 0)+(resumen?.total_no_respondieron||0)}</div><div class="kpi-l">Total sesiones</div></div>
  <div class="kpi" style="border-top-color:#b45309"><div class="kpi-v" style="color:#b45309">${resumen?.ultima_respuesta ? new Date(resumen.ultima_respuesta).toLocaleDateString('es-AR') : '—'}</div><div class="kpi-l">Última respuesta</div></div>
</div>
<div class="sec">Resultados por pregunta</div>
${preguntasHTML}
${crucesHTML}
${mapaHTML}
${datosHTML}
<footer><span>METR1KA — metr1ka.com</span><span>${fecha}</span></footer>
</body></html>`
}

/* ── Mapa de respuestas georreferenciadas con filtro por pregunta ── */
const PALETA_MAPA = [
  '#1a472a','#0369a1','#7c3aed','#b45309','#be185d',
  '#047857','#dc2626','#d97706','#0891b2','#6d28d9',
  '#059669','#c2410c','#1d4ed8','#db2777','#0284c7',
]

// Cargar Leaflet.markercluster dinámicamente
function cargarMarkerCluster() {
  return new Promise(resolve => {
    if (window.L?.MarkerClusterGroup) return resolve()
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.Default.min.css'
    document.head.appendChild(css)
    const css2 = document.createElement('link')
    css2.rel = 'stylesheet'
    css2.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.min.css'
    document.head.appendChild(css2)
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.min.js'
    script.onload = () => resolve()
    script.onerror = () => resolve() // fallback sin cluster
    document.head.appendChild(script)
  })
}

function MapaRespuestas({ sesiones, columnas, onCapturarMapa }) {
  const mapRef     = useRef(null)
  const instRef    = useRef(null)
  const capasRef   = useRef([])   // array de layers activos para limpiar
  const fittedRef  = useRef(false) // solo fitBounds la primera vez
  const [L,        setL]        = useState(null) // leaflet lazy loaded
  const [listo,    setListo]    = useState(0)  // incrementa cuando plugins cargan
  const [filtroCol, setFiltroCol] = useState('')
  const [capas,     setCapas]     = useState({})

  const colsFiltro = useMemo(() =>
    (columnas||[]).filter(c => ['opcion_multiple','si_no'].includes(c.tipo) && c.clave_base !== 'participa'),
    [columnas]
  )

  const valoresUnicos = useMemo(() => {
    if (!filtroCol) return []
    return [...new Set((sesiones||[]).map(s=>s.respuestas?.[filtroCol]).filter(Boolean))].sort()
  }, [filtroCol, sesiones])

  useEffect(() => {
    const e = {}; valoresUnicos.forEach(v => { e[v] = true }); setCapas(e)
  }, [valoresUnicos.join('|')])

  const colorPorValor = useMemo(() => {
    const m = {}
    valoresUnicos.forEach((v,i) => { m[v] = PALETA_MAPA[i % PALETA_MAPA.length] })
    return m
  }, [valoresUnicos.join('|')])

  // ── PASO 1: lazy load leaflet (igual que GeofencingModal y Mapa.jsx) ──
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const leaflet = (await import('leaflet')).default
      await import('leaflet/dist/leaflet.css')
      if (!cancelled) setL(leaflet)
    })()
    return () => { cancelled = true }
  }, [])

  // ── PASO 2: inicializar el mapa cuando leaflet cargó y el div tiene dimensiones ──
  useEffect(() => {
    if (!L || !mapRef.current) return

    const loadScript = (url) => new Promise(res => {
      if (document.querySelector(`script[src="${url}"]`)) return res()
      const s = document.createElement('script')
      s.src = url; s.onload = res; s.onerror = res
      document.head.appendChild(s)
    })
    const loadCSS = (url) => {
      if (!document.querySelector(`link[href="${url}"]`)) {
        const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = url
        document.head.appendChild(l)
      }
    }

    loadCSS('https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.Default.min.css')
    loadCSS('https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.min.css')

    const initMap = () => {
      if (instRef.current) return  // ya inicializado
      const rect = mapRef.current?.getBoundingClientRect()
      if (!rect || rect.width === 0 || rect.height === 0) return  // esperar dimensiones

      instRef.current = L.map(mapRef.current, { zoomControl: true })
        .setView([-27.5, -55.8], 12)

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(instRef.current)

      // Una vez inicializado, cargar markercluster y activar markers
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.min.js')
        .then(() => setListo(p => p + 1))

      ro.disconnect()  // ya no necesitamos observar
    }

    // ResizeObserver: dispara initMap cuando el div finalmente tiene dimensiones
    const ro = new ResizeObserver(initMap)
    ro.observe(mapRef.current)
    initMap()  // intento inmediato por si ya tiene dimensiones

    return () => {
      ro.disconnect()
      if (instRef.current) { instRef.current.remove(); instRef.current = null }
    }
  }, [L])

  // ── PASO 2: renderizar markers cuando cambia filtro, capas o plugins ──
  useEffect(() => {
    const mapa = instRef.current
    if (!mapa) return

    // Limpiar layers anteriores
    capasRef.current.forEach(lg => { try { mapa.removeLayer(lg) } catch {} })
    capasRef.current = []

    const puntos = (sesiones||[]).filter(s => s.lat && s.lng)
    if (!puntos.length) return

    // Agrupar puntos por respuesta para colorear clusters
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
      const color = (resp !== '__all__' && filtroCol)
        ? (colorPorValor[resp] || 'var(--ink4)')
        : 'var(--accent)'

      const layer = tieneCluster
        ? L.markerClusterGroup({
            maxClusterRadius: 50,
            showCoverageOnHover: false,
            iconCreateFunction: (cluster) => {
              const n = cluster.getChildCount()
              const sz = n < 10 ? 34 : n < 100 ? 40 : 46
              return L.divIcon({
                className: '',
                html: `<div style="width:${sz}px;height:${sz}px;border-radius:50%;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${sz < 38 ? 12 : 14}px;border:3px solid rgba(255,255,255,.9);box-shadow:0 2px 8px rgba(0,0,0,.35);font-family:DM Sans,sans-serif">${n}</div>`,
                iconSize: [sz, sz], iconAnchor: [sz/2, sz/2],
              })
            },
          })
        : L.layerGroup()

      pts.forEach(s => {
        todosVisibles.push(s)
        const icono = L.divIcon({
          className: '',
          html: `<div style="width:13px;height:13px;border-radius:50%;background:${color};border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>`,
          iconSize: [13,13], iconAnchor: [6,6],
        })
        const popup = `<div style="font-family:DM Sans,sans-serif;font-size:12px;min-width:170px;line-height:1.6">
          <div style="font-weight:700;font-size:13px;margin-bottom:3px">${s.encuestador||'—'}</div>
          ${resp !== '__all__' ? `<div style="display:inline-block;background:${color}22;color:${color};border:1.5px solid ${color}66;border-radius:100px;padding:2px 9px;font-size:11px;font-weight:700;margin-bottom:4px">${resp}</div><br>` : ''}
          <span style="color:#6b7280;font-size:11px">${s.equipo||''}</span>
          <div style="color:#9ca3af;font-size:10px;margin-top:2px">${s.fecha?new Date(s.fecha).toLocaleDateString('es-AR',{day:'2-digit',month:'short',year:'numeric'}):'—'}</div>
        </div>`
        L.marker([s.lat, s.lng], { icon: icono }).bindPopup(popup).addTo(layer)
      })

      layer.addTo(mapa)
      capasRef.current.push(layer)
    })

    if (todosVisibles.length > 0 && !fittedRef.current) {
      const bounds = L.latLngBounds(todosVisibles.map(s => [s.lat, s.lng]))
      mapa.fitBounds(bounds, { padding: [40,40], maxZoom: 16 })
      fittedRef.current = true
    }

    // Captura del mapa con html2canvas — captura tiles + markers + clusters tal como se ven
    if (onCapturarMapa && todosVisibles.length > 0) {
      setTimeout(async () => {
        try {
          mapa.invalidateSize()
          await new Promise(r => setTimeout(r, 1200))
          const { default: html2canvas } = await import('html2canvas')
          const canvas = await html2canvas(mapRef.current, {
            useCORS: true,
            allowTaint: true,
            logging: false,
            backgroundColor: '#ffffff',
            scale: 2,
          })
          onCapturarMapa({
            img: canvas.toDataURL('image/png'),
            titulo: colsFiltro.find(col => col.id === filtroCol)?.texto || '',
            leyenda: filtroCol
              ? Object.entries(colorPorValor).map(([v, col]) => ({
                  valor: v, color: col, cant: grupos[v]?.length || 0
                }))
              : []
          })
        } catch (err) {
          console.error('captura mapa:', err)
        }
      }, 1800)
    }
  }, [sesiones, filtroCol, capas, colorPorValor, listo, L])

  useEffect(() => () => {
    capasRef.current.forEach(lg => { try { if (instRef.current) instRef.current.removeLayer(lg) } catch {} })
    capasRef.current = []
    if (instRef.current) { instRef.current.remove(); instRef.current = null }
  }, [])

  const puntos = (sesiones||[]).filter(s => s.lat && s.lng)
  const sinGPS = (sesiones||[]).length - puntos.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Barra de controles */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', padding: '14px 16px' }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>
            Colorear por respuesta a
          </label>
          <select value={filtroCol} onChange={e => { setFiltroCol(e.target.value); setCapas({}) }}
            style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 13, fontFamily: 'DM Sans', background: 'var(--surface)', color: 'var(--ink)', outline: 'none' }}>
            <option value="">— Todos los puntos (un color) —</option>
            {colsFiltro.map(c => (
              <option key={c.id} value={c.id}>{c.texto?.slice(0,68)}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, paddingBottom: 2 }}>
          <MapPin size={14} color="var(--accent)" />
          <span style={{ color: 'var(--ink2)' }}><strong>{puntos.length}</strong> con GPS</span>
          {sinGPS > 0 && <span style={{ color: 'var(--ink4)' }}>· {sinGPS} sin GPS</span>}
        </div>
      </div>

      {/* Leyenda */}
      {filtroCol && valoresUnicos.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {valoresUnicos.map(v => {
            const color = colorPorValor[v] || 'var(--ink4)'
            const activo = capas[v] !== false
            const cant = (sesiones||[]).filter(s => s.respuestas?.[filtroCol] === v && s.lat).length
            return (
              <button key={v} onClick={() => setCapas(p => ({ ...p, [v]: !activo }))}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 11px', borderRadius: 100, cursor: 'pointer',
                  fontFamily: 'DM Sans', fontSize: 12, transition: 'all .15s',
                  border: `1.5px solid ${activo ? color : 'var(--border)'}`,
                  background: activo ? `${color}15` : 'var(--surface)',
                  color: activo ? color : 'var(--ink3)', opacity: activo ? 1 : 0.5,
                }}>
                <div style={{ width: 9, height: 9, borderRadius: '50%', background: activo ? color : '#ccc', flexShrink: 0 }} />
                <span style={{ fontWeight: 600 }}>{v}</span>
                <span style={{ fontWeight: 400, fontSize: 11, background: activo ? `${color}25` : 'var(--surface)', borderRadius: 100, padding: '0 5px' }}>{cant}</span>
              </button>
            )
          })}
          <button onClick={() => {
            const allOn = valoresUnicos.every(v => capas[v] !== false)
            const nuevo = {}; valoresUnicos.forEach(v => { nuevo[v] = !allOn }); setCapas(nuevo)
          }} style={{ padding: '5px 11px', borderRadius: 100, fontSize: 11, fontFamily: 'DM Sans', cursor: 'pointer', border: '1.5px solid var(--border)', background: 'var(--surface)', color: 'var(--ink3)' }}>
            {valoresUnicos.every(v => capas[v] !== false) ? 'Ocultar todo' : 'Mostrar todo'}
          </button>
        </div>
      )}

      {/* Mapa — el div siempre está en el DOM para que ResizeObserver funcione */}
      {puntos.length === 0 && (
        <div style={{ textAlign: 'center', padding: 64, color: 'var(--ink3)', fontSize: 14, background: 'var(--paper)', borderRadius: 'var(--r2)', border: '1px solid var(--border)' }}>
          📍 No hay respuestas con coordenadas GPS todavía
        </div>
      )}
      <div
        ref={mapRef}
        style={{
          height: 520, width: '100%', position: 'relative',
          borderRadius: 'var(--r2)', border: '1px solid var(--border)', overflow: 'hidden',
          display: puntos.length === 0 ? 'none' : 'block',
        }}
      />
    </div>
  )
}


/* ── PANTALLA PRINCIPAL ── */
export default function Reportes() {
  const { perfil } = useAuth()
  const [encuestas,   setEncuestas]   = useState([])
  const [loading,     setLoading]     = useState(true)
  const [selected,    setSelected]    = useState(null)
  const [loadingEnc,  setLoadingEnc]  = useState(false)
  const [data,        setData]        = useState(null)
  const [generando,   setGenerando]   = useState(false)
  const [modalExport, setModalExport] = useState(false)
  const [exportConfig, setExportConfig] = useState({
    kpis:        true,
    preguntas:   {},
    cruces:      true,
    mapa:        true,
    datosCrudos: false,
    titulo:      '',
    subtitulo:   '',
    poblacion:   '',
    electores:   '',
  })
  const [vistaActiva, setVistaActiva] = useState('dashboard')
  const [comparaciones, setComparaciones] = useState([{ id: 1 }])
  const [sesionesCruce, setSesionesCruce] = useState([])
  const [encAbiertos,   setEncAbiertos]   = useState({})
  const [datosExport,  setDatosExport]  = useState(null)
  const [loadingDatos, setLoadingDatos] = useState(false)
  const [mapaDatos,    setMapaDatos]    = useState(null)  // {img, titulo, leyenda}

  // Filtros
  const [filtroEquipo,      setFiltroEquipo]      = useState('')
  const [filtroEncuestador, setFiltroEncuestador] = useState('')
  const [filtroDesde,       setFiltroDesde]       = useState('')
  const [filtroHasta,       setFiltroHasta]       = useState('')
  const [filtrosAbiertos,   setFiltrosAbiertos]   = useState(false)
  const [zonasEncuesta,     setZonasEncuesta]     = useState([])  // [{ id, nombre, ring }]
  const [filtroZonas,       setFiltroZonas]       = useState(null) // null = todas, [] = ninguna, [ids] = filtro

  const [vistaCompletadas, setVistaCompletadas] = useState(false)
  const [comparando, setComparando] = useState(false)

  useEffect(() => {
    if (!perfil?.organizacion_id) return
    supabase.from('encuestas')
      .select('id, nombre, descripcion, estado_produccion, creado_en')
      .eq('organizacion_id', perfil.organizacion_id)
      .in('estado_produccion', ['publicada', 'completada'])
      .order('creado_en', { ascending: false })
      .then(({ data }) => {
        const encs = data || []
        setEncuestas(encs)
        // Sin encuestas publicadas pero con completadas → arrancar en "Completadas"
        if (!encs.some(e => e.estado_produccion === 'publicada') && encs.some(e => e.estado_produccion === 'completada')) {
          setVistaCompletadas(true)
        }
        setLoading(false)
      })
  }, [perfil?.organizacion_id])

  async function cargarEncuesta(enc) {
    setSelected(enc); setData(null); setLoadingEnc(true); setDatosExport(null); setSesionesCruce([])
    setFiltroEquipo(''); setFiltroEncuestador(''); setFiltroDesde(''); setFiltroHasta(''); setFiltroZonas(null)
    const [{ data: d }, { data: sc }, { data: zs }] = await Promise.all([
      supabase.rpc('get_encuesta_full', { p_encuesta_id: enc.id, p_org_id: perfil.organizacion_id }),
      supabase.rpc('get_respuestas_por_sesion', { p_encuesta_id: enc.id, p_org_id: perfil.organizacion_id }),
      supabase.rpc('get_zonas_con_sesiones', { p_encuesta_id: enc.id }),
    ])
    setData(d)
    setSesionesCruce(sc?.sesiones || [])
    const zonasList = Array.isArray(zs) ? zs : []
    setZonasEncuesta(zonasList.map(z => {
      const feat = z.area_geojson?.features?.find(f => f.properties?.tipo === 'zona')
      const geom = feat?.geometry
      let ring = null
      if (geom?.type === 'Polygon') ring = geom.coordinates?.[0]
      else if (geom?.type === 'MultiPolygon') ring = geom.coordinates?.[0]?.[0]
      return { id: z.id, nombre: z.nombre, ring, sesiones: z.sesiones || 0 }
    }).filter(z => z.ring && z.sesiones > 0))
    setLoadingEnc(false)
  }

  // Cargar datos crudos automáticamente al entrar a la tab mapa o datos
  useEffect(() => {
    if ((vistaActiva === 'datos' || vistaActiva === 'mapa') && selected && !loadingDatos && !loadingEnc) {
      cargarDatosCrudos()
    }
  }, [vistaActiva, selected?.id])

  async function cargarDatosCrudos() {
    if (!selected) return
    setLoadingDatos(true)
    const zonaIds = filtroZonas !== null ? (filtroZonas.length > 0 ? filtroZonas : []) : null
    const { data: d } = await supabase.rpc('get_respuestas_crudas', {
      p_encuesta_id:    selected.id,
      p_org_id:         perfil.organizacion_id,
      p_equipo_id:      filtroEquipo      || null,
      p_encuestador_id: filtroEncuestador || null,
      p_fecha_desde:    filtroDesde       || null,
      p_fecha_hasta:    filtroHasta       || null,
      p_zona_ids:       zonaIds,
    })
    setDatosExport(d)
    setLoadingDatos(false)
  }

  function exportarCSV() {
    if (!datosExportFiltrados?.columnas || !datosExportFiltrados?.filas) return
    const cols = datosExportFiltrados.columnas
    const header = ['Sesion', 'Fecha', 'Encuestador', 'Equipo', 'Latitud', 'Longitud', ...cols.map(c => c.texto)]
    const rows = (datosExportFiltrados.filas || []).map(f => [
      f.sesion_id,
      f.fecha ? new Date(f.fecha).toLocaleString('es-AR') : '',
      f.encuestador || '',
      f.equipo || '',
      f.lat || '',
      f.lng || '',
      ...cols.map(c => (f.respuestas || {})[c.id] || ''),
    ])
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href = url
    a.download = `${selected.nombre.replace(/\s+/g,'_')}_datos.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  async function aplicarFiltros(zonaIdsOverride) {
    if (!selected) return
    setLoadingEnc(true)
    const zonaIds = zonaIdsOverride !== undefined ? zonaIdsOverride : (filtroZonas !== null ? (filtroZonas.length > 0 ? filtroZonas : []) : null)
    const [{ data: d }, { data: dc }, { data: sc }] = await Promise.all([
      supabase.rpc('get_encuesta_full', {
        p_encuesta_id:    selected.id,
        p_org_id:         perfil.organizacion_id,
        p_equipo_id:      filtroEquipo      || null,
        p_encuestador_id: filtroEncuestador || null,
        p_fecha_desde:    filtroDesde       || null,
        p_fecha_hasta:    filtroHasta       || null,
        p_zona_ids:       zonaIds,
      }),
      supabase.rpc('get_respuestas_crudas', {
        p_encuesta_id:    selected.id,
        p_org_id:         perfil.organizacion_id,
        p_equipo_id:      filtroEquipo      || null,
        p_encuestador_id: filtroEncuestador || null,
        p_fecha_desde:    filtroDesde       || null,
        p_fecha_hasta:    filtroHasta       || null,
        p_zona_ids:       zonaIds,
      }),
      supabase.rpc('get_respuestas_por_sesion', {
        p_encuesta_id: selected.id,
        p_org_id:      perfil.organizacion_id,
        p_zona_ids:    zonaIds,
      }),
    ])
    setData(d)
    setDatosExport(dc)
    setSesionesCruce(sc?.sesiones || [])
    setLoadingEnc(false)
  }

  async function handleGenerarPDF(cfg) {
    if (!data || !selected) return
    setGenerando(true)
    try {
      // Cargar clasificaciones de texto libre para esta encuesta
      const preguntasLibres = (data.preguntas || []).filter(p => p.tipo === 'texto_libre')
      let clasificaciones = []
      if (preguntasLibres.length > 0) {
        const { data: clases } = await supabase
          .from('clasificaciones_texto_libre')
          .select('*')
          .eq('encuesta_id', selected.id)
        clasificaciones = clases || []
      }

      const pregsFiltradas = (data.preguntas || []).filter(p => cfg.preguntas[p.id] !== false)
      const crucesSel = cfg.cruces ? comparaciones : []
      let textoZonas = ''
    if (filtroZonas === null) {
      textoZonas = '• Todas las zonas'
    } else if (filtroZonas.length === 0) {
      textoZonas = '• Sin zonas'
    } else if (filtroZonas.length === 1) {
      const zona = zonasEncuesta.find(z => z.id === filtroZonas[0])
      textoZonas = `• Zona: ${zona?.nombre || 'Desconocida'}`
    } else {
      const nombres = filtroZonas
        .map(id => zonasEncuesta.find(z => z.id === id)?.nombre)
        .filter(Boolean)
      textoZonas = `• Zonas: ${nombres.join(', ')}`
    }

    // Concatenar al título (si no tiene uno personalizado, usar el de la encuesta + zonas)
    const subtituloConZonas = exportConfig.subtitulo
  ? `${exportConfig.subtitulo} ${textoZonas}`
  : textoZonas

    // 🔹 Y ACÁ, al pasar `cfg` a generarHTML, inyectar el título modificado:
    
      const html = generarHTML(
        data.encuesta || selected,
        pregsFiltradas,
        data.respuestas || [],
        cfg.kpis ? (data.resumen || null) : null,
        crucesSel,
        cfg.datosCrudos ? datosExportFiltrados : null,
        sesionesCruceFiltradas,
        cfg.mapa ? mapaDatos : null,
        { ...cfg, subtitulo: subtituloConZonas },
        clasificaciones,
      )
      const nombreArchivo = `reporte-${(selected?.nombre || 'encuesta').replace(/[^\w-]+/g, '_')}.pdf`
      await generarPDF(html, nombreArchivo)
      setGenerando(false); setModalExport(false)
    } catch (e) {
      console.error('handleGenerarPDF:', e)
      setGenerando(false)
    }
  }

  const preguntas = data?.preguntas || []
  const respuestas = data?.respuestas || []
  const resumen = data?.resumen || {}
  const equipos = useMemo(() => {
    const map = {}
    ;(data?.encuestadores || []).forEach(e => { if (e.equipo_id) map[e.equipo_id] = e.equipo_nombre })
    return Object.entries(map).map(([id, nombre]) => ({ id, nombre }))
  }, [data?.encuestadores])

  const encuestadoresFiltrados = useMemo(() =>
    filtroEquipo ? (data?.encuestadores||[]).filter(e=>e.equipo_id===filtroEquipo) : (data?.encuestadores||[]),
    [data?.encuestadores, filtroEquipo]
  )

  // La DB ya filtró por zona cuando filtroZonas está activo — no filtrar de nuevo en el front
  const datosExportFiltrados = datosExport

  const sesionesCruceFiltradas = sesionesCruce

  const respuestasMap = useMemo(() => {
    const map = {}
    preguntas.forEach(p => { map[p.id] = [] })
    respuestas.forEach(f => { if (map[f.pregunta_id]) map[f.pregunta_id].push(f) })
    return map
  }, [preguntas, respuestas])

  const razonesNR = useMemo(() => {
    const pregParticipa = preguntas.find(p => p.clave_base === 'participa')
    if (!pregParticipa) return []
    return (respuestasMap[pregParticipa.id] || []).filter(f => f.valor_texto && f.valor_texto !== 'Sí')
  }, [preguntas, respuestasMap])

  const promedioEscala = useMemo(() => {
    const fe = respuestas.filter(f => f.tipo === 'escala' && f.valor_numero != null)
    if (!fe.length) return '—'
    const suma = fe.reduce((s, f) => s + Number(f.valor_numero) * Number(f.cantidad), 0)
    const total = fe.reduce((s, f) => s + Number(f.cantidad), 0)
    return total ? (suma / total).toFixed(1) : '—'
  }, [respuestas])

  const inp = { padding: '7px 10px', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 12, fontFamily: 'DM Sans', background: 'var(--surface)', color: 'var(--ink)', width: '100%', outline: 'none' }

  const tabStyle = (active) => ({
    padding: '7px 16px', border: 'none', background: 'none',
    cursor: 'pointer', fontSize: 13, fontFamily: 'DM Sans',
    fontWeight: active ? 700 : 500,
    color: active ? 'var(--accent)' : 'var(--ink3)',
    borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
    marginBottom: -1, transition: 'all .15s',
  })

  return (
    <div className={styles.page}>
      <Topbar title="Reportes"
        action={data ? { label: '⬇ Exportar PDF', onClick: () => {
          // Inicializar selección de preguntas con todas activas
          const cfg = {}
          ;(data?.preguntas || []).filter(p => p.clave_base !== 'participa').forEach(p => { cfg[p.id] = true })
          setExportConfig(prev => ({ ...prev, preguntas: cfg }))
          setModalExport(true)
        }} : null} />
      <div className={styles.content}>

        {loading ? <Spinner center size="lg" /> : encuestas.length === 0 ? (
          <div className={styles.empty}><p>No hay encuestas publicadas todavía.</p></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Lista de encuestas — cards con dos acciones */}
            {!selected && !comparando && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>
                  Seleccioná una encuesta para ver sus reportes
                </div>

                {/* Pestañas activas/completadas + comparar */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 4, justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => setVistaCompletadas(false)}
                      style={{ padding: '5px 14px', borderRadius: 100, fontSize: 12, fontWeight: 700, fontFamily: 'DM Sans', cursor: 'pointer', border: `1.5px solid ${!vistaCompletadas ? 'var(--accent)' : 'var(--border2)'}`, background: !vistaCompletadas ? 'var(--accent-light)' : 'var(--surface)', color: !vistaCompletadas ? 'var(--accent)' : 'var(--ink3)' }}>
                      Activas <span style={{ fontWeight: 400 }}>({encuestas.filter(e => e.estado_produccion === 'publicada').length})</span>
                    </button>
                    <button onClick={() => setVistaCompletadas(true)}
                      style={{ padding: '5px 14px', borderRadius: 100, fontSize: 12, fontWeight: 700, fontFamily: 'DM Sans', cursor: 'pointer', border: `1.5px solid ${vistaCompletadas ? 'var(--accent)' : 'var(--border2)'}`, background: vistaCompletadas ? 'var(--accent-light)' : 'var(--surface)', color: vistaCompletadas ? 'var(--accent)' : 'var(--ink3)' }}>
                      ✓ Completadas <span style={{ fontWeight: 400 }}>({encuestas.filter(e => e.estado_produccion === 'completada').length})</span>
                    </button>
                  </div>
                  <button onClick={() => setComparando(true)}
                    style={{ padding: '5px 14px', borderRadius: 100, fontSize: 12, fontWeight: 700, fontFamily: 'DM Sans', cursor: 'pointer', border: '1.5px solid var(--border2)', background: 'var(--surface)', color: 'var(--ink2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Scale size={13} /> Comparar encuestas
                  </button>
                </div>

                {encuestas.filter(e => vistaCompletadas ? e.estado_produccion === 'completada' : e.estado_produccion === 'publicada').map(enc => (
                  <div key={enc.id} style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{enc.nombre}</div>
                        {enc.estado_produccion === 'completada' && (
                          <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--surface2)', color: 'var(--ink2)', padding: '2px 7px', borderRadius: 100 }}>✓ Completada</span>
                        )}
                      </div>
                      {enc.descripcion && <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 4 }}>{enc.descripcion}</div>}
                      <div style={{ fontSize: 11, color: 'var(--ink3)' }}>Creada {new Date(enc.creado_en).toLocaleDateString('es-AR')}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      <button onClick={() => { cargarEncuesta(enc); setVistaActiva('preguntas') }}
                        style={{ padding: '7px 14px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Sans', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <BarChart2 size={13} /> Gráficos
                      </button>
                      <button onClick={() => { cargarEncuesta(enc); setVistaActiva('datos') }}
                        style={{ padding: '7px 14px', background: 'var(--surface)', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans', color: 'var(--ink2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <FileText size={13} /> Datos crudos
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {comparando && (
              <CompararEncuestas encuestas={encuestas} perfil={perfil} onVolver={() => setComparando(false)} />
            )}

            {selected && !comparando && (
              <>
                {/* Header con botón Volver */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button onClick={() => { setSelected(null); setData(null); setDatosExport(null); setSesionesCruce([]); setZonasEncuesta([]); setFiltroZonas(null) }}
                    style={{ background: 'none', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--ink3)', fontFamily: 'DM Sans' }}>
                    ← Volver
                  </button>
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{selected.nombre}</span>
                </div>

                {/* Filtros */}
                <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', overflow: 'hidden' }}>
                  <button onClick={() => setFiltrosAbiertos(o=>!o)} style={{ width: '100%', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'DM Sans' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Filter size={14} color="var(--ink3)" />
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 1 }}>Filtros</span>
                      {(filtroEquipo||filtroEncuestador||filtroDesde||filtroHasta) && <span style={{ background: 'var(--accent)', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 100, padding: '1px 7px' }}>Activos</span>}
                      {filtroZonas !== null && <span style={{ background: '#7c3aed', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 100, padding: '1px 7px' }}>{filtroZonas.length} zona{filtroZonas.length !== 1 ? 's' : ''}</span>}
                    </div>
                    {filtrosAbiertos ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  {filtrosAbiertos && (
                    <div style={{ padding: '0 20px 20px', borderTop: '1px solid var(--border)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, paddingTop: 14 }}>
                        <div>
                          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', display: 'block', marginBottom: 4 }}>Equipo</label>
                          <select value={filtroEquipo} onChange={e => { setFiltroEquipo(e.target.value); setFiltroEncuestador('') }} style={inp}>
                            <option value="">Todos</option>
                            {equipos.map(eq => <option key={eq.id} value={eq.id}>{eq.nombre}</option>)}
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', display: 'block', marginBottom: 4 }}>Encuestador</label>
                          <select value={filtroEncuestador} onChange={e => setFiltroEncuestador(e.target.value)} disabled={!filtroEquipo} style={inp}>
                            <option value="">Todos</option>
                            {encuestadoresFiltrados.map(e => <option key={e.encuestador_id} value={e.encuestador_id}>{e.nombre_completo}</option>)}
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', display: 'block', marginBottom: 4 }}>Desde</label>
                          <input type="date" value={filtroDesde} onChange={e => setFiltroDesde(e.target.value)} style={inp} />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', display: 'block', marginBottom: 4 }}>Hasta</label>
                          <input type="date" value={filtroHasta} onChange={e => setFiltroHasta(e.target.value)} style={inp} />
                        </div>
                      </div>
                      {zonasEncuesta.length > 1 && (
                        <div style={{ marginTop: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)' }}>Zonas</label>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button onClick={() => { setFiltroZonas(null); aplicarFiltros(null) }} style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'DM Sans' }}>Todas</button>
                              <button onClick={() => { setFiltroZonas([]); aplicarFiltros([]) }} style={{ fontSize: 11, color: 'var(--ink3)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'DM Sans' }}>Ninguna</button>
                            </div>
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {zonasEncuesta.map(z => {
                              const activa = filtroZonas === null || filtroZonas.includes(z.id)
                              return (
                                <button key={z.id} onClick={() => {
                                  let nuevas
                                  if (filtroZonas === null) {
                                    // Estaban todas — deseleccionar esta zona
                                    nuevas = zonasEncuesta.map(x => x.id).filter(id => id !== z.id)
                                  } else if (filtroZonas.includes(z.id)) {
                                    // Quitar esta zona
                                    nuevas = filtroZonas.filter(id => id !== z.id)
                                  } else {
                                    // Agregar esta zona
                                    const t = [...filtroZonas, z.id]
                                    // Si ya están todas, volver a null
                                    nuevas = t.length === zonasEncuesta.length ? null : t
                                  }
                                  setFiltroZonas(nuevas)
                                  aplicarFiltros(nuevas !== null ? nuevas : null)
                                }} style={{ padding: '4px 10px', borderRadius: 100, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: `1.5px solid ${activa ? '#7c3aed' : 'var(--border2)'}`, background: activa ? '#7c3aed15' : 'var(--paper)', color: activa ? '#7c3aed' : 'var(--ink3)', fontFamily: 'DM Sans', transition: 'all .1s' }}>
                                  {z.nombre} <span style={{ opacity: 0.6, fontSize: 10 }}>({z.sesiones})</span>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                        <button onClick={() => aplicarFiltros()} disabled={loadingEnc} style={{ padding: '7px 16px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <RefreshCw size={12} /> Aplicar
                        </button>
                        {(filtroEquipo||filtroEncuestador||filtroDesde||filtroHasta||filtroZonas !== null) && (
                          <button onClick={() => { setFiltroEquipo(''); setFiltroEncuestador(''); setFiltroDesde(''); setFiltroHasta(''); setFiltroZonas(null); aplicarFiltros(null) }} style={{ padding: '7px 16px', background: 'var(--surface)', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 12, cursor: 'pointer', fontFamily: 'DM Sans', color: 'var(--ink3)' }}>
                            Limpiar
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {loadingEnc ? (
                  <div style={{ textAlign: 'center', padding: 40 }}><Spinner size="md" /></div>
                ) : data && (
                  <>
                    {/* KPIs */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                      <KpiCard label="Total respuestas" value={resumen?.total_participaron || resumen?.total_sesiones || 0} color="var(--accent)" icon={<BarChart2 size={12} />} />
                      <KpiCard label="No respondieron" value={(resumen?.total_sesiones||0) - (resumen?.total_participaron||resumen?.total_sesiones||0)} color="#ef4444" icon={<FileText size={12} />} />
                      <KpiCard label="Total sesiones" value={resumen?.total_sesiones || 0} color="#7c3aed" icon={<Zap size={12} />} />
                      <KpiCard label="Última respuesta" value={resumen?.ultima_respuesta ? new Date(resumen.ultima_respuesta).toLocaleDateString('es-AR') : '—'} color="#b45309" sub="fecha más reciente" />
                    </div>

                    {/* No respuestas */}
                    {razonesNR.length > 0 && (
                      <div style={{ background: 'var(--paper)', border: '1px solid var(--danger)', borderRadius: 'var(--r2)', padding: '14px 20px', borderLeft: '4px solid var(--danger)' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                          📋 Razones de no-respuesta
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {razonesNR.map((f, i) => (
                            <div key={i} style={{ background: 'var(--danger-light)', borderRadius: 'var(--r)', padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 600 }}>{f.valor_texto}</span>
                              <span style={{ fontFamily: 'var(--font-num)', fontSize: 15, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: 'var(--danger)' }}>{f.cantidad}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Tabs */}
                    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', background: 'var(--paper)', borderRadius: 'var(--r2) var(--r2) 0 0', padding: '0 8px' }}>
                      {[
                        ['preguntas',    '📋 Por pregunta'],
                        ['comparar',     '🔀 Cruzar datos'],
                        ['mapa',         '🗺️ Mapa'],
                        ['encuestadores','👥 Encuestadores'],
                        ['datos',        '📁 Datos crudos'],
                      ].map(([v, label]) => (
                        <button key={v}
                          onClick={() => setVistaActiva(v)}
                          style={tabStyle(vistaActiva === v)}>
                          {label}
                        </button>
                      ))}
                    </div>

                    {/* Vista Preguntas — todas */}
                    {vistaActiva === 'preguntas' && (
                      <PorPregunta preguntas={preguntas} respuestasMap={respuestasMap} encuestaId={selected?.id} />
                    )}

                    {/* Vista Cruzar datos */}
                    {vistaActiva === 'comparar' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <div style={{ background: 'var(--accent-light)', border: '1px solid #b7e4c7', borderRadius: 'var(--r2)', padding: '12px 16px', fontSize: 13, color: 'var(--accent2)', display: 'flex', gap: 8, alignItems: 'center' }}>
                          <Zap size={14} /> Cruzá dos preguntas para ver cómo se distribuyen las respuestas de una según los valores de la otra en un único gráfico.
                        </div>
                        {comparaciones.map((comp, i) => (
                          <GraficoCruce key={comp.id} preguntas={preguntas} sesiones={sesionesCruceFiltradas} index={i}
                            onRemove={() => setComparaciones(prev => prev.filter(x => x.id !== comp.id))}
                            onCruceChange={({ pA, pB, datosCruce }) => {
                              setComparaciones(prev => prev.map(x => x.id === comp.id
                                ? { ...x, _pA: pA, _pB: pB, _datos: datosCruce }
                                : x
                              ))
                            }} />
                        ))}
                        <button onClick={() => setComparaciones(prev => [...prev, { id: Date.now() }])} style={{ padding: '10px', border: '1.5px dashed var(--border2)', borderRadius: 'var(--r2)', background: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--ink3)', fontFamily: 'DM Sans', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                          <Plus size={14} /> Agregar cruce
                        </button>
                      </div>
                    )}

                    {/* Vista Datos Crudos */}
                    {vistaActiva === 'datos' && (
                      <TablaDatosCrudos
                        datosExport={datosExportFiltrados}
                        loadingDatos={loadingDatos}
                        onActualizar={cargarDatosCrudos}
                        onExportarCSV={exportarCSV}
                      />
                    )}

                    {/* Vista Mapa */}
                    {vistaActiva === 'mapa' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {/* Botón exportar mapa separado */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                          {mapaDatos?.img && (
                            <button onClick={async () => {
                              const fecha = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
                              const leyenda = (mapaDatos.leyenda||[]).filter(l => l.cant > 0)
                              const leyendaHTML = leyenda.length > 0
                                ? `<div style="margin:16px 0;display:flex;flex-wrap:wrap;gap:10px">
                                    ${leyenda.map(l => `<span style="display:inline-flex;align-items:center;gap:7px;font-size:12px;color:#333">
                                      <span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${l.color};flex-shrink:0"></span>
                                      <b>${l.valor}</b><span style="color:#999">(${l.cant})</span>
                                    </span>`).join('')}
                                  </div>`
                                : ''
                              const tituloFiltro = mapaDatos.titulo
                                ? `<div style="font-size:12px;color:#666;margin-top:8px"><b>Filtro:</b> ${mapaDatos.titulo}</div>`
                                : ''
                              const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Mapa — ${selected?.nombre}</title>
                              <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;padding:32px;color:#1a1a1a}
                              .header{border-bottom:3px solid #1a472a;padding-bottom:16px;margin-bottom:20px}
                              h1{font-size:20px;font-weight:800;color:#1a472a;margin:6px 0 3px}
                              .meta{font-size:12px;color:#888;margin-top:6px}
                              @media print{body{padding:16px}img{max-width:100%}}</style>
                              </head><body>
                              <div class="header">
                                <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#1a472a;text-transform:uppercase">METR1KA · Mapa georreferenciado</div>
                                <h1>${selected?.nombre}</h1>
                                <div class="meta">📅 ${fecha} · ${(datosExportFiltrados?.filas||[]).filter(s=>s.lat&&s.lng).length} respuestas con GPS</div>
                                ${tituloFiltro}
                              </div>
                              ${leyendaHTML}
                              <img src="${mapaDatos.img}" style="width:100%;border-radius:8px;border:1px solid #e5e7eb" />
                              <p style="font-size:10px;color:#bbb;margin-top:16px;text-align:right">METR1KA — metr1ka.com · ${fecha}</p>
                              </body></html>`
                              await generarPDF(html, `mapa-${(selected?.nombre || 'encuesta').replace(/[^\w-]+/g, '_')}.pdf`)
                            }} style={{
                              padding: '8px 16px', background: 'var(--accent)', color: '#fff', border: 'none',
                              borderRadius: 'var(--r)', fontFamily: 'DM Sans', fontSize: 12, fontWeight: 700,
                              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                            }}>
                              🖨️ Exportar mapa PDF
                            </button>
                          )}
                          {!mapaDatos?.img && (
                            <span style={{ fontSize: 11, color: 'var(--ink3)', padding: '8px 0' }}>
                              Cargando mapa...
                            </span>
                          )}
                        </div>
                        <MapaRespuestas
                          sesiones={datosExportFiltrados?.filas || []}
                          columnas={datosExportFiltrados?.columnas || []}
                          onCapturarMapa={(datos) => setMapaDatos(datos)}
                        />
                      </div>
                    )}

                    {/* Vista Encuestadores */}
                    {vistaActiva === 'encuestadores' && (
                      <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead>
                            <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                              {['Encuestador', 'Equipo', 'Zonas', 'Completadas', 'No resp.', 'Total'].map((h, hi) => (
                                <th key={h} style={{ padding: '10px 16px', textAlign: hi >= 3 ? 'right' : 'left', fontSize: 11, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 0.8 }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(data.encuestadores || []).slice().sort((a,b) => b.total - a.total).map((e, i) => {
                              const key = e.encuestador_id || i
                              const open = !!encAbiertos[key]
                              const zonas = (e.por_zona || []).slice().sort((a,b) => b.total - a.total)
                              return (
                                <Fragment key={key}>
                                  <tr onClick={() => zonas.length && setEncAbiertos(p => ({ ...p, [key]: !p[key] }))}
                                    style={{ borderBottom: '1px solid var(--border)', cursor: zonas.length ? 'pointer' : 'default' }}>
                                    <td style={{ padding: '10px 16px', fontWeight: 600, color: 'var(--ink)' }}>
                                      {zonas.length > 0 && <span style={{ display: 'inline-block', width: 14, color: 'var(--ink3)' }}>{open ? '▾' : '▸'}</span>}
                                      {e.nombre_completo}
                                    </td>
                                    <td style={{ padding: '10px 16px', color: 'var(--ink3)' }}>{e.equipo_nombre || '—'}</td>
                                    <td style={{ padding: '10px 16px', color: 'var(--ink2)', fontSize: 12 }}>{e.zonas || '—'}</td>
                                    <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700, color: 'var(--accent)' }}>{e.completadas ?? '—'}</td>
                                    <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700, color: 'var(--danger)' }}>{e.no_respuesta ?? '—'}</td>
                                    <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                                      <span style={{ fontFamily: 'var(--font-num)', fontSize: 15, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: 'var(--ink2)' }}>{e.total}</span>
                                    </td>
                                  </tr>
                                  {open && zonas.map(z => (
                                    <tr key={key + (z.zona_id || 'sz')} style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
                                      <td style={{ padding: '8px 16px 8px 38px', color: 'var(--ink2)' }} colSpan={2}>{z.zona_nombre}</td>
                                      <td style={{ padding: '8px 16px', color: 'var(--ink3)' }}></td>
                                      <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 600, color: 'var(--accent)' }}>{z.completadas}</td>
                                      <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 600, color: 'var(--danger)' }}>{z.no_respuesta}</td>
                                      <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 600, color: 'var(--ink2)' }}>{z.total}</td>
                                    </tr>
                                  ))}
                                </Fragment>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Modal de configuración de export */}
      {modalExport && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 20 }}>
          <div style={{ background: 'var(--paper)', borderRadius: 'var(--r2)', width: '100%', maxWidth: 520, maxHeight: '85vh', overflow: 'auto', boxShadow: '0 24px 80px rgba(0,0,0,.2)' }}>
            {/* Header */}
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontFamily: 'Syne', fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>⬇ Configurar exportación PDF</div>
              <button onClick={() => setModalExport(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--ink3)', lineHeight: 1 }}>×</button>
            </div>

            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* Título y datos del municipio */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Encabezado del reporte</div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', display: 'block', marginBottom: 4 }}>Título</label>
                  <input
                    value={exportConfig.titulo}
                    onChange={e => setExportConfig(p => ({ ...p, titulo: e.target.value }))}
                    placeholder={selected?.nombre || 'Título del reporte'}
                    style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 13, fontFamily: 'DM Sans', outline: 'none', background: 'var(--surface)', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', display: 'block', marginBottom: 4 }}>Subtítulo</label>
                  <input
                    value={exportConfig.subtitulo}
                    onChange={e => setExportConfig(p => ({ ...p, subtitulo: e.target.value }))}
                    placeholder="Ej: Encuesta de Humor Social — Mayo 2026"
                    style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 13, fontFamily: 'DM Sans', outline: 'none', background: 'var(--surface)', boxSizing: 'border-box' }}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', display: 'block', marginBottom: 4 }}>👥 Población</label>
                    <input
                      type="number"
                      value={exportConfig.poblacion}
                      onChange={e => setExportConfig(p => ({ ...p, poblacion: e.target.value }))}
                      placeholder="Ej: 4048"
                      style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 13, fontFamily: 'DM Sans', outline: 'none', background: 'var(--surface)', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', display: 'block', marginBottom: 4 }}>🗳️ Electores</label>
                    <input
                      type="number"
                      value={exportConfig.electores}
                      onChange={e => setExportConfig(p => ({ ...p, electores: e.target.value }))}
                      placeholder="Ej: 3226"
                      style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 13, fontFamily: 'DM Sans', outline: 'none', background: 'var(--surface)', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>
              </div>

              {/* KPIs */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={exportConfig.kpis} onChange={e => setExportConfig(p => ({ ...p, kpis: e.target.checked }))}
                  style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer' }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Resumen general (KPIs)</div>
                  <div style={{ fontSize: 11, color: 'var(--ink3)' }}>Total respuestas, encuestadores, promedios</div>
                </div>
              </label>

              {/* Preguntas */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Preguntas a incluir</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => {
                      const all = {}
                      preguntas.filter(p => p.clave_base !== 'participa').forEach(p => { all[p.id] = true })
                      setExportConfig(prev => ({ ...prev, preguntas: all }))
                    }} style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'DM Sans' }}>Todas</button>
                    <button onClick={() => {
                      const none = {}
                      preguntas.filter(p => p.clave_base !== 'participa').forEach(p => { none[p.id] = false })
                      setExportConfig(prev => ({ ...prev, preguntas: none }))
                    }} style={{ fontSize: 11, color: 'var(--ink3)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'DM Sans' }}>Ninguna</button>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto', paddingRight: 4 }}>
                  {preguntas.filter(p => p.clave_base !== 'participa').map((p, i) => (
                    <label key={p.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '6px 10px', borderRadius: 'var(--r)', background: exportConfig.preguntas[p.id] ? 'var(--accent-light)' : 'var(--surface)', border: `1px solid ${exportConfig.preguntas[p.id] ? 'var(--accent)' : 'var(--border)'}`, transition: 'all .1s' }}>
                      <input type="checkbox" checked={!!exportConfig.preguntas[p.id]}
                        onChange={e => setExportConfig(prev => ({ ...prev, preguntas: { ...prev.preguntas, [p.id]: e.target.checked } }))}
                        style={{ width: 15, height: 15, accentColor: 'var(--accent)', cursor: 'pointer', marginTop: 1, flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.4 }}>{p.texto}</div>
                        <div style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 2 }}>{p.tipo}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Cruces */}
              {comparaciones.length > 0 && sesionesCruceFiltradas.length > 0 && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={exportConfig.cruces} onChange={e => setExportConfig(p => ({ ...p, cruces: e.target.checked }))}
                    style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer' }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Gráficos cruzados</div>
                    <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{comparaciones.length} cruce{comparaciones.length !== 1 ? 's' : ''} configurado{comparaciones.length !== 1 ? 's' : ''} — se exportan como tablas de contingencia</div>
                  </div>
                </label>
              )}

              {/* Mapa */}
              {mapaDatos?.img ? (
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={exportConfig.mapa !== false} onChange={e => setExportConfig(p => ({ ...p, mapa: e.target.checked }))}
                    style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer' }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>🗺️ Mapa georreferenciado</div>
                    <div style={{ fontSize: 11, color: 'var(--ink3)' }}>Captura del mapa actual con los filtros y capas aplicados</div>
                  </div>
                </label>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--ink4)', padding: '8px 12px', background: 'var(--surface)', borderRadius: 'var(--r)', border: '1px dashed var(--border2)' }}>
                  💡 Para incluir el mapa, abrí la tab <b>🗺️ Mapa</b> primero y se captura automáticamente
                </div>
              )}

              {/* Datos crudos */}
              {datosExportFiltrados?.filas?.length > 0 && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={exportConfig.datosCrudos} onChange={e => setExportConfig(p => ({ ...p, datosCrudos: e.target.checked }))}
                    style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer' }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Datos crudos</div>
                    <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{datosExportFiltrados.filas.length} filas — tabla completa con georeferencia</div>
                  </div>
                </label>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setModalExport(false)}
                style={{ padding: '9px 18px', background: 'var(--surface)', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 13, cursor: 'pointer', fontFamily: 'DM Sans', color: 'var(--ink2)' }}>
                Cancelar
              </button>
              <button onClick={() => handleGenerarPDF(exportConfig)} disabled={generando}
                style={{ padding: '9px 18px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Sans', display: 'flex', alignItems: 'center', gap: 6 }}>
                {generando ? '⏳ Generando...' : '⬇ Exportar PDF'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}