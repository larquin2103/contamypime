# Control de Ventas Diarias — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir en *Reportes → Ventas* el reporte «Control de Ventas Diarias» de Burger Premium: un
bloque por día y ubicación, con productos en orden alfabético y las columnas Saldo inicio · Entrada
· Salida · Merma · Venta · Ajuste · Precio · Importe · Saldo final. Todo sale del libro mayor, y el
reporte imprime sus propios controles de veracidad.

**Architecture:**
- **Lógica pura** (`src/lib/dailySalesControl.js`): calcula los días, las filas y los controles, y
  da formato al reporte. Recibe la clasificación `ledgerKey` y el precio ya inyectados.
- **`reportsService.js`**: tres funciones nuevas al final, que leen Dexie y llaman al módulo puro.
- **`ReportsScreen.jsx`**: una ficha con selectores de ubicación y categoría.

Solo lee: ninguna escritura, ni esquema, ni sincronización.

**Tech Stack:** React 18, Dexie 4, `exportExcel`/`exportPdf` existentes (xlsx/jspdf por `import()`
dinámico), pruebas `.test.mjs` con node, `fake-indexeddb` para la validación con los respaldos.

**Spec:** `docs/superpowers/specs/2026-09-24-control-ventas-diarias-design.md`

## Global Constraints

- **Columnas en este orden:** `['Producto', 'Saldo inicio', 'Entrada', 'Salida', 'Merma', 'Venta',
  'Ajuste', 'Precio', 'Importe', 'Saldo final']`.
- **Ubicación de un movimiento:** `m.location || WAREHOUSE`.
- **Ubicación de una venta:** `s.sourceLocation || s.area || WAREHOUSE`.
- **Clasificación:** el `ledgerKey` existente de `reportsService.js`, inyectado. Nunca se reescribe.
- **Ninguna cifra sale de la caché.** La caché solo aparece en el control de la caché.
- **Redondeo:** cantidades con `cleanQty` (3 decimales), dinero con `round2`.
- **Texto del PDF sin «✔»** (las fuentes estándar de jsPDF no lo tienen): se escribe «CUADRA» o
  «NO CUADRA».
- **Rango:** «Desde» obligatorio; «Hasta» vacío = el mismo día; como mucho `MAX_DAYS = 31` días.
- `src/db/`, `src/features/sync/`, `firestore.rules` y `package.json`: **diff vacío** contra `main`.
- En `reportsService.js`, **solo altas al final**: ninguna línea existente se borra ni se cambia.
- UI, comentarios y commits en español; build limpio antes de cada commit.

## Review Focus

1. **Producto por peso** (kilos con 3 decimales): la fila no puede perder los gramos ni descuadrar
   por un residuo de coma flotante. Lo prueba la Task 1, caso «peso».
2. **Movimiento sin `location`** (dato anterior al Bloque 20): cuenta en el almacén, nunca en un
   área. Lo prueba la Task 1, caso «ubicación».
3. **Una mesa que pasa de la medianoche** (consumo un día y cobro al siguiente): el control de dinero
   lo nombra como causa, en vez de dejar una diferencia sin explicar. Lo prueba la Task 1, caso
   «medianoche».
4. **Nombres duplicados** en el catálogo (La Patrona tiene 25): los dos salen como filas separadas,
   sin mezclarse. Lo prueba la Task 1, caso «duplicados».
5. **Producto dado de baja con existencia:** aparece, porque la existencia es real aunque la ficha
   esté inactiva. Lo prueba la Task 1, caso «inactivo».

---

### Task 1: Lógica pura `src/lib/dailySalesControl.js`

**Files:**
- Create: `src/lib/dailySalesControl.js`
- Test: `src/lib/dailySalesControl.test.mjs`

**Interfaces:**
- Consumes: `round2` y `formatMoney` (`./currency.js`), `cleanQty` (`./qty.js`),
  `findAtomicityBreaks` (`./atomicity.js`), `WAREHOUSE` y `ORDER_STATUS` (`../db/constants.js`).
- Produces:
  - `MAX_DAYS` (31) y `HEAD` (las 10 columnas).
  - `daysBetween(from, to): string[]`: lanza con un mensaje en español si el rango no es válido.
  - `buildDailyControl(input)`: devuelve `{ days, cacheCheck, integrity, unclassified }`.
    - `input`: `{ products, movements, sales, shifts, users, orders, priceChanges, productions,
      purchases, transfers, orderItems, location, categoryId, from, to, classify, priceOf, dayOf,
      today }`.
    - Cada día: `{ day, folios: string[], sellers: string[], rows: Row[], totals, money }`.
    - `Row`: `{ productId, name, unit, inicio, entrada, salida, merma, venta, ajuste, precio,
      importe, final }`.
    - `money`: `{ importe, consumo, diferencia, cuadra, servicio, descuento, cobrado, causas:
      string[] }`.
    - `cacheCheck`: `{ ok, diffs: [{ name, libro, cache }] }`.
    - `integrity`: `{ ok, counts: { [kind]: n } }`.
  - `dailyControlReport(result, { locationName, categoryName, from, to })`: devuelve
    `{ title, subtitle, head, rows, filename, orientation }`.

- [ ] **Paso 1: la prueba que falla** — `src/lib/dailySalesControl.test.mjs`

```js
// Pruebas PURAS del Control de Ventas Diarias (spec 2026-09-24-control-ventas-diarias-design.md).
// Sin framework: `node src/lib/dailySalesControl.test.mjs`.
//
// QUE CAZA: una fila que no cuadra; un dia que no empieza donde acabo el anterior; un
// movimiento contado en la ubicacion equivocada; una venta con el signo al reves; perder
// gramos; esconder un producto con existencia; y controles que no avisan cuando deben.
import { buildDailyControl, daysBetween, dailyControlReport, MAX_DAYS, HEAD } from './dailySalesControl.js'

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return }
  fail++
  console.error(`FAIL ${label}\n  esperado: ${expected}\n  obtenido: ${actual}`)
}
const throws = (fn, re, label) => { try { fn(); eq('no lanzo', re.source, label) } catch (e) { eq(re.test(e.message), true, `${label}: ${e.message}`) } }

const D0 = '2026-09-19', D1 = '2026-09-20', D2 = '2026-09-21', D3 = '2026-09-22'
const at = (d, h = '12') => `${d}T${h}:00:00.000Z`
const SAL = 'Salones'
// classify de prueba: el movimiento trae su clave (la real es ledgerKey, inyectada).
const classify = (m) => m.k
const dayOf = (iso) => String(iso || '').slice(0, 10)
const priceOf = (p) => p.price
const P = (id, name, extra = {}) => ({ id, name, unit: 'u', price: 50, categoryId: 'C1', active: true, stockByLocation: {}, ...extra })
const M = (productId, day, k, qty, extra = {}) => ({ id: `${productId}-${day}-${k}-${qty}-${extra.h || ''}`, productId, createdAt: at(day, extra.h || '12'), k, qty, location: SAL, type: 'x', ...extra })
const base = (over = {}) => ({
  products: [], movements: [], sales: [], shifts: [], users: [], orders: [], priceChanges: [],
  productions: [], purchases: [], transfers: [], orderItems: [],
  location: SAL, categoryId: '', from: D1, to: D2, classify, priceOf, dayOf, today: '', ...over
})

// 1. Cada clave va a su columna, la fila cuadra y el dia siguiente arranca donde acabo.
{
  const r = buildDailyControl(base({
    products: [P('a', 'Agua', { stockByLocation: { [SAL]: 9 } })],
    movements: [
      M('a', D0, 'traspIn', 5),
      M('a', D1, 'traspIn', 10), M('a', D1, 'compras', 0), M('a', D1, 'ventas', -3), M('a', D1, 'ventas', 1, { h: '13' }),
      M('a', D1, 'merma', -1), M('a', D1, 'ajustes', -2), M('a', D1, 'deuda', -1)
    ]
  }))
  const f = r.days[0].rows[0]
  eq(f.inicio, 5, 'saldo inicio = todo lo anterior al dia')
  eq(f.entrada, 10, 'entrada')
  eq(f.salida, 1, 'salida (deuda interna) en positivo')
  eq(f.merma, 1, 'merma en positivo')
  eq(f.venta, 2, 'venta neta: -3 +1 de la anulacion')
  eq(f.ajuste, -2, 'ajuste con signo')
  eq(f.final, 9, 'final = 5 + 10 - 1 - 1 - 2 - 2')
  eq(f.final, f.inicio + f.entrada - f.salida - f.merma - f.venta + f.ajuste, 'la fila cuadra')
  eq(f.importe, 100, 'importe = venta x precio')
  eq(r.days[1].rows[0].inicio, 9, 'el dia 2 empieza donde acabo el 1')
  eq(r.days[1].rows[0].final, 9, 'dia 2 sin movimientos: final = inicio')
  eq(r.cacheCheck.ok, true, 'la cache (9) coincide con el libro')
}
// 2. Ubicacion: sin location cuenta en el almacen, no en el area.
{
  const mv = [M('a', D1, 'traspIn', 4, { location: undefined })]
  eq(buildDailyControl(base({ products: [P('a', 'Agua')], movements: mv })).days[0].rows.length, 0, 'sin location: no entra en Salones')
  eq(buildDailyControl(base({ products: [P('a', 'Agua')], movements: mv, location: '__almacen' })).days[0].rows[0].entrada, 4, 'sin location: cuenta en el almacen')
}
// 3. Orden alfabetico con tildes y ene; filtro de categoria; los productos en cero no salen.
{
  const products = [P('z', 'Zeta'), P('n', 'Ñame'), P('g', 'Agua'), P('c', 'Ácido', { categoryId: 'C2' }), P('o', 'Otro')]
  const movements = ['z', 'n', 'g', 'c'].map((id) => M(id, D1, 'traspIn', 1)).concat([M('o', D3, 'traspIn', 1)])
  const r = buildDailyControl(base({ products, movements }))
  eq(r.days[0].rows.map((x) => x.name).join(','), 'Ácido,Agua,Ñame,Zeta', 'orden alfabetico es (tilde y ene)')
  eq(r.days[0].rows.some((x) => x.name === 'Otro'), false, 'movimiento fuera del rango: no sale')
  eq(buildDailyControl(base({ products, movements, categoryId: 'C1' })).days[0].rows.map((x) => x.name).join(','), 'Agua,Ñame,Zeta', 'filtro de categoria')
}
// 4. Peso: 3 decimales sin residuo ni perdida de gramos.
{
  const mv = [M('k', D1, 'traspIn', 1.125), M('k', D1, 'ventas', -0.1), M('k', D1, 'ventas', -0.2, { h: '13' })]
  const f = buildDailyControl(base({ products: [P('k', 'Queso', { unit: 'kg' })], movements: mv })).days[0].rows[0]
  eq(f.venta, 0.3, 'peso: 0.1 + 0.2 = 0.3 exacto')
  eq(f.final, 0.825, 'peso: final con sus gramos')
}
// 5. Duplicados de nombre: dos filas separadas.
{
  const r = buildDailyControl(base({ products: [P('b1', 'Bridas'), P('b2', 'Bridas')], movements: [M('b1', D1, 'traspIn', 97), M('b2', D1, 'traspIn', 13)] }))
  eq(r.days[0].rows.length, 2, 'duplicados: dos filas')
  eq(r.days[0].rows.map((x) => x.final).sort((a, b) => a - b).join(','), '13,97', 'cada una con su saldo')
}
// 6. Inactivo con existencia: aparece.
eq(buildDailyControl(base({ products: [P('i', 'Viejo', { active: false })], movements: [M('i', D0, 'traspIn', 3)] })).days[0].rows[0]?.final, 3, 'inactivo con existencia: aparece')
// 7. Cabecera: turnos de la ubicacion que tocan el dia.
{
  const r = buildDailyControl(base({
    products: [P('a', 'Agua')], movements: [M('a', D1, 'traspIn', 1)],
    users: [{ id: 'u1', name: 'Abar' }, { id: 'u2', name: 'Otro' }],
    shifts: [
      { id: 'shift-0000-abc123', area: SAL, sellerId: 'u1', openedAt: at(D1, '08'), closedAt: at(D2, '02') },
      { id: 'shift-9999-zzz999', area: 'Otra', sellerId: 'u2', openedAt: at(D1, '08'), closedAt: null }
    ]
  }))
  eq(r.days[0].folios.join(','), 'ABC123', 'folio corto del turno de la ubicacion')
  eq(r.days[0].sellers.join(','), 'Abar', 'vendedor del turno')
  eq(r.days[1].folios.join(','), 'ABC123', 'el turno que cierra el dia 2 tambien sale el dia 2')
}
// 8. Control de dinero: cuadra, y cuando no, nombra las causas (precio, medianoche, mesa abierta).
{
  const products = [P('a', 'Agua')]
  const movements = [M('a', D1, 'traspIn', 10), M('a', D1, 'ventas', -2, { type: 'sale_out', refType: 'sale', refId: 'S1' })]
  const sale = { id: 'S1', createdAt: at(D1), sourceLocation: SAL, voided: false, items: [{ productId: 'a', lineTotal: 100 }], serviceChargeAmount: 10, discountAmount: 0, totalBase: 110 }
  const ok = buildDailyControl(base({ products, movements, sales: [sale] })).days[0].money
  eq(ok.cuadra, true, 'importe 100 = consumo 100: cuadra')
  eq(ok.cobrado, 110, 'cobrado total con servicio')
  eq(ok.servicio, 10, 'servicio aparte')
  const pc = buildDailyControl(base({ products, movements, sales: [{ ...sale, items: [{ productId: 'a', lineTotal: 90 }] }], priceChanges: [{ productId: 'a', createdAt: at(D2) }] })).days[0].money
  eq(pc.cuadra, false, 'importe 100 vs consumo 90: no cuadra')
  eq(pc.diferencia, 10, 'diferencia 10')
  eq(pc.causas.some((c) => /precio/.test(c)), true, 'causa: cambio de precio')
  const orders = [{ id: 'O1', area: SAL, status: 'closed', openedAt: at(D1, '23'), closedAt: at(D2, '01') }]
  const late = buildDailyControl(base({ products, movements, sales: [{ ...sale, createdAt: at(D2, '01'), orderId: 'O1' }], orders })).days[0].money
  eq(late.causas.some((c) => /otro d[ií]a/.test(c)), true, `causa: mesa de medianoche (${late.causas.join(' | ')})`)
  const abiertas = buildDailyControl(base({ products, movements, orders: [{ id: 'O2', area: SAL, status: 'open', openedAt: at(D1) }], today: D1 })).days[0].money
  eq(abiertas.causas.some((c) => /abierta/.test(c)), true, 'causa: mesa abierta hoy')
}
// 9. Cache: la que difiere se lista.
{
  const r = buildDailyControl(base({ products: [P('a', 'Agua', { stockByLocation: { [SAL]: 7 } })], movements: [M('a', D1, 'traspIn', 9)] }))
  eq(r.cacheCheck.ok, false, 'cache distinta del libro: no ok')
  eq(`${r.cacheCheck.diffs[0].name}:${r.cacheCheck.diffs[0].libro}:${r.cacheCheck.diffs[0].cache}`, 'Agua:9:7', 'se lista con libro y cache')
}
// 10. Integridad: venta sin su movimiento en el rango.
{
  const sale = { id: 'S9', createdAt: at(D1), sourceLocation: SAL, voided: false, items: [{ productId: 'a', lineTotal: 50 }], totalBase: 50 }
  const r = buildDailyControl(base({ products: [P('a', 'Agua')], movements: [M('a', D1, 'traspIn', 1)], sales: [sale] }))
  eq(r.integrity.ok, false, 'venta sin movimiento: integridad no ok')
  eq(r.integrity.counts['sale-sin-mov'], 1, 'cuenta exacta')
  eq(r.days[0].money.causas.some((c) => /sin movimiento/.test(c)), true, 'y sale como causa del dia')
}
// 11. Clave desconocida: va a Ajuste y se cuenta (no se pierde en silencio).
{
  const r = buildDailyControl(base({ products: [P('a', 'Agua')], movements: [M('a', D1, 'raro', 4)] }))
  eq(r.days[0].rows[0].ajuste, 4, 'clave desconocida en ajuste')
  eq(r.unclassified, 1, 'y contada')
}
// 12. Rango.
throws(() => daysBetween('', ''), /Desde/, 'sin desde')
throws(() => daysBetween(D2, D1), /anterior/, 'hasta < desde')
throws(() => daysBetween('2026-01-01', '2026-03-01'), new RegExp(String(MAX_DAYS)), 'mas de 31 dias')
eq(daysBetween(D1, '').join(','), D1, 'hasta vacio = un dia')
eq(daysBetween('2026-02-27', '2026-03-01').join(','), '2026-02-27,2026-02-28,2026-03-01', 'cruza fin de mes')
throws(() => buildDailyControl(base({ location: '' })), /ubicaci/, 'sin ubicacion')
// 13. Formato del reporte.
{
  const res = buildDailyControl(base({ products: [P('a', 'Agua')], movements: [M('a', D1, 'traspIn', 1)] }))
  const rep = dailyControlReport(res, { locationName: 'Salones', categoryName: '', from: D1, to: D2 })
  eq(rep.head.join('|'), HEAD.join('|'), 'cabecera de 10 columnas')
  eq(rep.title, 'Control de Ventas Diarias', 'titulo')
  eq(rep.rows.every((r) => r.length === 10), true, 'todas las filas con 10 celdas')
  eq(rep.rows.some((r) => String(r[0]).includes(D1) && String(r[0]).includes('Entregado por')), true, 'separador de dia con cabecera')
  eq(JSON.stringify(rep.rows).includes('✔'), false, 'sin el caracter ✔ (jsPDF no lo tiene)')
  eq(rep.rows.some((r) => /CUADRA/.test(String(r[0]))), true, 'el control de dinero dice CUADRA o NO CUADRA')
}

console.log(`dailySalesControl: ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
```

- [ ] **Paso 2: ver el rojo** — `node src/lib/dailySalesControl.test.mjs` → `ERR_MODULE_NOT_FOUND`.

- [ ] **Paso 3: implementación mínima** — `src/lib/dailySalesControl.js`

```js
import { round2, formatMoney } from './currency.js'
import { cleanQty } from './qty.js'
import { findAtomicityBreaks } from './atomicity.js'
import { WAREHOUSE, ORDER_STATUS } from '../db/constants.js'

// ---------------------------------------------------------------------------
// Control de Ventas Diarias (Burger Premium; spec
// docs/superpowers/specs/2026-09-24-control-ventas-diarias-design.md). PURO.
//
// Es el documento PRIMARIO del cliente: todo sale del LIBRO MAYOR (stockMovements),
// nunca de la cache. Cada movimiento se clasifica con el ledgerKey de reportsService,
// que se INYECTA (`classify`): una sola fuente de verdad. La fila cuadra por
// construccion y el dia siguiente arranca donde acabo el anterior. El reporte imprime
// sus controles: dinero, cache e integridad del libro.
// ---------------------------------------------------------------------------
export const MAX_DAYS = 31
export const HEAD = ['Producto', 'Saldo inicio', 'Entrada', 'Salida', 'Merma', 'Venta', 'Ajuste', 'Precio', 'Importe', 'Saldo final']
const KEYS = ['compras', 'traspIn', 'producido', 'ventas', 'traspOut', 'consumo', 'deuda', 'terceros', 'merma', 'cargaIni', 'ajustes']
const emptyG = () => Object.fromEntries([...KEYS, 'otros'].map((k) => [k, 0]))
const locOf = (m) => m.location || WAREHOUSE // el criterio del submayor y de recomputeStock
const saleLocOf = (s) => s.sourceLocation || s.area || WAREHOUSE
const folioOf = (id) => String(id || '').slice(-6).toUpperCase()
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const dayMs = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))

export function daysBetween(from, to) {
  if (!DAY_RE.test(from || '')) throw new Error('Elige la fecha «Desde».')
  const end = to || from
  if (!DAY_RE.test(end)) throw new Error('La fecha «Hasta» no es válida.')
  if (end < from) throw new Error('«Hasta» es anterior a «Desde».')
  const out = []
  for (let t = dayMs(from); t <= dayMs(end); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10))
    if (out.length > MAX_DAYS) throw new Error(`El rango pasa de ${MAX_DAYS} días: acórtalo.`)
  }
  return out
}

function columnsOf(g) {
  return {
    entrada: cleanQty(g.compras + g.traspIn + g.producido),
    salida: cleanQty(-(g.traspOut + g.consumo + g.deuda + g.terceros)),
    merma: cleanQty(-g.merma),
    venta: cleanQty(-g.ventas),
    ajuste: cleanQty(g.ajustes + g.cargaIni + g.otros)
  }
}
const ZERO = { entrada: 0, salida: 0, merma: 0, venta: 0, ajuste: 0 }

export function buildDailyControl({
  products = [], movements = [], sales = [], shifts = [], users = [], orders = [], priceChanges = [],
  productions = [], purchases = [], transfers = [], orderItems = [],
  location, categoryId = '', from, to, classify, priceOf, dayOf, today = ''
} = {}) {
  if (!location) throw new Error('Elige la ubicación.')
  if (typeof classify !== 'function' || typeof priceOf !== 'function' || typeof dayOf !== 'function') {
    throw new Error('Faltan dependencias del reporte')
  }
  const days = daysBetween(from, to)
  const first = days[0]
  const last = days[days.length - 1]
  const byId = new Map(products.map((p) => [p.id, p]))
  const inCat = (pid) => !categoryId || byId.get(pid)?.categoryId === categoryId
  const nameOf = (pid) => byId.get(pid)?.name || `(producto ${String(pid).slice(0, 8)})`

  // Movimientos de ESTA ubicacion (y categoria), por producto.
  const byProd = new Map()
  for (const m of movements) {
    if (locOf(m) !== location || !inCat(m.productId)) continue
    if (!byProd.has(m.productId)) byProd.set(m.productId, [])
    byProd.get(m.productId).push(m)
  }
  const pids = [...byProd.keys()].sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'es') || (a < b ? -1 : 1))

  let unclassified = 0
  const state = new Map() // pid -> { saldo (al empezar el rango), perDay: Map(dia -> g) }
  for (const pid of pids) {
    let saldo = 0
    const perDay = new Map()
    for (const m of byProd.get(pid)) {
      const q = Number(m.qty || 0)
      const d = dayOf(m.createdAt)
      if (d < first) { saldo += q; continue }
      if (d > last) continue
      if (!perDay.has(d)) perDay.set(d, emptyG())
      const g = perDay.get(d)
      const k = classify(m)
      if (KEYS.includes(k)) g[k] += q
      else { g.otros += q; unclassified++ }
    }
    state.set(pid, { saldo: cleanQty(saldo), perDay })
  }

  // Integridad del libro (lo aprendido en Burger/La Patrona): se reutiliza atomicity.js.
  const breaks = findAtomicityBreaks({ stockMovements: movements, sales, productions, purchases, transfers, orderItems })
    .filter((b) => { const d = b.at ? dayOf(b.at) : ''; return d >= first && d <= last })
  const counts = {}
  for (const b of breaks) counts[b.kind] = (counts[b.kind] || 0) + 1
  const saleById = new Map(sales.map((s) => [s.id, s]))
  const saleSinMovByDay = new Map()
  for (const b of breaks) {
    if (b.kind !== 'sale-sin-mov') continue
    const s = saleById.get(b.id)
    if (!s || saleLocOf(s) !== location) continue
    const d = dayOf(s.createdAt)
    saleSinMovByDay.set(d, (saleSinMovByDay.get(d) || 0) + 1)
  }

  const userName = new Map(users.map((u) => [u.id, u.name]))
  const orderById = new Map(orders.map((o) => [o.id, o]))
  const outDays = []
  for (const day of days) {
    const rows = []
    const totals = { entrada: 0, salida: 0, merma: 0, venta: 0, ajuste: 0, importe: 0 }
    for (const pid of pids) {
      const st = state.get(pid)
      const g = st.perDay.get(day)
      const inicio = st.saldo
      const c = g ? columnsOf(g) : ZERO
      const final = cleanQty(inicio + c.entrada - c.salida - c.merma - c.venta + c.ajuste)
      st.saldo = final
      if (inicio === 0 && !g && final === 0) continue
      const p = byId.get(pid)
      const precio = p ? round2(priceOf(p)) : 0
      const importe = round2(c.venta * precio)
      rows.push({ productId: pid, name: nameOf(pid), unit: p?.unit || '', inicio, ...c, precio, importe, final })
      for (const k of ['entrada', 'salida', 'merma', 'venta', 'ajuste']) totals[k] = cleanQty(totals[k] + c[k])
      totals.importe = round2(totals.importe + importe)
    }

    // Cabecera: turnos de ESTA ubicacion que tocan el dia.
    const dayShifts = shifts
      .filter((s) => (s.area || WAREHOUSE) === location && dayOf(s.openedAt) <= day && (!s.closedAt || dayOf(s.closedAt) >= day))
      .sort((a, b) => (a.openedAt < b.openedAt ? -1 : 1))
    const folios = dayShifts.map((s) => folioOf(s.id))
    const sellers = [...new Set(dayShifts.map((s) => userName.get(s.sellerId) || 'Sin nombre'))]

    // Control de dinero: consumo COBRADO (lineas a precio congelado) vs suma de Importes.
    const daySales = sales.filter((s) => !s.voided && dayOf(s.createdAt) === day && saleLocOf(s) === location)
    let consumo = 0, servicio = 0, descuento = 0, cobrado = 0
    for (const s of daySales) {
      for (const it of s.items || []) if (inCat(it.productId)) consumo += Number(it.lineTotal || 0)
      servicio += Number(s.serviceChargeAmount || 0)
      descuento += Number(s.discountAmount || 0)
      cobrado += Number(s.totalBase || 0)
    }
    consumo = round2(consumo)
    const diferencia = round2(totals.importe - consumo)
    const causas = []
    if (diferencia !== 0) {
      const listed = new Set(rows.map((r) => r.productId))
      const pcs = priceChanges.filter((x) => listed.has(x.productId) && dayOf(x.createdAt) >= day)
      if (pcs.length) causas.push(`precio cambiado ese día o después en ${new Set(pcs.map((x) => x.productId)).size} producto(s): el Importe usa el precio de la ficha de hoy`)
      const cruzadas = daySales.filter((s) => s.orderId && orderById.get(s.orderId) && dayOf(orderById.get(s.orderId).openedAt) !== day).length
      const pendientes = orders.filter((o) => (o.area || WAREHOUSE) === location && dayOf(o.openedAt) === day && o.closedAt && dayOf(o.closedAt) > day).length
      if (cruzadas) causas.push(`${cruzadas} mesa(s) cobrada(s) este día con consumo de otro día`)
      if (pendientes) causas.push(`${pendientes} mesa(s) con consumo de este día cobrada(s) otro día`)
      if (day === today) {
        const abiertas = orders.filter((o) => o.status === ORDER_STATUS.OPEN && (o.area || WAREHOUSE) === location).length
        if (abiertas) causas.push(`${abiertas} mesa(s) abierta(s) ahora: consumo aún sin cobrar`)
      }
      const sm = saleSinMovByDay.get(day) || 0
      if (sm) causas.push(`${sm} venta(s) sin movimiento de stock en este aparato: la Venta del libro sale corta`)
    }
    outDays.push({
      day, folios, sellers, rows, totals,
      money: { importe: totals.importe, consumo, diferencia, cuadra: diferencia === 0, servicio: round2(servicio), descuento: round2(descuento), cobrado: round2(cobrado), causas }
    })
  }

  // Control de la cache: existencia actual segun el libro (todo el historial) vs cache.
  const diffs = []
  for (const pid of pids) {
    const libro = cleanQty(byProd.get(pid).reduce((a, m) => a + Number(m.qty || 0), 0))
    const cache = cleanQty(Number(byId.get(pid)?.stockByLocation?.[location] ?? 0))
    if (libro !== cache) diffs.push({ name: nameOf(pid), libro, cache })
  }

  return {
    days: outDays,
    cacheCheck: { ok: diffs.length === 0, diffs },
    integrity: { ok: breaks.length === 0, counts },
    unclassified
  }
}

// Formato para exportExcel/exportPdf: una sola tabla con un separador por dia,
// el total del dia y las lineas de control. 10 celdas por fila siempre.
export function dailyControlReport(result, { locationName = '', categoryName = '', from = '', to = '' } = {}) {
  const pad = (first) => [first, '', '', '', '', '', '', '', '', '']
  const fm = (n) => formatMoney(n)
  const rows = []
  for (const d of result.days) {
    rows.push(pad(`${d.day} · ID de venta: ${d.folios.join(', ') || '—'} · Entregado por: ${d.sellers.join(', ') || '—'}`))
    if (!d.rows.length) rows.push(pad('Sin existencias ni movimientos en esta ubicación'))
    for (const r of d.rows) rows.push([r.name, r.inicio, r.entrada, r.salida, r.merma, r.venta, r.ajuste, fm(r.precio), fm(r.importe), r.final])
    const t = d.totals
    rows.push(['TOTAL DEL DÍA', '', t.entrada, t.salida, t.merma, t.venta, t.ajuste, '', fm(t.importe), ''])
    const m = d.money
    rows.push(pad(`Control de dinero: Importe ${fm(m.importe)} · consumo cobrado ${fm(m.consumo)} · ${m.cuadra ? 'CUADRA' : 'NO CUADRA, diferencia ' + fm(m.diferencia)}`))
    rows.push(pad(`Cobrado total ${fm(m.cobrado)} (incluye servicio ${fm(m.servicio)} y descuentos ${fm(m.descuento)})`))
    for (const c of m.causas) rows.push(pad(`  Causa: ${c}`))
  }
  const cc = result.cacheCheck
  rows.push(pad(cc.ok ? 'Control de la caché: CUADRA (la caché coincide con el libro)' : `Control de la caché: ${cc.diffs.length} producto(s) con la caché distinta del libro (el reporte usa el libro)`))
  for (const x of cc.diffs) rows.push(pad(`  ${x.name}: libro ${x.libro} · caché ${x.cache}`))
  const it = result.integrity
  rows.push(pad(it.ok ? 'Integridad del libro: CUADRA' : `Integridad del libro: NO CUADRA — ${Object.entries(it.counts).map(([k, n]) => `${k} ${n}`).join(', ')}`))
  if (result.unclassified) rows.push(pad(`Movimientos sin clasificar (sumados en Ajuste): ${result.unclassified}`))
  const range = to && to !== from ? `${from} a ${to}` : from
  return {
    title: 'Control de Ventas Diarias',
    subtitle: `${locationName}${categoryName ? ' · ' + categoryName : ''} · ${range}`,
    head: HEAD,
    rows,
    filename: 'control_ventas_diarias',
    orientation: 'landscape'
  }
}
```

- [ ] **Paso 4: ver el verde** — `node src/lib/dailySalesControl.test.mjs` → `dailySalesControl: N OK, 0 fallos`, con el número que dé la suite.

- [ ] **Paso 5: controles negativos.** Cada uno debe hacer fallar su caso; después se restaura el
  código y se vuelve a comprobar el verde:
  - (a) `locOf = (m) => m.location`: fallan los casos 2 y 1;
  - (b) `venta: cleanQty(g.ventas)`, sin el signo: falla el caso 1;
  - (c) no encadenar los días, quitando `st.saldo = final`: falla «el dia 2 empieza donde acabo el 1»;
  - (d) `round2` en vez de `cleanQty` en `columnsOf`: falla «peso».

- [ ] **Paso 6: commit**

```bash
git add src/lib/dailySalesControl.js src/lib/dailySalesControl.test.mjs
git commit -m "Reportes - Control de Ventas Diarias (1/3): logica pura del libro mayor y controles de veracidad"
```

---

### Task 2: Funciones en `reportsService.js` y validación con los respaldos reales

**Files:**
- Modify: `src/features/reports/reportsService.js`. Solo se añade al **final** y se amplía un
  `import`. El fichero tiene un byte NUL preexistente: editarlo con la herramienta de edición y
  comprobar después con `git diff` que no hay más cambios que los esperados.
- Create: `docs/auditoria/validar-control-ventas.mjs` (fuera del bundle; se ejecuta empaquetado
  con esbuild).

**Interfaces:**
- Consumes: `buildDailyControl` y `dailyControlReport` (Task 1); del propio fichero, `ledgerKey`,
  `baseValuer`, `buildProductsLedgerSummary`, `locationLabel`, `WAREHOUSE` y `localDay`.
- Produces:
  - `loadDailyControl({ from, to, location, categoryId })`: devuelve el resultado bruto.
  - `buildDailySalesControl({ from, to, location, categoryId, divisas })`: devuelve el reporte.
  - `dailyControlLocations()`: devuelve `[{ value, label }]`, con las áreas primero, luego el
    almacén y después el resto de ubicaciones con movimientos.

- [ ] **Paso 1: el import.** En la cabecera de `reportsService.js` añadir, tras los imports
  existentes:

```js
import { buildDailyControl, dailyControlReport } from '../../lib/dailySalesControl'
```

- [ ] **Paso 2: las tres funciones, al final del fichero**

```js
// --- Control de Ventas Diarias (Burger Premium; spec 2026-09-24) ------------------
// Solo LEE. El calculo vive en lib/dailySalesControl.js (puro y probado); aqui se le
// pasan los datos y la clasificacion REAL (ledgerKey), para que sea la misma que la
// del submayor. Ninguna cifra sale de la cache.
export async function loadDailyControl({ from = '', to = '', location = '', categoryId = '' } = {}) {
  const [products, movements, sales, shifts, users, orders, priceChanges, productions, purchases, transfers, orderItems] = await Promise.all([
    db.products.toArray(), db.stockMovements.toArray(), db.sales.toArray(), db.shifts.toArray(),
    db.users.toArray(), db.orders.toArray(), db.priceChanges.toArray(), db.productions.toArray(),
    db.purchases.toArray(), db.transfers.toArray(), db.orderItems.toArray()
  ])
  const mnv = await baseValuer() // precio en MN (divisa a la tasa vigente), como el resto de reportes
  return buildDailyControl({
    products, movements, sales, shifts, users, orders, priceChanges, productions, purchases, transfers, orderItems,
    location, categoryId, from, to, classify: ledgerKey, priceOf: mnv.price, dayOf: localDay, today: localDay()
  })
}

export async function buildDailySalesControl({ from = '', to = '', location = '', categoryId = '' } = {}) {
  const result = await loadDailyControl({ from, to, location, categoryId })
  const cat = categoryId ? await db.categories.get(categoryId) : null
  return dailyControlReport(result, { locationName: locationLabel(location), categoryName: cat?.name || '', from, to })
}

// Ubicaciones que ofrece el selector: las areas configuradas primero, luego el
// almacen y despues TODA ubicacion con movimientos (para no esconder restos
// historicos, como el "Cocina" de Burger).
export async function dailyControlLocations() {
  const areas = await configRepo.getAreas()
  const seen = new Set()
  const out = []
  const add = (v) => { if (v && !seen.has(v)) { seen.add(v); out.push({ value: v, label: locationLabel(v) }) } }
  for (const a of areas) add(a)
  add(WAREHOUSE)
  const locs = new Set()
  for (const m of await db.stockMovements.toArray()) locs.add(m.location || WAREHOUSE)
  for (const l of [...locs].sort()) add(l)
  return out
}
```

- [ ] **Paso 3: comprobar que solo hay altas** —
  `git diff -U0 src/features/reports/reportsService.js | grep -a '^-' | grep -av '^---'` → **vacío**.
  Además, `npm run build` → exit 0.

- [ ] **Paso 4: el script de validación** — `docs/auditoria/validar-control-ventas.mjs`

```js
// Valida el Control de Ventas Diarias con respaldos REALES. Carga el respaldo en una
// IndexedDB simulada y compara el reporte con DOS caminos independientes:
//  (1) un recalculo ingenuo del libro por producto y dia, y
//  (2) el submayor consolidado existente (buildProductsLedgerSummary).
// Uso (empaquetado, porque reportsService importa sin extension):
//   npx esbuild docs/auditoria/validar-control-ventas.mjs --bundle --platform=node --format=esm \
//     --outfile=<scratch>/vcv.mjs && TZ=America/Havana node <scratch>/vcv.mjs <respaldo.json> [...]
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { db } from '../../src/db/db'
import { loadDailyControl, buildProductsLedgerSummary, dailyControlLocations } from '../../src/features/reports/reportsService'
import { MAX_DAYS } from '../../src/lib/dailySalesControl'
import { localDay } from '../../src/lib/dates'
import { WAREHOUSE } from '../../src/db/constants'

const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.011
let fallos = 0
const bad = (msg) => { fallos++; if (fallos <= 20) console.log('  FALLO', msg) }

for (const file of process.argv.slice(2)) {
  const bk = JSON.parse(readFileSync(file, 'utf8'))
  await db.delete(); await db.open()
  for (const [name, rows] of Object.entries(bk.tables || {})) if (db[name] && Array.isArray(rows) && rows.length) await db[name].bulkPut(rows)
  const movs = await db.stockMovements.toArray()
  const movDays = [...new Set(movs.map((m) => localDay(m.createdAt)))].sort()
  // Dias de CALENDARIO del primero al ultimo con movimientos, troceados de 31 en 31. (Trocear
  // por dias CON movimientos daria ventanas de mas de 31 dias naturales que se saltarian en
  // silencio: la validacion diria "TODO CUADRA" sin haber mirado casi nada.)
  const days = []
  for (let t = Date.parse(movDays[0] + 'T00:00:00Z'); t <= Date.parse(movDays[movDays.length - 1] + 'T00:00:00Z'); t += 86400000) days.push(new Date(t).toISOString().slice(0, 10))
  const locs = (await dailyControlLocations()).map((l) => l.value)
  console.log(`\n== ${file}\n   ${movs.length} movimientos · ${days.length} días · ubicaciones: ${locs.join(', ')}`)
  let filas = 0, ventanas = 0
  for (const location of locs) {
    const inLoc = movs.filter((m) => (m.location || WAREHOUSE) === location)
    if (!inLoc.length) continue
    for (let i = 0; i < days.length; i += MAX_DAYS) {
      const from = days[i]
      const to = days[Math.min(i + MAX_DAYS - 1, days.length - 1)]
      ventanas++
      const r = await loadDailyControl({ from, to, location })
      // (1) Recalculo ingenuo: saldo del producto al cierre de cada dia = suma de qty con dia <= dia.
      for (const d of r.days) {
        const shown = new Map(d.rows.map((x) => [x.productId, x]))
        for (const x of d.rows) {
          filas++
          if (!near(x.final, x.inicio + x.entrada - x.salida - x.merma - x.venta + x.ajuste)) bad(`${location} ${d.day} ${x.name}: la fila no cuadra`)
        }
        const byP = new Map()
        for (const m of inLoc) if (localDay(m.createdAt) <= d.day) byP.set(m.productId, (byP.get(m.productId) || 0) + Number(m.qty || 0))
        for (const [pid, s] of byP) {
          const row = shown.get(pid)
          const got = row ? row.final : 0
          if (!near(got, s)) bad(`${location} ${d.day} ${pid}: final ${got} vs libro ${s}`)
        }
      }
      for (let k = 1; k < r.days.length; k++) {
        const prev = new Map(r.days[k - 1].rows.map((x) => [x.productId, x.final]))
        for (const x of r.days[k].rows) if (!near(x.inicio, prev.get(x.productId) || 0)) bad(`${location} ${r.days[k].day} ${x.name}: inicio no es el final del dia anterior`)
      }
      // (2) Contra el submayor consolidado (otro camino de codigo), por producto ACTIVO de nombre unico.
      const sum = await buildProductsLedgerSummary({ location, from, to, detail: 'full' })
      const names = new Map()
      for (const row of sum.rows) if (row[0] !== 'TOTAL' && row[0] !== 'Sin productos') names.set(row[0], names.has(row[0]) ? null : row)
      const firstDay = r.days[0], lastDay = r.days[r.days.length - 1]
      const sumCol = (pid, key) => r.days.reduce((a, d) => a + (d.rows.find((x) => x.productId === pid)?.[key] || 0), 0)
      const products = await db.products.toArray()
      for (const p of products.filter((q) => q.active)) {
        const row = names.get(p.name)
        if (!row) continue // nombre duplicado o sin fila: no comparable por nombre
        const [, , apertura, compras, traspIn, producido, ventas, traspOut, consumo, deuda, terceros, merma, cargaIni, ajustes, existencia] = row
        const ini = firstDay.rows.find((x) => x.productId === p.id)?.inicio || 0
        const fin = lastDay.rows.find((x) => x.productId === p.id)?.final || 0
        if (!near(ini, apertura)) bad(`${location} ${p.name}: inicio ${ini} vs apertura del submayor ${apertura}`)
        if (!near(fin, existencia)) bad(`${location} ${p.name}: final ${fin} vs existencia del submayor ${existencia}`)
        if (!near(sumCol(p.id, 'entrada'), compras + traspIn + producido)) bad(`${location} ${p.name}: entrada distinta del submayor`)
        if (!near(sumCol(p.id, 'venta'), -ventas)) bad(`${location} ${p.name}: venta distinta del submayor`)
        if (!near(sumCol(p.id, 'salida'), -(traspOut + consumo + deuda + terceros))) bad(`${location} ${p.name}: salida distinta del submayor`)
        if (!near(sumCol(p.id, 'merma'), -merma)) bad(`${location} ${p.name}: merma distinta del submayor`)
        if (!near(sumCol(p.id, 'ajuste'), cargaIni + ajustes)) bad(`${location} ${p.name}: ajuste distinto del submayor`)
      }
      if (r.unclassified) bad(`${location}: ${r.unclassified} movimientos sin clasificar`)
    }
  }
  const all = await loadDailyControl({ from: days[Math.max(0, days.length - MAX_DAYS)], to: days[days.length - 1], location: WAREHOUSE })
  if (!ventanas || !filas) bad('no se comprobo nada: la validacion no puede decir que cuadra')
  console.log(`   dias ${days.length} · ventanas ${ventanas} · filas comprobadas ${filas} · integridad (últimos días, todo el aparato): ${JSON.stringify(all.integrity.counts)} · caché distinta en almacén: ${all.cacheCheck.diffs.length}`)
}
console.log(`\n${fallos ? 'FALLOS: ' + fallos : 'TODO CUADRA'}`)
if (fallos) process.exit(1)
```

- [ ] **Paso 5: correrlo** con `TZ=America/Havana` sobre los respaldos reales:
  - Burger `Downloads/respaldo_mypicuadre_2026-09-21.json` y `…22tarde.json`;
  - La Patrona A `…22dueña.json` y B `…22ventas.json`.

  Esperado:
  - **`TODO CUADRA`** en los cuatro;
  - la integridad de La Patrona A cuenta `sale-sin-mov` **8** y la de B, **0**.

  Si algo no cuadra, **parar**: usar superpowers:systematic-debugging y no tocar la prueba para que
  pase.

- [ ] **Paso 6: commit**

```bash
git add src/features/reports/reportsService.js docs/auditoria/validar-control-ventas.mjs
git commit -m "Reportes - Control de Ventas Diarias (2/3): funciones de solo lectura en reportsService y validacion con respaldos reales"
```

---

### Task 3: Ficha en *Reportes → Ventas*, invariantes y actas

**Files:**
- Modify: `src/features/reports/ReportsScreen.jsx` (imports; una entrada en la categoría
  `ventas`; el render acepta un `render` propio; componente nuevo al final)
- Modify: `CLAUDE.md` (bucle de pruebas, recuento y estado)

**Interfaces:**
- Consumes: `buildDailySalesControl` y `dailyControlLocations` (Task 2); `categoriesRepo.list()`.

- [ ] **Paso 1: imports.** Añadir `buildDailySalesControl` y `dailyControlLocations` a la lista del
  `import { … } from './reportsService'`. Añadir también
  `import { categoriesRepo } from '../../repositories/categoriesRepo'`, y ampliar la primera línea a
  `import { useEffect, useState } from 'react'`.

- [ ] **Paso 2: la entrada en la categoría `ventas`.** Añadir al array `items` de
  `{ id: 'ventas', … }`:

```js
      { key: 'dailyctl', title: 'Control de Ventas Diarias', desc: 'Por día y ubicación: saldo inicio, entradas, salidas, mermas, ventas, ajustes por conteo, precio, importe y saldo final — todo del libro mayor, con controles de dinero, caché e integridad', render: true },
```

  Y en el render, sustituir `{c.items.map((i) => card(i.key, i.title, i.desc, i.builder, i.range))}`
  por:

```jsx
            {c.items.map((i) => i.render
              ? <DailyControlCard key={i.key} title={i.title} desc={i.desc} run={run} busy={busy} />
              : card(i.key, i.title, i.desc, i.builder, i.range))}
```

- [ ] **Paso 3: el componente**, al final de `ReportsScreen.jsx`:

```jsx
// Ficha del Control de Ventas Diarias (spec 2026-09-24): usa el rango de fechas de
// arriba y añade UBICACION y CATEGORIA. Las ubicaciones se cargan UNA vez al montar
// (no en una consulta viva: seria barrer el libro entero en cada venta).
function DailyControlCard({ title, desc, run, busy }) {
  const [locs, setLocs] = useState([])
  const [location, setLocation] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const categories = useLiveQuery(() => categoriesRepo.list(), [], [])
  useEffect(() => {
    let alive = true
    dailyControlLocations()
      .then((l) => { if (alive) { setLocs(l); setLocation((cur) => cur || l[0]?.value || '') } })
      .catch((e) => logError('reportes', e))
    return () => { alive = false }
  }, [])
  const builder = (args) => buildDailySalesControl({ ...args, location, categoryId })
  return (
    <section className="card">
      <h3>{title}</h3>
      <p className="muted">{desc} (usa el rango de fechas; «Hasta» vacío = un solo día).</p>
      <label className="field"><span>Ubicación</span>
        <select value={location} onChange={(e) => setLocation(e.target.value)}>
          {locs.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
      </label>
      <label className="field"><span>Categoría</span>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Todas</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <div className="report-actions">
        <button className="btn" disabled={!!busy || !location} onClick={() => run('dailyctl', builder, 'excel')}>
          {busy === 'dailyctl-excel' ? '...' : '⬇ Excel'}
        </button>
        <button className="btn" disabled={!!busy || !location} onClick={() => run('dailyctl', builder, 'pdf')}>
          {busy === 'dailyctl-pdf' ? '...' : '⬇ PDF'}
        </button>
      </div>
    </section>
  )
}
```

- [ ] **Paso 4: invariantes.** Todos se ejecutan y se anotan con su resultado:
  - `npm run build` → exit 0, y el peso contra `main`;
  - `git diff --stat origin/main -- src/db src/features/sync firestore.rules package.json` → **vacío**;
  - `git diff -U0 origin/main -- src/features/reports/reportsService.js | grep -a '^-' | grep -av '^---'`
    → **vacío**;
  - identificadores sin definir en `dailySalesControl.js`, `reportsService.js` y `ReportsScreen.jsx`
    → 0, con control negativo;
  - el bucle de `CLAUDE.md` con la suite nueva → en verde, con el total sumado de la salida real;
  - el script de validación de la Task 2 → `TODO CUADRA` otra vez.

- [ ] **Paso 5: `CLAUDE.md`.** Añadir `src/lib/dailySalesControl.test.mjs` al bucle **con la
  herramienta de edición**, nunca con un `\n` de Python. Ejecutar el bucle copiado del propio fichero,
  comprobar que `grep -cF '\n' CLAUDE.md` da 0 y actualizar el recuento con la suma real. En
  «Estado del trabajo», una viñeta con lo hecho y lo que no se puede garantizar (spec §7).

- [ ] **Paso 6: commit y subida a la rama**

```bash
git add src/features/reports/ReportsScreen.jsx CLAUDE.md
git commit -m "Reportes - Control de Ventas Diarias (3/3): ficha en Ventas con ubicacion y categoria, invariantes y actas"
git push origin claude/awesome-dirac-484azm
```

---

### Task 4: Revisión independiente

- [ ] Revisión (superpowers:requesting-code-review, con el modelo más capaz) de todo el rango. Tiene
  que verificar:
  - la veracidad de cada columna contra `ledgerKey`;
  - que ninguna cifra sale de la caché;
  - la ubicación de movimientos y ventas;
  - los días locales y el encadenado;
  - el control de dinero con servicio y descuento;
  - que solo lee (cero escrituras);
  - que los demás reportes quedan intactos;
  - el coste de `dailyControlLocations` y de `loadDailyControl` en un libro grande;
  - la puerta de mando;
  - la sección *Review Focus* de este plan.
- [ ] Corregir con TDD lo crítico y lo importante, y registrar en el ledger las decisiones y los
  menores.
- [ ] **No fusionar a `main`**: pedir la autorización y la auditoría previa.
