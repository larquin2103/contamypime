import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { recipesRepo } from '../../repositories/recipesRepo'
import { productsRepo } from '../../repositories/productsRepo'
import { categoriesRepo } from '../../repositories/categoriesRepo'
import { configRepo } from '../../repositories/configRepo'
import { transfersRepo } from '../../repositories/transfersRepo'
import { imagesRepo } from '../../repositories/imagesRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { matchesQuery } from '../../lib/search'
import { round2, formatMoney } from '../../lib/currency'
import { cleanQty } from '../../lib/qty'
import { WAREHOUSE, COCINA, COCINA_LABEL, RECIPE_KINDS, recipeKind } from '../../db/constants'
import { RecipeForm } from './RecipeForm'

// Pantalla del mando (modulos 'cocina' y/o 'cocteleria'). Partes:
//  1) Recetas de COCINA: el DUEÑO define/edita recetas (cada una crea su producto
//     elaborado). Se elaboran en `__cocina` y se envian a un area.
//  2) Recetas de COCTELERIA (modulo 'cocteleria'): mismas recetas, pero se elaboran
//     DENTRO del area y el trago queda en ella. Lista APARTE para no confundir un
//     plato con un trago (peticion del dueño).
//  3) Abastecer cocina: el mando envia insumos del almacen central a la cocina
//     (__cocina), reusando el motor de traspaso existente (transfersRepo.move),
//     sin tocar esa logica. Solo con 'cocina': un bar sin cocina central no tiene
//     `__cocina` que abastecer (la cocteleria se abastece con la Salida a areas).
export function RecipesScreen() {
  const { user, isOwner, isManager } = useAuth()
  const { baseCurrency } = useCurrency()
  const { hasModule } = useLicense()
  const canKitchen = hasModule(LICENSE_MODULES.KITCHEN)
  const canCocktails = hasModule(LICENSE_MODULES.COCKTAILS)

  const recipes = useLiveQuery(() => recipesRepo.list(), [], [])
  const products = useLiveQuery(() => productsRepo.listActive(), [], [])
  const categories = useLiveQuery(() => categoriesRepo.list(), [], [])
  const areas = useLiveQuery(() => configRepo.getAreas(), [], [])
  const photos = useLiveQuery(() => imagesRepo.mapByType('product'), [], new Map())

  // Editor de receta: null = cerrado; 'new' = alta; objeto = edicion.
  const [editing, setEditing] = useState(null)

  // --- Estado del panel "Abastecer cocina" (patron de Salida a areas). ---
  const [selected, setSelected] = useState({}) // { [productId]: cantidadTexto }
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [doneMsg, setDoneMsg] = useState('')

  const productById = useMemo(() => {
    const m = {}
    for (const p of products) m[p.id] = p
    return m
  }, [products])

  const catName = useMemo(() => {
    const m = { __none: 'Sin categoría' }
    for (const c of categories) m[c.id] = c.name
    return m
  }, [categories])

  const warehouseOf = (p) => Number(p.stockByLocation?.[WAREHOUSE] || 0)
  const cocinaOf = (p) => Number(p.stockByLocation?.[COCINA] || 0)

  // IDs de los productos ELABORADOS (la salida de cada receta). NO son insumos: la
  // cocina los PRODUCE y los envia a las areas; nunca se abastecen desde el almacen.
  // Se excluyen del panel "Abastecer cocina" para no ofrecerlos como insumo. Incluye
  // las recetas dadas de baja: su elaborado sigue siendo un elaborado, no un insumo.
  const recipeOutputIds = useMemo(() => {
    const s = new Set()
    for (const r of recipes) if (r.outputProductId) s.add(r.outputProductId)
    return s
  }, [recipes])

  // Productos con existencia en el almacen (lo que no hay no se puede enviar), SIN
  // los elaborados de cocina (esos se producen en la cocina, no se abastecen).
  const groups = useMemo(() => {
    const eligible = products.filter((p) => warehouseOf(p) > 0 && !recipeOutputIds.has(p.id))
    const filtered = query.trim() ? eligible.filter((p) => matchesQuery(p, query)) : eligible
    filtered.sort((a, b) => a.name.localeCompare(b.name))
    const g = {}
    for (const p of filtered) {
      const key = p.categoryId || '__none'
      if (!g[key]) g[key] = []
      g[key].push(p)
    }
    return g
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, query, recipeOutputIds])

  // Compuerta de modulo: hace falta 'cocina' O 'cocteleria'. Sin ninguno de los dos,
  // la pantalla no ofrece nada (cada seccion se gatea aparte mas abajo).
  if (!canKitchen && !canCocktails) {
    return (
      <div className="screen">
        <h2>Recetas</h2>
        <section className="card">
          <p>Ningún módulo de recetas (<strong>Cocina y recetas</strong> o <strong>Coctelería</strong>)
            está activo en esta licencia.</p>
          <Link className="btn btn--primary btn--block" to="/">Volver al inicio</Link>
        </section>
      </div>
    )
  }
  // Solo el mando (dueño o administrativo) entra aqui.
  if (!isManager) {
    return (
      <div className="screen">
        <h2>Recetas</h2>
        <section className="card">
          <p>Solo el <strong>dueño o un administrativo</strong> gestiona las recetas y abastece la cocina.</p>
          <Link className="btn btn--primary btn--block" to="/">Volver al inicio</Link>
        </section>
      </div>
    )
  }

  const priceLabel = (p) => (p ? formatMoney(p.price, p.priceCurrency || baseCurrency) : '—')

  // --- Abastecer cocina (almacen -> __cocina). ---
  const toggle = (p) => {
    setDoneMsg('')
    setSelected((prev) => {
      const next = { ...prev }
      if (p.id in next) delete next[p.id]
      else next[p.id] = '1'
      return next
    })
  }
  const setQty = (productId, value) => setSelected((prev) => ({ ...prev, [productId]: value }))
  const selectedList = Object.keys(selected).map((id) => productById[id]).filter(Boolean)
  const qtyOf = (id) => Number(selected[id]) || 0
  const overOf = (p) => qtyOf(p.id) > warehouseOf(p)
  const allValid = selectedList.every((p) => qtyOf(p.id) > 0 && !overOf(p))
  const totalUnits = round2(selectedList.reduce((a, p) => a + qtyOf(p.id), 0))

  const abastecer = async () => {
    setError('')
    setBusy(true)
    try {
      const items = selectedList.map((p) => ({ productId: p.id, name: p.name, unit: p.unit, qty: qtyOf(p.id) }))
      // Reusa el traspaso general: almacen central -> cocina. No cambia esa logica.
      await transfersRepo.move({ fromLocation: WAREHOUSE, toLocation: COCINA, items, byUserId: user.id })
      setDoneMsg(`✅ ${items.length} producto(s) enviados a ${COCINA_LABEL}.`)
      setSelected({})
      setQuery('')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  // Eliminar una receta (solo dueño): borrado LOGICO (append-only). Confirma antes;
  // el elaborado sale del catalogo y el historial se conserva (queda en auditoria).
  const removeRecipe = (r) => {
    if (!confirm(`¿Eliminar la receta "${r.name}"? Dejará de ofrecerse y su elaborado sale del catálogo. El historial se conserva (auditable). Úsalo solo si ya no la vas a elaborar más.`)) return
    recipesRepo.remove(r.id, { userId: user.id }).catch((e) => alert('No se pudo eliminar: ' + e.message))
  }

  // Activas primero y alfabetico dentro de cada grupo (criterio de siempre).
  const sortRecipes = (list) => [...list].sort((a, b) => {
    if (!!a.active !== !!b.active) return a.active ? -1 : 1
    return (a.name || '').localeCompare(b.name || '')
  })

  // Una seccion por tipo, cada una tras SU modulo. Con solo 'cocina' se ve
  // exactamente lo de siempre (la de cocteleria no se pinta).
  const sections = [
    canKitchen && {
      kind: RECIPE_KINDS.KITCHEN,
      title: 'Recetas de cocina',
      hint: 'Se elaboran en la cocina y se envían a las áreas desde el tablero del cocinero.',
      empty: 'Aún no hay recetas de cocina.'
    },
    canCocktails && {
      kind: RECIPE_KINDS.COCKTAIL,
      title: 'Recetas de coctelería',
      hint: 'Se elaboran DENTRO del área (consumen su stock) y el trago queda en esa misma área.',
      empty: 'Aún no hay recetas de coctelería.'
    }
  ].filter(Boolean).map((sec) => ({
    ...sec,
    list: sortRecipes(recipes.filter((r) => recipeKind(r) === sec.kind))
  }))

  return (
    <div className="screen">
      <h2>Recetas</h2>
      <p className="muted">
        Define las recetas (cada una crea su producto elaborado){canKitchen ? ' y abastece la cocina con insumos del almacén' : ''}.
        Lo que se elabora y a dónde va depende del tipo de receta.
      </p>

      {/* ---- Recetas, una seccion por tipo ---- */}
      {sections.map((sec) => (
      <section className="card" key={sec.kind}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h3>{sec.title} ({sec.list.length})</h3>
          {isOwner && (
            <button className="btn btn--primary btn--sm" onClick={() => setEditing({ kind: sec.kind })}>+ Nueva</button>
          )}
        </div>
        <p className="muted">{sec.hint}</p>
        {sec.list.length === 0 ? (
          <p className="muted">
            {isOwner ? `${sec.empty} Crea la primera con “+ Nueva”.` : sec.empty}
          </p>
        ) : (
          <div className="entry-lines">
            {sec.list.map((r) => {
              const prod = productById[r.outputProductId]
              const thumb = photos.get(r.outputProductId)
              return (
                <div key={r.id} className="entry-line">
                  <div className="entry-line__head">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <div className="product-thumb">
                        {thumb ? <img src={thumb} alt="" loading="lazy" /> : <span className="product-thumb__ph">🍽️</span>}
                      </div>
                      <div>
                        <strong>{r.name}</strong>{!r.active && <span className="muted"> · (dada de baja)</span>}
                        <div className="muted">{priceLabel(prod)} · {r.items?.length || 0} insumo(s)</div>
                      </div>
                    </div>
                    {isOwner && (
                      <button className="btn btn--ghost btn--sm" onClick={() => setEditing(r)}>Editar</button>
                    )}
                  </div>
                  {isOwner && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button className="btn btn--ghost btn--sm" onClick={() => recipesRepo.setActive(r.id, !r.active)}>
                        {r.active ? 'Dar de baja' : 'Reactivar'}
                      </button>
                      <button className="btn btn--ghost btn--sm" onClick={() => removeRecipe(r)}>
                        Eliminar
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
      ))}

      {/* ---- Abastecer cocina (solo con el modulo 'cocina': es `__cocina`) ---- */}
      {canKitchen && (
      <section className="card">
        <h3>Abastecer {COCINA_LABEL.toLowerCase()}</h3>
        <p className="muted">
          Marca los productos del almacén y pon la cantidad. Al enviar, salen del almacén central
          y entran a la cocina (queda en el libro mayor y en el reporte de traspasos).
        </p>
        {doneMsg && <p className="ok-text">{doneMsg}</p>}

        {selectedList.length > 0 && (
          <>
            <div className="entry-lines">
              {selectedList.map((p) => {
                const wh = warehouseOf(p)
                const over = overOf(p)
                return (
                  <div key={p.id} className="entry-line">
                    <div className="entry-line__head">
                      <div><strong>{p.name}</strong><span className="muted"> · almacén: {cleanQty(wh)} {p.unit}</span></div>
                      <button className="link-del" onClick={() => toggle(p)}>quitar</button>
                    </div>
                    <label className="field">
                      <span>Cantidad a enviar ({p.unit})</span>
                      <input type="number" inputMode="decimal" value={selected[p.id] ?? ''} onChange={(e) => setQty(p.id, e.target.value)} />
                    </label>
                    {over && <p className="error">No puedes enviar más de lo que hay en el almacén ({cleanQty(wh)}).</p>}
                  </div>
                )
              })}
            </div>
            <div className="total-row"><span>Total a enviar</span><strong className="total-amount">{cleanQty(totalUnits)}</strong></div>
            {error && <p className="error">{error}</p>}
            <button className="btn btn--primary btn--block" disabled={selectedList.length === 0 || !allValid || busy} onClick={abastecer}>
              {busy ? 'Enviando…' : `Enviar ${selectedList.length} producto(s) a ${COCINA_LABEL}`}
            </button>
          </>
        )}

        <input
          className="search-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filtrar productos del almacén…"
        />
        {Object.keys(groups).length === 0 ? (
          <p className="muted">No hay productos con existencia en el almacén para enviar.</p>
        ) : (
          Object.entries(groups).map(([cat, list]) => (
            <div key={cat} className="check-group">
              <p className="check-group__title">{catName[cat]}</p>
              {list.map((p) => {
                const checked = p.id in selected
                return (
                  <label key={p.id} className={`check-row ${checked ? 'is-checked' : ''}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggle(p)} />
                    <div className="check-row__main">
                      <strong>{p.name}</strong>
                      <span className="muted">
                        {p.code ? `${p.code} · ` : ''}almacén: {cleanQty(warehouseOf(p))} · cocina: {cleanQty(cocinaOf(p))} {p.unit}
                      </span>
                    </div>
                  </label>
                )
              })}
            </div>
          ))
        )}
      </section>
      )}

      {editing && (
        <RecipeForm
          recipe={editing.id ? editing : null}
          outputProduct={editing.id ? productById[editing.outputProductId] : null}
          newKind={editing.id ? null : editing.kind}
          products={products}
          categories={categories}
          areas={areas}
          recipeOutputIds={recipeOutputIds}
          onClose={() => setEditing(null)}
          onSaved={() => setDoneMsg('')}
        />
      )}
    </div>
  )
}
