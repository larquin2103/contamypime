// ---------------------------------------------------------------------------
// Subida sin eco (spec docs/superpowers/specs/2026-09-27-subida-sin-eco-design.md).
// MODULO PURO: sin Dexie, sin Firestore, sin React. Se prueba entero con node.
//
// El eco: la bajada no mueve el cursor de subida (`push:<col>`), asi que doPush
// volvia a subir las filas que acababa de bajar de otro aparato. Aqui se anota
// la VERSION (id + syncTs) de cada fila que la bajada metio en Dexie, y la
// subida se salta una fila SOLO si sigue teniendo exactamente esa version: la
// nube ya la tiene, porque de ahi vino. Cualquier cambio local mueve syncTs
// (regla de la casa: toda mutacion sella su marca) y sube como siempre.
//
// Vive en MEMORIA de la sesion (decision E3 del dueño): cero escrituras a
// Dexie y nada en respaldos. Cerrar la app entre bajar y subir solo hace que
// esas filas hagan eco como antes, que es el lado seguro.
// ---------------------------------------------------------------------------
import { syncTs } from './collections.js'

const anotado = new Map() // colName -> Map(id en texto -> syncTs)
let saltadas = 0

const deColeccion = (colName) => {
  let m = anotado.get(colName)
  if (!m) {
    m = new Map()
    anotado.set(colName, m)
  }
  return m
}

// Se anota SIEMPRE, con o sin la bandera: es memoria invisible, y asi las
// tandas que llegan al arrancar, antes del primer doPush, no se quedan sin
// anotar. Lo que cambia la conducta —que se escribe en la nube— es `split`.
export function record(colName, pk, filas) {
  if (!Array.isArray(filas) || !filas.length) return
  const m = deColeccion(colName)
  for (const f of filas) {
    if (!f || f[pk] == null) continue
    const ts = syncTs(f)
    if (ts) m.set(String(f[pk]), ts)
  }
}

// `candidatos` son los `nuevos` de doPush: [{ r, id, ts }], con `id` ya en
// texto. Con `enabled` falso devuelve la lista ENTERA en `subir` y en el mismo
// orden: la subida clasica, sin tocar.
export function split(colName, candidatos, enabled) {
  const lista = Array.isArray(candidatos) ? candidatos : []
  if (!enabled) return { subir: lista, saltar: [] }
  const m = anotado.get(colName)
  if (!m || !m.size) return { subir: lista, saltar: [] }
  const subir = []
  const saltar = []
  for (const c of lista) {
    if (c && c.ts && m.get(String(c.id)) === c.ts) saltar.push(c)
    else subir.push(c)
  }
  saltadas += saltar.length
  return { subir, saltar }
}

// Borra lo que ya nunca podra ser candidato (marca <= cursor): el mapa queda
// del tamaño de lo bajado desde la ultima subida.
export function prune(colName, cursor) {
  const m = anotado.get(colName)
  if (!m || !cursor) return
  for (const [id, ts] of m) if (ts <= cursor) m.delete(id)
}

// Cuantas filas se dejaron de reenviar en esta sesion (lo muestra /cloud).
export const skippedCount = () => saltadas

export const pendingCount = (colName) => anotado.get(colName)?.size || 0

// Para las pruebas: deja el modulo como recien cargado.
export function clear() {
  anotado.clear()
  saltadas = 0
}
