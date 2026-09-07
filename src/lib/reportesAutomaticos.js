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

// ── Helpers de preguntas ──
// Exportados también para el Reporte Visual Interactivo por Zona
// (ReporteVisualZona.jsx) — misma lógica de fusión "Otro" + detección de
// completada que ya usan los 10 reportes automáticos, para no duplicarla
// ni arriesgar que las dos vistas cuenten distinto.

export function buscarPregunta(preguntas, claveBase) {
  return (preguntas || []).find(p => p.clave_base === claveBase) || null
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
  const pCand = buscarPregunta(ctx.preguntas, 'candidato_intendente')
  if (!pCand) return null
  const pParticipa = buscarPregunta(ctx.preguntas, 'participa')
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
  const pParticipa = buscarPregunta(ctx.preguntas, 'participa')
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
  const pParticipa = buscarPregunta(ctx.preguntas, 'participa')
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
  const pParticipa = buscarPregunta(ctx.preguntas, 'participa')
  const VARIABLES = [
    ['edad', 'Edad'], ['sexo', 'Género'],
    ['nivel_educativo', 'Nivel educativo'], ['situacion_laboral', 'Situación laboral'],
  ]
  const secciones = []
  for (const [clave, titulo] of VARIABLES) {
    const p = buscarPregunta(ctx.preguntas, clave)
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
  const pCand  = buscarPregunta(ctx.preguntas, 'candidato_intendente')
  const pEdad  = buscarPregunta(ctx.preguntas, 'edad')
  const pSexo  = buscarPregunta(ctx.preguntas, 'sexo')
  if (!pCand || (!pEdad && !pSexo)) return null
  const pParticipa = buscarPregunta(ctx.preguntas, 'participa')
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
    default:                       return null
  }
}
