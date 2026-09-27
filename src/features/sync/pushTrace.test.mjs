// Prueba CON BASE (fake-indexeddb) y con el doPush REAL: imprime, para cientos
// de escenarios aleatorios (semilla fija), una huella de lo que sube doPush
// (id + contenido SIN `_up`), los cursores y la cola de reintentos. Sirve para
// comparar BYTE A BYTE la subida de dos arboles (spec 2026-09-27-subida-sin-eco
// §7.3): con la bandera ausente, la rama tiene que dar la MISMA salida que main.
// No importa echoLedger a proposito: el mismo fichero corre en un arbol de main.
// Firebase se sustituye por los falsos de ./testing con --alias:
//   npx esbuild src/features/sync/pushTrace.test.mjs --bundle --platform=node --format=esm \
//     --alias:firebase/app=./src/features/sync/testing/fakeFirebaseApp.mjs \
//     --alias:firebase/auth=./src/features/sync/testing/fakeFirebaseAuth.mjs \
//     --alias:firebase/firestore=./src/features/sync/testing/fakeFirestore.mjs \
//     --outfile=<scratch>/pushTrace.bundle.mjs && node <scratch>/pushTrace.bundle.mjs
import 'fake-indexeddb/auto'
import { createHash } from 'node:crypto'
import { db } from '../../db/db'
import { pushChanges } from './pushEngine'
import { mergeIncoming } from './pullEngine'

const ESCENARIOS = 300
const NEG = 'neg-prueba'
const BASE = Date.parse('2026-09-27T10:00:00.000Z')
const iso = (k) => new Date(BASE + k * 1000).toISOString()
const COLS = [
  { name: 'products', pk: 'id' },
  { name: 'stockMovements', pk: 'id' },
  { name: 'sales', pk: 'id' },
  { name: 'orders', pk: 'id' }
]

// PRNG determinista (mulberry32): la misma semilla da el mismo escenario en
// los dos arboles.
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const entero = (r, n) => Math.floor(r() * n)

// Una fila con los campos de marca que usa cada coleccion de verdad.
function fila(col, id, k) {
  if (col === 'products') return { id, name: id, price: 10, stock: 0, updatedAt: iso(k) }
  if (col === 'stockMovements') return { id, productId: 'p-' + (k % 3), qty: 1, location: 'Salon', createdAt: iso(k) }
  if (col === 'sales') return { id, totalBase: k, items: [], createdAt: iso(k) }
  return { id, table: 'Mesa ' + (k % 4), status: 'open', openedAt: iso(k), updatedAt: iso(k) }
}
const selloDe = (col, k) => (col === 'stockMovements' || col === 'sales' ? { createdAt: iso(k) } : { updatedAt: iso(k) })

const drenar = () => new Promise((r) => setTimeout(r, 50))
const limpiar = () => Promise.all(db.tables.map((t) => t.clear()))

let invariantesRotas = 0
let totalEscrituras = 0
const lineas = []

for (let s = 0; s < ESCENARIOS; s++) {
  const r = rng(1000 + s)
  await limpiar()
  globalThis.__escrituras = []
  await db.config.bulkPut([
    { key: 'syncEnabled', value: true, updatedAt: iso(-1000) },
    { key: 'syncBusinessId', value: NEG, updatedAt: iso(-1000) }
  ])
  await db.syncState.put({ key: 'push:config', value: iso(100000) })

  const cursorInicial = {}
  for (const c of COLS) {
    if (r() < 0.2) { cursorInicial[c.name] = ''; continue }
    cursorInicial[c.name] = iso(entero(r, 20))
    await db.syncState.put({ key: `push:${c.name}`, value: cursorInicial[c.name] })
  }

  for (const c of COLS) {
    const tabla = db[c.name]
    const nFilas = entero(r, 9)
    const reintentos = []
    for (let i = 0; i < nFilas; i++) {
      const id = `${c.name}-${i}`
      const k = entero(r, 30)
      const tipo = entero(r, c.name === 'products' ? 6 : 5)
      if (tipo === 0) {
        await tabla.put(fila(c.name, id, k)) // local, nunca bajada
      } else if (tipo === 1) {
        await mergeIncoming(c, [fila(c.name, id, k)]) // bajada de otro aparato
      } else if (tipo === 2) {
        await mergeIncoming(c, [fila(c.name, id, k)]) // bajada y tocada despues
        await tabla.update(id, { nota: 'tocada', ...selloDe(c.name, k + 1 + entero(r, 5)) })
      } else if (tipo === 3) {
        await tabla.put(fila(c.name, id, k)) // local que vuelve igual por el oyente
        await mergeIncoming(c, [fila(c.name, id, k)])
      } else if (tipo === 4) {
        await tabla.put(fila(c.name, id, k + 3)) // local mas nueva; llega una vieja
        await mergeIncoming(c, [fila(c.name, id, k)])
      } else {
        await mergeIncoming(c, [fila(c.name, id, k)]) // derivado sin marca
        await tabla.update(id, { stock: 5, stockByLocation: { Salon: 5 } })
      }
      if (r() < 0.15) {
        reintentos.push({ id, attempts: 1, lastAttemptAt: 0, lastErrorCode: 'unavailable', state: r() < 0.8 ? 'active' : 'paused' })
      }
    }
    if (r() < 0.2) reintentos.push({ id: `${c.name}-fantasma`, attempts: 1, lastAttemptAt: 0, lastErrorCode: 'unavailable', state: 'active' })
    if (reintentos.length) await db.syncState.put({ key: `retry:${c.name}`, value: reintentos })
  }

  // La invariante clasica, que main y la rama cumplen con la bandera ausente:
  // toda fila con marca por encima del cursor inicial sube.
  const debenSubir = []
  for (const c of COLS) {
    for (const row of await db[c.name].toArray()) {
      const ts = [row.updatedAt, row.closedAt, row.openedAt, row.createdAt].filter((v) => typeof v === 'string').sort().pop() || ''
      if (ts && ts > cursorInicial[c.name]) debenSubir.push(`${c.name}/${row[c.pk]}`)
    }
  }

  await pushChanges()
  await drenar()

  const escritas = globalThis.__escrituras.map((w) => {
    const [, , col, id] = w.ref.split('/')
    const data = { ...w.data }
    delete data._up
    return { col, id, via: w.via, data }
  })
  totalEscrituras += escritas.length
  const escritasSet = new Set(escritas.map((e) => `${e.col}/${e.id}`))
  for (const k of debenSubir) {
    if (!escritasSet.has(k)) { invariantesRotas++; console.error('INVARIANTE ROTA', s, k) }
  }

  const cursores = {}
  const colas = {}
  for (const c of COLS) {
    cursores[c.name] = (await db.syncState.get(`push:${c.name}`))?.value || ''
    const lista = (await db.syncState.get(`retry:${c.name}`))?.value || []
    colas[c.name] = lista
      .map((e) => ({ id: e.id, attempts: e.attempts, state: e.state, code: e.lastErrorCode || '' }))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
  }
  const huella = {
    escritas: escritas
      .map((e) => JSON.stringify(e))
      .sort(),
    cursores,
    colas
  }
  lineas.push(`${s} ${createHash('sha256').update(JSON.stringify(huella)).digest('hex').slice(0, 16)}`)
}

console.log(lineas.join('\n'))
console.log(`pushTrace: ${ESCENARIOS} escenarios, ${totalEscrituras} escrituras, ${invariantesRotas} invariantes rotas`)
if (invariantesRotas) process.exit(1)
