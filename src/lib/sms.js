// Extrae monto y numero de transaccion del texto de un SMS de confirmacion de
// transferencia (Transfermovil / EnZona / banca movil cubana). Los formatos
// varian por banco; esto es una AYUDA: el vendedor puede corregir los campos
// antes de confirmar, y la pantalla compara el importe con lo que debe cobrar.

// Normaliza un numero escrito con cualquier convencion de miles/decimales.
// Regla robusta: el separador decimal es el ULTIMO '.' o ',' que aparezca y que
// deje 1-2 cifras detras; los demas separadores son de miles y se quitan.
function normNum(s) {
  s = String(s).trim()
  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  let decSep = null
  if (lastDot >= 0 && lastComma >= 0) {
    decSep = lastDot > lastComma ? '.' : ','
  } else if (lastComma >= 0) {
    const parts = s.split(',')
    decSep = parts.length === 2 && parts[1].length <= 2 ? ',' : null
  } else if (lastDot >= 0) {
    const parts = s.split('.')
    decSep = parts.length === 2 && parts[1].length <= 2 ? '.' : null
  }
  let out
  if (decSep) {
    const other = decSep === '.' ? ',' : '.'
    out = s.split(other).join('').replace(decSep, '.')
  } else {
    out = s.replace(/[.,]/g, '')
  }
  const n = parseFloat(out)
  return isNaN(n) ? null : n
}

// Numero de una cantidad de dinero dentro del texto. La 1ª alternativa exige
// grupos de miles reales (evita partir "2200.00" en "220"); la 2ª es un numero
// llano con decimales opcionales.
const MONEY = '(\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)'

export function parseSms(text) {
  const t = String(text || '')

  // --- Numero de transaccion / operacion ---
  // 1) Si aparece una palabra clave ("No. de transaccion/operacion/nro"),
  //    tomamos el numero que la sigue. 2) Si no, la secuencia de digitos mas
  //    larga (>=5) que NO sea parte de un monto.
  let reference = ''
  const refKey = t.match(
    /(?:n(?:o|ro|úmero)?\.?\s*(?:de\s*)?(?:transacción|transaccion|operación|operacion|confirmación|confirmacion|referencia)|transacción|transaccion|operación|operacion)\D{0,12}(\d{4,})/i
  )
  if (refKey) {
    reference = refKey[1]
  } else {
    const runs = t.match(/\d{5,}/g) || []
    reference = runs.slice().sort((a, b) => b.length - a.length)[0] || ''
  }

  // --- Importe ---
  // Cerca de una palabra clave o moneda; si no, el primer numero con decimales.
  let amount = null
  const m = t.match(
    new RegExp(`(?:cup|mlc|usd|\\$|por|monto|importe|transferencia de|recib\\w*|pago de)[:\\s]*\\$?\\s*${MONEY}`, 'i')
  )
  if (m) amount = normNum(m[1])
  if (amount == null) {
    const d = t.match(/\d+[.,]\d{2}\b/)
    if (d) amount = normNum(d[0])
  }

  return { amount, reference }
}
