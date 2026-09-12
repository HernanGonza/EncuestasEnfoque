import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { Spinner } from '../../components/ui'
import { TIPOS, ESTADO_CONFIG, inputStyle, labelStyle } from './encuestaBuilderConstants'
import { PreguntaCard } from './encuestaBuilderShared'

function normalizarSubdominio(v) {
  return v.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+/, '')
}

const TEMAS_VISUALES = [
  { value: 'ciudad',        label: '🏙️ Ciudad',        desc: 'Encuestas sobre la ciudad, espacio público, gestión municipal.' },
  { value: 'gente',         label: '👥 Gente',          desc: 'Encuestas sobre comunidad, vecinos, participación.' },
  { value: 'institucional', label: '🏛️ Institucional',  desc: 'Neutro, para cualquier otro tema.' },
]

// Toda encuesta online tiene que poder cruzarse por estos 4 datos
// demográficos — se precargan al crear una encuesta nueva (editables/
// borrables como cualquier otra pregunta, esto es solo para no tener que
// acordarse de armarlas a mano cada vez). A propósito NO se precarga un
// "¿Desea participar?" tipo sí/no: en online es redundante — si no quiere
// participar, directamente no abre el link.
const PREGUNTAS_BASE_ONLINE = [
  { texto: '¿Cuál es tu rango de edad?', clave_base: 'edad',
    opciones: ['18 a 25 años', '26 a 35 años', '36 a 45 años', '46 a 60 años', 'Más de 60 años'] },
  { texto: '¿Con qué género te identificás?', clave_base: 'sexo',
    opciones: ['Femenino', 'Masculino', 'Otro', 'Prefiero no decir'] },
  { texto: '¿Cuál es tu nivel educativo más alto alcanzado?', clave_base: 'nivel_educativo',
    opciones: ['Primario', 'Secundario', 'Terciario / Universitario', 'Posgrado'] },
  { texto: '¿Cuál es tu situación laboral actual?', clave_base: 'situacion_laboral',
    opciones: ['Empleado/a', 'Desempleado/a', 'Estudiante', 'Jubilado/a', 'Ama de casa'] },
]

function preguntasBaseIniciales() {
  return PREGUNTAS_BASE_ONLINE.map((p, i) => ({
    _tempId: Date.now() + i,
    texto: p.texto,
    tipo: 'opcion_multiple',
    requerida: true,
    orden: i + 1,
    clave_base: p.clave_base,
    condicionales: null,
    opciones: p.opciones.map((texto, j) => ({ texto, orden: j + 1 })),
  }))
}

// <input type="datetime-local"> usa hora local sin offset (YYYY-MM-DDTHH:mm).
// La DB guarda timestamptz — estas dos funciones convierten en los dos sentidos.
function isoALocal(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function localAIso(local) {
  return local ? new Date(local).toISOString() : null
}

// ── Builder de encuestas online — separado de EncuestaBuilder.jsx a pedido.
// Comparte el editor de preguntas (encuestaBuilderShared) pero tiene su
// propio flujo: tipo_encuesta fijo en 'online' y asignación de subdominio
// (campogrande -> campogrande.metr1ka.com), que acá asigna el superadmin.
export default function EncuestaBuilderOnline() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEditing = Boolean(id)

  const [orgs, setOrgs]             = useState([])
  const [loading, setLoading]       = useState(isEditing)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState('')
  const [bloqueado, setBloqueado]   = useState(false)

  const [meta, setMeta] = useState({
    nombre: '', descripcion: '', pedido_por: '', estado_produccion: 'pendiente', subdominio: '',
    tema_visual: 'ciudad', titulo_publico: '', subtitulo_publico: '',
    publicar_desde: '', publicar_hasta: '',
  })
  const [preguntas, setPreguntas] = useState(() => isEditing ? [] : preguntasBaseIniciales())

  useEffect(() => {
    supabase.from('organizaciones').select('id, nombre').order('nombre').then(({ data }) => setOrgs(data || []))
    if (id) loadEncuesta()
  }, [id]) // eslint-disable-line

  async function loadEncuesta() {
    setLoading(true)
    try {
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
        estado_produccion:  enc.estado_produccion  || 'pendiente',
        subdominio:         enc.subdominio         || '',
        tema_visual:        enc.tema_visual        || 'ciudad',
        titulo_publico:     enc.titulo_publico     || '',
        subtitulo_publico:  enc.subtitulo_publico  || '',
        publicar_desde:     isoALocal(enc.publicar_desde),
        publicar_hasta:     isoALocal(enc.publicar_hasta),
      })

      const pqs = (data.preguntas || []).map(p => ({
        ...p,
        opciones: (p.opciones_pregunta || []),
        filas:    p.config_matriz?.filas    || (p.tipo === 'matriz' ? [{ texto: '' }] : undefined),
        columnas: p.config_matriz?.columnas || (p.tipo === 'matriz' ? [{ texto: '' }] : undefined),
      }))
      setPreguntas(pqs)

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
    if (meta.publicar_desde && meta.publicar_hasta && meta.publicar_hasta <= meta.publicar_desde) {
      setError('La fecha de fin tiene que ser posterior a la de inicio')
      return
    }
    setSaving(true); setError('')
    try {
      const subdominio = meta.subdominio ? normalizarSubdominio(meta.subdominio) : null
      const camposComunes = {
        nombre: meta.nombre, descripcion: meta.descripcion || null,
        pedido_por: meta.pedido_por || null, estado_produccion: meta.estado_produccion,
        tipo_encuesta: 'online', subdominio,
        tema_visual: meta.tema_visual || 'ciudad',
        titulo_publico: meta.titulo_publico || null,
        subtitulo_publico: meta.subtitulo_publico || null,
        publicar_desde: localAIso(meta.publicar_desde),
        publicar_hasta: localAIso(meta.publicar_hasta),
      }
      let encuestaId = id
      if (isEditing) {
        const { error: e } = await supabase.from('encuestas').update(camposComunes).eq('id', id)
        if (e) throw e
      } else {
        const { data, error: e } = await supabase.from('encuestas').insert({
          ...camposComunes, organizacion_id: meta.pedido_por || null,
        }).select().single()
        if (e) throw e
        encuestaId = data.id
      }

      if (isEditing) await supabase.from('preguntas').delete().eq('encuesta_id', encuestaId)

      const preguntasGuardadas = []
      for (let i = 0; i < preguntas.length; i++) {
        const p = preguntas[i]
        const { data: pData, error: pErr } = await supabase.from('preguntas').insert({
          encuesta_id: encuestaId, texto: p.texto, tipo: p.tipo,
          requerida: p.requerida, orden: i + 1,
          es_base: p.es_base || false, clave_base: p.clave_base || null,
          condicionales: null,
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

      const idMap = {}
      preguntas.forEach((p, i) => {
        const key = p.id || p._tempId
        idMap[key] = preguntasGuardadas[i]._nuevoId
      })

      for (const pg of preguntasGuardadas) {
        const original = preguntas.find(p => (p.id || p._tempId) === (pg.id || pg._tempId))
        if (!original?.condicionales?.reglas?.length) continue

        const reglasActualizadas = original.condicionales.reglas.map(r => ({
          ...r,
          destino_id: idMap[r.destino_id] || r.destino_id,
        }))
        await supabase.from('preguntas').update({
          condicionales: { ...original.condicionales, reglas: reglasActualizadas }
        }).eq('id', pg._nuevoId)
      }

      navigate('/superadmin/encuestas-online')
    } catch (err) {
      if (err.code === '23505') setError('Ese subdominio ya está en uso por otra encuesta.')
      else setError(err.message)
    }
    setSaving(false)
  }

  async function handleEnviarRevision() {
    await supabase.from('encuestas').update({ estado_produccion: 'para_revisar' }).eq('id', id)
    navigate('/superadmin/encuestas-online')
  }

  if (loading) return <div className="sa-page"><div style={{ padding: 60 }}><Spinner center size="lg" /></div></div>

  const cfg = ESTADO_CONFIG[meta.estado_produccion] || ESTADO_CONFIG.pendiente
  const esPublicada = ['publicada', 'completada'].includes(meta.estado_produccion)

  return (
    <div className="sa-page">
      <div className="sa-topbar">
        <div className="sa-topbar-left">
          <div className="sa-eyebrow">Superadmin / Encuestas online</div>
          <h1 className="sa-title">{isEditing ? 'Editar encuesta online' : 'Nueva encuesta online'}</h1>
          {isEditing && (
            <span style={{ padding: '3px 10px', borderRadius: 100, fontSize: 11, fontWeight: 700, background: cfg.bg, color: cfg.color }}>
              {cfg.label}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => navigate('/superadmin/encuestas-online')}
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
                  <label style={labelStyle}>Subdominio</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      value={meta.subdominio}
                      onChange={e => setMeta(m => ({ ...m, subdominio: normalizarSubdominio(e.target.value) }))}
                      placeholder="campogrande"
                      style={{ ...inputStyle, fontFamily: 'DM Mono, monospace' }}
                      disabled={bloqueado || esPublicada}
                    />
                    <span style={{ fontSize: 12, color: 'var(--ink3)', whiteSpace: 'nowrap' }}>.metr1ka.com</span>
                  </div>
                  {meta.subdominio && (
                    <div style={{ fontSize: 11, color: 'var(--accent2)', marginTop: 4, fontFamily: 'DM Mono, monospace' }}>
                      https://{meta.subdominio}.metr1ka.com
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>
                    Solo minúsculas, números y guiones. Tiene que ser único en toda la plataforma.
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Tema visual</label>
                  <select value={meta.tema_visual} onChange={e => setMeta(m => ({ ...m, tema_visual: e.target.value }))}
                    style={inputStyle} disabled={bloqueado || esPublicada}>
                    {TEMAS_VISUALES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>
                    {TEMAS_VISUALES.find(t => t.value === meta.tema_visual)?.desc}
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Título de bienvenida</label>
                  <input value={meta.titulo_publico} onChange={e => setMeta(m => ({ ...m, titulo_publico: e.target.value }))}
                    placeholder={meta.nombre || 'Título que ve el respondente'} style={inputStyle} disabled={bloqueado || esPublicada} />
                </div>
                <div>
                  <label style={labelStyle}>Bajada de bienvenida</label>
                  <textarea value={meta.subtitulo_publico} onChange={e => setMeta(m => ({ ...m, subtitulo_publico: e.target.value }))}
                    placeholder={meta.descripcion || 'Texto corto debajo del título'} rows={2} style={{ ...inputStyle, resize: 'vertical' }} disabled={bloqueado || esPublicada} />
                  <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>
                    Si dejás estos dos vacíos, se usa el nombre y la descripción de la encuesta.
                  </div>
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
                <div>
                  <label style={labelStyle}>Programación (opcional)</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 3 }}>Abre</div>
                      <input type="datetime-local" value={meta.publicar_desde} onChange={e => setMeta(m => ({ ...m, publicar_desde: e.target.value }))}
                        style={inputStyle} disabled={bloqueado} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 3 }}>Cierra</div>
                      <input type="datetime-local" value={meta.publicar_hasta} onChange={e => setMeta(m => ({ ...m, publicar_hasta: e.target.value }))}
                        style={inputStyle} disabled={bloqueado} />
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>
                    Fuera de este rango nadie puede responderla, aunque esté "Publicada". Al llegar la fecha de cierre se marca sola como completada y libera el subdominio. Dejalo vacío para que no cierre sola.
                  </div>
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
                <div style={{ fontSize: 28, marginBottom: 10 }}>🌐</div>
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
