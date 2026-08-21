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
  // Mermas (deterioro/perdida): snapshot de la afectacion al costo. El libro
  // mayor (MERMA_OUT en stockMovements) ya sincroniza y deriva el stock.
  { name: 'mermas', pk: 'id' },
  // Modulo mayorista: conversiones de producto en el almacen.
  { name: 'conversions', pk: 'id' },
  // Bloques C/D (modulo cuentas): terceros y tesoreria con sus libros.
  { name: 'partners', pk: 'id' },
  { name: 'partnerMovements', pk: 'id' },
  { name: 'accounts', pk: 'id' },
  { name: 'accountMovements', pk: 'id' },
  // Modulo 'mesas': cuentas por mesa. Las lineas son filas append-only, por lo
  // que dos dispositivos (camarero y caja) atendiendo la misma mesa FUSIONAN
  // sus adiciones en vez de pisarse (que es lo que pasaria con un array).
  { name: 'orders', pk: 'id' },
  { name: 'orderItems', pk: 'id' },
  // Modulo 'imagenes': miniaturas (producto/usuario/carta). Id determinista por
  // referencia -> dos dispositivos no duplican; LWW por updatedAt. Sin el modulo
  // no se crea ninguna, la coleccion queda vacia y no hay costo de sync/storage.
  { name: 'images', pk: 'id' },
  // Modulo 'cocina': recetas (definidas por el dueño) y producciones (bitacora
  // append-only de cada elaboracion). Sin el modulo no se crea ninguna: ambas
  // colecciones quedan vacias y no hay costo de sync. El stock lo mueven los
  // CONVERSION_*/TRANSFER_* del libro mayor, que ya sincronizan.
  { name: 'recipes', pk: 'id' },
  { name: 'productions', pk: 'id' },
  // Modulo 'remesas' (F2): cabecera de la orden de remesa. LWW por updatedAt, como
  // cualquier cabecera; se fusiona sola por syncTs. Sin el modulo no se crea
  // ninguna: la coleccion queda vacia y no hay costo de sync. (La custodia de
  // efectivo, las entregas y las liquidaciones se registraran en sus fases.)
  { name: 'remittances', pk: 'id' },
  // Modulo 'remesas' (F3): libro de custodia de efectivo (append-only). El saldo
  // por tenedor+moneda se DERIVA de estos movimientos (como accountMovements). Es
  // su PROPIA tabla: NO toca la tesoreria del modulo 'cuentas'. Sin el modulo
  // queda vacia y no hay costo de sync.
  { name: 'custodyMovements', pk: 'id' },
  // Modulo 'remesas' (F5): entregas append-only (una fila por intento/resultado).
  // Se fusionan por id (patron orderItems). Sin el modulo queda vacia.
  { name: 'deliveries', pk: 'id' },
  // Modulo 'remesas' (F6): liquidaciones (reconciliacion append-only del efectivo
  // en custodia de un mensajero). Snapshot, como mermas/producciones. Sin el
  // modulo queda vacia.
  { name: 'settlements', pk: 'id' }
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
