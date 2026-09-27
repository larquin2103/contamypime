// Suite del modulo PURO de la subida sin eco (spec 2026-09-27-subida-sin-eco).
// Se corre con:  node src/features/sync/echoLedger.test.mjs
import assert from 'node:assert/strict'
import { record, split, prune, skippedCount, pendingCount, clear } from './echoLedger.js'

let n = 0
const ok = (cond, msg) => { assert.ok(cond, msg); n++ }
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++ }

const T1 = '2026-09-27T10:00:00.000Z'
const T2 = '2026-09-27T10:00:05.000Z'
const T3 = '2026-09-27T10:00:09.000Z'
// Un candidato con la forma EXACTA que le da doPush: { r, id (texto), ts }.
const cand = (id, ts) => ({ r: { id, updatedAt: ts }, id: String(id), ts })
const ids = (l) => l.map((c) => c.id)

// --- 1) Sin la bandera, la subida clasica ------------------------------------
clear()
record('products', 'id', [{ id: 'a', updatedAt: T1 }])
const off = split('products', [cand('b', T2), cand('a', T1), cand('c', T3)], false)
eq(ids(off.subir), ['b', 'a', 'c'], 'bandera apagada: sube TODO, en el mismo orden')
eq(off.saltar, [], 'bandera apagada: no se salta nada')
eq(skippedCount(), 0, 'bandera apagada: el contador no se mueve')

// --- 2) Con la bandera: se salta SOLO la version exacta que llego de la nube --
clear()
record('products', 'id', [{ id: 'a', updatedAt: T1 }, { id: 'b', createdAt: T1, updatedAt: T2 }])
const on = split('products', [cand('a', T1), cand('b', T3), cand('c', T2)], true)
eq(ids(on.saltar), ['a'], 'se salta la fila con la MISMA marca que se bajo')
eq(ids(on.subir), ['b', 'c'], 'sube la tocada despues (otra marca) y la que nunca se bajo')
eq(skippedCount(), 1, 'el contador cuenta la saltada')

// --- 3) Una marca MAS VIEJA que la anotada tambien sube -----------------------
clear()
record('orders', 'id', [{ id: 'o1', updatedAt: T2 }])
eq(ids(split('orders', [cand('o1', T1)], true).subir), ['o1'], 'marca distinta (mas vieja) -> sube')

// --- 4) La marca es la de syncTs: el mayor de los campos de marca -------------
clear()
record('orders', 'id', [{ id: 'o2', openedAt: T1, closedAt: T3, updatedAt: T2 }])
eq(ids(split('orders', [cand('o2', T3)], true).saltar), ['o2'], 'usa syncTs (aqui manda closedAt)')

// --- 5) La clave se compara como TEXTO (doPush pasa String(pk)) ---------------
clear()
record('config', 'key', [{ key: 7, updatedAt: T1 }])
eq(ids(split('config', [cand('7', T1)], true).saltar), ['7'], 'una clave no textual se anota como texto')

// --- 6) Cada coleccion tiene su propio libro ----------------------------------
clear()
record('sales', 'id', [{ id: 'x', createdAt: T1 }])
eq(ids(split('stockMovements', [cand('x', T1)], true).subir), ['x'],
  'lo anotado en sales no hace saltar nada en stockMovements')

// --- 7) Sin clave o sin marca no se anota ------------------------------------
clear()
record('sales', 'id', [null, { createdAt: T1 }, { id: 'sinMarca' }])
eq(pendingCount('sales'), 0, 'sin clave o sin marca no se anota nada')

// --- 8) prune: fuera lo que ya no puede ser candidato (<= cursor) -------------
clear()
record('sales', 'id', [{ id: 's1', createdAt: T1 }, { id: 's2', createdAt: T2 }, { id: 's3', createdAt: T3 }])
prune('sales', T2)
eq(pendingCount('sales'), 1, 'prune borra lo que esta EN o por debajo del cursor')
eq(ids(split('sales', [cand('s3', T3)], true).saltar), ['s3'], 'y conserva lo que esta por encima')
prune('sales', '')
eq(pendingCount('sales'), 1, 'un cursor vacio no borra nada')

// --- 9) Una version mas nueva sustituye a la anotada --------------------------
clear()
record('products', 'id', [{ id: 'p', updatedAt: T1 }])
record('products', 'id', [{ id: 'p', updatedAt: T2 }])
eq(ids(split('products', [cand('p', T1)], true).subir), ['p'], 'la version vieja ya no salta')
eq(ids(split('products', [cand('p', T2)], true).saltar), ['p'], 'la nueva si')

// --- 10) Entradas ilegibles no lanzan ------------------------------------------
clear()
record('products', 'id', null)
eq(split('products', null, true), { subir: [], saltar: [] }, 'lista ilegible -> nada, sin lanzar')
ok(pendingCount('nunca-vista') === 0, 'una coleccion sin anotar da 0')

console.log(`echoLedger (subida sin eco): ${n} aserciones OK`)
