import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { ordersRepo } from '../../repositories/ordersRepo'
import { productsRepo } from '../../repositories/productsRepo'
import { imagesRepo } from '../../repositories/imagesRepo'
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
  // Encabezado (nombre del negocio) y pie del ticket, configurables en Ajustes.
  const ticketHeader = useLiveQuery(() => configRepo.get('ticketHeader', ''), [], '')
  const ticketFooter = useLiveQuery(() => configRepo.get('ticketFooter', ''), [], '')
  // Fotos de la carta (Fase 8 - B5, módulo 'imagenes' sobre 'mesas'). Un solo
  // mapa refId->dataUrl para pintar sin N consultas. Sin el módulo: mapa vacío
  // -> la carta queda con los mosaicos de texto de siempre.
  const canImages = hasModule(LICENSE_MODULES.IMAGES)
  const menuImgs = useLiveQuery(
    () => (canImages ? imagesRepo.mapByType('product') : Promise.resolve(new Map())),
    [canImages],
    new Map()
  )

  const [q, setQ] = useState('')
  const [cat, setCat] = useState('') // filtro de categoria (vacio = todas)
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
  // Moneda en que se entrega el vuelto (igual que el turno): por defecto la base
  // (MN). Solo se ofrece elegir cuando se cobra en una divisa.
  const [changeCurrency, setChangeCurrency] = useState(baseCurrency)
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

  // Quitar el producto ENTERO de la cuenta (papelera). Sin confirmacion: en el
  // servicio hay que ser rapido y el stock se devuelve solo (todo queda en el
  // libro, asi que un toque de mas no pierde nada).
  const removeProduct = async (productId) => {
    setError('')
    try {
      await ordersRepo.removeProduct({ orderId: id, productId, userId: user.id })
    } catch (e) {
      setError(e.message)
    }
  }

  // --- pago mixto: partes con importe exacto (incluido en el modulo 'mesas',
  // no depende de mayorista). Misma logica y UI que el turno: se permite
  // sobrepago y el exceso es el vuelto (en MN). ---
  const partRate = (cur) => (cur === baseCurrency ? 1 : rateOf(cur) || 0)
  const mixedBase = round2(mixParts.reduce((a, p) => a + Number(p.amountBase || 0), 0))
  const mixRemaining = round2(total - mixedBase)           // lo que falta por cubrir
  const mixChange = round2(Math.max(0, mixedBase - total)) // sobrepago -> vuelto en MN
  const mixOk = mixParts.length > 0 && mixedBase >= total - 0.01
  const addPart = () => {
    const amt = Number(partAmount)
    if (!(amt > 0)) return
    const rate = partRate(partCurrency)
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
  // Rellena la parte en curso con lo que falta por cobrar, en su moneda.
  const fillRemaining = () => {
    const r = partRate(partCurrency)
    if (r <= 0 || mixRemaining <= 0) return
    setPartAmount(String(round2(mixRemaining / r)))
  }

  // Importes del cobro en efectivo (con vuelto). Igual que el turno: el vuelto
  // puede entregarse en MN o en la moneda del cobro (lo elige el vendedor). El
  // vuelto en MN se calcula EXACTO desde lo recibido (recibido x tasa), no desde
  // el vuelto en divisa, para que no arrastre redondeos.
  const cashRate = cashCurrency === baseCurrency ? 1 : rateOf(cashCurrency)
  const dueInCash = cashCurrency === baseCurrency
    ? total
    : (cashRate > 0 ? round2(total / cashRate) : 0)
  const paid = Number(received) || 0
  const paidBase = cashCurrency === baseCurrency ? paid : round2(paid * cashRate)
  const changeBase = round2(paidBase - total)   // vuelto en MN (exacto)
  const changeInPay = round2(paid - dueInCash)  // vuelto en la moneda del cobro
  // Moneda efectiva del vuelto: si se cobra en MN, siempre MN; si en divisa, la
  // que eligio el vendedor (MN por defecto o la propia divisa).
  const effChangeCur = cashCurrency === baseCurrency ? baseCurrency : changeCurrency
  const changeGiven = effChangeCur === cashCurrency ? changeInPay : changeBase

  const canPay =
    total > 0 &&
    (payMethod === PAYMENT_METHODS.CASH
      ? paid >= dueInCash && dueInCash > 0
      : payMethod === PAYMENT_METHODS.TRANSFER
        ? true
        : mixOk)

  const charge = async () => {
    setError('')
    if (!live.length) return setError('La cuenta está vacía')
    setBusy(true)
    try {
      // Las lineas de la mesa se agregan de UNA en UNA (append-only), asi que un
      // mismo producto deja varias filas de qty 1. La VENTA, en cambio, se guarda
      // AGRUPADA por producto (una sola linea "5 x Refresco") -> exactamente igual
      // que una venta directa de mostrador. De este modo el ticket, el reporte de
      // venta por turno y todos los reportes muestran un renglon por producto, sin
      // repetir. Se agrupa por producto + precio + costo CONGELADOS: si el precio
      // cambio a mitad del servicio, esas unidades quedan en lineas aparte (el
      // importe sigue siendo exacto). El libro mayor (stockMovements) conserva
      // intacto el detalle fila a fila; esto solo compacta el resumen de la venta.
      const grouped = new Map()
      for (const i of live) {
        const key = `${i.productId}|${i.unitPrice}|${i.unitCost}`
        const g = grouped.get(key)
        if (g) {
          g.qty = round2(g.qty + Number(i.qty || 0))
          g.lineTotal = round2(g.lineTotal + Number(i.lineTotal || 0))
        } else {
          grouped.set(key, {
            productId: i.productId,
            name: i.name,
            unit: i.unit,
            qty: Number(i.qty || 0),
            unitPrice: i.unitPrice,
            unitCost: i.unitCost,
            lineTotal: Number(i.lineTotal || 0),
            area: i.area
          })
        }
      }
      const saleItems = [...grouped.values()]
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
        serviceWaivedBy: waived ? user.id : null,
        // Módulo 'cuentas': la venta de mesa acredita la tesorería como INGRESO,
        // igual que la venta de mostrador (mismo criterio de licencia). Sin el
        // módulo -> false (no crea movimientos de cuenta). Antes faltaba y por
        // eso los cobros de mesa no aparecían en las cuentas.
        creditAccounts: hasModule(LICENSE_MODULES.ACCOUNTS)
      }
      let payload
      if (payMethod === PAYMENT_METHODS.MIXED) {
        payload = {
          ...common,
          paymentMethod: PAYMENT_METHODS.MIXED,
          payments: mixParts,
          change: mixChange,          // vuelto por sobrepago (en MN)
          changeCurrency: baseCurrency
        }
      } else if (payMethod === PAYMENT_METHODS.CASH) {
        payload = {
          ...common,
          paymentMethod: PAYMENT_METHODS.CASH,
          paymentCurrency: cashCurrency,
          cashAmount: round2(dueInCash),
          amountPaid: round2(paid),
          change: changeGiven,
          changeCurrency: effChangeCur,
          changeRate: effChangeCur === baseCurrency ? null : (rateOf(effChangeCur) || null),
          rate: cashCurrency === baseCurrency ? null : cashRate
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

  // Ticket (comprobante) formateado para impresora TERMICA de 58 mm (GOOJPRT
  // PT-210, ESC/POS). Se imprime con window.print(): en Android el diálogo
  // envía el ticket a la impresora emparejada por Bluetooth (vía RawBT o el
  // servicio de impresión). El CSS @media print aísla SOLO el ticket a 58 mm.
  if (done || closed) {
    const d = done || {
      subtotal: Number(sale?.subtotal ?? 0),
      service: Number(sale?.serviceChargeAmount ?? 0),
      pct: Number(sale?.serviceChargePct ?? 0),
      total: Number(sale?.totalBase ?? 0)
    }
    // Lineas del ticket AGRUPADAS por producto: aunque se hayan agregado de una
    // en una (7 lineas de "Refresco"), el ticket muestra un solo renglon con la
    // cantidad total (7 x Refresco). Se toman de la venta inmutable si la mesa
    // ya se cobro; si es el cobro recien hecho, de las lineas vivas.
    const rawLines = sale?.items?.length ? sale.items : live
    const ticketLines = (() => {
      const map = new Map()
      for (const it of rawLines) {
        const key = it.productId || it.name
        const g = map.get(key) || { qty: 0, name: it.name, total: 0 }
        g.qty += Number(it.qty || 0)
        g.total += Number(it.lineTotal || 0)
        map.set(key, g)
      }
      return [...map.values()]
    })()
    const folio = (sale?.id || order.id).slice(-6).toUpperCase()
    const payLabel = sale?.paymentMethod === 'mixed'
      ? 'Pago mixto'
      : sale?.paymentMethod === 'transfer' ? 'Transferencia' : 'Efectivo'

    return (
      <div className="screen">
        <button className="link-back print-hide" onClick={() => navigate('/salon')}>← Volver al salón</button>

        <div className="thermal" id="ticket">
          {ticketHeader
            ? <div className="thermal__head">{ticketHeader}</div>
            : <div className="thermal__head">COMPROBANTE</div>}
          <div className="thermal__meta">
            {order.area} · {order.table}<br />
            {new Date(order.closedAt || Date.now()).toLocaleString()}<br />
            Atendió: {userName(order.openedBy)}<br />
            Folio: {folio}
          </div>
          <div className="thermal__rule" />
          {ticketLines.map((l, i) => (
            <div key={i} className="thermal__item">
              <div className="thermal__item-name">{l.qty} x {l.name}</div>
              <div className="thermal__item-amt">{formatMoney(l.total, baseCurrency)}</div>
            </div>
          ))}
          <div className="thermal__rule" />
          <div className="thermal__row"><span>Subtotal</span><span>{formatMoney(d.subtotal, baseCurrency)}</span></div>
          {d.pct > 0 && (
            <div className="thermal__row"><span>Servicio {d.pct}%</span><span>{formatMoney(d.service, baseCurrency)}</span></div>
          )}
          <div className="thermal__row thermal__total"><span>TOTAL</span><span>{formatMoney(d.total, baseCurrency)}</span></div>
          <div className="thermal__pay">{payLabel}</div>
          {sale?.paymentMethod === 'mixed' && Array.isArray(sale.payments) && (
            <div className="thermal__parts">
              {sale.payments.map((p, i) => (
                <div key={i} className="thermal__row thermal__row--sm">
                  <span>{p.method === 'transfer' ? 'Transf.' : 'Efec.'} {p.currency}</span>
                  <span>{formatMoney(p.amount, p.currency)}</span>
                </div>
              ))}
            </div>
          )}
          {ticketFooter && <div className="thermal__foot">{ticketFooter}</div>}
        </div>

        <div className="print-hide" style={{ marginTop: 12 }}>
          <button className="btn btn--primary btn--block" onClick={() => window.print()}>🖨 Imprimir ticket</button>
          <p className="muted" style={{ marginTop: 8 }}>
            En el diálogo, elige la impresora Bluetooth (o RawBT). El ticket sale
            en papel de 58 mm.
          </p>
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
              onClick={() => removeProduct(g.productId)}
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
              <div className="pay-currencies">
                {CASH_CURRENCIES.map((c) => (
                  <button
                    key={c}
                    className={`btn btn--sm ${cashCurrency === c ? 'btn--primary' : 'btn--ghost'}`}
                    onClick={() => { setCashCurrency(c); setChangeCurrency(baseCurrency); setReceived('') }}
                    disabled={c !== baseCurrency && !rateOf(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>

              {cashCurrency !== baseCurrency && (
                <p className="muted">
                  Total en {cashCurrency}: <strong>{formatMoney(dueInCash, cashCurrency)}</strong>{' '}
                  (tasa {cashRate}) · equivale a {formatMoney(total, baseCurrency)}
                </p>
              )}

              <label className="field">
                <span>Recibido ({cashCurrency})</span>
                <input type="number" inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} placeholder="0" />
              </label>

              <div className="total-row">
                <span>Vuelto</span>
                <strong className={`total-amount ${changeGiven < 0 ? 'neg' : ''}`}>
                  {formatMoney(changeGiven, effChangeCur)}
                </strong>
              </div>

              {/* Vuelto al cobrar en divisa: se muestra en AMBAS monedas y el
                  vendedor elige en cual entregarlo (igual que el turno). Esa
                  eleccion determina de que caja sale el vuelto en el cuadre. */}
              {cashCurrency !== baseCurrency && changeBase >= 0 && cashRate > 0 && (
                <>
                  <p className="muted">
                    Vuelto: <strong>{formatMoney(changeBase, baseCurrency)}</strong> ó{' '}
                    <strong>{formatMoney(changeInPay, cashCurrency)}</strong> (tasa {cashRate}).
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
                      className={`btn btn--sm ${effChangeCur === cashCurrency ? 'btn--primary' : 'btn--ghost'}`}
                      onClick={() => setChangeCurrency(cashCurrency)}
                    >
                      {cashCurrency}
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {payMethod === PAYMENT_METHODS.TRANSFER && (
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
                A cobrar: <strong>{formatMoney(transferCurrency === baseCurrency ? total : (rateOf(transferCurrency) > 0 ? round2(total / rateOf(transferCurrency)) : 0), transferCurrency)}</strong>
                {transferCurrency !== baseCurrency && ` (tasa ${rateOf(transferCurrency)})`}
              </p>
              <label className="field">
                <span>Referencia / confirmación</span>
                <input value={transferRef} onChange={(e) => setTransferRef(e.target.value)} placeholder="Nº de transacción" />
              </label>
            </>
          )}

          {payMethod === PAYMENT_METHODS.MIXED && (
            <>
              <p className="muted">
                Cobra la cuenta en varias partes (efectivo y/o transferencia, en distintas
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
                        {p.currency !== baseCurrency && ` (= ${formatMoney(Number(p.amountBase) || 0, baseCurrency)})`}
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
                    <button className="btn btn--primary" onClick={addPart} disabled={!(Number(partAmount) > 0)}>
                      Agregar pago
                    </button>
                  </div>
                </>
              )}
              <p className="muted">Las partes de efectivo entran a la caja por su moneda; las transferencias van aparte. Todo cuadra al cierre.</p>
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
              const photo = canImages ? menuImgs.get(p.id) : ''
              return (
                <button key={p.id} className={`menu-tile ${photo ? 'menu-tile--img' : ''}`} onClick={() => addOne(p)}>
                  {n > 0 && <span className="menu-tile__badge">{n}</span>}
                  {photo && (
                    <span className="menu-tile__img"><img src={photo} alt="" loading="lazy" /></span>
                  )}
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
