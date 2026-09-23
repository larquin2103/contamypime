// Pruebas del nucleo del reenvio que compara, con una "nube" en memoria.
// Sin framework: `node src/features/sync/compareResendEngine.test.mjs`.
import { createCompareResender } from './compareResendEngine.js'

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return }
  fail++
  console.error(`FAIL ${label}\n  esperado: ${expected}\n  obtenido: ${actual}`)
}

// Montaje: local y nube como Map por coleccion. runTx llama fn con la version de
// la nube y aplica la escritura, como haria Firestore.
function harness({ local = {}, cloud = {}, online = true, ready = null, txHook } = {}) {
  const L = new Map(Object.entries(local).map(([c, rows]) => [c, new Map(rows.map((r) => [r.id, r]))]))
  const C = new Map(Object.entries(cloud).map(([c, rows]) => [c, new Map(rows.map((r) => [r.id, r]))]))
  const logs = []
  const writes = []
  const deps = {
    listLocal: async (n) => [...(L.get(n) || new Map()).values()],
    getLocal: async (n, id) => (L.get(n) || new Map()).get(id),
    pkOf: () => 'id',
    ready: async () => ready,
    isOnline: () => online,
    runTx: async (n, id, fn) => {
      if (txHook) await txHook(n, id)
      const col = C.get(n) || new Map()
      const r = await fn(col.get(id) || null)
      if (r.write) { col.set(id, r.write); C.set(n, col); writes.push(`${n}/${id}`) }
      return r.decision
    },
    log: (stage, col, err, detail) => logs.push({ stage, col, code: err?.code, detail })
  }
  return { r: createCompareResender(deps), L, C, logs, writes, deps, setOnline: (v) => { online = v } }
}
const P = (id, t, extra = {}) => ({ id, name: `P${id}`, updatedAt: t, ...extra })

// A. La nube vieja se repara; la nube mas nueva NO se toca; iguales no se escriben.
{
  const h = harness({
    local: { products: [P('1', 'T9', { price: 4600 }), P('2', 'T5'), P('3', 'T2'), P('4', 'T7')] },
    cloud: { products: [P('1', 'T3', { price: 3800 }), P('2', 'T5'), P('3', 'T8')] }
  })
  const s = await h.r.run('products', '')
  eq(JSON.stringify(s), JSON.stringify({ escritos: 2, iguales: 1, nubeMasNueva: 1, errores: 0, pendientes: 0 }), 'resumen')
  eq(h.C.get('products').get('1').price, 4600, 'la nube vieja recibe la version local')
  eq(h.C.get('products').get('3').updatedAt, 'T8', 'la nube MAS NUEVA no se toca')
  eq(h.C.get('products').has('4'), true, 'la que faltaba en la nube se escribe')
  eq(h.writes.join(','), 'products/1,products/4', 'solo se escribe lo necesario')
}
// B. Reintento de la transaccion: otro aparato escribe algo MAS NUEVO entre medias;
// la segunda llamada de fn decide sobre esa version y no escribe.
{
  let calls = 0
  const cloud = { products: [P('1', 'T3')] }
  const h = harness({ local: { products: [P('1', 'T5')] }, cloud })
  h.deps.runTx = async (n, id, fn) => {
    calls++
    const first = await fn({ ...P('1', 'T3') })     // primera pasada: la nube vieja
    if (first.write) {
      const retry = await fn({ ...P('1', 'T6') })   // contencion: Firestore repite con la nueva
      return retry.decision
    }
    return first.decision
  }
  const r2 = createCompareResender(h.deps)
  const s = await r2.run('products', '')
  eq(s.nubeMasNueva, 1, 'tras el reintento decide sobre la version nueva: nube-mas-nueva')
  eq(s.escritos, 0, 'y no cuenta como escrito')
}
// C. Se cae la red a mitad: se detiene y dice cuantos quedaron.
{
  let n = 0
  const h = harness({
    local: { counts: [P('1', 'T1'), P('2', 'T2'), P('3', 'T3'), P('4', 'T4')] },
    txHook: async () => { n++; if (n === 2) { const e = new Error('offline'); e.code = 'unavailable'; throw e } }
  })
  const s = await h.r.run('counts', '')
  eq(s.escritos, 1, 'antes del corte se escribio 1')
  eq(s.errores, 1, 'el corte cuenta como error')
  eq(s.pendientes, 2, 'quedan 2 pendientes')
  eq(h.logs.some((l) => l.stage === 'comparar-reenvio' && l.code === 'unavailable'), true, 'el corte va a /errors')
}
// Revision final (menor 3): 'deadline-exceeded' tambien es de red y corta la tanda.
{
  let n = 0
  const h = harness({
    local: { counts: [P('1', 'T1'), P('2', 'T2'), P('3', 'T3')] },
    txHook: async () => { n++; if (n === 1) { const e = new Error('lento'); e.code = 'deadline-exceeded'; throw e } }
  })
  const s = await h.r.run('counts', '')
  eq(s.pendientes, 2, 'deadline-exceeded corta: quedan 2 pendientes')
  eq(s.escritos, 0, 'y no sigue escribiendo')
}
// Un error que NO es de red se cuenta y se sigue.
{
  let n = 0
  const h = harness({
    local: { auditEvents: [{ id: '1', createdAt: 'T1' }, { id: '2', createdAt: 'T2' }] },
    txHook: async () => { n++; if (n === 1) { const e = new Error('x'); e.code = 'permission-denied'; throw e } }
  })
  const s = await h.r.run('auditEvents', '')
  eq(s.errores, 1, 'error no de red: se cuenta')
  eq(s.escritos, 1, 'y se sigue con el siguiente')
}
// D. Doble toque: la segunda tanda se rechaza mientras corre la primera.
{
  let release
  const gate = new Promise((r) => { release = r })
  const h = harness({ local: { products: [P('1', 'T1')] }, txHook: () => gate })
  const first = h.r.run('products', '')
  let msg = ''
  try { await h.r.run('products', '') } catch (e) { msg = e.message }
  eq(/ya hay una reparaci[oó]n en curso/i.test(msg), true, `segunda tanda rechazada: ${msg}`)
  release(); await first
  const again = await h.r.run('products', '')
  eq(again.iguales, 1, 'terminada la primera, se puede volver a lanzar')
}
// E. Tope por tanda, coleccion no admitida, sin red y sin sync.
{
  const many = Array.from({ length: 1001 }, (_, i) => P(String(i), `T${String(i).padStart(5, '0')}`))
  const h = harness({ local: { products: many } })
  let m = ''
  try { await h.r.run('products', '') } catch (e) { m = e.message }
  eq(/1001/.test(m) && /1000/.test(m), true, `tope: ${m}`)
  eq(h.writes.length, 0, 'con el tope superado no escribe nada')
  let m2 = ''
  try { await h.r.run('sales', '') } catch (e) { m2 = e.message }
  eq(/no se puede reparar/i.test(m2), true, `coleccion no admitida: ${m2}`)
  const off = harness({ local: { products: [P('1', 'T1')] }, online: false })
  let m3 = ''
  try { await off.r.run('products', '') } catch (e) { m3 = e.message }
  eq(/sin conexi/i.test(m3), true, `sin red no empieza: ${m3}`)
  const nosync = harness({ local: { products: [P('1', 'T1')] }, ready: 'La sincronización no está activa en este aparato' })
  let m4 = ''
  try { await nosync.r.run('products', '') } catch (e) { m4 = e.message }
  eq(/no est/i.test(m4), true, `sin sync no empieza: ${m4}`)
}
// F. La fila local desaparece entre contar y reparar: error, sin escribir.
{
  const h = harness({ local: { products: [P('1', 'T5')] } })
  h.deps.getLocal = async () => undefined
  const r3 = createCompareResender(h.deps)
  const s = await r3.run('products', '')
  eq(s.errores, 1, 'sin fila local: error')
  eq(h.writes.length, 0, 'y no escribe')
}
// G. Fecha invalida; y count es local y coincide con lo que se revisaria.
{
  const h = harness({ local: { products: [P('1', 'T1'), P('2', 'T5')] } })
  let m = ''
  try { await h.r.run('products', null) } catch (e) { m = e.message }
  eq(/fecha/i.test(m), true, `sin fecha: ${m}`)
  eq(await h.r.count('products', 'T1'), 1, 'count estricto desde T1')
  eq(await h.r.count('products', ''), 2, 'count desde vacio')
}
// Progreso
{
  const seen = []
  const h = harness({ local: { products: [P('1', 'T1'), P('2', 'T2')] } })
  await h.r.run('products', '', { onProgress: (done, total) => seen.push(`${done}/${total}`) })
  eq(seen.join(','), '1/2,2/2', 'progreso por documento')
}

console.log(`compareResendEngine: ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
