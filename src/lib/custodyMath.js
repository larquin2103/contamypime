// Matematica PURA del libro de custodia (modulo 'remesas'). Sin Dexie ni imports:
// opera sobre listas planas de movimientos -> testeable con `node` sin framework
// (ver custodyMath.test.mjs), igual que features/sync/retryQueue. `custodyRepo` la
// usa para derivar los saldos; la base de datos y la sincronizacion viven alla.
//
// Un movimiento: { holder, direction: 'credit' | 'debit', amount, currency }.
// El saldo de un tenedor+moneda = suma de creditos - suma de debitos. NUNCA se
// guarda: se deriva de los movimientos (como el stock sale del libro mayor y el
// saldo de una cuenta de sus movimientos).

// Misma formula que lib/currency.round2 (se replica para que el modulo sea puro
// y autoexplicativo, sin cadena de imports que impida correrlo en node).
export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}

// Saldos de TODOS los tenedores: { holder: { currency: monto } }.
export function deriveBalances(movements) {
  const map = {}
  for (const m of movements || []) {
    const sign = m.direction === 'debit' ? -1 : 1
    const h = m.holder
    const c = m.currency || 'MN'
    if (!map[h]) map[h] = {}
    map[h][c] = round2((map[h][c] || 0) + sign * Number(m.amount || 0))
  }
  return map
}

// Saldo de UN tenedor: { currency: monto }.
export function deriveHolderBalance(movements, holder) {
  const bal = {}
  for (const m of movements || []) {
    if (m.holder !== holder) continue
    const sign = m.direction === 'debit' ? -1 : 1
    const c = m.currency || 'MN'
    bal[c] = round2((bal[c] || 0) + sign * Number(m.amount || 0))
  }
  return bal
}
