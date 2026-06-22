// Extrae monto y referencia del texto de un SMS de confirmacion de transferencia.
// Los formatos varian por banco; esto es una ayuda: el vendedor puede corregir
// los campos antes de confirmar.

function normNum(s) {
  s = String(s)
  if (s.includes('.') && s.includes(',')) {
    // 1.234,56  -> punto = miles, coma = decimal
    s = s.replace(/\./g, '').replace(',', '.')
  } else if ((s.match(/,/g) || []).length === 1 && !s.includes('.')) {
    s = s.replace(',', '.')
  } else {
    s = s.replace(/,/g, '')
  }
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

export function parseSms(text) {
  const t = String(text || '')

  // Referencia / numero de operacion: la secuencia de digitos mas larga (>=5).
  const runs = t.match(/\d{5,}/g) || []
  const reference = runs.slice().sort((a, b) => b.length - a.length)[0] || ''

  // Monto: cerca de una palabra clave o moneda; si no, primer numero con decimales.
  let amount = null
  const m = t.match(
    /(?:cup|mlc|\$|por|monto|importe|transferencia de)[:\s]*\$?\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i
  )
  if (m) amount = normNum(m[1])
  if (amount == null) {
    const d = t.match(/\d+[.,]\d{2}\b/)
    if (d) amount = normNum(d[0])
  }

  return { amount, reference }
}
