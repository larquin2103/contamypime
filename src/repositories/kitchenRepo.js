import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2, foreignToBase, baseToForeign, isForeignPriced } from '../lib/currency'
import { cleanQty } from '../lib/qty'
import { ratesRepo } from './ratesRepo'
import { canMake, productionMovements } from '../lib/kitchenMath'
import { COCINA, RECIPE_KINDS, recipeKind, locationLabel } from '../db/constants'

// ---------------------------------------------------------------------------
// Motor de elaboracion (modulos 'cocina' y 'cocteleria'). Se ELABORA una receta y,
// si hace falta, se ENVIA a un area de venta en una sola accion. Todo ocurre en UNA
// transaccion atomica. Dos flujos, el mismo motor:
//  - COCINA (clasico): el cocinero elabora en `__cocina` y lo envia a un area.
//  - COCTELERIA: el vendedor/mando elabora DENTRO del area, consumiendo el stock de
//    esa area, y el trago queda ahi mismo (sin traspasos). La ubicacion de origen
//    entra por `fromLocation`; el default es la cocina, o sea el comportamiento de
//    siempre. QUE movimientos se escriben lo decide `lib/kitchenMath`, que es puro
//    y esta probado con node.
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

// Existencia de un producto en UNA ubicacion, DERIVADA del libro mayor (fuente de
// verdad). Se llama dentro de la transaccion (candado). `location` es la cocina en
// el flujo clasico, o el AREA cuando la que elabora es la barra (cocteleria).
async function stockAtLoc(productId, location) {
  const movs = await db.stockMovements
    .where('[productId+location]').equals([productId, location]).toArray()
  return cleanQty(movs.reduce((a, m) => a + Number(m.qty || 0), 0))
}

export const kitchenRepo = {
  // Cuantas unidades del elaborado se pueden hacer con el stock ACTUAL de una
  // ubicacion (solo lectura, para el tablero). La matematica vive en lib/kitchenMath
  // (pura y probada con node); aqui solo se re-expone para no cambiar a los
  // llamadores. `location` por defecto la COCINA = comportamiento clasico.
  canMake(recipe, productById, location = COCINA) {
    return canMake(recipe, productById, location)
  },

  // Elabora `units` unidades de la receta y las envia al area `toArea`. Devuelve
  // { id, units, toArea, fromLocation, outputCostUnit }. Lanza (y aborta TODA la
  // transaccion) si falta algun insumo en la ubicacion de origen o falta la tasa de
  // un insumo en divisa.
  //
  // `fromLocation` (opcional): ubicacion de la que se CONSUMEN los insumos. Por
  // defecto la COCINA = comportamiento clasico e invariante historico. La
  // cocteleria pasa el AREA, y entonces origen y destino coinciden: el trago queda
  // en la misma area y NO se emite ningun traspaso (ver lib/kitchenMath).
  //
  // `allowShort` (opcional, permiso `allowShortProduction` del dueño): convierte el
  // candado de existencia en un AVISO. Sin el -el default- se comporta EXACTAMENTE
  // como siempre: falta un insumo, no se elabora. Con el, el descubierto se anota en
  // `shortages` (y en el snapshot de la produccion) y la existencia de esa ubicacion
  // queda en NEGATIVO hasta que una entrada o un traspaso la neteen. Es para cuando
  // la mercancia esta fisicamente pero falta registrar su entrada. Lo decide el
  // llamador (la pantalla lee el ajuste), como con `sellerEntries`: el default es el
  // lado seguro y el motor sigue siendo determinista.
  // NO relaja ningun otro candado: producto inexistente o dado de baja, y falta de
  // tasa de una divisa, siguen lanzando (son faltas de DATO, no de mercancia).
  async produce({ recipeId, units, toArea, byUserId, fromLocation = COCINA, allowShort = false }) {
    const u = Math.abs(Number(units) || 0)
    const area = String(toArea || '').trim()
    const from = String(fromLocation || '').trim() || COCINA
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
    // Candado de coherencia entre TIPO de receta y ubicacion, con la misma doctrina
    // de "candado de ultima instancia" del resto del proyecto: aunque el llamador se
    // equivoque, el motor no elabora un trago consumiendo del almacen de la cocina
    // (ni un plato consumiendo de un area). La receta manda.
    const kind = recipeKind(recipe)
    if (kind === RECIPE_KINDS.COCKTAIL) {
      if (from === COCINA) {
        throw new Error('Una receta de coctelería se elabora en un área de venta, no en la cocina')
      }
      if (from !== area) {
        throw new Error('Una receta de coctelería se elabora y queda en la MISMA área')
      }
    } else if (from !== COCINA) {
      throw new Error('Una receta de cocina se elabora en la cocina')
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
      const shortages = [] // insumos elaborados EN DESCUBIERTO (solo con allowShort)
      let movedValueMN = 0
      for (const it of items) {
        const need = round2(Number(it.qty) * u)
        const p = await db.products.get(it.productId)
        if (!p) throw new Error('Un insumo de la receta ya no existe en el catálogo')
        if (!p.active) throw new Error(`El insumo "${p.name}" está dado de baja en el catálogo`)
        const have = await stockAtLoc(it.productId, from)
        if (have < need) {
          // Sin el permiso, el candado de siempre: no se elabora lo que no hay.
          if (!allowShort) {
            throw new Error(`No hay suficiente "${p.name}" en ${locationLabel(from)} (hay ${cleanQty(have)} ${p.unit}, se necesitan ${cleanQty(need)})`)
          }
          // Con el permiso, se ANOTA el descubierto y se sigue: el consumo se
          // registra COMPLETO (el movimiento no se recorta), asi que la existencia
          // de esa ubicacion queda en negativo y una entrada posterior lo netea.
          // `have` ya puede venir negativo de un descubierto anterior: entonces el
          // faltante es mayor que lo que pide la receta, y eso es lo correcto.
          shortages.push({
            productId: p.id, name: p.name, unit: p.unit,
            need: cleanQty(need), have: cleanQty(have), short: cleanQty(need - have)
          })
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

      // 3) Movimientos del libro mayor. QUE movimientos son lo decide lib/kitchenMath
      //    (puro y probado con node): insumos consumidos en la ubicacion de origen,
      //    el elaborado creado ahi, y SOLO si origen != destino los dos traspasos.
      //    Con el default (cocina -> area) sale exactamente la misma secuencia de
      //    siempre: CONVERSION_OUT por insumo, CONVERSION_IN, TRANSFER_OUT, TRANSFER_IN.
      const costOfMov = (m) =>
        (m.productId === out.id ? outputCostUnitMN : (ingredients.find((g) => g.productId === m.productId)?.unitCostMN ?? 0))
      for (const mov of productionMovements({ from, to: area, units: u, ingredients, outputProductId: out.id })) {
        await db.stockMovements.add({
          id: newId(), productId: mov.productId, qty: mov.qty,
          type: mov.type, refType: 'production', refId: id,
          unitCost: costOfMov(mov), shiftId: null, userId: byUserId, note: '',
          location: mov.location, createdAt: ts
        })
      }

      // 4) Cache de los insumos: bajan en la ubicacion de origen.
      for (const ing of ingredients) {
        const p = ing.product
        const byLoc = { ...(p.stockByLocation || {}) }
        byLoc[from] = cleanQty(Number(byLoc[from] || 0) - ing.qty)
        await db.products.update(p.id, {
          stock: cleanQty(Number(p.stock || 0) - ing.qty),
          stockByLocation: byLoc,
          updatedAt: ts
        })
      }

      // Cache del elaborado: el DESTINO gana +u y el total sube +u. Vale para los dos
      // casos: con traspaso, el origen queda en neto 0 (se crea y sale); sin traspaso,
      // origen y destino son la misma ubicacion y es el mismo +u. Costo por promedio
      // ponderado.
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
        // Tipo y origen: se escriben SOLO cuando no son los clasicos (cocina desde
        // `__cocina`), igual que `recipes.kind`. Asi una produccion de cocina se
        // guarda byte a byte como siempre, y quien lea puede asumir los defaults.
        ...(kind === RECIPE_KINDS.COCKTAIL ? { kind: RECIPE_KINDS.COCKTAIL } : {}),
        ...(from !== COCINA ? { fromLocation: from } : {}),
        // Descubierto con el que se elaboro. Solo se escribe si lo hubo, asi que una
        // produccion normal se guarda byte a byte como siempre. De aqui sale el aviso
        // al dueño (es un EVENTO con fecha, no un estado que haya que barrer).
        ...(shortages.length ? { shortages } : {}),
        byUserId,
        createdAt: ts
      })

      result = { id, units: u, toArea: area, fromLocation: from, outputCostUnit: outputCostUnitMN, shortages }
    })

    return result
  },

  async listAll() {
    const rows = await db.productions.toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  // Producciones recientes (para el tablero). SIN costos (alcance del rol): fecha,
  // receta, unidades y area. Las mas recientes primero.
  //
  // `kind` (opcional): filtra por tipo, para que el tablero de cocina no liste
  // elaboraciones de cocteleria ni al contrario. Sin el filtro devuelve todas, igual
  // que antes. `recipeKind` sirve tambien aqui: es un lector TOLERANTE del campo
  // `kind` (ausente = cocina), y `productions` usa el mismo vocabulario que `recipes`.
  async recent(limit = 8, { kind = null } = {}) {
    const rows = await this.listAll()
    const list = kind ? rows.filter((p) => recipeKind(p) === kind) : rows
    return list.slice(0, limit)
  }
}
