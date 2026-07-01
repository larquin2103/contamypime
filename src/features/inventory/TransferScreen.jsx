import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { productsRepo } from '../../repositories/productsRepo'
import { categoriesRepo } from '../../repositories/categoriesRepo'
import { configRepo } from '../../repositories/configRepo'
import { transfersRepo } from '../../repositories/transfersRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { matchesQuery } from '../../lib/search'
import { round2 } from '../../lib/currency'
import { WAREHOUSE } from '../../db/constants'

// Bloque 20.2 - Salida del almacen central hacia un area. La registra el dueño o
// un administrativo. Resta del almacen y suma al area; el vendedor de esa area
// solo puede vender lo que aqui se le asigna.
//
// Flujo por AREA con seleccion multiple (checklist): eliges el area, marcas
// varios productos del catalogo del almacen a la vez, pones la cantidad de cada
// uno y los envias de golpe a esa area. Al enviar se limpia para que repitas con
// otra area y otros productos. La rebaja del almacen la hace transfersRepo.create
// (validada y atomica); aqui NO cambia esa logica.
export function TransferScreen() {
  const { user, isManager } = useAuth()
  const products = useLiveQuery(() => productsRepo.listActive(), [], [])
  const categories = useLiveQuery(() => categoriesRepo.list(), [], [])
  const areas = useLiveQuery(() => configRepo.getAreas(), [], [])

  const [toArea, setToArea] = useState('')
  const [query, setQuery] = useState('')
  // Seleccion: { [productId]: cantidadComoTexto }
  const [selected, setSelected] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [doneMsg, setDoneMsg] = useState('')

  const warehouseOf = (p) => Number(p.stockByLocation?.[WAREHOUSE] || 0)

  const catName = useMemo(() => {
    const m = { __none: 'Sin categoria' }
    for (const c of categories) m[c.id] = c.name
    return m
  }, [categories])

  const productById = useMemo(() => {
    const m = {}
    for (const p of products) m[p.id] = p
    return m
  }, [products])

  // Solo productos con existencia en el almacen (lo que no hay no se puede sacar).
  // Agrupados por categoria para marcarlos comodamente.
  const groups = useMemo(() => {
    const eligible = products.filter((p) => warehouseOf(p) > 0)
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
  }, [products, query])

  if (!isManager) {
    return (
      <div className="screen">
        <h2>Salida a áreas</h2>
        <section className="card">
          <p>Solo el <strong>dueño o un administrativo</strong> puede sacar mercancía del almacén hacia las áreas.</p>
          <Link className="btn btn--primary btn--block" to="/">Volver al inicio</Link>
        </section>
      </div>
    )
  }

  if (!areas || areas.length === 0) {
    return (
      <div className="screen">
        <h2>Salida a áreas</h2>
        <section className="card">
          <p>Primero define las <strong>áreas de venta</strong> en Ajustes.</p>
          <Link className="btn btn--primary btn--block" to="/settings">Ir a Ajustes</Link>
        </section>
      </div>
    )
  }

  const toggle = (p) => {
    setDoneMsg('')
    setSelected((prev) => {
      const next = { ...prev }
      if (p.id in next) delete next[p.id]
      else next[p.id] = '1' // cantidad por defecto; el usuario la ajusta
      return next
    })
  }

  const setQty = (productId, value) =>
    setSelected((prev) => ({ ...prev, [productId]: value }))

  const selectedList = Object.keys(selected)
    .map((id) => productById[id])
    .filter(Boolean)

  const qtyOf = (id) => Number(selected[id]) || 0
  const overOf = (p) => qtyOf(p.id) > warehouseOf(p)

  const allValid = selectedList.every((p) => qtyOf(p.id) > 0 && !overOf(p))
  const valid = !!toArea && selectedList.length > 0 && allValid
  const totalUnits = round2(selectedList.reduce((a, p) => a + qtyOf(p.id), 0))

  const register = async () => {
    setError('')
    setBusy(true)
    try {
      const items = selectedList.map((p) => ({
        productId: p.id,
        name: p.name,
        unit: p.unit,
        qty: qtyOf(p.id)
      }))
      await transfersRepo.create({ toArea, items, byUserId: user.id })
      setDoneMsg(`✅ ${items.length} producto(s) enviados a ${toArea}. Elige otra área para seguir.`)
      // Se limpia para el proximo envio (a otra area). El area queda elegida por
      // comodidad; cambiala en el desplegable para enviar a otra.
      setSelected({})
      setQuery('')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <h2>Salida a áreas</h2>
      <p className="muted">
        Elige el área, marca los productos que le envías y pon la cantidad de cada uno.
        Al enviar, lo marcado se descuenta del almacén central.
      </p>

      <section className="card">
        <label className="field">
          <span>1. Área de destino</span>
          <select value={toArea} onChange={(e) => { setToArea(e.target.value); setDoneMsg('') }}>
            <option value="">— Elige el área —</option>
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        {doneMsg && <p className="ok-text">{doneMsg}</p>}
      </section>

      {/* Panel de seleccionados con su cantidad + envío. */}
      {selectedList.length > 0 && (
        <section className="card">
          <h3>Seleccionados ({selectedList.length}) → {toArea || 'elige área'}</h3>
          <div className="entry-lines">
            {selectedList.map((p) => {
              const wh = warehouseOf(p)
              const over = overOf(p)
              return (
                <div key={p.id} className="entry-line">
                  <div className="entry-line__head">
                    <div>
                      <strong>{p.name}</strong>
                      <span className="muted"> · almacén: {wh} {p.unit}</span>
                    </div>
                    <button className="link-del" onClick={() => toggle(p)}>quitar</button>
                  </div>
                  <label className="field">
                    <span>Cantidad a enviar ({p.unit})</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={selected[p.id] ?? ''}
                      onChange={(e) => setQty(p.id, e.target.value)}
                    />
                  </label>
                  {over && <p className="error">No puedes sacar más de lo que hay en el almacén ({wh}).</p>}
                </div>
              )
            })}
          </div>
          <div className="total-row">
            <span>Total a enviar</span>
            <strong className="total-amount">{totalUnits}</strong>
          </div>
          {error && <p className="error">{error}</p>}
          {!toArea && <p className="muted">Elige primero el área de destino arriba.</p>}
          <button className="btn btn--primary btn--block" disabled={!valid || busy} onClick={register}>
            {busy ? 'Enviando…' : `Enviar ${selectedList.length} producto(s) a ${toArea || '…'}`}
          </button>
        </section>
      )}

      {/* Catálogo del almacén con checks para marcar varios a la vez. */}
      <section className="card">
        <h3>2. Marca los productos</h3>
        {!toArea ? (
          <p className="muted">Elige primero el área de destino para empezar a marcar productos.</p>
        ) : (
          <>
            <input
              className="search-input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filtrar por nombre o codigo…"
            />
            {Object.keys(groups).length === 0 ? (
              <p className="muted">No hay productos con existencia en el almacén para enviar.</p>
            ) : (
              Object.entries(groups).map(([cat, list]) => (
                <div key={cat} className="check-group">
                  <p className="check-group__title">{catName[cat]}</p>
                  {list.map((p) => {
                    const wh = warehouseOf(p)
                    const checked = p.id in selected
                    return (
                      <label key={p.id} className={`check-row ${checked ? 'is-checked' : ''}`}>
                        <input type="checkbox" checked={checked} onChange={() => toggle(p)} />
                        <div className="check-row__main">
                          <strong>{p.name}</strong>
                          <span className="muted">
                            {p.code ? `${p.code} · ` : ''}almacén: {wh} {p.unit}
                          </span>
                        </div>
                      </label>
                    )
                  })}
                </div>
              ))
            )}
          </>
        )}
      </section>
    </div>
  )
}
