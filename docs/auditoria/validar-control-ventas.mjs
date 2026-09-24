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
import { MAX_DAYS, moneyLines } from '../../src/lib/dailySalesControl'
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
  let filas = 0, ventanas = 0, cotejos = 0, dias = 0
  const causas = {}
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
      // Control de dinero (descriptivo): en TODO dia las partes impresas -precio, redondeo y
      // unidades- suman la diferencia impresa, y nada queda "sin explicar".
      for (const d of r.days) {
        dias++
        const m = d.money
        if (Math.abs(m.sinExplicar) >= 0.01) bad(`${location} ${d.day}: diferencia ${m.diferencia} con ${m.sinExplicar} SIN EXPLICAR`)
        if (Math.round((m.precio.amount + m.lineaImporte.amount + m.cantidad.amount + m.sinFicha.amount + m.redondeo + m.unidades.amount) * 100) / 100 !== m.diferencia) bad(`${location} ${d.day}: las partes no suman la diferencia`)
        if (m.lineaImporte.n) causas.lineaImporte = (causas.lineaImporte || 0) + 1
        if (m.cantidad.detalle.length) causas.cantidad = (causas.cantidad || 0) + 1
        if (m.sinFicha.n) causas.sinFicha = (causas.sinFicha || 0) + 1
        if (m.precio.n) causas.precio = (causas.precio || 0) + 1
        if (m.redondeo) causas.redondeo = (causas.redondeo || 0) + 1
        for (const g of m.unidades.grupos) causas[g.kind] = (causas[g.kind] || 0) + 1
        // DETALLE=1 imprime cada dia-ubicacion con desglose, tal cual sale en el reporte.
        if (process.env.DETALLE && (m.precio.n || m.lineaImporte.n || m.cantidad.detalle.length || m.sinFicha.n || m.unidades.grupos.length || m.redondeo)) for (const l of moneyLines(m, d.day)) console.log(`   ${location} ${d.day} | ${l}`)
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
        cotejos++
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
  if (!ventanas || !filas || !cotejos) bad('no se comprobo nada: la validacion no puede decir que cuadra')
  console.log(`   dias ${days.length} · ventanas ${ventanas} · filas comprobadas ${filas} · cotejos con el submayor ${cotejos} · dias-ubicacion con control de dinero ${dias} · desglose ${JSON.stringify(causas)} · integridad (últimos días, todo el aparato): ${JSON.stringify(all.integrity.counts)} · caché distinta en almacén: ${all.cacheCheck.diffs.length}`)
}
console.log(`\n${fallos ? 'FALLOS: ' + fallos : 'TODO CUADRA'}`)
if (fallos) process.exit(1)
