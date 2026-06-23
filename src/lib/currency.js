// Conversion de moneda. La "tasa" se define como:
//   cuanta MONEDA BASE vale 1 unidad de la moneda extranjera.
//   Ej: 1 USD = 320 MN  ->  rate = 320
// Asi el dueño la edita como la piensa ("el dolar esta a 320").

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}

// moneda extranjera -> base
export function foreignToBase(amount, rate) {
  return round2(Number(amount) * Number(rate || 0))
}

// base -> moneda extranjera
export function baseToForeign(amount, rate) {
  const r = Number(rate || 0)
  if (!r) return 0
  return round2(Number(amount) / r)
}

// Formato de dinero para mostrar.
export function formatMoney(amount, currency = 'MN') {
  const n = round2(amount || 0)
  return `${n.toLocaleString('es-CU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
}
