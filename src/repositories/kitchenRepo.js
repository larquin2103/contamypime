import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2, foreignToBase, baseToForeign, isForeignPriced } from '../lib/currency'
import { cleanQty } from '../lib/qty'
import { ratesRepo } from './ratesRepo'
import { MOVEMENT_TYPES, COCINA } from '../db/constants'

// ---------------------------------------------------------------------------
// Motor de cocina (modulo 'cocina'). El cocinero ELABORA una receta y la ENVIA a
// un area de venta en una sola accion. Todo ocurre en UNA transaccion atomica.
//
// Reusa el MISMO patron de movimientos que conversionsRepo (consumir insumos ->
// crear elaborado) y transfersRepo (cocina -> area), pero replicado DENTRO de su
// propia transaccion para garantizar atomicidad end-to-end. NO toca esos repos.
//
// Mejoras propias frente a la conversion clasica (decision del dueño, docs/COCINA):
//  - Valida cada insumo contra el LIBRO MAYOR (no la cache) como candado de
//    ultima instancia, igual que salesRepo.
//  - Convierte el costo de insumos en DIVISA a MN a la tasa vigente (la conversion
//    clasica no lo hace); sin tasa y con insumo en divisa, BLOQUEA ("Falta tasa").
//
// Los movimientos usan los tipos existentes (CONVERSION_*/TRANSFER_*), que el
// submayor/kardex ya clasifica (consumo/producido/traspasos): cero cambios en los
// reportes base.
// ---------------------------------------------------------------------------

// Existencia de un producto en la cocina, DERIVADA del libro mayor (fuente de
// verdad). Se llama dentro de la transaccion (candado).
async function cocinaStock(productId) {
  const movs = await db.stockMovements
    .where('[productId+location]').equals([productId, COCINA]).toArray()
  return cleanQty(movs.reduce((a, m) => a + Number(m.qty || 0), 0))
}

export const kitchenRepo = {
  // Cuantas unidades del elaborado se pueden hacer con el stock ACTUAL en la
  // cocina (solo lectura, para el tablero). N = min sobre insumos de
  // floor(stockCocina(insumo) / consumoPorUnidad). Sin insumos, o con algun
  // insumo en 0/faltante -> 0. `productById` es el mapa id->producto (con cache).
  canMake(recipe, productById) {
    const items = recipe?.items || []
    if (!items.length) return 0
    let n = Infinity
    for (const it of items) {
      const per = Number(it.qty) || 0
      if (per <= 0) return 0
      const p = productById?.[it.productId]
      const have = Number(p?.stockByLocation?.[COCINA] || 0)
      n = Math.min(n, Math.floor(have / per))
      if (n <= 0) return 0
    }
    return Number.isFinite(n) ? n : 0
  },

  // Elabora `units` unidades de la receta y las envia al area `toArea`. Devuelve
  // { id, units, toArea, outputCostUnit }. Lanza (y aborta TODA la transaccion)
  // si falta algun insumo en la cocina o falta la tasa de un insumo en divisa.
  async produce({ recipeId, units, toArea, byUserId }) {
    const u = Math.abs(Number(units) || 0)
    const area = String(toArea || '').trim()
    if (!(u > 0)) throw new Error('Indica cuántas unidades elaborar (mayor que 0)')
    if (!area) throw new Error('Elige el área de destino')

    // Lectura fuera de la transaccion (como ordersRepo lee la tasa antes de abrir
    // la suya): receta y tasas vigentes. Lo que se MUTA (stock, producciones) va
    // dentro de la transaccion, que es donde esta el candado contra el ledger.
    const recipe = await db.recipes.get(recipeId)
    if (!recipe) throw new Error('La receta no existe')
    if (!recipe.active) throw new Error('La receta está dada de baja')
    const items = (recipe.items || []).filter((it) => it.productId && Number(it.qty) > 0)
    if (!items.length) throw new Error('La receta no tiene insumos')
    if (items.some((it) => it.productId === recipe.outputProductId)) {
      throw new Error('La receta no puede incluir su propio elaborado como insumo')
    }
    const rates = await ratesRepo.currentRates()
    const rateOf = (cur) => Number(rates?.[cur]?.rate || 0)

    const id = newId()
    const ts = now()
    let result = null

    await db.transaction('rw', db.productions, db.stockMovements, db.products, async () => {
      // Producto elaborado (destino). Debe existir y estar activo.
      const out = await db.products.get(recipe.outputProductId)
      if (!out) throw new Error('El producto elaborado no existe')
      if (!out.active) throw new Error('El producto elaborado está dado de baja; reactívalo en el catálogo')
      // Si el elaborado fija su precio en DIVISA, su costo se guarda en ESA moneda
      // (invariante de la app: precio y costo de un producto van en su priceCurrency;
      // los reportes convierten el costo a MN por esa moneda). Necesitamos su tasa.
      const outForeign = isForeignPriced(out)
      let rateOut = 1
      if (outForeign) {
        rateOut = rateOf(out.priceCurrency)
        if (!(rateOut > 0)) {
          throw new Error(`Define la tasa de ${out.priceCurrency} antes de elaborar "${out.name}" (su precio está en esa moneda).`)
        }
      }

      // 1) Valida cada insumo contra el LIBRO MAYOR (candado) y acumula el valor
      //    consumido en MN (convirtiendo divisa a la tasa vigente).
      const ingredients = []
      let movedValueMN = 0
      for (const it of items) {
        const need = round2(Number(it.qty) * u)
        const p = await db.products.get(it.productId)
        if (!p) throw new Error('Un insumo de la receta ya no existe en el catálogo')
        if (!p.active) throw new Error(`El insumo "${p.name}" está dado de baja en el catálogo`)
        const have = await cocinaStock(it.productId)
        if (have < need) {
          throw new Error(`No hay suficiente "${p.name}" en la cocina (hay ${cleanQty(have)} ${p.unit}, se necesitan ${cleanQty(need)})`)
        }
        // Costo del insumo en MN (modulo 'divisas': a la tasa vigente; sin tasa, bloquea).
        let unitCostMN = Number(p.cost) || 0
        if (isForeignPriced(p)) {
          const rate = rateOf(p.priceCurrency)
          if (!(rate > 0)) {
            throw new Error(`Define la tasa de ${p.priceCurrency} antes de elaborar (el insumo "${p.name}" está en esa moneda).`)
          }
          unitCostMN = foreignToBase(Number(p.cost) || 0, rate)
        }
        movedValueMN = round2(movedValueMN + need * unitCostMN)
        ingredients.push({ product: p, productId: p.id, name: p.name, unit: p.unit, qty: need, unitCostMN })
      }

      // 2) Costo del elaborado. En MN (para movimientos y el reporte de cocina) y
      //    en SU moneda (para product.cost), con promedio ponderado sobre su
      //    existencia previa. movedValueOwn = valor consumido en la moneda del
      //    elaborado (MN, o convertido a su divisa a la tasa vigente).
      const outputCostUnitMN = round2(movedValueMN / u)
      const movedValueOwn = outForeign ? baseToForeign(movedValueMN, rateOut) : movedValueMN
      const prevQty = Number(out.stock || 0)
      const prevCost = Number(out.cost || 0) // en la moneda del elaborado
      const newQty = round2(prevQty + u)
      const newCost = newQty > 0 ? round2((prevQty * prevCost + movedValueOwn) / newQty) : prevCost

      // 3) Consume cada insumo: CONVERSION_OUT (-) en la cocina + su cache.
      for (const ing of ingredients) {
        await db.stockMovements.add({
          id: newId(), productId: ing.productId, qty: -ing.qty,
          type: MOVEMENT_TYPES.CONVERSION_OUT, refType: 'production', refId: id,
          unitCost: ing.unitCostMN, shiftId: null, userId: byUserId, note: '',
          location: COCINA, createdAt: ts
        })
        const p = ing.product
        const byLoc = { ...(p.stockByLocation || {}) }
        byLoc[COCINA] = cleanQty(Number(byLoc[COCINA] || 0) - ing.qty)
        await db.products.update(p.id, {
          stock: cleanQty(Number(p.stock || 0) - ing.qty),
          stockByLocation: byLoc,
          updatedAt: ts
        })
      }

      // 4) Crea el elaborado en la cocina: CONVERSION_IN (+u), y ENSEGUIDA lo envia
      //    al area: TRANSFER_OUT (cocina) + TRANSFER_IN (area). Neto en la cocina =
      //    0 (se crea y sale); el total sube +u y termina en el area.
      await db.stockMovements.add({
        id: newId(), productId: out.id, qty: u,
        type: MOVEMENT_TYPES.CONVERSION_IN, refType: 'production', refId: id,
        unitCost: outputCostUnitMN, shiftId: null, userId: byUserId, note: '',
        location: COCINA, createdAt: ts
      })
      await db.stockMovements.add({
        id: newId(), productId: out.id, qty: -u,
        type: MOVEMENT_TYPES.TRANSFER_OUT, refType: 'production', refId: id,
        unitCost: outputCostUnitMN, shiftId: null, userId: byUserId, note: '',
        location: COCINA, createdAt: ts
      })
      await db.stockMovements.add({
        id: newId(), productId: out.id, qty: u,
        type: MOVEMENT_TYPES.TRANSFER_IN, refType: 'production', refId: id,
        unitCost: outputCostUnitMN, shiftId: null, userId: byUserId, note: '',
        location: area, createdAt: ts
      })
      // Cache del elaborado: cocina queda igual (neto 0), el area gana +u; costo por
      // promedio ponderado. El total = prevQty + u (la creacion suma; el traspaso no).
      const outByLoc = { ...(out.stockByLocation || {}) }
      outByLoc[area] = cleanQty(Number(outByLoc[area] || 0) + u)
      await db.products.update(out.id, {
        stock: newQty,
        stockByLocation: outByLoc,
        cost: newCost,
        updatedAt: ts
      })

      // 5) Snapshot append-only de la produccion (para el reporte de cocina, B4).
      await db.productions.add({
        id,
        recipeId,
        recipeName: recipe.name || out.name,
        outputProductId: out.id,
        units: u,
        toArea: area,
        ingredients: ingredients.map((g) => ({ productId: g.productId, name: g.name, unit: g.unit, qty: g.qty, unitCostMN: g.unitCostMN })),
        outputCostUnit: outputCostUnitMN,
        byUserId,
        createdAt: ts
      })

      result = { id, units: u, toArea: area, outputCostUnit: outputCostUnitMN }
    })

    return result
  },

  async listAll() {
    const rows = await db.productions.toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  // Producciones recientes (para el tablero del cocinero). SIN costos (alcance del
  // rol): fecha, receta, unidades y area. Las mas recientes primero.
  async recent(limit = 8) {
    const rows = await this.listAll()
    return rows.slice(0, limit)
  }
}
