import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { productsRepo } from '../../repositories/productsRepo'
import { categoriesRepo } from '../../repositories/categoriesRepo'
import { purchasesRepo } from '../../repositories/purchasesRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useShift } from '../../app/providers/ShiftProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { matchesQuery } from '../../lib/search'
import { round2, formatMoney } from '../../lib/currency'
import { ProductForm } from '../products/ProductForm'

export function EntryScreen() {
  const { user, isOwner } = useAuth()
  const { activeShift, canSell } = useShift()
  const { baseCurrency } = useCurrency()
  const products = useLiveQuery(() => productsRepo.listActive(), [], [])
  const categories = useLiveQuery(() => categoriesRepo.list(), [], [])

  const [query, setQuery] = useState('')
  const [lines, setLines] = useState([]) // [{ productId, name, unit, qty, unitCost }]
  const [supplier, setSupplier] = useState('')
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  // Solo el dueno registra entradas de mercancia (y ve costos).
  if (!isOwner) {
    return (
      <div className="screen">
        <h2>Entrada de mercancia</h2>
        <section className="card">
          <p>Solo el <strong>dueno</strong> puede registrar entradas de mercancia.</p>
          <Link className="btn btn--primary btn--block" to="/">Volver al inicio</Link>
        </section>
      </div>
    )
  }

  const results = useMemo(() => {
    if (!query.trim()) return []
    return products.filter((p) => matchesQuery(p, query)).slice(0, 20)
  }, [products, query])

  const addLine = (p) => {
    setLines((prev) => {
      if (prev.some((l) => l.productId === p.id)) return prev
      return [...prev, { productId: p.id, name: p.name, unit: p.unit, qty: 1, unitCost: p.cost || '' }]
    })
    setQuery('')
  }

  const onCreated = async (newId) => {
    const p = await productsRepo.get(newId)
    if (p) addLine(p)
  }

  const update = (productId, field, value) =>
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, [field]: value } : l)))

  const removeLine = (productId) =>
    setLines((prev) => prev.filter((l) => l.productId !== productId))

  const total = useMemo(
    () => round2(lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0)),
    [lines]
  )

  const valid = lines.length > 0 && lines.every((l) => Number(l.qty) > 0 && Number(l.unitCost) >= 0)

  const register = async () => {
    setBusy(true)
    await purchasesRepo.create({
      items: lines,
      supplier,
      userId: user.id,
      shiftId: activeShift?.id ?? null
    })
    setDone(true)
    setLines([])
    setSupplier('')
    setBusy(false)
  }

  if (done) {
    return (
      <div className="screen">
        <div className="cuadre-banner cuadre-banner--green">
          <span className="cuadre-emoji">📥</span>
          <div>
            <strong>Entrada registrada</strong>
            <p className="muted">Las existencias se actualizaron al instante.</p>
          </div>
        </div>
        <button className="btn btn--primary btn--block" onClick={() => setDone(false)}>
          Registrar otra entrada
        </button>
        <Link className="btn btn--ghost btn--block" to="/catalog">Ver catalogo</Link>
      </div>
    )
  }

  return (
    <div className="screen">
      <div className="screen__header">
        <h2>Entrada de mercancia</h2>
        <button className="btn btn--ghost btn--sm" onClick={() => setCreating(true)}>
          + Producto nuevo
        </button>
      </div>

      <input
        className="search-input"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar producto (3 letras o codigo)…"
      />
      {results.length > 0 && (
        <div className="product-list sell-results">
          {results.map((p) => (
            <button key={p.id} className="product-row" onClick={() => addLine(p)}>
              <div className="product-row__main">
                <strong>{p.name}</strong>
                <span className="muted">{p.code ? `${p.code} · ` : ''}stock {p.stock} {p.unit}</span>
              </div>
              <span className="muted">costo {formatMoney(p.cost, baseCurrency)}</span>
            </button>
          ))}
        </div>
      )}

      <section className="card">
        <h3>Productos que entran</h3>
        {lines.length === 0 ? (
          <p className="muted">Busca un producto (o crea uno nuevo) para agregarlo.</p>
        ) : (
          <div className="entry-lines">
            {lines.map((l) => (
              <div key={l.productId} className="entry-line">
                <div className="entry-line__head">
                  <strong>{l.name}</strong>
                  <button className="link-del" onClick={() => removeLine(l.productId)}>quitar</button>
                </div>
                <div className="form-row">
                  <label className="field">
                    <span>Cantidad ({l.unit})</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={l.qty}
                      onChange={(e) => update(l.productId, 'qty', e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Costo unitario ({baseCurrency})</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={l.unitCost}
                      onChange={(e) => update(l.productId, 'unitCost', e.target.value)}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {lines.length > 0 && (
        <section className="card">
          <label className="field">
            <span>Proveedor (opcional)</span>
            <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Nombre o referencia" />
          </label>
          <div className="total-row">
            <span>Total de la compra</span>
            <strong className="total-amount">{formatMoney(total, baseCurrency)}</strong>
          </div>
          <button className="btn btn--primary btn--block" disabled={!valid || busy} onClick={register}>
            {busy ? 'Registrando…' : 'Registrar entrada'}
          </button>
        </section>
      )}

      {creating && (
        <ProductForm
          categories={categories}
          hideOpeningStock
          onCreated={onCreated}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  )
}
