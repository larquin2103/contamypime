import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { cashRepo } from '../../repositories/cashRepo'
import { debtsRepo } from '../../repositories/debtsRepo'
import { productsRepo } from '../../repositories/productsRepo'
import { usersRepo } from '../../repositories/usersRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useShift } from '../../app/providers/ShiftProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { matchesQuery } from '../../lib/search'
import { round2, formatMoney } from '../../lib/currency'
import { formatDateTime } from '../../lib/dates'
import { CASH_CURRENCIES } from '../../db/constants'
import { OwnerAuthModal } from '../../components/OwnerAuthModal'

export function CashScreen() {
  const { user, isManager } = useAuth()
  const { activeShift, isMine } = useShift()
  const [tab, setTab] = useState('extraccion')

  const allowed = activeShift && (isMine || isManager)
  if (!allowed) {
    return (
      <div className="screen">
        <h2>Caja y deudas</h2>
        <section className="card">
          <p>Necesitas un <strong>turno abierto</strong> para registrar movimientos de caja.</p>
          <Link className="btn btn--primary btn--block" to="/shift">Ir a Turno</Link>
        </section>
      </div>
    )
  }

  return (
    <div className="screen">
      <h2>Caja y deudas</h2>
      <div className="tabs">
        <button
          className={`tab ${tab === 'extraccion' ? 'is-active' : ''}`}
          onClick={() => setTab('extraccion')}
        >
          Extraccion
        </button>
        <button
          className={`tab ${tab === 'deuda' ? 'is-active' : ''}`}
          onClick={() => setTab('deuda')}
        >
          Deuda interna
        </button>
      </div>

      {tab === 'extraccion' ? (
        <WithdrawForm shift={activeShift} user={user} isManager={isManager} />
      ) : (
        <DebtForm shift={activeShift} user={user} isManager={isManager} />
      )}

      <Movements shiftId={activeShift.id} />
    </div>
  )
}

function WithdrawForm({ shift, user, isManager }) {
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(CASH_CURRENCIES[0])
  const [reason, setReason] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [askAuth, setAskAuth] = useState(false)

  const valid = Number(amount) > 0 && reason.trim()

  const doWithdraw = async (authName) => {
    setBusy(true)
    setAskAuth(false)
    await cashRepo.withdraw({
      shiftId: shift.id,
      userId: user.id,
      amount,
      currency,
      reason,
      authorizedBy: authName
    })
    setAmount('')
    setReason('')
    setSaved(true)
    setBusy(false)
    setTimeout(() => setSaved(false), 2000)
  }

  const submit = () => {
    if (!valid) return
    if (isManager) doWithdraw(user.name)
    else setAskAuth(true) // el vendedor necesita autorizacion de un mando
  }

  return (
    <section className="card">
      <h3>Extraccion de caja</h3>
      <p className="muted">Sale dinero de la caja (no es una venta). Resta del efectivo esperado.</p>
      <div className="form-row">
        <label className="field">
          <span>Monto</span>
          <input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="field">
          <span>Moneda</span>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CASH_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Motivo</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej: pago a proveedor" />
      </label>
      {!isManager && <p className="muted">Requiere autorizacion del dueño o administrativo (PIN) al confirmar.</p>}
      {saved && <p className="ok-text">✓ Extraccion registrada</p>}
      <button className="btn btn--primary btn--block" disabled={!valid || busy} onClick={submit}>
        {busy ? 'Registrando…' : 'Registrar extraccion'}
      </button>
      {askAuth && (
        <OwnerAuthModal onCancel={() => setAskAuth(false)} onAuthorized={(owner) => doWithdraw(owner.name)} />
      )}
    </section>
  )
}

function DebtForm({ shift, user, isManager }) {
  const { baseCurrency } = useCurrency()
  const products = useLiveQuery(() => productsRepo.listActive(), [], [])
  const users = useLiveQuery(() => usersRepo.listActive(), [], [])
  const [query, setQuery] = useState('')
  const [product, setProduct] = useState(null)
  const [qty, setQty] = useState('1')
  const [debtor, setDebtor] = useState('')
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [askAuth, setAskAuth] = useState(false)

  const results = useMemo(() => {
    if (!query.trim()) return []
    return products.filter((p) => matchesQuery(p, query)).slice(0, 12)
  }, [products, query])

  const value = product ? round2((Number(qty) || 0) * product.price) : 0
  const valid = product && Number(qty) > 0 && debtor

  const doCreate = async (authName) => {
    setBusy(true)
    setAskAuth(false)
    await debtsRepo.create({
      shiftId: shift.id,
      debtorUserId: debtor,
      registeredBy: user.id,
      authorizedBy: authName,
      productId: product.id,
      qty,
      unitValue: product.price,
      note
    })
    setProduct(null)
    setQty('1')
    setDebtor('')
    setNote('')
    setQuery('')
    setSaved(true)
    setBusy(false)
    setTimeout(() => setSaved(false), 2000)
  }

  const submit = () => {
    if (!valid) return
    if (isManager) doCreate(user.name)
    else setAskAuth(true)
  }

  return (
    <section className="card">
      <h3>Deuda interna</h3>
      <p className="muted">Retiro de producto sin pago. Descuenta inventario y NO cuenta como ingreso.</p>

      {!product ? (
        <>
          <input
            className="search-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar producto…"
          />
          <div className="product-list">
            {results.map((p) => (
              <button key={p.id} className="product-row" onClick={() => { setProduct(p); setQuery('') }}>
                <div className="product-row__main">
                  <strong>{p.name}</strong>
                  <span className="muted">stock {p.stock} {p.unit}</span>
                </div>
                <span className="price">{formatMoney(p.price, baseCurrency)}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="kv">
            <span><strong>{product.name}</strong></span>
            <button className="link-del" onClick={() => setProduct(null)}>cambiar</button>
          </div>
          <div className="form-row">
            <label className="field">
              <span>Cantidad ({product.unit})</span>
              <input type="number" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
            </label>
            <label className="field">
              <span>Valor</span>
              <input value={formatMoney(value, baseCurrency)} readOnly />
            </label>
          </div>
          <label className="field">
            <span>Quien se lleva (deudor)</span>
            <select value={debtor} onChange={(e) => setDebtor(e.target.value)}>
              <option value="">— Selecciona —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Nota (opcional)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {!isManager && <p className="muted">Requiere autorizacion del dueño o administrativo (PIN) al confirmar.</p>}
          {saved && <p className="ok-text">✓ Deuda registrada</p>}
          <button className="btn btn--primary btn--block" disabled={!valid || busy} onClick={submit}>
            {busy ? 'Registrando…' : 'Registrar deuda'}
          </button>
        </>
      )}
      {saved && !product && <p className="ok-text">✓ Deuda registrada</p>}
      {askAuth && (
        <OwnerAuthModal onCancel={() => setAskAuth(false)} onAuthorized={(owner) => doCreate(owner.name)} />
      )}
    </section>
  )
}

function Movements({ shiftId }) {
  const withdrawals = useLiveQuery(() => cashRepo.byShift(shiftId), [shiftId], [])
  const debts = useLiveQuery(() => debtsRepo.byShift(shiftId), [shiftId], [])
  const users = useLiveQuery(() => usersRepo.list(), [], [])
  const userName = useMemo(() => {
    const m = {}
    for (const u of users) m[u.id] = u.name
    return m
  }, [users])

  if (withdrawals.length === 0 && debts.length === 0) return null

  return (
    <section className="card">
      <h3>Movimientos del turno</h3>
      <div className="list">
        {withdrawals.map((w) => (
          <div key={w.id} className="list-item">
            <div>
              <strong>Extraccion · {formatMoney(w.amount, w.currency)}</strong>
              <span className="muted"> · {w.reason}</span>
              <br />
              <span className="muted">Autoriza: {w.authorizedBy} · {formatDateTime(w.createdAt)}</span>
            </div>
          </div>
        ))}
        {debts.map((d) => (
          <div key={d.id} className="list-item">
            <div>
              <strong>Deuda · {formatMoney(d.valueAtTime)}</strong>
              <span className="muted"> · {userName[d.userId] || 'usuario'}</span>
              <br />
              <span className="muted">{d.qty} u · {formatDateTime(d.createdAt)}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
