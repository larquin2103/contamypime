import { db } from '../db/db'
import { now } from '../lib/dates'

// ---------------------------------------------------------------------------
// Centro de notificaciones (Fase 9) — CAPA INDEPENDIENTE. Este repo es la ÚNICA
// puerta de escritura de la tabla `notifications` (Dexie v14). Es LOCAL del
// dispositivo (Opción A): NO está en SYNC_COLLECTIONS, así que no viaja a la nube
// ni aterriza en el teléfono del vendedor. Cada dispositivo del dueño deriva su
// propia lista de los registros FUENTE (ventas, turnos, movimientos, traspasos,
// conteos) que SÍ sincronizan.
//
// Nada se pisa: la creación es "añadir si no existe" (addIfAbsent) sobre un id
// DETERMINISTA -> re-derivar el mismo evento NO duplica ni revive un aviso ya
// leído. El estado (unread -> read -> dismissed -> archived) nunca se borra
// mientras esté vigente; la poda (R2) solo elimina avisos viejos YA leídos.
// ---------------------------------------------------------------------------

// Tope de avisos guardados por dispositivo (R2). Configurable: al superarlo, la
// poda elimina los más antiguos que NO estén sin leer. Los UNREAD no se borran.
const NOTIF_MAX = 300

// Estado del aviso.
export const NOTIFICATION_STATUS = {
  UNREAD: 'unread',
  READ: 'read',
  DISMISSED: 'dismissed',
  ARCHIVED: 'archived'
}

// Severidad (deriva del dato, no es fija).
export const NOTIFICATION_SEVERITY = {
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical'
}

// Tipos de evento (clave estable, como MOVEMENT_TYPES). Gatean la preferencia.
// Primera tanda cableada (Camino 1, derivación): cierre de caja con diferencia,
// conteo aprobado con diferencia y cambio de precio. Ampliable sin tocar el resto.
export const NOTIFICATION_TYPES = {
  CASH_DIFFERENCE: 'cash_difference',
  COUNT_APPROVED: 'count_approved',
  PRICE_CHANGE: 'price_change'
}

// Categorías que ve el dueño en Ajustes (los interruptores de NotificationSettings).
// Cada tipo pertenece a una categoría: apagar la categoría apaga sus tipos.
// Transferencias/Usuarios existen como interruptor pero aún no tienen productor
// cableado (se sumará su regla luego); no generan avisos todavía.
export const NOTIFICATION_CATEGORIES = {
  CAJA: 'caja',
  INVENTARIO: 'inventario',
  TRANSFERENCIAS: 'transferencias',
  USUARIOS: 'usuarios',
  VENTAS: 'ventas'
}

// Qué categoría gobierna cada tipo (para el gate de preferencias).
export const TYPE_CATEGORY = {
  [NOTIFICATION_TYPES.CASH_DIFFERENCE]: NOTIFICATION_CATEGORIES.CAJA,
  [NOTIFICATION_TYPES.COUNT_APPROVED]: NOTIFICATION_CATEGORIES.INVENTARIO,
  [NOTIFICATION_TYPES.PRICE_CHANGE]: NOTIFICATION_CATEGORIES.VENTAS
}

// Preferencias por defecto del dueño (clave 'notificationPreferences' en config,
// sincroniza). Todas las categorías ON; `onlyImportant` = recibir solo WARNING/
// CRITICAL (descarta INFO). Sin la clave -> estos valores (la app no cambia si no
// se activa la función). El dueño ajusta cada interruptor en NotificationSettings.
export const DEFAULT_NOTIFICATION_PREFERENCES = {
  caja: true,
  inventario: true,
  transferencias: true,
  usuarios: true,
  ventas: true,
  onlyImportant: false
}

// Id DETERMINISTA por evento fuente (mismo patrón que imagesRepo `img:...`): dos
// dispositivos que derivan el MISMO evento generan el MISMO id -> una sola fila.
// `disc` distingue transiciones del mismo doc (p.ej. ...:<countId>:approved).
export function notificationId(type, sourceId, disc = '') {
  const base = `mc_notif:${type}:${sourceId}`
  return disc ? `${base}:${disc}` : base
}

export const notificationsRepo = {
  async get(id) {
    return db.notifications.get(id)
  },

  // Crea el aviso SOLO si su id aún no existe (idempotente). Nunca sobreescribe
  // uno ya materializado -> no revive el estado de "leído". Devuelve {created,id}.
  async addIfAbsent(record) {
    if (!record?.id) throw new Error('Notificación sin id')
    return db.transaction('rw', db.notifications, async () => {
      const existing = await db.notifications.get(record.id)
      if (existing) return { created: false, id: record.id }
      await db.notifications.add(record)
      return { created: true, id: record.id }
    })
  },

  async byStatus(status) {
    const rows = await db.notifications.where('status').equals(status).toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  async getUnread() {
    return this.byStatus(NOTIFICATION_STATUS.UNREAD)
  },

  async unreadCount() {
    return db.notifications.where('status').equals(NOTIFICATION_STATUS.UNREAD).count()
  },

  // Cambia el estado (read/dismissed/archived) actualizando updatedAt. Es una
  // mutación local; nada se borra (append-only de estado).
  async setStatus(id, status, extra = {}) {
    await db.notifications.update(id, { status, updatedAt: now(), ...extra })
  },

  async listAll() {
    const rows = await db.notifications.toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  // Feed del panel (rendimiento): SOLO activas (unread + read), más recientes
  // primero, acotado. Evita leer toda la tabla (con descartadas/archivadas) en la
  // campana en cada cambio. Usa el índice `status` (anyOf).
  async feed(max = 60) {
    const rows = await db.notifications
      .where('status').anyOf(NOTIFICATION_STATUS.UNREAD, NOTIFICATION_STATUS.READ).toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, max)
  },

  // Poda (R2): mantiene un máximo de avisos por dispositivo. Elimina primero los
  // MÁS ANTIGUOS que NO estén sin leer (leídos/descartados/archivados); nunca
  // borra los UNREAD ni los recientes (solo el excedente por encima del tope, de
  // más viejo a más nuevo). Es LOCAL y re-derivable: borrar aquí no afecta la nube
  // (no sincroniza) ni el dato de negocio, igual que la poda del errorLog. La
  // llama el motor tras cada barrido. Sin cambio de esquema Dexie.
  async prune(max = NOTIF_MAX) {
    const total = await db.notifications.count()
    if (total <= max) return 0
    // Candidatas: todo lo que NO esté sin leer, de más antiguo a más nuevo.
    const removable = (await db.notifications
      .where('status').notEqual(NOTIFICATION_STATUS.UNREAD).toArray())
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    const overflow = total - max
    const ids = removable.slice(0, overflow).map((r) => r.id)
    if (ids.length) await db.notifications.bulkDelete(ids)
    return ids.length
  }
}
