// ---------------------------------------------------------------------------
// Diagnostico de convergencia del catalogo (La Patrona, respaldo B, 23-09-2026).
// PURO, solo lee. Lo usa docs/auditoria/diagnostico-atomicidad.mjs; ninguna
// pantalla lo importa.
//
// Busca versiones de la FICHA de un producto que ESTE aparato no recibio. Se
// apoya en dos invariantes verificadas en el codigo:
//  - Los doce escritores del libro mayor (salesRepo, stockRepo, purchasesRepo,
//    transfersRepo, mermasRepo, debtsRepo, conversionsRepo, kitchenRepo,
//    ordersRepo, partnersRepo, remittancesRepo) sellan el producto con el MISMO
//    `ts` que el movimiento, en la misma transaccion. El traspaso de turno trae
//    fichas y movimientos juntos. recomputeStock (bajada) no sella: es derivado.
//  - changePrice sella la ficha con un now() POSTERIOR al createdAt del cambio.
// Por tanto, en el aparato que escribio, ficha.updatedAt >= esas fechas. Si aqui
// es menor, la version que las acompanaba no llego a este aparato: el stock sale
// bien (se deriva del libro), pero precio, nombre y baja pueden estar viejos.
//
// Leerlo bien: 'ficha-atrasada' NO implica dano visible. Validado con los dos
// aparatos de "De todo un tin" (12-09): 21 de 21 confirmadas por el otro
// aparato, y en las 21 precio, nombre y baja coinciden (la version perdida solo
// llevaba la cache del stock). El dano visible lo marca 'precio-no-recibido'.
// ---------------------------------------------------------------------------
const arr = (x) => (Array.isArray(x) ? x : [])

function latestBy(rows, key) {
  const m = new Map()
  for (const r of rows) {
    const k = r[key]
    const cur = m.get(k)
    if (!cur || String(r.createdAt || '') > String(cur.createdAt || '')) m.set(k, r)
  }
  return m
}

export function findStaleCatalog(tables = {}) {
  const lastMov = latestBy(arr(tables.stockMovements), 'productId')
  const lastPrice = latestBy(arr(tables.priceChanges), 'productId')
  const out = []
  for (const p of arr(tables.products)) {
    const up = String(p.updatedAt || '')
    const pc = lastPrice.get(p.id)
    if (pc && String(pc.createdAt || '') > up && Number(p.price) !== Number(pc.newPrice)) {
      out.push({
        kind: 'precio-no-recibido',
        id: p.id,
        at: pc.createdAt,
        detail: `${p.name}: ficha ${p.price} (marca ${up || '-'}) / ultimo cambio ${pc.newPrice}`
      })
    }
    const m = lastMov.get(p.id)
    if (m && String(m.createdAt || '') > up) {
      out.push({
        kind: 'ficha-atrasada',
        id: p.id,
        at: m.createdAt,
        detail: `${p.name}: ficha ${up || '-'} / ultimo movimiento ${m.type}`
      })
    }
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}
