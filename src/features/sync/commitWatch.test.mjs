// Pruebas PURAS del vigilante de lotes de subida (La Patrona §14.5, commit 2).
// Sin framework: ejecutar con  `node src/features/sync/commitWatch.test.mjs`.
//
// QUE CAZA: (1) que el vigilante altere la promesa del commit que doPush encadena
// (tiene que ser LA MISMA); (2) que lance y tumbe doPush; (3) que no avise de un
// lote que no se confirma estando EN LINEA -la hipotesis de la perdida-; (4) que
// avise sin red, donde quedar pendiente es lo normal; (5) que no sepa decir si un
// lote avisado se confirmo despues.
import { createCommitWatch } from './commitWatch.js'

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return }
  fail++
  console.error(`FAIL ${label}\n  esperado: ${expected}\n  obtenido: ${actual}`)
}
const flush = () => new Promise((r) => setImmediate(r))

// Reloj falso: los temporizadores se disparan a mano.
function harness({ online = true } = {}) {
  const timers = []
  const logs = []
  let t = 0
  const w = createCommitWatch({
    timeoutMs: 120000,
    now: () => t,
    setTimer: (fn, ms) => { const h = { fn, ms, cleared: false }; timers.push(h); return h },
    clearTimer: (h) => { if (h) h.cleared = true },
    isOnline: () => online,
    log: (stage, col, err, detail) => logs.push({ stage, col, code: err?.code, detail })
  })
  const fire = (ms) => { t += ms; for (const h of timers) if (!h.cleared && !h.fired) { h.fired = true; h.fn() } }
  return { w, timers, logs, fire, setOnline: (v) => { online = v } }
}
const slice = [{ id: 'a', ts: 'T1' }, { id: 'b', ts: 'T2' }]
const deferred = () => { let res, rej; const p = new Promise((a, b) => { res = a; rej = b }); return { p, res, rej } }

// 1. Devuelve EXACTAMENTE la misma promesa.
{
  const h = harness(); const d = deferred()
  eq(h.w('stockMovements', slice, d.p), d.p, 'devuelve la MISMA promesa (===)')
}
// 2. Confirmado a tiempo: sin avisos y el temporizador se limpia.
{
  const h = harness(); const d = deferred()
  h.w('stockMovements', slice, d.p); d.res(); await flush()
  eq(h.timers[0].cleared, true, 'a tiempo: se limpia el temporizador')
  h.fire(120000)
  eq(h.logs.length, 0, 'a tiempo: ningun aviso')
}
// 3. Sin confirmar en 2 min estando EN LINEA: aviso con coleccion, filas y rango.
{
  const h = harness(); const d = deferred()
  h.w('stockMovements', slice, d.p); h.fire(120000)
  eq(h.logs.length, 1, 'en linea y sin confirmar: un aviso')
  eq(h.logs[0].stage, 'subida-sin-confirmar', 'etapa')
  eq(h.logs[0].col, 'stockMovements', 'coleccion')
  eq(h.logs[0].code, 'en-linea', 'codigo: en linea')
  eq(/2 fila\(s\) T1\.\.T2/.test(h.logs[0].detail), true, `detalle con filas y rango: ${h.logs[0].detail}`)
  // 5. Y si luego se confirma, se dice cuanto tardo.
  d.res(); await flush()
  eq(h.logs.length, 2, 'confirmado tarde: segundo aviso')
  eq(h.logs[1].stage, 'subida-confirmada-tarde', 'etapa confirmado tarde')
  eq(h.logs[1].code, 'ok', 'confirmado tarde: ok')
}
// 4. Sin red: quedar pendiente es lo normal, no se avisa.
{
  const h = harness({ online: false }); const d = deferred()
  h.w('products', slice, d.p); h.fire(120000)
  eq(h.logs.length, 0, 'sin red: no se avisa')
  d.res(); await flush()
  eq(h.logs.length, 0, 'sin red y confirmado despues: tampoco')
}
// 6. Rechazado tarde tras el aviso: se dice que fallo. La promesa original sigue
// rechazando para quien la encadena (doPush la maneja con su .catch).
{
  const h = harness(); const d = deferred()
  const p = h.w('products', slice, d.p)
  let caught = null
  p.catch((e) => { caught = e })
  h.fire(120000)
  d.rej({ code: 'unavailable' }); await flush()
  eq(h.logs[1]?.code, 'error', 'rechazado tarde: codigo error')
  eq(caught?.code, 'unavailable', 'la promesa original rechaza igual para doPush')
}
// 7. Rechazado a tiempo: el vigilante no dice nada (eso ya lo registra onBatchError).
{
  const h = harness(); const d = deferred()
  const p = h.w('products', slice, d.p); p.catch(() => {})
  d.rej({ code: 'unavailable' }); await flush(); h.fire(120000)
  eq(h.logs.length, 0, 'rechazado a tiempo: silencio')
}
// 8. Nunca lanza: dependencias rotas o promesa ausente -> devuelve lo que recibio.
{
  const w = createCommitWatch({ setTimer: () => { throw new Error('roto') } })
  const d = deferred()
  let threw = false, got
  try { got = w('x', slice, d.p) } catch { threw = true }
  eq(threw, false, 'dependencias rotas: no lanza')
  eq(got, d.p, 'dependencias rotas: devuelve la misma promesa')
  eq(createCommitWatch()('x', slice, undefined), undefined, 'sin promesa: devuelve undefined, no lanza')
}
// 9. Slice vacio o raro: no revienta el detalle.
{
  const h = harness(); const d = deferred()
  h.w('x', null, d.p); h.fire(120000)
  eq(/0 fila\(s\)/.test(h.logs[0]?.detail || ''), true, 'slice nulo: 0 filas')
}

console.log(`commitWatch: ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
