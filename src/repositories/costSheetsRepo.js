import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import {
  FICHA_STATUS,
  FICHA_ACTIVITIES,
  FICHA_METHODS,
  FICHA_AUDIT_ACTIONS,
  maxUtility,
  rateToPct,
  reviseFrom,
  canEditSheet,
  canApproveSheet,
  canReviseSheet,
  canDeleteSheet,
  nextVersion
} from '../lib/fichaCosto'

// Fichas de costo del modulo 'fichas' (Res. 148/2023 MFP). Este repo guarda el
// DOCUMENTO; el calculo entero vive en `lib/fichaCosto.js` (puro y probado con
// node) y aqui no se recalcula nada: la ficha se lee y el motor la valora.
//
// Reglas del proyecto:
//  - La ficha NUNCA escribe en `products` ni cambia precios. Es un documento de
//    analisis: lee el catalogo y propone. Escribir `product.cost` desde aqui
//    chocaria con el promedio ponderado de `kitchenRepo.produce`, que ya es su
//    unico autor.
//  - Append-only: un borrador se edita en sitio; una APROBADA es inmutable y
//    corregirla crea una REVISION nueva. Eliminar es LOGICO (`deletedAt`).
//  - Toda mutacion sella `updatedAt`. De esto depende la sincronizacion: el
//    cursor de subida compara `syncTs`, y `approvedAt` NO esta en `TS_FIELDS`
//    (features/sync/collections.js:97), asi que una aprobacion que solo tocara
//    `approvedAt`/`status` NO se subiria NUNCA, en silencio.
//  - Las guardas (canEdit/canApprove/canRevise/canDelete) viven en el modulo
//    puro para poder probarlas con node; aqui se usan como candado y en la
//    pantalla para habilitar botones. Una sola fuente.
//
// Forma de un registro `costSheets` (docs/FICHA-COSTO.md §4):
//   { id, groupId, version, status, name, productId, code, unit,
//     productionLevel, capacityPct, activity, method, baseFromSheetId,
//     inputs[], carriers:{fuel,energy,water}, labor[], otherDirect[],
//     rows:{ r4, r41, r6, r61, r7, r71, r8, r9, taxSS, taxFT }, utilityPct,
//     correlationPrice, refs[], elaboratedBy, approvedBy, approvedAt,
//     createdAt, updatedAt, deletedAt }

const txt = (v) => String(v ?? '').trim()
const num = (v) => Number(v) || 0

// Portadores (filas 1.2, 1.3 y 1.4). Forma fija: siempre las tres, aunque vayan
// en cero, para que la pantalla no tenga que comprobar si existen.
function cleanCarriers(c) {
  const one = (x) => ({ qty: num(x?.qty), unitPrice: num(x?.unitPrice) })
  return { fuel: one(c?.fuel), energy: one(c?.energy), water: one(c?.water) }
}

// Filas capturadas del Anexo I. Se guardan TODAS aunque valgan cero: son filas
// del modelo oficial, no campos opcionales.
function cleanRows(r) {
  return {
    r4: num(r?.r4), r41: num(r?.r41),
    r6: num(r?.r6), r61: num(r?.r61),
    r7: num(r?.r7), r71: num(r?.r71),
    r8: num(r?.r8),
    r9: num(r?.r9), // OSDE: no aplica a un actor no estatal, pero la fila existe
    taxSS: num(r?.taxSS), // FRACCION (12,5% = 0.125), no porcentaje
    taxFT: num(r?.taxFT)
  }
}

// Lineas de los anexos. A DIFERENCIA de `recipesRepo.cleanItems`, aqui NO se
// descartan las filas incompletas: una ficha se teclea a lo largo de un rato con
// autoguardado, y tirar la linea a medio escribir le borraria al dueño lo que
// acaba de poner. Se normaliza la FORMA y ya; el motor trata lo vacio como cero.
const cleanInputs = (list) =>
  (list || []).map((i) => ({
    productId: txt(i?.productId) || null,
    code: txt(i?.code),
    name: txt(i?.name),
    unit: txt(i?.unit),
    baseCost: num(i?.baseCost), // columna (4), solo si hay comparable
    qty: num(i?.qty), // columna (5) norma de consumo
    unitPrice: num(i?.unitPrice), // columna (6)
    // Modulo 'divisas': par CONGELADO en la linea, como en las ventas.
    priceCurrency: txt(i?.priceCurrency) || null,
    priceRate: num(i?.priceRate)
  }))

const cleanLabor = (list) =>
  (list || []).map((o) => ({
    operation: txt(o?.operation), // columna (1)
    baseCost: num(o?.baseCost), // columna (2)
    workers: num(o?.workers), // columna (3)
    category: txt(o?.category), // columna (4)
    scaleGroup: txt(o?.scaleGroup), // columna (5)
    hourly: num(o?.hourly), // columna (6)
    extraHourly: num(o?.extraHourly), // columna (7) nocturnidad, peligrosidad
    hours: num(o?.hours) // columna (8) norma de tiempo
  }))

const cleanOtherDirect = (list) =>
  (list || []).map((x) => ({ concept: txt(x?.concept), amount: num(x?.amount) }))

const cleanRefs = (list) =>
  (list || []).map((x) => ({ source: txt(x?.source), price: num(x?.price), note: txt(x?.note) }))

// La ficha nace con la tasa MAXIMA de su actividad ya puesta, para que sin tocar
// el campo se comporte igual que cuando la tasa no era editable. En PORCENTAJE
// (`maxUtility` devuelve fraccion). Actividad desconocida -> null, y el motor lo
// avisa en vez de regalar la ganancia.
function defaultUtilityPct(activity) {
  const max = maxUtility(activity)
  // `rateToPct` es la conversion del motor, probada con node: era la tercera
  // copia de `Math.round(max * 1000) / 10` en el modulo.
  return max == null ? null : rateToPct(max)
}

// Constancia en auditoria. Misma forma que `productsRepo` (que la escribe en
// linea, sin repo propio): entity + entityId + action + quien y cuando.
function auditRow(sheet, action, userId, note = '') {
  return {
    id: newId(),
    entity: 'costSheet',
    entityId: sheet.id,
    action,
    name: sheet.name || '',
    code: sheet.code || '',
    userId,
    note: txt(note),
    createdAt: now()
  }
}

export const costSheetsRepo = {
  // Las eliminadas (borrado logico) no se listan, pero siguen en la base.
  async list() {
    const all = await db.costSheets.toArray()
    return all.filter((s) => !s.deletedAt)
  },

  async get(id) {
    return db.costSheets.get(id)
  },

  // Todas las versiones de una misma ficha (v1, v2, v3...), de la mas nueva a la
  // mas vieja. Es lo que alimenta la columna "Costo Base" y el historial.
  async listByGroup(groupId) {
    const rows = await db.costSheets.where('groupId').equals(groupId).toArray()
    return rows.sort((a, b) => (Number(b.version) || 0) - (Number(a.version) || 0))
  },

  async create({
    name,
    productId = null,
    code = '',
    unit = 'u',
    productionLevel = 0,
    capacityPct = 0,
    activity = FICHA_ACTIVITIES.BIENES,
    method = FICHA_METHODS.GASTOS,
    inputs = [],
    carriers = null,
    labor = [],
    otherDirect = [],
    rows = null,
    utilityPct = undefined,
    correlationPrice = 0,
    refs = [],
    elaboratedBy = '',
    userId = null
  } = {}) {
    const ts = now()
    const id = newId()
    const sheet = {
      id,
      groupId: id, // la v1 abre su propio grupo; las revisiones lo heredan
      version: 1,
      status: FICHA_STATUS.BORRADOR,
      name: txt(name),
      productId: productId || null, // null = servicio o texto libre
      code: txt(code),
      unit: txt(unit) || 'u',
      productionLevel: num(productionLevel),
      capacityPct: num(capacityPct), // PORCENTAJE (78 = 78%)
      activity,
      method,
      baseFromSheetId: null, // la v1 no tiene Costo Base salvo comparable externo
      inputs: cleanInputs(inputs),
      carriers: cleanCarriers(carriers),
      labor: cleanLabor(labor),
      otherDirect: cleanOtherDirect(otherDirect),
      rows: cleanRows(rows),
      utilityPct: utilityPct === undefined ? defaultUtilityPct(activity) : num(utilityPct),
      correlationPrice: num(correlationPrice),
      refs: cleanRefs(refs),
      elaboratedBy: txt(elaboratedBy),
      approvedBy: '',
      approvedAt: null,
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null
    }
    await db.transaction('rw', db.costSheets, db.auditEvents, async () => {
      await db.costSheets.add(sheet)
      await db.auditEvents.add(auditRow(sheet, FICHA_AUDIT_ACTIONS.CREATE, userId))
    })
    return id
  },

  // Edicion en sitio del BORRADOR (autoguardado). Solo se tocan los campos que
  // llegan; el resto queda como estaba. Una ficha aprobada rebota aqui: para
  // corregirla hay que crear una revision.
  async update(id, fields = {}) {
    const s = await db.costSheets.get(id)
    if (!s) throw new Error('La ficha no existe')
    if (!canEditSheet(s)) {
      throw new Error('Una ficha aprobada no se edita: crea una revisión para corregirla')
    }

    const patch = { updatedAt: now() }
    if (fields.name != null) patch.name = txt(fields.name)
    if (fields.productId !== undefined) patch.productId = fields.productId || null
    if (fields.code != null) patch.code = txt(fields.code)
    if (fields.unit != null) patch.unit = txt(fields.unit) || 'u'
    if (fields.productionLevel != null) patch.productionLevel = num(fields.productionLevel)
    if (fields.capacityPct != null) patch.capacityPct = num(fields.capacityPct)
    if (fields.method != null) patch.method = fields.method
    if (fields.inputs != null) patch.inputs = cleanInputs(fields.inputs)
    if (fields.carriers != null) patch.carriers = cleanCarriers(fields.carriers)
    if (fields.labor != null) patch.labor = cleanLabor(fields.labor)
    if (fields.otherDirect != null) patch.otherDirect = cleanOtherDirect(fields.otherDirect)
    if (fields.rows != null) patch.rows = cleanRows(fields.rows)
    if (fields.correlationPrice != null) patch.correlationPrice = num(fields.correlationPrice)
    if (fields.refs != null) patch.refs = cleanRefs(fields.refs)
    if (fields.elaboratedBy != null) patch.elaboratedBy = txt(fields.elaboratedBy)

    // Cambiar de actividad cambia el techo del Anexo II. Si el dueño no habia
    // escrito su propia tasa, la ficha adopta el maximo de la actividad nueva;
    // si SI la habia escrito, se respeta (es suya, Art. 6).
    if (fields.activity != null) {
      patch.activity = fields.activity
      const teniaPropia = s.utilityPct != null && s.utilityPct !== defaultUtilityPct(s.activity)
      if (!teniaPropia && fields.utilityPct == null) patch.utilityPct = defaultUtilityPct(fields.activity)
    }
    if (fields.utilityPct !== undefined) {
      patch.utilityPct = fields.utilityPct == null ? null : num(fields.utilityPct)
    }

    await db.costSheets.update(id, patch)
  },

  // Aprobar: la ficha queda INMUTABLE y lista para exportar como documento.
  // OJO: sella `updatedAt` ADEMAS de `approvedAt`. `approvedAt` no esta en
  // TS_FIELDS (features/sync/collections.js:97), asi que sin `updatedAt` la
  // aprobacion no superaria el cursor de subida y NO SE SINCRONIZARIA NUNCA,
  // sin ningun error visible: el otro dispositivo seguiria viendola en borrador.
  async approve(id, { approvedBy = '', userId = null } = {}) {
    const ts = now()
    await db.transaction('rw', db.costSheets, db.auditEvents, async () => {
      const s = await db.costSheets.get(id)
      if (!s) throw new Error('La ficha no existe')
      if (!canApproveSheet(s)) throw new Error('Solo un borrador se puede aprobar')
      await db.costSheets.update(id, {
        status: FICHA_STATUS.APROBADA,
        approvedBy: txt(approvedBy),
        approvedAt: ts,
        updatedAt: ts
      })
      await db.auditEvents.add(auditRow(s, FICHA_AUDIT_ACTIONS.APPROVE, userId, txt(approvedBy)))
    })
  },

  // Corregir una ficha aprobada = crear su REVISION (nada se edita ni se borra).
  // La nueva nace como borrador con los mismos datos, hereda el `groupId` y
  // apunta a la anterior en `baseFromSheetId` (la columna "Costo Base" del
  // modelo oficial). La anterior queda 'sustituida'. Todo en UNA transaccion:
  // si algo falla no queda una sustituida sin sucesora.
  async revise(id, { userId = null } = {}) {
    const ts = now()
    const newSheetId = newId()
    await db.transaction('rw', db.costSheets, db.auditEvents, async () => {
      const prev = await db.costSheets.get(id)
      if (!prev) throw new Error('La ficha no existe')
      if (!canReviseSheet(prev)) {
        throw new Error('Solo una ficha aprobada se puede revisar')
      }
      // El registro de la revision lo construye el MOTOR (`reviseFrom`), que es
      // donde se puede probar con node. Incluye las columnas "Costo Base" (la (4)
      // del anexo de insumos y la (2) del de salario) derivadas de esta version:
      // sin ellas, una revision nacia con las dos columnas OFICIALES en ceros y
      // F9 las imprimiria vacias sin que nadie lo notara.
      await db.costSheets.add(reviseFrom(prev, newSheetId, ts))
      await db.costSheets.update(prev.id, { status: FICHA_STATUS.SUSTITUIDA, updatedAt: ts })
      await db.auditEvents.add(
        auditRow({ ...prev, id: newSheetId }, FICHA_AUDIT_ACTIONS.REVISE, userId,
          `Revisión v${nextVersion(prev)} de ${prev.id}`)
      )
    })
    return newSheetId
  },

  // Borrado LOGICO (append-only, como productsRepo.remove): desaparece de la
  // lista pero NADA se borra. Deja constancia en auditoria.
  async remove(id, { userId = null, note = '' } = {}) {
    const ts = now()
    await db.transaction('rw', db.costSheets, db.auditEvents, async () => {
      const s = await db.costSheets.get(id)
      if (!s) throw new Error('La ficha no existe')
      if (!canDeleteSheet(s)) throw new Error('La ficha ya está eliminada')
      await db.costSheets.update(id, { deletedAt: ts, deletedBy: userId, updatedAt: ts })
      await db.auditEvents.add(auditRow(s, FICHA_AUDIT_ACTIONS.DELETE, userId, note))
    })
  },

  // Eventos de auditoria del modulo, para la pestaña "Fichas" de /auditoria (F10).
  async listAudit() {
    const rows = await db.auditEvents.where('entity').equals('costSheet').toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }
}
