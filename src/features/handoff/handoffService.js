import { db } from '../../db/db'
import { now } from '../../lib/dates'
import { configRepo } from '../../repositories/configRepo'
import { ratesRepo } from '../../repositories/ratesRepo'
import { SHIFT_STATUS } from '../../db/constants'

const APP_TAG = 'mypicuadre'
const SNAPSHOT_VERSION = 1

// Arma el "estado del turno" para traspasarlo a otro vendedor offline:
// existencias, precios, tasas, config, deudas pendientes y la caja a heredar.
export async function buildSnapshot(fromUserName) {
  const [baseCurrency, semaphore, denominations] = await Promise.all([
    configRepo.getBaseCurrency(),
    configRepo.getSemaphoreConfig(),
    configRepo.getDenominations()
  ])
  const ratesObj = await ratesRepo.currentRates()
  const rates = Object.values(ratesObj)
  // Cuentas de usuario (con PIN hasheado) para que el vendedor pueda iniciar
  // sesion en su propio dispositivo offline. En Fase 4 esto sera por la nube.
  const users = await db.users.toArray()
  const categories = await db.categories.toArray()
  const products = await db.products.toArray()
  const allDebts = await db.internalDebts.toArray()
  const pendingDebts = allDebts.filter((d) => !d.settled)

  const shifts = await db.shifts.toArray()
  const lastClosed = shifts
    .filter((s) => s.status === SHIFT_STATUS.CLOSED)
    .sort((a, b) => (a.closedAt < b.closedAt ? 1 : -1))[0]
  const inheritedCash = lastClosed?.declaredCash || {}

  return {
    meta: { app: APP_TAG, version: SNAPSHOT_VERSION, exportedAt: now(), fromUserName },
    config: { baseCurrency, semaphore, denominations },
    users,
    rates,
    categories,
    products,
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
  return snap
}

// Aplica el turno entrante: hace upsert (bulkPut) por id, conservando claves
// UUID. No borra nada; sobreescribe lo que cambio (stock, precios, etc.).
export async function applySnapshot(snap) {
  if (snap.config) {
    if (snap.config.baseCurrency) await configRepo.set('baseCurrency', snap.config.baseCurrency)
    if (snap.config.semaphore) await configRepo.set('semaphore', snap.config.semaphore)
    if (snap.config.denominations) await configRepo.set('denominations', snap.config.denominations)
  }
  if (snap.users?.length) await db.users.bulkPut(snap.users)
  if (snap.rates?.length) await db.exchangeRates.bulkPut(snap.rates)
  if (snap.categories?.length) await db.categories.bulkPut(snap.categories)
  if (snap.products?.length) await db.products.bulkPut(snap.products)
  if (snap.pendingDebts?.length) await db.internalDebts.bulkPut(snap.pendingDebts)
  // Caja a heredar como fondo inicial del proximo turno.
  await configRepo.set('inheritedOpeningCash', snap.inheritedCash || {})
}
