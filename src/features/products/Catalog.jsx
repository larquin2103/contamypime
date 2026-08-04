import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { productsRepo } from '../../repositories/productsRepo'
import { imagesRepo } from '../../repositories/imagesRepo'
import { categoriesRepo } from '../../repositories/categoriesRepo'
import { configRepo } from '../../repositories/configRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useShift } from '../../app/providers/ShiftProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { WAREHOUSE, locationLabel } from '../../db/constants'
import { matchesQuery } from '../../lib/search'
import { formatMoney } from '../../lib/currency'
import { ProductForm } from './ProductForm'
import { CategoryManager } from './CategoryManager'

const MAX_RENDER = 200 // evita pintar 400+ filas de golpe en gama media

export function Catalog() {
  const { isManager, isElaborator } = useAuth()
  const { activeShift } = useShift()
  const { baseCurrency } = useCurrency()
  const { hasModule } = useLicense()
  const products = useLiveQuery(() => productsRepo.list(), [], [])
  const categories = useLiveQuery(() => categoriesRepo.list(), [], [])
  const areas = useLiveQuery(() => configRepo.getAreas(), [], [])
  // Bloque A (mayorista): permiso del dueño para que el vendedor opere el almacén.
  const warehouseAllowed = useLiveQuery(() => configRepo.get('sellerWarehouseSale', false), [], false)
  // Fotos de producto (Fase 8 - B4, módulo 'imagenes'). Un solo Map refId->dataUrl
  // para pintar las miniaturas sin una consulta por fila. Sin el módulo: Map vacío.
  const canImages = hasModule(LICENSE_MODULES.IMAGES)
  const productImgs = useLiveQuery(
    () => (canImages ? imagesRepo.mapByType('product') : Promise.resolve(new Map())),
    [canImages],
    new Map()
  )

  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null) // producto en edicion
  const [creating, setCreating] = useState(false)
  const [showCategories, setShowCategories] = useState(false)
  // Vendedor con mayorista: puede ALTERNAR la vista entre su área y el almacén.
  const [showWarehouse, setShowWarehouse] = useState(false)

  // El vendedor solo ve los productos ASIGNADOS a su área (no el almacén). El
  // dueño y el administrativo ven todo el catálogo. Modo área solo si hay áreas.
  const sellArea = activeShift?.area || ''
  // El elaborador ve el catálogo de SU centro (su turno.area = elaboración).
  const areaMode = !isManager && (areas.length > 0 || isElaborator)
  // Mayorista: si el dueño lo permitió, el vendedor puede VER (solo lectura) el
  // catálogo del almacén central, además del de su área. El elaborador NO (no ve almacén).
  const canWarehouseView = !isElaborator && areaMode && !!sellArea && !!warehouseAllowed && hasModule(LICENSE_MODULES.WHOLESALE)
  // Ubicación que se está mirando (para el vendedor): su área o el almacén.
  const viewLoc = canWarehouseView && showWarehouse ? WAREHOUSE : sellArea
  // Existencia a mostrar: en modo área, la de la ubicación vista; si no, el total.
  const stockShown = (p) => (areaMode ? Number(p.stockByLocation?.[viewLoc] || 0) : Number(p.stock || 0))

  const categoryName = useMemo(() => {
    const map = {}
    for (const c of categories) map[c.id] = c.name
    return map
  }, [categories])

  const filtered = useMemo(() => {
    let active = products.filter((p) => p.active)
    // En modo área, solo productos con existencia en la ubicación vista (área o almacén).
    if (areaMode && viewLoc) active = active.filter((p) => Number(p.stockByLocation?.[viewLoc] || 0) > 0)
    const result = active.filter((p) => matchesQuery(p, query))
    result.sort((a, b) => a.name.localeCompare(b.name))
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, query, areaMode, viewLoc])

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
        {(isManager || isElaborator) && (
          <div className="header-actions">
            {isManager && (
              <>
                <Link className="btn btn--ghost btn--sm" to="/import">
                  ⬆ Importar
                </Link>
                <Link className="btn btn--ghost btn--sm" to="/price">
                  🏷️ Precios
                </Link>
                <button className="btn btn--ghost btn--sm" onClick={() => setShowCategories(true)}>
                  Categorías
                </button>
              </>
            )}
            {/* El elaborador puede CREAR productos (para elaborar), no editar/eliminar. */}
            <button className="btn btn--primary btn--sm" onClick={() => setCreating(true)}>
              + Producto
            </button>
          </div>
        )}
      </div>

      {/* Mayorista: el vendedor alterna entre su área y el almacén (solo lectura). */}
      {canWarehouseView && (
        <div className="tabs">
          <button
            className={`tab ${!showWarehouse ? 'is-active' : ''}`}
            onClick={() => setShowWarehouse(false)}
          >
            {sellArea}
          </button>
          <button
            className={`tab ${showWarehouse ? 'is-active' : ''}`}
            onClick={() => setShowWarehouse(true)}
          >
            🏬 {locationLabel(WAREHOUSE)}
          </button>
        </div>
      )}
      {canWarehouseView && showWarehouse && (
        <p className="muted">Vista del <strong>almacén central</strong> (solo lectura).</p>
      )}

      <input
        className="search-input"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar por nombre (3 letras) o código…"
      />

      <p className="muted result-count">
        {filtered.length} producto{filtered.length === 1 ? '' : 's'}
        {filtered.length > MAX_RENDER && ` — mostrando ${MAX_RENDER}, refina la búsqueda`}
      </p>

      <div className="product-list">
        {shown.map((p) => (
          <button
            key={p.id}
            className={`product-row ${canImages ? 'product-row--thumb' : ''}`}
            onClick={() => isManager && setEditing(p)}
            disabled={!isManager}
          >
            {canImages && (
              <div className="product-thumb">
                {productImgs.get(p.id)
                  ? <img src={productImgs.get(p.id)} alt="" loading="lazy" />
                  : <span className="product-thumb__ph">📦</span>}
              </div>
            )}
            <div className="product-row__main">
              <strong>{p.name}</strong>
              <span className="muted">
                {p.code ? `${p.code} · ` : ''}
                {categoryName[p.categoryId] || 'Sin categoría'}
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
                Catalogo vacio. {isManager ? 'Añade productos o importa desde Excel.' : ''}
              </p>
            ) : (
              <p className="muted">Sin resultados para “{query}”.</p>
            )}
          </div>
        )}
      </div>

      {creating && (
        <ProductForm
          categories={categories}
          onClose={() => setCreating(false)}
          hideOpeningStock={isElaborator}
        />
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
