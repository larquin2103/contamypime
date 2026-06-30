import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { productsRepo } from '../../repositories/productsRepo'
import { categoriesRepo } from '../../repositories/categoriesRepo'
import { configRepo } from '../../repositories/configRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useShift } from '../../app/providers/ShiftProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { matchesQuery } from '../../lib/search'
import { formatMoney } from '../../lib/currency'
import { ProductForm } from './ProductForm'
import { CategoryManager } from './CategoryManager'

const MAX_RENDER = 200 // evita pintar 400+ filas de golpe en gama media

export function Catalog() {
  const { isOwner } = useAuth()
  const { activeShift } = useShift()
  const { baseCurrency } = useCurrency()
  const products = useLiveQuery(() => productsRepo.list(), [], [])
  const categories = useLiveQuery(() => categoriesRepo.list(), [], [])
  const areas = useLiveQuery(() => configRepo.getAreas(), [], [])

  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null) // producto en edicion
  const [creating, setCreating] = useState(false)
  const [showCategories, setShowCategories] = useState(false)

  // El vendedor solo ve los productos ASIGNADOS a su área (no el almacén). El
  // dueño ve todo el catálogo. Modo área activo solo si hay áreas configuradas.
  const sellArea = activeShift?.area || ''
  const areaMode = !isOwner && areas.length > 0
  // Existencia a mostrar: en modo área, la del área; si no, el total.
  const stockShown = (p) => (areaMode ? Number(p.stockByLocation?.[sellArea] || 0) : Number(p.stock || 0))

  const categoryName = useMemo(() => {
    const map = {}
    for (const c of categories) map[c.id] = c.name
    return map
  }, [categories])

  const filtered = useMemo(() => {
    let active = products.filter((p) => p.active)
    // En modo área, solo productos con existencia asignada a esa área.
    if (areaMode && sellArea) active = active.filter((p) => Number(p.stockByLocation?.[sellArea] || 0) > 0)
    const result = active.filter((p) => matchesQuery(p, query))
    result.sort((a, b) => a.name.localeCompare(b.name))
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, query, areaMode, sellArea])

  const shown = filtered.slice(0, MAX_RENDER)

  // Vendedor con áreas pero sin turno abierto: no tiene área que mostrar.
  if (areaMode && !sellArea) {
    return (
      <div className="screen">
        <h2>Catálogo</h2>
        <section className="card">
          <p>Abre tu turno en un área para ver los productos que tienes asignados.</p>
          <Link className="btn btn--primary btn--block" to="/shift">Ir a Turno</Link>
        </section>
      </div>
    )
  }

  return (
    <div className="screen">
      <div className="screen__header">
        <h2>Catalogo</h2>
        {isOwner && (
          <div className="header-actions">
            <Link className="btn btn--ghost btn--sm" to="/import">
              ⬆ Importar
            </Link>
            <Link className="btn btn--ghost btn--sm" to="/price">
              🏷️ Precios
            </Link>
            <button className="btn btn--ghost btn--sm" onClick={() => setShowCategories(true)}>
              Categorias
            </button>
            <button className="btn btn--primary btn--sm" onClick={() => setCreating(true)}>
              + Producto
            </button>
          </div>
        )}
      </div>

      <input
        className="search-input"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar por nombre (3 letras) o codigo…"
      />

      <p className="muted result-count">
        {filtered.length} producto{filtered.length === 1 ? '' : 's'}
        {filtered.length > MAX_RENDER && ` — mostrando ${MAX_RENDER}, refina la busqueda`}
      </p>

      <div className="product-list">
        {shown.map((p) => (
          <button
            key={p.id}
            className="product-row"
            onClick={() => isOwner && setEditing(p)}
            disabled={!isOwner}
          >
            <div className="product-row__main">
              <strong>{p.name}</strong>
              <span className="muted">
                {p.code ? `${p.code} · ` : ''}
                {categoryName[p.categoryId] || 'Sin categoria'}
              </span>
            </div>
            <div className="product-row__meta">
              <span className="price">{formatMoney(p.price, baseCurrency)}</span>
              <span className={`stock ${stockShown(p) <= 0 ? 'stock--out' : ''}`}>
                {stockShown(p) <= 0 ? 'Agotado' : `${stockShown(p)} ${p.unit}`}
              </span>
            </div>
          </button>
        ))}

        {filtered.length === 0 && (
          <div className="empty-state">
            {products.length === 0 ? (
              <p className="muted">
                Catalogo vacio. {isOwner ? 'Añade productos o importa desde Excel.' : ''}
              </p>
            ) : (
              <p className="muted">Sin resultados para “{query}”.</p>
            )}
          </div>
        )}
      </div>

      {creating && (
        <ProductForm categories={categories} onClose={() => setCreating(false)} />
      )}
      {editing && (
        <ProductForm
          product={editing}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      )}
      {showCategories && <CategoryManager onClose={() => setShowCategories(false)} />}
    </div>
  )
}
