import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { productsRepo } from '../../repositories/productsRepo'
import { mermasRepo } from '../../repositories/mermasRepo'
import { configRepo } from '../../repositories/configRepo'
import { usersRepo } from '../../repositories/usersRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { matchesQuery } from '../../lib/search'
import { round2, formatMoney, isForeignPriced, foreignToBase } from '../../lib/currency'
import { formatDateTime } from '../../lib/dates'
import { WAREHOUSE, WAREHOUSE_LABEL, locationLabel } from '../../db/constants'

// Mermas (deterioro/perdida): rebaja de inventario que NO es venta. Solo el
// dueño/administrativo (ve costos). Se elige la ubicacion (almacen o area), el
// producto y la cantidad; se registra la perdida valorada al costo. El detalle
// y la afectacion total se ven en Reportes -> "Mermas".
export function MermaScreen() {
  const { user, isManager } = useAuth()
  const { baseCurrency, rateOf } = useCurrency()
  const areas = useLiveQuery(() => configRepo.getAreas(), [], [])
  const products = useLiveQuery(() => productsRepo.listActive(), [], [])
  const users = useLiveQuery(() => usersRepo.list(), [], [])
  const recent = useLiveQuery(() => mermasRepo.listAll(), [], [])

  const [location, setLocation] = useState(WAREHOUSE)
  const [query, setQuery] = useState('')
  const [product, setProduct] = useState(null)
  const [qty, setQty] = useState('1')
  const [reason, setReason] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Existencia del producto en la ubicacion elegida (derivada de la cache).
  const stockAt = (p) => Number(p.stockByLocation?.[location] ?? (location === WAREHOUSE ? p.stock : 0) ?? 0)
  const results = useMemo(() => {
    if (!query.trim()) return []
    return products.filter((p) => matchesQuery(p, query) && stockAt(p) > 0).slice(0, 12)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, query, location])

  if (!isManager) {
    return (
      <div className="screen">
        <h2>Mermas</h2>
        <section className="card">
          <p>Solo el <strong>dueño o un administrativo</strong> puede registrar mermas.</p>
          <Link className="btn btn--primary btn--block" to="/">Volver al inicio</Link>
        </section>
      </div>
    )
  }

  const avail = product ? stockAt(product) : 0
  const q = Number(qty) || 0
  // Modulo 'divisas': si el producto se fija en divisa, precio y costo se valoran
  // en MN con la tasa vigente (la afectacion del reporte es en MN). Sin tasa no se
  // puede registrar. Un producto en la base se comporta igual que siempre.
  const foreign = product ? isForeignPriced(product, baseCurrency) : false
  const priceRate = foreign ? rateOf(product.priceCurrency) : 1
  const noRate = foreign && !(priceRate > 0)
  const unitCostMN = !product ? 0 : (foreign ? foreignToBase(Number(product.cost) || 0, priceRate) : (Number(product.cost) || 0))
  const unitPriceMN = !product ? 0 : (foreign ? foreignToBase(Number(product.price) || 0, priceRate) : (Number(product.price) || 0))
  const costTotal = round2(q * unitCostMN)
  const saleTotal = round2(q * unitPriceMN)
  const valid = product && q > 0 && q <= avail && reason.trim() && !noRate
  const userName = (id) => users.find((u) => u.id === id)?.name || '—'

  const submit = async () => {
    if (!valid) return
    setBusy(true)
    setError('')
    try {
      await mermasRepo.create({ productId: product.id, qty: q, location, reason, userId: user.id, priceRate: foreign ? priceRate : null })
      setProduct(null)
      setQty('1')
      setReason('')
      setQuery('')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <h2>Mermas</h2>
      <p className="muted">
        Rebaja de inventario por deterioro o pérdida. <strong>No es una venta</strong>: solo
        baja la existencia. La afectación se valora al costo (ver Reportes → “Mermas”).
      </p>

      <section className="card">
        <label className="field">
          <span>Ubicación</span>
          <select value={location} onChange={(e) => { setLocation(e.target.value); setProduct(null); setQuery('') }}>
            <option value={WAREHOUSE}>🏬 {WAREHOUSE_LABEL}</option>
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>

        {error && <p className="error">{error}</p>}

        {!product ? (
          <>
            <input
              className="search-input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar producto con existencia en la ubicación…"
            />
            <div className="product-list">
              {results.map((p) => (
                <button key={p.id} className="product-row" onClick={() => { setProduct(p); setQuery('') }}>
                  <div className="product-row__main">
                    <strong>{p.name}</strong>
                    <span className="muted">existencia {stockAt(p)} {p.unit}</span>
                  </div>
                  <span className="price">{formatMoney(p.price, p.priceCurrency || baseCurrency)}</span>
                </button>
              ))}
              {query.trim() && results.length === 0 && (
                <p className="muted">Sin productos con existencia en {locationLabel(location)}.</p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="kv">
              <span><strong>{product.name}</strong> · existencia {avail} {product.unit}</span>
              <button className="link-del" onClick={() => setProduct(null)}>cambiar</button>
            </div>
            <div className="form-row">
              <label className="field">
                <span>Cantidad ({product.unit})</span>
                <input type="number" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
              </label>
              <label className="field">
                <span>Afectación (costo)</span>
                <input value={formatMoney(costTotal, baseCurrency)} readOnly />
              </label>
            </div>
            {q > avail && <p className="error">No puedes mermar más de lo que hay ({avail} {product.unit}).</p>}
            {foreign && (
              <p className="muted">
                <small>
                  Producto en <strong>{product.priceCurrency}</strong>; la afectación se valora en {baseCurrency}
                  {priceRate > 0 ? ` a la tasa vigente (${priceRate})` : ''}.
                </small>
              </p>
            )}
            {noRate && <p className="error">Define la tasa de {product.priceCurrency} en Ajustes antes de registrar esta merma.</p>}
            <label className="field">
              <span>Motivo</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej: producto vencido, roto, dañado" />
            </label>
            <p className="muted">
              Se rebajan <strong>{q || 0} {product.unit}</strong> de <strong>{locationLabel(location)}</strong>.{' '}
              Precio de venta perdido: {formatMoney(saleTotal, baseCurrency)} · Costo (afectación):{' '}
              <strong>{formatMoney(costTotal, baseCurrency)}</strong>.
            </p>
            {saved && <p className="ok-text">✓ Merma registrada</p>}
            <button className="btn btn--primary btn--block" disabled={!valid || busy} onClick={submit}>
              {busy ? 'Registrando…' : 'Registrar merma'}
            </button>
          </>
        )}
        {saved && !product && <p className="ok-text">✓ Merma registrada</p>}
      </section>

      {recent.length > 0 && (
        <section className="card">
          <h3>Mermas recientes</h3>
          <div className="list">
            {recent.slice(0, 15).map((m) => (
              <div key={m.id} className="kv">
                <span className="muted">
                  {formatDateTime(m.createdAt)} · {m.name} · {m.qty} {m.unit} · {locationLabel(m.location)}
                  {m.reason ? ` · ${m.reason}` : ''} · {userName(m.userId)}
                </span>
                <strong>{formatMoney(m.costTotal, baseCurrency)}</strong>
              </div>
            ))}
          </div>
          <p className="muted">Detalle completo y totales en Reportes → “Mermas”.</p>
        </section>
      )}
    </div>
  )
}
