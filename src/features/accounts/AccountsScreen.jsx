import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft } from 'lucide-react'
import { accountsRepo, ACCOUNT_CONCEPTS } from '../../repositories/accountsRepo'
import { partnersRepo } from '../../repositories/partnersRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { formatMoney } from '../../lib/currency'
import { formatDateTime } from '../../lib/dates'
import { useEscapeClose } from '../../lib/useEscapeClose'
import { CASH_CURRENCIES, PARTNER_TYPES } from '../../db/constants'

// Etiquetas del origen de cada movimiento de cuenta.
const REF_LABELS = {
  sale: 'Venta',
  withdrawal: 'Extracción de caja',
  partnerPayment: 'Pago/cobro de tercero',
  manual: 'Ajuste manual'
}

// Bloque D (modulo 'cuentas'): registro de cuentas de tesoreria. Las ventas
// acreditan su cuenta en tiempo real (efectivo por moneda, transferencias);
// extracciones y pagos a proveedores debitan. Saldo = creditos - debitos.
export function AccountsScreen() {
  const { user, isManager } = useAuth()
  const { hasModule } = useLicense()
  const navigate = useNavigate()

  const canAccounts = hasModule(LICENSE_MODULES.ACCOUNTS)
  const accounts = useLiveQuery(() => accountsRepo.list(), [], [])
  const balances = useLiveQuery(() => accountsRepo.balances(), [], {})
  // Opcion A: saldos de proveedores/terceros para la vista unificada.
  const partners = useLiveQuery(() => partnersRepo.list(), [], [])
  const partnerBal = useLiveQuery(() => partnersRepo.balances(), [], {})
  // Opcion B: ingresos/egresos por concepto (de que actividad vino el dinero).
  const byConcept = useLiveQuery(() => accountsRepo.byConcept(), [], { credits: {}, debits: {} })
  const [openId, setOpenId] = useState(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (canAccounts && isManager) accountsRepo.ensureDefaults()
  }, [canAccounts, isManager])

  if (!isManager || !canAccounts) {
    return (
      <div className="screen">
        <h2>Cuentas</h2>
        <p className="muted">
          {isManager
            ? 'Tu licencia no incluye el módulo de cuentas.'
            : 'Solo el dueño o un administrativo puede ver las cuentas.'}
        </p>
        <Link className="btn btn--primary btn--block" to="/">Volver</Link>
      </div>
    )
  }

  const open = openId ? accounts.find((a) => a.id === openId) : null
  if (open) {
    return (
      <AccountDetail
        account={open}
        balance={balances[open.id] || 0}
        userId={user.id}
        onBack={() => setOpenId(null)}
      />
    )
  }

  return (
    <div className="screen">
      <div className="pos-nav">
        <button className="pos-nav__back" onClick={() => navigate(-1)} aria-label="Volver">
          <ChevronLeft size={20} strokeWidth={2} />
        </button>
        <h2 className="pos-nav__title">Cuentas</h2>
        <span className="pos-nav__action" />
      </div>
      <p className="muted">
        El dinero del negocio por cuenta. Cada venta acredita su cuenta al momento:
        efectivo por moneda y transferencias por separado. Toca una cuenta para ver
        sus movimientos.
      </p>

      <div className="list">
        {accounts.map((a) => {
          const bal = balances[a.id] || 0
          return (
            <button key={a.id} className="list-item help-item" onClick={() => setOpenId(a.id)}>
              <span className="help-item__text">
                <strong>{a.name}</strong>
                <span className="muted">{a.system ? 'Cuenta del sistema' : 'Cuenta propia'}</span>
              </span>
              <strong className={bal < 0 ? 'warn-text' : ''}>{formatMoney(bal, a.currency)}</strong>
            </button>
          )
        })}
      </div>

      <button className="btn btn--ghost btn--block" onClick={() => setCreating(true)}>
        + Crear otra cuenta
      </button>

      <UnifiedPartners partners={partners} partnerBal={partnerBal} onGo={() => navigate('/partners')} />
      <IncomeByConcept byConcept={byConcept} />

      {creating && <AccountForm onClose={() => setCreating(false)} />}
    </div>
  )
}

// Opcion A: saldos de proveedores (por pagar) y terceros (por cobrar) junto a
// la tesoreria, para la foto completa del negocio.
function UnifiedPartners({ partners, partnerBal, onGo }) {
  const providers = partners.filter((p) => p.type === PARTNER_TYPES.PROVIDER && p.active)
  const creditors = partners.filter((p) => p.type === PARTNER_TYPES.CREDITOR && p.active)
  const sum = (list) => round2(list.reduce((a, p) => a + Math.max(0, partnerBal[p.id] || 0), 0))
  const porPagar = sum(providers)
  const porCobrar = sum(creditors)
  if (providers.length === 0 && creditors.length === 0) return null

  return (
    <section className="card">
      <h3>Proveedores y terceros</h3>
      <div className="kv">
        <span className="muted">Por pagar (proveedores)</span>
        <strong className={porPagar > 0 ? 'warn-text' : ''}>{formatMoney(porPagar, 'MN')}</strong>
      </div>
      <div className="kv">
        <span className="muted">Por cobrar (terceros)</span>
        <strong className={porCobrar > 0 ? 'ok-text' : ''}>{formatMoney(porCobrar, 'MN')}</strong>
      </div>
      <button className="btn btn--ghost btn--block btn--sm" onClick={onGo}>Ver detalle de cuentas</button>
    </section>
  )
}

// Opcion B: ingresos por concepto (de que actividad vino el dinero) y egresos.
function IncomeByConcept({ byConcept }) {
  const { credits = {}, debits = {} } = byConcept || {}
  const incomeKeys = ['own', 'consignment', 'thirdparty']
  const egressKeys = ['provider', 'withdrawal']
  const anyIncome = incomeKeys.some((k) => (credits[k] || 0) > 0)
  const anyEgress = egressKeys.some((k) => (debits[k] || 0) > 0)
  if (!anyIncome && !anyEgress) return null

  return (
    <section className="card">
      <h3>Ingresos por concepto</h3>
      <p className="muted">De qué actividad vino el dinero (en MN, todo el historial).</p>
      {incomeKeys.map((k) => (credits[k] || 0) > 0 && (
        <div key={k} className="kv">
          <span className="muted">{ACCOUNT_CONCEPTS[k]}</span>
          <strong className="ok-text">+{formatMoney(credits[k], 'MN')}</strong>
        </div>
      ))}
      {anyEgress && <p className="muted" style={{ marginTop: 8 }}>Egresos</p>}
      {egressKeys.map((k) => (debits[k] || 0) > 0 && (
        <div key={k} className="kv">
          <span className="muted">{ACCOUNT_CONCEPTS[k]}</span>
          <strong className="warn-text">−{formatMoney(debits[k], 'MN')}</strong>
        </div>
      ))}
    </section>
  )
}

function AccountForm({ onClose }) {
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('MN')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEscapeClose(onClose)

  const save = async () => {
    setError('')
    setBusy(true)
    try {
      await accountsRepo.create({ name, currency })
      onClose()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>Nueva cuenta</h3>
        <label className="field">
          <span>Nombre *</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Caja fuerte" />
        </label>
        <label className="field">
          <span>Moneda</span>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {[...new Set([...CASH_CURRENCIES, 'MLC'])].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
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

// Detalle de una cuenta: saldo, movimientos y ajuste manual.
function AccountDetail({ account, balance, userId, onBack }) {
  const movements = useLiveQuery(() => accountsRepo.movements(account.id), [account.id], [])
  const [adjusting, setAdjusting] = useState(false)

  return (
    <div className="screen">
      <button className="pos-nav__back help-back" onClick={onBack} aria-label="Volver a cuentas">
        <ChevronLeft size={20} strokeWidth={2} /> Cuentas
      </button>
      <h2>{account.name}</h2>

      <section className="card">
        <div className="total-row">
          <span>Saldo</span>
          <strong className={`total-amount ${balance < 0 ? 'neg' : ''}`}>
            {formatMoney(balance, account.currency)}
          </strong>
        </div>
        <button className="btn btn--ghost btn--block" onClick={() => setAdjusting(true)}>
          Registrar ajuste manual
        </button>
      </section>

      <section className="card">
        <h3>Movimientos</h3>
        {movements.length === 0 ? (
          <p className="muted">Sin movimientos todavía. Las ventas van entrando solas.</p>
        ) : (
          <div className="list">
            {movements.map((mv) => (
              <div key={mv.id} className="audit-row">
                <div className="audit-row__head">
                  <strong>{REF_LABELS[mv.refType] || 'Movimiento'}</strong>
                  <span className={mv.direction === 'debit' ? 'warn-text' : 'ok-text'}>
                    {mv.direction === 'debit' ? '−' : '+'}{formatMoney(Number(mv.amount) || 0, account.currency)}
                  </span>
                </div>
                <span className="muted">
                  {formatDateTime(mv.createdAt)}{mv.note ? ` · ${mv.note}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {adjusting && (
        <AdjustForm account={account} userId={userId} onClose={() => setAdjusting(false)} />
      )}
    </div>
  )
}

// Ajuste manual (correccion append-only, con nota obligatoria).
function AdjustForm({ account, userId, onClose }) {
  const [direction, setDirection] = useState('credit')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEscapeClose(onClose)

  const save = async () => {
    setError('')
    if (!note.trim()) return setError('Escribe el motivo del ajuste (queda en el historial)')
    setBusy(true)
    try {
      await accountsRepo.addManual({ accountId: account.id, direction, amount, note, userId })
      onClose()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>Ajuste manual · {account.name}</h3>
        <div className="tabs">
          <button className={`tab ${direction === 'credit' ? 'is-active' : ''}`} onClick={() => setDirection('credit')}>
            Entrada (+)
          </button>
          <button className={`tab ${direction === 'debit' ? 'is-active' : ''}`} onClick={() => setDirection('debit')}>
            Salida (−)
          </button>
        </div>
        <label className="field">
          <span>Monto ({account.currency})</span>
          <input
            autoFocus
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
          />
        </label>
        <label className="field">
          <span>Motivo *</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: saldo inicial de la cuenta" />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" disabled={busy || !(Number(amount) > 0)} onClick={save}>
            {busy ? 'Registrando…' : 'Registrar ajuste'}
          </button>
        </div>
      </div>
    </div>
  )
}
