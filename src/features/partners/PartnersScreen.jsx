import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft } from 'lucide-react'
import { partnersRepo } from '../../repositories/partnersRepo'
import { accountsRepo } from '../../repositories/accountsRepo'
import { productsRepo } from '../../repositories/productsRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { formatMoney, round2 } from '../../lib/currency'
import { formatDateTime } from '../../lib/dates'
import { matchesQuery } from '../../lib/search'
import { useEscapeClose } from '../../lib/useEscapeClose'
import {
  PARTNER_TYPES,
  PARTNER_TYPE_LABELS,
  PARTNER_MOVEMENT_TYPES,
  PARTNER_MOVEMENT_LABELS,
  WAREHOUSE
} from '../../db/constants'

// Bloque C (modulo 'cuentas'): proveedores (consignacion, cuenta por pagar) y
// terceros/acreedores (entregas de mercancia, cuenta por cobrar). El saldo de
// cada cuenta se deriva de sus movimientos (append-only, sincronizable).
export function PartnersScreen() {
  const { user, isManager } = useAuth()
  const { hasModule } = useLicense()
  const { baseCurrency } = useCurrency()
  const navigate = useNavigate()

  const partners = useLiveQuery(() => partnersRepo.list(), [], [])
  const balances = useLiveQuery(() => partnersRepo.balances(), [], {})
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState(null)

  // Bloque D: garantiza las cuentas base de tesoreria (idempotente, ids fijos)
  // para poder elegir la cuenta al registrar pagos y cobros.
  const canAccounts = hasModule(LICENSE_MODULES.ACCOUNTS)
  useEffect(() => {
    if (canAccounts) accountsRepo.ensureDefaults()
  }, [canAccounts])

  if (!isManager || !hasModule(LICENSE_MODULES.ACCOUNTS)) {
    return (
      <div className="screen">
        <h2>Proveedores y terceros</h2>
        <p className="muted">
          {isManager
            ? 'Tu licencia no incluye el módulo de cuentas.'
            : 'Solo el dueño o un administrativo puede gestionar las cuentas.'}
        </p>
        <Link className="btn btn--primary btn--block" to="/">Volver</Link>
      </div>
    )
  }

  const open = openId ? partners.find((p) => p.id === openId) : null
  if (open) {
    return (
      <PartnerDetail
        partner={open}
        balance={balances[open.id] || 0}
        baseCurrency={baseCurrency}
        userId={user.id}
        onBack={() => setOpenId(null)}
      />
    )
  }

  const providers = partners.filter((p) => p.type === PARTNER_TYPES.PROVIDER && p.active)
  const creditors = partners.filter((p) => p.type === PARTNER_TYPES.CREDITOR && p.active)

  const row = (p) => {
    const bal = balances[p.id] || 0
    return (
      <button key={p.id} className="list-item help-item" onClick={() => setOpenId(p.id)}>
        <span className="help-item__text">
          <strong>{p.name}</strong>
          <span className="muted">
            {p.type === PARTNER_TYPES.PROVIDER
              ? bal > 0 ? `Le debes ${formatMoney(bal, baseCurrency)}` : 'Sin deuda pendiente'
              : bal > 0 ? `Te debe ${formatMoney(bal, baseCurrency)}` : 'Sin deuda pendiente'}
          </span>
        </span>
        <span className={`help-item__chev ${bal > 0 ? 'warn-text' : ''}`}>›</span>
      </button>
    )
  }

  return (
    <div className="screen">
      <div className="pos-nav">
        <button className="pos-nav__back" onClick={() => navigate(-1)} aria-label="Volver">
          <ChevronLeft size={20} strokeWidth={2} />
        </button>
        <h2 className="pos-nav__title">Proveedores y terceros</h2>
        <span className="pos-nav__action" />
      </div>
      <p className="muted">
        Cuentas por pagar (proveedores en consignación) y por cobrar (terceros a los que
        entregas mercancía). El saldo se calcula solo, con cada venta o entrega.
      </p>

      <button className="btn btn--primary btn--block" onClick={() => setCreating(true)}>
        + Nuevo proveedor o tercero
      </button>

      {providers.length > 0 && (
        <section className="help-section">
          <h3 className="home-section__label">Proveedores (por pagar)</h3>
          <div className="list">{providers.map(row)}</div>
        </section>
      )}
      {creditors.length > 0 && (
        <section className="help-section">
          <h3 className="home-section__label">Terceros (por cobrar)</h3>
          <div className="list">{creditors.map(row)}</div>
        </section>
      )}
      {providers.length === 0 && creditors.length === 0 && (
        <p className="muted">Aún no hay cuentas. Crea la primera arriba.</p>
      )}

      {creating && <PartnerForm onClose={() => setCreating(false)} />}
    </div>
  )
}

// Alta de un tercero.
function PartnerForm({ onClose }) {
  const [name, setName] = useState('')
  const [type, setType] = useState(PARTNER_TYPES.PROVIDER)
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEscapeClose(onClose)

  const save = async () => {
    setError('')
    setBusy(true)
    try {
      await partnersRepo.create({ name, type, phone, note })
      onClose()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>Nuevo proveedor o tercero</h3>
        <label className="field">
          <span>Nombre *</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Distribuidora Sol" />
        </label>
        <label className="field">
          <span>Tipo</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value={PARTNER_TYPES.PROVIDER}>Proveedor — deja mercancía en consignación (le pagas)</option>
            <option value={PARTNER_TYPES.CREDITOR}>Tercero — le entregas mercancía (te paga)</option>
          </select>
        </label>
        <label className="field">
          <span>Teléfono (opcional)</span>
          <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="field">
          <span>Nota (opcional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" disabled={busy || !name.trim()} onClick={save}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Detalle de una cuenta: saldo, acciones y movimientos.
function PartnerDetail({ partner, balance, baseCurrency, userId, onBack }) {
  const movements = useLiveQuery(() => partnersRepo.movements(partner.id), [partner.id], [])
  const [paying, setPaying] = useState(false)
  const [delivering, setDelivering] = useState(false)
  const isProvider = partner.type === PARTNER_TYPES.PROVIDER

  return (
    <div className="screen">
      <button className="pos-nav__back help-back" onClick={onBack} aria-label="Volver a la lista">
        <ChevronLeft size={20} strokeWidth={2} /> Cuentas
      </button>
      <h2>{partner.name}</h2>
      <p className="muted">{PARTNER_TYPE_LABELS[partner.type]}{partner.phone ? ` · ${partner.phone}` : ''}</p>

      <section className="card">
        <div className="total-row">
          <span>{isProvider ? 'Le debes' : 'Te debe'}</span>
          <strong className={`total-amount ${balance > 0 ? 'neg' : ''}`}>
            {formatMoney(balance, baseCurrency)}
          </strong>
        </div>
        <div className="report-actions">
          <button className="btn btn--primary" onClick={() => setPaying(true)} disabled={balance <= 0}>
            {isProvider ? 'Registrar pago' : 'Registrar cobro'}
          </button>
          {!isProvider && (
            <button className="btn" onClick={() => setDelivering(true)}>
              Entregar mercancía
            </button>
          )}
        </div>
      </section>

      <section className="card">
        <h3>Movimientos</h3>
        {movements.length === 0 ? (
          <p className="muted">
            {isProvider
              ? 'Sin movimientos. Registra una entrada en consignación y, al venderse, la deuda aparece aquí.'
              : 'Sin movimientos. Usa "Entregar mercancía" para la primera entrega.'}
          </p>
        ) : (
          <div className="list">
            {movements.map((mv) => {
              const isDebit = mv.type === PARTNER_MOVEMENT_TYPES.PAYMENT_OUT || mv.type === PARTNER_MOVEMENT_TYPES.PAYMENT_IN
              return (
                <div key={mv.id} className="audit-row">
                  <div className="audit-row__head">
                    <strong>{PARTNER_MOVEMENT_LABELS[mv.type] || mv.type}</strong>
                    <span className={isDebit ? 'ok-text' : 'warn-text'}>
                      {isDebit ? '−' : '+'}{formatMoney(Number(mv.amount) || 0, baseCurrency)}
                    </span>
                  </div>
                  <span className="muted">
                    {formatDateTime(mv.createdAt)}
                    {mv.items?.length ? ` · ${mv.items.map((it) => `${it.qty} ${it.name}`).join(', ')}` : ''}
                    {mv.note ? ` · ${mv.note}` : ''}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {paying && (
        <PaymentForm
          partner={partner}
          balance={balance}
          baseCurrency={baseCurrency}
          userId={userId}
          onClose={() => setPaying(false)}
        />
      )}
      {delivering && (
        <DeliveryForm partner={partner} baseCurrency={baseCurrency} userId={userId} onClose={() => setDelivering(false)} />
      )}
    </div>
  )
}

// Pago al proveedor / cobro al tercero, desde la cuenta de tesoreria elegida.
function PaymentForm({ partner, balance, baseCurrency, userId, onClose }) {
  const isProvider = partner.type === PARTNER_TYPES.PROVIDER
  // Cuentas en moneda base (la deuda del tercero se lleva en MN).
  const accounts = useLiveQuery(async () => {
    const all = await accountsRepo.list()
    return all.filter((a) => a.currency === baseCurrency)
  }, [baseCurrency], [])
  const [accountId, setAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEscapeClose(onClose)

  // Preselecciona "Efectivo MN" en cuanto cargan las cuentas.
  useEffect(() => {
    if (!accountId && accounts.length) setAccountId(accounts[0].id)
  }, [accounts, accountId])

  const save = async () => {
    setError('')
    setBusy(true)
    try {
      await partnersRepo.addPayment({
        partnerId: partner.id,
        type: isProvider ? PARTNER_MOVEMENT_TYPES.PAYMENT_OUT : PARTNER_MOVEMENT_TYPES.PAYMENT_IN,
        amount,
        note,
        userId,
        accountId: accountId || null
      })
      onClose()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>{isProvider ? `Pagar a ${partner.name}` : `Cobro de ${partner.name}`}</h3>
        <p className="muted">Deuda actual: <strong>{formatMoney(balance, baseCurrency)}</strong></p>
        <label className="field">
          <span>Monto ({baseCurrency})</span>
          <input
            autoFocus
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
          />
        </label>
        {accounts.length > 0 && (
          <label className="field">
            <span>{isProvider ? 'Pagar desde la cuenta' : 'Cobrar hacia la cuenta'}</span>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>Nota (opcional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: pago parcial en efectivo" />
        </label>
        {Number(amount) > balance && (
          <p className="warn-text">⚠️ El monto supera la deuda actual; quedaría saldo a favor.</p>
        )}
        {error && <p className="error">{error}</p>}
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" disabled={busy || !(Number(amount) > 0)} onClick={save}>
            {busy ? 'Registrando…' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Entrega de mercancia del almacen a un tercero (cuenta por cobrar).
function DeliveryForm({ partner, baseCurrency, userId, onClose }) {
  const products = useLiveQuery(() => productsRepo.listActive(), [], [])
  const [query, setQuery] = useState('')
  const [lines, setLines] = useState([]) // [{ productId, name, unit, qty, unitValue }]
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEscapeClose(onClose)

  const availOf = (p) => Number(p.stockByLocation?.[WAREHOUSE] ?? p.stock ?? 0)
  const results = useMemo(() => {
    if (!query.trim()) return []
    return products.filter((p) => matchesQuery(p, query) && availOf(p) > 0).slice(0, 10)
  }, [products, query])

  const addLine = (p) => {
    setLines((prev) =>
      prev.some((l) => l.productId === p.id)
        ? prev
        : [...prev, { productId: p.id, name: p.name, unit: p.unit, qty: 1, unitValue: p.price, avail: availOf(p) }]
    )
    setQuery('')
  }
  const update = (productId, field, value) =>
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, [field]: value } : l)))
  const removeLine = (productId) => setLines((prev) => prev.filter((l) => l.productId !== productId))

  const total = round2(lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unitValue) || 0), 0))
  const valid = lines.length > 0 && lines.every((l) => Number(l.qty) > 0 && Number(l.qty) <= l.avail && Number(l.unitValue) >= 0)

  const save = async () => {
    setError('')
    setBusy(true)
    try {
      await partnersRepo.deliverGoods({ partnerId: partner.id, items: lines, note, userId })
      onClose()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>Entregar mercancía a {partner.name}</h3>
        <p className="muted">
          Sale del <strong>almacén central</strong> y queda como deuda del tercero
          (cantidad × valor unitario).
        </p>
        <input
          className="search-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar producto del almacén…"
        />
        {results.length > 0 && (
          <div className="product-list">
            {results.map((p) => (
              <button key={p.id} className="product-row" onClick={() => addLine(p)}>
                <div className="product-row__main">
                  <strong>{p.name}</strong>
                  <span className="muted">almacén {availOf(p)} {p.unit}</span>
                </div>
                <span className="price">{formatMoney(p.price, baseCurrency)}</span>
              </button>
            ))}
          </div>
        )}

        {lines.map((l) => (
          <div key={l.productId} className="entry-line">
            <div className="entry-line__head">
              <strong>{l.name}</strong>
              <button className="link-del" onClick={() => removeLine(l.productId)}>quitar</button>
            </div>
            <div className="form-row">
              <label className="field">
                <span>Cantidad ({l.unit}) · hay {l.avail}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={l.qty}
                  onChange={(e) => update(l.productId, 'qty', e.target.value)}
                />
              </label>
              <label className="field">
                <span>Valor unitario ({baseCurrency})</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={l.unitValue}
                  onChange={(e) => update(l.productId, 'unitValue', e.target.value)}
                />
              </label>
            </div>
            {Number(l.qty) > l.avail && (
              <p className="warn-text">Solo hay {l.avail} en el almacén.</p>
            )}
          </div>
        ))}

        {lines.length > 0 && (
          <>
            <label className="field">
              <span>Nota (opcional)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="total-row">
              <span>Total de la entrega</span>
              <strong className="total-amount">{formatMoney(total, baseCurrency)}</strong>
            </div>
          </>
        )}

        {error && <p className="error">{error}</p>}
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" disabled={busy || !valid} onClick={save}>
            {busy ? 'Registrando…' : 'Registrar entrega'}
          </button>
        </div>
      </div>
    </div>
  )
}
