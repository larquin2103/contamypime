// Fuzz de VERDAD CONOCIDA del control de dinero del Control de Ventas Diarias. Sin framework:
// `node src/lib/dailySalesControl.fuzz.test.mjs`. Semilla fija: es determinista.
//
// El generador crea HECHOS (consumos, anulaciones con y sin linea, cobros, ventas directas,
// lineas de todo tipo) en 3 dias y calcula POR SU CUENTA lo que el reporte debe imprimir; no
// reutiliza la logica del modulo. Comprueba el valor de CADA parte del desglose, los grupos con
// sus hechos y que el redondeo quede acotado. Nacio de cinco revisiones independientes: cubre a
// proposito los casos que cada una encontro (duplicados, anulaciones tras el cobro, lineas
// incoherentes, pesadas, fichas de 3 decimales, divisa sin tasa, 4 decimales, sin catalogo).
import { buildDailyControl } from './dailySalesControl.js'

const SAL = 'S', OTRA = '__almacen', DAYS = ['2026-09-19', '2026-09-20', '2026-09-21']
const r2 = (x) => Math.round(x * 100) / 100
const q3 = (x) => { const r = Math.round((x + Number.EPSILON) * 1000) / 1000; return Object.is(r, -0) ? 0 : r } // = cleanQty
const q6 = (x) => Math.round(x * 1e6) / 1e6
let pass = 0, fail = 0, shown = 0
const seen = {}

function run(seed0, N, CATF) {
  let seed = seed0
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))
  for (let t = 0; t < N; t++) {
    let clock = 0
    const ts = (d) => { clock += 1; return `${DAYS[d]}T${String(8 + Math.floor(clock / 60) % 14).padStart(2, '0')}:${String(clock % 60).padStart(2, '0')}:00.000Z` }
    const products = [], movements = [], sales = [], orders = [], orderItems = []
    const F = {} // ficha TAL CUAL (lo que devuelve priceOf); el Importe usa r2(F)
    const np = ri(1, 4)
    for (let i = 0; i < np; i++) {
      const id = 'p' + i
      const r = rnd()
      // A veces ficha de 3 decimales; a veces producto en divisa SIN tasa (priceOf -> 0).
      const usd = r < 0.08
      F[id] = usd ? 0 : r < 0.2 ? Math.round((1 + rnd() * 60) * 1000) / 1000 : r2(1 + rnd() * 60)
      products.push({ id, name: 'P' + i, unit: rnd() < 0.4 ? 'kg' : 'u', price: usd ? 10 : F[id], ...(usd ? { priceCurrency: 'USD' } : {}), categoryId: rnd() < 0.5 ? 'C' : 'D', active: true, stockByLocation: {} })
      movements.push({ id: 'in' + i, productId: id, createdAt: `${DAYS[0]}T00:00:00.000Z`, k: 'traspIn', qty: 1000, location: SAL })
    }
    const pids = Object.keys(F)
    if (rnd() < 0.3) { F.zz = 0; pids.push('zz') } // producto fuera del catalogo del aparato
    const prod = (pid) => products.find((p) => p.id === pid)
    const inC = (pid) => !CATF || prod(pid)?.categoryId === CATF
    const isKg = (pid) => prod(pid)?.unit === 'kg'
    const sinFicha = (pid) => !prod(pid) || !!prod(pid).priceCurrency
    const qOf = (pid) => (isKg(pid) ? (rnd() < 0.15 ? Math.max(0.0001, Math.round(rnd() * 20000) / 10000) : Math.max(0.001, q3(rnd() * 2))) : ri(1, 3))
    const T = DAYS.map(() => ({ precio: 0, precioN: 0, linea: 0, lineaN: 0, sinFicha: 0, sinFichaN: 0, fichaDec: new Map(), raw: new Map(), g: new Map() }))
    const RAW = (d, pid, q) => { if (inC(pid)) T[d].raw.set(pid, (T[d].raw.get(pid) || 0) + q) }
    const TG = (d, key) => { if (!T[d].g.has(key)) T[d].g.set(key, { prods: new Map(), hoy: { consumo: 0, anuladas: 0, tras: 0, marcadas: 0 } }); return T[d].g.get(key) }
    const TP = (gk, pid) => { if (!gk.prods.has(pid)) gk.prods.set(pid, { libro: 0, cobrado: 0, sinCant: 0 }); return gk.prods.get(pid) }
    let mid = 0
    const mov = (d, pid, qty, extra) => { const m = { id: 'm' + (++mid), productId: pid, createdAt: ts(d), k: 'ventas', qty, location: SAL, type: 'sale_out', ...extra }; movements.push(m); return m }
    const lineOf = (d, gk, pid, qty) => {
      const r = rnd()
      // Precio de ficha, otro precio, uno a pocos centavos (el caso de la 5a revision) o a una
      // fraccion de centavo; los productos sin ficha se cobran a un precio cualquiera.
      const up = sinFicha(pid) ? r2(1 + rnd() * 40) : r < 0.6 ? F[pid] : r < 0.75 ? r2(F[pid] * (0.6 + rnd() * 0.8)) : r < 0.9 ? r2(F[pid] - 0.04) : F[pid] + 0.003
      const bad = rnd() < 0.06 // linea cuyo importe no es cantidad x precio
      const lt = r2(qty * up) + (bad ? r2(1 + rnd() * 20) : 0)
      if (inC(pid)) {
        const e = qty * up - lt
        if (Math.abs(e) > 0.005 + 1e-9) { T[d].linea += e; T[d].lineaN += 1 }
        const P = r2(F[pid])
        if (sinFicha(pid)) { T[d].sinFicha += qty * (P - up); T[d].sinFichaN += 1 }
        else {
          if (Math.abs(up - F[pid]) > 1e-9) { T[d].precio += qty * (F[pid] - up); T[d].precioN += 1 }
          if (Math.abs(P - F[pid]) > 1e-9) T[d].fichaDec.set(pid, (T[d].fichaDec.get(pid) || 0) + qty * (P - F[pid]))
        }
      }
      TP(gk, pid).cobrado += qty
      return { productId: pid, qty, unitPrice: up, lineTotal: lt }
    }
    for (let d = 0; d < 3; d++) {
      for (let v = 0, nv = ri(0, 2); v < nv; v++) {
        const sid = `s${d}${v}`
        const r = rnd()
        const missingSale = r < 0.08, noMov = r >= 0.08 && r < 0.16
        const gk = TG(d, 'S:' + sid)
        const items = []
        // A veces muchas lineas pequenas (300 x 0,1 kg): las diferencias por linea se acumulan.
        const nl = rnd() < 0.05 ? 60 : ri(1, 3)
        const many = nl === 60
        for (let l = 0; l < nl; l++) {
          const pid = pids[ri(0, pids.length - 1)]
          const qty = many ? 0.1 : qOf(pid)
          if (rnd() < 0.05 && !missingSale) { const lt = r2(rnd() * 30 + 1); items.push({ productId: pid, lineTotal: lt }); TP(gk, pid).sinCant += lt; continue }
          if (!missingSale) items.push(lineOf(d, gk, pid, qty))
          if (!noMov) {
            const loc = rnd() < 0.05 ? OTRA : SAL
            const noise = isKg(pid) && rnd() < 0.15 ? 0.0003 : 0
            mov(d, pid, -(qty + noise), { refType: 'sale', refId: sid, location: loc })
            if (loc === SAL) { TP(gk, pid).libro += qty + noise; RAW(d, pid, qty + noise) }
          }
        }
        gk.venta = missingSale ? 'no-esta' : 'ok'
        if (!missingSale && items.length) sales.push({ id: sid, createdAt: ts(d), sourceLocation: SAL, voided: false, items, totalBase: 0 })
      }
    }
    for (let o = 0, no = ri(0, 3); o < no; o++) {
      const oid = 'o' + o
      const status = ['closed', 'open', 'voided', 'closed'][ri(0, 3)]
      orders.push({ id: oid, area: SAL, table: 'Mesa ' + o, status })
      const events = []
      for (let e = 0, ne = ri(1, 6); e < ne; e++) events.push({ d: ri(0, 2), kind: rnd() < 0.7 ? 'cons' : 'void', pid: pids[ri(0, pids.length - 1)] })
      const nCharges = status === 'closed' ? ri(1, 2) : 0
      for (let c = 0; c < nCharges; c++) events.push({ d: ri(0, 2), kind: 'charge' })
      events.sort((a, b) => a.d - b.d || rnd() - 0.5)
      let firstSaleTs = null
      const voidsLog = []
      for (const ev of events) {
        if (ev.kind === 'cons') {
          const qty = qOf(ev.pid)
          const m = mov(ev.d, ev.pid, -qty, { refType: 'order', refId: oid })
          orderItems.push({ id: 'li' + m.id, orderId: oid, productId: ev.pid, qty, voided: false, createdAt: m.createdAt })
          const gk = TG(ev.d, 'O:' + oid); TP(gk, ev.pid).libro += qty; RAW(ev.d, ev.pid, qty); if (inC(ev.pid)) gk.hoy.consumo += qty
        } else if (ev.kind === 'void') {
          const qty = isKg(ev.pid) ? qOf(ev.pid) : 1
          const orphan = rnd() < 0.35
          const m = mov(ev.d, ev.pid, qty, { refType: 'order_void', refId: oid })
          if (!orphan) orderItems.push({ id: 'lv' + m.id, orderId: oid, productId: ev.pid, qty, voided: true, voidedAt: m.createdAt, createdAt: m.createdAt })
          const gk = TG(ev.d, 'O:' + oid); TP(gk, ev.pid).libro -= qty; RAW(ev.d, ev.pid, -qty)
          if (inC(ev.pid)) { gk.hoy.anuladas += qty; if (orphan) gk.hoy.marcadas += qty; voidsLog.push({ d: ev.d, at: m.createdAt, qty }) }
        } else {
          const at = ts(ev.d)
          const gk = TG(ev.d, 'O:' + oid)
          const items = []
          for (const pid of pids) if (rnd() < 0.6) { const qty = qOf(pid); items.push(lineOf(ev.d, gk, pid, qty)); if (!isKg(pid) && rnd() < 0.2) items.push(lineOf(ev.d, gk, pid, 1)) }
          if (!items.length) continue
          sales.push({ id: 'v' + oid + ev.d + at.slice(11, 16), orderId: oid, createdAt: at, sourceLocation: SAL, voided: false, items, totalBase: 0 })
          if (!firstSaleTs) firstSaleTs = at
        }
      }
      for (const v of voidsLog) if (firstSaleTs && firstSaleTs < v.at) TG(v.d, 'O:' + oid).hoy.tras += v.qty
    }
    const res = buildDailyControl({ products, movements, sales, orders, orderItems, location: SAL, categoryId: CATF, from: DAYS[0], to: DAYS[2],
      classify: (m) => m.k, priceOf: (p) => (p.priceCurrency ? 0 : p.price), isForeign: (p) => !!p.priceCurrency, dayOf: (x) => String(x || '').slice(0, 10) })
    for (let d = 0; d < 3; d++) {
      const m = res.days[d].money
      const errs = []
      const P2 = (pid) => r2(F[pid] || 0)
      if (m.sinExplicar !== 0) errs.push('sinExplicar ' + m.sinExplicar)
      if (r2(m.precio.amount + m.lineaImporte.amount + m.cantidad.amount + m.sinFicha.amount + m.fichaDecimales.amount + m.redondeo + m.unidades.amount) !== m.diferencia) errs.push('partes != diferencia')
      const near = (a, b) => Math.abs(a - r2(b)) <= 0.0100001
      if (!near(m.precio.amount, T[d].precio) || m.precio.n !== T[d].precioN) errs.push(`precio ${m.precio.n}/${m.precio.amount} vs ${T[d].precioN}/${r2(T[d].precio)}`)
      if (!near(m.lineaImporte.amount, T[d].linea) || m.lineaImporte.n !== T[d].lineaN) errs.push(`linea ${m.lineaImporte.n}/${m.lineaImporte.amount} vs ${T[d].lineaN}/${r2(T[d].linea)}`)
      if (!near(m.sinFicha.amount, T[d].sinFicha) || m.sinFicha.n !== T[d].sinFichaN) errs.push(`sinFicha ${m.sinFicha.n}/${m.sinFicha.amount} vs ${T[d].sinFichaN}/${r2(T[d].sinFicha)}`)
      let fd = 0, fdSmall = 0
      for (const v of T[d].fichaDec.values()) { if (Math.abs(v) >= 0.005) fd += v; else fdSmall += 1 }
      if (!near(m.fichaDecimales.amount, fd)) errs.push(`fichaDec ${m.fichaDecimales.amount} vs ${r2(fd)}`)
      let cant = 0
      for (const [pid, v] of T[d].raw) { const a = (q3(v) - v) * P2(pid); if (Math.abs(a) >= 0.005) cant += a }
      if (!near(m.cantidad.amount, cant)) errs.push(`cantidad ${m.cantidad.amount} vs ${r2(cant)}`)
      // Redondeo ACOTADO: medio centavo por partida contada, mas los totales y las 7 partes impresas.
      if (Math.abs(m.redondeo) > 0.005 * m.redondeoPartidas + 0.01 + 0.035 + 1e-9) errs.push(`redondeo ${m.redondeo} fuera de cota (${m.redondeoPartidas} partidas)`)
      const want = new Map()
      for (const [k, gk] of T[d].g) {
        const listed = [...gk.prods].filter(([pid, x]) => inC(pid) && (Math.abs(x.libro - x.cobrado) >= 0.0005 || Math.abs((x.libro - x.cobrado) * P2(pid)) >= 0.005 || x.sinCant))
        if (listed.length) want.set(k, { gk, listed })
      }
      const got = new Map(m.unidades.grupos.map((g) => [(g.kind === 'mesa' ? 'O:' : g.kind === 'venta' ? 'S:' : 'X:') + g.id, g]))
      for (const k of want.keys()) if (!got.has(k)) errs.push('falta grupo ' + k)
      for (const k of got.keys()) if (!want.has(k)) errs.push('grupo de mas ' + k)
      for (const [k, { gk, listed }] of want) {
        const g = got.get(k); if (!g) continue
        let amt = 0
        for (const [pid, x] of listed) {
          const p = g.productos.find((y) => y.productId === pid)
          if (!p) { errs.push(`${k} falta producto ${pid}`); continue }
          if (p.libro !== q6(x.libro) || p.cobrado !== q6(x.cobrado)) errs.push(`${k} ${pid} libro/cobrado ${p.libro}/${p.cobrado} vs ${q6(x.libro)}/${q6(x.cobrado)}`)
          if (x.sinCant && p.sinCantidad !== r2(x.sinCant)) errs.push(`${k} ${pid} sinCantidad`)
          amt += (x.libro - x.cobrado) * P2(pid) - x.sinCant
        }
        if (g.productos.length !== listed.length) errs.push(`${k} productos ${g.productos.length} vs ${listed.length}`)
        if (!near(g.amount, amt)) errs.push(`${k} importe ${g.amount} vs ${r2(amt)}`)
        if (g.kind === 'mesa') {
          const h = g.hechos.hoy, w = gk.hoy
          if (h.consumo !== q3(w.consumo) || h.anuladas !== q3(w.anuladas) || h.anuladasTrasCobro !== q3(w.tras) || h.marcadasSinLinea !== q3(w.marcadas)) errs.push(`${k} hechos hoy`)
          const cobros = sales.filter((s) => s.orderId === g.id).map((s) => s.createdAt.slice(0, 10)).sort().join(',')
          if (g.hechos.cobros.map((c) => c.day).sort().join(',') !== cobros) errs.push(`${k} cobros`)
        } else if (g.kind === 'venta' && g.hechos.venta !== gk.venta) errs.push(`${k} venta ${g.hechos.venta} vs ${gk.venta}`)
        seen[g.kind] = (seen[g.kind] || 0) + 1
      }
      for (const [key, on] of [['precio', m.precio.n], ['lineaImporte', m.lineaImporte.n], ['cantidad', m.cantidad.detalle.length], ['sinFicha', m.sinFicha.n], ['fichaDecimales', m.fichaDecimales.detalle.length],
        ['marcadas', m.unidades.grupos.some((g) => g.hechos.hoy?.marcadasSinLinea)], ['trasCobro', m.unidades.grupos.some((g) => g.hechos.hoy?.anuladasTrasCobro)], ['variosCobros', m.unidades.grupos.some((g) => g.hechos.cobros?.length > 1)]]) if (on) seen[key] = (seen[key] || 0) + 1
      if (errs.length) { fail++; if (shown++ < 5) console.error(`FAIL semilla ${seed0} caso ${t} ${DAYS[d]} filtro '${CATF}': ${errs.slice(0, 4).join(' ; ')}`) } else pass++
    }
  }
}
run(31337, 400, '')
run(4242, 200, 'C')
// La cobertura TIENE que tocar cada rama: si un cambio del generador deja alguna sin ejercitar,
// esta prueba tiene que decirlo en vez de pasar en verde sin medir nada.
for (const k of ['mesa', 'venta', 'precio', 'lineaImporte', 'cantidad', 'sinFicha', 'fichaDecimales', 'marcadas', 'trasCobro', 'variosCobros']) {
  if (seen[k]) pass++
  else { fail++; console.error(`FAIL cobertura: la rama '${k}' no se ejercito`) }
}
console.log(`dailySalesControl.fuzz: ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
