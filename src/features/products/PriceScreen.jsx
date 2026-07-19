import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { productsRepo } from '../../repositories/productsRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useShift } from '../../app/providers/ShiftProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { matchesQuery } from '../../lib/search'
import { formatMoney } from '../../lib/currency'
import { formatDateTime } from '../../lib/dates'

export function PriceScreen() {
  const { user, isManager } = useAuth()
  const { activeShift, canSell } = useShift()
  const { baseCurrency } = useCurrency()
  const products = useLiveQuery(() => productsRepo.listActive(), [], [])

  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  // Dueño o administrativo cambian precios.
  if (!isManager) {
    return (
      <div className="screen">
        <h2>Cambiar precio</h2>
        <section className="card">
          <p>Solo el <strong>dueño o un administrativo</strong> puede cambiar precios.</p>
          <Link className="btn btn--primary btn--block" to="/">Volver al inicio</Link>
        </section>
      </div>
    )
  }

  const selected = products.find((p) => p.id === selectedId) || null

  const results = useMemo(() => {
    if (!query.trim()) return []
    return products.filter((p) => matchesQuery(p, query)).slice(0, 20)
  }, [products, query])

  return (
    <div className="screen">
      <h2>Cambiar precio</h2>
      <p className="muted">
        El precio nuevo aplica desde ahora. Las ventas ya hechas conservan su precio.
      </p>

      {!selected && (
        <>
          <input
            className="search-input"
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar producto (3 letras o código)…"
          />
          <div className="product-list">
            {results.map((p) => (
              <button key={p.id} className="product-row" onClick={() => { setSelectedId(p.id); setQuery('') }}>
                <div className="product-row__main">
                  <strong>{p.name}</strong>
                  <span className="muted">{p.code ? `${p.code} · ` : ''}{p.unit}</span>
                </div>
                <span className="price">{formatMoney(p.price, baseCurrency)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {selected && (
        <PriceEditor
          product={selected}
          baseCurrency={baseCurrency}
          userId={user.id}
          shiftId={activeShift?.id ?? null}
          onBack={() => setSelectedId(null)}
        />
      )}
    </div>
  )
}

function PriceEditor({ product, baseCurrency, userId, shiftId, onBack }) {
  const [newPrice, setNewPrice] = useState(String(product.price))
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const history = useLiveQuery(() => productsRepo.priceHistory(product.id), [product.id], [])

  const save = async () => {
    setBusy(true)
    const changed = await productsRepo.changePrice(product.id, newPrice, { userId, shiftId, note })
    setSaved(changed ? 'ok' : 'same')
    setNote('')
    setBusy(false)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <>
      <button className="link-back" onClick={onBack}>← Elegir otro producto</button>
      <section className="card">
        <h3>{product.name}</h3>
        <div className="kv">
          <span className="muted">Precio actual</span>
          <strong>{formatMoney(product.price, baseCurrency)}</strong>
        </div>
        <label className="field">
          <span>Nuevo precio ({baseCurrency})</span>
          <input
            type="number"
            inputMode="decimal"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Motivo (opcional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: ajuste por costo" />
        </label>
        {saved === 'ok' && <p className="ok-text">✓ Precio actualizado</p>}
        {saved === 'same' && <p className="muted">El precio es el mismo, no hubo cambio.</p>}
        <button className="btn btn--primary btn--block" disabled={busy} onClick={save}>
          {busy ? 'Guardando…' : 'Guardar precio nuevo'}
        </button>
      </section>

      <section className="card">
        <h3>Historial de precios</h3>
        {history.length === 0 ? (
          <p className="muted">Sin cambios registrados todavía.</p>
        ) : (
          <div className="list">
            {history.map((h) => (
              <div key={h.id} className="price-hist">
                <div>
                  {h.kind === 'tiers' ? (
                    <strong>Escalas mayoristas</strong>
                  ) : (
                    <strong>
                      {formatMoney(h.oldPrice, baseCurrency)} → {formatMoney(h.newPrice, baseCurrency)}
                    </strong>
                  )}
                  {h.note && <span className="muted"> · {h.note}</span>}
                </div>
                <span className="muted">{formatDateTime(h.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
