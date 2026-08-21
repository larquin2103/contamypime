import { db } from '../../db/db'
import { formatDateTime, localDay } from '../../lib/dates'
import { round2 } from '../../lib/currency'
import { REMITTANCE_STATUS_LABELS, DELIVERY_RESULT, SEMAPHORE } from '../../db/constants'

// Reportes del modulo 'remesas' (solo lectura). Mismo contrato que reportsService:
// cada builder recibe { from, to } y devuelve { title, subtitle, head, rows,
// filename, orientation }. Se exportan con exportExcel/exportPdf de reportsService.
// Viven en su PROPIO archivo para no tocar reportsService.js. Sin el modulo, las
// tablas estan vacias y estos reportes no se ofrecen (la pantalla los gatea).

// Dia LOCAL del negocio (no UTC), igual que reportsService.inRange.
function inRange(iso, from, to) {
  const d = localDay(iso)
  if (from && d < from) return false
  if (to && d > to) return false
  return true
}

async function userMap() {
  const users = await db.users.toArray()
  const m = {}
  for (const u of users) m[u.id] = u.name
  return m
}

function rangeLabel(from, to) {
  if (!from && !to) return 'Todo el historial'
  if (from && to) return `Del ${from} al ${to}`
  if (from) return `Desde ${from}`
  return `Hasta ${to}`
}

// Mapa { moneda: monto } -> "100 USD · 500 MN" (o "—" si esta vacio).
function moneyMapStr(map) {
  const parts = Object.entries(map || {})
    .map(([cur, v]) => [cur, round2(Number(v) || 0)])
    .filter(([, v]) => Math.abs(v) >= 0.005)
    .map(([cur, v]) => `${v} ${cur}`)
  return parts.length ? parts.join(' · ') : '—'
}

const RESULT_LABEL = {
  [DELIVERY_RESULT.DELIVERED]: 'Entregada',
  [DELIVERY_RESULT.FAILED]: 'Fallida'
}

const SEMAPHORE_LABEL = {
  [SEMAPHORE.GREEN]: 'Cuadró',
  [SEMAPHORE.YELLOW]: 'Diferencia menor',
  [SEMAPHORE.RED]: 'Diferencia crítica'
}

// Remesas: cada orden con su estado actual, monto y mensajero asignado.
export async function buildRemittancesReport({ from = null, to = null } = {}) {
  const names = await userMap()
  const list = (await db.remittances.toArray())
    .filter((r) => inRange(r.createdAt, from, to))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const rows = list.map((r) => [
    formatDateTime(r.createdAt),
    r.sender?.name || '',
    r.beneficiary?.name || '',
    round2(Number(r.amount || 0)),
    r.currency || 'MN',
    REMITTANCE_STATUS_LABELS[r.status] || r.status || '',
    r.assignedCourierId ? (names[r.assignedCourierId] || '') : ''
  ])
  if (rows.length === 0) rows.push(['Sin remesas en el periodo', '', '', '', '', '', ''])
  return {
    title: 'Remesas',
    subtitle: rangeLabel(from, to),
    head: ['Fecha', 'Remitente', 'Beneficiario', 'Monto', 'Moneda', 'Estado', 'Mensajero'],
    rows,
    filename: 'remesas',
    orientation: 'landscape'
  }
}

// Entregas: cada intento de entrega (entregada/fallida) con su mensajero y remesa.
export async function buildDeliveriesReport({ from = null, to = null } = {}) {
  const names = await userMap()
  const remById = {}
  for (const r of await db.remittances.toArray()) remById[r.id] = r
  const list = (await db.deliveries.toArray())
    .filter((d) => inRange(d.createdAt, from, to))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const rows = list.map((d) => {
    const r = remById[d.remittanceId] || null
    return [
      formatDateTime(d.createdAt),
      names[d.courierId] || '',
      RESULT_LABEL[d.result] || d.result || '',
      r?.beneficiary?.name || '',
      r ? `${round2(Number(r.amount || 0))} ${r.currency || 'MN'}` : '',
      d.note || ''
    ]
  })
  if (rows.length === 0) rows.push(['Sin entregas en el periodo', '', '', '', '', ''])
  return {
    title: 'Entregas de remesas',
    subtitle: rangeLabel(from, to),
    head: ['Fecha', 'Mensajero', 'Resultado', 'Beneficiario', 'Monto', 'Nota'],
    rows,
    filename: 'entregas-remesas',
    orientation: 'landscape'
  }
}

// Liquidaciones: cada cuadre de un mensajero (teorico vs contado vs diferencia).
export async function buildSettlementsReport({ from = null, to = null } = {}) {
  const names = await userMap()
  const list = (await db.settlements.toArray())
    .filter((s) => inRange(s.createdAt, from, to))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const rows = list.map((s) => [
    formatDateTime(s.settledAt || s.createdAt),
    names[s.courierId] || '',
    moneyMapStr(s.theoretical),
    moneyMapStr(s.counted),
    moneyMapStr(s.difference),
    SEMAPHORE_LABEL[s.semaphore] || ''
  ])
  if (rows.length === 0) rows.push(['Sin liquidaciones en el periodo', '', '', '', '', ''])
  return {
    title: 'Liquidaciones de mensajeros',
    subtitle: rangeLabel(from, to),
    head: ['Fecha', 'Mensajero', 'Teórico', 'Contado', 'Diferencia', 'Resultado'],
    rows,
    filename: 'liquidaciones-remesas',
    orientation: 'landscape'
  }
}
