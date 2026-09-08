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
import {
  cleanCarriers,
  cleanRows,
  hydrateSheet,
  groupLinesBySheet,
  linesFromArrays,
  isEmptyDelta
} from '../lib/fichaLines'

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
//  - Los CUATRO ANEXOS (insumos, salario, otros directos, referencias) NO viven
//    dentro del documento: cada linea es un registro de `costSheetLines` (Dexie
//    v19, hallazgo H3). La ficha la editan DOS mandos -el dueño y el
//    administrativo- y con los anexos dentro del documento la fusion LWW le
//    borraba el anexo entero al otro, en silencio. Al leer se HIDRATA, asi que
//    el motor, los reportes y la pantalla siguen viendo `sheet.inputs` y
//    compañia, exactamente igual que antes.
//
// Forma de un registro `costSheets` (docs/FICHA-COSTO.md §4):
//   { id, groupId, version, status, name, productId, code, unit,
//     productionLevel, capacityPct, activity, method, baseFromSheetId,
//     carriers:{fuel,energy,water},
//     rows:{ r4, r41, r6, r61, r7, r71, r8, r9, taxSS, taxFT }, utilityPct,
//     correlationPrice, elaboratedBy, approvedBy, approvedAt,
//     createdAt, updatedAt, deletedAt,
//     inputs[], labor[], otherDirect[], refs[] <- FOSIL: solo se leen en fichas
//       anteriores a v19, y solo hasta que esa ficha se edita por primera vez }

const txt = (v) => String(v ?? '').trim()
const num = (v) => Number(v) || 0

// La normalizacion de las lineas y de las dos filas fijas (`cleanLines`,
// `cleanCarriers`, `cleanRows`) vivia AQUI y se mudo a `lib/fichaLines.js`: ahi
// es pura y se prueba con node, y ademas la usa el diff del autoguardado, que
// tiene que comparar exactamente con el mismo criterio con el que se escribe.

// Lee las lineas de una ficha y devuelve el documento HIDRATADO, que es como lo
// espera el resto del programa (`sheet.inputs`, `sheet.labor`, ...). Ni el motor
// ni los reportes ni los bloques de la pantalla saben que las lineas viven en su
// propia tabla.
async function withLines(sheet) {
  if (!sheet) return sheet
  const lines = await db.costSheetLines.where('sheetId').equals(sheet.id).toArray()
  return hydrateSheet(sheet, lines)
}

// Lo mismo para una lista, con UNA sola lectura de la tabla de lineas (la
// pantalla de fichas calcula el precio de cada una: hidratarlas de una en una
// serian N consultas).
async function withLinesAll(sheets) {
  if (!sheets.length) return sheets
  const all = await db.costSheetLines.toArray()
  const byId = groupLinesBySheet(all)
  return sheets.map((s) => {
    const lines = byId.get(s.id) || []
    const h = hydrateSheet(s, lines)
    // Marca DERIVADA para ordenar la lista: la ficha se "toco" tambien cuando se
    // edito una linea, y una edicion de linea NO sella la cabecera a proposito
    // (sellarla la re-subiria entera y volveria a abrir la puerta que cierra H3).
    // Derivada, no guardada: como `products.stock` sale del libro mayor.
    let touchedAt = h.updatedAt || h.createdAt || 0
    for (const l of lines) if (l?.updatedAt > touchedAt) touchedAt = l.updatedAt
    return { ...h, touchedAt }
  })
}

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

// Parche de CABECERA. Devuelve `null` si no hay nada que escribir: sin esa
// guarda, guardar "nada" sellaria `updatedAt` y subiria la ficha entera a la
// nube sin haber cambiado un solo campo (y en la nube, subirla entera es
// exactamente lo que le pisa la cabecera al otro mando).
function headerPatch(s, fields = {}, ts) {
  const patch = {}
  if (fields.name != null) patch.name = txt(fields.name)
  if (fields.productId !== undefined) patch.productId = fields.productId || null
  if (fields.code != null) patch.code = txt(fields.code)
  if (fields.unit != null) patch.unit = txt(fields.unit) || 'u'
  if (fields.productionLevel != null) patch.productionLevel = num(fields.productionLevel)
  if (fields.capacityPct != null) patch.capacityPct = num(fields.capacityPct)
  if (fields.method != null) patch.method = fields.method
  if (fields.carriers != null) patch.carriers = cleanCarriers(fields.carriers)
  if (fields.rows != null) patch.rows = cleanRows(fields.rows)
  if (fields.correlationPrice != null) patch.correlationPrice = num(fields.correlationPrice)
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

  if (!Object.keys(patch).length) return null
  patch.updatedAt = ts
  return patch
}

export const costSheetsRepo = {
  // Las eliminadas (borrado logico) no se listan, pero siguen en la base.
  async list() {
    const all = await db.costSheets.toArray()
    return withLinesAll(all.filter((s) => !s.deletedAt))
  },

  async get(id) {
    return withLines(await db.costSheets.get(id))
  },

  // Todas las versiones de una misma ficha (v1, v2, v3...), de la mas nueva a la
  // mas vieja. Es lo que alimenta la columna "Costo Base" y el historial.
  async listByGroup(groupId) {
    const rows = await db.costSheets.where('groupId').equals(groupId).toArray()
    rows.sort((a, b) => (Number(b.version) || 0) - (Number(a.version) || 0))
    return withLinesAll(rows)
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
      // Los cuatro anexos nacen VACIOS en la cabecera: sus lineas viven en
      // `costSheetLines` (H3). Los arrays se conservan en el registro por
      // compatibilidad de lectura de fichas viejas, pero una ficha nueva no los
      // usa nunca: la fuente es la tabla de lineas.
      inputs: [],
      carriers: cleanCarriers(carriers),
      labor: [],
      otherDirect: [],
      rows: cleanRows(rows),
      utilityPct: utilityPct === undefined ? defaultUtilityPct(activity) : num(utilityPct),
      correlationPrice: num(correlationPrice),
      refs: [],
      elaboratedBy: txt(elaboratedBy),
      approvedBy: '',
      approvedAt: null,
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null
    }
    // Si el alta trae anexos (hoy la pantalla crea la ficha con el bloque 1 y ya,
    // pero la firma los acepta desde F4), nacen como LINEAS, no dentro del
    // documento. Los ids son deterministas: dos dispositivos no pueden duplicar.
    const lines = linesFromArrays({ id, inputs, labor, otherDirect, refs }, ts)
    await db.transaction('rw', db.costSheets, db.costSheetLines, db.auditEvents, async () => {
      await db.costSheets.add(sheet)
      if (lines.length) await db.costSheetLines.bulkAdd(lines)
      await db.auditEvents.add(auditRow(sheet, FICHA_AUDIT_ACTIONS.CREATE, userId))
    })
    return id
  },

  // Edicion en sitio del BORRADOR: SOLO LA CABECERA. Los cuatro anexos ya no se
  // escriben por aqui (viven en `costSheetLines`); si llegaran en `fields` se
  // ignoran a proposito, para que nadie los devuelva al documento por descuido.
  // Solo se tocan los campos que llegan; el resto queda como estaba. Una ficha
  // aprobada rebota aqui: para corregirla hay que crear una revision.
  async update(id, fields = {}) {
    const s = await db.costSheets.get(id)
    if (!s) throw new Error('La ficha no existe')
    if (!canEditSheet(s)) {
      throw new Error('Una ficha aprobada no se edita: crea una revisión para corregirla')
    }
    const patch = headerPatch(s, fields, now())
    if (patch) await db.costSheets.update(id, patch)
  },

  // GUARDADO DEL EDITOR (H3): escribe SOLO lo que el dueño cambio.
  //
  // El `delta` lo calcula `diffSheet` (`lib/fichaLines.js`, puro y probado con
  // node) comparando el formulario contra lo ultimo que guardamos NOSOTROS. Por
  // eso una linea que este mando no toco no se escribe nunca, y no puede pisar
  // la que el otro acaba de guardar desde su telefono.
  //
  // La cabecera se sella SOLO si cambio un campo de cabecera: una edicion de
  // linea no la toca. Sellarla en cada tecleo re-subiria el documento entero y
  // volveria a abrir, por la puerta de al lado, el problema que esto cierra.
  async saveEdit(id, delta = {}) {
    if (isEmptyDelta(delta)) return
    const ts = now()
    const { adds = [], patches = [], voids = [] } = delta.lines || {}
    await db.transaction('rw', db.costSheets, db.costSheetLines, async () => {
      const s = await db.costSheets.get(id)
      if (!s) throw new Error('La ficha no existe')
      if (!canEditSheet(s)) {
        throw new Error('Una ficha aprobada no se edita: crea una revisión para corregirla')
      }

      // Ficha del formato viejo (anexos dentro del documento) que se edita por
      // primera vez: se convierte a lineas ANTES de aplicar nada, porque los
      // parches y las anulaciones apuntan a los ids deterministas de esa
      // conversion. Los arrays del documento NO se borran (regla 6): quedan como
      // fosil y dejan de leerse en cuanto existe una linea.
      const yaTieneLineas = await db.costSheetLines.where('sheetId').equals(id).count()
      if (!yaTieneLineas) {
        const legado = linesFromArrays(s, ts)
        if (legado.length) await db.costSheetLines.bulkAdd(legado)
      }

      // Altas CON GUARDA DE EXISTENCIA: un doble toque, un reintento o una
      // fusion que ya trajo la linea no la duplican (mismo patron que los ids
      // deterministas de las entregas).
      if (adds.length) {
        const previas = await db.costSheetLines.bulkGet(adds.map((a) => a.id))
        const nuevas = adds.filter((_, i) => !previas[i])
        if (nuevas.length) await db.costSheetLines.bulkAdd(nuevas)
      }
      for (const p of [...patches, ...voids]) {
        await db.costSheetLines.update(p.id, p.fields)
      }

      const patch = headerPatch(s, delta.header || {}, ts)
      if (patch) await db.costSheets.update(id, patch)
    })
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
    await db.transaction('rw', db.costSheets, db.costSheetLines, db.auditEvents, async () => {
      const raw = await db.costSheets.get(id)
      if (!raw) throw new Error('La ficha no existe')
      if (!canReviseSheet(raw)) {
        throw new Error('Solo una ficha aprobada se puede revisar')
      }
      // La version anterior se lee HIDRATADA: las columnas "Costo Base" salen de
      // sus lineas, que ya no viven dentro del documento.
      const prevLines = await db.costSheetLines.where('sheetId').equals(id).toArray()
      const prev = hydrateSheet(raw, prevLines)
      // El registro de la revision lo construye el MOTOR (`reviseFrom`), que es
      // donde se puede probar con node. Incluye las columnas "Costo Base" (la (4)
      // del anexo de insumos y la (2) del de salario) derivadas de esta version:
      // sin ellas, una revision nacia con las dos columnas OFICIALES en ceros y
      // F9 las imprimiria vacias sin que nadie lo notara.
      const nueva = reviseFrom(prev, newSheetId, ts)
      // Y sus anexos nacen como LINEAS PROPIAS, con ids nuevos (deterministas de
      // la revision): copiar los ids de la version anterior habria hecho que dos
      // fichas compartieran las mismas lineas, y editar una habria cambiado la
      // otra, que es una ficha YA APROBADA e inmutable.
      const nuevasLineas = linesFromArrays(nueva, ts)
      await db.costSheets.add({ ...nueva, inputs: [], labor: [], otherDirect: [], refs: [] })
      if (nuevasLineas.length) await db.costSheetLines.bulkAdd(nuevasLineas)
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
