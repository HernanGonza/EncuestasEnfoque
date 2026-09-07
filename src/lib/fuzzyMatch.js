// Matching difuso para fusionar respuestas de texto libre ("Otro") contra
// una lista de categorías conocidas (p. ej. nombres de candidatos + alias).
// Sección 8 del plan de reportes: "un matching automático (normalizado a
// minúsculas + distancia de edición tipo Levenshtein) sugiere la categoría
// para cada respuesta de texto libre nueva".
//
// No agrega ninguna dependencia nueva — la distancia de Levenshtein es
// chica y no vale la pena traer una librería para esto.

export function normalizarTexto(texto) {
  return (texto || '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita acentos (diacríticos combinantes tras NFD)
    .replace(/\s+/g, ' ')
}

// Distancia de edición estándar (inserción/borrado/sustitución = costo 1).
export function distanciaLevenshtein(a, b) {
  a = normalizarTexto(a)
  b = normalizarTexto(b)
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  const fila = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) fila[j] = j

  for (let i = 1; i <= a.length; i++) {
    let anterior = fila[0]
    fila[0] = i
    for (let j = 1; j <= b.length; j++) {
      const temp = fila[j]
      fila[j] = a[i - 1] === b[j - 1]
        ? anterior
        : 1 + Math.min(anterior, fila[j], fila[j - 1])
      anterior = temp
    }
  }
  return fila[b.length]
}

// Similitud 0..1 (1 = idéntico), normalizada por longitud — más cómoda que
// la distancia cruda para fijar un umbral de aceptación.
export function similitud(a, b) {
  const maxLen = Math.max(normalizarTexto(a).length, normalizarTexto(b).length)
  if (maxLen === 0) return 1
  return 1 - distanciaLevenshtein(a, b) / maxLen
}

// Sub-frases de 1 a 3 palabras de un texto normalizado — en la práctica
// "Otro" suele venir como "voto a Pérez" o "el de los verdes, Pérez" en vez
// del nombre solo, y comparar la frase entera contra "Pérez" da una
// distancia enorme aunque el nombre esté ahí adentro.
function fragmentosDe(texto) {
  const norm = normalizarTexto(texto)
  const palabras = norm.split(' ').filter(Boolean)
  const fragmentos = new Set([norm])
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= palabras.length; i++) {
      fragmentos.add(palabras.slice(i, i + n).join(' '))
    }
  }
  return fragmentos
}

// Busca, entre `categorias` (strings — nombre del candidato o alias), la
// que mejor matchea `texto`. Devuelve { categoria, score } o null si nada
// supera el umbral (por defecto 0.6 — bastante permisivo para tolerar
// errores de tipeo, pero no tanto como para confundir candidatos distintos).
//
// `alias` es opcional: { [categoriaCanonica]: string[] } para apodos o
// variantes de escritura conocidas de antemano (ej. "Pepe" → "José Pérez").
export function sugerirCategoria(texto, categorias, alias = {}, umbral = 0.6) {
  if (!texto || !categorias?.length) return null
  const fragmentosTexto = fragmentosDe(texto)
  if (!fragmentosTexto.size) return null

  let mejor = null
  for (const cat of categorias) {
    const candidatos = [cat, ...(alias[cat] || [])]
    for (const candidato of candidatos) {
      // Las opciones de una pregunta suelen venir como "Nombre Apellido -
      // Partido/Lista" (mucho más largas que lo que alguien tipea a mano),
      // así que también se fragmenta el lado de la categoría: comparar
      // "zapaya" contra la frase completa "quique zapaya - candidato de
      // rovira" da una similitud baja aunque el apellido esté ahí adentro,
      // pero contra el fragmento "zapaya" solo, matchea directo. Se
      // descartan fragmentos de una sola palabra muy cortos (partículas
      // como "de", "la", "por") para no generar falsos positivos.
      for (const fragCandidato of fragmentosDe(candidato)) {
        if (!fragCandidato.includes(' ') && fragCandidato.length < 4) continue
        for (const fragTexto of fragmentosTexto) {
          const score = similitud(fragTexto, fragCandidato)
          if (!mejor || score > mejor.score) mejor = { categoria: cat, score }
        }
      }
    }
  }
  return mejor && mejor.score >= umbral ? mejor : null
}
