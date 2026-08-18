import { normalize } from '../../lib/search'
import { UNITS, FOREIGN_PRICE_CURRENCIES } from '../../db/constants'
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
const TIER_HEADER = 'Escalas mayorista'
const CURRENCY_HEADER = 'Moneda' // modulo 'divisas': moneda del precio/costo (MN/USD)

export const TEMPLATE_HEADERS = [
  'Codigo',
  'Nombre',
  'Categoria',
  'Area',
  'Unidad',
  'Precio venta',
  'Costo',
  'Existencia inicial'
]

// Columnas de la plantilla segun el modulo: la de escalas mayoristas solo se
// ofrece si la licencia trae 'mayorista'; la de Moneda solo con 'divisas' (asi
// no se filtran a los clientes en produccion).
export function templateHeaders(withTiers = false, withCurrency = false) {
  const h = [...TEMPLATE_HEADERS]
  if (withCurrency) h.push(CURRENCY_HEADER)
  if (withTiers) h.push(TIER_HEADER)
  return h
}

const TEMPLATE_EXAMPLE = [
  ['AV001', 'Aceite vegetal 1L', 'Aceites', 'Viveres', 'u', 2.5, 1.8, 30],
  ['CR001', 'Bistec de res', 'Carnes', 'Carniceria', 'kg', 5.0, 3.5, 20]
]

// xlsx se carga bajo demanda (code-splitting): solo pesa cuando se importa.
async function loadXLSX() {
  return import('xlsx')
}

// --- Plantilla descargable (.xlsx) ---
export async function buildTemplateBlob({ withTiers = false, withCurrency = false } = {}) {
  const XLSX = await loadXLSX()
  const head = templateHeaders(withTiers, withCurrency)
  // El orden de los valores del ejemplo sigue al de templateHeaders: primero
  // Moneda (si aplica) y luego Escalas. El 2do producto va en USD como muestra.
  const example = TEMPLATE_EXAMPLE.map((r, i) => {
    const row = [...r]
    if (withCurrency) row.push(i === 1 ? 'USD' : 'MN')
    if (withTiers) row.push(i === 1 ? '20:4.5; 50:4' : '')
    return row
  })
  const ws = XLSX.utils.aoa_to_sheet([head, ...example])
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
  if (['oz', 'onza', 'onzas'].includes(s)) return 'oz'
  if (['g', 'gr', 'gramo', 'gramos'].includes(s)) return 'g'
  if (['ml', 'mililitro', 'mililitros', 'cc'].includes(s)) return 'ml'
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
    tiersText: String(get(['escalas mayorista', 'escalas', 'mayorista', 'precios mayorista'])).trim(),
    // Modulo 'divisas': moneda del precio/costo de la fila (MN/USD). Vacio = base.
    currency: String(get(['moneda', 'currency', 'divisa'])).trim().toUpperCase()
  }
}

// Lee el archivo (.xlsx/.csv) y valida cada fila contra el catalogo existente.
// Devuelve filas con estado: ok | dup (duplicado, se omite) | error.
export async function parseAndValidate(buffer, { existingProducts, withCurrency = false }) {
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
    if (!draft.unit) errors.push('Unidad invalida (u/lb/kg/caja/oz/g/ml)')
    if (draft.price == null) errors.push('Precio de venta invalido')
    // Escalas mayoristas opcionales: "20:100; 50:60" (cantidad:precio).
    const tiersParsed = parseTiersText(draft.tiersText)
    if (!tiersParsed.ok) errors.push('Escalas invalidas (formato 20:100; 50:60)')
    draft.tiers = tiersParsed.tiers

    // Modulo 'divisas': valida/normaliza la moneda SOLO con el modulo activo. Sin
    // el, la columna Moneda se ignora (clasico). Vacia o base = sin priceCurrency;
    // una divisa reconocida marca el producto; cualquier otra cosa es error.
    if (withCurrency && draft.currency && !['MN', ...FOREIGN_PRICE_CURRENCIES].includes(draft.currency)) {
      errors.push('Moneda invalida (MN/USD)')
    }
    draft.priceCurrency =
      withCurrency && FOREIGN_PRICE_CURRENCIES.includes(draft.currency) ? draft.currency : null

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
export async function commitImport(okRows, { userId, withTiers = false }) {
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
      priceTiers: withTiers ? (r.draft.tiers || []) : [],
      // Modulo 'divisas': ya viene gateado por parseAndValidate (solo se fija con
      // el modulo y una divisa reconocida); si no, undefined -> base clasica.
      priceCurrency: r.draft.priceCurrency || undefined,
      userId
    })
    created++
  }
  if (areasChanged) await configRepo.setAreas(areas)
  return created
}
