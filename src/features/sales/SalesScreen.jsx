import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, Search, Package, Trash2 } from 'lucide-react'
import { productsRepo } from '../../repositories/productsRepo'
import { salesRepo } from '../../repositories/salesRepo'
import { configRepo } from '../../repositories/configRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useShift } from '../../app/providers/ShiftProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { normalizeTiers, tierFor, tierPriceFor } from '../../lib/priceTiers'
import { matchesQuery } from '../../lib/search'
import { round2, formatMoney, baseToForeign, foreignToBase } from '../../lib/currency'
import { parseSms } from '../../lib/sms'
import { CASH_CURRENCIES, TRANSFER_CURRENCIES, PAYMENT_METHODS, WAREHOUSE } from '../../db/constants'

export function SalesScreen() {
  const { user } = useAuth()
  const { activeShift, canSell } = useShift()
  const { baseCurrency, rateOf } = useCurrency()
  const { hasModule } = useLicense()
  const navigate = useNavigate()
  const products = useLiveQuery(() => productsRepo.listActive(), [], [])
  const areas = useLiveQuery(() => configRepo.getAreas(), [], [])
  // Bloque A (modulo mayorista): permiso general del dueño en Ajustes para que
  // el vendedor venda desde el almacen central sin cerrar su turno.
  const warehouseAllowed = useLiveQuery(() => configRepo.get('sellerWarehouseSale', false), [], false)
  const [fromWarehouse, setFromWarehouse] = useState(false)

  const [query, setQuery] = useState('')
  const [cart, setCart] = useState([]) // [{ productId, name, unit, unitPrice, unitCost, qty, stock }]
  const [payMethod, setPayMethod] = useState(PAYMENT_METHODS.CASH)
  const [payCurrency, setPayCurrency] = useState(baseCurrency)
  const [paid, setPaid] = useState('')
  // Moneda en que se entrega el vuelto (Bloque G+): por defecto la base (MN).
  // Solo se ofrece elegir cuando se cobra en una divisa.
  const [changeCurrency, setChangeCurrency] = useState(baseCurrency)
  // transferencia
  const [transferCurrency, setTransferCurrency] = useState('MN')
  const [transferRef, setTransferRef] = useState('')
  const [sms, setSms] = useState('')
  const [transferAmount, setTransferAmount] = useState('')
  // Pago mixto (Bloque H): partes ya agregadas + editor de la parte en curso.
  const [mixParts, setMixParts] = useState([]) // [{ method, currency, amount, reference }]
  const [partMethod, setPartMethod] = useState(PAYMENT_METHODS.CASH)
  const [partCurrency, setPartCurrency] = useState(baseCurrency)
  const [partAmount, setPartAmount] = useState('')
  const [partRef, setPartRef] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [lastSale, setLastSale] = useState(null)

  if (!canSell) {
    return (
      <div className="screen">
        <h2>Vender</h2>
        <section className="card">
          <p>Para registrar ventas necesitas tener <strong>tu turno abierto</strong>.</p>
          <p className="muted">
            Solo el vendedor con turno activo puede vender — ni siquiera el dueño sin turno.
          </p>
          <Link className="btn btn--primary btn--block" to="/shift">
            Ir a Turno
          </Link>
        </section>
      </div>
    )
  }

  // Existencia disponible para ESTE vendedor: la de su área (Bloque 20). Sin
  // áreas configuradas, se vende contra el almacén (comportamiento clásico).
  const sellArea = activeShift?.area || ''
  // Bloque A: el vendedor con área puede alternar el ORIGEN de la mercancía
  // (su área / almacén central) si la licencia trae el módulo y el dueño lo
  // permitió en Ajustes. El dinero entra siempre a la caja de SU turno.
  const canPickSource = !!sellArea && !!warehouseAllowed && hasModule(LICENSE_MODULES.WHOLESALE)
  const sellLoc = sellArea && !(canPickSource && fromWarehouse) ? sellArea : WAREHOUSE

  const availAt = (p, loc) =>
    loc === WAREHOUSE
      ? Number(p.stockByLocation?.[WAREHOUSE] ?? p.stock ?? 0)
      : Number(p.stockByLocation?.[loc] || 0)
  const availOf = (p) => availAt(p, sellLoc)

  // Al cambiar el origen se revalida el carrito contra la nueva ubicación (el
  // stock por línea y el bloqueo de cantidades siguen siendo veraces).
  const switchSource = (toWarehouse) => {
    if (toWarehouse === fromWarehouse) return
    setFromWarehouse(toWarehouse)
    const loc = toWarehouse ? WAREHOUSE : sellArea
    setCart((prev) =>
      prev.map((l) => {
        const p = products.find((x) => x.id === l.productId)
        return { ...l, stock: p ? availAt(p, loc) : 0 }
      })
    )
  }

  const results = useMemo(() => {
    if (!query.trim()) return []
    return products
      .filter((p) => matchesQuery(p, query))
      // Con un área (o vendiendo del almacén como vendedor), solo se ofrece lo
      // que tiene existencia en el origen. Sin áreas, todo el catálogo (clásico).
      .filter((p) => (sellArea ? availOf(p) > 0 : true))
      .slice(0, 20)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, query, sellArea, sellLoc])

  const addToCart = (p) => {
    const avail = availOf(p)
    if (avail <= 0) return // sin existencia en el área: no disponible para venta
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
          // Escalas mayoristas (Bloque B): el precio unitario baja solo al
          // alcanzar la cantidad de cada escala. Sin modulo, no aplican.
          tiers: hasModule(LICENSE_MODULES.WHOLESALE) ? normalizeTiers(p.priceTiers) : [],
          area: p.area || '',
          qty: 1,
          stock: avail
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

  // Precio unitario EFECTIVO de una linea: el de la escala mayorista alcanzada
  // por la cantidad, o el precio normal. Este es el que se congela al cobrar.
  const priceOf = (l) => tierPriceFor(l.unitPrice, l.tiers, l.qty)

  const totalBase = useMemo(
    () => round2(cart.reduce((a, l) => a + priceOf(l) * l.qty, 0)),
    [cart]
  )
  // Bloqueo por stock de área (Bloque 20): ninguna línea puede superar lo
  // disponible en el área del turno. Lo que no se ha sacado del almacén no se vende.
  const stockOk = cart.every((l) => Number(l.qty) <= Number(l.stock || 0))
  // --- efectivo ---
  const rate = payCurrency === baseCurrency ? 1 : rateOf(payCurrency)
  const totalInCur =
    payCurrency === baseCurrency ? totalBase : baseToForeign(totalBase, rate)
  const paidNum = Number(paid) || 0
  // Valor recibido convertido a MN de forma EXACTA (recibido x tasa). No se
  // redondea el total a la divisa antes de restar -> el vuelto en MN sale
  // exacto (ej: 10 USD x 650 - 1500 MN = 5000 MN, no 4998.5).
  const paidBase = payCurrency === baseCurrency ? paidNum : foreignToBase(paidNum, rate)
  const changeBase = round2(paidBase - totalBase) // vuelto en MN (exacto)
  const changeInPay = round2(paidNum - totalInCur) // vuelto en la moneda del cobro
  // Moneda efectiva del vuelto: si se cobra en MN, siempre MN; si se cobra en
  // divisa, la que eligio el vendedor (MN por defecto o la propia divisa).
  const effChangeCur = payCurrency === baseCurrency ? baseCurrency : changeCurrency
  const changeGiven = effChangeCur === payCurrency ? changeInPay : changeBase

  // --- transferencia ---
  const transferRate = transferCurrency === baseCurrency ? 1 : rateOf(transferCurrency)
  const totalTransfer =
    transferCurrency === baseCurrency ? totalBase : baseToForeign(totalBase, transferRate)
  const transferNum = transferAmount === '' ? totalTransfer : Number(transferAmount) || 0
  // Diferencia entre lo recibido por transferencia y lo que se debe cobrar.
  const transferDiff = round2(transferNum - totalTransfer)
  const transferMismatch = payMethod === PAYMENT_METHODS.TRANSFER && Math.abs(transferDiff) >= 0.01

  const isCash = payMethod === PAYMENT_METHODS.CASH
  const isMixed = payMethod === PAYMENT_METHODS.MIXED

  // --- pago mixto (Bloque H): se cobra en partes con montos EXACTOS ---
  const canMixed = hasModule(LICENSE_MODULES.WHOLESALE)
  const partRate = (cur) => (cur === baseCurrency ? 1 : rateOf(cur) || 0)
  const partBase = (p) => round2((Number(p.amount) || 0) * partRate(p.currency))
  const mixCovered = round2(mixParts.reduce((a, p) => a + partBase(p), 0))
  const mixRemaining = round2(totalBase - mixCovered)
  // Sobrepago en mixto (ej: una parte en USD que redondea por encima, o el
  // cliente entrega de mas): el exceso es el vuelto, que se devuelve en MN.
  const mixChange = round2(Math.max(0, mixCovered - totalBase))
  const mixOk =
    mixParts.length > 0 &&
    mixCovered >= totalBase - 0.01 &&
    mixParts.every((p) => (Number(p.amount) || 0) > 0 && partRate(p.currency) > 0)

  const addMixPart = () => {
    const amt = Number(partAmount) || 0
    if (amt <= 0 || partRate(partCurrency) <= 0) return
    setMixParts((prev) => [
      ...prev,
      { method: partMethod, currency: partCurrency, amount: round2(amt), reference: partRef.trim() }
    ])
    setPartAmount('')
    setPartRef('')
  }
  // Rellena la parte en curso con lo que falta por cobrar, en su moneda.
  const fillRemaining = () => {
    const r = partRate(partCurrency)
    if (r <= 0 || mixRemaining <= 0) return
    setPartAmount(String(round2(mixRemaining / r)))
  }

  const canCharge =
    cart.length > 0 &&
    stockOk &&
    (isMixed
      ? mixOk
      : isCash
        ? paidBase >= totalBase - 0.01 && (payCurrency === baseCurrency || rate > 0)
        : transferNum > 0 && (transferCurrency === baseCurrency || transferRate > 0))

  // Al pegar el SMS, autocompleta monto y referencia.
  const onSmsChange = (text) => {
    setSms(text)
    const { amount, reference } = parseSms(text)
    if (reference) setTransferRef(reference)
    if (amount != null) setTransferAmount(String(amount))
  }

  const resetCheckout = () => {
    setCart([])
    setPaid('')
    setChangeCurrency(baseCurrency)
    setPayMethod(PAYMENT_METHODS.CASH)
    setPayCurrency(baseCurrency)
    setTransferCurrency('MN')
    setTransferRef('')
    setSms('')
    setTransferAmount('')
    setMixParts([])
    setPartMethod(PAYMENT_METHODS.CASH)
    setPartCurrency(baseCurrency)
    setPartAmount('')
    setPartRef('')
  }

  const charge = async () => {
    setConfirming(true)
    const items = cart.map((l) => {
      const unitPrice = priceOf(l) // congela el precio de escala si aplico
      const tier = tierFor(l.tiers, l.qty)
      return {
        productId: l.productId,
        name: l.name,
        unit: l.unit,
        qty: l.qty,
        unitPrice,
        // Si aplico una escala, se deja constancia del precio normal y del
        // umbral (auditable en la propia venta, sin tocar el historial).
        ...(tier ? { basePrice: l.unitPrice, tierMinQty: tier.minQty } : {}),
        unitCost: l.unitCost,
        area: l.area || '',
        lineTotal: round2(unitPrice * l.qty)
      }
    })
    if (isMixed) {
      // Pago mixto: cada parte con su tasa congelada y su equivalente en base.
      await salesRepo.create({
        shiftId: activeShift.id,
        sellerId: user.id,
        area: activeShift.area || '',
        items,
        totalBase,
        paymentMethod: PAYMENT_METHODS.MIXED,
        payments: mixParts.map((p) => {
          const r = partRate(p.currency)
          return {
            method: p.method,
            currency: p.currency,
            amount: round2(Number(p.amount) || 0),
            rate: p.currency === baseCurrency ? null : r,
            amountBase: partBase(p),
            reference: p.method === PAYMENT_METHODS.TRANSFER ? p.reference || '' : ''
          }
        }),
        change: mixChange, // vuelto por sobrepago (en MN)
        changeCurrency: baseCurrency,
        sourceLocation: sellLoc,
        creditAccounts: hasModule(LICENSE_MODULES.ACCOUNTS)
      })
      setLastSale({ method: 'mixed', parts: mixParts.length })
    } else if (isCash) {
      await salesRepo.create({
        shiftId: activeShift.id,
        sellerId: user.id,
        area: activeShift.area || '',
        items,
        totalBase,
        paymentMethod: PAYMENT_METHODS.CASH,
        paymentCurrency: payCurrency,
        cashAmount: round2(totalInCur),
        amountPaid: paidNum,
        change: changeGiven,
        changeCurrency: effChangeCur,
        changeRate: effChangeCur === baseCurrency ? null : (rateOf(effChangeCur) || null),
        rate: payCurrency === baseCurrency ? null : rate,
        sourceLocation: sellLoc,
        creditAccounts: hasModule(LICENSE_MODULES.ACCOUNTS)
      })
      setLastSale({ method: 'cash', change: changeGiven, payCurrency: effChangeCur })
    } else {
      await salesRepo.create({
        shiftId: activeShift.id,
        sellerId: user.id,
        area: activeShift.area || '',
        items,
        totalBase,
        paymentMethod: PAYMENT_METHODS.TRANSFER,
        transferCurrency,
        transferAmount: round2(transferNum),
        transferReference: transferRef,
        transferSms: sms,
        transferExpected: round2(totalTransfer),
        rate: transferCurrency === baseCurrency ? null : transferRate,
        sourceLocation: sellLoc,
        creditAccounts: hasModule(LICENSE_MODULES.ACCOUNTS)
      })
      setLastSale({ method: 'transfer', transferCurrency, transferRef })
    }
    resetCheckout()
    setConfirming(false)
  }

  return (
    <div className="screen">
      <div className="pos-nav">
        <button className="pos-nav__back" onClick={() => navigate(-1)} aria-label="Volver">
          <ChevronLeft size={20} strokeWidth={2} />
        </button>
        <h2 className="pos-nav__title">Vender</h2>
        <Link className="pos-nav__action" to="/shift">Turno</Link>
      </div>

      {canPickSource && (
        <div className="tabs">
          <button
            className={`tab ${!fromWarehouse ? 'is-active' : ''}`}
            onClick={() => switchSource(false)}
          >
            Mi área ({sellArea})
          </button>
          <button
            className={`tab ${fromWarehouse ? 'is-active' : ''}`}
            onClick={() => switchSource(true)}
          >
            🏬 Almacén central
          </button>
        </div>
      )}

      {areas.length > 0 && (
        <p className="muted" style={{ margin: '0 0 8px' }}>
          Vendiendo desde:{' '}
          <strong>{sellLoc === WAREHOUSE ? '🏬 Almacén central' : `Área ${sellArea}`}</strong>
          {sellLoc !== WAREHOUSE
            ? ' · solo los productos asignados a tu área.'
            : sellArea
              ? ' · venta mayorista: rebaja del almacén y cobra en tu caja.'
              : ' · todo el inventario del almacén.'}
        </p>
      )}

      {lastSale && (
        <div className="sale-done" onClick={() => setLastSale(null)}>
          {lastSale.method === 'cash'
            ? `✅ Venta cobrada · Cambio: ${formatMoney(lastSale.change, lastSale.payCurrency)}`
            : lastSale.method === 'mixed'
              ? `✅ Venta cobrada · Pago mixto (${lastSale.parts} parte(s))`
              : `✅ Transferencia cobrada · Ref: ${lastSale.transferRef || '—'} (${lastSale.transferCurrency})`}
          <span className="muted"> (toca para cerrar)</span>
        </div>
      )}

      <div className="pos-search">
        <Search size={17} className="pos-search__icon" strokeWidth={2} />
        <input
          className="search-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar producto (3 letras o código)…"
        />
      </div>
      {results.length > 0 && (
        <div className="product-list sell-results">
          {results.map((p) => {
            const avail = availOf(p)
            const out = avail <= 0
            return (
              <button
                key={p.id}
                className="product-row"
                onClick={() => addToCart(p)}
                disabled={out}
              >
                <div className="product-row__main">
                  <strong>{p.name}</strong>
                  <span className="muted">
                    {p.code ? `${p.code} · ` : ''}
                    {out
                      ? <span className="badge-out">{sellLoc === WAREHOUSE ? 'Agotado' : 'Sin stock en tu área'}</span>
                      : `${avail} ${p.unit}`}
                  </span>
                </div>
                <span className="price">{formatMoney(p.price, baseCurrency)}</span>
              </button>
            )
          })}
        </div>
      )}

      <section className="card">
        <h3>Carrito</h3>
        {cart.length === 0 ? (
          <p className="muted">Busca y toca un producto para agregarlo.</p>
        ) : (
          <div className="cart">
            {cart.map((l) => {
              const effPrice = priceOf(l)
              const tierApplied = effPrice !== l.unitPrice
              return (
              <div key={l.productId} className="cart-line">
                <span className="cart-line__tile"><Package size={19} strokeWidth={1.9} /></span>
                <div className="cart-line__info">
                  <strong>{l.name}</strong>
                  <span className="muted">
                    {formatMoney(effPrice, baseCurrency)} × {l.qty} {l.unit}
                    {tierApplied && (
                      <span className="ok-text"> · mayorista (normal {formatMoney(l.unitPrice, baseCurrency)})</span>
                    )}
                    {l.qty > l.stock && (
                      <span className="warn-text">
                        {' '}· solo hay {l.stock} {sellLoc === WAREHOUSE ? 'en el almacén' : 'en tu área'}
                      </span>
                    )}
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
                <span className="cart-line__total">{formatMoney(effPrice * l.qty, baseCurrency)}</span>
                <button
                  className="cart-line__remove"
                  onClick={() => setQty(l.productId, 0)}
                  aria-label="Eliminar producto"
                  title="Quitar del carrito"
                >
                  <Trash2 size={18} strokeWidth={1.8} />
                </button>
              </div>
              )
            })}
          </div>
        )}
      </section>

      {cart.length > 0 && (
        <section className="card">
          <div className="total-row">
            <span>Total</span>
            <strong className="total-amount">{formatMoney(totalBase, baseCurrency)}</strong>
          </div>

          <div className="tabs">
            <button
              className={`tab ${isCash ? 'is-active' : ''}`}
              onClick={() => setPayMethod(PAYMENT_METHODS.CASH)}
            >
              Efectivo
            </button>
            <button
              className={`tab ${payMethod === PAYMENT_METHODS.TRANSFER ? 'is-active' : ''}`}
              onClick={() => setPayMethod(PAYMENT_METHODS.TRANSFER)}
            >
              Transferencia
            </button>
            {canMixed && (
              <button
                className={`tab ${isMixed ? 'is-active' : ''}`}
                onClick={() => setPayMethod(PAYMENT_METHODS.MIXED)}
              >
                Mixto
              </button>
            )}
          </div>

          {isMixed ? (
            <>
              <p className="muted">
                Cobra la venta en varias partes (efectivo y/o transferencia, en distintas
                monedas). Los montos son exactos: usa <strong>Completar</strong> para la última parte.
              </p>

              {mixParts.length > 0 && (
                <div className="list">
                  {mixParts.map((p, i) => (
                    <div key={i} className="kv">
                      <span className="muted">
                        {p.method === PAYMENT_METHODS.TRANSFER ? 'Transferencia' : 'Efectivo'} {p.currency}
                        {p.reference ? ` · ref ${p.reference}` : ''}
                      </span>
                      <strong>
                        {formatMoney(Number(p.amount) || 0, p.currency)}
                        {p.currency !== baseCurrency && ` (= ${formatMoney(partBase(p), baseCurrency)})`}
                        <button
                          className="link-del"
                          onClick={() => setMixParts((prev) => prev.filter((_, j) => j !== i))}
                        >
                          quitar
                        </button>
                      </strong>
                    </div>
                  ))}
                </div>
              )}

              <div className="total-row">
                <span>{mixRemaining > 0.01 ? 'Falta por cobrar' : mixChange > 0.01 ? 'Vuelto (MN)' : 'Cubierto'}</span>
                <strong className="total-amount">
                  {mixRemaining > 0.01
                    ? formatMoney(mixRemaining, baseCurrency)
                    : mixChange > 0.01
                      ? formatMoney(mixChange, baseCurrency)
                      : '✓'}
                </strong>
              </div>

              {mixRemaining > 0.01 && (
                <>
                  <div className="tabs">
                    <button
                      className={`tab ${partMethod === PAYMENT_METHODS.CASH ? 'is-active' : ''}`}
                      onClick={() => { setPartMethod(PAYMENT_METHODS.CASH); setPartCurrency(baseCurrency) }}
                    >
                      Efectivo
                    </button>
                    <button
                      className={`tab ${partMethod === PAYMENT_METHODS.TRANSFER ? 'is-active' : ''}`}
                      onClick={() => { setPartMethod(PAYMENT_METHODS.TRANSFER); setPartCurrency('MN') }}
                    >
                      Transferencia
                    </button>
                  </div>
                  <div className="pay-currencies">
                    {(partMethod === PAYMENT_METHODS.CASH ? CASH_CURRENCIES : TRANSFER_CURRENCIES).map((c) => (
                      <button
                        key={c}
                        className={`btn btn--sm ${partCurrency === c ? 'btn--primary' : 'btn--ghost'}`}
                        onClick={() => setPartCurrency(c)}
                        disabled={c !== baseCurrency && !rateOf(c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  <div className="form-row">
                    <label className="field">
                      <span>Monto ({partCurrency})</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={partAmount}
                        onChange={(e) => setPartAmount(e.target.value)}
                        placeholder="0"
                      />
                    </label>
                    {partMethod === PAYMENT_METHODS.TRANSFER && (
                      <label className="field">
                        <span>Referencia</span>
                        <input
                          value={partRef}
                          onChange={(e) => setPartRef(e.target.value)}
                          placeholder="No. de operación"
                        />
                      </label>
                    )}
                  </div>
                  {partCurrency !== baseCurrency && Number(partAmount) > 0 && partRate(partCurrency) > 0 && (
                    <p className="muted">
                      Equivale a <strong>{formatMoney(round2(Number(partAmount) * partRate(partCurrency)), baseCurrency)}</strong> (tasa {partRate(partCurrency)}).
                    </p>
                  )}
                  <div className="report-actions">
                    <button className="btn" onClick={fillRemaining} disabled={mixRemaining <= 0.01 || partRate(partCurrency) <= 0}>
                      Completar
                    </button>
                    <button className="btn btn--primary" onClick={addMixPart} disabled={!(Number(partAmount) > 0)}>
                      Agregar pago
                    </button>
                  </div>
                </>
              )}
              <p className="muted">Las partes de efectivo entran a la caja por su moneda; las transferencias van aparte. Todo cuadra al cierre.</p>
            </>
          ) : isCash ? (
            <>
              <div className="pay-currencies">
                {CASH_CURRENCIES.map((c) => (
                  <button
                    key={c}
                    className={`btn btn--sm ${payCurrency === c ? 'btn--primary' : 'btn--ghost'}`}
                    onClick={() => { setPayCurrency(c); setChangeCurrency(baseCurrency) }}
                    disabled={c !== baseCurrency && !rateOf(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>

              {payCurrency !== baseCurrency && (
                <p className="muted">
                  Total en {payCurrency}: <strong>{formatMoney(totalInCur, payCurrency)}</strong>{' '}
                  (tasa {rate}) · equivale a {formatMoney(totalBase, baseCurrency)}
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
                <strong className={`total-amount ${changeGiven < 0 ? 'neg' : ''}`}>
                  {formatMoney(changeGiven, effChangeCur)}
                </strong>
              </div>

              {/* Vuelto al cobrar en divisa: se muestra en AMBAS monedas (el MN
                  se calcula exacto desde lo recibido, no desde el vuelto en
                  divisa) y el vendedor elige en cual entregarlo. Esa eleccion
                  determina de que caja sale el vuelto para el cuadre. */}
              {payCurrency !== baseCurrency && changeBase >= 0 && rate > 0 && (
                <>
                  <p className="muted">
                    Vuelto: <strong>{formatMoney(changeBase, baseCurrency)}</strong> ó{' '}
                    <strong>{formatMoney(changeInPay, payCurrency)}</strong> (tasa {rate}).
                  </p>
                  <div className="pay-currencies">
                    <span className="muted" style={{ alignSelf: 'center', marginRight: 4 }}>Entregar vuelto en:</span>
                    <button
                      className={`btn btn--sm ${effChangeCur === baseCurrency ? 'btn--primary' : 'btn--ghost'}`}
                      onClick={() => setChangeCurrency(baseCurrency)}
                    >
                      {baseCurrency}
                    </button>
                    <button
                      className={`btn btn--sm ${effChangeCur === payCurrency ? 'btn--primary' : 'btn--ghost'}`}
                      onClick={() => setChangeCurrency(payCurrency)}
                    >
                      {payCurrency}
                    </button>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div className="pay-currencies">
                {TRANSFER_CURRENCIES.map((c) => (
                  <button
                    key={c}
                    className={`btn btn--sm ${transferCurrency === c ? 'btn--primary' : 'btn--ghost'}`}
                    onClick={() => setTransferCurrency(c)}
                    disabled={c !== baseCurrency && !rateOf(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>

              <p className="muted">
                A cobrar: <strong>{formatMoney(totalTransfer, transferCurrency)}</strong>
                {transferCurrency !== baseCurrency && ` (tasa ${transferRate})`}
              </p>

              {transferMismatch && (
                <div className={`transfer-warn ${transferDiff < 0 ? 'transfer-warn--neg' : 'transfer-warn--pos'}`}>
                  ⚠️ El monto recibido <strong>{formatMoney(transferNum, transferCurrency)}</strong> no coincide
                  con lo que debes cobrar <strong>{formatMoney(totalTransfer, transferCurrency)}</strong>.
                  <br />
                  Diferencia: <strong>{formatMoney(transferDiff, transferCurrency)}</strong>
                  {transferDiff < 0 ? ' (falta)' : ' (de más)'}. Quedará registrada para el dueño.
                </div>
              )}

              <label className="field">
                <span>Pega el SMS de confirmación</span>
                <textarea
                  rows={3}
                  value={sms}
                  onChange={(e) => onSmsChange(e.target.value)}
                  placeholder="Pega aquí el mensaje del banco…"
                />
              </label>

              <div className="form-row">
                <label className="field">
                  <span>Monto recibido ({transferCurrency})</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                    placeholder={String(totalTransfer)}
                  />
                </label>
                <label className="field">
                  <span>Referencia</span>
                  <input
                    value={transferRef}
                    onChange={(e) => setTransferRef(e.target.value)}
                    placeholder="No. de operación"
                  />
                </label>
              </div>
              <p className="muted">La transferencia no entra a la caja de efectivo.</p>
            </>
          )}

          {!stockOk && (
            <p className="error">
              {sellLoc === WAREHOUSE
                ? 'Hay productos por encima de la existencia del almacén. Ajusta las cantidades.'
                : 'Hay productos por encima de la existencia de tu área. Ajusta la cantidad o pide una salida del almacén.'}
            </p>
          )}

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
