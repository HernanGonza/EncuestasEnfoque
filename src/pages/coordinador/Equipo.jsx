import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Topbar } from '../../components/layout'
import { Spinner } from '../../components/ui'
import styles from '../admin/Page.module.css'
import MensajeModal from '../../components/MensajeModal'

function esActivo(actualizado_en) {
  if (!actualizado_en) return false
  return (Date.now() - new Date(actualizado_en).getTime()) < 5 * 60 * 1000
}

function SelectorEquipo({ equipos, equipoId, onChange }) {
  if (equipos.length <= 1) return null
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
      {equipos.map(eq => (
        <button key={eq.id} onClick={() => onChange(eq.id)}
          style={{ padding: '6px 16px', borderRadius: 100, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans', border: '1.5px solid', transition: 'all .15s',
            background: equipoId === eq.id ? 'var(--accent)' : 'var(--paper)',
            color: equipoId === eq.id ? '#fff' : 'var(--ink3)',
            borderColor: equipoId === eq.id ? 'var(--accent)' : 'var(--border2)', }}>
          {eq.nombre}
        </button>
      ))}
    </div>
  )
}

function InfoRow({ label, value }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 13 }}>
      <span style={{ color: 'var(--ink3)', minWidth: 90 }}>{label}</span>
      <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{value}</span>
    </div>
  )
}

export default function EquipoCoord() {
  const { perfil }   = useAuth()
  const [equipos,    setEquipos]    = useState([])
  const [equipoId,   setEquipoId]   = useState(null)
  const [equipo,     setEquipo]     = useState(null)
  const [encuestadores, setEncuestadores] = useState([])
  const [loading,    setLoading]    = useState(true)
  const [expandido,  setExpandido]  = useState(null)
  const [tiempos,    setTiempos]    = useState({}) // { [encuestador_id]: { promedio_segundos, total_completadas } }
  const [showMensajeEquipo, setShowMensajeEquipo] = useState(false)
  const [mensajeando, setMensajeando] = useState(null) // encuestador puntual

  // Cargar todos los equipos del coordinador
  useEffect(() => {
    if (!perfil?.id) return
    supabase.from('equipo_coordinadores')
      .select('equipo_id, equipos(id, nombre, geofencing_activo)')
      .eq('coordinador_id', perfil.id)
      .then(({ data: ecs }) => {
        const eqs = (ecs || []).map(ec => ec.equipos).filter(Boolean)
        setEquipos(eqs)
        if (eqs.length) { setEquipoId(eqs[0].id); setEquipo(eqs[0]) }
        else setLoading(false)
      })
  }, [perfil?.id])

  // Cargar encuestadores del equipo seleccionado
  useEffect(() => {
    if (!equipoId) return
    setLoading(true)
    setExpandido(null)
    setEquipo(equipos.find(e => e.id === equipoId) || null)

    async function load() {
      const { data: encs } = await supabase
        .from('equipo_encuestadores')
        .select('encuestador_id, perfiles(id, nombre_completo, telefono, dni, localidad, provincia, activo, creado_en)')
        .eq('equipo_id', equipoId)

      // Stats por encuestador
      const ids = (encs || []).map(e => e.encuestador_id)
      let stats = {}
      if (ids.length) {
        const { data: asg } = await supabase
          .from('asignaciones_encuesta').select('id, encuestador_id')
          .in('encuestador_id', ids)
        if (asg?.length) {
          const { data: ses } = await supabase
            .from('sesiones_respuesta').select('asignacion_id, completada_en')
            .in('asignacion_id', asg.map(a => a.id))
          const asgMap = Object.fromEntries(asg.map(a => [a.id, a.encuestador_id]))
          ;(ses || []).forEach(s => {
            const eid = asgMap[s.asignacion_id]
            if (!eid) return
            stats[eid] = stats[eid] || { total: 0, completadas: 0 }
            stats[eid].total++
            if (s.completada_en) stats[eid].completadas++
          })
        }
      }
      // Cargar ubicaciones de los encuestadores del equipo
      let ubicaciones = {}
      if (ids.length) {
        const { data: ubs } = await supabase
          .from('ubicaciones_encuestadores')
          .select('encuestador_id, lat, lng, actualizado_en')
          .in('encuestador_id', ids)
        ;(ubs || []).forEach(u => { ubicaciones[u.encuestador_id] = u })
      }

      // Tiempo promedio por encuestador — get_stats_tiempos_encuestadores
      // devuelve todo el promedio de la organización (security definer,
      // scoped por mi_rol()); acá solo nos quedamos con los IDs del equipo.
      if (perfil?.organizacion_id && ids.length) {
        const { data: tRes } = await supabase.rpc('get_stats_tiempos_encuestadores', {
          p_organizacion_id: perfil.organizacion_id,
        })
        const t = {}
        for (const row of tRes || []) {
          if (ids.includes(row.encuestador_id)) t[row.encuestador_id] = row
        }
        setTiempos(t)
      } else {
        setTiempos({})
      }

      setEncuestadores((encs || []).map(e => ({
        ...e,
        stats: stats[e.encuestador_id] || { total: 0, completadas: 0 },
        ubicacion: ubicaciones[e.encuestador_id] || null,
      })))
      setLoading(false)
    }
    load()
  }, [equipoId])

  const activos   = encuestadores.filter(e => e.perfiles?.activo !== false)
  const inactivos = encuestadores.filter(e => e.perfiles?.activo === false)

  return (
    <div className={styles.page}>
      <Topbar title="Mi equipo" />
      <div className={styles.content}>

        <SelectorEquipo equipos={equipos} equipoId={equipoId} onChange={setEquipoId} />

        {/* Header del equipo */}
        {equipo && (
          <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', padding: '16px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink3)', marginBottom: 3 }}>Equipo seleccionado</div>
              <div style={{ fontFamily: 'Syne', fontSize: 20, fontWeight: 800, color: 'var(--ink)' }}>{equipo.nombre}</div>
            </div>
            {!loading && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button onClick={() => setShowMensajeEquipo(true)} style={{ padding: '8px 14px', background: 'none', color: 'var(--ink3)', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans' }}>
                  📢 Mensaje al equipo
                </button>
                <div style={{ textAlign: 'center', padding: '8px 14px', background: 'var(--accent-light)', borderRadius: 'var(--r)' }}>
                  <div style={{ fontFamily: 'Syne', fontSize: 22, fontWeight: 800, color: 'var(--accent)' }}>{activos.length}</div>
                  <div style={{ fontSize: 10, color: 'var(--accent2)', fontWeight: 600 }}>Activos</div>
                </div>
                <div style={{ textAlign: 'center', padding: '8px 14px', background: 'var(--surface)', borderRadius: 'var(--r)' }}>
                  <div style={{ fontFamily: 'Syne', fontSize: 22, fontWeight: 800, color: 'var(--ink3)' }}>{inactivos.length}</div>
                  <div style={{ fontSize: 10, color: 'var(--ink3)', fontWeight: 600 }}>Inactivos</div>
                </div>
              </div>
            )}
          </div>
        )}

        {showMensajeEquipo && (
          <MensajeModal
            perfil={perfil}
            equipos={equipos}
            presetEquipoId={equipoId}
            encuestadores={activos.map(e => ({ id: e.encuestador_id, nombre_completo: e.perfiles?.nombre_completo }))}
            onClose={() => setShowMensajeEquipo(false)}
          />
        )}
        {mensajeando && (
          <MensajeModal
            perfil={perfil}
            presetEncuestador={{ id: mensajeando.encuestador_id, nombre_completo: mensajeando.perfiles?.nombre_completo }}
            onClose={() => setMensajeando(null)}
          />
        )}

        {loading && <Spinner center size="lg" />}

        {!loading && encuestadores.length === 0 && (
          <div className={styles.empty}><p>No hay encuestadores en este equipo todavía.</p></div>
        )}

        {!loading && activos.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink3)', marginBottom: 10 }}>
              Activos — {activos.length}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {activos.map((e, i) => {
                const p = e.perfiles
                const isOpen = expandido === e.encuestador_id
                const ini = (p?.nombre_completo || '?').split(' ').slice(0,2).map(n=>n[0]).join('').toUpperCase()
                return (
                  <div key={i} style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', overflow: 'hidden' }}>
                    <div onClick={() => setExpandido(isOpen ? null : e.encuestador_id)}
                      style={{ padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                      <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--accent-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: 'var(--accent2)', flexShrink: 0 }}>
                        {ini}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{p?.nombre_completo || '—'}</div>
                        <div style={{ fontSize: 12, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                          {e.ubicacion ? (
                            esActivo(e.ubicacion.actualizado_en) ? (
                              <span style={{ color: '#16a34a', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16a34a', display: 'inline-block', boxShadow: '0 0 0 2px rgba(22,163,74,.2)' }} />
                                En campo ahora
                              </span>
                            ) : (
                              <span style={{ color: 'var(--ink3)' }}>
                                Última vez hace {Math.floor((Date.now() - new Date(e.ubicacion.actualizado_en).getTime()) / 60000)} min
                              </span>
                            )
                          ) : (
                            <span style={{ color: 'var(--ink3)' }}>
                              {p?.localidad ? `${p.localidad}${p.provincia ? `, ${p.provincia}` : ''}` : 'Sin ubicación registrada'}
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', marginRight: 8 }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent)', fontFamily: 'Syne' }}>{e.stats.completadas}</div>
                        <div style={{ fontSize: 10, color: 'var(--ink3)' }}>encuestas</div>
                      </div>
                      <div style={{ fontSize: 14, color: 'var(--ink3)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>▾</div>
                    </div>
                    {isOpen && (
                      <div style={{ padding: '12px 16px 14px', borderTop: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <InfoRow label="Teléfono" value={p?.telefono} />
                        <InfoRow label="DNI" value={p?.dni} />
                        <InfoRow label="Localidad" value={p?.localidad} />
                        <InfoRow label="Provincia" value={p?.provincia} />
                        <InfoRow label="Alta en sistema" value={p?.creado_en ? new Date(p.creado_en).toLocaleDateString('es-AR') : null} />
                        {tiempos[e.encuestador_id]?.promedio_segundos != null && (
                          <InfoRow label="Tiempo prom." value={`${Math.floor(tiempos[e.encuestador_id].promedio_segundos / 60)}m ${Math.round(tiempos[e.encuestador_id].promedio_segundos % 60)}s`} />
                        )}
                        <div style={{ marginTop: 8, display: 'flex', gap: 12, padding: '10px 12px', background: 'var(--paper)', borderRadius: 'var(--r)' }}>
                          {[
                            { v: e.stats.completadas, l: 'Completadas', c: 'var(--accent)' },
                            { v: e.stats.total - e.stats.completadas, l: 'En curso', c: 'var(--ink2)' },
                          ].map((s, si) => (
                            <div key={si}>
                              <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'Syne', color: s.c }}>{s.v}</div>
                              <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{s.l}</div>
                            </div>
                          ))}
                        </div>
                        <button
                          onClick={(ev) => { ev.stopPropagation(); setMensajeando(e) }}
                          style={{ marginTop: 4, alignSelf: 'flex-start', padding: '6px 12px', background: 'none', color: 'var(--ink3)', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans' }}
                        >
                          📢 Enviar mensaje
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {!loading && inactivos.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink3)', marginBottom: 10 }}>
              Inactivos — {inactivos.length}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {inactivos.map((e, i) => {
                const ini = (e.perfiles?.nombre_completo || '?').split(' ').slice(0,2).map(n=>n[0]).join('').toUpperCase()
                return (
                  <div key={i} style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 12, opacity: 0.55 }}>
                    <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: 'var(--ink3)', flexShrink: 0 }}>{ini}</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{e.perfiles?.nombre_completo || '—'}</div>
                      <div style={{ fontSize: 12, color: 'var(--ink3)' }}>Inactivo</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}