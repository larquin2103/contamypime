import { db } from '../../db/db'
import { now } from '../../lib/dates'
import { newId } from '../../lib/ids'
import { round2 } from '../../lib/currency'
import { configRepo } from '../../repositories/configRepo'
import {
  notificationsRepo,
  notificationId,
  NOTIFICATION_STATUS,
  NOTIFICATION_SEVERITY,
  NOTIFICATION_TYPES,
  TYPE_CATEGORY,
  DEFAULT_NOTIFICATION_PREFERENCES
} from '../../repositories/notificationsRepo'
import { syncTs } from '../sync/collections'
import { SHIFT_STATUS, COUNT_STATUS, SEMAPHORE, ROLE_LABELS, areaLabel, DELIVERY_RESULT } from '../../db/constants'

// ---------------------------------------------------------------------------
// Motor de notificaciones (Fase 9) — CAPA INDEPENDIENTE y de SÓLO LECTURA sobre
// ventas/caja/inventario. Camino 1 (derivación): NO modifica ningún repo de
// dominio. LEE los registros que esos repos ya escriben (y que ya sincronizan) y
// MATERIALIZA avisos locales para el dueño vía notificationsRepo. El evento NACE
// en la capa de datos (el registro real), NUNCA en un componente visual.
//
// Offline-first (Opción A): la notificación se deriva en el dispositivo del dueño
// cuando baja el dato del vendedor/admin; la entrega la garantiza la sync del
// registro FUENTE, no un mensaje aparte.
//
// Reglas de oro:
//  - Id DETERMINISTA por evento -> nunca duplica ni revive un aviso leído.
//  - Reloj = syncTs (no updatedAt suelto): los libros append-only sólo tienen
//    createdAt; los turnos/conteos avanzan por closedAt/approvedAt.
//  - Nombres (usuario/producto) y rol se resuelven AQUÍ, en la derivación, con
//    los datos ya sincronizados del dispositivo del dueño.
//  - Gate por preferencia del dueño (config); CRITICAL siempre pasa.
//  - Este archivo NO se auto-ejecuta: expone refreshFromSources() para el
//    cableado (un provider tras cada sync). Sin cablear = inerte.
// ---------------------------------------------------------------------------

const CURSOR_KEY = 'mc_notif_cursor' // marca de agua LOCAL del barrido (device)
const ACTIVATED_KEY = 'mc_notif_activated_at' // piso duro de activación (device)
// Ventana anti-pérdida (Riesgo Alto): un evento creado OFFLINE puede llegar TARDE
// con fecha vieja (por debajo del cursor). Re-examinamos hasta WINDOW_DAYS por
// debajo del cursor para recuperarlo; la idempotencia (id determinista + addIfAbsent)
// evita duplicar. El piso NUNCA baja de la activación -> R1 (0 backfill) se preserva.
const WINDOW_DAYS = 30

function readCursor() {
  try {
    return localStorage.getItem(CURSOR_KEY) || ''
  } catch {
    return ''
  }
}
function writeCursor(ts) {
  try {
    if (ts) localStorage.setItem(CURSOR_KEY, ts)
  } catch {
    /* best-effort, como lib/lockout.js */
  }
}

// Momento de activación en ESTE dispositivo (se fija una sola vez). Es el piso
// duro: nunca se derivan eventos anteriores (preserva R1). Device-local, no sincroniza.
function ensureActivatedAt() {
  try {
    let v = localStorage.getItem(ACTIVATED_KEY)
    if (!v) {
      v = now()
      localStorage.setItem(ACTIVATED_KEY, v)
    }
    return v
  } catch {
    return now() // sin localStorage: piso = ahora (degradación segura, sin flood)
  }
}

// Resta días a un ISO por epoch (robusto ante cambios de mes). Entrada inválida -> igual.
function isoMinusDays(iso, days) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  return new Date(t - days * 86400000).toISOString()
}

// El mayor (más reciente) de dos ISO.
function maxIso(a, b) {
  return (a || '') > (b || '') ? (a || '') : (b || '')
}

// --- API pública -------------------------------------------------------------

// Materializa un aviso (idempotente por id determinista). `desc` trae el evento
// ya resuelto en español; aquí sólo se completan los campos base y se delega al
// repo (add-si-ausente). Devuelve { created, id }.
export async function createNotification(desc = {}) {
  const {
    type,
    sourceId = null,
    disc = '',
    severity = NOTIFICATION_SEVERITY.INFO,
    title = '',
    message = '',
    createdAt = null,
    createdBy = null,
    requiresAction = false,
    audience = 'manager',
    metadata = {}
  } = desc
  if (!type) throw new Error('Notificación sin type')
  const id = sourceId ? notificationId(type, sourceId, disc) : `mc_notif:${type}:${newId()}`
  const businessId = await configRepo.get('syncBusinessId', null)
  const record = {
    id,
    type,
    severity,
    title,
    message,
    businessId,
    createdAt: createdAt || now(),
    createdBy,
    readAt: null,
    status: NOTIFICATION_STATUS.UNREAD,
    metadata,
    requiresAction: !!requiresAction,
    audience,
    updatedAt: now()
  }
  return notificationsRepo.addIfAbsent(record)
}

export async function markAsRead(id) {
  await notificationsRepo.setStatus(id, NOTIFICATION_STATUS.READ, { readAt: now() })
}

export async function getUnread() {
  return notificationsRepo.getUnread()
}

export async function dismissNotification(id) {
  await notificationsRepo.setStatus(id, NOTIFICATION_STATUS.DISMISSED)
}

// --- Preferencias del dueño --------------------------------------------------

export async function getPreferences() {
  const saved = await configRepo.get('notificationPreferences', null)
  return {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    ...(saved && typeof saved === 'object' ? saved : {})
  }
}

// Guarda las preferencias del dueño (config 'notificationPreferences', sincroniza).
// La escribe NotificationSettings; el gate de generación las relee en cada barrido.
export async function savePreferences(next) {
  await configRepo.set('notificationPreferences', next && typeof next === 'object' ? next : {})
}

// ¿Este tipo/severidad se materializa según las preferencias del dueño?
//  - Categoría apagada -> nada de esa categoría (decisión explícita del dueño).
//  - onlyImportant -> se descartan las INFO (solo advertencias/críticas).
function enabled(prefs, type, severity) {
  const cat = TYPE_CATEGORY[type]
  if (cat && prefs[cat] === false) return false
  if (prefs.onlyImportant && severity === NOTIFICATION_SEVERITY.INFO) return false
  return true
}

// --- Reglas: eventos EXISTENTES -> descriptor de aviso (funciones PURAS) ------
// Cada una recibe un registro fuente (+ ctx con mapas de nombres/roles) y
// devuelve el descriptor, o null si no aplica. No tocan la base: sólo transforman
// datos ya escritos por sus repos.

// Primer importe distinto de cero de un mapa { moneda: valor } (p.ej. difference).
function firstNonZero(map) {
  for (const [currency, v] of Object.entries(map || {})) {
    if (Math.abs(Number(v) || 0) >= 0.01) return { currency, value: Number(v) }
  }
  return null
}

// 3) Diferencia de caja al CERRAR el turno (shiftsRepo.close). Transición: sólo
//    dispara cuando el turno está CERRADO y hay diferencia (faltante/sobrante).
//    Ej: "Turno cerrado con faltante 350 MN".
function buildCashDifference(shift) {
  if (!shift || shift.status !== SHIFT_STATUS.CLOSED) return null
  const nz = firstNonZero(shift.difference)
  if (!nz) return null
  const critical = shift.semaphore === SEMAPHORE.RED
  const faltante = nz.value < 0
  const kind = faltante ? 'faltante' : 'sobrante'
  const areaPart = shift.area ? ` · ${areaLabel(shift.area)}` : ''
  return {
    type: NOTIFICATION_TYPES.CASH_DIFFERENCE,
    sourceId: shift.id,
    severity: critical ? NOTIFICATION_SEVERITY.CRITICAL : NOTIFICATION_SEVERITY.WARNING,
    title: faltante ? 'Faltante de caja' : 'Sobrante de caja',
    message: `Turno cerrado con ${kind} ${Math.abs(nz.value)} ${nz.currency}${areaPart}`,
    createdAt: shift.closedAt || now(),
    createdBy: shift.closedBy || shift.sellerId || null,
    requiresAction: true,
    audience: 'manager',
    metadata: {
      sourceCollection: 'shifts',
      sourceId: shift.id,
      diff: nz.value,
      currency: nz.currency,
      sign: kind,
      semaphore: shift.semaphore || null,
      area: shift.area || '',
      forced: !!shift.forced
    }
  }
}

// 1) Conteo físico APROBADO (countsRepo.approve). El rol de quien aprobó + la
//    diferencia más notable de los items contados. Transición keyed por :approved.
//    Ej: "Administrativo aprobó conteo con diferencia de -25 u en Café".
function buildCountApproved(count, ctx) {
  if (!count || count.status !== COUNT_STATUS.APPROVED) return null
  const actor = ctx.userRole[count.approvedBy] || 'Mando'
  const diffs = (count.items || []).filter(
    (it) => it.counted && Math.abs(Number(it.diff) || 0) >= 0.001
  )
  const meta = {
    sourceCollection: 'counts',
    sourceId: count.id,
    location: count.location || '',
    approvedBy: count.approvedBy || null,
    diffCount: diffs.length
  }
  let severity
  let title
  let message
  if (diffs.length) {
    // El item con mayor |diferencia| (los demás se resumen entre paréntesis).
    const top = diffs.slice().sort((a, b) => Math.abs(Number(b.diff)) - Math.abs(Number(a.diff)))[0]
    const d = Number(top.diff)
    const unitPart = top.unit ? ` ${top.unit}` : ''
    const others = diffs.length - 1
    const more = others > 0 ? ` (+${others} producto${others > 1 ? 's' : ''})` : ''
    severity = NOTIFICATION_SEVERITY.WARNING
    title = 'Conteo aprobado con diferencia'
    message = `${actor} aprobó conteo con diferencia de ${d}${unitPart} en ${top.name}${more}`
    meta.topDiff = d
    meta.topProduct = top.name
  } else {
    severity = NOTIFICATION_SEVERITY.INFO
    title = 'Conteo aprobado'
    message = `${actor} aprobó conteo sin diferencias`
  }
  return {
    type: NOTIFICATION_TYPES.COUNT_APPROVED,
    sourceId: count.id,
    disc: 'approved',
    severity,
    title,
    message,
    createdAt: count.approvedAt || count.updatedAt || now(),
    createdBy: count.approvedBy || null,
    requiresAction: false,
    audience: 'manager',
    metadata: meta
  }
}

// 4) Cambio de precio o escalas (productsRepo.changePrice / changeTiers).
//    Ej: "Carlos cambió precio de Refresco".
function buildPriceChange(pc, ctx) {
  if (!pc) return null
  const userName = ctx.userName[pc.userId] || 'Usuario'
  const productName = ctx.productName[pc.productId] || 'producto'
  const isTiers = pc.kind === 'tiers'
  return {
    type: NOTIFICATION_TYPES.PRICE_CHANGE,
    sourceId: pc.id,
    severity: NOTIFICATION_SEVERITY.INFO,
    title: isTiers ? 'Cambio de escalas' : 'Cambio de precio',
    message: `${userName} cambió ${isTiers ? 'escalas' : 'precio'} de ${productName}`,
    createdAt: pc.createdAt || now(),
    createdBy: pc.userId || null,
    requiresAction: false,
    audience: 'manager',
    metadata: {
      sourceCollection: 'priceChanges',
      sourceId: pc.id,
      productId: pc.productId,
      oldPrice: pc.oldPrice ?? null,
      newPrice: pc.newPrice ?? null,
      kind: pc.kind || 'price'
    }
  }
}

// 5) Cobro por TRANSFERENCIA con diferencia (salesRepo.create). El importe recibido
//    no coincide con lo que se debía cobrar (sale.transferDiff != 0): de más (recibido
//    de más) o falta (recibido de menos). Mismo criterio que el panel del dueño
//    (analyticsRepo.transferMismatches): venta NO anulada, pago por transferencia,
//    |diferencia| >= 0.01. Ej: "Carlos cobró por transferencia 1200 MN y debía 1000".
function buildTransferMismatch(sale, ctx) {
  if (!sale || sale.voided || sale.paymentMethod !== 'transfer') return null
  const diff = Number(sale.transferDiff || 0)
  if (Math.abs(diff) < 0.01) return null
  const currency = sale.transferCurrency || 'MN'
  const seller = ctx.userName[sale.sellerId] || 'vendedor'
  const deMas = diff > 0
  const expected = round2(Number(sale.transferExpected || 0))
  const received = round2(Number(sale.transferAmount || 0))
  return {
    type: NOTIFICATION_TYPES.TRANSFER_MISMATCH,
    sourceId: sale.id,
    severity: NOTIFICATION_SEVERITY.WARNING,
    title: deMas ? 'Cobro de más por transferencia' : 'Falta en cobro por transferencia',
    message: `${seller} cobró por transferencia ${received} ${currency} y debía ${expected} (${deMas ? '+' : ''}${round2(diff)} ${currency})`,
    createdAt: sale.createdAt || now(),
    createdBy: sale.sellerId || null,
    requiresAction: true,
    audience: 'manager',
    metadata: {
      sourceCollection: 'sales',
      sourceId: sale.id,
      expected,
      received,
      diff: round2(diff),
      currency,
      sign: deMas ? 'de_mas' : 'falta',
      reference: sale.transferReference || ''
    }
  }
}

// 6) Entrega FALLIDA de una remesa (deliveriesRepo). El mensajero no pudo entregar;
//    el efectivo se devolvió a la caja central. Deriva de `deliveries` (result FAILED,
//    no anulada). Ej: "Carlos no pudo entregar una remesa".
function buildDeliveryFailed(delivery, ctx) {
  if (!delivery || delivery.voided || delivery.result !== DELIVERY_RESULT.FAILED) return null
  const courier = ctx.userName[delivery.courierId] || 'mensajero'
  return {
    type: NOTIFICATION_TYPES.DELIVERY_FAILED,
    sourceId: delivery.id,
    severity: NOTIFICATION_SEVERITY.WARNING,
    title: 'Entrega fallida',
    message: `${courier} no pudo entregar una remesa${delivery.note ? ` (${delivery.note})` : ''}`,
    createdAt: delivery.createdAt || now(),
    createdBy: delivery.courierId || delivery.byUserId || null,
    requiresAction: true,
    audience: 'manager',
    metadata: {
      sourceCollection: 'deliveries',
      sourceId: delivery.id,
      courierId: delivery.courierId || null,
      remittanceId: delivery.remittanceId || null
    }
  }
}

// 7) Diferencia en la LIQUIDACIÓN de un mensajero (settlementsRepo). Faltante/sobrante
//    del efectivo contado frente al teórico del libro. Crítico si el semáforo es rojo.
//    Deriva de `settlements`. Ej: "Liquidación de Carlos con faltante 200 MN".
function buildSettlementDiff(settlement, ctx) {
  if (!settlement) return null
  const nz = firstNonZero(settlement.difference)
  if (!nz) return null
  const courier = ctx.userName[settlement.courierId] || 'mensajero'
  const critical = settlement.semaphore === SEMAPHORE.RED
  const faltante = nz.value < 0
  const kind = faltante ? 'faltante' : 'sobrante'
  return {
    type: NOTIFICATION_TYPES.SETTLEMENT_DIFF,
    sourceId: settlement.id,
    severity: critical ? NOTIFICATION_SEVERITY.CRITICAL : NOTIFICATION_SEVERITY.WARNING,
    title: faltante ? 'Faltante en liquidación' : 'Sobrante en liquidación',
    message: `Liquidación de ${courier} con ${kind} ${Math.abs(nz.value)} ${nz.currency}`,
    createdAt: settlement.settledAt || settlement.createdAt || now(),
    createdBy: settlement.settledBy || null,
    requiresAction: true,
    audience: 'manager',
    metadata: {
      sourceCollection: 'settlements',
      sourceId: settlement.id,
      courierId: settlement.courierId || null,
      diff: nz.value,
      currency: nz.currency,
      sign: kind,
      semaphore: settlement.semaphore || null
    }
  }
}

// --- Barrido derivado (offline-first, incremental) ---------------------------
// Lee SOLO lo posterior al piso y materializa los avisos nuevos. Rendimiento:
//  - priceChanges: rango por índice `createdAt` (= su syncTs) -> solo lo nuevo.
//  - sales: rango por índice `createdAt` (ventana); en memoria pasan a candidato
//    SOLO las de transferencia con diferencia y no anuladas (así el ciclo con
//    ventas normales NO infla candidates ni carga los mapas de nombres). Es la
//    lectura más pesada (ventas = mayor volumen), pero va por índice y acotada al
//    piso; corre en el dispositivo del DUEÑO y no toca la sync.
//  - shifts/counts: acotadas por estado (índice) y filtradas por el piso en
//    memoria (su transición closedAt/approvedAt no está indexada).
//  - mapas de nombres (usuarios/productos): se cargan SOLO si hay candidatos
//    (el ciclo ocioso NO lee los 500 productos).
// Piso = max(cursor - WINDOW_DAYS, activatedAt): recupera eventos offline tardíos
// (Riesgo Alto) sin re-procesar la historia, y nunca baja de la activación (R1).
// La idempotencia (id determinista + addIfAbsent) evita duplicar al re-examinar la
// ventana. NO se auto-ejecuta (lo llama el provider). Devuelve { created, matched }.
export async function refreshFromSources() {
  const prefs = await getPreferences()

  // Piso del barrido. Primer arranque: cursor y activatedAt = now() -> piso = now()
  // -> 0 backfill histórico (R1). Después, la ventana recupera lo que llegue tarde.
  const activatedAt = ensureActivatedAt()
  let cursor = readCursor()
  if (!cursor) {
    cursor = activatedAt
    writeCursor(cursor)
  }
  const floor = maxIso(isoMinusDays(cursor, WINDOW_DAYS), activatedAt)

  // Lecturas acotadas (NO tablas completas): priceChanges por índice createdAt;
  // shifts/counts por estado (índice). Se filtran por el piso con syncTs (que
  // refleja la transición real: closedAt / approvedAt).
  const [priceRows, shiftRows, countRows, saleRows, deliveryRows, settlementRows] = await Promise.all([
    db.priceChanges.where('createdAt').aboveOrEqual(floor).toArray(),
    db.shifts.where('status').equals(SHIFT_STATUS.CLOSED).toArray(),
    db.counts.where('status').equals(COUNT_STATUS.APPROVED).toArray(),
    db.sales.where('createdAt').aboveOrEqual(floor).toArray(),
    db.deliveries.where('createdAt').aboveOrEqual(floor).toArray(),
    db.settlements.where('createdAt').aboveOrEqual(floor).toArray()
  ])

  // Candidatos tras el piso. [registro, regla, ¿necesita ctx de nombres?].
  const candidates = []
  for (const r of shiftRows) if (syncTs(r) >= floor) candidates.push([r, buildCashDifference, false])
  for (const r of countRows) if (syncTs(r) >= floor) candidates.push([r, buildCountApproved, true])
  for (const r of priceRows) candidates.push([r, buildPriceChange, true]) // ya filtrados por índice
  // Solo las ventas por transferencia CON diferencia (no anuladas) son candidatas:
  // así el ciclo con ventas normales no infla candidates ni carga los mapas.
  for (const r of saleRows) {
    if (!r.voided && r.paymentMethod === 'transfer' && Math.abs(Number(r.transferDiff || 0)) >= 0.01) {
      candidates.push([r, buildTransferMismatch, true])
    }
  }
  // Remesas (módulo): entregas fallidas y liquidaciones con diferencia (ambas
  // acotadas por índice createdAt al piso). Vacías sin el módulo -> sin candidatos.
  for (const r of deliveryRows) {
    if (!r.voided && r.result === DELIVERY_RESULT.FAILED) candidates.push([r, buildDeliveryFailed, true])
  }
  for (const r of settlementRows) {
    if (firstNonZero(r.difference)) candidates.push([r, buildSettlementDiff, true])
  }

  // La marca de agua avanza al mayor syncTs visto (aunque no se materialice nada).
  let maxTs = cursor
  for (const [r] of candidates) {
    const ts = syncTs(r)
    if (ts > maxTs) maxTs = ts
  }

  let created = 0
  let matched = 0
  // Early-out: sin candidatos NO se cargan los mapas (500 productos + usuarios).
  if (candidates.length) {
    const users = await db.users.toArray()
    const products = await db.products.toArray()
    const ctx = {
      userName: Object.fromEntries(users.map((u) => [u.id, u.name])),
      userRole: Object.fromEntries(users.map((u) => [u.id, ROLE_LABELS[u.role] || 'Usuario'])),
      productName: Object.fromEntries(products.map((p) => [p.id, p.name]))
    }
    for (const [rec, build, needsCtx] of candidates) {
      const desc = needsCtx ? build(rec, ctx) : build(rec)
      if (!desc) continue
      matched++
      if (!enabled(prefs, desc.type, desc.severity)) continue
      const res = await createNotification(desc)
      if (res.created) created++
    }
  }

  writeCursor(maxTs)
  // R2 - Control de crecimiento: tras el barrido, poda los avisos viejos. Es
  // best-effort (nunca rompe el barrido ni borra UNREAD/recientes).
  try {
    await notificationsRepo.prune()
  } catch (e) {
    console.warn('[notif] prune', e?.message)
  }
  return { created, matched }
}
