// Busqueda agil del catalogo (400+ productos).
// Normalizamos sin acentos y en minusculas. Tokenizamos nombre + codigo para
// permitir busqueda por 3 letras o por codigo. Con ~400 productos cabe todo en
// memoria y el filtrado es instantaneo en gama media.

export function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

// Tokens que se guardan en product.searchTokens (indice multiEntry).
export function buildSearchTokens(name, code) {
  const tokens = new Set()
  const normName = normalize(name)
  for (const word of normName.split(/\s+/)) {
    if (word) tokens.add(word)
  }
  const normCode = normalize(code)
  if (normCode) tokens.add(normCode)
  return [...tokens]
}

// Filtra una lista de productos (en memoria) por consulta.
// Coincide si: el codigo incluye la consulta, o alguna palabra del nombre
// empieza por la consulta.
export function matchesQuery(product, rawQuery) {
  const q = normalize(rawQuery)
  if (!q) return true
  if (normalize(product.code).includes(q)) return true
  const tokens = product.searchTokens || buildSearchTokens(product.name, product.code)
  return tokens.some((t) => t.startsWith(q))
}
