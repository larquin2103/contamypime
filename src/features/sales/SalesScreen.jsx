import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { productsRepo } from '../../repositories/productsRepo'
import { salesRepo } from '../../repositories/salesRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useShift } from '../../app/providers/ShiftProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { matchesQuery } from '../../lib/search'
import { round2, formatMoney, baseToForeign } from '../../lib/currency'
import { CASH_CURRENCIES } from '../../db/constants'

export function SalesScreen() {
  const { user } = useAuth()
  const { activeShift, canSell } = useShift()
  const { baseCurrency, rateOf } = useCurrency()
  const products = useLiveQuery(() => productsRepo.listActive(), [], [])

  const [query, setQuery] = useState('')
  const [cart, setCart] = useState([]) // [{ productId, name, unit, unitPrice, unitCost, qty, stock }]
  const [payCurrency, setPayCurrency] = useState(baseCurrency)
  const [paid, setPaid] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [lastSale, setLastSale] = useState(null)

  if (!canSell) {
    return (
      <div className="screen">
        <h2>Vender</h2>
        <section className="card">
          <p>Para registrar ventas necesitas tener <strong>tu turno abierto</strong>.</p>
          <p className="muted">
            Solo el vendedor con turno activo puede vender — ni siquiera el dueno sin turno.
          </p>
          <Link className="btn btn--primary btn--block" to="/shift">
            Ir a Turno
          </Link>
        </section>
      </div>
    )
  }

  const results = useMemo(() => {
    if (!query.trim()) return []
    return products.filter((p) => matchesQuery(p, query)).slice(0, 20)
  }, [products, query])

  const addToCart = (p) => {
    setCart((prev) => {
      const i = prev.findIndex((l) => l.productId === p.id)
      if (i >= 0) {
        const next = [...prev]
        next[i] = { ...next[i], qty: round2(next[i].qty + 1) }
        return next
      }
      return [
        ...prev,
        {
          productId: p.id,
          name: p.name,
          unit: p.unit,
          unitPrice: p.price,
          unitCost: p.cost,
          qty: 1,
          stock: p.stock
        }
      ]
    })
    setQuery('')
  }

  const setQty = (productId, qty) => {
    setCart((prev) =>
      prev.flatMap((l) => {
        if (l.productId !== productId) return [l]
        const q = Number(qty)
        if (!q || q <= 0) return [] // quitar del carrito
        return [{ ...l, qty: q }]
      })
    )
  }

  const totalBase = useMemo(
    () => round2(cart.reduce((a, l) => a + l.unitPrice * l.qty, 0)),
    [cart]
  )
  const rate = payCurrency === baseCurrency ? 1 : rateOf(payCurrency)
  const totalInCur =
    payCurrency === baseCurrency ? totalBase : baseToForeign(totalBase, rate)
  const paidNum = Number(paid) || 0
  const change = round2(paidNum - totalInCur)
  const canCharge = cart.length > 0 && paidNum >= totalInCur && (payCurrency === baseCurrency || rate > 0)

  const charge = async () => {
    setConfirming(true)
    const items = cart.map((l) => ({
      productId: l.productId,
      name: l.name,
      unit: l.unit,
      qty: l.qty,
      unitPrice: l.unitPrice,
      unitCost: l.unitCost,
      lineTotal: round2(l.unitPrice * l.qty)
    }))
    await salesRepo.create({
      shiftId: activeShift.id,
      sellerId: user.id,
      items,
      totalBase,
      paymentCurrency: payCurrency,
      cashAmount: round2(totalInCur),
      amountPaid: paidNum,
      change,
      rate: payCurrency === baseCurrency ? null : rate
    })
    setLastSale({ totalInCur: round2(totalInCur), change, payCurrency })
    setCart([])
    setPaid('')
    setPayCurrency(baseCurrency)
    setConfirming(false)
  }

  return (
    <div className="screen">
      <div className="screen__header">
        <h2>Vender</h2>
        <Link className="btn btn--ghost btn--sm" to="/shift">Turno</Link>
      </div>

      {lastSale && (
        <div className="sale-done" onClick={() => setLastSale(null)}>
          ✅ Venta cobrada · Cambio: {formatMoney(lastSale.change, lastSale.payCurrency)}
          <span className="muted"> (toca para cerrar)</span>
        </div>
      )}

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
            <button key={p.id} className="product-row" onClick={() => addToCart(p)}>
              <div className="product-row__main">
                <strong>{p.name}</strong>
                <span className="muted">{p.code ? `${p.code} · ` : ''}{p.stock} {p.unit}</span>
              </div>
              <span className="price">{formatMoney(p.price, baseCurrency)}</span>
            </button>
          ))}
        </div>
      )}

      <section className="card">
        <h3>Carrito</h3>
        {cart.length === 0 ? (
          <p className="muted">Busca y toca un producto para agregarlo.</p>
        ) : (
          <div className="cart">
            {cart.map((l) => (
              <div key={l.productId} className="cart-line">
                <div className="cart-line__info">
                  <strong>{l.name}</strong>
                  <span className="muted">
                    {formatMoney(l.unitPrice, baseCurrency)} × {l.qty} {l.unit}
                    {l.qty > l.stock && <span className="warn-text"> · stock: {l.stock}</span>}
                  </span>
                </div>
                <div className="qty-ctrl">
                  <button onClick={() => setQty(l.productId, round2(l.qty - 1))}>−</button>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={l.qty}
                    onChange={(e) => setQty(l.productId, e.target.value)}
                  />
                  <button onClick={() => setQty(l.productId, round2(l.qty + 1))}>＋</button>
                </div>
                <span className="cart-line__total">{formatMoney(l.unitPrice * l.qty, baseCurrency)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {cart.length > 0 && (
        <section className="card">
          <div className="total-row">
            <span>Total</span>
            <strong className="total-amount">{formatMoney(totalBase, baseCurrency)}</strong>
          </div>

          <p className="field-label">Pago en efectivo</p>
          <div className="pay-currencies">
            {CASH_CURRENCIES.map((c) => (
              <button
                key={c}
                className={`btn btn--sm ${payCurrency === c ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => setPayCurrency(c)}
                disabled={c !== baseCurrency && !rateOf(c)}
              >
                {c}
              </button>
            ))}
          </div>

          {payCurrency !== baseCurrency && (
            <p className="muted">
              Total en {payCurrency}: <strong>{formatMoney(totalInCur, payCurrency)}</strong>{' '}
              (tasa {rate})
            </p>
          )}

          <label className="field">
            <span>Recibido ({payCurrency})</span>
            <input
              type="number"
              inputMode="decimal"
              value={paid}
              onChange={(e) => setPaid(e.target.value)}
              placeholder="0"
            />
          </label>

          <div className="total-row">
            <span>Cambio</span>
            <strong className={`total-amount ${change < 0 ? 'neg' : ''}`}>
              {formatMoney(change, payCurrency)}
            </strong>
          </div>

          <button
            className="btn btn--primary btn--block"
            disabled={!canCharge || confirming}
            onClick={charge}
          >
            {confirming ? 'Cobrando…' : 'Cobrar'}
          </button>
        </section>
      )}
    </div>
  )
}
