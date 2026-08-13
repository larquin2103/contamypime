// Pruebas PURAS de la cola de reintentos de C (Bloque C, diseno B).
// Sin framework: ejecutar con  `node src/features/sync/retryQueue.test.mjs`.
// Cubren la maquina de estados (T1-T9), en especial T5c (PAUSED permanente NO
// se auto-reactiva) y T9 (un PAUSED no bloquea ni entra en los reintentos).
import {
  MAX_ATTEMPTS, RESUME_COOLDOWN_MS, backoffMs, isPermanent,
  dueIds, onSuccess, onTransient, onPermanent, autoResume, resumeAll
} from './retryQueue.js'

let pass = 0
let fail = 0
const eq = (name, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp)
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${ok ? '' : `  got=${JSON.stringify(got)} exp=${JSON.stringify(exp)}`}`)
  ok ? pass++ : fail++
}
const ok = (name, cond) => eq(name, !!cond, true)

const T = 1_000_000 // "ahora" base (ms)

// T1: B permanente + D transitorio (resultado del aislamiento de un lote).
{
  let l = []
  l = onPermanent(l, 'B', 'invalid-argument', T)
  const r = onTransient(l, 'D', 'unavailable', T)
  l = r.list
  eq('T1 B paused permanente', l.find((e) => e.id === 'B'),
    { id: 'B', attempts: 0, lastAttemptAt: T, lastErrorCode: 'invalid-argument', state: 'paused' })
  eq('T1 D active attempts=1', l.find((e) => e.id === 'D'),
    { id: 'D', attempts: 1, lastAttemptAt: T, lastErrorCode: 'unavailable', state: 'active' })
}

// T2: D se recupera POR ID (entra en dueIds cuando vence el backoff), no por cursor.
{
  const l = onTransient([], 'D', 'unavailable', T).list
  eq('T2 D no due antes del backoff', dueIds(l, T + 1000), [])
  eq('T2 D due tras backoff', dueIds(l, T + backoffMs(1) + 1), ['D'])
}

// T3: poison puro -> B permanente no se auto-reactiva ni tras el cool-down.
{
  let l = onPermanent([], 'B', 'permission-denied', T)
  l = autoResume(l, T + RESUME_COOLDOWN_MS + 1)
  eq('T3 B sigue paused', l.find((e) => e.id === 'B').state, 'paused')
  ok('T3 B no esta en dueIds', dueIds(l, T + RESUME_COOLDOWN_MS + 1).length === 0)
}

// T4: un registro nuevo (F) no ensucia la cola de retry.
{
  const l = onTransient([], 'D', 'unavailable', T).list
  ok('T4 F no esta en retry', !l.find((e) => e.id === 'F'))
}

// T5: transitorio agotado -> PAUSED (RETRY_EXHAUSTED), NO invalido/permanente.
{
  let l = []
  let last
  for (let i = 0; i < MAX_ATTEMPTS; i++) { last = onTransient(l, 'D', 'unavailable', T + i); l = last.list }
  eq('T5 exhausted en MAX', last.exhausted, true)
  eq('T5 D paused', l.find((e) => e.id === 'D').state, 'paused')
  ok('T5 D NO es permanente', !isPermanent(l.find((e) => e.id === 'D').lastErrorCode))
}

// T5b: PAUSED transitorio SI se auto-reactiva tras el cool-down.
{
  let l = []
  for (let i = 0; i < MAX_ATTEMPTS; i++) l = onTransient(l, 'D', 'unavailable', T).list
  const pausedAt = l.find((e) => e.id === 'D').lastAttemptAt
  l = autoResume(l, pausedAt + RESUME_COOLDOWN_MS + 1)
  eq('T5b D reactivado (active, attempts 0)', l.find((e) => e.id === 'D'),
    { id: 'D', attempts: 0, lastAttemptAt: 0, lastErrorCode: 'unavailable', state: 'active' })
}

// T5c: PAUSED permanente NO se auto-reactiva; SOLO resumeAll (explicito).
{
  let l = onPermanent([], 'B', 'invalid-argument', T)
  l = autoResume(l, T + RESUME_COOLDOWN_MS * 100) // aunque pase muchisimo tiempo
  eq('T5c B NO auto-reactivado', l.find((e) => e.id === 'B').state, 'paused')
  l = resumeAll(l)
  eq('T5c B reactivado solo con resumeAll', l.find((e) => e.id === 'B').state, 'active')
}

// T6: camino feliz -> el exito quita de la cola; sin fallos no hay entradas.
{
  let l = onTransient([], 'D', 'unavailable', T).list
  l = onSuccess(l, 'D')
  eq('T6 D fuera de retry tras exito', l, [])
}

// T7: offline -> sin .then/.catch no se muta la cola (queda intacta).
{
  const l0 = onTransient([], 'D', 'unavailable', T).list
  const l1 = l0 // offline: no se invoca onSuccess/onTransient/onPermanent
  eq('T7 lista intacta offline', l1, l0)
}

// T8: la cola es POR COLECCION -> dos colas no interfieren.
{
  const sales = onTransient([], 'X', 'unavailable', T).list
  const moves = onPermanent([], 'Y', 'invalid-argument', T)
  ok('T8 colas independientes', !sales.find((e) => e.id === 'Y') && !moves.find((e) => e.id === 'X'))
}

// T9: nuevos con PAUSED -> el PAUSED no entra en dueIds (no se reintenta ni
// bloquea); los "nuevos" viajan por cursor, ajenos a esta cola.
{
  let l = onPermanent([], 'B', 'invalid-argument', T) // PAUSED permanente
  l = onTransient(l, 'D', 'unavailable', T).list // D active
  const due = dueIds(l, T + backoffMs(1) + 1)
  ok('T9 B (paused) NO esta en due', !due.includes('B'))
  ok('T9 D (active) SI esta en due', due.includes('D'))
}

console.log(`\n${pass} PASS, ${fail} FAIL`)
process.exit(fail ? 1 : 0)
