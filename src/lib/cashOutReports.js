import { round2, isForeignPriced } from './currency.js'
import { cleanQty } from './qty.js'

// ---------------------------------------------------------------------------
// Reportes de salidas de caja (Reportes). PURO, sin Dexie ni React: se prueba
// con node (`cashOutReports.test.mjs`). Este modulo empieza por las DEUDAS
// INTERNAS; las extracciones de caja se añaden aqui mismo en otra tarea.
//
// QUE RESPONDE (deudas). "¿Que mercancia se llevo cada persona a deuda, cuando,
// quien lo autorizo y como va?": una fila por deuda, mas recientes primero, con
// el total y un resumen por deudor. SOLO LEE: recibe los datos ya cargados.
//
// DE DONDE SALE CADA COLUMNA:
//  - Fecha, Cantidad, Valor, Deudor, Autorizó, Registró, Estado y Nota: la propia
//    deuda. El Valor es `valueAtTime`, el congelado al registrarla (un cambio de
//    precio posterior no lo altera).
//  - Producto y U/M: la ficha ACTUAL del producto (si ya no existe, se dice).
//  - Ubicación: el movimiento de inventario DE ESA DEUDA (`refId` = id de la
//    deuda), no uno cualquiera del mismo producto. La deuda no guarda la
//    ubicacion; si el movimiento no esta (p. ej. aun no llego por la sync) la
//    celda queda en «—» y el pie lo AVISA.
//
// QUE NO SE GARANTIZA: la MONEDA. La deuda guarda un valor en MN pero no su
// moneda; con el modulo `divisas` se DEDUCE de la ficha actual del producto
// (si hoy tiene precio en divisa, se informa en esa moneda). Si la ficha cambio
// de moneda despues de la deuda, la columna Moneda se equivocaria; el pie lo dice.
//
// El dia es el LOCAL del negocio: `dayOf` se inyecta (en la app, `localDay`).
// ---------------------------------------------------------------------------

const BASE = 'MN'

// Monedas con MN primero y el resto alfabetico: orden estable en totales y pies.
const sortCurrencies = (list) => [...list].sort((a, b) => (a === BASE ? -1 : b === BASE ? 1 : a.localeCompare(b)))

export function buildDebts({
  debts = [], movements = [], products = {}, from = '', to = '',
  dayOf, userName = () => '', locationName = () => '', divisas = false
} = {}) {
  const inRange = (iso) => {
    const d = dayOf(iso)
    if (from && d < from) return false
    if (to && d > to) return false
    return true
  }

  // Movimiento de cada deuda: el primero con su id como refId.
  const movByDebt = new Map()
  for (const m of Array.isArray(movements) ? movements : []) {
    if (m && m.refType === 'internal_debt' && m.refId && !movByDebt.has(m.refId)) movByDebt.set(m.refId, m)
  }

  let missingMovements = 0
  const lines = (Array.isArray(debts) ? debts : [])
    .filter((d) => d && inRange(d.createdAt))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .map((d) => {
      const p = products ? products[d.productId] : null
      const mv = movByDebt.get(d.id)
      if (!mv) missingMovements++
      return {
        at: d.createdAt,
        product: p ? (p.name || '') : '(producto no encontrado)',
        unit: p ? (p.unit || '') : '',
        location: mv && mv.location ? locationName(mv.location) : '',
        qty: cleanQty(d.qty),
        value: round2(Number(d.valueAtTime || 0)),
        currency: divisas && isForeignPriced(p, BASE) ? p.priceCurrency : BASE,
        debtor: userName(d.userId),
        authorizedBy: d.authorizedBy ? userName(d.authorizedBy) : '',
        registeredBy: userName(d.registeredBy),
        settled: !!d.settled,
        settledAt: d.settledAt || '',
        settleMethod: d.settleMethod || '',
        note: d.note || '',
        settleNote: d.settleNote || ''
      }
    })

  const totalsRaw = {}
  const groups = new Map()
  for (const l of lines) {
    totalsRaw[l.currency] = (totalsRaw[l.currency] || 0) + l.value
    const g = groups.get(l.debtor) || { debtor: l.debtor, count: 0, raw: {} }
    g.count++
    const c = g.raw[l.currency] || (g.raw[l.currency] = { total: 0, pending: 0, settled: 0 })
    c.total += l.value
    c[l.settled ? 'settled' : 'pending'] += l.value
    groups.set(l.debtor, g)
  }
  const totals = {}
  for (const cur of sortCurrencies(Object.keys(totalsRaw))) totals[cur] = round2(totalsRaw[cur])
  const byDebtor = [...groups.values()]
    .sort((a, b) => a.debtor.localeCompare(b.debtor, 'es'))
    .map((g) => {
      const byCurrency = {}
      for (const cur of sortCurrencies(Object.keys(g.raw))) {
        const c = g.raw[cur]
        byCurrency[cur] = { total: round2(c.total), pending: round2(c.pending), settled: round2(c.settled) }
      }
      return { debtor: g.debtor, count: g.count, byCurrency }
    })

  return {
    lines, byDebtor, totals,
    foreign: lines.some((l) => l.currency !== BASE),
    missingMovements
  }
}

// De resultado a reporte exportable: { title, subtitle, head, rows, filename, orientation }.
// La columna Moneda solo existe si alguna deuda esta en divisa (data-driven).
export function debtsReport(result, {
  from = '', to = '', formatDateTime = (x) => x,
  formatMoney = (v, c) => `${v} ${c}`, settleLabel = (m) => m || ''
} = {}) {
  const fx = !!result.foreign
  const head = ['Fecha', 'Producto', 'Ubicación', 'Cantidad', 'U/M', 'Valor', ...(fx ? ['Moneda'] : []),
    'Deudor', 'Autorizó', 'Registró', 'Estado', 'Nota']
  const pad = (text) => [{ content: text, colSpan: head.length }]
  const periodo = !from && !to ? 'Todo el periodo' : `Periodo: ${from || '...'} a ${to || '...'}`
  const base = { title: 'Deudas internas', subtitle: periodo, head, orientation: 'landscape', filename: 'deudas_internas' }

  if (!result.lines.length) return { ...base, rows: [pad('Sin deudas internas en el periodo.')] }

  const status = (l) => (l.settled
    ? ['Saldada', formatDateTime(l.settledAt)].join(' ') + (settleLabel(l.settleMethod) ? ` · ${settleLabel(l.settleMethod)}` : '')
    : 'Pendiente')
  const note = (l) => [l.note, l.settleNote ? `Saldo: ${l.settleNote}` : ''].filter(Boolean).join(' · ')

  const rows = result.lines.map((l) => [
    formatDateTime(l.at), l.product, l.location || '—', l.qty, l.unit, l.value, ...(fx ? [l.currency] : []),
    l.debtor, l.authorizedBy || '—', l.registeredBy, status(l), note(l)
  ])
  // Una fila TOTAL por moneda, en la columna Valor.
  for (const cur of Object.keys(result.totals)) {
    rows.push(['TOTAL', '', '', '', '', result.totals[cur], ...(fx ? [cur] : []), '', '', '', '', ''])
  }
  if (fx) {
    rows.push(pad('La moneda de cada deuda se deduce de la ficha actual del producto (la deuda guarda el valor, no su moneda): si la ficha cambió de moneda después, esa fila puede estar en otra.'))
  }
  if (result.missingMovements > 0) {
    const n = result.missingMovements
    rows.push(pad(`${n} ${n === 1 ? 'deuda no tiene' : 'deudas no tienen'} movimiento de inventario: no se pudo determinar su ubicación.`))
  }
  rows.push(pad('Resumen por deudor'))
  for (const g of result.byDebtor) {
    for (const cur of Object.keys(g.byCurrency)) {
      const c = g.byCurrency[cur]
      rows.push(pad(`${g.debtor} — ${g.count} ${g.count === 1 ? 'deuda' : 'deudas'} · total ${formatMoney(c.total, cur)} · pendiente ${formatMoney(c.pending, cur)} · saldado ${formatMoney(c.settled, cur)}`))
    }
  }
  return { ...base, rows }
}
