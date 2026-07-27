import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { ordersRepo } from '../../repositories/ordersRepo'
import { productsRepo } from '../../repositories/productsRepo'
import { salesRepo } from '../../repositories/salesRepo'
import { configRepo } from '../../repositories/configRepo'
import { usersRepo } from '../../repositories/usersRepo'
import { categoriesRepo } from '../../repositories/categoriesRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { useSync } from '../../app/providers/SyncProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { formatMoney, round2 } from '../../lib/currency'
import { matchesQuery } from '../../lib/search'
import { CASH_CURRENCIES, TRANSFER_CURRENCIES, PAYMENT_METHODS, ORDER_STATUS } from '../../db/constants'
import { Trash2 } from 'lucide-react'
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
  const categories = useLiveQuery(() => categoriesRepo.list(), [], [])
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
  const [cat, setCat] = useState('') // filtro de categoria (vacio = todas)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [paying, setPaying] = useState(false)
  const [waived, setWaived] = useState(false) // servicio eximido (requiere mando)
  const [askWaive, setAskWaive] = useState(false)
  const [done, setDone] = useState(null) // resumen del cobro para el ticket
  const [confirmDel, setConfirmDel] = useState(null) // producto a quitar entero

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
  // Se muestran AGRUPADAS por producto: el camarero ve "3 x Hamburguesa" con
  // sus botones - / +, aunque por dentro sean varias lineas append-only.
  const grouped = useMemo(() => {
    const map = new Map()
    for (const i of live) {
      const g = map.get(i.productId) || {
        productId: i.productId, name: i.name, unit: i.unit,
        unitPrice: i.unitPrice, qty: 0, total: 0
      }
      g.qty += Number(i.qty || 0)
      g.total += Number(i.lineTotal || 0)
      map.set(i.productId, g)
    }
    return [...map.values()]
  }, [live])
  // Cuantas unidades de un producto lleva ya la cuenta (badge en el mosaico).
  const inOrder = (pid) => grouped.find((g) => g.productId === pid)?.qty || 0
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
      if (cat && p.categoryId !== cat) return false
      return !q.trim() || matchesQuery(p, q)
    })
  // Solo las categorias que tienen algo disponible en el area.
  const usedCats = categories.filter((c) =>
    products.some((p) => p.categoryId === c.id && stockOf(p) > 0))

  // UN TOQUE = una unidad. Es la accion mas repetida del servicio: nada de
  // teclado ni pasos intermedios.
  const addOne = async (p) => {
    setError('')
    try {
      await ordersRepo.addItem({ orderId: id, product: p, qty: 1, userId: user.id, shiftId: order.shiftId })
    } catch (e) {
      setError(e.message)
    }
  }

  const removeOne = async (productId) => {
    setError('')
    try {
      await ordersRepo.decrementOne({ orderId: id, productId, userId: user.id })
    } catch (e) {
      setError(e.message)
    }
  }

  // Quitar el producto ENTERO de la cuenta (papelera), sin restar de uno en uno.
  const removeProduct = async (productId) => {
    setError('')
    try {
      await ordersRepo.removeProduct({ orderId: id, productId, userId: user.id })
      setConfirmDel(null)
    } catch (e) {
      setError(e.message)
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
    <div className={`screen ${!paying && live.length > 0 ? 'screen--paybar' : ''}`}>
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
        {grouped.map((g) => (
          <div key={g.productId} className="order-line">
            <div className="order-line__info">
              <span className="order-line__name">{g.name}</span>
              <span className="order-line__sub">{formatMoney(g.unitPrice, baseCurrency)} c/u</span>
            </div>
            <div className="stepper">
              <button className="stepper__btn" onClick={() => removeOne(g.productId)} aria-label="Quitar uno">−</button>
              <span className="stepper__qty">{g.qty}</span>
              <button className="stepper__btn" onClick={() => addOne({ id: g.productId, name: g.name, unit: g.unit, price: g.unitPrice })} aria-label="Agregar uno">+</button>
            </div>
            <span className="order-line__total">{formatMoney(g.total, baseCurrency)}</span>
            <button
              className="order-line__del"
              onClick={() => setConfirmDel(g)}
              aria-label={`Quitar ${g.name} de la cuenta`}
              title="Quitar de la cuenta"
            >
              <Trash2 size={16} strokeWidth={2} />
            </button>
          </div>
        ))}

        <div className="total-row"><span>Subtotal</span><strong>{formatMoney(subtotal, baseCurrency)}</strong></div>
        {Number(servicePct) > 0 && (
          <div className="total-row">
            <span>Servicio {pct}%{waived && <span className="muted"> · eximido</span>}</span>
            <span className="order-line__right">
              <strong>{formatMoney(service, baseCurrency)}</strong>
              {!waived && (
                <button className="btn btn--ghost btn--sm" onClick={() => setAskWaive(true)}>Eximir</button>
              )}
            </span>
          </div>
        )}
        <div className="total-row total-row--grand"><strong>TOTAL</strong><strong className="price">{formatMoney(total, baseCurrency)}</strong></div>

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

      {/* Carta: UN TOQUE agrega una unidad. Sin teclado, sin pasos intermedios. */}
      {!paying && (
        <section className="card">
          <div className="salon-area-head">
            <h3>Carta</h3>
            <span className="muted">toca para agregar</span>
          </div>

          {usedCats.length > 1 && (
            <div className="chip-row">
              <button className={`chip-btn ${!cat ? 'is-active' : ''}`} onClick={() => setCat('')}>Todo</button>
              {usedCats.map((c) => (
                <button
                  key={c.id}
                  className={`chip-btn ${cat === c.id ? 'is-active' : ''}`}
                  onClick={() => setCat(c.id)}
                >{c.name}</button>
              ))}
            </div>
          )}

          <input
            className="menu-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar…"
          />

          {filtered.length === 0 && <p className="muted">Sin productos con existencia en {order.area}.</p>}

          <div className="menu-grid">
            {filtered.map((p) => {
              const n = inOrder(p.id)
              const left = stockOf(p)
              return (
                <button key={p.id} className="menu-tile" onClick={() => addOne(p)}>
                  {n > 0 && <span className="menu-tile__badge">{n}</span>}
                  <span className="menu-tile__name">{p.name}</span>
                  <span className="menu-tile__price">{formatMoney(p.price, baseCurrency)}</span>
                  <span className={`menu-tile__stock ${left <= 3 ? 'is-low' : ''}`}>{left} {p.unit}</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* Barra fija: el total y el cobro siempre a la vista */}
      {!paying && live.length > 0 && (
        <div className="pay-bar">
          <div className="pay-bar__info">
            <span className="pay-bar__lbl">TOTAL</span>
            <strong className="pay-bar__amount">{formatMoney(total, baseCurrency)}</strong>
          </div>
          <button className="btn btn--primary" onClick={() => setPaying(true)}>Cobrar</button>
        </div>
      )}

      {/* Quitar un producto entero de la cuenta */}
      {confirmDel && (
        <div className="modal-backdrop" onClick={() => setConfirmDel(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>¿Quitar de la cuenta?</h3>
            <p className="muted">
              Se retiran las <strong>{confirmDel.qty}</strong> unidad(es) de{' '}
              <strong>{confirmDel.name}</strong> y vuelven al inventario del área.
            </p>
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setConfirmDel(null)}>Cancelar</button>
              <button className="btn btn--primary" onClick={() => removeProduct(confirmDel.productId)}>
                Sí, quitar
              </button>
            </div>
          </div>
        </div>
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
