export const TIPOS = [
  { value: 'opcion_multiple', label: 'Opción múltiple' },
  { value: 'checkbox',        label: 'Checkbox (múltiple)' },
  { value: 'si_no',           label: 'Sí / No' },
  { value: 'escala',          label: 'Escala 1-10' },
  { value: 'texto_libre',     label: 'Texto libre' },
  { value: 'desplegable',     label: 'Desplegable' },
  { value: 'matriz',          label: 'Matriz (tabla de opciones)' },
]
export const TIPOS_CON_OPCIONES = ['opcion_multiple', 'checkbox', 'desplegable']
export const TIPOS_MATRIZ = ['matriz']
// Taxonomía de preguntas "especiales" (sección 8 del plan de reportes): sin
// esto marcado, los reportes automáticos de candidato/perfil demográfico no
// tienen forma de saber qué pregunta es cuál sin adivinar por el texto
// literal. 'participa' ya existe y se usa en producción (no se toca acá,
// se sigue seteando igual que hasta ahora).
// El plan sugiere 'genero', pero EncuestaDetalle.jsx ya trae un filtro
// dormido para 'sexo' (`p.clave_base === 'sexo'`, línea ~887) que nunca
// llegó a usarse porque no había forma de setearlo — se respeta ese valor
// ya presente en el código en vez de introducir uno nuevo para lo mismo.
export const CLAVE_BASE_OPCIONES = [
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
export const ESTADO_CONFIG = {
  pendiente:    { label: 'Pendiente',    color: '#b45309', bg: '#fef3c7' },
  en_proceso:   { label: 'En proceso',   color: '#0369a1', bg: '#e0f2fe' },
  para_revisar: { label: 'Para revisar', color: '#7c3aed', bg: '#f3e8ff' },
  publicada:    { label: 'Publicada',    color: '#1a472a', bg: '#d8f3dc' },
  completada:   { label: 'Completada',   color: '#374151', bg: '#f3f4f6' },
}

export const inputStyle = {
  width: '100%', padding: '9px 12px',
  border: '1.5px solid var(--border2)', borderRadius: 'var(--r)',
  fontSize: 13, outline: 'none', fontFamily: 'DM Sans', background: 'var(--paper)',
}
export const labelStyle = { fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--ink2)' }

// ── Obtener opciones posibles para una pregunta ──
export function getOpcionesPregunta(pregunta) {
  if (pregunta.tipo === 'si_no') return ['Sí', 'No']
  if (pregunta.tipo === 'escala') return Array.from({ length: 10 }, (_, i) => String(i + 1))
  if (TIPOS_CON_OPCIONES.includes(pregunta.tipo)) return (pregunta.opciones || []).map(o => o.texto).filter(Boolean)
  if (pregunta.tipo === 'matriz') return (pregunta.columnas || []).map(c => c.texto).filter(Boolean)
  return [] // texto_libre no tiene opciones predefinidas
}
