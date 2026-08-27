// Pruebas PURAS de la matematica del libro de custodia (modulo 'remesas').
// Sin framework: ejecutar con  `node src/lib/custodyMath.test.mjs`.
// Verifican las INVARIANTES DEL DINERO del ciclo de una remesa:
//  - Conservacion: intake -> asignar -> entregar deja central y mensajero en 0.
//  - Devolucion: intake -> asignar -> devolver deja el efectivo en la central.
//  - Multimoneda: cada moneda se lleva por separado.
//  - Idempotencia: movimientos con el MISMO id (dos dispositivos, misma operacion)
//    NO doblan el saldo tras la fusion LWW (modelada aqui con dedupeById).
import { deriveBalances, deriveHolderBalance, round2 } from './custodyMath.js'

let pass = 0
let fail = 0
const eq = (name, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp)
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${ok ? '' : `  got=${JSON.stringify(got)} exp=${JSON.stringify(exp)}`}`)
  ok ? pass++ : fail++
}
const ok = (name, cond) => eq(name, !!cond, true)

const CENTRAL = '__central'

// Generadores de movimientos, tal como los crea remittancesRepo (ids deterministas).
const intake = (r, amount, currency = 'MN') =>
  ({ id: `custody:intake:${r}`, holder: CENTRAL, direction: 'credit', amount, currency })
const assign = (r, courier, amount, currency = 'MN') => ([
  { id: `custody:assign-out:${r}`, holder: CENTRAL, direction: 'debit', amount, currency },
  { id: `custody:assign-in:${r}`, holder: courier, direction: 'credit', amount, currency }
])
const deliver = (r, courier, amount, currency = 'MN') =>
  ({ id: `custody:deliver:${r}`, holder: courier, direction: 'debit', amount, currency })
const failReturn = (r, courier, amount, currency = 'MN') => ([
  { id: `custody:return-out:${r}`, holder: courier, direction: 'debit', amount, currency },
  { id: `custody:return-in:${r}`, holder: CENTRAL, direction: 'credit', amount, currency }
])
// F4: dotar/devolver el FONDO del mensajero (central <-> mensajero, no atado a una entrega).
const fund = (courier, amount, currency = 'MN') => ([
  { id: `fund-out:${courier}:${amount}`, holder: CENTRAL, direction: 'debit', amount, currency },
  { id: `fund-in:${courier}:${amount}`, holder: courier, direction: 'credit', amount, currency }
])
const returnFund = (courier, amount, currency = 'MN') => ([
  { id: `fundret-out:${courier}:${amount}`, holder: courier, direction: 'debit', amount, currency },
  { id: `fundret-in:${courier}:${amount}`, holder: CENTRAL, direction: 'credit', amount, currency }
])

// Fusion "ultima escritura gana" por id (como pullEngine.mergeIncoming): colapsa
// los duplicados. En la app la unicidad la garantiza tambien la clave primaria.
const dedupeById = (movs) => {
  const byId = new Map()
  for (const m of movs) byId.set(m.id, m)
  return [...byId.values()]
}

// --- Derivacion basica ---
{
  const b = deriveBalances([
    { id: 'a', holder: CENTRAL, direction: 'credit', amount: 100, currency: 'MN' },
    { id: 'b', holder: CENTRAL, direction: 'debit', amount: 30, currency: 'MN' }
  ])
  eq('basico credit-debit', b, { [CENTRAL]: { MN: 70 } })
}

// --- CONSERVACION: ciclo entregado (intake -> asignar -> entregar) = 0 en ambos ---
{
  const movs = [
    intake('R1', 100, 'USD'),
    ...assign('R1', 'C1', 100, 'USD'),
    deliver('R1', 'C1', 100, 'USD')
  ]
  const b = deriveBalances(movs)
  eq('ciclo entregado: central 0', b[CENTRAL], { USD: 0 })
  eq('ciclo entregado: mensajero 0', b['C1'], { USD: 0 })
}

// --- DEVOLUCION: intake -> asignar -> devolver deja el efectivo en la central ---
{
  const movs = [
    intake('R2', 250, 'MN'),
    ...assign('R2', 'C1', 250, 'MN'),
    ...failReturn('R2', 'C1', 250, 'MN')
  ]
  const b = deriveBalances(movs)
  eq('devolucion: central recupera', b[CENTRAL], { MN: 250 })
  eq('devolucion: mensajero 0', b['C1'], { MN: 0 })
}

// --- Mensajero con carga a medias: asignadas 2, entrega 1 (aun carga la otra) ---
{
  const movs = [
    intake('A', 100, 'USD'), ...assign('A', 'C1', 100, 'USD'),
    intake('B', 60, 'USD'), ...assign('B', 'C1', 60, 'USD'),
    deliver('A', 'C1', 100, 'USD')
  ]
  eq('carga parcial: mensajero lleva 60', deriveHolderBalance(movs, 'C1'), { USD: 60 })
  eq('carga parcial: central 0', deriveBalances(movs)[CENTRAL], { USD: 0 })
}

// --- MULTIMONEDA: USD y MN por separado en el mismo mensajero ---
{
  const movs = [
    intake('U', 100, 'USD'), ...assign('U', 'C1', 100, 'USD'),
    intake('M', 500, 'MN'), ...assign('M', 'C1', 500, 'MN'),
    deliver('U', 'C1', 100, 'USD')
  ]
  eq('multimoneda: mensajero solo MN', deriveHolderBalance(movs, 'C1'), { USD: 0, MN: 500 })
}

// --- VARIOS MENSAJEROS: cada custodia es independiente ---
{
  const movs = [
    intake('X', 100, 'MN'), ...assign('X', 'C1', 100, 'MN'),
    intake('Y', 300, 'MN'), ...assign('Y', 'C2', 300, 'MN')
  ]
  const b = deriveBalances(movs)
  eq('varios: C1', b['C1'], { MN: 100 })
  eq('varios: C2', b['C2'], { MN: 300 })
  eq('varios: central 0', b[CENTRAL], { MN: 0 })
}

// --- FONDO DEL MENSAJERO (F4, cobro CONTRA ENTREGA): dotar -> repartir -> devolver ---
// El mensajero recibe un fondo (500); cada entrega se lo descuenta; al cerrar devuelve
// lo que le queda. El efectivo entregado (out) sale del sistema; el reembolso del
// remitente entra por OTRO libro (tesoreria), no aqui.
{
  const movs = [
    ...fund('C1', 500),
    deliver('R1', 'C1', 100), // entrega contra entrega: debita su fondo
    deliver('R2', 'C1', 60)
  ]
  const b = deriveBalances(movs)
  eq('fondo: al mensajero le quedan 340', b['C1'], { MN: 340 })
  eq('fondo: central desplegado -500', b[CENTRAL], { MN: -500 })
  // Devuelve lo que le queda (340): su fondo vuelve a 0 y la central sube 340.
  const b2 = deriveBalances([...movs, ...returnFund('C1', 340)])
  eq('fondo devuelto: mensajero en 0', b2['C1'], { MN: 0 })
  eq('fondo devuelto: central = -entregado (160)', b2[CENTRAL], { MN: -160 })
}

// --- IDEMPOTENCIA: el MISMO evento por duplicado (dos dispositivos) NO dobla ---
{
  const uno = [intake('R9', 100, 'USD')]
  const duplicado = [intake('R9', 100, 'USD'), intake('R9', 100, 'USD')] // mismo id
  eq('idempotencia: crudo dobla (sin dedup)', deriveBalances(duplicado)[CENTRAL], { USD: 200 })
  eq('idempotencia: con LWW por id NO dobla', deriveBalances(dedupeById(duplicado))[CENTRAL], { USD: 100 })
  // El ciclo completo duplicado tambien cuadra tras la fusion.
  const ciclo = [intake('R9', 100, 'USD'), ...assign('R9', 'C1', 100, 'USD'), deliver('R9', 'C1', 100, 'USD')]
  const cicloDup = dedupeById([...ciclo, ...ciclo])
  const b = deriveBalances(cicloDup)
  eq('idempotencia: ciclo duplicado sigue en 0', [b[CENTRAL], b['C1']], [{ USD: 0 }, { USD: 0 }])
  eq('idempotencia: no crea movimientos nuevos', cicloDup.length, ciclo.length)
}

// --- coherencia deriveHolderBalance == deriveBalances[holder] ---
{
  const movs = [intake('Z', 100, 'MN'), ...assign('Z', 'C1', 100, 'MN')]
  eq('holder == balances[holder]', deriveHolderBalance(movs, 'C1'), deriveBalances(movs)['C1'])
}

// --- round2 estable (residuos de punto flotante) ---
{
  ok('round2 0.1+0.2', round2(0.1 + 0.2) === 0.3)
}

console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
