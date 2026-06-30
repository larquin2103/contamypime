import { db } from '../../db/db'
import { now } from '../../lib/dates'
import { configRepo } from '../../repositories/configRepo'
import { ratesRepo } from '../../repositories/ratesRepo'
import { SHIFT_STATUS } from '../../db/constants'

const APP_TAG = 'mypicuadre'
const SNAPSHOT_VERSION = 2  // v2: incluye areas, sales, movements, transfers, counts, shift actual

// Arma el "estado completo del negocio" para traspasarlo a otro vendedor offline.
// Incluye: existencias (por ubicación), precios, tasas, config, áreas, historial de
// ventas/movimientos/transferencias, conteos físicos, deudas pendientes y caja a heredar.
// Así el vendedor siguiente tiene el estado ÍNTEGRO sin perder trazabilidad.
export async function buildSnapshot(fromUserName) {
  const [baseCurrency, semaphore, denominations, areas] = await Promise.all([
    configRepo.getBaseCurrency(),
    configRepo.getSemaphoreConfig(),
    configRepo.getDenominations(),
    configRepo.getAreas()
  ])
  const ratesObj = await ratesRepo.currentRates()
  const rates = Object.values(ratesObj)

  // Cuentas de usuario (con PIN hasheado) para que el vendedor pueda iniciar
  // sesion en su propio dispositivo offline. En Fase 4 esto sera por la nube.
  const users = await db.users.toArray()
  const categories = await db.categories.toArray()
  const products = await db.products.toArray()

  // Historial completo: ventas, movimientos de stock, salidas del almacén, conteos.
  // Necesarios para que el siguiente vendedor recalcule el stock real desde el libro
  // mayor (stockMovements) y mantenga trazabilidad de áreas y ubicaciones (Bloque 20).
  const sales = await db.sales.toArray()
  const stockMovements = await db.stockMovements.toArray()
  const transfers = await db.transfers.toArray()
  const counts = await db.counts.toArray()

  // Deudas internas pendientes.
  const allDebts = await db.internalDebts.toArray()
  const pendingDebts = allDebts.filter((d) => !d.settled)

  // Turno actual: es contexto para el siguiente vendedor (quién cierra, cuándo, de qué área).
  const shifts = await db.shifts.toArray()
  const currentShift = shifts
    .filter((s) => s.status === SHIFT_STATUS.OPEN)
    .sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))[0] || null

  const lastClosed = shifts
    .filter((s) => s.status === SHIFT_STATUS.CLOSED)
    .sort((a, b) => (a.closedAt < b.closedAt ? 1 : -1))[0]
  const inheritedCash = lastClosed?.declaredCash || {}

  return {
    meta: { app: APP_TAG, version: SNAPSHOT_VERSION, exportedAt: now(), fromUserName },
    config: { baseCurrency, semaphore, denominations, areas: areas || [] },
    users,
    rates,
    categories,
    products,
    // Historial y trazabilidad (Bloque 20: almacén + áreas).
    sales,
    stockMovements,
    transfers,
    counts,
    // Contexto del turno actual.
    currentShift,
    // Deudas y caja heredada.
    pendingDebts,
    inheritedCash
  }
}

export function snapshotToBlob(snapshot) {
  return new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
}

export function snapshotFileName(fromUserName) {
  const day = new Date().toISOString().slice(0, 10)
  const who = (fromUserName || 'turno').replace(/[^a-zA-Z0-9]/g, '')
  return `turno_${day}_${who}.json`
}

// Valida y resume un archivo de turno entrante (sin aplicar nada todavia).
// Acepta v1 (legado, sin historial) y v2 (con historial completo).
export function parseSnapshot(text) {
  let snap
  try {
    snap = JSON.parse(text)
  } catch {
    throw new Error('El archivo no es un JSON valido')
  }
  if (!snap || snap.meta?.app !== APP_TAG) {
    throw new Error('Este archivo no es un turno de MypiCuadre')
  }
  // Compatible con v1 (legacy) y v2 (con historial).
  const version = snap.meta?.version || 1
  if (version > SNAPSHOT_VERSION) {
    throw new Error(`Versión de archivo no soportada (${version}). Actualiza la app.`)
  }
  return snap
}

// Aplica el turno entrante: hace upsert (bulkPut) por id, conservando claves UUID.
// No borra nada; sobreescribe/fusiona lo que cambió (append-only + LWW por timestamp).
// Incluye: config, usuarios, tasas, catálogo, HISTORIAL (sales, movimientos, transfers,
// conteos), turno actual y deudas. El vendedor siguiente tiene el estado íntegro.
export async function applySnapshot(snap) {
  // Config: áreas, moneda base, semáforo, denominaciones.
  if (snap.config) {
    if (snap.config.baseCurrency) await configRepo.set('baseCurrency', snap.config.baseCurrency)
    if (snap.config.semaphore) await configRepo.set('semaphore', snap.config.semaphore)
    if (snap.config.denominations) await configRepo.set('denominations', snap.config.denominations)
    if (snap.config.areas?.length) await configRepo.set('areas', snap.config.areas)
  }

  // Datos de catálogo y referencia.
  if (snap.users?.length) await db.users.bulkPut(snap.users)
  if (snap.rates?.length) await db.exchangeRates.bulkPut(snap.rates)
  if (snap.categories?.length) await db.categories.bulkPut(snap.categories)
  if (snap.products?.length) await db.products.bulkPut(snap.products)

  // Historial completo: trazabilidad de ventas, movimientos de stock, distribuciones.
  // Necesario para recalcular stock real desde el libro mayor (Bloque 20).
  if (snap.sales?.length) await db.sales.bulkPut(snap.sales)
  if (snap.stockMovements?.length) await db.stockMovements.bulkPut(snap.stockMovements)
  if (snap.transfers?.length) await db.transfers.bulkPut(snap.transfers)
  if (snap.counts?.length) await db.counts.bulkPut(snap.counts)

  // Turno que se está cerrando: contexto para auditoría.
  if (snap.currentShift) await db.shifts.put(snap.currentShift)

  // Deudas internas pendientes.
  if (snap.pendingDebts?.length) await db.internalDebts.bulkPut(snap.pendingDebts)

  // Caja a heredar como fondo inicial del próximo turno.
  await configRepo.set('inheritedOpeningCash', snap.inheritedCash || {})
}
