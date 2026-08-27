// Matematica PURA de la custodia de PRODUCTO del mensajero (modulo 'remesas', F6).
// Sin Dexie ni imports: opera sobre listas planas de movimientos -> testeable con
// `node` (ver productCustodyMath.test.mjs), igual que custodyMath para el efectivo.
// El saldo por tenedor+producto = suma de `qty` (positiva al CARGAR, negativa al
// ENTREGAR o DEVOLVER). NUNCA se guarda: se deriva de los movimientos, como el stock
// sale del libro mayor. Es un libro AISLADO del inventario general.
//
// Un movimiento: { holder, productId, qty } (qty con signo).

// Redondeo de cantidades (admite fracciones: pesos, litros). Evita -0.
export function cleanQty(n) {
  const v = Math.round((Number(n) + Number.EPSILON) * 1000) / 1000
  return Object.is(v, -0) ? 0 : v
}

// Saldos de TODOS los tenedores: { holder: { productId: qty } }. Omite los que
// quedaron en cero (ya entregados), para no mostrar carga fantasma.
export function deriveProductBalances(movements) {
  const map = {}
  for (const m of movements || []) {
    const h = m.holder
    const p = m.productId
    if (!h || !p) continue
    if (!map[h]) map[h] = {}
    map[h][p] = cleanQty((map[h][p] || 0) + Number(m.qty || 0))
  }
  for (const h of Object.keys(map)) {
    for (const p of Object.keys(map[h])) if (Math.abs(map[h][p]) < 0.0005) delete map[h][p]
    if (Object.keys(map[h]).length === 0) delete map[h]
  }
  return map
}

// Productos que carga UN tenedor: { productId: qty }. Omite ceros.
export function deriveHolderProducts(movements, holder) {
  const bal = {}
  for (const m of movements || []) {
    if (m.holder !== holder || !m.productId) continue
    bal[m.productId] = cleanQty((bal[m.productId] || 0) + Number(m.qty || 0))
  }
  for (const p of Object.keys(bal)) if (Math.abs(bal[p]) < 0.0005) delete bal[p]
  return bal
}
