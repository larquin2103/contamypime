import { db } from '../../db/db'
import { now } from '../../lib/dates'
import { round2 } from '../../lib/currency'
import { configRepo } from '../../repositories/configRepo'
import { ratesRepo } from '../../repositories/ratesRepo'
import { shiftsRepo } from '../../repositories/shiftsRepo'
import { SHIFT_STATUS } from '../../db/constants'

const APP_TAG = 'mypicuadre'
const SNAPSHOT_VERSION = 2  // v2: incluye areas, sales, movements, transfers, counts, shift actual

// Arma el "estado completo del negocio" para traspasarlo a otro vendedor offline.
// Incluye: existencias (por ubicación), precios, tasas, config, áreas, historial de
// ventas/movimientos/transferencias, conteos físicos, deudas pendientes, caja a heredar
// y el resumen de caja/ventas del turno que se entrega. Así el vendedor siguiente tiene
// el estado ÍNTEGRO sin perder trazabilidad.
//
// `fromUser` puede ser el objeto usuario ({ id, name }) o solo el nombre (compat).
// `activeShift` es el turno abierto del que entrega (si lo hay); permite calcular el
// fondo a heredar y las ventas de ESE turno/área con exactitud.
export async function buildSnapshot(fromUser, activeShift = null) {
  const fromUserName = typeof fromUser === 'string' ? fromUser : (fromUser?.name || '')
  const fromUserId = typeof fromUser === 'string' ? null : (fromUser?.id || null)

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
  // Cuentas de terceros y tesoreria (Bloques C/D): viajan completas para que
  // el proximo dispositivo conserve saldos (se derivan de los movimientos).
  const partners = await db.partners.toArray()
  const partnerMovements = await db.partnerMovements.toArray()
  const accounts = await db.accounts.toArray()
  const accountMovements = await db.accountMovements.toArray()

  // Deudas internas pendientes.
  const allDebts = await db.internalDebts.toArray()
  const pendingDebts = allDebts.filter((d) => !d.settled)

  // Turno de CONTEXTO: el que entrega su turno. Prioridad:
  //  1) el turno abierto pasado por la pantalla (el del usuario actual),
  //  2) el turno abierto de ese usuario en la BD,
  //  3) como respaldo, el último turno cerrado.
  const shifts = await db.shifts.toArray()
  const openShifts = shifts
    .filter((s) => s.status === SHIFT_STATUS.OPEN)
    .sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))
  let ctxShift = activeShift || null
  if (!ctxShift && fromUserId) ctxShift = openShifts.find((s) => s.sellerId === fromUserId) || null
  if (!ctxShift) {
    ctxShift = shifts
      .filter((s) => s.status === SHIFT_STATUS.CLOSED && s.closedAt)
      .sort((a, b) => (a.closedAt < b.closedAt ? 1 : -1))[0] || null
  }
  // El turno que viaja como contexto para el siguiente vendedor.
  const currentShift = ctxShift || openShifts[0] || null
  const ctxArea = ctxShift?.area || ''

  // Resumen de caja/ventas del turno de contexto (efectivo de ventas, transferencias,
  // extracciones, caja esperada). Es la "cantidad de dinero en ventas" que pediste.
  let shiftSummary = null
  // Fondo de caja a heredar por el próximo turno (POR ÁREA):
  //  - turno abierto  -> el efectivo REAL en caja ahora (apertura + ventas - extracciones)
  //  - turno cerrado  -> el fondo que se dejó (closingFloat), no el declarado total.
  let inheritedCash = {}
  if (ctxShift) {
    const sum = await shiftsRepo.getSummary(ctxShift.id)
    if (sum) {
      shiftSummary = {
        shiftId: ctxShift.id,
        area: ctxArea,
        status: ctxShift.status,
        openingCash: ctxShift.openingCash || {},
        salesCash: sum.salesCash,            // efectivo de ventas que entró a caja
        transfersByCur: sum.transfersByCur,  // cobrado por transferencia (no entra a caja)
        withdrawalsByCur: sum.withdrawalsByCur,
        expectedCash: sum.expectedCash,      // efectivo que debería haber en caja
        salesCount: sum.salesCount,
        transfersCount: sum.transfersCount,
        internalDebtTotal: sum.internalDebtTotal
      }
      inheritedCash =
        ctxShift.status === SHIFT_STATUS.OPEN
          ? sum.expectedCash
          : (ctxShift.closingFloat || ctxShift.declaredCash || sum.expectedCash)
    }
  }
  // Respaldo por área si no hubo turno de contexto (usa el último cierre del área).
  if (!inheritedCash || Object.keys(inheritedCash).length === 0) {
    inheritedCash = (await shiftsRepo.lastClosedCash(ctxArea || null)) || {}
  }
  // Normaliza a números redondeados (evita arrastrar strings/decimales sucios).
  const cleanCash = (obj) => {
    const o = {}
    for (const [k, v] of Object.entries(obj || {})) o[k] = round2(Number(v) || 0)
    return o
  }
  inheritedCash = cleanCash(inheritedCash)

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
    partners,
    partnerMovements,
    accounts,
    accountMovements,
    // Contexto del turno actual + resumen de caja/ventas.
    currentShift,
    shiftSummary,
    // Deudas y caja heredada (fondo a heredar, por área).
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
  if (snap.partners?.length) await db.partners.bulkPut(snap.partners)
  if (snap.partnerMovements?.length) await db.partnerMovements.bulkPut(snap.partnerMovements)
  if (snap.accounts?.length) await db.accounts.bulkPut(snap.accounts)
  if (snap.accountMovements?.length) await db.accountMovements.bulkPut(snap.accountMovements)

  // Turno que se está cerrando: contexto para auditoría.
  if (snap.currentShift) await db.shifts.put(snap.currentShift)

  // Deudas internas pendientes.
  if (snap.pendingDebts?.length) await db.internalDebts.bulkPut(snap.pendingDebts)

  // Caja a heredar como fondo inicial del próximo turno.
  await configRepo.set('inheritedOpeningCash', snap.inheritedCash || {})
}
