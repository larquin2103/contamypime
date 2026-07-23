// Fase 4 - Colecciones que se sincronizan con Firestore.
//
// Cada una se replica en /businesses/{businessId}/{name}/{docId}, donde docId
// es la clave primaria local (UUID string; en `config` es la clave key-value).
export const SYNC_COLLECTIONS = [
  { name: 'users', pk: 'id' },
  { name: 'config', pk: 'key' },
  { name: 'exchangeRates', pk: 'id' },
  { name: 'categories', pk: 'id' },
  { name: 'products', pk: 'id' },
  { name: 'priceChanges', pk: 'id' },
  { name: 'shifts', pk: 'id' },
  { name: 'sales', pk: 'id' },
  { name: 'stockMovements', pk: 'id' },
  { name: 'purchases', pk: 'id' },
  { name: 'cashMovements', pk: 'id' },
  { name: 'internalDebts', pk: 'id' },
  { name: 'auditEvents', pk: 'id' },
  { name: 'counts', pk: 'id' },
  { name: 'transfers', pk: 'id' },
  // Modulo mayorista: conversiones de producto en el almacen.
  { name: 'conversions', pk: 'id' },
  // Bloques C/D (modulo cuentas): terceros y tesoreria con sus libros.
  { name: 'partners', pk: 'id' },
  { name: 'partnerMovements', pk: 'id' },
  { name: 'accounts', pk: 'id' },
  { name: 'accountMovements', pk: 'id' }
]

// Claves de `config` que son LOCALES de cada dispositivo y NO deben viajar a
// la nube (sesion de sync propia, caja heredada del turno local, etc.).
export const LOCAL_CONFIG_KEYS = new Set([
  'syncEnabled',
  'syncBusinessId',
  'syncEmail',
  'inheritedOpeningCash',
  // Licencia de activacion: es LOCAL de cada dispositivo (la compuerta debe
  // funcionar antes de que exista cualquier sync), por eso no viaja a la nube.
  'licenseToken',
  'licenseLastSeen',
  // Id estable de este dispositivo (registro/limite de dispositivos): local.
  'deviceId',
  // Fechas de respaldo/restauracion (Bloque 32): cada dispositivo lleva las suyas.
  'lastBackupAt',
  'lastRestoreAt'
])

// Campos de marca de tiempo, de mas reciente a base. La "marca de sync" de un
// registro = el mayor (ISO ordena lexicograficamente) de los presentes. Como
// toda mutacion actualiza alguno (updatedAt/closedAt/settledAt...), crece de
// forma monotona y permite detectar cambios para subir/bajar.
const TS_FIELDS = ['updatedAt', 'settledAt', 'closedAt', 'openedAt', 'effectiveFrom', 'createdAt']

export function syncTs(rec) {
  let max = ''
  for (const f of TS_FIELDS) {
    const v = rec?.[f]
    if (typeof v === 'string' && v > max) max = v
  }
  return max
}
