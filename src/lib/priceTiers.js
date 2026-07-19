import { round2 } from './currency'

// ---------------------------------------------------------------------------
// Escalas de precio mayorista (Bloque B, modulo 'mayorista').
//
// Un producto puede tener `priceTiers = [{ minQty, price }]`: a partir de
// `minQty` unidades (la unidad definida en el inventario), el precio POR
// UNIDAD pasa a ser `price`. Ej.: >=20 -> 100, >=50 -> 60. Con menos del
// primer minQty rige el precio normal del producto. Se aplica la escala de
// mayor minQty alcanzada por la cantidad de la linea.
//
// El precio elegido se CONGELA por linea de venta (regla de oro intacta):
// cambiar las escalas despues no altera ventas pasadas.
// ---------------------------------------------------------------------------

// Valida y normaliza una lista de escalas: numeros positivos, minQty > 1,
// sin minQty duplicados, ordenadas de menor a mayor. Devuelve [] si no hay.
export function normalizeTiers(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const out = []
  for (const t of raw) {
    const minQty = Number(t?.minQty)
    const price = Number(t?.price)
    if (!Number.isFinite(minQty) || minQty <= 1) continue
    if (!Number.isFinite(price) || price < 0) continue
    const key = round2(minQty)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ minQty: round2(minQty), price: round2(price) })
  }
  return out.sort((a, b) => a.minQty - b.minQty)
}

// Escala aplicable a una cantidad (la de mayor minQty alcanzada), o null.
export function tierFor(tiers, qty) {
  const q = Number(qty) || 0
  let match = null
  for (const t of normalizeTiers(tiers)) {
    if (q >= t.minQty) match = t
    else break
  }
  return match
}

// Precio unitario efectivo para una cantidad: el de la escala alcanzada o el
// precio base del producto.
export function tierPriceFor(basePrice, tiers, qty) {
  const t = tierFor(tiers, qty)
  return t ? t.price : round2(Number(basePrice) || 0)
}

// Texto corto para mostrar las escalas: ">=20: 100 · >=50: 60".
export function tiersLabel(tiers) {
  return normalizeTiers(tiers)
    .map((t) => `≥${t.minQty}: ${t.price}`)
    .join(' · ')
}

// Parseo del formato de plantilla "20:100; 50:60" (tolera , . y espacios).
// Devuelve { ok, tiers } — ok=false si el texto no vacio es invalido.
export function parseTiersText(text) {
  const s = String(text || '').trim()
  if (!s) return { ok: true, tiers: [] }
  const tiers = []
  for (const part of s.split(/[;|]/)) {
    const p = part.trim()
    if (!p) continue
    const m = p.match(/^(\d+(?:[.,]\d+)?)\s*[:=@-]\s*(\d+(?:[.,]\d+)?)$/)
    if (!m) return { ok: false, tiers: [] }
    tiers.push({ minQty: Number(m[1].replace(',', '.')), price: Number(m[2].replace(',', '.')) })
  }
  const norm = normalizeTiers(tiers)
  if (norm.length !== tiers.length) return { ok: false, tiers: [] }
  return { ok: true, tiers: norm }
}

// Igualdad de dos listas de escalas (tras normalizar).
export function tiersEqual(a, b) {
  const na = normalizeTiers(a)
  const nb = normalizeTiers(b)
  if (na.length !== nb.length) return false
  return na.every((t, i) => t.minQty === nb[i].minQty && t.price === nb[i].price)
}
