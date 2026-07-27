import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { ordersRepo } from '../../repositories/ordersRepo'
import { productsRepo } from '../../repositories/productsRepo'
import { salesRepo } from '../../repositories/salesRepo'
import { configRepo } from '../../repositories/configRepo'
import { usersRepo } from '../../repositories/usersRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { useSync } from '../../app/providers/SyncProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { formatMoney, round2 } from '../../lib/currency'
import { matchesQuery } from '../../lib/search'
import { CASH_CURRENCIES, TRANSFER_CURRENCIES, PAYMENT_METHODS, ORDER_STATUS } from '../../db/constants'
import { OwnerAuthModal } from '../../components/OwnerAuthModal'

// ---------------------------------------------------------------------------
// Cuenta de UNA mesa (modulo 'mesas').
//
//  - Agregar consumo REBAJA el stock del area en el acto (ordersRepo.addItem
//    valida existencia): no se puede prometer al cliente lo que no hay.
//  - Quitar una linea no la borra: la anula y devuelve el stock.
//  - Al cobrar se crea la VENTA por el camino normal (salesRepo.create) con
//    skipStock: el inventario ya se movio al agregar. Asi el cobro, el cuadre y
//    los reportes funcionan exactamente igual que en la venta directa.
//  - Una mesa SIEMPRE consume del AREA: aqui no existe el almacen central.
// ---------------------------------------------------------------------------
export function TableScreen() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, isManager } = useAuth()
  const { hasModule } = useLicense()
  const { baseCurrency, rateOf, toBase } = useCurrency()
  const { nudgePush } = useSync()

  const order = useLiveQuery(() => ordersRepo.get(id), [id], undefined)
  const items = useLiveQuery(() => ordersRepo.items(id), [id], [])
  const products = useLiveQuery(() => productsRepo.listActive(), [], [])
  const users = useLiveQuery(() => usersRepo.list(), [], [])
  // Venta asociada (si ya se cobro): de ahi salen los totales del ticket al
  // volver a abrir una mesa cerrada. Los totales viven en la VENTA, no en el pedido.
  const sale = useLiveQuery(
    () => (order?.saleId ? db.sales.get(order.saleId) : null),
    [order?.saleId],
    null
  )
  const servicePct = useLiveQuery(
    () => (order?.area ? configRepo.getServiceChargeFor(order.area) : 0),
    [order?.area],
    0
  )

  const [q, setQ] = useState('')
  const [qty, setQty] = useState({}) // cantidad por producto
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [paying, setPaying] = useState(false)
  const [waived, setWaived] = useState(false) // servicio eximido (requiere mando)
  const [askWaive, setAskWaive] = useState(false)
  const [done, setDone] = useState(null) // resumen del cobro para el ticket

  // --- cobro ---
  const [payMethod, setPayMethod] = useState(PAYMENT_METHODS.CASH)
  const [cashCurrency, setCashCurrency] = useState(baseCurrency)
  const [received, setReceived] = useState('')
  const [transferCurrency, setTransferCurrency] = useState('MN')
  const [transferRef, setTransferRef] = useState('')
  const [mixParts, setMixParts] = useState([])
  const [partMethod, setPartMethod] = useState(PAYMENT_METHODS.CASH)
  const [partCurrency, setPartCurrency] = useState(baseCurrency)
  const [partAmount, setPartAmount] = useState('')
  const [partRef, setPartRef] = useState('')

  const live = useMemo(() => items.filter((i) => !i.voided), [items])
  const subtotal = useMemo(
    () => round2(live.reduce((a, i) => a + Number(i.lineTotal || 0), 0)),
    [live]
  )
  const pct = waived ? 0 : Number(servicePct) || 0
  const service = round2(subtotal * (pct / 100))
  const total = round2(subtotal + service)

  if (!hasModule(LICENSE_MODULES.TABLES)) {
    return <div className="screen"><p className="muted">Este módulo no está incluido en tu licencia.</p></div>
  }
  if (order === undefined) return <div className="screen"><p className="muted">Cargando…</p></div>
  if (!order) return <div className="screen"><p className="muted">La cuenta no existe.</p></div>

  const closed = order.status !== ORDER_STATUS.OPEN
  const userName = (uid) => users.find((u) => u.id === uid)?.name || '—'

  // Catalogo del AREA de la mesa, con su existencia real por ubicacion.
  const stockOf = (p) => Number(p.stockByLocation?.[order.area] ?? 0)
  const filtered = products
    .filter((p) => {
      if (stockOf(p) <= 0) return false
      return !q.trim() || matchesQuery(p, q)
    })
    .slice(0, 40)

  const add = async (p) => {
    setError('')
    const n = Number(qty[p.id] || 1)
    setBusy(true)
    try {
      await ordersRepo.addItem({ orderId: id, product: p, qty: n, userId: user.id, shiftId: order.shiftId })
      setQty((s) => ({ ...s, [p.id]: '' }))
      setQ('')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const removeLine = async (itemId) => {
    setError('')
    setBusy(true)
    try {
      await ordersRepo.voidItem({ itemId, userId: user.id })
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  // --- pago mixto: partes con importe exacto ---
  // Va INCLUIDO en el modulo 'mesas' (no depende de mayorista).
  const mixedBase = round2(mixParts.reduce((a, p) => a + Number(p.amountBase || 0), 0))
  const mixedLeft = round2(total - mixedBase)
  const addPart = () => {
    const amt = Number(partAmount)
    if (!(amt > 0)) return
    const rate = partCurrency === baseCurrency ? 1 : rateOf(partCurrency)
    if (partCurrency !== baseCurrency && !(rate > 0)) {
      return setError(`Sin tasa de cambio para ${partCurrency}`)
    }
    setMixParts((prev) => [...prev, {
      method: partMethod,
      currency: partCurrency,
      amount: round2(amt),
      rate,
      amountBase: round2(toBase(amt, partCurrency)),
      reference: partMethod === PAYMENT_METHODS.TRANSFER ? partRef.trim() : ''
    }])
    setPartAmount('')
    setPartRef('')
    setError('')
  }

  // Importes del cobro en efectivo (con vuelto).
  const cashRate = cashCurrency === baseCurrency ? 1 : rateOf(cashCurrency)
  const dueInCash = cashCurrency === baseCurrency
    ? total
    : (cashRate > 0 ? round2(total / cashRate) : 0)
  const paid = Number(received) || 0
  const changeForeign = round2(Math.max(0, paid - dueInCash))

  const canPay =
    total > 0 &&
    (payMethod === PAYMENT_METHODS.CASH
      ? paid >= dueInCash && dueInCash > 0
      : payMethod === PAYMENT_METHODS.TRANSFER
        ? true
        : Math.abs(mixedLeft) < 0.01)

  const charge = async () => {
    setError('')
    if (!live.length) return setError('La cuenta está vacía')
    setBusy(true)
    try {
      const saleItems = live.map((i) => ({
        productId: i.productId,
        name: i.name,
        unit: i.unit,
        qty: i.qty,
        unitPrice: i.unitPrice,
        unitCost: i.unitCost,
        lineTotal: i.lineTotal,
        area: i.area
      }))
      const common = {
        shiftId: order.shiftId,
        sellerId: order.openedBy,
        area: order.area,
        items: saleItems,
        totalBase: total,
        sourceLocation: order.area,
        // El stock ya se movio al agregar cada item: no rebajar otra vez.
        skipStock: true,
        orderId: order.id,
        table: order.table,
        subtotal,
        serviceChargePct: pct,
        serviceChargeAmount: service,
        serviceWaivedBy: waived ? user.id : null
      }
      let payload
      if (payMethod === PAYMENT_METHODS.MIXED) {
        payload = { ...common, paymentMethod: PAYMENT_METHODS.MIXED, payments: mixParts }
      } else if (payMethod === PAYMENT_METHODS.CASH) {
        payload = {
          ...common,
          paymentMethod: PAYMENT_METHODS.CASH,
          paymentCurrency: cashCurrency,
          cashAmount: round2(dueInCash),
          amountPaid: round2(paid),
          change: changeForeign,
          changeCurrency: cashCurrency,
          changeRate: cashRate,
          rate: cashRate
        }
      } else {
        payload = {
          ...common,
          paymentMethod: PAYMENT_METHODS.TRANSFER,
          transferCurrency,
          transferAmount: round2(
            transferCurrency === baseCurrency ? total : (rateOf(transferCurrency) > 0 ? total / rateOf(transferCurrency) : 0)
          ),
          transferReference: transferRef.trim(),
          transferExpected: round2(
            transferCurrency === baseCurrency ? total : (rateOf(transferCurrency) > 0 ? total / rateOf(transferCurrency) : 0)
          )
        }
      }
      const saleId = await salesRepo.create(payload)
      await ordersRepo.markClosed({ orderId: order.id, saleId, userId: user.id })
      setDone({ subtotal, service, pct, total, method: payMethod })
      setPaying(false)
      if (nudgePush) nudgePush()
    } catch (e) {
      setError('No se pudo cobrar: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  // Ticket (comprobante). La impresion a hardware llega en una fase posterior;
  // por ahora se ve en pantalla y se puede imprimir con el dialogo del sistema.
  if (done || closed) {
    const d = done || {
      subtotal: Number(sale?.subtotal ?? 0),
      service: Number(sale?.serviceChargeAmount ?? 0),
      pct: Number(sale?.serviceChargePct ?? 0),
      total: Number(sale?.totalBase ?? 0)
    }
    return (
      <div className="screen">
        <button className="link-back" onClick={() => navigate('/salon')}>← Volver al salón</button>
        <div className="card ticket">
          <h3 style={{ textAlign: 'center' }}>Comprobante</h3>
          <p className="muted" style={{ textAlign: 'center' }}>
            {order.area} · {order.table}<br />
            {new Date(order.closedAt || Date.now()).toLocaleString()}<br />
            Atendió: {userName(order.openedBy)}
          </p>
          <div className="ticket__lines">
            {live.map((i) => (
              <div key={i.id} className="ticket__line">
                <span>{i.qty} × {i.name}</span>
                <strong>{formatMoney(i.lineTotal, baseCurrency)}</strong>
              </div>
            ))}
          </div>
          <div className="ticket__line"><span>Subtotal</span><strong>{formatMoney(d.subtotal, baseCurrency)}</strong></div>
          {d.pct > 0 && (
            <div className="ticket__line"><span>Servicio {d.pct}%</span><strong>{formatMoney(d.service, baseCurrency)}</strong></div>
          )}
          <div className="ticket__line ticket__total"><span>TOTAL</span><strong>{formatMoney(d.total, baseCurrency)}</strong></div>
          <button className="btn btn--ghost btn--block" onClick={() => window.print()}>🖨 Imprimir</button>
        </div>
      </div>
    )
  }

  return (
    <div className="screen">
      <button className="link-back" onClick={() => navigate('/salon')}>← Salón</button>
      <div className="screen__header">
        <h2>{order.table}</h2>
        <span className="muted">{order.area} · {userName(order.openedBy)}</span>
      </div>

      {error && <p className="error">{error}</p>}

      {/* Cuenta en curso */}
      <section className="card">
        <h3>Cuenta</h3>
        {live.length === 0 && <p className="muted">Sin consumos todavía.</p>}
        {live.map((i) => (
          <div key={i.id} className="kv">
            <span>{i.qty} × {i.name} <span className="muted">({formatMoney(i.unitPrice, baseCurrency)})</span></span>
            <span>
              <strong>{formatMoney(i.lineTotal, baseCurrency)}</strong>
              <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => removeLine(i.id)}>Quitar</button>
            </span>
          </div>
        ))}
        {items.some((i) => i.voided) && (
          <p className="muted">{items.filter((i) => i.voided).length} línea(s) anulada(s) (se conservan en el historial).</p>
        )}

        <div className="kv"><span>Subtotal</span><strong>{formatMoney(subtotal, baseCurrency)}</strong></div>
        {Number(servicePct) > 0 && (
          <div className="kv">
            <span>
              Servicio {pct}%
            </span>
            <span>
              <strong>{formatMoney(service, baseCurrency)}</strong>
              {!waived && (
                <button className="btn btn--ghost btn--sm" onClick={() => setAskWaive(true)}>Eximir</button>
              )}
              {waived && <span className="muted"> eximido</span>}
            </span>
          </div>
        )}
        <div className="kv"><span><strong>TOTAL</strong></span><strong className="price">{formatMoney(total, baseCurrency)}</strong></div>

        {live.length > 0 && !paying && (
          <button className="btn btn--primary btn--block" onClick={() => setPaying(true)}>Cobrar</button>
        )}
      </section>

      {/* Cobro */}
      {paying && (
        <section className="card">
          <h3>Cobrar {formatMoney(total, baseCurrency)}</h3>
          <div className="tabs">
            <button className={`tab ${payMethod === PAYMENT_METHODS.CASH ? 'is-active' : ''}`} onClick={() => setPayMethod(PAYMENT_METHODS.CASH)}>Efectivo</button>
            <button className={`tab ${payMethod === PAYMENT_METHODS.TRANSFER ? 'is-active' : ''}`} onClick={() => setPayMethod(PAYMENT_METHODS.TRANSFER)}>Transferencia</button>
            <button className={`tab ${payMethod === PAYMENT_METHODS.MIXED ? 'is-active' : ''}`} onClick={() => setPayMethod(PAYMENT_METHODS.MIXED)}>Mixto</button>
          </div>

          {payMethod === PAYMENT_METHODS.CASH && (
            <>
              <label className="field">
                <span>Moneda</span>
                <select value={cashCurrency} onChange={(e) => { setCashCurrency(e.target.value); setReceived('') }}>
                  {CASH_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <p className="muted">A cobrar: <strong>{formatMoney(dueInCash, cashCurrency)}</strong></p>
              <label className="field">
                <span>Recibido</span>
                <input type="number" inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} />
              </label>
              {changeForeign > 0 && <p className="muted">Vuelto: <strong>{formatMoney(changeForeign, cashCurrency)}</strong></p>}
            </>
          )}

          {payMethod === PAYMENT_METHODS.TRANSFER && (
            <>
              <label className="field">
                <span>Moneda</span>
                <select value={transferCurrency} onChange={(e) => setTransferCurrency(e.target.value)}>
                  {TRANSFER_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Referencia / confirmación</span>
                <input value={transferRef} onChange={(e) => setTransferRef(e.target.value)} placeholder="Nº de transacción" />
              </label>
            </>
          )}

          {payMethod === PAYMENT_METHODS.MIXED && (
            <>
              <p className="muted">Cobra en varias partes (efectivo y/o transferencia). Falta por asignar: <strong>{formatMoney(mixedLeft, baseCurrency)}</strong></p>
              {mixParts.map((p, i) => (
                <div key={i} className="kv">
                  <span>{p.method === PAYMENT_METHODS.TRANSFER ? 'Transferencia' : 'Efectivo'} {p.currency}</span>
                  <span>
                    <strong>{formatMoney(p.amount, p.currency)}</strong>
                    <button className="btn btn--ghost btn--sm" onClick={() => setMixParts((prev) => prev.filter((_, j) => j !== i))}>Quitar</button>
                  </span>
                </div>
              ))}
              <div className="form-row">
                <label className="field">
                  <span>Forma</span>
                  <select value={partMethod} onChange={(e) => setPartMethod(e.target.value)}>
                    <option value={PAYMENT_METHODS.CASH}>Efectivo</option>
                    <option value={PAYMENT_METHODS.TRANSFER}>Transferencia</option>
                  </select>
                </label>
                <label className="field">
                  <span>Moneda</span>
                  <select value={partCurrency} onChange={(e) => setPartCurrency(e.target.value)}>
                    {(partMethod === PAYMENT_METHODS.CASH ? CASH_CURRENCIES : TRANSFER_CURRENCIES).map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="field">
                <span>Importe</span>
                <input type="number" inputMode="decimal" value={partAmount} onChange={(e) => setPartAmount(e.target.value)} />
              </label>
              {partMethod === PAYMENT_METHODS.TRANSFER && (
                <label className="field">
                  <span>Referencia</span>
                  <input value={partRef} onChange={(e) => setPartRef(e.target.value)} />
                </label>
              )}
              <button className="btn btn--ghost btn--sm" onClick={addPart}>+ Agregar parte</button>
            </>
          )}

          <div className="modal__actions">
            <button className="btn btn--ghost" onClick={() => setPaying(false)}>Cancelar</button>
            <button className="btn btn--primary" disabled={busy || !canPay} onClick={charge}>
              {busy ? 'Cobrando…' : 'Confirmar cobro'}
            </button>
          </div>
        </section>
      )}

      {/* Agregar consumo (solo mientras no se esta cobrando) */}
      {!paying && (
        <section className="card">
          <h3>Agregar consumo</h3>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar producto del área…"
          />
          {filtered.length === 0 && <p className="muted">Sin productos con existencia en {order.area}.</p>}
          {filtered.map((p) => (
            <div key={p.id} className="kv">
              <span>
                {p.name} <span className="muted">· {formatMoney(p.price, baseCurrency)} · quedan {stockOf(p)} {p.unit}</span>
              </span>
              <span>
                <input
                  type="number"
                  inputMode="decimal"
                  style={{ width: 64 }}
                  value={qty[p.id] ?? ''}
                  placeholder="1"
                  onChange={(e) => setQty((s) => ({ ...s, [p.id]: e.target.value }))}
                />
                <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => add(p)}>Agregar</button>
              </span>
            </div>
          ))}
        </section>
      )}

      {/* Eximir el cargo por servicio: requiere autorizacion de mando. */}
      {askWaive && (
        <OwnerAuthModal
          onCancel={() => setAskWaive(false)}
          onAuthorized={() => { setWaived(true); setAskWaive(false) }}
        />
      )}
    </div>
  )
}
