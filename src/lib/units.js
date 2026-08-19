// Conversion de CANTIDAD entre unidades de la MISMA familia fisica (peso o volumen).
// Es una AYUDA de captura: al fraccionar/reenvasar el mismo producto en otra unidad,
// sugiere la cantidad resultante (p.ej. 1 L -> 1000 ml, 1 kg -> 1000 g). NO convierte
// entre familias (kg->ml, u->g, caja->algo) porque no hay factor fisico fijo: depende
// de la densidad del producto o del empaque. En ese caso devuelve null y la cantidad
// se teclea a mano. 'u' y 'caja' son CONTEO: no pertenecen a ninguna familia -> nunca
// tienen factor. No toca dinero ni el stock; solo sugiere un numero editable.
import { cleanQty } from './qty'

// Factor de cada unidad a la BASE de su familia (peso = gramo, volumen = mililitro).
// Las libras/onzas dan gramos no enteros (1 lb = 453.592 g, 1 oz = 28.3495 g, con
// 1 lb = 16 oz); la sugerencia se redondea a la milesima como toda cantidad (cleanQty).
const UNIT_TO_BASE = {
  // Peso (base: gramo)
  g: { family: 'weight', factor: 1 },
  kg: { family: 'weight', factor: 1000 },
  lb: { family: 'weight', factor: 453.592 },
  oz: { family: 'weight', factor: 28.3495 },
  // Volumen (base: mililitro)
  ml: { family: 'volume', factor: 1 },
  l: { family: 'volume', factor: 1000 }
}

// ¿Se puede convertir cantidad de `from` a `to`? (ambas conocidas y misma familia).
export function canConvertUnits(from, to) {
  const a = UNIT_TO_BASE[from]
  const b = UNIT_TO_BASE[to]
  return !!(a && b && a.family === b.family)
}

// Convierte `qty` de la unidad `from` a la unidad `to`. Devuelve null si no son
// compatibles (o alguna es desconocida/conteo): ahi la cantidad va a mano.
export function convertQty(qty, from, to) {
  if (!canConvertUnits(from, to)) return null
  const q = Number(qty)
  if (!Number.isFinite(q)) return null
  const a = UNIT_TO_BASE[from]
  const b = UNIT_TO_BASE[to]
  return cleanQty((q * a.factor) / b.factor)
}
