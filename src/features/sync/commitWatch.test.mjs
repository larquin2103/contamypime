// Pruebas PURAS del vigilante de lotes de subida (La Patrona §14.5, commit 2).
// Sin framework: ejecutar con  `node src/features/sync/commitWatch.test.mjs`.
//
// QUE CAZA: (1) que el vigilante altere la promesa del commit que doPush encadena
// (tiene que ser LA MISMA); (2) que lance y tumbe doPush; (3) que no avise de un
// lote que no se confirma estando EN LINEA -la hipotesis de la perdida-; (4) que
// avise sin red, donde quedar pendiente es lo normal; (5) que no sepa decir si un
// lote avisado se confirmo despues; (6, revision) que un atasco de muchas
// colecciones esconda las que importan; (7, revision) que un lote que vencio SIN
// red y luego se queda colgado CON red no deje rastro.
import { createCommitWatch, roundSummary } from './commitWatch.js'

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return }
  fail++
  console.error(`FAIL ${label}\n  esperado: ${expected}\n  obtenido: ${actual}`)
}
const flush = () => new Promise((r) => setImmediate(r))

// Reloj falso: `tick(ms)` avanza el reloj y dispara los temporizadores vencidos.
function harness({ online = true, maxRearms } = {}) {
  let t = 0
  const timers = []
  const logs = []
  const w = createCommitWatch({
    timeoutMs: 120000,
    flushMs: 2000,
    ...(maxRearms != null ? { maxRearms } : {}),
    now: () => t,
    setTimer: (fn, ms) => { const h = { fn, at: t + ms, cleared: false, fired: false }; timers.push(h); return h },
    clearTimer: (h) => { if (h) h.cleared = true },
    isOnline: () => online,
    log: (stage, col, err, detail) => logs.push({ stage, col, code: err?.code, detail })
  })
  const tick = (ms) => {
    const end = t + ms
    for (;;) {
      const due = timers.filter((h) => !h.cleared && !h.fired && h.at <= end).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      t = due.at; due.fired = true; due.fn()
    }
    t = end
  }
  return { w, timers, logs, tick, setOnline: (v) => { online = v } }
}
// Marcas con ceros a la izquierda: las reales son ISO y se ordenan bien como texto.
const S = (n, from = 1) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, ts: `T${String(from + i).padStart(2, '0')}` }))
const deferred = () => { let res, rej; const p = new Promise((a, b) => { res = a; rej = b }); return { p, res, rej } }

// 1. Devuelve EXACTAMENTE la misma promesa.
{
  const h = harness(); const d = deferred()
  eq(h.w('stockMovements', S(2), d.p), d.p, 'devuelve la MISMA promesa (===)')
}
// 2. Confirmado a tiempo: sin avisos y el temporizador se limpia.
{
  const h = harness(); const d = deferred()
  h.w('stockMovements', S(2), d.p); d.res(); await flush()
  eq(h.timers[0].cleared, true, 'a tiempo: se limpia el temporizador')
  h.tick(600000)
  eq(h.logs.length, 0, 'a tiempo: ningun aviso')
}
// 3. Sin confirmar en 2 min EN LINEA: UN aviso agregado con coleccion, filas y rango.
{
  const h = harness(); const d = deferred()
  h.w('stockMovements', S(2), d.p); h.tick(122000)
  eq(h.logs.length, 1, 'en linea y sin confirmar: un aviso')
  eq(h.logs[0].stage, 'subida-sin-confirmar', 'etapa')
  eq(h.logs[0].code, 'en-linea', 'codigo: en linea')
  eq(h.logs[0].col, null, 'agregado: sin coleccion en la clave')
  eq(h.logs[0].detail, '1 coleccion(es), 2 fila(s), T01..T02: stockMovements:2', `detalle: ${h.logs[0].detail}`)
  // 5. Y si luego se confirma, se dice cuanto tardo.
  d.res(); await flush(); h.tick(2000)
  eq(h.logs.length, 2, 'confirmado tarde: segundo aviso')
  eq(h.logs[1].stage, 'subida-confirmada-tarde', 'etapa confirmado tarde')
  eq(/stockMovements:ok/.test(h.logs[1].detail) && /122 s/.test(h.logs[1].detail), true, `confirmado tarde: resultado y tiempo: ${h.logs[1].detail}`)
}
// 6 (revision). Atasco de MUCHAS colecciones: todas en UN aviso, ninguna oculta.
{
  const h = harness()
  const cols = ['users', 'config', 'exchangeRates', 'categories', 'products', 'priceChanges', 'shifts', 'sales', 'stockMovements', 'purchases', 'transfers', 'productions']
  cols.forEach((c, i) => h.w(c, S(1, i + 1), deferred().p))
  h.tick(122000)
  eq(h.logs.length, 1, 'doce colecciones atascadas: un solo aviso')
  for (const c of ['products', 'stockMovements', 'purchases', 'transfers', 'productions']) eq(h.logs[0].detail.includes(`${c}:1`), true, `aparece ${c}`)
  eq(h.logs[0].detail.startsWith('12 coleccion(es), 12 fila(s), T01..T12'), true, `resumen: ${h.logs[0].detail}`)
}
// El resumen nunca pasa de su tope y dice cuantas se quedaron fuera.
{
  const items = Array.from({ length: 60 }, (_, i) => ({ col: `coleccionLarga${i}`, rows: 3, first: 'A', last: 'Z' }))
  const s = roundSummary(items, 200)
  eq(s.length <= 200, true, `resumen acotado (${s.length})`)
  eq(/\(\+\d+ mas\)$/.test(s), true, `marca las que no caben: ${s.slice(-20)}`)
  eq(roundSummary([], 200), '0 coleccion(es), 0 fila(s), ..: ', 'resumen vacio no revienta')
}
// 4. Sin red al vencer: no se avisa entonces...
{
  const h = harness({ online: false }); const d = deferred()
  h.w('products', S(1), d.p); h.tick(122000)
  eq(h.logs.length, 0, 'sin red: no se avisa')
  d.res(); await flush(); h.tick(600000)
  eq(h.logs.length, 0, 'sin red y confirmado despues: tampoco')
}
// 7 (revision). ...pero se REARMA: vuelve la red, sigue colgado -> avisa, con una
// ventana de gracia tras reconectar (no se marca un lote que acaba de volver).
{
  const h = harness({ online: false }); const d = deferred()
  h.w('stockMovements', S(3), d.p)
  h.tick(120000)             // vence sin red -> rearma
  h.setOnline(true)
  h.tick(120000)             // primera comprobacion con red tras estar sin ella: gracia
  h.tick(2000)               // se mira DESPUES del volcado del agregado (flushMs), si no no mide
  eq(h.logs.length, 0, 'recien reconectado: gracia, no avisa')
  h.tick(120000)             // sigue colgado con red
  eq(h.logs.length, 1, 'vencio sin red, volvio la red y sigue colgado: AVISA')
  eq(h.logs[0].detail.includes('stockMovements:3'), true, 'con su coleccion')
}
// Los rearmes tienen tope: no queda un temporizador vivo para siempre.
{
  const h = harness({ online: false, maxRearms: 3 })
  h.w('products', S(1), deferred().p)
  h.tick(24 * 3600000)
  eq(h.timers.length, 4, 'tope de rearmes: 1 + 3 temporizadores y ninguno mas')
}
// 8. Rechazado tarde tras el aviso: se dice que fallo; la promesa original sigue
// rechazando para quien la encadena (doPush la maneja con su .catch).
{
  const h = harness(); const d = deferred()
  const p = h.w('products', S(1), d.p)
  let caught = null
  p.catch((e) => { caught = e })
  h.tick(122000)
  d.rej({ code: 'unavailable' }); await flush(); h.tick(2000)
  eq(/products:error/.test(h.logs[1]?.detail || ''), true, 'rechazado tarde: products:error')
  eq(caught?.code, 'unavailable', 'la promesa original rechaza igual para doPush')
}
// 9. Rechazado a tiempo: el vigilante no dice nada (eso ya lo registra onBatchError).
{
  const h = harness(); const d = deferred()
  const p = h.w('products', S(1), d.p); p.catch(() => {})
  d.rej({ code: 'unavailable' }); await flush(); h.tick(600000)
  eq(h.logs.length, 0, 'rechazado a tiempo: silencio')
}
// 10. Nunca lanza: dependencias rotas, promesa ausente o un then que lanza.
{
  const w = createCommitWatch({ setTimer: () => { throw new Error('roto') } })
  const d = deferred()
  let threw = false, got
  try { got = w('x', S(1), d.p) } catch { threw = true }
  eq(threw, false, 'dependencias rotas: no lanza')
  eq(got, d.p, 'dependencias rotas: devuelve la misma promesa')
  eq(createCommitWatch()('x', S(1), undefined), undefined, 'sin promesa: devuelve undefined, no lanza')
  const raro = { then() { throw new Error('then roto') } }
  let t2 = false, g2
  try { g2 = createCommitWatch({ setTimer: () => 0, clearTimer: () => {} })('x', S(1), raro) } catch { t2 = true }
  eq(t2, false, 'un then que lanza: no lanza')
  eq(g2, raro, 'un then que lanza: devuelve lo mismo')
}
// 11. Slice nulo: no revienta el detalle.
{
  const h = harness(); const d = deferred()
  h.w('x', null, d.p); h.tick(122000)
  eq(h.logs[0]?.detail.includes('x:0'), true, `slice nulo: x:0 (${h.logs[0]?.detail})`)
}

console.log(`commitWatch: ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
