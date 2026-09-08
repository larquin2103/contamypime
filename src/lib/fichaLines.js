// Lineas de los anexos de la ficha de costo, como FILAS SUELTAS.
//
// POR QUE EXISTE ESTE FICHERO (hallazgo H3, 05-09-2026). Hasta aqui los cuatro
// anexos (`inputs`, `labor`, `otherDirect`, `refs`) vivian como ARRAYS DENTRO
// del documento `costSheets`, con esta justificacion escrita en docs §4: "la
// ficha la edita un solo actor". El dueño respondio que NO: la llenan el dueño
// Y el administrativo. Con arrays dentro del documento y fusion LWW sobre el
// documento entero (`pullEngine` hace `bulkPut`, no fusiona campos), el ultimo
// en guardar se lleva por delante el anexo completo del otro, sin aviso y sin
// rastro. Es exactamente lo que obligo a `orderItems` (mesas) a ser filas
// sueltas, y aqui aplica igual.
//
// El patron es el de `orderItems`: cada linea es su PROPIO registro, con su id,
// y la sincronizacion fusiona linea a linea. Quitar una linea NO la borra: la
// marca `voided` (append-only, regla 6). La ficha se HIDRATA al leerla, asi que
// el motor (`fichaCosto.js`), los reportes y los bloques de la pantalla siguen
// recibiendo la misma forma de siempre: `sheet.inputs`, `sheet.labor`, etc. No
// se toco ni una linea de la aritmetica ya contrastada contra la Gaceta.
//
// Todo lo de aqui es PURO (sin Dexie): se prueba con `node src/lib/fichaLines.test.mjs`.

const txt = (v) => String(v ?? '').trim()
const num = (v) => Number(v) || 0

// Las cuatro clases de linea. La clave ES el nombre del campo en la ficha, para
// que hidratar y volcar sean la misma tabla de nombres.
export const FICHA_LINE_KINDS = ['inputs', 'labor', 'otherDirect', 'refs']

// --- Normalizacion (vino de costSheetsRepo; aqui SI se puede probar con node) --
//
// A DIFERENCIA de `recipesRepo.cleanItems`, aqui NO se descartan las filas
// incompletas: una ficha se teclea a lo largo de un rato con autoguardado, y
// tirar la linea a medio escribir le borraria al dueño lo que acaba de poner. Se
// normaliza la FORMA y ya; el motor trata lo vacio como cero.
const CLEANERS = {
  inputs: (i) => ({
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
  }),
  labor: (o) => ({
    operation: txt(o?.operation), // columna (1)
    baseCost: num(o?.baseCost), // columna (2)
    workers: num(o?.workers), // columna (3)
    category: txt(o?.category), // columna (4)
    scaleGroup: txt(o?.scaleGroup), // columna (5)
    hourly: num(o?.hourly), // columna (6)
    extraHourly: num(o?.extraHourly), // columna (7) nocturnidad, peligrosidad
    hours: num(o?.hours) // columna (8) norma de tiempo
  }),
  otherDirect: (x) => ({ concept: txt(x?.concept), amount: num(x?.amount) }),
  refs: (x) => ({ source: txt(x?.source), price: num(x?.price), note: txt(x?.note) })
}

export function cleanLine(kind, row) {
  const f = CLEANERS[kind]
  return f ? f(row) : {}
}

export const cleanLines = (kind, list) => (list || []).map((r) => cleanLine(kind, r))

// Portadores (filas 1.2, 1.3 y 1.4). Forma fija: siempre las tres, aunque vayan
// en cero, para que la pantalla no tenga que comprobar si existen.
export function cleanCarriers(c) {
  const one = (x) => ({ qty: num(x?.qty), unitPrice: num(x?.unitPrice) })
  return { fuel: one(c?.fuel), energy: one(c?.energy), water: one(c?.water) }
}

// Filas capturadas del Anexo I. Se guardan TODAS aunque valgan cero: son filas
// del modelo oficial, no campos opcionales.
export function cleanRows(r) {
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

// --- Hidratacion -----------------------------------------------------------

// Id DETERMINISTA de una linea heredada del formato viejo (arrays dentro del
// documento). Que sea determinista es lo que hace segura la conversion: dos
// dispositivos que conviertan la misma ficha vieja producen EXACTAMENTE los
// mismos ids, asi que la fusion no puede duplicar ni una linea. Es la misma
// idea que los ids deterministas de las entregas (`custody:deliver:<id>`).
export const legacyLineId = (sheetId, kind, i) => `fl:${sheetId}:${kind}:${i}`

// Convierte los arrays de una ficha VIEJA en registros de linea. Solo se usa
// una vez por ficha (la primera vez que se edita); despues mandan las lineas.
export function linesFromArrays(sheet, ts) {
  const out = []
  if (!sheet?.id) return out
  for (const kind of FICHA_LINE_KINDS) {
    const list = Array.isArray(sheet?.[kind]) ? sheet[kind] : []
    list.forEach((row, i) => {
      out.push({
        id: legacyLineId(sheet.id, kind, i),
        sheetId: sheet.id,
        kind,
        pos: i,
        voided: false,
        ...cleanLine(kind, row),
        createdAt: ts,
        updatedAt: ts
      })
    })
  }
  return out
}

// La ficha COMO LA ESPERA EL RESTO DEL PROGRAMA: con sus cuatro arrays.
//
// Regla de procedencia, sin campo bandera: si la ficha tiene ALGUNA linea de esa
// clase (incluidas las anuladas), mandan las lineas; si no tiene NINGUNA, se cae
// al array del documento, que es el formato viejo. No hace falta bandera porque
// las anuladas NO se borran (regla 6): una clase que llego a tener lineas nunca
// se queda a cero registros, asi que nunca puede resucitar el array viejo.
export function hydrateSheet(sheet, lines = []) {
  if (!sheet) return sheet
  const byKind = {}
  for (const l of lines) {
    if (!l || l.sheetId !== sheet.id) continue
    if (byKind[l.kind]) byKind[l.kind].push(l)
    else byKind[l.kind] = [l]
  }
  const out = { ...sheet }
  for (const kind of FICHA_LINE_KINDS) {
    const rows = byKind[kind]
    if (!rows) {
      // Formato viejo (o ficha nueva vacia): el array del documento, con id y
      // posicion deterministas para que el diff pueda trabajar con el.
      const list = Array.isArray(sheet[kind]) ? sheet[kind] : []
      out[kind] = list.map((row, i) => ({
        id: legacyLineId(sheet.id, kind, i), pos: i, ...cleanLine(kind, row)
      }))
      continue
    }
    out[kind] = rows
      .filter((l) => !l.voided)
      .sort((a, b) => (Number(a.pos) || 0) - (Number(b.pos) || 0))
      .map((l) => ({ id: l.id, pos: Number(l.pos) || 0, ...cleanLine(l.kind, l) }))
  }
  return out
}

// Agrupa un lote de lineas por ficha, para hidratar una lista entera con UNA
// sola lectura de la tabla (la pantalla de fichas calcula el precio de cada una).
export function groupLinesBySheet(lines = []) {
  const map = new Map()
  for (const l of lines) {
    if (!l?.sheetId) continue
    const arr = map.get(l.sheetId)
    if (arr) arr.push(l)
    else map.set(l.sheetId, [l])
  }
  return map
}

// --- Diferencia (lo que el dueño CAMBIO, y nada mas) ------------------------
//
// ESTA ES LA OTRA MITAD DE H3. Antes el autoguardado mandaba el formulario
// ENTERO cada 600 ms, asi que una pantalla abierta con datos viejos reescribia
// -con la siguiente tecla- lo que el otro dispositivo acababa de guardar. Ahora
// se escribe SOLO lo que cambio respecto de lo ultimo que guardamos NOSOTROS:
// una linea que el dueño no toco no se escribe nunca, y por lo tanto no puede
// pisar la del administrativo.

const eqVal = (a, b) => a === b || (a == null && b == null)
const eqJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

// Campos de CABECERA que maneja el formulario. `utilityPct` esta en la lista
// pero solo se compara SI LA CLAVE EXISTE en el formulario: mientras el dueño no
// toque la tasa, el campo no viaja y manda la regla cruzada del repo (adoptar el
// maximo de la actividad nueva). Ver el comentario de `pick` en CostSheetScreen.
export const FICHA_HEADER_FIELDS = [
  'name', 'productId', 'code', 'unit', 'productionLevel', 'capacityPct',
  'activity', 'method', 'carriers', 'rows', 'correlationPrice', 'elaboratedBy',
  'utilityPct'
]

const NUM_FIELDS = new Set(['productionLevel', 'capacityPct', 'correlationPrice'])
const TXT_FIELDS = new Set(['name', 'code', 'unit', 'elaboratedBy'])

function sameHeaderField(k, a, b) {
  if (k === 'carriers') return eqJson(cleanCarriers(a), cleanCarriers(b))
  if (k === 'rows') return eqJson(cleanRows(a), cleanRows(b))
  if (NUM_FIELDS.has(k)) return num(a) === num(b)
  if (TXT_FIELDS.has(k)) return txt(a) === txt(b)
  // `utilityPct` es numerico pero su `null` SIGNIFICA algo (actividad sin tasa
  // en el Anexo II): no se puede colapsar a 0 con `num`.
  if (k === 'utilityPct') return (a == null && b == null) || (a != null && b != null && num(a) === num(b))
  return eqVal(a ?? null, b ?? null)
}

export function diffHeader(baseline = {}, current = {}) {
  const out = {}
  for (const k of FICHA_HEADER_FIELDS) {
    if (!(k in current)) continue // el formulario no lo maneja: no se toca
    if (!sameHeaderField(k, current[k], baseline?.[k])) out[k] = current[k]
  }
  return out
}

// Diferencia de un anexo. `baseline` son las lineas tal como las dejamos la
// ultima vez (todas con id); `current` es lo que hay en el formulario.
export function diffLines(kind, baseline = [], current = [], { sheetId, ts, mintId } = {}) {
  const prev = new Map((baseline || []).filter((r) => r?.id).map((r) => [r.id, r]))
  const adds = []
  const patches = []
  const voids = []
  let nextPos = (baseline || []).reduce((m, r) => Math.max(m, Number(r?.pos) || 0), -1) + 1
  const seen = new Set()

  const acuñar = () => (mintId ? mintId() : `fl:${sheetId}:${kind}:nueva:${nextPos}:${ts}`)

  for (const row of current || []) {
    const campos = cleanLine(kind, row)
    let id = row?.id
    // DOS LINEAS CON EL MISMO ID es lo peor que puede pasar aqui: la segunda se
    // comeria a la primera al guardar y una operacion desapareceria en silencio.
    // Pasa en cuanto alguien DUPLICA una fila con `{ ...fila }` (lo hacia
    // `splitLaborOp`, "otra norma de tiempo"), asi que la guarda va tambien aqui
    // abajo y no solo en quien llama: la segunda se trata como linea NUEVA.
    const repetida = !!id && seen.has(id)
    if (!id || repetida || !prev.has(id)) {
      if (!id || repetida) id = acuñar()
      seen.add(id)
      // Linea nueva. El id lo pone la pantalla al crearla, NUNCA la posicion: con
      // el indice como clave, borrar una linea le cambiaria la identidad a todas
      // las de abajo.
      adds.push({
        id,
        sheetId,
        kind,
        pos: nextPos++,
        voided: false,
        ...campos,
        createdAt: ts,
        updatedAt: ts
      })
      continue
    }
    seen.add(id)
    const antes = cleanLine(kind, prev.get(id))
    const cambios = {}
    for (const k of Object.keys(campos)) {
      if (!eqVal(campos[k], antes[k])) cambios[k] = campos[k]
    }
    // Se mandan SOLO los campos que cambiaron: si el otro dispositivo toco otra
    // columna de la misma linea, su valor sobrevive en el registro local.
    if (Object.keys(cambios).length) patches.push({ id, fields: { ...cambios, updatedAt: ts } })
  }

  for (const r of baseline || []) {
    if (r?.id && !seen.has(r.id)) voids.push({ id: r.id, fields: { voided: true, updatedAt: ts } })
  }
  return { adds, patches, voids }
}

// La diferencia COMPLETA de la ficha: cabecera + los cuatro anexos.
export function diffSheet(baseline = {}, current = {}, { sheetId, ts, mintId } = {}) {
  const header = diffHeader(baseline, current)
  const lines = { adds: [], patches: [], voids: [] }
  for (const kind of FICHA_LINE_KINDS) {
    if (!Array.isArray(current?.[kind])) continue // el formulario no maneja ese anexo
    const d = diffLines(kind, baseline?.[kind], current[kind], { sheetId, ts, mintId })
    lines.adds.push(...d.adds)
    lines.patches.push(...d.patches)
    lines.voids.push(...d.voids)
  }
  return { header, lines }
}

// Si no cambio nada, no se escribe NADA: sin esta guarda el autoguardado sellaria
// `updatedAt` por abrir la ficha y la subiria a la nube sin haber cambiado nada.
export function isEmptyDelta(delta) {
  if (!delta) return true
  const l = delta.lines || {}
  return (
    Object.keys(delta.header || {}).length === 0 &&
    !(l.adds || []).length && !(l.patches || []).length && !(l.voids || []).length
  )
}
