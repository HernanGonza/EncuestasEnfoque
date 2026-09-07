import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Topbar } from '../../components/layout'
import { Spinner } from '../../components/ui'
import MensajeModal from '../../components/MensajeModal'
import styles from './Page.module.css'

function InviteModal({ onClose, onSaved, orgId, session }) {
  const [email, setEmail]   = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim()) { setError('El email es obligatorio'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch('https://zjphrjcpkzlmdpqhjypq.supabase.co/functions/v1/invite-member', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ email, rol: 'encuestador' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error al invitar')
      onSaved(); onClose()
    } catch (err) { setError(err.message) }
    setSaving(false)
  }

  return (
    <div className={styles.modal}>
      <div className={styles.modalContent}>
        <div className={styles.modalHeader}>
          <h3>Invitar encuestador</h3>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit} className={styles.modalBody}>
          <div className={styles.formGroup}>
            <label>Email del encuestador *</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="encuestador@email.com" required />
          </div>
          <div style={{ padding: '10px 14px', background: 'var(--surface)', borderRadius: 'var(--r)', fontSize: 13, color: 'var(--ink3)' }}>
            Le llegará un email para completar su registro. Podrá usar la app móvil una vez registrado.
          </div>
          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.modalActions}>
            <button type="button" onClick={onClose} disabled={saving}>Cancelar</button>
            <button type="submit" disabled={saving}>{saving ? 'Invitando...' : 'Enviar invitación'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AsignarEquipoModal({ encuestador, equipos, equipoActual, onClose, onSaved }) {
  const [selected, setSelected] = useState(equipoActual || '')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  async function handleSave() {
    setSaving(true); setError('')
    try {
      // Antes no se revisaba `error` acá: si el delete/insert fallaba (RLS,
      // unique constraint, etc.) el modal igual cerraba como éxito y el
      // encuestador quedaba sin equipo asignado, sin ningún aviso — el mismo
      // tipo de falla silenciosa que causó la crisis de esta noche, pero acá
      // en el paso de asignar el equipo en vez de la zona.
      if (equipoActual) {
        const { error: delError } = await supabase
          .from('equipo_encuestadores')
          .delete()
          .eq('encuestador_id', encuestador.id)
        if (delError) throw delError
      }
      if (selected) {
        const { error: insError } = await supabase
          .from('equipo_encuestadores')
          .insert({ encuestador_id: encuestador.id, equipo_id: selected })
        if (insError) throw insError
      }
      onSaved(); onClose()
    } catch (err) { setError(err.message) }
    setSaving(false)
  }

  return (
    <div className={styles.modal}>
      <div className={styles.modalContent}>
        <div className={styles.modalHeader}>
          <h3>Asignar equipo — {encuestador.nombre_completo}</h3>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        <div className={styles.modalBody}>
          <p style={{ fontSize: 13, color: 'var(--ink3)', margin: 0 }}>Un encuestador solo puede pertenecer a un equipo a la vez.</p>
          <div className={styles.formGroup}>
            <label>Equipo</label>
            <select value={selected} onChange={e => setSelected(e.target.value)} className={styles.select}>
              <option value="">Sin equipo</option>
              {equipos.map(eq => <option key={eq.id} value={eq.id}>{eq.nombre}</option>)}
            </select>
          </div>
          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.modalActions}>
            <button onClick={onClose} disabled={saving}>Cancelar</button>
            <button onClick={handleSave} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function DesactivarModal({ encuestador, onClose, onSaved }) {
  const RAZONES = [
    'Bajo rendimiento',
    'Incumplimiento de protocolo',
    'Problemas de conducta',
    'Finalización de contrato',
    'Solicitud del encuestador',
    'Otra razón',
  ]
  const [razon,   setRazon]   = useState('')
  const [detalle, setDetalle] = useState('')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  async function handleSave() {
    if (!razon) { setError('Seleccioná una razón'); return }
    setSaving(true); setError('')
    try {
      const motivo = detalle.trim() ? `${razon}: ${detalle.trim()}` : razon
      await supabase.from('perfiles').update({
        activo: false,
        motivo_desactivacion: motivo,
        desactivado_en: new Date().toISOString(),
      }).eq('id', encuestador.id)
      onSaved(); onClose()
    } catch (err) { setError(err.message) }
    setSaving(false)
  }

  return (
    <div className={styles.modal}>
      <div className={styles.modalContent}>
        <div className={styles.modalHeader}>
          <h3>Desactivar — {encuestador.nombre_completo}</h3>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        <div className={styles.modalBody}>
          <div style={{ padding: '10px 14px', background: 'var(--danger-light)', border: '1px solid var(--danger)', borderRadius: 'var(--r)', fontSize: 13, color: 'var(--danger)', marginBottom: 8 }}>
            El encuestador verá un aviso en su app móvil con la razón de desactivación.
          </div>
          <div className={styles.formGroup}>
            <label>Razón *</label>
            <select value={razon} onChange={e => setRazon(e.target.value)} className={styles.select}>
              <option value="">Seleccioná una razón</option>
              {RAZONES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className={styles.formGroup}>
            <label>Detalle adicional (opcional)</label>
            <textarea
              value={detalle}
              onChange={e => setDetalle(e.target.value)}
              placeholder="Agregá más contexto si lo necesitás..."
              rows={3}
              style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 13, fontFamily: 'DM Sans', resize: 'vertical', boxSizing: 'border-box' }}
            />
          </div>
          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.modalActions}>
            <button onClick={onClose} disabled={saving}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}>
              {saving ? 'Desactivando...' : 'Desactivar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const COLORS      = ['#d8f3dc','var(--info-light)','var(--warning-light)','rgba(124,58,237,0.1)','#fce7f3','var(--accent-light)']
const TEXT_COLORS = ['#1a472a','#0369a1','#b45309','#7c3aed','#be185d','#047857']
const initials    = (n) => (n || '').split(' ').slice(0,2).map(x => x[0]).join('').toUpperCase()

export default function Encuestadores() {
  const { perfil } = useAuth()
  const [encuestadores, setEncuestadores] = useState([])
  const [equipos,       setEquipos]       = useState([])
  const [loading,       setLoading]       = useState(true)
  const [tab,           setTab]           = useState('activos')
  const [showInvite,    setShowInvite]    = useState(false)
  const [asignando,     setAsignando]     = useState(null)
  const [desactivando,  setDesactivando]  = useState(null)
  const [showMensaje,   setShowMensaje]   = useState(false)
  const [mensajeando,   setMensajeando]   = useState(null) // encuestador puntual
  const [session,       setSession]       = useState(null)
  const [busqueda,      setBusqueda]      = useState('')
  const [filtroEquipo,  setFiltroEquipo]  = useState('')
  const [tiemposPorEncuestador, setTiemposPorEncuestador] = useState({}) // { [encuestador_id]: { promedio_segundos, total_completadas } }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
  }, [])

  async function fetchData() {
    if (!perfil?.organizacion_id) return
    setLoading(true)
    const [eRes, eqRes, tRes] = await Promise.all([
      supabase.from('perfiles')
        .select('*, equipo_encuestadores(equipo_id, equipos(nombre))')
        .eq('rol', 'encuestador')
        .eq('organizacion_id', perfil.organizacion_id)
        .order('nombre_completo'),
      supabase.from('equipos').select('id, nombre').eq('organizacion_id', perfil.organizacion_id).order('nombre'),
      supabase.rpc('get_stats_tiempos_encuestadores', { p_organizacion_id: perfil.organizacion_id }),
    ])
    setEncuestadores(eRes.data || [])
    setEquipos(eqRes.data || [])
    const tiempos = {}
    for (const row of tRes.data || []) tiempos[row.encuestador_id] = row
    setTiemposPorEncuestador(tiempos)
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [perfil?.organizacion_id])

  async function activar(enc) {
    await supabase.from('perfiles').update({
      activo: true,
      motivo_desactivacion: null,
      desactivado_en: null,
    }).eq('id', enc.id)
    fetchData()
  }

  const activos   = encuestadores.filter(e => e.activo !== false)
  const inactivos = encuestadores.filter(e => e.activo === false)
  const sinEquipo = activos.filter(e => !e.equipo_encuestadores?.length).length

  const aplicarFiltros = (lista) => lista.filter(e => {
    const q = busqueda.toLowerCase()
    const matchNombre = !busqueda ||
      (e.nombre_completo || '').toLowerCase().includes(q) ||
      (e.email || '').toLowerCase().includes(q)
    const matchEquipo = !filtroEquipo ||
      (filtroEquipo === '__sin__' && !e.equipo_encuestadores?.length) ||
      e.equipo_encuestadores?.[0]?.equipo_id === filtroEquipo
    return matchNombre && matchEquipo
  })

  const lista         = aplicarFiltros(tab === 'activos' ? activos : inactivos)
  const hayFiltros    = busqueda || filtroEquipo
  const inp = { padding: '7px 10px', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 13, fontFamily: 'DM Sans', background: 'var(--paper)' }

  return (
    <div className={styles.page}>
      <Topbar
        title="Encuestadores"
        action={{ label: '+ Invitar', onClick: () => setShowInvite(true) }}
        actions={
          <button onClick={() => setShowMensaje(true)} style={{ padding: '8px 16px', background: 'var(--accent-light)', color: 'var(--accent2)', border: '1.5px solid var(--accent2)', borderRadius: 'var(--r)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans' }}>
            📢 Mensaje
          </button>
        }
      />

      {showInvite && session && (
        <InviteModal orgId={perfil?.organizacion_id} session={session} onClose={() => setShowInvite(false)} onSaved={() => { setShowInvite(false); fetchData() }} />
      )}
      {showMensaje && (
        <MensajeModal
          perfil={perfil}
          equipos={equipos}
          encuestadores={activos.map(e => ({ id: e.id, nombre_completo: e.nombre_completo }))}
          onClose={() => setShowMensaje(false)}
        />
      )}
      {mensajeando && (
        <MensajeModal
          perfil={perfil}
          presetEncuestador={{ id: mensajeando.id, nombre_completo: mensajeando.nombre_completo }}
          onClose={() => setMensajeando(null)}
        />
      )}
      {asignando && (
        <AsignarEquipoModal
          encuestador={asignando}
          equipos={equipos}
          equipoActual={asignando.equipo_encuestadores?.[0]?.equipo_id || ''}
          onClose={() => setAsignando(null)}
          onSaved={() => { setAsignando(null); fetchData() }}
        />
      )}
      {desactivando && (
        <DesactivarModal
          encuestador={desactivando}
          onClose={() => setDesactivando(null)}
          onSaved={() => { setDesactivando(null); fetchData() }}
        />
      )}

      <div className={styles.content}>

        {/* Stats */}
        {encuestadores.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Total',      value: encuestadores.length, color: 'var(--accent)',  bg: 'var(--accent-light)' },
              { label: 'Activos',    value: activos.length,       color: '#0369a1',        bg: 'var(--info-light)' },
              { label: 'Inactivos',  value: inactivos.length,     color: inactivos.length > 0 ? 'var(--danger)' : 'var(--accent)', bg: inactivos.length > 0 ? 'var(--danger-light)' : 'var(--accent-light)' },
              { label: 'Sin equipo', value: sinEquipo,             color: sinEquipo > 0 ? '#b45309' : 'var(--accent)', bg: sinEquipo > 0 ? 'var(--warning-light)' : 'var(--accent-light)' },
            ].map((s, i) => (
              <div key={i} style={{ background: s.bg, borderRadius: 'var(--r2)', padding: '14px 18px' }}>
                <div style={{ fontFamily: 'Syne', fontSize: 26, fontWeight: 800, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 12, color: s.color, fontWeight: 500, marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filtros */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 180, position: 'relative' }}>
            <input
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre o email..."
              style={{ ...inp, width: '100%', paddingLeft: 32, boxSizing: 'border-box' }}
            />
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink3)', fontSize: 13, pointerEvents: 'none' }}>🔍</span>
            {busqueda && (
              <button onClick={() => setBusqueda('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink3)', fontSize: 16, lineHeight: 1 }}>×</button>
            )}
          </div>
          <select value={filtroEquipo} onChange={e => setFiltroEquipo(e.target.value)} style={{ ...inp, minWidth: 160 }}>
            <option value="">Todos los equipos</option>
            {equipos.map(eq => <option key={eq.id} value={eq.id}>{eq.nombre}</option>)}
            <option value="__sin__">⚠ Sin equipo</option>
          </select>
          {hayFiltros && (
            <button onClick={() => { setBusqueda(''); setFiltroEquipo('') }} style={{ ...inp, cursor: 'pointer', color: 'var(--ink3)' }}>
              Limpiar
            </button>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
          {[['activos', `Activos (${activos.length})`], ['inactivos', `Desactivados (${inactivos.length})`]].map(([v, label]) => (
            <button key={v} onClick={() => setTab(v)} style={{
              padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 13, fontFamily: 'DM Sans', marginBottom: -1,
              fontWeight: tab === v ? 700 : 400,
              color: tab === v ? 'var(--accent)' : 'var(--ink3)',
              borderBottom: tab === v ? '2px solid var(--accent)' : '2px solid transparent',
            }}>{label}</button>
          ))}
        </div>

        {hayFiltros && !loading && (
          <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 8 }}>
            {lista.length} resultado{lista.length !== 1 ? 's' : ''} encontrado{lista.length !== 1 ? 's' : ''}
          </div>
        )}

        {loading ? <Spinner center size="lg" /> : (
          lista.length === 0 ? (
            <div className={styles.empty}>
              {hayFiltros
                ? <p>No hay encuestadores que coincidan con los filtros.</p>
                : tab === 'activos'
                  ? <><p>No hay encuestadores activos.</p><button onClick={() => setShowInvite(true)} style={{ padding: '10px 20px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r)', cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: 'DM Sans' }}>Invitar primer encuestador</button></>
                  : <p>No hay encuestadores desactivados.</p>
              }
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {lista.map((enc, i) => {
                const ci = i % COLORS.length
                const equipoNombre = enc.equipo_encuestadores?.[0]?.equipos?.nombre
                const tiempo = tiemposPorEncuestador[enc.id]
                return (
                  <div key={enc.id} style={{ background: 'var(--paper)', border: `1px solid ${tab === 'inactivos' ? '#fca5a5' : 'var(--border)'}`, borderRadius: 'var(--r2)', padding: '14px 18px', display: 'flex', alignItems: 'flex-start', gap: 12, opacity: tab === 'inactivos' ? 0.85 : 1 }}>
                    <div style={{ width: 38, height: 38, borderRadius: '50%', background: COLORS[ci], color: TEXT_COLORS[ci], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                      {initials(enc.nombre_completo)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{enc.nombre_completo || 'Sin nombre'}</div>
                      <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 1 }}>{enc.email || '—'}</div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                        {tab === 'activos' && (equipoNombre
                          ? <span style={{ padding: '2px 8px', borderRadius: 100, fontSize: 11, fontWeight: 600, background: 'var(--accent-light)', color: 'var(--accent2)' }}>{equipoNombre}</span>
                          : <span style={{ padding: '2px 8px', borderRadius: 100, fontSize: 11, background: 'var(--warning-light)', color: '#b45309', fontWeight: 600 }}>⚠ Sin equipo</span>
                        )}
                        {tab === 'activos' && tiempo?.promedio_segundos != null && (
                          <span style={{ padding: '2px 8px', borderRadius: 100, fontSize: 11, fontWeight: 600, background: 'var(--surface)', color: 'var(--ink3)' }}>
                            ⏱️ {Math.floor(tiempo.promedio_segundos / 60)}m {Math.round(tiempo.promedio_segundos % 60)}s prom. ({tiempo.total_completadas})
                          </span>
                        )}
                      </div>
                      {tab === 'inactivos' && enc.motivo_desactivacion && (
                        <div style={{ marginTop: 6, padding: '6px 10px', background: 'var(--danger-light)', borderRadius: 'var(--r)', fontSize: 12, color: 'var(--danger)' }}>
                          <span style={{ fontWeight: 700 }}>Razón: </span>{enc.motivo_desactivacion}
                          {enc.desactivado_en && <span style={{ color: 'var(--ink3)', marginLeft: 8 }}>{new Date(enc.desactivado_en).toLocaleDateString('es-AR')}</span>}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      {tab === 'activos' ? (
                        <>
                          <button onClick={() => setMensajeando(enc)} style={{ padding: '6px 12px', background: 'none', color: 'var(--ink3)', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans' }}>
                            📢 Mensaje
                          </button>
                          <button onClick={() => setAsignando(enc)} style={{ padding: '6px 12px', background: 'var(--accent-light)', color: 'var(--accent2)', border: '1.5px solid var(--accent2)', borderRadius: 'var(--r)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans' }}>
                            Equipo
                          </button>
                          <button onClick={() => setDesactivando(enc)} style={{ padding: '6px 12px', background: 'none', color: 'var(--danger)', border: '1.5px solid var(--danger)', borderRadius: 'var(--r)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans' }}>
                            Desactivar
                          </button>
                        </>
                      ) : (
                        <button onClick={() => activar(enc)} style={{ padding: '6px 12px', background: 'var(--accent-light)', color: 'var(--accent2)', border: '1.5px solid var(--accent2)', borderRadius: 'var(--r)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans' }}>
                          Reactivar
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>
    </div>
  )
}