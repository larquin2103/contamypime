import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { productsRepo } from './productsRepo'
import { imagesRepo } from './imagesRepo'
import { RECIPE_KINDS, recipeKind } from '../db/constants'

// Recetas del modulo 'cocina'. Una receta define sus INSUMOS (y el consumo por
// UNIDAD del elaborado) y crea/actualiza su propio PRODUCTO elaborado (el que se
// vende). El stock del elaborado NO se maneja aqui: entra al PRODUCIR (Bloque 3),
// que mueve el libro mayor con CONVERSION_*/TRANSFER_* ya existentes.
//
// Reglas del proyecto:
//  - Reusa productsRepo (NO reimplementa el alta de productos) e imagesRepo.
//  - Append-only: la baja de una receta es LOGICA (active:false); su producto y
//    todo su historial (ventas, precios) se conservan intactos.
//  - Toda mutacion actualiza updatedAt (de esto depende la sincronizacion).
//
// Forma de un registro `recipes`:
//   { id, name, unit, outputProductId, items:[{ productId, qty }], normas,
//     active, createdAt, updatedAt }
//   items[].qty = consumo del insumo por 1 unidad del elaborado.

// Normaliza los insumos: cantidades positivas y sin filas vacias/duplicadas.
function cleanItems(items) {
  const seen = new Set()
  const out = []
  for (const it of items || []) {
    const productId = String(it?.productId || '')
    const qty = Math.abs(Number(it?.qty) || 0)
    if (!productId || qty <= 0 || seen.has(productId)) continue
    seen.add(productId)
    out.push({ productId, qty })
  }
  return out
}

export const recipesRepo = {
  // `kind` (opcional): 'cocina' o 'cocteleria'. SIN el filtro devuelven TODAS, que
  // es exactamente lo que hacian antes (los llamadores de hoy no cambian). Filtrar
  // es decision de cada pantalla, explicita, para que no haya un default silencioso
  // que altere una lista existente.
  async list({ kind = null } = {}) {
    const all = await db.recipes.toArray()
    const live = all.filter((r) => !r.deletedAt) // las eliminadas (borrado logico) no se listan
    return kind ? live.filter((r) => recipeKind(r) === kind) : live
  },

  async listActive({ kind = null } = {}) {
    const all = await db.recipes.toArray()
    const live = all.filter((r) => r.active && !r.deletedAt)
    return kind ? live.filter((r) => recipeKind(r) === kind) : live
  },

  async get(id) {
    return db.recipes.get(id)
  },

  // La receta cuyo elaborado es este producto (o undefined). Util para saber si
  // un producto del catalogo es un elaborado de cocina.
  async getByOutput(productId) {
    return db.recipes.where('outputProductId').equals(productId).first()
  },

  // Crea la receta y AUTO-DA DE ALTA su producto elaborado (costo 0; el costo real
  // se deriva al producir, por promedio ponderado). Producto + receta se crean en
  // UNA transaccion: si algo falla, no queda un elaborado huerfano. La foto (si el
  // modulo 'imagenes' esta activo) la pasa el llamador ya comprimida y se guarda
  // aparte, como en ProductForm. `priceCurrency` solo se pasa cuando el llamador
  // eligio una divisa (modulo 'divisas'); sin el, el producto es MN = clasico.
  // `kind` (opcional, modulo 'cocteleria'): solo se ESCRIBE cuando vale 'cocteleria'.
  // Una receta de cocina nueva se guarda sin el campo, byte a byte como siempre.
  async create({ name, unit, price, area = '', categoryId = null, priceCurrency = null, items = [], normas = '', photo = '', userId = null, kind = RECIPE_KINDS.KITCHEN }) {
    const cleaned = cleanItems(items)
    const isCocktail = kind === RECIPE_KINDS.COCKTAIL
    const id = newId()
    const ts = now()
    let outputProductId
    await db.transaction('rw', db.products, db.recipes, async () => {
      // Reusa el alta de catalogo (sin existencia inicial: el stock entra al producir).
      outputProductId = await productsRepo.create({
        name,
        unit,
        price,
        cost: 0,
        area,
        categoryId,
        priceCurrency: priceCurrency || null,
        userId
      })
      await db.recipes.add({
        id,
        name: String(name || '').trim(),
        unit,
        outputProductId,
        items: cleaned,
        normas: String(normas || '').trim(),
        active: true,
        ...(isCocktail ? { kind: RECIPE_KINDS.COCKTAIL } : {}),
        createdAt: ts,
        updatedAt: ts
      })
    })
    if (photo) await imagesRepo.set('product', outputProductId, photo)
    return { id, outputProductId }
  },

  // Edita la receta. Nombre/unidad/area/categoria/moneda -> al producto elaborado;
  // precio -> changePrice (queda en el historial, las ventas pasadas no se tocan);
  // insumos/normas -> a la receta (que ademas espeja nombre/unidad para el tablero).
  // La foto la maneja el llamador (imagesRepo), como ProductForm. Sin transaccion
  // unica, igual que la edicion de un producto (cada paso es independiente).
  // El `kind` NO se edita a proposito (no esta en el patch): cambiarlo movería la
  // ubicacion de la que consume la receta y dejaria su historial de producciones
  // sin sentido. Si hace falta, se da de baja y se crea otra (append-only).
  async update(id, { name, unit, price, area, categoryId, priceCurrency, items, normas } = {}, { userId = null } = {}) {
    const r = await db.recipes.get(id)
    if (!r) throw new Error('La receta no existe')

    // Datos que se ven/venden viven en el producto elaborado.
    const prodPatch = {}
    if (name != null) prodPatch.name = name
    if (unit != null) prodPatch.unit = unit
    if (area != null) prodPatch.area = area
    if (categoryId !== undefined) prodPatch.categoryId = categoryId
    if (priceCurrency != null) prodPatch.priceCurrency = priceCurrency
    if (Object.keys(prodPatch).length) await productsRepo.update(r.outputProductId, prodPatch)
    if (price != null) await productsRepo.changePrice(r.outputProductId, price, { userId })

    // La receta guarda insumos, normas y un espejo de nombre/unidad (para el tablero).
    const patch = { updatedAt: now() }
    if (name != null) patch.name = String(name).trim()
    if (unit != null) patch.unit = unit
    if (items != null) patch.items = cleanItems(items)
    if (normas != null) patch.normas = String(normas).trim()
    await db.recipes.update(id, patch)
  },

  // Baja/alta LOGICA de la receta (append-only): deja de ofrecerse en el tablero (o
  // vuelve). El ELABORADO sigue el estado de su receta: darla de baja lo retira del
  // catalogo; reactivarla lo RESTABLECE (aunque se hubiera eliminado del catalogo,
  // reactivar limpia su baja). NO toca stock ni ventas: todo se conserva.
  async setActive(id, active) {
    const on = !!active
    const ts = now()
    await db.transaction('rw', db.recipes, db.products, async () => {
      const r = await db.recipes.get(id)
      if (!r) throw new Error('La receta no existe')
      await db.recipes.update(id, { active: on, updatedAt: ts })
      if (r.outputProductId) {
        const patch = on
          ? { active: true, deletedAt: null, deletedBy: null, updatedAt: ts }
          : { active: false, updatedAt: ts }
        await db.products.update(r.outputProductId, patch)
      }
    })
  },

  // Eliminar la receta (solo dueño) cuando ya no se va a elaborar mas. Es un borrado
  // LOGICO (append-only, como productsRepo.remove): la receta se marca deletedAt y
  // desaparece de la lista, pero NADA se borra — el registro y su historial
  // (producciones, ventas del elaborado) se conservan. Su ELABORADO se retira del
  // catalogo con el mismo borrado logico (deja constancia en auditoria -> "Bajas").
  async remove(id, { userId = null, note = '' } = {}) {
    const r = await db.recipes.get(id)
    if (!r) throw new Error('La receta no existe')
    const ts = now()
    await db.recipes.update(id, { active: false, deletedAt: ts, deletedBy: userId, updatedAt: ts })
    if (r.outputProductId) {
      await productsRepo.remove(r.outputProductId, { userId, note: note || 'Receta eliminada' })
    }
  }
}
