import { normalize } from '../../lib/search'
import { UNITS } from '../../db/constants'
import { parseTiersText } from '../../lib/priceTiers'
import { productsRepo } from '../../repositories/productsRepo'
import { categoriesRepo } from '../../repositories/categoriesRepo'
import { configRepo } from '../../repositories/configRepo'

// Columnas de la plantilla de CATALOGO (crea productos). Mismo orden de
// identificacion que la plantilla de entradas (Codigo, Nombre) para que sean
// coherentes. `Area` es el area PRINCIPAL informativa del producto; la
// `Existencia inicial` ingresa al ALMACEN central (desde ahi se reparte a las
// areas con "Salida a area"). `Escalas mayorista` (opcional, modulo mayorista):
// precios por unidad segun cantidad, formato "20:100; 50:60".
export const TEMPLATE_HEADERS = [
  'Codigo',
  'Nombre',
  'Categoria',
  'Area',
  'Unidad',
  'Precio venta',
  'Costo',
  'Existencia inicial',
  'Escalas mayorista'
]

const TEMPLATE_EXAMPLE = [
  ['AV001', 'Aceite vegetal 1L', 'Aceites', 'Viveres', 'u', 2.5, 1.8, 30, ''],
  ['CR001', 'Bistec de res', 'Carnes', 'Carniceria', 'kg', 5.0, 3.5, 20, '20:4.5; 50:4']
]

// xlsx se carga bajo demanda (code-splitting): solo pesa cuando se importa.
async function loadXLSX() {
  return import('xlsx')
}

// --- Plantilla descargable (.xlsx) ---
export async function buildTemplateBlob() {
  const XLSX = await loadXLSX()
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...TEMPLATE_EXAMPLE])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Productos')
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })
}

// Normaliza el encabezado de columna para tolerar acentos/mayusculas/espacios.
function normHeader(h) {
  return normalize(h).replace(/\s+/g, ' ')
}

function parseNum(v) {
  if (v === '' || v == null) return null
  if (typeof v === 'number') return v
  let s = String(v).trim().replace(/[^0-9.,-]/g, '')
  if (s.includes('.') && s.includes(',')) s = s.replace(/,/g, '') // coma = miles
  else s = s.replace(',', '.') // coma = decimal
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

function parseUnit(v) {
  const s = normalize(v)
  if (['u', 'un', 'und', 'unidad', 'unidades', 'u.'].includes(s)) return 'u'
  if (['kg', 'kgs', 'kilo', 'kilos', 'kilogramo', 'kilogramos'].includes(s)) return 'kg'
  if (['caja', 'cajas', 'cj'].includes(s)) return 'caja'
  return UNITS.includes(s) ? s : ''
}

// Extrae los campos canonicos de una fila cruda (objeto keyed por encabezado).
function extractRow(obj) {
  const get = (names) => {
    for (const k of Object.keys(obj)) {
      if (names.includes(normHeader(k))) return obj[k]
    }
    return ''
  }
  return {
    name: String(get(['nombre', 'producto', 'descripcion'])).trim(),
    code: String(get(['codigo', 'code', 'sku'])).trim(),
    category: String(get(['categoria', 'category', 'rubro'])).trim(),
    area: String(get(['area', 'zona', 'seccion', 'departamento'])).trim(),
    unit: parseUnit(get(['unidad', 'unit', 'um', 'u/m', 'medida'])),
    price: parseNum(get(['precio venta', 'precio', 'precio de venta', 'pvp', 'venta'])),
    cost: parseNum(get(['costo', 'coste', 'cost'])) ?? 0,
    stock: parseNum(get(['existencia inicial', 'existencia', 'stock', 'cantidad', 'inventario'])) ?? 0,
    tiersText: String(get(['escalas mayorista', 'escalas', 'mayorista', 'precios mayorista'])).trim()
  }
}

// Lee el archivo (.xlsx/.csv) y valida cada fila contra el catalogo existente.
// Devuelve filas con estado: ok | dup (duplicado, se omite) | error.
export async function parseAndValidate(buffer, { existingProducts }) {
  const XLSX = await loadXLSX()
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return { rows: [], summary: { total: 0, ok: 0, dup: 0, error: 0 } }
  const json = XLSX.utils.sheet_to_json(ws, { defval: '' })

  const existCodes = new Set(existingProducts.filter((p) => p.code).map((p) => normalize(p.code)))
  const existNames = new Set(existingProducts.map((p) => normalize(p.name)))
  const seenCodes = new Set()
  const seenNames = new Set()

  const rows = json.map((obj, i) => {
    const draft = extractRow(obj)
    const errors = []
    if (!draft.name) errors.push('Falta el nombre')
    if (!draft.unit) errors.push('Unidad invalida (u/kg/caja)')
    if (draft.price == null) errors.push('Precio de venta invalido')
    // Escalas mayoristas opcionales: "20:100; 50:60" (cantidad:precio).
    const tiersParsed = parseTiersText(draft.tiersText)
    if (!tiersParsed.ok) errors.push('Escalas invalidas (formato 20:100; 50:60)')
    draft.tiers = tiersParsed.tiers

    let status = errors.length ? 'error' : 'ok'
    let dupReason = ''
    if (status === 'ok') {
      const codeKey = draft.code ? normalize(draft.code) : ''
      const nameKey = normalize(draft.name)
      if (codeKey && (existCodes.has(codeKey) || seenCodes.has(codeKey))) {
        status = 'dup'
        dupReason = `Codigo repetido (${draft.code})`
      } else if (existNames.has(nameKey) || seenNames.has(nameKey)) {
        status = 'dup'
        dupReason = 'Nombre ya existe'
      } else {
        if (codeKey) seenCodes.add(codeKey)
        seenNames.add(nameKey)
      }
    }
    return { line: i + 2, draft, status, errors, dupReason }
  })

  const summary = {
    total: rows.length,
    ok: rows.filter((r) => r.status === 'ok').length,
    dup: rows.filter((r) => r.status === 'dup').length,
    error: rows.filter((r) => r.status === 'error').length
  }
  return { rows, summary }
}

// Confirma la importacion: crea categorias faltantes y los productos validos
// (con su existencia inicial trazada en el libro mayor).
export async function commitImport(okRows, { userId }) {
  const cats = await categoriesRepo.list()
  const catByName = {}
  for (const c of cats) catByName[normalize(c.name)] = c.id

  // Areas existentes: si en el archivo aparece un area nueva, se da de alta en
  // la config (igual que las categorias) para que el producto entre a su area.
  const areas = await configRepo.getAreas()
  const areaByKey = {}
  for (const a of areas) areaByKey[normalize(a)] = a
  let areasChanged = false

  let created = 0
  for (const r of okRows) {
    let categoryId = null
    const catName = r.draft.category
    if (catName) {
      const key = normalize(catName)
      if (!catByName[key]) {
        categoryId = await categoriesRepo.create(catName)
        catByName[key] = categoryId
      } else {
        categoryId = catByName[key]
      }
    }
    // Resuelve el area al nombre canonico ya configurado; si es nueva, la agrega.
    let area = ''
    if (r.draft.area) {
      const key = normalize(r.draft.area)
      if (!areaByKey[key]) {
        areaByKey[key] = r.draft.area
        areas.push(r.draft.area)
        areasChanged = true
      }
      area = areaByKey[key]
    }
    await productsRepo.create({
      code: r.draft.code,
      name: r.draft.name,
      categoryId,
      area,
      unit: r.draft.unit,
      price: r.draft.price,
      cost: r.draft.cost,
      openingStock: r.draft.stock,
      priceTiers: r.draft.tiers || [],
      userId
    })
    created++
  }
  if (areasChanged) await configRepo.setAreas(areas)
  return created
}
