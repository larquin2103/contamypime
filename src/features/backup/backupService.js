import { db } from '../../db/db'
import { now } from '../../lib/dates'
import { WAREHOUSE } from '../../db/constants'
import { configRepo } from '../../repositories/configRepo'
import { recomputeStock } from '../sync/pullEngine'

// ---------------------------------------------------------------------------
// Bloque 32.2/32.3 - Respaldo COMPLETO de la base local.
//
// A diferencia del traspaso de turno (un snapshot operativo), esto es un dump
// integro de TODAS las colecciones Dexie: la red de seguridad si el telefono
// se rompe o el navegador desaloja IndexedDB. La restauracion fusiona por
// upsert (bulkPut) conservando los UUID: nada se borra (append-only), igual
// que el traspaso y la sync.
// ---------------------------------------------------------------------------

const APP_TAG = 'mypicuadre-respaldo'
const BACKUP_VERSION = 1

// Claves de config que son IDENTIDAD LOCAL del dispositivo y no deben viajar
// en un respaldo ni aplicarse al restaurar (licencia, sesion de sync, id del
// dispositivo, fechas de respaldo propias). La caja heredada SI viaja: es
// estado del negocio y hace falta para continuar en un telefono nuevo.
const DEVICE_ONLY_KEYS = new Set([
  'syncEnabled',
  'syncBusinessId',
  'syncEmail',
  'licenseToken',
  'licenseLastSeen',
  'deviceId',
  'lastBackupAt',
  'lastRestoreAt'
])

// Arma el respaldo integro: todas las tablas, con la version de esquema para
// validar compatibilidad al restaurar.
export async function buildBackup(fromUser) {
  const tables = {}
  for (const table of db.tables) {
    let rows = await table.toArray()
    if (table.name === 'config') rows = rows.filter((r) => !DEVICE_ONLY_KEYS.has(r.key))
    tables[table.name] = rows
  }
  return {
    meta: {
      app: APP_TAG,
      version: BACKUP_VERSION,
      schema: db.verno, // version del esquema Dexie con que se exporto
      exportedAt: now(),
      fromUserName: fromUser?.name || ''
    },
    tables
  }
}

export function backupToBlob(backup) {
  return new Blob([JSON.stringify(backup)], { type: 'application/json' })
}

export function backupFileName() {
  const day = new Date().toISOString().slice(0, 10)
  return `respaldo_mypicuadre_${day}.json`
}

// Registra que se hizo un respaldo (para el recordatorio del Home).
export async function markBackupDone() {
  await configRepo.set('lastBackupAt', now())
}

// Valida un archivo de respaldo (sin aplicar nada). Devuelve el respaldo con
// un resumen de conteos por tabla para la vista previa.
export function parseBackup(text) {
  let bk
  try {
    bk = JSON.parse(text)
  } catch {
    throw new Error('El archivo no es un JSON válido')
  }
  if (!bk || bk.meta?.app !== APP_TAG) {
    throw new Error('Este archivo no es un respaldo de MypiCuadre')
  }
  if ((bk.meta.version || 1) > BACKUP_VERSION) {
    throw new Error(`Versión de respaldo no soportada (${bk.meta.version}). Actualiza la app.`)
  }
  if ((bk.meta.schema || 1) > db.verno) {
    throw new Error('El respaldo se hizo con una versión más nueva de la app. Actualiza la app primero.')
  }
  if (!bk.tables || typeof bk.tables !== 'object') {
    throw new Error('El respaldo está incompleto (sin tablas)')
  }
  return bk
}

// Aplica el respaldo: upsert por id en cada tabla dentro de UNA transaccion.
// No borra nada; si este dispositivo ya tenia datos, se fusionan (los ids
// iguales se sobreescriben con lo del respaldo). Tras aplicar, recalcula el
// stock desde el libro mayor (igual que la sync) para dejar la cache coherente.
export async function applyBackup(backup) {
  const schema = backup.meta?.schema || 1

  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      let rows = backup.tables[table.name]
      if (!Array.isArray(rows) || rows.length === 0) continue
      if (table.name === 'config') {
        rows = rows.filter((r) => r && r.key && !DEVICE_ONLY_KEYS.has(r.key))
      }
      // Respaldos de esquemas previos al v5: los movimientos no traian
      // ubicacion; quedan en el almacen central (misma regla que la migracion).
      if (table.name === 'stockMovements' && schema < 5) {
        rows = rows.map((m) => (m.location == null ? { ...m, location: WAREHOUSE } : m))
      }
      await table.bulkPut(rows)
    }
  })

  // Stock (total y por ubicacion) = suma del libro mayor fusionado.
  const productIds = new Set()
  for (const p of backup.tables.products || []) productIds.add(p.id)
  for (const m of backup.tables.stockMovements || []) productIds.add(m.productId)
  await recomputeStock(productIds)

  await configRepo.set('lastRestoreAt', now())
}

// Resumen legible para la vista previa de restauracion.
export function backupSummary(backup) {
  const t = backup.tables || {}
  const n = (name) => (Array.isArray(t[name]) ? t[name].length : 0)
  return {
    products: n('products'),
    categories: n('categories'),
    users: n('users'),
    sales: n('sales'),
    shifts: n('shifts'),
    stockMovements: n('stockMovements'),
    purchases: n('purchases'),
    transfers: n('transfers'),
    counts: n('counts'),
    debts: n('internalDebts'),
    cashMovements: n('cashMovements')
  }
}
