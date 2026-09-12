import { useState } from 'react'
import { TIPOS, TIPOS_CON_OPCIONES, TIPOS_MATRIZ, CLAVE_BASE_OPCIONES, inputStyle, labelStyle, getOpcionesPregunta } from './encuestaBuilderConstants'

// ── Panel de condicionales ──
export function PanelCondicionales({ pregunta, todasPreguntas, index, onChange }) {
  const cond = pregunta.condicionales || { logica: 'OR', reglas: [] }
  const opcionesRespuesta = getOpcionesPregunta(pregunta)
  // Solo preguntas que vienen DESPUÉS de esta
  const preguntasDestino = todasPreguntas.filter((_, i) => i !== index)

  function update(nuevo) { onChange({ ...pregunta, condicionales: nuevo }) }

  function addRegla() {
    update({ ...cond, reglas: [...cond.reglas, { respuesta: '', accion: 'saltar', destino_id: '' }] })
  }

  function updateRegla(i, campo, valor) {
    const reglas = cond.reglas.map((r, idx) => idx === i ? { ...r, [campo]: valor } : r)
    update({ ...cond, reglas })
  }

  function removeRegla(i) {
    const reglas = cond.reglas.filter((_, idx) => idx !== i)
    update(reglas.length > 0 ? { ...cond, reglas } : null)
  }

  function toggleLogica() {
    update({ ...cond, logica: cond.logica === 'OR' ? 'AND' : 'OR' })
  }

  const chip = (activo) => ({
    padding: '3px 10px', borderRadius: 100, fontSize: 11, fontWeight: 700,
    cursor: 'pointer', border: `1.5px solid ${activo ? 'var(--accent)' : 'var(--border2)'}`,
    background: activo ? 'var(--accent-light)' : '#fff',
    color: activo ? 'var(--accent)' : 'var(--ink3)',
    fontFamily: 'DM Sans',
  })

  const sel = { padding: '6px 8px', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 12, fontFamily: 'DM Sans', background: 'var(--paper)' }

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink2)' }}>🔀 Condicionales</span>
          {cond.reglas.length > 1 && (
            <div style={{ display: 'flex', gap: 4 }}>
              <button type="button" style={chip(cond.logica === 'OR')}  onClick={toggleLogica}>OR</button>
              <button type="button" style={chip(cond.logica === 'AND')} onClick={toggleLogica}>AND</button>
            </div>
          )}
        </div>
        <button type="button" onClick={addRegla} style={{
          padding: '4px 12px', background: 'var(--accent-light)', color: 'var(--accent2)',
          border: '1.5px solid var(--accent2)', borderRadius: 'var(--r)',
          fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Sans',
        }}>+ Agregar regla</button>
      </div>

      {cond.reglas.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--ink3)', fontStyle: 'italic', padding: '8px 0' }}>
          Sin condicionales — la encuesta sigue el orden normal.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {cond.reglas.map((regla, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--surface)', padding: '8px 10px', borderRadius: 'var(--r)', flexWrap: 'wrap' }}>
            {/* Etiqueta SI/Y SI */}
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', minWidth: 28 }}>
              {i === 0 ? 'SI' : cond.logica}
            </span>

            {/* Respuesta que dispara */}
            {opcionesRespuesta.length > 0 ? (
              <select value={regla.respuesta} onChange={e => updateRegla(i, 'respuesta', e.target.value)} style={{ ...sel, minWidth: 120 }}>
                <option value="">Seleccioná respuesta</option>
                {opcionesRespuesta.map(op => <option key={op} value={op}>{op}</option>)}
              </select>
            ) : (
              <input
                value={regla.respuesta}
                onChange={e => updateRegla(i, 'respuesta', e.target.value)}
                placeholder="Respuesta..."
                style={{ ...sel, minWidth: 120, flex: 1 }}
              />
            )}

            {/* Acción */}
            <select value={regla.accion} onChange={e => updateRegla(i, 'accion', e.target.value)} style={sel}>
              <option value="saltar">→ Ir a pregunta</option>
              <option value="ocultar">✕ Ocultar pregunta</option>
              <option value="mostrar">✓ Mostrar pregunta</option>
              <option value="finalizar">⏹ Finalizar encuesta</option>
            </select>

            {/* Destino (si no es finalizar) */}
            {regla.accion !== 'finalizar' && (
              <select value={regla.destino_id} onChange={e => updateRegla(i, 'destino_id', e.target.value)} style={{ ...sel, flex: 1, minWidth: 140 }}>
                <option value="">Seleccioná pregunta</option>
                {preguntasDestino.map((p) => (
                  <option key={p.id || p._tempId} value={p.id || p._tempId}>
                    P{todasPreguntas.indexOf(p) + 1}: {p.texto ? (p.texto.length > 40 ? p.texto.substring(0, 40) + '…' : p.texto) : 'Sin texto'}
                  </option>
                ))}
              </select>
            )}

            <button type="button" onClick={() => removeRegla(i)} style={{
              width: 26, height: 26, border: '1px solid var(--border)', borderRadius: 6,
              background: 'var(--paper)', cursor: 'pointer', color: 'var(--danger)', fontSize: 14, flexShrink: 0,
            }}>×</button>
          </div>
        ))}
      </div>

      {cond.reglas.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 8, fontStyle: 'italic' }}>
          Si ninguna regla aplica, continúa al siguiente paso normal.
        </div>
      )}
    </div>
  )
}

// ── Tarjeta de pregunta ──
export function PreguntaCard({ pregunta, index, total, todasPreguntas, onUpdate, onDelete, onMove }) {
  const [expanded, setExpanded]         = useState(true)
  const [showCond, setShowCond]         = useState(false)
  const tieneOpciones = TIPOS_CON_OPCIONES.includes(pregunta.tipo)
  const tieneCondicionales = pregunta.condicionales?.reglas?.length > 0

  function addOpcion() {
    onUpdate({ ...pregunta, opciones: [...(pregunta.opciones || []), { texto: '', orden: (pregunta.opciones?.length || 0) + 1 }] })
  }
  function updateOpcion(i, texto) {
    onUpdate({ ...pregunta, opciones: pregunta.opciones.map((o, idx) => idx === i ? { ...o, texto } : o) })
  }
  function removeOpcion(i) {
    onUpdate({ ...pregunta, opciones: pregunta.opciones.filter((_, idx) => idx !== i).map((o, j) => ({ ...o, orden: j + 1 })) })
  }

  return (
    <div style={{ background: 'var(--paper)', border: `1px solid ${tieneCondicionales ? '#c4b5fd' : 'var(--border)'}`, borderRadius: 'var(--r2)', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,.05)' }}>
      {/* Header */}
      <div
        style={{ padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', borderBottom: expanded ? '1px solid var(--border)' : 'none', cursor: 'pointer' }}
        onClick={() => setExpanded(e => !e)}
      >
        <span style={{ fontFamily: 'Syne', fontSize: 11, fontWeight: 700, color: 'var(--ink3)', minWidth: 22 }}>P{index + 1}</span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: pregunta.texto ? 'var(--ink)' : 'var(--ink3)', fontStyle: pregunta.texto ? 'normal' : 'italic', lineHeight: 1.3 }}>
          {pregunta.texto || 'Nueva pregunta...'}
        </span>
        {tieneCondicionales && (
          <span style={{ fontSize: 10, background: '#f3e8ff', color: '#7c3aed', padding: '2px 7px', borderRadius: 100, fontWeight: 700 }}>
            🔀 {pregunta.condicionales.reglas.length} regla{pregunta.condicionales.reglas.length !== 1 ? 's' : ''}
          </span>
        )}
        <span style={{ fontSize: 10, color: 'var(--ink3)', background: 'var(--paper)', padding: '2px 8px', borderRadius: 100, border: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
          {TIPOS.find(t => t.value === pregunta.tipo)?.label}
        </span>
        <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
          <button onClick={() => onMove(index, -1)} disabled={index === 0} style={{ width: 26, height: 26, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--paper)', cursor: index === 0 ? 'not-allowed' : 'pointer', opacity: index === 0 ? .35 : 1, fontSize: 12 }}>↑</button>
          <button onClick={() => onMove(index,  1)} disabled={index === total-1} style={{ width: 26, height: 26, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--paper)', cursor: index === total-1 ? 'not-allowed' : 'pointer', opacity: index === total-1 ? .35 : 1, fontSize: 12 }}>↓</button>
          <button onClick={() => onDelete(index)} style={{ width: 26, height: 26, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--paper)', cursor: 'pointer', fontSize: 13, color: 'var(--danger)' }}>×</button>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>Texto de la pregunta</label>
            <textarea value={pregunta.texto} onChange={e => onUpdate({ ...pregunta, texto: e.target.value })} placeholder="Escribí la pregunta..." rows={2}
              style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={labelStyle}>Tipo</label>
              <select value={pregunta.tipo}
                onChange={e => {
                  const nuevo = e.target.value
                  onUpdate({
                    ...pregunta,
                    tipo: nuevo,
                    opciones: TIPOS_CON_OPCIONES.includes(nuevo) ? (pregunta.opciones || []) : [],
                    filas: TIPOS_MATRIZ.includes(nuevo) ? (pregunta.filas || [{ texto: '' }]) : undefined,
                    columnas: TIPOS_MATRIZ.includes(nuevo) ? (pregunta.columnas || [{ texto: '' }]) : undefined,
                  })
                }}
                style={inputStyle}>
                {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', fontWeight: 500, paddingBottom: 9 }}>
                <input type="checkbox" checked={pregunta.requerida} onChange={e => onUpdate({ ...pregunta, requerida: e.target.checked })} />
                Requerida
              </label>
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label style={labelStyle}>Tipo especial (para reportes automáticos)</label>
              <select value={pregunta.clave_base || ''}
                onChange={e => onUpdate({ ...pregunta, clave_base: e.target.value || null })}
                style={inputStyle}>
                {CLAVE_BASE_OPCIONES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {pregunta.tipo === 'matriz' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 8 }}>
              {/* Filas */}
              <div>
                <label style={labelStyle}>Filas (ítems a evaluar)</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(pregunta.filas || []).map((fila, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: 'var(--ink3)', fontWeight: 700, width: 18, textAlign: 'center' }}>{i + 1}</span>
                      <input value={fila.texto || ''} onChange={e => {
                        const nuevas = [...(pregunta.filas || [])]
                        nuevas[i] = { ...nuevas[i], texto: e.target.value }
                        onUpdate({ ...pregunta, filas: nuevas })
                      }} placeholder={`Fila ${i + 1}`}
                        style={{ ...inputStyle, flex: 1, marginBottom: 0 }} />
                      <button onClick={() => {
                        const nuevas = (pregunta.filas || []).filter((_, j) => j !== i)
                        onUpdate({ ...pregunta, filas: nuevas })
                      }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>×</button>
                    </div>
                  ))}
                  <button onClick={() => onUpdate({ ...pregunta, filas: [...(pregunta.filas || []), { texto: '' }] })}
                    style={{ padding: '7px', border: '1.5px dashed var(--border2)', borderRadius: 'var(--r)', background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--ink3)', fontFamily: 'DM Sans' }}>
                    + Agregar fila
                  </button>
                </div>
              </div>
              {/* Columnas */}
              <div>
                <label style={labelStyle}>Columnas (opciones de respuesta)</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(pregunta.columnas || []).map((col, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: 'var(--ink3)', fontWeight: 700, width: 18, textAlign: 'center' }}>{String.fromCharCode(65+i)}</span>
                      <input value={col.texto || ''} onChange={e => {
                        const nuevas = [...(pregunta.columnas || [])]
                        nuevas[i] = { ...nuevas[i], texto: e.target.value }
                        onUpdate({ ...pregunta, columnas: nuevas })
                      }} placeholder={`Opción ${String.fromCharCode(65+i)}`}
                        style={{ ...inputStyle, flex: 1, marginBottom: 0 }} />
                      <button onClick={() => {
                        const nuevas = (pregunta.columnas || []).filter((_, j) => j !== i)
                        onUpdate({ ...pregunta, columnas: nuevas })
                      }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>×</button>
                    </div>
                  ))}
                  <button onClick={() => onUpdate({ ...pregunta, columnas: [...(pregunta.columnas || []), { texto: '' }] })}
                    style={{ padding: '7px', border: '1.5px dashed var(--border2)', borderRadius: 'var(--r)', background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--ink3)', fontFamily: 'DM Sans' }}>
                    + Agregar columna
                  </button>
                </div>
              </div>
            </div>
          )}

          {tieneOpciones && (
            <div>
              <label style={labelStyle}>Opciones</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(pregunta.opciones || []).map((op, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--ink3)', fontWeight: 700, width: 18, textAlign: 'center' }}>{String.fromCharCode(65+i)}</span>
                    <input value={op.texto} onChange={e => updateOpcion(i, e.target.value)} placeholder={`Opción ${String.fromCharCode(65+i)}`}
                      style={{ ...inputStyle, flex: 1 }} />
                    <button onClick={() => removeOpcion(i)} style={{ width: 28, height: 28, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--paper)', cursor: 'pointer', color: 'var(--danger)', fontSize: 14, flexShrink: 0 }}>×</button>
                  </div>
                ))}
                <button onClick={addOpcion}
                  style={{ padding: '7px 14px', border: '1.5px dashed var(--border2)', borderRadius: 'var(--r)', background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--accent2)', fontWeight: 600, fontFamily: 'DM Sans', marginTop: 2 }}>
                  + Agregar opción
                </button>
              </div>
            </div>
          )}

          {/* Toggle condicionales */}
          <div>
            <button type="button" onClick={() => setShowCond(s => !s)} style={{
              padding: '6px 12px', background: tieneCondicionales ? '#f3e8ff' : 'var(--surface)',
              color: tieneCondicionales ? '#7c3aed' : 'var(--ink3)',
              border: `1.5px solid ${tieneCondicionales ? '#c4b5fd' : 'var(--border2)'}`,
              borderRadius: 'var(--r)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans',
            }}>
              🔀 {tieneCondicionales ? `Condicionales (${pregunta.condicionales.reglas.length})` : 'Agregar condicional'}
              <span style={{ marginLeft: 6 }}>{showCond ? '▲' : '▼'}</span>
            </button>

            {showCond && (
              <div style={{ marginTop: 12 }}>
                <PanelCondicionales
                  pregunta={pregunta}
                  todasPreguntas={todasPreguntas}
                  index={index}
                  onChange={onUpdate}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
