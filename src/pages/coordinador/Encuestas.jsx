import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Topbar } from '../../components/layout'
import { Spinner } from '../../components/ui'
import SimuladorEncuesta from '../admin/SimuladorEncuesta'
import styles from '../admin/Page.module.css'

const ESTADO_CFG = {
  publicada:    { label: 'Publicada',    color: 'var(--accent)', bg: 'var(--accent-light)' },
  en_proceso:   { label: 'En proceso',   color: '#0369a1', bg: 'var(--info-light)' },
  para_revisar: { label: 'Para revisar', color: '#7c3aed', bg: 'rgba(124,58,237,0.1)' },
  pendiente:    { label: 'Pendiente',    color: '#b45309', bg: 'var(--warning-light)' },
}
const TIPO_CFG = {
  domiciliaria: { label: 'Domiciliaria', color: '#0369a1', bg: 'var(--info-light)' },
  callejera:    { label: 'Callejera',    color: '#047857', bg: 'var(--accent-light)' },
  telefonica:   { label: 'Telefónica',   color: '#7c3aed', bg: 'rgba(124,58,237,0.1)' },
  online:       { label: 'Online',       color: '#b45309', bg: 'var(--warning-light)' },
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

export default function EncuestasCoord() {
  const { perfil }  = useAuth()
  const [equipos,   setEquipos]   = useState([])
  const [equipoId,  setEquipoId]  = useState(null)
  const [encuestas, setEncuestas] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [simulando, setSimulando] = useState(null)
  const [detalle,   setDetalle]   = useState(null)
  const [tiempos,   setTiempos]   = useState({}) // { [encuesta_id]: { promedio_segundos, tiempo_objetivo_minutos } }

  // Cargar equipos
  useEffect(() => {
    if (!perfil?.id) return
    supabase.from('equipo_coordinadores')
      .select('equipo_id, equipos(id, nombre)')
      .eq('coordinador_id', perfil.id)
      .then(({ data: ecs }) => {
        const eqs = (ecs || []).map(ec => ec.equipos).filter(Boolean)
        setEquipos(eqs)
        if (eqs.length) setEquipoId(eqs[0].id)
        else setLoading(false)
      })
  }, [perfil?.id])

  // Cargar encuestas del equipo seleccionado
  useEffect(() => {
    if (!equipoId) return
    setLoading(true)
    setDetalle(null)

    async function load() {
      const { data: ees } = await supabase
        .from('encuestas_equipo')
        .select('id, encuesta_id, asignado_en, encuestas(id, nombre, descripcion, estado_produccion, activo, tipo_encuesta, fecha_inicio, fecha_fin, organizacion_id)')
        .eq('equipo_id', equipoId)

      // Contar preguntas por encuesta
      const encIds = (ees || []).map(e => e.encuesta_id)
      let pregsCount = {}
      if (encIds.length) {
        const { data: pregs } = await supabase
          .from('preguntas').select('encuesta_id').in('encuesta_id', encIds)
        ;(pregs || []).forEach(p => { pregsCount[p.encuesta_id] = (pregsCount[p.encuesta_id] || 0) + 1 })
      }

      // Respuestas completadas por encuesta del equipo
      let sesCompletadas = {}
      if (encIds.length) {
        const { data: encs } = await supabase
          .from('equipo_encuestadores').select('encuestador_id').eq('equipo_id', equipoId)
        const miembrosIds = (encs || []).map(e => e.encuestador_id)
        if (miembrosIds.length) {
          const { data: asg } = await supabase
            .from('asignaciones_encuesta').select('id, encuestador_id').in('encuestador_id', miembrosIds)
          if (asg?.length) {
            // Obtener sesiones completadas
            const { data: ses } = await supabase
              .from('sesiones_respuesta').select('asignacion_id')
              .in('asignacion_id', asg.map(a => a.id))
              .not('completada_en', 'is', null)
            // Total sin filtrar por encuesta específica (limitación sin join extra)
            const totalCompletas = (ses || []).length
            encIds.forEach(eid => { sesCompletadas[eid] = totalCompletas })
          }
        }
      }

      setEncuestas((ees || []).map(ee => ({
        ...ee,
        preguntas_count: pregsCount[ee.encuesta_id] || 0,
        completadas: sesCompletadas[ee.encuesta_id] || 0,
      })))
      setLoading(false)

      // Tiempo promedio vs. objetivo, por encuesta, scoped al equipo del
      // coordinador (mismo criterio de RRLS que el resto: get_resultados_
      // encuesta_filtrado es security definer + respeta mi_rol()).
      if (encIds.length) {
        const resultados = await Promise.all(
          encIds.map(eid => supabase.rpc('get_resultados_encuesta_filtrado', {
            p_encuesta_id: eid, p_equipo_id: equipoId,
          }).then(({ data }) => [eid, data]).catch(() => [eid, null])),
        )
        const t = {}
        resultados.forEach(([eid, data]) => {
          if (data) t[eid] = { promedio_segundos: data.promedio_segundos, tiempo_objetivo_minutos: data.tiempo_objetivo_minutos }
        })
        setTiempos(t)
      } else {
        setTiempos({})
      }
    }
    load()
  }, [equipoId])

  if (simulando) {
    return (
      <SimuladorEncuesta
        encuestaId={simulando.encuestaId}
        orgId={simulando.orgId}
        onClose={() => setSimulando(null)}
      />
    )
  }

  return (
    <div className={styles.page}>
      <Topbar title="Encuestas" />
      <div className={styles.content}>

        <SelectorEquipo equipos={equipos} equipoId={equipoId} onChange={setEquipoId} />

        {loading && <Spinner center size="lg" />}

        {!loading && encuestas.length === 0 && (
          <div className={styles.empty}>
            <p>No hay encuestas asignadas a este equipo todavía.</p>
            <p style={{ fontSize: 13 }}>Cuando el administrador asigne encuestas, aparecerán aquí.</p>
          </div>
        )}

        {!loading && encuestas.length > 0 && (
          <>
            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 20 }}>
              {[
                { label: 'Asignadas',  value: encuestas.length, color: 'var(--accent)', bg: 'var(--accent-light)' },
                { label: 'Publicadas', value: encuestas.filter(e => e.encuestas?.estado_produccion === 'publicada').length, color: '#0369a1', bg: 'var(--info-light)' },
                { label: 'Respuestas del equipo', value: encuestas[0]?.completadas || 0, color: '#7c3aed', bg: 'rgba(124,58,237,0.1)' },
              ].map((k, i) => (
                <div key={i} style={{ background: k.bg, borderRadius: 'var(--r2)', padding: '14px 16px' }}>
                  <div style={{ fontFamily: 'Syne', fontSize: 26, fontWeight: 800, color: k.color }}>{k.value}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: k.color, marginTop: 2 }}>{k.label}</div>
                </div>
              ))}
            </div>

            {/* Cards de encuestas */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {encuestas.map((ee, i) => {
                const enc = ee.encuestas
                if (!enc) return null
                const estadoCfg = ESTADO_CFG[enc.estado_produccion] || ESTADO_CFG.pendiente
                const tipoCfg   = TIPO_CFG[enc.tipo_encuesta] || TIPO_CFG.domiciliaria
                const isOpen    = detalle === ee.encuesta_id
                const publicada = enc.estado_produccion === 'publicada'
                const tiempo    = tiempos[ee.encuesta_id]
                const promedioSeg = tiempo?.promedio_segundos != null ? Number(tiempo.promedio_segundos) : null
                const objetivoMin = tiempo?.tiempo_objetivo_minutos ?? null
                const dentroObjetivo = promedioSeg != null && objetivoMin != null ? promedioSeg <= objetivoMin * 60 : null

                return (
                  <div key={i} className={`${styles.encuestaCard} ${publicada ? styles.encuestaCardPublicada : ''}`} style={{ cursor: 'default' }}>
                    <div className={styles.encuestaHeader}>
                      <h4>{enc.nombre}</h4>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <span style={{ padding: '3px 9px', borderRadius: 100, fontSize: 11, fontWeight: 700, background: tipoCfg.bg, color: tipoCfg.color }}>{tipoCfg.label}</span>
                        <span style={{ padding: '3px 9px', borderRadius: 100, fontSize: 11, fontWeight: 700, background: estadoCfg.bg, color: estadoCfg.color }}>{estadoCfg.label}</span>
                      </div>
                    </div>

                    {enc.descripcion && <p className={styles.encuestaDesc}>{enc.descripcion}</p>}

                    <div className={styles.encuestaMeta} style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                      <span>📋 {ee.preguntas_count} preguntas</span>
                      {enc.fecha_inicio && <span>📅 Desde {new Date(enc.fecha_inicio).toLocaleDateString('es-AR')}</span>}
                      {enc.fecha_fin && <span>⏳ Hasta {new Date(enc.fecha_fin).toLocaleDateString('es-AR')}</span>}
                      <span>🗓 Asignada {new Date(ee.asignado_en).toLocaleDateString('es-AR')}</span>
                      {promedioSeg != null && (
                        <span style={{ fontWeight: 600, color: objetivoMin == null ? 'var(--ink3)' : dentroObjetivo ? '#1a472a' : '#991b1b' }}>
                          ⏱️ {Math.floor(promedioSeg / 60)}m {Math.round(promedioSeg % 60)}s prom.
                          {objetivoMin != null && (dentroObjetivo ? ' 🟢' : ' 🔴')}
                        </span>
                      )}
                    </div>

                    <div className={styles.encuestaActions}>
                      <button
                        onClick={() => setSimulando({ encuestaId: enc.id, orgId: enc.organizacion_id })}
                        style={{ padding: '7px 16px', background: 'var(--ink)', color: '#fff', border: 'none', borderRadius: 'var(--r)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans', display: 'flex', alignItems: 'center', gap: 6 }}>
                        📱 Vista previa del cuestionario
                      </button>
                      <button
                        onClick={() => setDetalle(isOpen ? null : ee.encuesta_id)}
                        style={{ padding: '7px 14px', background: 'none', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 13, cursor: 'pointer', fontFamily: 'DM Sans', color: 'var(--ink3)' }}>
                        {isOpen ? 'Cerrar ▲' : 'Instrucciones ▾'}
                      </button>
                    </div>

                    {isOpen && (
                      <div style={{ marginTop: 14, padding: '16px', background: 'var(--surface)', borderRadius: 'var(--r)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, color: 'var(--ink2)' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink3)', marginBottom: 4 }}>Instrucciones de campo</div>
                        <div style={{ display: 'flex', gap: 8 }}><span>📋</span><span><b>{ee.preguntas_count} preguntas</b> en total</span></div>
                        <div style={{ display: 'flex', gap: 8 }}><span>📱</span><span>Modalidad <b>{tipoCfg.label}</b> — los encuestadores completan el formulario en la app móvil</span></div>
                        <div style={{ display: 'flex', gap: 8 }}><span>🗺</span><span>Las manzanas y parcelas asignadas a tu equipo están visibles en la app de campo</span></div>
                        {enc.fecha_inicio && <div style={{ display: 'flex', gap: 8 }}><span>📅</span><span><b>Inicio:</b> {new Date(enc.fecha_inicio).toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span></div>}
                        {enc.fecha_fin && <div style={{ display: 'flex', gap: 8 }}><span>⏳</span><span><b>Fecha límite:</b> {new Date(enc.fecha_fin).toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span></div>}
                        <div style={{ marginTop: 4, padding: '10px 14px', background: 'var(--accent-light)', borderRadius: 'var(--r)', color: 'var(--accent2)', fontWeight: 600, fontSize: 12 }}>
                          💡 Usá "Vista previa" para revisar todas las preguntas antes de salir al campo.
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}