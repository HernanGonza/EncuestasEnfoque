// src/components/MensajeModal.jsx
//
// Modal para enviar un mensaje a pantalla completa a encuestadores (RPC
// enviar_mensaje_encuestadores). Reutilizable desde admin (Encuestadores.jsx,
// alcance org/equipo/individual) y coordinador (Equipo.jsx, alcance
// equipo/individual restringido a los propios equipos).
//
// Reusa las clases de Page.module.css (admin) — ya es la convención: la
// vista de coordinador (src/pages/coordinador/Equipo.jsx) importa ese mismo
// módulo para sus modales.
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import styles from '../pages/admin/Page.module.css'

// equipos: [{ id, nombre }] — equipos que el usuario puede elegir como destino.
// encuestadores: [{ id, nombre_completo }] — para alcance individual, cuando
//   no viene un destinatario ya fijado.
// presetEncuestador: { id, nombre_completo } — si viene, el mensaje es
//   individual y fijo (botón "Mensaje" por fila), sin selector de alcance.
export default function MensajeModal({
  perfil,
  equipos = [],
  encuestadores = [],
  presetEncuestador = null,
  presetEquipoId = null,
  onClose,
  onSent,
}) {
  const puedeOrg = ['admin', 'gestor', 'superadmin'].includes(perfil?.rol)
  const alcances = presetEncuestador
    ? ['individual']
    : puedeOrg
      ? ['org', 'equipo', 'individual']
      : ['equipo', 'individual']

  const [alcance,        setAlcance]        = useState(presetEncuestador ? 'individual' : (presetEquipoId ? 'equipo' : alcances[0]))
  const [equipoId,       setEquipoId]       = useState(presetEquipoId || '')
  const [encuestadorId,  setEncuestadorId]  = useState(presetEncuestador?.id || '')
  const [titulo,         setTitulo]         = useState('')
  const [texto,          setTexto]          = useState('')
  const [saving,         setSaving]         = useState(false)
  const [error,          setError]          = useState('')

  const LABELS = { org: 'Toda la organización', equipo: 'Un equipo', individual: 'Un encuestador' }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!titulo.trim()) { setError('El título es obligatorio'); return }
    if (!texto.trim())  { setError('El texto es obligatorio'); return }
    if (alcance === 'equipo' && !equipoId) { setError('Elegí un equipo'); return }
    if (alcance === 'individual' && !encuestadorId) { setError('Elegí un encuestador'); return }

    setSaving(true); setError('')
    try {
      const { error: rpcErr } = await supabase.rpc('enviar_mensaje_encuestadores', {
        p_titulo: titulo.trim(),
        p_texto: texto.trim(),
        p_alcance: alcance,
        p_equipo_id: alcance === 'equipo' ? equipoId : null,
        p_encuestador_id: alcance === 'individual' ? encuestadorId : null,
      })
      if (rpcErr) throw rpcErr
      onSent?.(); onClose()
    } catch (err) {
      setError(err.message || 'Error al enviar el mensaje')
    } finally { setSaving(false) }
  }

  return (
    <div className={styles.modal}>
      <div className={styles.modalContent}>
        <div className={styles.modalHeader}>
          <h3>📢 Enviar mensaje{presetEncuestador ? ` — ${presetEncuestador.nombre_completo}` : ''}</h3>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit} className={styles.modalBody}>
          {!presetEncuestador && (
            <div className={styles.formGroup}>
              <label>Destinatarios</label>
              <select value={alcance} onChange={e => setAlcance(e.target.value)} className={styles.select}>
                {alcances.map(a => <option key={a} value={a}>{LABELS[a]}</option>)}
              </select>
            </div>
          )}

          {alcance === 'equipo' && !presetEncuestador && (
            <div className={styles.formGroup}>
              <label>Equipo *</label>
              <select value={equipoId} onChange={e => setEquipoId(e.target.value)} className={styles.select}>
                <option value="">Seleccioná un equipo</option>
                {equipos.map(eq => <option key={eq.id} value={eq.id}>{eq.nombre}</option>)}
              </select>
            </div>
          )}

          {alcance === 'individual' && !presetEncuestador && (
            <div className={styles.formGroup}>
              <label>Encuestador *</label>
              <select value={encuestadorId} onChange={e => setEncuestadorId(e.target.value)} className={styles.select}>
                <option value="">Seleccioná un encuestador</option>
                {encuestadores.map(en => <option key={en.id} value={en.id}>{en.nombre_completo}</option>)}
              </select>
            </div>
          )}

          <div className={styles.formGroup}>
            <label>Título *</label>
            <input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ej: Cambio de horario" maxLength={120} />
          </div>

          <div className={styles.formGroup}>
            <label>Mensaje *</label>
            <textarea
              value={texto}
              onChange={e => setTexto(e.target.value)}
              placeholder="Escribí el mensaje que va a ver el encuestador..."
              rows={4}
              style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)', fontSize: 13, fontFamily: 'DM Sans', resize: 'vertical', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ padding: '10px 14px', background: 'var(--surface)', borderRadius: 'var(--r)', fontSize: 13, color: 'var(--ink3)' }}>
            El mensaje se muestra a pantalla completa en la app del encuestador hasta que lo cierre, incluso si está en medio de una encuesta.
          </div>

          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.modalActions}>
            <button type="button" onClick={onClose} disabled={saving}>Cancelar</button>
            <button type="submit" disabled={saving}>{saving ? 'Enviando...' : 'Enviar mensaje'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
