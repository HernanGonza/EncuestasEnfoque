// Cálculo de los 10 reportes automáticos de la Sección 8 del plan
// (PLAN-tiempo-encuestas-y-mensajes.md — "Módulo de reportes descargables").
//
// A diferencia de `GraficoCruce` en Reportes.jsx (donde el admin arma el
// cruce a mano eligiendo dos preguntas), acá el admin solo elige QUÉ
// reporte de esta lista fija de 10 quiere ver — el agrupar/sumar/ordenar/
// calcular porcentaje lo hace este módulo.
//
// Fuentes de datos (ver EncuestaDetalle.jsx / ReportesAutomaticos.jsx):
//   - `preguntas`  : de get_encuesta_full — da clave_base y
//                    opciones_pregunta (con .orden) por pregunta.
//   - `statsZona`  : de get_stats_por_zona — ya trae completadas/
//                    no_respuesta/total por zona y por encuestador dentro
//                    de cada zona (no hace falta recalcularlo acá).
//   - `crudo`      : de get_respuestas_crudas (con zona_id/zona_nombre
//                    agregados en la migración 20260906023300) — una fila
//                    por sesión con sus respuestas resueltas, para todo lo
//                    que statsZona no cubre (candidatos, demográficos,
//                    evolución horaria, lat/lng).
//
// Limitaciones conocidas (documentadas acá en vez de resueltas a medias):
//   - El reporte 4 (completo por pregunta y zona) solo cubre preguntas con
//     opciones definidas (si_no, escala, opcion_multiple) — preguntas
//     `matriz` o `texto_libre` sin clave_base quedan fuera: no tienen un
//     conjunto fijo de categorías para tabular por zona.
//   - Zonas sin ningún intento (ni completada ni no-respuesta) no
//     aparecen: tanto get_stats_por_zona como get_respuestas_crudas
//     agrupan sobre sesiones existentes, no sobre el listado de zonas
//     configuradas.

import { sugerirCategoria, normalizarTexto } from './fuzzyMatch'

export const OTRO_SIN_IDENTIFICAR = 'Otro (sin identificar)'

// Misma paleta que `PALETA` en Reportes.jsx (no se importa de ahí porque
// ese archivo es JSX y este es un módulo de cálculo puro) — se reusa acá
// para los gráficos SVG de los reportes 14 y 17 y así no inventar una
// paleta nueva.
export const PALETA_REPORTES = ['#1a472a', '#0369a1', '#7c3aed', '#b45309', '#be185d', '#047857', '#2d6a4f', '#0284c7', '#dc2626', '#d97706']

// ── Helpers de preguntas ──
// Exportados también para el Reporte Visual Interactivo por Zona
// (ReporteVisualZona.jsx) — misma lógica de fusión "Otro" + detección de
// completada que ya usan los 10 reportes automáticos, para no duplicarla
// ni arriesgar que las dos vistas cuenten distinto.

export function buscarPregunta(preguntas, claveBase) {
  return (preguntas || []).find(p => p.clave_base === claveBase) || null
}

// Lista de roles "especiales" que un admin puede reasignar a mano cuando el
// clave_base automático no matchea (encuesta con wording distinto al
// esperado). `label`/`grupo` son solo para armar el selector en
// ReportesAutomaticos.jsx — el resto de esta lib no los usa.
export const CLAVES_ESPECIALES = [
  { clave: 'candidato_intendente', label: 'Candidato a intendente' },
  { clave: 'candidato_gobernador', label: 'Candidato a gobernador' },
  { clave: 'participa',            label: 'Participación (¿va a votar?)' },
  { clave: 'edad',                 label: 'Edad' },
  { clave: 'sexo',                 label: 'Género' },
  { clave: 'nivel_educativo',      label: 'Nivel educativo' },
  { clave: 'situacion_laboral',    label: 'Situación laboral' },
  { clave: 'evaluacion_gestion',   label: 'Evaluación de gestión' },
  { clave: 'problema_principal',   label: 'Principal problema' },
  { clave: 'probabilidad_voto',    label: 'Probabilidad de voto' },
]

// Igual que buscarPregunta, pero antes de la detección automática por
// clave_base mira si el admin ya asignó manualmente una pregunta a este rol
// (ctx.overrides = { [claveBase]: preguntaId }, ver ReportesAutomaticos.jsx).
// Esto es lo que permite "salvar" un reporte cuando la encuesta tiene la
// pregunta correcta pero el texto/tag nunca matcheó el clave_base esperado.
export function preguntaEspecial(ctx, claveBase) {
  const overrideId = ctx?.overrides?.[claveBase]
  if (overrideId) {
    const p = (ctx.preguntas || []).find(p => p.id === overrideId)
    if (p) return p
  }
  return buscarPregunta(ctx?.preguntas, claveBase)
}

export function opcionesDe(pregunta) {
  if (!pregunta) return []
  if (pregunta.tipo === 'si_no') return ['Sí', 'No']
  if (pregunta.tipo === 'escala') return Array.from({ length: 10 }, (_, i) => String(i + 1))
  return (pregunta.opciones_pregunta || [])
    .slice()
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
    .map(o => o.texto)
    .filter(Boolean)
}

// Una sesión cuenta como "completada" si respondió Sí a la pregunta de
// participación (cuando existe); si la encuesta no tiene esa pregunta,
// se considera completada toda sesión con al menos una respuesta guardada
// (mismo criterio que get_stats_por_zona, migración 20260902220011).
export function esCompletada(fila, pParticipa) {
  if (pParticipa) return fila.respuestas?.[String(pParticipa.id)] === 'Sí'
  return !!(fila.respuestas && Object.values(fila.respuestas).some(v => v != null && v !== ''))
}

// Valor de una pregunta de opciones para una fila, fusionando "Otro" contra
// las opciones conocidas por matching fuzzy (ver fuzzyMatch.js). Si viene
// texto libre que no matchea ninguna opción con suficiente confianza, cae
// en un balde único "Otro (sin identificar)" en vez de crear una categoría
// nueva por cada variante de tipeo.
export function valorFusionado(fila, pregunta, opciones) {
  const crudo = fila.respuestas?.[String(pregunta.id)]
  if (crudo == null || crudo === '') return null
  if (opciones.includes(crudo)) return crudo
  const sugerido = sugerirCategoria(crudo, opciones)
  return sugerido ? sugerido.categoria : OTRO_SIN_IDENTIFICAR
}

// Busca, entre `preguntas`, el follow-up de texto libre de tipo "Otro,
// especifique" que corresponde a `pregunta` (p. ej. "Especifique el
// nombre" después de "¿A qué candidato votaría?"). Heurística genérica —
// no depende del id de ninguna encuesta en particular: la primera pregunta
// de tipo texto_libre con "especifiqu" en el texto que aparece después de
// `pregunta` en el orden del formulario.
export function buscarSeguimientoOtro(preguntas, pregunta) {
  if (!pregunta) return null
  const candidatos = (preguntas || [])
    .filter(p => p.tipo === 'texto_libre' && (p.orden ?? 0) > (pregunta.orden ?? 0) && /especifiqu/i.test(p.texto || ''))
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
  return candidatos[0] || null
}

// Igual que valorFusionado, pero cuando la respuesta es literalmente "Otro"
// y hay un follow-up de texto libre (buscarSeguimientoOtro), fusiona ese
// texto contra las demás opciones por matching difuso — así "muler",
// "marcelo mulder", etc. en el campo "Especifique el nombre" se suman al
// candidato correspondiente en vez de perderse como "Otro" sin más.
//
// OJO con la calidad de datos: solo se mira el follow-up cuando la
// respuesta a `pregunta` fue exactamente "Otro". Se encontró que en
// producción (Campo Grande, set/2026) el campo "Especifique el nombre"
// tiene muchas respuestas de sesiones donde NO se eligió "Otro" (parece un
// bug de la app que no oculta el campo de seguimiento correctamente) —
// mirar ese texto sin este filtro sumaría votos de gente que en realidad
// ya había elegido un candidato de la lista.
export function valorFusionadoConSeguimiento(fila, pregunta, opciones, pSeguimiento) {
  const valor = valorFusionado(fila, pregunta, opciones)
  if (!pSeguimiento || valor == null || normalizarTexto(valor) !== 'otro') return valor
  const textoSeguimiento = fila.respuestas?.[String(pSeguimiento.id)]
  if (!textoSeguimiento) return valor
  const opcionesSinOtro = opciones.filter(o => normalizarTexto(o) !== 'otro')
  const sugerido = sugerirCategoria(textoSeguimiento, opcionesSinOtro)
  return sugerido ? sugerido.categoria : valor
}

function ordenarDesc(filas, campo) {
  return filas.slice().sort((a, b) => (b[campo] ?? 0) - (a[campo] ?? 0))
}

function pct(n, total) {
  return total > 0 ? Math.round((n / total) * 1000) / 10 : 0
}

// ── 1. Por zona — nombre + completadas, orden desc, total al pie ──
function reportePorZona(ctx) {
  const filas = ordenarDesc((ctx.statsZona?.por_zona || []).map(z => ({
    zona: z.zona_nombre, completadas: z.completadas || 0,
  })), 'completadas')
  const total = filas.reduce((s, f) => s + f.completadas, 0)
  return {
    columnas: [{ key: 'zona', label: 'Zona' }, { key: 'completadas', label: 'Completadas', num: true }],
    filas, totalFila: { zona: 'Total', completadas: total },
  }
}

// ── 2. Por encuestador — nombre + completadas (sin no-respuesta) ──
function reportePorEncuestador(ctx) {
  const mapa = {}
  for (const z of ctx.statsZona?.por_zona || []) {
    for (const e of z.encuestadores || []) {
      if (!mapa[e.encuestador_id]) mapa[e.encuestador_id] = { encuestador: e.nombre || '—', completadas: 0 }
      mapa[e.encuestador_id].completadas += e.completadas || 0
    }
  }
  const filas = ordenarDesc(Object.values(mapa), 'completadas')
  const total = filas.reduce((s, f) => s + f.completadas, 0)
  return {
    columnas: [{ key: 'encuestador', label: 'Encuestador' }, { key: 'completadas', label: 'Completadas', num: true }],
    filas, totalFila: { encuestador: 'Total', completadas: total },
  }
}

// ── 3. Comparativo de candidatos por zona ──
function reporteCandidatosPorZona(ctx) {
  const pCand = preguntaEspecial(ctx, 'candidato_intendente')
  if (!pCand) return null
  const pParticipa = preguntaEspecial(ctx, 'participa')
  const opciones = opcionesDe(pCand)
  const pSeguimiento = buscarSeguimientoOtro(ctx.preguntas, pCand)
  const porZona = {}
  for (const fila of ctx.crudo?.filas || []) {
    if (!esCompletada(fila, pParticipa)) continue
    const valor = valorFusionadoConSeguimiento(fila, pCand, opciones, pSeguimiento)
    if (!valor) continue
    const zona = fila.zona_nombre || 'Sin zona'
    porZona[zona] = porZona[zona] || {}
    porZona[zona][valor] = (porZona[zona][valor] || 0) + 1
  }
  const secciones = Object.entries(porZona).map(([zona, conteo]) => {
    const filas = ordenarDesc(Object.entries(conteo).map(([candidato, votos]) => ({ candidato, votos })), 'votos')
    const total = filas.reduce((s, f) => s + f.votos, 0)
    filas.forEach(f => { f.porcentaje = pct(f.votos, total) })
    return {
      titulo: zona,
      columnas: [{ key: 'candidato', label: 'Candidato' }, { key: 'votos', label: 'Votos', num: true }, { key: 'porcentaje', label: '%', num: true }],
      filas, totalFila: { candidato: 'Total', votos: total, porcentaje: 100 },
    }
  }).sort((a, b) => b.totalFila.votos - a.totalFila.votos)
  return { secciones }
}

// ── 4. Completo por pregunta y zona ──
function reporteCompletoPorPreguntaYZona(ctx) {
  const pParticipa = preguntaEspecial(ctx, 'participa')
  const preguntas = (ctx.preguntas || []).filter(p =>
    p.clave_base !== 'participa' &&
    ['si_no', 'escala', 'opcion_multiple'].includes(p.tipo)
  )
  const secciones = preguntas.map(p => {
    const opciones = opcionesDe(p)
    const pSeguimiento = buscarSeguimientoOtro(ctx.preguntas, p)
    const porZona = {}
    for (const fila of ctx.crudo?.filas || []) {
      if (!esCompletada(fila, pParticipa)) continue
      const valor = valorFusionadoConSeguimiento(fila, p, opciones, pSeguimiento)
      if (!valor) continue
      const zona = fila.zona_nombre || 'Sin zona'
      porZona[zona] = porZona[zona] || {}
      porZona[zona][valor] = (porZona[zona][valor] || 0) + 1
    }
    const ordenOpciones = [...opciones, OTRO_SIN_IDENTIFICAR]
    const filas = Object.entries(porZona).map(([zona, conteo]) => {
      const total = Object.values(conteo).reduce((a, b) => a + b, 0)
      const fila = { zona, total }
      ordenOpciones.forEach(op => { fila[op] = conteo[op] || 0 })
      return fila
    }).sort((a, b) => b.total - a.total)
    return {
      titulo: p.texto,
      columnas: [
        { key: 'zona', label: 'Zona' },
        ...ordenOpciones.map(op => ({ key: op, label: op, num: true })),
        { key: 'total', label: 'Total', num: true },
      ],
      filas,
    }
  }).filter(s => s.filas.length > 0)
  return { secciones }
}

// ── 5. No-respuesta por zona ──
function reporteNoRespuestaPorZona(ctx) {
  const filas = (ctx.statsZona?.por_zona || []).map(z => ({
    zona: z.zona_nombre,
    no_respuesta: z.no_respuesta || 0,
    total: z.total || 0,
    tasa: pct(z.no_respuesta || 0, z.total || 0),
  })).sort((a, b) => b.tasa - a.tasa)
  const noResp = filas.reduce((s, f) => s + f.no_respuesta, 0)
  const total = filas.reduce((s, f) => s + f.total, 0)
  return {
    columnas: [
      { key: 'zona', label: 'Zona' }, { key: 'no_respuesta', label: 'No respuesta', num: true },
      { key: 'total', label: 'Total sesiones', num: true }, { key: 'tasa', label: 'Tasa de rechazo %', num: true },
    ],
    filas, totalFila: { zona: 'Total', no_respuesta: noResp, total, tasa: pct(noResp, total) },
  }
}

// ── 6. Actividad por encuestador ──
function reporteActividadPorEncuestador(ctx) {
  const mapa = {}
  for (const z of ctx.statsZona?.por_zona || []) {
    for (const e of z.encuestadores || []) {
      if (!mapa[e.encuestador_id]) mapa[e.encuestador_id] = { encuestador: e.nombre || '—', completadas: 0, no_respuesta: 0, total: 0 }
      mapa[e.encuestador_id].completadas  += e.completadas || 0
      mapa[e.encuestador_id].no_respuesta += e.no_respuesta || 0
      mapa[e.encuestador_id].total        += e.total || 0
    }
  }
  const filas = Object.values(mapa).map(f => ({ ...f, tasa: pct(f.no_respuesta, f.total) }))
    .sort((a, b) => b.total - a.total)
  return {
    columnas: [
      { key: 'encuestador', label: 'Encuestador' }, { key: 'completadas', label: 'Completadas', num: true },
      { key: 'no_respuesta', label: 'No respuesta', num: true }, { key: 'tasa', label: 'Tasa de rechazo %', num: true },
    ],
    filas,
  }
}

// ── 7. Evolución horaria (completadas acumuladas por hora, UTC-3) ──
// Argentina no tiene horario de verano desde 2009: el offset -3 es fijo.
function horaArgentina(fechaISO) {
  const d = new Date(fechaISO)
  return (d.getUTCHours() + 24 - 3) % 24
}

function reporteEvolucionHoraria(ctx) {
  const pParticipa = preguntaEspecial(ctx, 'participa')
  const porHora = Array.from({ length: 24 }, () => 0)
  for (const fila of ctx.crudo?.filas || []) {
    if (!fila.fecha || !esCompletada(fila, pParticipa)) continue
    porHora[horaArgentina(fila.fecha)]++
  }
  let acumulado = 0
  const filas = porHora.map((n, hora) => {
    acumulado += n
    return { hora: `${String(hora).padStart(2, '0')}:00`, completadas: n, acumulado }
  })
  return {
    columnas: [{ key: 'hora', label: 'Hora (ARG)' }, { key: 'completadas', label: 'Completadas', num: true }, { key: 'acumulado', label: 'Acumulado', num: true }],
    filas,
  }
}

// ── 8. Distribución geográfica ──
function reporteDistribucionGeografica(ctx) {
  const coords = {}
  for (const fila of ctx.crudo?.filas || []) {
    if (fila.lat == null || fila.lng == null) continue
    const zona = fila.zona_nombre || 'Sin zona'
    coords[zona] = coords[zona] || { sumaLat: 0, sumaLng: 0, n: 0 }
    coords[zona].sumaLat += Number(fila.lat)
    coords[zona].sumaLng += Number(fila.lng)
    coords[zona].n++
  }
  const filas = (ctx.statsZona?.por_zona || []).map(z => {
    const c = coords[z.zona_nombre]
    return {
      zona: z.zona_nombre,
      total: z.total || 0,
      completadas: z.completadas || 0,
      no_respuesta: z.no_respuesta || 0,
      lat_prom: c ? (c.sumaLat / c.n).toFixed(5) : '—',
      lng_prom: c ? (c.sumaLng / c.n).toFixed(5) : '—',
    }
  }).sort((a, b) => b.total - a.total)
  return {
    columnas: [
      { key: 'zona', label: 'Zona' }, { key: 'total', label: 'Sesiones', num: true },
      { key: 'completadas', label: 'Completadas', num: true }, { key: 'no_respuesta', label: 'No respuesta', num: true },
      { key: 'lat_prom', label: 'Lat. promedio', num: true }, { key: 'lng_prom', label: 'Lng. promedio', num: true },
    ],
    filas,
  }
}

// ── 9. Perfil demográfico — cruce edad/nivel educativo/situación laboral/
//      sexo, absolutos y porcentajes por zona ──
// Se arma una sección por cada variable demográfica presente en la
// encuesta (no las 4 juntas en una sola tabla: el cruce completo de las 4
// a la vez tendría demasiadas columnas para ser legible en un PDF).
function reporteDemografico(ctx) {
  const pParticipa = preguntaEspecial(ctx, 'participa')
  const VARIABLES = [
    ['edad', 'Edad'], ['sexo', 'Género'],
    ['nivel_educativo', 'Nivel educativo'], ['situacion_laboral', 'Situación laboral'],
  ]
  const secciones = []
  for (const [clave, titulo] of VARIABLES) {
    const p = preguntaEspecial(ctx, clave)
    if (!p) continue
    const opciones = opcionesDe(p)
    const porZona = {}
    for (const fila of ctx.crudo?.filas || []) {
      if (!esCompletada(fila, pParticipa)) continue
      const valor = valorFusionado(fila, p, opciones)
      if (!valor) continue
      const zona = fila.zona_nombre || 'Sin zona'
      porZona[zona] = porZona[zona] || {}
      porZona[zona][valor] = (porZona[zona][valor] || 0) + 1
    }
    const filas = Object.entries(porZona).map(([zona, conteo]) => {
      const total = Object.values(conteo).reduce((a, b) => a + b, 0)
      const fila = { zona, total }
      opciones.forEach(op => {
        const n = conteo[op] || 0
        fila[op] = `${n} (${pct(n, total)}%)`
      })
      return fila
    }).sort((a, b) => b.total - a.total)
    if (filas.length) {
      secciones.push({
        titulo,
        columnas: [{ key: 'zona', label: 'Zona' }, ...opciones.map(op => ({ key: op, label: op })), { key: 'total', label: 'Total', num: true }],
        filas,
      })
    }
  }
  return { secciones }
}

// ── 10. Intención de voto cruzada con perfil — candidato x edad x género ──
function reporteVotoPorPerfil(ctx) {
  const pCand  = preguntaEspecial(ctx, 'candidato_intendente')
  const pEdad  = preguntaEspecial(ctx, 'edad')
  const pSexo  = preguntaEspecial(ctx, 'sexo')
  if (!pCand || (!pEdad && !pSexo)) return null
  const pParticipa = preguntaEspecial(ctx, 'participa')
  const opcionesCand = opcionesDe(pCand)
  const pSeguimiento = buscarSeguimientoOtro(ctx.preguntas, pCand)
  const candidatos = new Set()
  const porPerfil = {}
  for (const fila of ctx.crudo?.filas || []) {
    if (!esCompletada(fila, pParticipa)) continue
    const candidato = valorFusionadoConSeguimiento(fila, pCand, opcionesCand, pSeguimiento)
    if (!candidato) continue
    const edad = pEdad ? (fila.respuestas?.[String(pEdad.id)] || '—') : null
    const sexo = pSexo ? (fila.respuestas?.[String(pSexo.id)] || '—') : null
    const perfil = [sexo, edad].filter(Boolean).join(' / ') || '—'
    candidatos.add(candidato)
    porPerfil[perfil] = porPerfil[perfil] || {}
    porPerfil[perfil][candidato] = (porPerfil[perfil][candidato] || 0) + 1
  }
  const listaCandidatos = Array.from(candidatos)
  const filas = Object.entries(porPerfil).map(([perfil, conteo]) => {
    const total = Object.values(conteo).reduce((a, b) => a + b, 0)
    const fila = { perfil, total }
    listaCandidatos.forEach(c => { fila[c] = conteo[c] || 0 })
    return fila
  }).sort((a, b) => b.total - a.total)
  return {
    columnas: [
      { key: 'perfil', label: 'Perfil (género / edad)' },
      ...listaCandidatos.map(c => ({ key: c, label: c, num: true })),
      { key: 'total', label: 'Total', num: true },
    ],
    filas,
  }
}

// ── 11. Resumen ejecutivo — una sola carilla, sin tablas detalladas ──
// A diferencia de los otros 10, no devuelve { columnas, filas } / {
// secciones } para tablaHTML: devuelve una forma propia { tipo: 'resumen',
// ... } que ReportesAutomaticos.jsx renderiza con fuente grande y barras,
// pensado para entregarle a un cliente en 30 segundos.
//
// Requiere clave_base 'candidato_gobernador' / 'evaluacion_gestion' /
// 'problema_principal' además de las 3 ya en uso (candidato_intendente,
// participa) — agregadas a CLAVE_BASE_OPCIONES en EncuestaBuilder.jsx. Si
// la encuesta no tiene esas preguntas etiquetadas, la sección
// correspondiente simplemente no aparece (queda en null).
const CLASIFICACION_GESTION = {
  positivo: ['buena', 'muy buena', 'excelente', 'aprueba', 'positiva'],
  neutro:   ['regular', 'ni buena ni mala', 'neutral', 'neutra'],
  negativo: ['mala', 'muy mala', 'pesima', 'pesimo', 'desaprueba', 'negativa'],
}

function clasificarGestion(opcion) {
  const norm = normalizarTexto(opcion)
  for (const [clase, palabras] of Object.entries(CLASIFICACION_GESTION)) {
    if (palabras.some(p => norm.includes(normalizarTexto(p)))) return clase
  }
  return null
}

function topN(pregunta, ctx, pParticipa, n) {
  const opciones = opcionesDe(pregunta)
  const pSeguimiento = buscarSeguimientoOtro(ctx.preguntas, pregunta)
  const conteo = {}
  let total = 0
  for (const f of ctx.crudo?.filas || []) {
    if (!esCompletada(f, pParticipa)) continue
    const valor = valorFusionadoConSeguimiento(f, pregunta, opciones, pSeguimiento)
    if (!valor) continue
    conteo[valor] = (conteo[valor] || 0) + 1
    total++
  }
  const top = ordenarDesc(Object.entries(conteo).map(([nombre, votos]) => ({ nombre, votos })), 'votos')
    .slice(0, n)
    .map(f => ({ nombre: f.nombre, pct: pct(f.votos, total) }))
  return top.length ? { top } : null
}

// Igual que topN pero sin recortar: devuelve TODAS las opciones de la
// pregunta (incluidas las de 0 votos), con n y %. Usada por la comparación
// entre encuestas (Cambio 2, CompararEncuestas.jsx) y el panel de
// seguimiento temporal (Reporte 21) — ahí no importa el ranking sino poder
// mergear opción por opción entre dos encuestas distintas.
export function distribucionCompleta(pregunta, preguntas, crudo, pParticipa) {
  const opciones = opcionesDe(pregunta)
  if (!opciones.length) return { total: 0, filas: [] }
  const pSeguimiento = buscarSeguimientoOtro(preguntas, pregunta)
  const conteo = {}
  let total = 0
  for (const f of crudo?.filas || []) {
    if (!esCompletada(f, pParticipa)) continue
    const valor = valorFusionadoConSeguimiento(f, pregunta, opciones, pSeguimiento)
    if (!valor) continue
    conteo[valor] = (conteo[valor] || 0) + 1
    total++
  }
  const filas = opciones.map(opcion => ({ opcion, n: conteo[opcion] || 0, pct: pct(conteo[opcion] || 0, total) }))
  return { total, filas }
}

function reporteResumenEjecutivo(ctx) {
  const pParticipa = preguntaEspecial(ctx, 'participa')
  const completadas = (ctx.statsZona?.por_zona || []).reduce((s, z) => s + (z.completadas || 0), 0)
  const total = (ctx.statsZona?.por_zona || []).reduce((s, z) => s + (z.total || 0), 0)

  const pIntendente = preguntaEspecial(ctx, 'candidato_intendente')
  const pGobernador = preguntaEspecial(ctx, 'candidato_gobernador')
  const pGestion    = preguntaEspecial(ctx, 'evaluacion_gestion')
  const pProblema   = preguntaEspecial(ctx, 'problema_principal')

  let evaluacionGestion = null
  if (pGestion) {
    const conteo = { positivo: 0, neutro: 0, negativo: 0 }
    let totalGestion = 0
    for (const f of ctx.crudo?.filas || []) {
      if (!esCompletada(f, pParticipa)) continue
      const crudo = f.respuestas?.[String(pGestion.id)]
      if (!crudo) continue
      const clase = clasificarGestion(crudo)
      if (!clase) continue
      conteo[clase]++
      totalGestion++
    }
    if (totalGestion > 0) {
      evaluacionGestion = {
        positivo: pct(conteo.positivo, totalGestion),
        neutro:   pct(conteo.neutro, totalGestion),
        negativo: pct(conteo.negativo, totalGestion),
      }
    }
  }

  return {
    tipo: 'resumen',
    completadas,
    total,
    tasaParticipacion: pct(completadas, total),
    candidatoIntendente: pIntendente ? topN(pIntendente, ctx, pParticipa, 3) : null,
    candidatoGobernador: pGobernador ? topN(pGobernador, ctx, pParticipa, 2) : null,
    evaluacionGestion,
    problemaPrincipal: pProblema ? topN(pProblema, ctx, pParticipa, 3) : null,
  }
}

// ── 12. Competitividad por zona — 1° vs 2° candidato a intendente, nivel
//        de reñidez de cada zona ──
const NIVELES_COMPETITIVIDAD = [
  { max: 5,        nombre: 'Muy reñida', bg: '#dc2626', fg: '#fff' },
  { max: 15,       nombre: 'Reñida',     bg: '#f97316', fg: '#fff' },
  { max: 30,       nombre: 'Definida',   bg: '#facc15', fg: '#1a1a1a' },
  { max: Infinity, nombre: 'Dominada',   bg: '#16a34a', fg: '#fff' },
]

function nivelCompetitividad(diff) {
  return NIVELES_COMPETITIVIDAD.find(n => diff < n.max) || NIVELES_COMPETITIVIDAD[NIVELES_COMPETITIVIDAD.length - 1]
}

function reporteCompetitividadZona(ctx) {
  const pCand = preguntaEspecial(ctx, 'candidato_intendente')
  if (!pCand) return null
  const pParticipa = preguntaEspecial(ctx, 'participa')
  const opciones = opcionesDe(pCand)
  const pSeguimiento = buscarSeguimientoOtro(ctx.preguntas, pCand)
  const porZona = {}
  for (const fila of ctx.crudo?.filas || []) {
    if (!esCompletada(fila, pParticipa)) continue
    const valor = valorFusionadoConSeguimiento(fila, pCand, opciones, pSeguimiento)
    if (!valor) continue
    const zona = fila.zona_nombre || 'Sin zona'
    porZona[zona] = porZona[zona] || {}
    porZona[zona][valor] = (porZona[zona][valor] || 0) + 1
  }
  const filas = Object.entries(porZona).map(([zona, conteo]) => {
    const ranking = ordenarDesc(Object.entries(conteo).map(([candidato, votos]) => ({ candidato, votos })), 'votos')
    const [c1, c2] = ranking
    if (!c1) return null
    const total = ranking.reduce((s, f) => s + f.votos, 0)
    const pct1 = pct(c1.votos, total)
    const pct2 = c2 ? pct(c2.votos, total) : 0
    const diff = Math.round((pct1 - pct2) * 10) / 10
    const nivel = nivelCompetitividad(diff)
    return { zona, candidato1: c1.candidato, pct1, candidato2: c2?.candidato || '—', pct2, diff, nivel: nivel.nombre, _bg: nivel.bg, _fg: nivel.fg }
  }).filter(Boolean).sort((a, b) => a.diff - b.diff)
  if (!filas.length) return null

  const conteoNiveles = {}
  filas.forEach(f => { conteoNiveles[f.nivel] = (conteoNiveles[f.nivel] || 0) + 1 })
  const masRenida = filas[0]
  // Los 4 nombres de nivel terminan en "a" (adjetivo femenino singular, para
  // concordar con "zona"): agregar una "s" alcanza para el plural en los 4 casos.
  const sintesis = Object.entries(conteoNiveles)
    .map(([nivel, n]) => `${n} zona${n === 1 ? '' : 's'} ${n === 1 ? 'está' : 'están'} ${n === 1 ? nivel.toLowerCase() : nivel.toLowerCase() + 's'}`)
    .join(', ') + `. La zona más competitiva es ${masRenida.zona} con ${masRenida.diff}pp de diferencia entre ${masRenida.candidato1} y ${masRenida.candidato2}.`

  return {
    columnas: [
      { key: 'zona', label: 'Zona' }, { key: 'candidato1', label: '1° candidato' }, { key: 'pct1', label: '%', num: true },
      { key: 'candidato2', label: '2° candidato' }, { key: 'pct2', label: '%', num: true },
      { key: 'diff', label: 'Diferencia (pp)', num: true }, { key: 'nivel', label: 'Competitividad' },
    ],
    filas, sintesis,
  }
}

// ── 13. Agenda temática por zona — candidato ganador + principal problema
//        de cada zona, agrupados en un resumen por candidato ganador ──
function reporteAgendaTematica(ctx) {
  const pCand = preguntaEspecial(ctx, 'candidato_intendente')
  const pProblema = preguntaEspecial(ctx, 'problema_principal')
  if (!pCand || !pProblema) return null
  const pParticipa = preguntaEspecial(ctx, 'participa')
  const opcionesCand = opcionesDe(pCand)
  const opcionesProblema = opcionesDe(pProblema)
  const segCand = buscarSeguimientoOtro(ctx.preguntas, pCand)
  const porZona = {}
  for (const fila of ctx.crudo?.filas || []) {
    if (!esCompletada(fila, pParticipa)) continue
    const candidato = valorFusionadoConSeguimiento(fila, pCand, opcionesCand, segCand)
    const problema = valorFusionado(fila, pProblema, opcionesProblema)
    if (!candidato && !problema) continue
    const zona = fila.zona_nombre || 'Sin zona'
    porZona[zona] = porZona[zona] || { candidatos: {}, problemas: {} }
    if (candidato) porZona[zona].candidatos[candidato] = (porZona[zona].candidatos[candidato] || 0) + 1
    if (problema) porZona[zona].problemas[problema] = (porZona[zona].problemas[problema] || 0) + 1
  }
  const filas = Object.entries(porZona).map(([zona, { candidatos, problemas }]) => {
    const topCand = ordenarDesc(Object.entries(candidatos).map(([candidato, votos]) => ({ candidato, votos })), 'votos')[0]
    const topProb = ordenarDesc(Object.entries(problemas).map(([problema, votos]) => ({ problema, votos })), 'votos')[0]
    if (!topCand || !topProb) return null
    const totalCand = Object.values(candidatos).reduce((a, b) => a + b, 0)
    const totalProb = Object.values(problemas).reduce((a, b) => a + b, 0)
    return {
      zona, candidato_ganador: topCand.candidato, pct_candidato: pct(topCand.votos, totalCand),
      problema_principal: topProb.problema, pct_problema: pct(topProb.votos, totalProb),
    }
  }).filter(Boolean).sort((a, b) => b.pct_candidato - a.pct_candidato)
  if (!filas.length) return null

  // Resumen: agrupar zonas por candidato ganador y buscar, dentro de cada
  // grupo, el problema que más veces aparece como "principal problema de la
  // zona" (conteo de zonas, no de votos individuales — es un resumen "por
  // zona", como pide el spec).
  const grupos = {}
  filas.forEach(f => {
    grupos[f.candidato_ganador] = grupos[f.candidato_ganador] || {}
    grupos[f.candidato_ganador][f.problema_principal] = (grupos[f.candidato_ganador][f.problema_principal] || 0) + 1
  })
  const resumenPorCandidato = Object.entries(grupos).map(([candidato, problemas]) => {
    const total = Object.values(problemas).reduce((a, b) => a + b, 0)
    const top = ordenarDesc(Object.entries(problemas).map(([problema, n]) => ({ problema, n })), 'n')[0]
    return { candidato, problema: top.problema, pct: pct(top.n, total) }
  })
  const sintesis = resumenPorCandidato.map(r => `En las zonas donde gana ${r.candidato}, el principal problema es ${r.problema} (${r.pct}%).`).join(' ')

  return {
    columnas: [
      { key: 'zona', label: 'Zona' }, { key: 'candidato_ganador', label: 'Candidato ganador' }, { key: 'pct_candidato', label: '% del ganador', num: true },
      { key: 'problema_principal', label: 'Principal problema' }, { key: 'pct_problema', label: '% del problema', num: true },
    ],
    filas, sintesis, resumenPorCandidato,
  }
}

// ── 14. Corte generacional — candidato x grupo etario, tabla de
//        contingencia con totales + matriz en % para el gráfico apilado ──
function reporteCorteGeneracional(ctx) {
  const pCand = preguntaEspecial(ctx, 'candidato_intendente')
  const pEdad = preguntaEspecial(ctx, 'edad')
  if (!pCand || !pEdad) return null
  const pParticipa = preguntaEspecial(ctx, 'participa')
  const opcionesCand = opcionesDe(pCand)
  const opcionesEdad = opcionesDe(pEdad)
  const segCand = buscarSeguimientoOtro(ctx.preguntas, pCand)
  const matriz = {}
  const candidatosSet = new Set()
  for (const fila of ctx.crudo?.filas || []) {
    if (!esCompletada(fila, pParticipa)) continue
    const candidato = valorFusionadoConSeguimiento(fila, pCand, opcionesCand, segCand)
    const edad = valorFusionado(fila, pEdad, opcionesEdad)
    if (!candidato || !edad) continue
    candidatosSet.add(candidato)
    matriz[edad] = matriz[edad] || {}
    matriz[edad][candidato] = (matriz[edad][candidato] || 0) + 1
  }
  const grupos = opcionesEdad.filter(o => matriz[o])
  if (!grupos.length) return null
  const candidatos = Array.from(candidatosSet)

  const filas = grupos.map(grupo => {
    const conteo = matriz[grupo]
    const total = Object.values(conteo).reduce((a, b) => a + b, 0)
    const fila = { grupo, total }
    candidatos.forEach(c => { const n = conteo[c] || 0; fila[c] = `${n} (${pct(n, total)}%)` })
    return fila
  })

  const totalesNum = { total: 0 }
  candidatos.forEach(c => { totalesNum[c] = 0 })
  grupos.forEach(grupo => {
    const conteo = matriz[grupo]
    candidatos.forEach(c => { totalesNum[c] += conteo[c] || 0 })
    totalesNum.total += Object.values(conteo).reduce((a, b) => a + b, 0)
  })
  const totalFila = { grupo: 'Total', total: totalesNum.total }
  candidatos.forEach(c => { totalFila[c] = `${totalesNum[c]} (${pct(totalesNum[c], totalesNum.total)}%)` })

  // Matriz en % puro (sin texto "n (%)"), para el gráfico de barras apiladas.
  const matrizPct = grupos.map(grupo => {
    const conteo = matriz[grupo]
    const total = Object.values(conteo).reduce((a, b) => a + b, 0)
    return { grupo, valores: candidatos.map(c => pct(conteo[c] || 0, total)) }
  })

  return {
    columnas: [{ key: 'grupo', label: 'Grupo etario' }, ...candidatos.map(c => ({ key: c, label: c, num: true })), { key: 'total', label: 'Total', num: true }],
    filas, totalFila, grupos, candidatos, matrizPct,
  }
}

// ── 15. Índice de participación por zona — tasa de participación como
//        proxy de subrepresentación geográfica ──
// El spec original pide densidad de encuestas por km² usando el polígono de
// cada zona (`encuesta_zonas.area_geojson`, con @turf/area o Shoelace). Ese
// geojson no llega al `ctx` de este módulo — acá solo entran `preguntas`,
// `statsZona` y `crudo` (ver comentario al principio del archivo); sumar el
// polígono implicaría una carga nueva (`get_zonas_con_sesiones`, que ya usa
// Reportes.jsx) pasada en cascada por 3 componentes más. El spec mismo
// contempla este caso ("si no está disponible el geojson, omitir la columna
// de densidad") — se resuelve así, con la tasa de participación como
// indicador de subrepresentación en su lugar.
function reporteIndiceParticipacion(ctx) {
  const filas = (ctx.statsZona?.por_zona || []).map(z => ({
    zona: z.zona_nombre, completadas: z.completadas || 0, no_respuesta: z.no_respuesta || 0,
    tasa: pct(z.completadas || 0, z.total || 0),
  })).sort((a, b) => a.tasa - b.tasa)
  if (!filas.length) return null
  const peor = filas[0]
  const sintesis = `La zona con menor tasa de participación es ${peor.zona} (${peor.tasa}%). Considerar reforzar cobertura en próximos operativos.`
  return {
    columnas: [
      { key: 'zona', label: 'Zona' }, { key: 'completadas', label: 'Completadas', num: true },
      { key: 'no_respuesta', label: 'No respuesta', num: true }, { key: 'tasa', label: 'Tasa participación %', num: true },
    ],
    filas, sintesis,
  }
}

// ── 16. Consistencia interna — sesiones con combinaciones de respuestas
//        incoherentes, según 3 reglas heurísticas ──
// Regla 1 usa 'evaluacion_gestion' (no 'gestion_intendente', como decía el
// spec original) — es el clave_base real que usa este proyecto, ver
// CLAVE_BASE_OPCIONES en EncuestaBuilder.jsx. El modelo de datos no tiene
// "espacio político" por candidato, así que se aproxima "el candidato
// oficialista" como el más elegido entre quienes evalúan la gestión
// positivamente — es la única señal disponible sin agregar metadata nueva.
function reglaGestionVsVoto(ctx, pParticipa) {
  const pGestion = preguntaEspecial(ctx, 'evaluacion_gestion')
  const pCand = preguntaEspecial(ctx, 'candidato_intendente')
  if (!pGestion || !pCand) return null
  const opcionesCand = opcionesDe(pCand)
  const segCand = buscarSeguimientoOtro(ctx.preguntas, pCand)
  const positivas = []
  const conteoPositivos = {}
  for (const fila of ctx.crudo?.filas || []) {
    if (!esCompletada(fila, pParticipa)) continue
    const gestion = fila.respuestas?.[String(pGestion.id)]
    if (!gestion || clasificarGestion(gestion) !== 'positivo') continue
    const candidato = valorFusionadoConSeguimiento(fila, pCand, opcionesCand, segCand)
    if (!candidato) continue
    positivas.push({ fila, candidato })
    conteoPositivos[candidato] = (conteoPositivos[candidato] || 0) + 1
  }
  if (!positivas.length) return null
  const oficialista = ordenarDesc(Object.entries(conteoPositivos).map(([candidato, n]) => ({ candidato, n })), 'n')[0].candidato
  const afectadas = positivas.filter(p => p.candidato !== oficialista)
  if (!afectadas.length) return null
  const totalCompletadas = (ctx.crudo?.filas || []).filter(f => esCompletada(f, pParticipa)).length
  return {
    nombre: 'Evalúa la gestión bien pero vota a otro candidato',
    descripcion: `Se aproxima "candidato oficialista" como ${oficialista} — el más elegido entre quienes evalúan la gestión positivamente (no hay dato de espacio político por candidato).`,
    cantidad: afectadas.length, pct: pct(afectadas.length, totalCompletadas),
    muestra: afectadas.slice(0, 10).map(p => ({ zona: p.fila.zona_nombre || '—', encuestador: p.fila.encuestador || '—' })),
  }
}

// Regla 2 requiere clave_base 'probabilidad_voto', que hoy no está entre las
// opciones de CLAVE_BASE_OPCIONES (EncuestaBuilder.jsx) — queda lista para
// cuando se agregue esa opción; hasta entonces `buscarPregunta` no la
// encuentra y la regla se omite sola (mismo criterio del resto del archivo:
// nunca crashear, mostrar solo lo que aplica a la encuesta actual).
function reglaProbabilidadVsVoto(ctx, pParticipa) {
  const pProb = preguntaEspecial(ctx, 'probabilidad_voto')
  const pCand = preguntaEspecial(ctx, 'candidato_intendente')
  if (!pProb || !pCand) return null
  const opcionesCand = opcionesDe(pCand)
  const segCand = buscarSeguimientoOtro(ctx.preguntas, pCand)
  const afectadas = []
  let totalCompletadas = 0
  for (const fila of ctx.crudo?.filas || []) {
    if (!esCompletada(fila, pParticipa)) continue
    totalCompletadas++
    const prob = fila.respuestas?.[String(pProb.id)]
    if (!prob || !/no\s*va\s*a?\s*votar|no\s*voto/i.test(normalizarTexto(prob))) continue
    const candidato = valorFusionadoConSeguimiento(fila, pCand, opcionesCand, segCand)
    if (!candidato) continue
    afectadas.push({ zona: fila.zona_nombre || '—', encuestador: fila.encuestador || '—' })
  }
  if (!afectadas.length) return null
  return {
    nombre: 'Dice que no va a votar pero elige un candidato',
    descripcion: 'Respondió que no piensa votar en la pregunta de probabilidad de voto, pero eligió un candidato en la pregunta de intendente.',
    cantidad: afectadas.length, pct: pct(afectadas.length, totalCompletadas), muestra: afectadas.slice(0, 10),
  }
}

// Regla 3: elige "No sabe / No contesta" en candidato a intendente pero da
// un nombre en el campo de texto libre de seguimiento ("Especifique…").
// Reusa `buscarSeguimientoOtro` para encontrar ese campo, pero sin filtrar
// por respuesta === "Otro" como hace `valorFusionadoConSeguimiento` — acá
// interesa exactamente el caso contrario (NS/NC + texto igual presente).
function reglaNsNcConTexto(ctx, pParticipa) {
  const pCand = preguntaEspecial(ctx, 'candidato_intendente')
  if (!pCand) return null
  const pSeguimiento = buscarSeguimientoOtro(ctx.preguntas, pCand)
  if (!pSeguimiento) return null
  const afectadas = []
  let totalCompletadas = 0
  for (const fila of ctx.crudo?.filas || []) {
    if (!esCompletada(fila, pParticipa)) continue
    totalCompletadas++
    const respuesta = fila.respuestas?.[String(pCand.id)]
    if (!respuesta || !/no\s*sabe|no\s*contesta|ns\W?nc/i.test(normalizarTexto(respuesta))) continue
    const texto = fila.respuestas?.[String(pSeguimiento.id)]
    if (!texto) continue
    afectadas.push({ zona: fila.zona_nombre || '—', encuestador: fila.encuestador || '—' })
  }
  if (!afectadas.length) return null
  return {
    nombre: 'Elige "No sabe / No contesta" pero da un nombre en el campo de texto',
    descripcion: 'La opción elegida fue "No sabe / No contesta", pero el campo de texto libre de seguimiento tiene una respuesta.',
    cantidad: afectadas.length, pct: pct(afectadas.length, totalCompletadas), muestra: afectadas.slice(0, 10),
  }
}

function reporteConsistenciaInterna(ctx) {
  const pParticipa = preguntaEspecial(ctx, 'participa')
  const reglas = [reglaGestionVsVoto(ctx, pParticipa), reglaProbabilidadVsVoto(ctx, pParticipa), reglaNsNcConTexto(ctx, pParticipa)].filter(Boolean)
  return reglas.length ? { tipo: 'consistencia', reglas } : null
}

// ── 17. Evolución de operativo por encuestador — franja de mayor
//        actividad, horas activo, ritmo entre sesiones ──
function franjaHoraria(hora) {
  if (hora >= 8 && hora < 12) return 'Mañana'
  if (hora >= 12 && hora < 17) return 'Tarde'
  if (hora >= 17 && hora < 21) return 'Noche'
  return 'Fuera de horario'
}

function reporteEvolucionEncuestador(ctx) {
  const pParticipa = preguntaEspecial(ctx, 'participa')
  const porEncuestador = {}
  for (const fila of ctx.crudo?.filas || []) {
    if (!fila.fecha || !fila.encuestador || !esCompletada(fila, pParticipa)) continue
    porEncuestador[fila.encuestador] = porEncuestador[fila.encuestador] || []
    porEncuestador[fila.encuestador].push(fila.fecha)
  }
  const nombres = Object.keys(porEncuestador)
  if (!nombres.length) return null

  const filas = []
  const series = []
  nombres.forEach((nombre, i) => {
    const fechasISO = porEncuestador[nombre].slice().sort((a, b) => new Date(a) - new Date(b))
    const horas = fechasISO.map(horaArgentina)
    const conteoFranja = {}
    horas.forEach(h => { const f = franjaHoraria(h); conteoFranja[f] = (conteoFranja[f] || 0) + 1 })
    const franjaPrincipal = ordenarDesc(Object.entries(conteoFranja).map(([franja, n]) => ({ franja, n })), 'n')[0].franja
    const tsMs = fechasISO.map(f => new Date(f).getTime())
    const horasActivo = tsMs.length > 1 ? (tsMs[tsMs.length - 1] - tsMs[0]) / 3_600_000 : 0
    let sumaGaps = 0
    for (let j = 1; j < tsMs.length; j++) sumaGaps += (tsMs[j] - tsMs[j - 1]) / 60_000
    const promedioGap = tsMs.length > 1 ? Math.round(sumaGaps / (tsMs.length - 1)) : null
    const ritmo = promedioGap == null ? '—' : promedioGap < 20 ? 'Constante' : promedioGap <= 40 ? 'Normal' : 'Pausado'
    filas.push({
      encuestador: nombre, completadas: fechasISO.length, horas_activo: Math.round(horasActivo * 10) / 10,
      franja_principal: franjaPrincipal, promedio_gap: promedioGap ?? '—', ritmo,
    })
    const porHora = Array.from({ length: 24 }, () => 0)
    horas.forEach(h => porHora[h]++)
    let acumulado = 0
    const puntos = porHora.map((n, hora) => { acumulado += n; return { hora, acumulado } })
    series.push({ encuestador: nombre, color: PALETA_REPORTES[i % PALETA_REPORTES.length], puntos })
  })
  filas.sort((a, b) => b.completadas - a.completadas)

  return {
    columnas: [
      { key: 'encuestador', label: 'Encuestador' }, { key: 'completadas', label: 'Completadas', num: true },
      { key: 'horas_activo', label: 'Horas activo', num: true }, { key: 'franja_principal', label: 'Franja principal' },
      { key: 'promedio_gap', label: 'Promedio entre sesiones (min)', num: true }, { key: 'ritmo', label: 'Ritmo' },
    ],
    filas, series,
  }
}

// ── 18. Mapa de calor temático completo — una sección por pregunta de
//        opción múltiple relevante, con la opción ganadora por zona ──
// TODO: mapa SVG por sección — el spec original lo pide (proyectar
// encuesta_zonas.area_geojson a paths SVG), pero ese geojson no está
// disponible en este ctx, misma limitación documentada en el Reporte 15.
// Por ahora, solo la tabla.
function reporteMapaTematicoCompleto(ctx) {
  const pParticipa = preguntaEspecial(ctx, 'participa')
  const EXCLUIR = ['participa', 'edad', 'sexo', 'nivel_educativo', 'situacion_laboral']
  const preguntas = (ctx.preguntas || []).filter(p =>
    !EXCLUIR.includes(p.clave_base) && ['si_no', 'escala', 'opcion_multiple'].includes(p.tipo)
  )
  const secciones = preguntas.map(p => {
    const opciones = opcionesDe(p)
    const pSeguimiento = buscarSeguimientoOtro(ctx.preguntas, p)
    const porZona = {}
    for (const fila of ctx.crudo?.filas || []) {
      if (!esCompletada(fila, pParticipa)) continue
      const valor = valorFusionadoConSeguimiento(fila, p, opciones, pSeguimiento)
      if (!valor) continue
      const zona = fila.zona_nombre || 'Sin zona'
      porZona[zona] = porZona[zona] || {}
      porZona[zona][valor] = (porZona[zona][valor] || 0) + 1
    }
    const filas = Object.entries(porZona).map(([zona, conteo]) => {
      const total = Object.values(conteo).reduce((a, b) => a + b, 0)
      const ganador = ordenarDesc(Object.entries(conteo).map(([opcion, n]) => ({ opcion, n })), 'n')[0]
      return { zona, opcion_ganadora: ganador.opcion, pct: pct(ganador.n, total), total }
    }).sort((a, b) => b.total - a.total)
    return {
      titulo: p.texto,
      columnas: [{ key: 'zona', label: 'Zona' }, { key: 'opcion_ganadora', label: 'Opción ganadora' }, { key: 'pct', label: '%', num: true }, { key: 'total', label: 'Total respuestas', num: true }],
      filas,
    }
  }).filter(s => s.filas.length > 0)
  return secciones.length ? { secciones } : null
}

// ── 19. No-respuesta geográfica — igual que "No-respuesta por zona" (5)
//        pero con interpretación automática y síntesis al principio ──
function interpretarRechazo(tasa) {
  if (tasa < 15) return { texto: 'Normal', nota: '' }
  if (tasa < 30) return { texto: 'Elevada', nota: 'Puede indicar resistencia en esta zona.' }
  if (tasa < 50) return { texto: 'Alta', nota: 'Zona con resistencia significativa. Revisar perfil sociodemográfico.' }
  return { texto: 'Crítica', nota: 'La mayoría no quiso responder. Los datos de esta zona son poco representativos.' }
}

function reporteNoRespuestaGeografica(ctx) {
  const filas = (ctx.statsZona?.por_zona || []).map(z => {
    const tasa = pct(z.no_respuesta || 0, z.total || 0)
    const interp = interpretarRechazo(tasa)
    return {
      zona: z.zona_nombre, total: z.total || 0, completadas: z.completadas || 0, no_respuesta: z.no_respuesta || 0,
      tasa, interpretacion: interp.nota ? `${interp.texto} — ${interp.nota}` : interp.texto,
    }
  }).sort((a, b) => b.tasa - a.tasa)
  if (!filas.length) return null
  const noResp = filas.reduce((s, f) => s + f.no_respuesta, 0)
  const total = filas.reduce((s, f) => s + f.total, 0)
  const tasaGlobal = pct(noResp, total)
  const peores = filas.filter(f => f.tasa >= 30).slice(0, 3).map(f => f.zona)
  const sintesis = `La tasa de rechazo global es ${tasaGlobal}%.` +
    (peores.length ? ` Las zonas con mayor rechazo son ${peores.join(', ')}. Considerar si los datos de estas zonas son representativos antes de publicar.` : '')
  return {
    columnas: [
      { key: 'zona', label: 'Zona' }, { key: 'total', label: 'Total intentos', num: true },
      { key: 'completadas', label: 'Completadas', num: true }, { key: 'no_respuesta', label: 'No respuesta', num: true },
      { key: 'tasa', label: 'Tasa de rechazo %', num: true }, { key: 'interpretacion', label: 'Interpretación' },
    ],
    filas, sintesis,
  }
}

// ── 20. Perfil del votante por candidato — la inversa del perfil
//        demográfico: para cada candidato con ≥5 votos, quién lo vota ──
function distribucionSobre(filas, pregunta, opciones) {
  if (!pregunta) return null
  const conteo = {}
  let total = 0
  filas.forEach(fila => {
    const valor = valorFusionado(fila, pregunta, opciones)
    if (!valor) return
    conteo[valor] = (conteo[valor] || 0) + 1
    total++
  })
  if (!total) return null
  return opciones.filter(o => conteo[o]).map(o => ({ opcion: o, pct: pct(conteo[o], total) })).sort((a, b) => b.pct - a.pct)
}

function reportePerfilVotante(ctx) {
  const pCand = preguntaEspecial(ctx, 'candidato_intendente')
  if (!pCand) return null
  const pParticipa = preguntaEspecial(ctx, 'participa')
  const pEdad = preguntaEspecial(ctx, 'edad')
  const pSexo = preguntaEspecial(ctx, 'sexo')
  const pEducacion = preguntaEspecial(ctx, 'nivel_educativo')
  const pLaboral = preguntaEspecial(ctx, 'situacion_laboral')
  const opcionesCand = opcionesDe(pCand)
  const segCand = buscarSeguimientoOtro(ctx.preguntas, pCand)
  const opcionesEdad = opcionesDe(pEdad), opcionesSexo = opcionesDe(pSexo)
  const opcionesEducacion = opcionesDe(pEducacion), opcionesLaboral = opcionesDe(pLaboral)

  const completadas = (ctx.crudo?.filas || []).filter(f => esCompletada(f, pParticipa))
  const porCandidato = {}
  completadas.forEach(fila => {
    const candidato = valorFusionadoConSeguimiento(fila, pCand, opcionesCand, segCand)
    if (!candidato) return
    porCandidato[candidato] = porCandidato[candidato] || []
    porCandidato[candidato].push(fila)
  })

  const globalEdad = distribucionSobre(completadas, pEdad, opcionesEdad)
  const globalSexo = distribucionSobre(completadas, pSexo, opcionesSexo)

  const candidatos = Object.entries(porCandidato)
    .filter(([, filasCand]) => filasCand.length >= 5)
    .map(([nombre, filasCand]) => ({
      nombre, n: filasCand.length,
      edad: distribucionSobre(filasCand, pEdad, opcionesEdad),
      genero: distribucionSobre(filasCand, pSexo, opcionesSexo),
      educacion: distribucionSobre(filasCand, pEducacion, opcionesEducacion),
      laboral: distribucionSobre(filasCand, pLaboral, opcionesLaboral),
    }))
    .sort((a, b) => b.n - a.n)
  if (!candidatos.length) return null

  // Síntesis: para cada candidato, el grupo (etario o de género) con mayor
  // sobrerrepresentación respecto del perfil global de la muestra.
  const sintesisPartes = []
  candidatos.forEach(c => {
    let mejor = null
    ;[[c.edad, globalEdad], [c.genero, globalSexo]].forEach(([dist, global]) => {
      if (!dist || !global) return
      dist.forEach(d => {
        const g = global.find(x => x.opcion === d.opcion)
        const sobre = g ? d.pct - g.pct : 0
        if (sobre > 5 && (!mejor || sobre > mejor.sobre)) mejor = { opcion: d.opcion, pct: d.pct, global: g.pct, sobre }
      })
    })
    if (mejor) sintesisPartes.push(`${c.nombre} tiene sobrerrepresentación de ${mejor.opcion} (${mejor.pct}% vs ${mejor.global}% del total).`)
  })

  return { tipo: 'perfil_votante', candidatos, sintesis: sintesisPartes.join(' ') }
}

// ── Definiciones + dispatcher ──

export const REPORTES_DEFS = [
  { id: 'por_zona',            titulo: 'Por zona',                          descripcion: 'Completadas por zona, orden desc.' },
  { id: 'por_encuestador',     titulo: 'Por encuestador',                   descripcion: 'Completadas por encuestador, orden desc.' },
  { id: 'candidatos_zona',     titulo: 'Comparativo de candidatos por zona', descripcion: 'Requiere pregunta "Candidato a intendente".' },
  { id: 'completo_pregunta_zona', titulo: 'Completo por pregunta y zona',   descripcion: 'Todas las preguntas de opciones, desglosadas por zona.' },
  { id: 'no_respuesta_zona',   titulo: 'No-respuesta por zona',             descripcion: 'Tasa de rechazo por zona.' },
  { id: 'actividad_encuestador', titulo: 'Actividad por encuestador',       descripcion: 'Completadas, no-respuesta y tasa de rechazo.' },
  { id: 'evolucion_horaria',   titulo: 'Evolución horaria',                 descripcion: 'Completadas acumuladas por hora (ARG, UTC-3).' },
  { id: 'distribucion_geo',    titulo: 'Distribución geográfica',           descripcion: 'Sesiones por zona con lat/lng promedio.' },
  { id: 'perfil_demografico',  titulo: 'Perfil demográfico',                descripcion: 'Edad / género / nivel educativo / situación laboral por zona.' },
  { id: 'voto_por_perfil',     titulo: 'Intención de voto cruzada con perfil', descripcion: 'Candidato x edad x género. Requiere candidato + edad o género.' },
  { id: 'resumen_ejecutivo',   titulo: 'Resumen ejecutivo',                 descripcion: 'Una carilla con los indicadores clave, para entregar a un cliente en 30 segundos.' },
  { id: 'competitividad_zona', titulo: 'Competitividad por zona',           descripcion: 'Diferencia entre 1° y 2° candidato en cada zona, con nivel de reñidez.' },
  { id: 'agenda_tematica',     titulo: 'Agenda temática por zona',          descripcion: 'Candidato ganador y principal problema de cada zona, agrupado por candidato.' },
  { id: 'corte_generacional',  titulo: 'Corte generacional',                descripcion: 'Candidato x grupo etario, tabla de contingencia y barras apiladas.' },
  { id: 'indice_participacion', titulo: 'Índice de participación por zona', descripcion: 'Tasa de participación por zona, como indicador de subrepresentación.' },
  { id: 'consistencia_interna', titulo: 'Consistencia interna',             descripcion: 'Sesiones con combinaciones de respuestas incoherentes.' },
  { id: 'evolucion_encuestador', titulo: 'Evolución de operativo por encuestador', descripcion: 'Franja de mayor actividad, horas activo y ritmo entre sesiones.' },
  { id: 'mapa_tematico',       titulo: 'Mapa de calor temático completo',   descripcion: 'Opción ganadora por zona, una sección por pregunta.' },
  { id: 'no_respuesta_geo',    titulo: 'No-respuesta geográfica',           descripcion: 'Tasa de rechazo por zona con interpretación automática.' },
  { id: 'perfil_votante',      titulo: 'Perfil del votante por candidato',  descripcion: 'Para cada candidato con ≥5 votos, quién lo vota (edad, género, educación, situación laboral).' },
]

// ctx = { preguntas, statsZona, crudo }
// Devuelve null si el reporte no aplica a esta encuesta (p. ej. no tiene
// pregunta de candidato) — la UI debe mostrar el botón deshabilitado.
export function calcularReporte(id, ctx) {
  switch (id) {
    case 'por_zona':               return reportePorZona(ctx)
    case 'por_encuestador':        return reportePorEncuestador(ctx)
    case 'candidatos_zona':        return reporteCandidatosPorZona(ctx)
    case 'completo_pregunta_zona': return reporteCompletoPorPreguntaYZona(ctx)
    case 'no_respuesta_zona':      return reporteNoRespuestaPorZona(ctx)
    case 'actividad_encuestador':  return reporteActividadPorEncuestador(ctx)
    case 'evolucion_horaria':      return reporteEvolucionHoraria(ctx)
    case 'distribucion_geo':       return reporteDistribucionGeografica(ctx)
    case 'perfil_demografico':     return reporteDemografico(ctx)
    case 'voto_por_perfil':        return reporteVotoPorPerfil(ctx)
    case 'resumen_ejecutivo':      return reporteResumenEjecutivo(ctx)
    case 'competitividad_zona':    return reporteCompetitividadZona(ctx)
    case 'agenda_tematica':        return reporteAgendaTematica(ctx)
    case 'corte_generacional':     return reporteCorteGeneracional(ctx)
    case 'indice_participacion':   return reporteIndiceParticipacion(ctx)
    case 'consistencia_interna':   return reporteConsistenciaInterna(ctx)
    case 'evolucion_encuestador':  return reporteEvolucionEncuestador(ctx)
    case 'mapa_tematico':          return reporteMapaTematicoCompleto(ctx)
    case 'no_respuesta_geo':       return reporteNoRespuestaGeografica(ctx)
    case 'perfil_votante':         return reportePerfilVotante(ctx)
    default:                       return null
  }
}
