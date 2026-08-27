// Pruebas PURAS de la custodia de PRODUCTO del mensajero (modulo 'remesas', F6).
// Sin framework: `node src/lib/productCustodyMath.test.mjs`. Verifican el ciclo:
// CARGAR (area Entregas -> mensajero) -> ENTREGAR (mensajero -> beneficiario) ->
// DEVOLVER (mensajero -> area Entregas), y que la fusion por id no duplique.
import { deriveProductBalances, deriveHolderProducts, cleanQty } from './productCustodyMath.js'

let pass = 0
let fail = 0
const eq = (name, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp)
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${ok ? '' : `  got=${JSON.stringify(got)} exp=${JSON.stringify(exp)}`}`)
  ok ? pass++ : fail++
}

// Generadores (qty con signo), como los crea remittancesRepo.
const load = (courier, productId, qty) => ({ id: `pc:load:${courier}:${productId}`, holder: courier, productId, qty })
const deliver = (courier, productId, qty, r = 'R') => ({ id: `pc:deliver:${r}`, holder: courier, productId, qty: -qty })
const ret = (courier, productId, qty) => ({ id: `pc:ret:${courier}:${productId}`, holder: courier, productId, qty: -qty })

const dedupeById = (movs) => {
  const byId = new Map()
  for (const m of movs) byId.set(m.id, m)
  return [...byId.values()]
}

// --- CARGA parcial: carga 10, entrega 4 -> lleva 6 ---
{
  const movs = [load('C1', 'P1', 10), deliver('C1', 'P1', 4, 'R1')]
  eq('carga: mensajero lleva 6', deriveHolderProducts(movs, 'C1'), { P1: 6 })
}

// --- CICLO COMPLETO: carga 10, entrega 6, devuelve 4 -> lleva 0 (omitido) ---
{
  const movs = [load('C1', 'P1', 10), deliver('C1', 'P1', 6, 'R1'), ret('C1', 'P1', 4)]
  eq('ciclo: mensajero en 0 (sin claves)', deriveHolderProducts(movs, 'C1'), {})
  eq('ciclo: balances sin el tenedor vacio', deriveProductBalances(movs), {})
}

// --- MULTIPRODUCTO: dos productos por separado ---
{
  const movs = [load('C1', 'P1', 10), load('C1', 'P2', 5), deliver('C1', 'P1', 10, 'R1')]
  eq('multiproducto: solo queda P2', deriveHolderProducts(movs, 'C1'), { P2: 5 })
}

// --- VARIOS MENSAJEROS: cada custodia independiente ---
{
  const movs = [load('C1', 'P1', 3), load('C2', 'P1', 7)]
  const b = deriveProductBalances(movs)
  eq('varios: C1 lleva 3', b['C1'], { P1: 3 })
  eq('varios: C2 lleva 7', b['C2'], { P1: 7 })
}

// --- IDEMPOTENCIA: la MISMA carga por duplicado (dos dispositivos) NO dobla ---
{
  const dup = [load('C1', 'P1', 10), load('C1', 'P1', 10)] // mismo id
  eq('idempotencia: crudo dobla', deriveHolderProducts(dup, 'C1'), { P1: 20 })
  eq('idempotencia: con LWW por id NO dobla', deriveHolderProducts(dedupeById(dup), 'C1'), { P1: 10 })
}

// --- cleanQty estable con fracciones ---
{
  eq('cleanQty 0.1+0.2', cleanQty(0.1 + 0.2), 0.3)
}

console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
