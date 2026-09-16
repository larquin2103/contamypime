import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now, tsAfter } from '../lib/dates'
import { round2 } from '../lib/currency'
import { evalSemaphore } from '../lib/semaphore'
import { COUNT_STATUS, WAREHOUSE } from '../db/constants'
import { configRepo } from './configRepo'
import { stockRepo } from './stockRepo'
// Existencia de un producto en una ubicacion. Vivia aqui como copia propia y
// arrastraba el respaldo de la v5 que inventaba existencia en el almacen (F1):
// era ESTA copia la que clavaba los -1482 al aprobar un conteo del almacen.
// Ahora es una sola funcion pura y probada, compartida por los doce sitios.
import { stockAtLocation, ledgerQtyAt } from '../lib/stockLocation'

// Existencia REAL de un producto en una ubicacion, derivada del LIBRO MAYOR (F3).
// Es la misma consulta por el mismo indice que `salesRepo` hace inline para su
// candado de ultima instancia.
//
// `startDraft` sigue leyendo la CACHE a proposito: es una foto para armar la lista
// y no escribe nada, y derivar 400+ productos del libro cada vez que se inicia un
// conteo costaria una consulta por producto sin ganar nada (`submit` y `approve`
// releen despues, que es donde se decide). Aqui, en cambio, se ESCRIBE un asiento
// append-only en el libro: el delta tiene que salir del libro.
// NO se filtra por el indice compuesto `[productId+location]`, que seria lo
// natural: ese indice NO CONTIENE los movimientos sin `location` -en IndexedDB un
// registro al que le falta un componente de una clave compuesta no se indexa-, y
// pueden llegar por sincronizacion o por el JSON de un turno sin que ningun
// escritor los haya creado aqui. La cache (`recomputeStock`) SI los cuenta, asi que
// mirar el indice hacia que el asiento de `approve` -append-only, irreversible-
// saliera distinto de la existencia real. `ledgerQtyAt` agrupa igual que la cache.
async function stockFromLedger(productId, location) {
  const movs = await db.stockMovements.where('productId').equals(productId).toArray()
  return ledgerQtyAt(movs, location)
}

// Marca de tiempo de una MUTACION del conteo: nunca por debajo de la version que
// reemplaza (ver `tsAfter` en lib/dates). El conteo lo mutan DOS dispositivos en
// segundos —el vendedor envia, el mando aprueba— y si el reloj de uno va atrasado
// su cambio nace "mas viejo" que el estado anterior: el LWW de bajada lo descarta
// y la aprobacion no vuelve al vendedor. Es el mismo patron que rompio las
// entregas. Refuerza el arreglo de b7ad5ce (que puso el `updatedAt` que faltaba):
// aquel garantiza que la marca EXISTA, este que ADEMAS avance de verdad.
// Se le pasan los campos que cuentan para la marca de sync (TS_FIELDS de
// features/sync/collections): en `counts` son updatedAt y createdAt. Con el reloj
// coherente devuelve now(), o sea exactamente lo de hoy. `submittedAt`/`approvedAt`
// conservan el reloj REAL (son hechos: cuando se envio y cuando se aprobo).
const stampFor = (c) => tsAfter(c?.updatedAt, c?.createdAt)

// Conteo fisico interactivo (Fase 3). Snapshot del stock del sistema vs lo
// contado fisicamente; al aprobar, las diferencias se aplican como ajustes
// trazados en el libro mayor (nada se borra).
export const countsRepo = {
  // Borrador en curso. Con areas, cada vendedor cuenta SU area; por eso el
  // borrador se aisla por usuario (si se pasa userId). Asi un vendedor nunca ve
  // el borrador del almacen del dueño ni el de otra area/vendedor.
  async getDraft(userId = null) {
    const rows = await db.counts.where('status').equals(COUNT_STATUS.DRAFT).toArray()
    const mine = userId ? rows.filter((r) => r.createdBy === userId) : rows
    return mine.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] || null
  },

  // Conteo enviado a aprobacion. El dueño/administrativo revisan CUALQUIERA
  // (cola de supervision); un vendedor solo consulta el SUYO (para saber si ya
  // se lo aprobaron), pasando su userId.
  async getPending(userId = null) {
    const rows = await db.counts.where('status').equals(COUNT_STATUS.PENDING).toArray()
    const mine = userId ? rows.filter((r) => r.createdBy === userId) : rows
    return mine.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] || null
  },

  async get(id) {
    return db.counts.get(id)
  },

  async listAll() {
    const rows = await db.counts.toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  // Ultimo conteo de un usuario ya resuelto (aprobado/rechazado), para avisarle.
  async latestResolvedFor(userId) {
    const rows = await db.counts.toArray()
    return (
      rows
        .filter(
          (c) =>
            c.createdBy === userId &&
            (c.status === COUNT_STATUS.APPROVED || c.status === COUNT_STATUS.REJECTED)
        )
        .sort((a, b) => ((a.approvedAt || '') < (b.approvedAt || '') ? 1 : -1))[0] || null
    )
  },

  // Inicia un conteo de UNA ubicacion (almacen o un area): toma una foto del
  // stock de esa ubicacion para cada producto que tiene existencia ahi.
  async startDraft(userId, location = WAREHOUSE) {
    const products = await db.products.toArray()
    const items = products
      // `!== 0` y no `> 0` (F2): una existencia NEGATIVA tiene que poder contarse,
      // porque `countsRepo.approve` es el UNICO sitio de toda la app que llama a
      // `stockRepo.adjust` — sin esto, un negativo no se puede corregir NUNCA desde
      // la aplicacion. El CERO se sigue excluyendo, igual que siempre: agotado es un
      // estado normal y meter 226 productos vacios en la lista no ayudaria a nadie.
      .filter((p) => p.active && stockAtLocation(p, location) !== 0)
      .map((p) => ({
        productId: p.id,
        name: p.name,
        unit: p.unit,
        categoryId: p.categoryId || null,
        systemStock: stockAtLocation(p, location),
        physicalQty: null,
        note: ''
      }))
    const existing = await this.getDraft(userId)
    if (existing) {
      // Mismo destino: se retoma el borrador en curso.
      if ((existing.location || WAREHOUSE) === location) return existing.id
      // Borrador de OTRA ubicacion (obsoleto: p.ej. del almacen creado antes de
      // tener area): se reconvierte a la ubicacion actual con su foto de stock.
      // No se borra (delete prohibido en la nube): misma fila, nuevo snapshot.
      await db.counts.update(existing.id, { location, items, note: '', updatedAt: stampFor(existing) })
      return existing.id
    }
    const id = newId()
    await db.counts.add({
      id,
      status: COUNT_STATUS.DRAFT,
      location,
      createdBy: userId,
      createdAt: now(),
      items,
      note: ''
    })
    return id
  },

  async saveItems(id, items) {
    // Se relee el borrador solo para sellar por encima de su version anterior
    // (stampFor); el contenido que se guarda es el que llega, como siempre.
    const c = await db.counts.get(id)
    await db.counts.update(id, { items, updatedAt: stampFor(c) })
  },

  // Envia el conteo a aprobacion: calcula diferencia y semaforo por producto.
  // IMPORTANTE: el stock del sistema se relee AHORA desde el libro mayor (no se usa
  // la foto tomada al iniciar el borrador), para que la diferencia refleje las
  // ventas/salidas ocurridas durante el conteo. Asi la diferencia mostrada coincide
  // con el ajuste que aplica approve() (que tambien usa el stock actual) y no se
  // generan diferencias fantasma al cerrar el turno.
  //
  // Hasta F3 este comentario MENTIA: decia "libro mayor" y leia la cache. Ahora los
  // dos —submit y approve— derivan de verdad del libro, que es lo unico que hace
  // cierta la frase de arriba: si cada uno mirase una fuente distinta, la diferencia
  // que el mando aprueba no seria la que se aplica.
  async submit(id) {
    const c = await db.counts.get(id)
    if (!c) return
    const cfg = await configRepo.getSemaphoreConfig()
    const loc = c.location || WAREHOUSE
    const items = []
    for (const it of c.items) {
      const counted = it.physicalQty !== null && it.physicalQty !== ''
      if (!counted) {
        items.push({ ...it, counted: false, diff: 0, semaphore: null })
        continue
      }
      const phys = Number(it.physicalQty)
      // Stock del sistema EN VIVO al momento de enviar (refleja la ultima venta),
      // derivado del LIBRO MAYOR (F3) y no de la cache: es el numero que el mando
      // va a ver al revisar, y tiene que ser EL MISMO contra el que `approve`
      // calcula el ajuste. Si el producto ya no existe se conserva la foto del
      // borrador, igual que antes.
      const p = await db.products.get(it.productId)
      const sysNow = p ? await stockFromLedger(it.productId, loc) : Number(it.systemStock || 0)
      const diff = round2(phys - sysNow)
      const sem = evalSemaphore(sysNow, phys, cfg)
      items.push({ ...it, systemStock: sysNow, physicalQty: phys, counted: true, diff, semaphore: sem.color })
    }
    // updatedAt: toda mutacion actualiza su marca de tiempo; de esto depende la
    // sync (el cursor de subida y el LWW de bajada leen syncTs = mayor timestamp).
    await db.counts.update(id, { items, status: COUNT_STATUS.PENDING, submittedAt: now(), updatedAt: stampFor(c) })
  },

  // Aprueba: ajusta el stock de la UBICACION contada para que coincida con lo
  // contado fisicamente. El ajuste se calcula contra la existencia ACTUAL de esa
  // ubicacion (no contra la foto), para no pisar ventas/salidas posteriores.
  async approve(id, ownerId) {
    const c = await db.counts.get(id)
    if (!c || c.status !== COUNT_STATUS.PENDING) return
    const loc = c.location || WAREHOUSE
    const locNote = loc === WAREHOUSE ? 'almacén' : loc
    for (const it of c.items) {
      if (!it.counted) continue
      const p = await db.products.get(it.productId)
      if (!p) continue
      // El delta sale del LIBRO MAYOR, no de la cache (F3). Aqui se escribe un
      // asiento append-only que NO se puede deshacer: el conteo de Galletas de soda
      // registro 48 cuando el libro daba -3, se calculo 7-48 y quedo un -41 clavado
      // para siempre. 41 de sus 44 unidades negativas las puso este calculo.
      const sysNow = await stockFromLedger(it.productId, loc)
      const delta = round2(Number(it.physicalQty) - sysNow)
      if (delta !== 0) {
        await stockRepo.adjust({
          productId: it.productId,
          delta,
          note: `Ajuste por conteo físico (${locNote})`,
          userId: ownerId,
          location: loc
        })
      }
    }
    // updatedAt: la resolucion debe avanzar syncTs para que la aprobacion vuelva
    // al vendedor (sin el, incoming == local y el LWW de bajada la descartaria).
    await db.counts.update(id, {
      status: COUNT_STATUS.APPROVED,
      approvedBy: ownerId,
      approvedAt: now(),
      updatedAt: stampFor(c)
    })
  },

  async reject(id, ownerId, reason = '') {
    // updatedAt: igual que approve, para que el rechazo avance syncTs y regrese
    // al vendedor por el LWW de bajada. Se relee el conteo solo para sellar por
    // encima de su version anterior (stampFor); si no existe, `update` no hace
    // nada y `stampFor(undefined)` devuelve now(), igual que hoy.
    const c = await db.counts.get(id)
    await db.counts.update(id, {
      status: COUNT_STATUS.REJECTED,
      approvedBy: ownerId,
      approvedAt: now(),
      rejectReason: reason,
      updatedAt: stampFor(c)
    })
  }
}
