import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { Spinner } from '../../components/ui'

const TIPOS = [
  { value: 'opcion_multiple', label: 'Opción múltiple' },
  { value: 'checkbox',        label: 'Checkbox (múltiple)' },
  { value: 'si_no',           label: 'Sí / No' },
  { value: 'escala',          label: 'Escala 1-10' },
  { value: 'texto_libre',     label: 'Texto libre' },
  { value: 'desplegable',     label: 'Desplegable' },
  { value: 'matriz',          label: 'Matriz (tabla de opciones)' },
]
const TIPOS_CON_OPCIONES = ['opcion_multiple', 'checkbox', 'desplegable']
const TIPOS_MATRIZ = ['matriz']
// Taxonomía de preguntas "especiales" (sección 8 del plan de reportes): sin
// esto marcado, los reportes automáticos de candidato/perfil demográfico no
// tienen forma de saber qué pregunta es cuál sin adivinar por el texto
// literal. 'participa' ya existe y se usa en producción (no se toca acá,
// se sigue seteando igual que hasta ahora).
// El plan sugiere 'genero', pero EncuestaDetalle.jsx ya trae un filtro
// dormido para 'sexo' (`p.clave_base === 'sexo'`, línea ~887) que nunca
// llegó a usarse porque no había forma de setearlo — se respeta ese valor
// ya presente en el código en vez de introducir uno nuevo para lo mismo.
const CLAVE_BASE_OPCIONES = [
  { value: '',                     label: '— Ninguna —' },
  { value: 'participa',            label: 'Participación (¿participa de la encuesta?)' },
  { value: 'candidato_intendente', label: 'Candidato a intendente' },
  { value: 'candidato_gobernador', label: 'Candidato a gobernador' },
  { value: 'edad',                 label: 'Edad' },
  { value: 'sexo',                 label: 'Género' },
  { value: 'nivel_educativo',      label: 'Nivel educativo' },
  { value: 'situacion_laboral',    label: 'Situación laboral' },
  { value: 'evaluacion_gestion',   label: 'Evaluación de gestión' },
  { value: 'problema_principal',   label: 'Principal problema' },
]
const ESTADO_CONFIG = {
  pendiente:    { label: 'Pendiente',    color: '#b45309', bg: '#fef3c7' },
  en_proceso:   { label: 'En proceso',   color: '#0369a1', bg: '#e0f2fe' },
  para_revisar: { label: 'Para revisar', color: '#7c3aed', bg: '#f3e8ff' },
  publicada:    { label: 'Publicada',    color: '#1a472a', bg: '#d8f3dc' },
  completada:   { label: 'Completada',   color: '#374151', bg: '#f3f4f6' },
}

const inputStyle = {
  width: '100%', padding: '9px 12px',
  border: '1.5px solid var(--border2)', borderRadius: 'var(--r)',
  fontSize: 13, outline: 'none', fontFamily: 'DM Sans', background: 'var(--paper)',
}
const labelStyle = { fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--ink2)' }

// ── Obtener opciones posibles para una pregunta ──
function getOpcionesPregunta(pregunta) {
  if (pregunta.tipo === 'si_no') return ['Sí', 'No']
  if (pregunta.tipo === 'escala') return Array.from({ length: 10 }, (_, i) => String(i + 1))
  if (TIPOS_CON_OPCIONES.includes(pregunta.tipo)) return (pregunta.opciones || []).map(o => o.texto).filter(Boolean)
  if (pregunta.tipo === 'matriz') return (pregunta.columnas || []).map(c => c.texto).filter(Boolean)
  return [] // texto_libre no tiene opciones predefinidas
}

// ── Panel de condicionales ──
function PanelCondicionales({ pregunta, todasPreguntas, index, onChange }) {
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
                {preguntasDestino.map((p, pi) => (
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
function PreguntaCard({ pregunta, index, total, todasPreguntas, onUpdate, onDelete, onMove }) {
  const [expanded, setExpanded]         = useState(true)
  const [showCond, setShowCond]         = useState(false)
  const tieneOpciones = TIPOS_CON_OPCIONES.includes(pregunta.tipo)
  const esMatriz      = pregunta.tipo === 'matriz'
  // Para matrices: filas y columnas en condicionales.matriz_config
  const matrizConfig  = pregunta.condicionales?.matriz_config || { filas: [], columnas: [] }
  function setMatrizConfig(key, valor) {
    onUpdate({
      ...pregunta,
      condicionales: {
        ...(pregunta.condicionales || {}),
        matriz_config: { ...matrizConfig, [key]: valor }
      }
    })
  }
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

// ── Builder principal ──
export default function EncuestaBuilder() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEditing = Boolean(id)

  const [orgs, setOrgs]             = useState([])
  const [loading, setLoading]       = useState(isEditing)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState('')
  const [bloqueado, setBloqueado]   = useState(false)

  const [meta, setMeta] = useState({
    nombre: '', descripcion: '', pedido_por: '', estado_produccion: 'pendiente', tipo_encuesta: 'domiciliaria',
  })
  const [preguntas, setPreguntas] = useState([])

  useEffect(() => {
    supabase.from('organizaciones').select('id, nombre').order('nombre').then(({ data }) => setOrgs(data || []))
    if (id) loadEncuesta()
  }, [id]) // eslint-disable-line

  async function loadEncuesta() {
    setLoading(true)
    try {
      // get_encuesta_full: trae encuesta + preguntas + opciones en una sola query optimizada
      // p_org_id null → la función es SECURITY DEFINER, el superadmin no tiene org_id propio,
      // por eso pasamos el organizacion_id de la encuesta consultándolo primero.
      const { data: encMeta } = await supabase
        .from('encuestas')
        .select('organizacion_id, pedido_por')
        .eq('id', id)
        .single()

      const orgId = encMeta?.organizacion_id || encMeta?.pedido_por

      const { data, error: rpcErr } = await supabase.rpc('get_encuesta_full', {
        p_encuesta_id: id,
        p_org_id:      orgId,
      })
      if (rpcErr) throw rpcErr

      const enc = data?.encuesta
      if (!enc) { setLoading(false); return }

      setMeta({
        nombre:             enc.nombre             || '',
        descripcion:        enc.descripcion        || '',
        pedido_por:         enc.pedido_por         || '',
        tipo_encuesta:      enc.tipo_encuesta       || 'domiciliaria',
        estado_produccion:  enc.estado_produccion  || 'pendiente',
      })

      // Las opciones ya vienen dentro de cada pregunta como opciones_pregunta
      const pqs = (data.preguntas || []).map(p => ({
        ...p,
        opciones: (p.opciones_pregunta || []),
        filas:    p.config_matriz?.filas    || (p.tipo === 'matriz' ? [{ texto: '' }] : undefined),
        columnas: p.config_matriz?.columnas || (p.tipo === 'matriz' ? [{ texto: '' }] : undefined),
      }))
      setPreguntas(pqs)

      // Verificar bloqueo: hay sesiones respondidas
      if (data.resumen?.total_sesiones > 0) {
        setBloqueado(true)
      }
    } catch (err) {
      console.error('loadEncuesta error:', err)
    }
    setLoading(false)
  }

  function addPregunta() {
    setPreguntas(prev => [...prev, { _tempId: Date.now(), texto: '', tipo: 'opcion_multiple', requerida: true, orden: prev.length + 1, opciones: [], condicionales: null }])
  }
  function updatePregunta(i, updated) { setPreguntas(prev => prev.map((p, idx) => idx === i ? updated : p)) }
  function deletePregunta(i)          { setPreguntas(prev => prev.filter((_, idx) => idx !== i).map((p, j) => ({ ...p, orden: j + 1 }))) }
  function movePregunta(i, dir) {
    const ni = i + dir
    if (ni < 0 || ni >= preguntas.length) return
    const arr = [...preguntas];
    [arr[i], arr[ni]] = [arr[ni], arr[i]]
    setPreguntas(arr.map((p, j) => ({ ...p, orden: j + 1 })))
  }

  async function handleSave() {
    if (!meta.nombre.trim()) { setError('El nombre es obligatorio'); return }
    if (bloqueado) { setError('Esta encuesta tiene respuestas y no puede editarse'); return }
    setSaving(true); setError('')
    try {
      let encuestaId = id
      if (isEditing) {
        const { error: e } = await supabase.from('encuestas').update({
          nombre: meta.nombre, descripcion: meta.descripcion || null,
          pedido_por: meta.pedido_por || null, estado_produccion: meta.estado_produccion,
          tipo_encuesta: meta.tipo_encuesta || 'domiciliaria',
        }).eq('id', id)
        if (e) throw e
      } else {
        const { data, error: e } = await supabase.from('encuestas').insert({
          nombre: meta.nombre, descripcion: meta.descripcion || null,
          pedido_por: meta.pedido_por || null, estado_produccion: meta.estado_produccion,
          organizacion_id: meta.pedido_por || null,
          tipo_encuesta: meta.tipo_encuesta || 'domiciliaria',
        }).select().single()
        if (e) throw e
        encuestaId = data.id
      }

      if (isEditing) await supabase.from('preguntas').delete().eq('encuesta_id', encuestaId)

      // Guardar preguntas — primero sin condicionales para obtener IDs reales
      const preguntasGuardadas = []
      for (let i = 0; i < preguntas.length; i++) {
        const p = preguntas[i]
        const { data: pData, error: pErr } = await supabase.from('preguntas').insert({
          encuesta_id: encuestaId, texto: p.texto, tipo: p.tipo,
          requerida: p.requerida, orden: i + 1,
          es_base: p.es_base || false, clave_base: p.clave_base || null,
          condicionales: null, // se actualiza en segundo paso
          config_matriz: p.tipo === 'matriz' ? {
            filas:    (p.filas    || []).filter(f => f.texto?.trim()).map(f => ({ texto: f.texto.trim() })),
            columnas: (p.columnas || []).filter(c => c.texto?.trim()).map(c => ({ texto: c.texto.trim() })),
          } : null,
        }).select().single()
        if (pErr) throw pErr
        preguntasGuardadas.push({ ...p, _nuevoId: pData.id })

        if (p.opciones?.length > 0) {
          const { error: oErr } = await supabase.from('opciones_pregunta').insert(
            p.opciones.map((o, j) => ({ pregunta_id: pData.id, texto: o.texto, orden: j + 1 }))
          )
          if (oErr) throw oErr
        }
      }

      // Segundo paso: guardar condicionales con IDs reales
      // Mapear _tempId / id viejo → id nuevo
      const idMap = {}
      preguntas.forEach((p, i) => {
        const key = p.id || p._tempId
        idMap[key] = preguntasGuardadas[i]._nuevoId
      })

      for (const pg of preguntasGuardadas) {
        const original = preguntas.find(p => (p.id || p._tempId) === (pg.id || pg._tempId))
        if (!original?.condicionales?.reglas?.length) continue

        // Reemplazar destino_id temporal por ID real
        const reglasActualizadas = original.condicionales.reglas.map(r => ({
          ...r,
          destino_id: idMap[r.destino_id] || r.destino_id,
        }))
        await supabase.from('preguntas').update({
          condicionales: { ...original.condicionales, reglas: reglasActualizadas }
        }).eq('id', pg._nuevoId)
      }

      navigate('/superadmin/encuestas')
    } catch (err) { setError(err.message) }
    setSaving(false)
  }

  async function handleEnviarRevision() {
    await supabase.from('encuestas').update({ estado_produccion: 'para_revisar' }).eq('id', id)
    navigate('/superadmin/encuestas')
  }

  if (loading) return <div className="sa-page"><div style={{ padding: 60 }}><Spinner center size="lg" /></div></div>

  const cfg = ESTADO_CONFIG[meta.estado_produccion] || ESTADO_CONFIG.pendiente
  const esPublicada = ['publicada', 'completada'].includes(meta.estado_produccion)

  return (
    <div className="sa-page">
      <div className="sa-topbar">
        <div className="sa-topbar-left">
          <div className="sa-eyebrow">Superadmin / Encuestas</div>
          <h1 className="sa-title">{isEditing ? 'Editar encuesta' : 'Nueva encuesta'}</h1>
          {isEditing && (
            <span style={{ padding: '3px 10px', borderRadius: 100, fontSize: 11, fontWeight: 700, background: cfg.bg, color: cfg.color }}>
              {cfg.label}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => navigate('/superadmin/encuestas')}
            style={{ padding: '9px 18px', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', background: 'none', cursor: 'pointer', fontSize: 13, fontFamily: 'DM Sans' }}>
            Cancelar
          </button>
          {isEditing && meta.estado_produccion === 'en_proceso' && (
            <button onClick={handleEnviarRevision}
              style={{ padding: '9px 18px', background: '#f3e8ff', color: '#7c3aed', border: '1.5px solid #c4b5fd', borderRadius: 'var(--r)', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'DM Sans' }}>
              📤 Enviar a revisión
            </button>
          )}
          {!esPublicada && !bloqueado && (
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '9px 18px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r)', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'DM Sans', opacity: saving ? .6 : 1 }}>
              {saving ? 'Guardando...' : isEditing ? 'Guardar cambios' : 'Crear encuesta'}
            </button>
          )}
        </div>
      </div>

      <div className="sa-content">
        {bloqueado && (
          <div style={{ padding: '12px 16px', background: '#fef3c7', borderRadius: 'var(--r)', fontSize: 13, color: '#b45309', marginBottom: 20, borderLeft: '3px solid #fcd34d', fontWeight: 500 }}>
            ⚠️ Esta encuesta tiene respuestas registradas y no puede editarse.
          </div>
        )}
        {esPublicada && !bloqueado && (
          <div style={{ padding: '12px 16px', background: 'var(--accent-light)', borderRadius: 'var(--r)', fontSize: 13, color: 'var(--accent2)', marginBottom: 20, borderLeft: '3px solid var(--accent)', fontWeight: 500 }}>
            ✅ Esta encuesta está publicada. Para editarla volvela a "En proceso" desde el kanban.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20, alignItems: 'start' }}>
          {/* Panel izquierdo */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="sa-card" style={{ padding: 18 }}>
              <div style={{ fontFamily: 'Syne', fontSize: 13, fontWeight: 700, marginBottom: 14 }}>Información</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Nombre *</label>
                  <input value={meta.nombre} onChange={e => setMeta(m => ({ ...m, nombre: e.target.value }))}
                    placeholder="Nombre de la encuesta" style={inputStyle} disabled={bloqueado || esPublicada} />
                </div>
                <div>
                  <label style={labelStyle}>Descripción</label>
                  <textarea value={meta.descripcion} onChange={e => setMeta(m => ({ ...m, descripcion: e.target.value }))}
                    placeholder="Descripción breve..." rows={3} style={{ ...inputStyle, resize: 'vertical' }} disabled={bloqueado || esPublicada} />
                </div>
                <div>
                  <label style={labelStyle}>Organización (cliente)</label>
                  <select value={meta.pedido_por} onChange={e => setMeta(m => ({ ...m, pedido_por: e.target.value }))}
                    style={inputStyle} disabled={bloqueado || esPublicada}>
                    <option value="">Sin asignar</option>
                    {orgs.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Tipo de encuesta</label>
                  <select value={meta.tipo_encuesta || 'domiciliaria'} onChange={e => setMeta(m => ({ ...m, tipo_encuesta: e.target.value }))}
                    style={inputStyle} disabled={bloqueado || esPublicada}>
                    <option value="domiciliaria">Domiciliaria</option>
                    <option value="callejera">Callejera</option>
                    <option value="telefonica">Telefónica</option>
                    <option value="online">Online</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Estado de producción</label>
                  <select value={meta.estado_produccion} onChange={e => setMeta(m => ({ ...m, estado_produccion: e.target.value }))}
                    style={inputStyle} disabled={bloqueado}>
                    <option value="pendiente">Pendiente</option>
                    <option value="en_proceso">En proceso</option>
                    <option value="para_revisar">Para revisar</option>
                    <option value="publicada">Publicada</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="sa-card" style={{ padding: 14 }}>
              <div style={{ fontFamily: 'Syne', fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Resumen</div>
              <div style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 8 }}>{preguntas.length} pregunta{preguntas.length !== 1 ? 's' : ''}</div>
              {preguntas.filter(p => p.condicionales?.reglas?.length > 0).length > 0 && (
                <div style={{ fontSize: 12, color: '#7c3aed', marginBottom: 8 }}>
                  🔀 {preguntas.filter(p => p.condicionales?.reglas?.length > 0).length} con condicionales
                </div>
              )}
              {preguntas.length > 0 && Object.entries(
                preguntas.reduce((acc, p) => { acc[p.tipo] = (acc[p.tipo] || 0) + 1; return acc }, {})
              ).map(([tipo, count]) => (
                <div key={tipo} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                  <span style={{ color: 'var(--ink3)' }}>{TIPOS.find(t => t.value === tipo)?.label}</span>
                  <span style={{ fontWeight: 700 }}>{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Panel derecho — Preguntas */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {error && (
              <div style={{ fontSize: 13, color: 'var(--danger)', padding: '10px 14px', background: '#fdecea', borderRadius: 'var(--r)' }}>{error}</div>
            )}
            {preguntas.length === 0 && (
              <div style={{ textAlign: 'center', padding: '48px 24px', background: 'var(--paper)', border: '2px dashed var(--border2)', borderRadius: 'var(--r2)', color: 'var(--ink3)' }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>📋</div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Sin preguntas todavía</div>
                <div style={{ fontSize: 12 }}>Hacé clic en "Agregar pregunta" para empezar</div>
              </div>
            )}
            {preguntas.map((p, i) => (
              <PreguntaCard
                key={p.id || p._tempId}
                pregunta={p}
                index={i}
                total={preguntas.length}
                todasPreguntas={preguntas}
                onUpdate={updated => updatePregunta(i, updated)}
                onDelete={deletePregunta}
                onMove={movePregunta}
              />
            ))}
            {!bloqueado && !esPublicada && (
              <button onClick={addPregunta}
                style={{ padding: '12px', border: '2px dashed var(--border2)', borderRadius: 'var(--r2)', background: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--accent2)', fontWeight: 600, fontFamily: 'DM Sans', transition: 'all .15s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-light)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border2)'; e.currentTarget.style.background = 'none' }}>
                + Agregar pregunta
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}