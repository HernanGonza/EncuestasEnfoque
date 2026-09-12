import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { Spinner, ConfirmDialog } from '../../components/ui'

const COLS = [
  { key: 'pendiente',    label: 'Pendientes',   color: '#b45309', bg: '#fef3c7', border: '#fcd34d' },
  { key: 'en_proceso',   label: 'En proceso',   color: '#0369a1', bg: '#e0f2fe', border: '#7dd3fc' },
  { key: 'para_revisar', label: 'Para revisar', color: '#7c3aed', bg: '#f3e8ff', border: '#c4b5fd' },
  { key: 'publicada',    label: 'Publicadas',   color: '#1a472a', bg: '#d8f3dc', border: '#86efac' },
  { key: 'completada',   label: 'Completadas',  color: '#374151', bg: '#f3f4f6', border: '#d1d5db' },
]

const PASOS = {
  pendiente:    ['en_proceso'],
  en_proceso:   ['para_revisar', 'pendiente'],
  para_revisar: ['publicada', 'en_proceso'],
  publicada:    ['en_proceso', 'completada'],
  completada:   ['publicada'],
}

// Kanban de encuestas online — separado a propósito del de Encuestas.jsx
// (domiciliaria/callejera/telefónica). Misma mecánica de columnas y drag &
// drop, pero acá cada tarjeta muestra el subdominio en vez de la org.
export default function EncuestasOnline() {
  const [encuestas, setEncuestas]   = useState([])
  const [organizaciones, setOrganizaciones] = useState([])
  const [loading, setLoading]       = useState(true)
  const [draggingId, setDraggingId] = useState(null)
  const [dragOver, setDragOver]     = useState(null)
  const [busqueda, setBusqueda]     = useState('')
  const [filtroOrg, setFiltroOrg]   = useState('')
  const navigate = useNavigate()

  async function fetchData() {
    setLoading(true)

    const { data: encData, error: err1 } = await supabase
      .from('encuestas')
      .select('id, nombre, descripcion, estado_produccion, creado_en, organizacion_id, subdominio, publicar_desde, publicar_hasta')
      .eq('tipo_encuesta', 'online')
      .order('creado_en', { ascending: false })

    if (err1) {
      console.error('Error al cargar encuestas online:', err1)
      setLoading(false)
      return
    }

    let organizacionesMap = {}
    if (encData && encData.length > 0) {
      const orgIds = [...new Set(encData.map(e => e.organizacion_id).filter(Boolean))]

      if (orgIds.length > 0) {
        const { data: orgs } = await supabase
          .from('organizaciones')
          .select('id, nombre, color_primario')
          .in('id', orgIds)

        if (orgs) {
          organizacionesMap = Object.fromEntries(orgs.map(o => [o.id, o]))
        }
      }
    }

    const dataEnriquecida = (encData || []).map(enc => ({
      ...enc,
      org: organizacionesMap[enc.organizacion_id] || null
    }))

    setEncuestas(dataEnriquecida)
    setOrganizaciones(Object.values(organizacionesMap))
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [])

  // Antes de publicar una encuesta online (a diferencia de los otros pasos
  // del kanban) hace falta confirmar: sin esto es fácil publicar sin querer
  // una encuesta sin subdominio asignado, o con uno que quedó pisado por
  // otra en el medio.
  const [subdomChequeo, setSubdomChequeo] = useState(null) // { enc } mientras se valida
  const [confirmarPublicar, setConfirmarPublicar] = useState(null) // enc lista para confirmar
  const [subdomError, setSubdomError] = useState(null) // { enc, mensaje }

  async function pedirPublicar(enc) {
    if (!enc.subdominio) {
      setSubdomError({ enc, mensaje: 'Esta encuesta no tiene subdominio asignado. Asignale uno antes de publicarla.' })
      return
    }
    setSubdomChequeo({ enc })
    const { data, error } = await supabase
      .from('encuestas')
      .select('id')
      .eq('subdominio', enc.subdominio)
      .neq('id', enc.id)
      .limit(1)
    setSubdomChequeo(null)

    if (error) {
      setSubdomError({ enc, mensaje: 'No se pudo verificar el subdominio. Probá de nuevo en un momento.' })
      return
    }
    if (data?.length > 0) {
      setSubdomError({ enc, mensaje: `El subdominio "${enc.subdominio}" ya lo está usando otra encuesta. Cambialo antes de publicar.` })
      return
    }
    setConfirmarPublicar(enc)
  }

  function irAEditarSubdominio(enc) {
    setSubdomError(null)
    navigate(`/superadmin/encuestas-online/${enc.id}`)
  }

  // Cerrar una encuesta publicada (a mano o porque el cron la venció) libera
  // el subdominio para que otra encuesta lo pueda reusar — por eso también
  // pide confirmación, igual que publicar.
  const [confirmarCerrar, setConfirmarCerrar] = useState(null) // enc

  function pedirCerrar(enc) {
    setConfirmarCerrar(enc)
  }

  async function moveEncuesta(id, nuevoEstado, extra = {}) {
    const anterior = encuestas.find(e => e.id === id)

    setEncuestas(prev => prev.map(e => e.id === id ? { ...e, estado_produccion: nuevoEstado, ...extra } : e))
    setDraggingId(null)

    const { error } = await supabase
      .from('encuestas')
      .update({ estado_produccion: nuevoEstado, ...extra })
      .eq('id', id)

    if (error) {
      console.error('Error al actualizar estado:', error)
      setEncuestas(prev => prev.map(e => e.id === id ? anterior : e))
    }
  }

  function onDragStart(e, enc) { setDraggingId(enc.id); e.dataTransfer.effectAllowed = 'move' }
  function onDragEnd() { setDraggingId(null); setDragOver(null) }
  function onDragOver(e, key) { e.preventDefault(); setDragOver(key) }
  function onDrop(e, key) {
    e.preventDefault()
    const enc = encuestas.find(e => e.id === draggingId)
    setDraggingId(null)
    setDragOver(null)
    if (!enc || enc.estado_produccion === key) return
    if (key === 'publicada') pedirPublicar(enc)
    else if (key === 'completada') pedirCerrar(enc)
    else moveEncuesta(enc.id, key)
  }

  const encuestasFiltradas = encuestas.filter(e => {
    const matchBusq = !busqueda || e.nombre.toLowerCase().includes(busqueda.toLowerCase())
    const matchOrg  = !filtroOrg || e.organizacion_id === filtroOrg
    return matchBusq && matchOrg
  })

  const byEstado = key => encuestasFiltradas.filter(e => e.estado_produccion === key)

  return (
    <div className="sa-page">
      <div className="sa-topbar">
        <div className="sa-topbar-left">
          <div className="sa-eyebrow">Superadmin</div>
          <h1 className="sa-title">Encuestas online</h1>
        </div>
        <button
          onClick={() => navigate('/superadmin/encuestas-online/nueva')}
          style={{ padding: '10px 20px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r)', cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: 'DM Sans' }}>
          + Nueva encuesta online
        </button>
      </div>

      <div className="sa-content">
        {/* Filtros */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <input
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre..."
              style={{ width: '100%', padding: '8px 12px 8px 32px', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 13, fontFamily: 'DM Sans', background: 'var(--surface)', color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }}
            />
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink3)', fontSize: 13, pointerEvents: 'none' }}>🔍</span>
            {busqueda && (
              <button onClick={() => setBusqueda('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink3)', fontSize: 16, lineHeight: 1 }}>×</button>
            )}
          </div>
          <select
            value={filtroOrg}
            onChange={e => setFiltroOrg(e.target.value)}
            style={{ padding: '8px 12px', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 13, fontFamily: 'DM Sans', background: 'var(--surface)', color: 'var(--ink)', outline: 'none', minWidth: 200 }}>
            <option value="">Todas las organizaciones</option>
            {[...organizaciones].sort((a,b) => (a.nombre || '').localeCompare(b.nombre || '', 'es')).map(o => (
              <option key={o.id} value={o.id}>{o.nombre}</option>
            ))}
          </select>
          {(busqueda || filtroOrg) && (
            <button onClick={() => { setBusqueda(''); setFiltroOrg('') }}
              style={{ padding: '8px 14px', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 13, fontFamily: 'DM Sans', background: 'var(--surface)', color: 'var(--ink3)', cursor: 'pointer' }}>
              Limpiar
            </button>
          )}
          {(busqueda || filtroOrg) && (
            <span style={{ fontSize: 12, color: 'var(--ink3)', alignSelf: 'center' }}>
              {encuestasFiltradas.length} de {encuestas.length} encuestas
            </span>
          )}
        </div>

        {loading ? <Spinner center size="lg" /> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, alignItems: 'start' }}>
            {COLS.map(col => (
              <div
                key={col.key}
                onDragOver={e => onDragOver(e, col.key)}
                onDrop={e => onDrop(e, col.key)}
                style={{
                  background: dragOver === col.key ? col.bg : 'var(--surface)',
                  borderRadius: 'var(--r2)',
                  border: `2px dashed ${dragOver === col.key ? col.border : 'transparent'}`,
                  transition: 'all .15s',
                  minHeight: 120,
                }}
              >
                <div style={{ padding: '12px 12px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{ width: 9, height: 9, borderRadius: '50%', background: col.color }} />
                    <span style={{ fontFamily: 'Syne', fontSize: 12, fontWeight: 700, color: col.color }}>{col.label}</span>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--ink3)', fontWeight: 700, background: '#fff', padding: '1px 8px', borderRadius: 100 }}>
                    {byEstado(col.key).length}
                  </span>
                </div>
                <div style={{ padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {byEstado(col.key).map(enc => (
                    <KanbanCard
                      key={enc.id}
                      enc={enc}
                      isDragging={draggingId === enc.id}
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
                      onMove={(id, nuevoEstado) => {
                        if (nuevoEstado === 'publicada') pedirPublicar(enc)
                        else if (nuevoEstado === 'completada') pedirCerrar(enc)
                        else moveEncuesta(id, nuevoEstado)
                      }}
                      onClick={() => navigate(`/superadmin/encuestas-online/${enc.id}`)}
                    />
                  ))}
                  {byEstado(col.key).length === 0 && (
                    <div style={{ textAlign: 'center', padding: '20px 8px', color: 'var(--ink3)', fontSize: 12 }}>
                      Sin encuestas
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {subdomChequeo && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.15)', display: 'grid', placeItems: 'center', zIndex: 50 }}>
          <div style={{ background: '#fff', borderRadius: 'var(--r2)', padding: '20px 28px', fontSize: 13, color: 'var(--ink2)' }}>
            Verificando subdominio...
          </div>
        </div>
      )}

      {subdomError && (
        <ConfirmDialog
          icon="⚠️"
          title="No se puede publicar"
          message={subdomError.mensaje}
          confirmLabel="Editar encuesta"
          cancelLabel="Cerrar"
          onConfirm={() => irAEditarSubdominio(subdomError.enc)}
          onCancel={() => setSubdomError(null)}
        />
      )}

      {confirmarPublicar && (
        <ConfirmDialog
          icon="🌐"
          title="Publicar encuesta online"
          message={`Va a quedar disponible públicamente en https://${confirmarPublicar.subdominio}.metr1ka.com — cualquiera con el link va a poder responderla. ¿Confirmás?`}
          confirmLabel="Publicar"
          cancelLabel="Cancelar"
          danger={false}
          onConfirm={() => { moveEncuesta(confirmarPublicar.id, 'publicada'); setConfirmarPublicar(null) }}
          onCancel={() => setConfirmarPublicar(null)}
        />
      )}

      {confirmarCerrar && (
        <ConfirmDialog
          icon="🔒"
          title="Cerrar encuesta online"
          message={
            confirmarCerrar.subdominio
              ? `Se deja de poder responder en https://${confirmarCerrar.subdominio}.metr1ka.com y ese subdominio queda libre para usarlo en otra encuesta. Las respuestas ya recibidas se conservan. ¿Confirmás?`
              : 'Se deja de poder responder esta encuesta. Las respuestas ya recibidas se conservan. ¿Confirmás?'
          }
          confirmLabel="Cerrar encuesta"
          cancelLabel="Cancelar"
          onConfirm={() => { moveEncuesta(confirmarCerrar.id, 'completada', { subdominio: null }); setConfirmarCerrar(null) }}
          onCancel={() => setConfirmarCerrar(null)}
        />
      )}
    </div>
  )
}

function KanbanCard({ enc, isDragging, onDragStart, onDragEnd, onMove, onClick }) {
  const pasos = PASOS[enc.estado_produccion] || []
  const esPendiente = enc.estado_produccion === 'pendiente'

  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, enc)}
      onDragEnd={onDragEnd}
      onClick={onClick}
      style={{
        background: '#fff',
        border: `1px solid ${esPendiente ? '#fcd34d' : 'var(--border)'}`,
        borderRadius: 'var(--r)',
        padding: 12,
        cursor: isDragging ? 'grabbing' : 'grab',
        opacity: isDragging ? .3 : 1,
        transition: 'opacity .1s, box-shadow .15s',
        boxShadow: isDragging ? 'none' : '0 1px 3px rgba(0,0,0,.06)',
        userSelect: 'none',
      }}
    >
      {esPendiente && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
          <span style={{ fontSize: 9, fontWeight: 800, background: '#fef3c7', color: '#b45309', padding: '2px 7px', borderRadius: 100, letterSpacing: .5, textTransform: 'uppercase' }}>
            Nueva solicitud
          </span>
        </div>
      )}
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, lineHeight: 1.3 }}>{enc.nombre}</div>
      {enc.org && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: enc.org.color_primario || 'var(--accent)', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{enc.org.nombre}</span>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
        <span style={{ fontSize: 11 }}>🌐</span>
        {enc.subdominio ? (
          <span style={{ fontSize: 11, color: 'var(--accent2)', fontFamily: 'DM Mono, monospace' }}>{enc.subdominio}.metr1ka.com</span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--ink3)', fontStyle: 'italic' }}>Sin subdominio asignado</span>
        )}
      </div>
      {(enc.publicar_desde || enc.publicar_hasta) && (
        <div style={{ fontSize: 10, color: 'var(--ink3)', marginBottom: 6 }}>
          ⏱ {enc.publicar_desde ? new Date(enc.publicar_desde).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'sin inicio'}
          {' → '}
          {enc.publicar_hasta ? new Date(enc.publicar_hasta).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'sin cierre'}
        </div>
      )}
      {enc.descripcion && (
        <div style={{ fontSize: 11, color: 'var(--ink2)', marginBottom: 8, lineHeight: 1.4 }}>
          {enc.descripcion.length > 70 ? enc.descripcion.substring(0, 70) + '…' : enc.descripcion}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: 'var(--ink3)' }}>{new Date(enc.creado_en).toLocaleDateString('es-AR')}</span>
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
        {pasos.map(paso => {
          const dest = COLS.find(c => c.key === paso)
          if (!dest) return null
          return (
            <button key={paso} onClick={() => onMove(enc.id, paso)} style={{
              padding: '4px 9px', background: dest.bg, color: dest.color,
              border: `1px solid ${dest.border}`, borderRadius: 6,
              fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Sans',
            }}>
              {paso === 'para_revisar' ? '📤 Enviar a revisión' :
               paso === 'publicada'    ? '✓ Publicar'          :
               paso === 'en_proceso'   ? '▶ Tomar'             :
               paso === 'pendiente'    ? '↩ Devolver'          : `→ ${dest.label}`}
            </button>
          )
        })}
      </div>
    </div>
  )
}
