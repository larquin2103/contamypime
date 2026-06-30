import { normalize } from '../../lib/search'
import { round2 } from '../../lib/currency'

// ---------------------------------------------------------------------------
// Importacion MASIVA de entradas de mercancia desde Excel/CSV.
//
// La hoja coteja por CODIGO (o nombre) contra el catalogo existente y arma las
// lineas de la entrada (producto + cantidad + costo). Los codigos que no estan
// en el catalogo se reportan como "no encontrados" (primero hay que crearlos,
// p.ej. con Catalogo -> Importar). El registro final lo hace la pantalla de
// Entrada (mismo flujo de siempre: revisar y "Registrar entrada").
//
// La `Cantidad` es lo que ENTRA (se SUMA a la existencia actual del almacen,
// no la reemplaza); cada entrada ingresa al ALMACEN central. Mismas columnas de
// identificacion (Codigo, Nombre) que la plantilla de catalogo, para coherencia.
// ---------------------------------------------------------------------------

export const ENTRY_TEMPLATE_HEADERS = ['Codigo', 'Nombre', 'Cantidad', 'Costo']

const ENTRY_TEMPLATE_EXAMPLE = [
  ['AV001', 'Aceite vegetal 1L', 10, 1.8],
  ['AR001', 'Arroz 1kg', 25, 0.85]
]

async function loadXLSX() {
  return import('xlsx')
}

export async function buildEntryTemplateBlob() {
  const XLSX = await loadXLSX()
  const ws = XLSX.utils.aoa_to_sheet([ENTRY_TEMPLATE_HEADERS, ...ENTRY_TEMPLATE_EXAMPLE])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Entrada')
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })
}

function normHeader(h) {
  return normalize(h).replace(/\s+/g, ' ')
}

function parseNum(v) {
  if (v === '' || v == null) return null
  if (typeof v === 'number') return v
  let s = String(v).trim().replace(/[^0-9.,-]/g, '')
  if (s.includes('.') && s.includes(',')) s = s.replace(/,/g, '')
  else s = s.replace(',', '.')
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

// Lee el archivo y devuelve las lineas listas + lo que no se pudo cotejar.
export async function parseEntryFile(buffer, existingProducts) {
  const XLSX = await loadXLSX()
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return { lines: [], notFound: [], errors: [], total: 0 }
  const json = XLSX.utils.sheet_to_json(ws, { defval: '' })

  const byCode = new Map()
  const byName = new Map()
  for (const p of existingProducts) {
    if (p.code) byCode.set(normalize(p.code), p)
    byName.set(normalize(p.name), p)
  }

  const lines = []
  const notFound = []
  const errors = []
  const lineByProduct = new Map()

  json.forEach((obj, i) => {
    const lineNo = i + 2
    const get = (names) => {
      for (const k of Object.keys(obj)) if (names.includes(normHeader(k))) return obj[k]
      return ''
    }
    const code = String(get(['codigo', 'code', 'sku'])).trim()
    const name = String(get(['nombre', 'producto', 'descripcion'])).trim()
    const qty = parseNum(get(['cantidad', 'qty', 'existencia', 'stock']))
    const cost = parseNum(get(['costo', 'coste', 'cost']))

    const key = code ? normalize(code) : ''
    const product = key ? byCode.get(key) : name ? byName.get(normalize(name)) : null

    if (!product) {
      notFound.push(code || name || `fila ${lineNo}`)
      return
    }
    if (qty == null || qty <= 0) {
      errors.push(`Fila ${lineNo}: cantidad invalida para ${product.name}`)
      return
    }

    // Si el mismo producto aparece varias veces, se suman las cantidades.
    const existing = lineByProduct.get(product.id)
    if (existing) {
      existing.qty = round2(existing.qty + qty)
      if (cost != null) existing.unitCost = cost
      return
    }
    const line = {
      productId: product.id,
      name: product.name,
      unit: product.unit,
      qty,
      unitCost: cost != null ? cost : product.cost || 0
    }
    lineByProduct.set(product.id, line)
    lines.push(line)
  })

  return { lines, notFound, errors, total: json.length }
}
