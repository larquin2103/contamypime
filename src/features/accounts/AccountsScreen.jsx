import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft } from 'lucide-react'
import { accountsRepo, conceptLabel, ACCOUNT_REF_LABELS } from '../../repositories/accountsRepo'
import { partnersRepo } from '../../repositories/partnersRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { formatMoney, round2 } from '../../lib/currency'
import { formatDateTime } from '../../lib/dates'
import { useEscapeClose } from '../../lib/useEscapeClose'
import { CASH_CURRENCIES, PARTNER_TYPES } from '../../db/constants'

// Etiquetas del origen de cada movimiento de cuenta (lista completa en accountsRepo,
// compartida con el reporte para que no se separen: aqui faltaban el cobro de entrega
// y el fondo del mensajero, que salian como "Movimiento" a secas).
const REF_LABELS = ACCOUNT_REF_LABELS

// Bloque D (modulo 'cuentas'): registro de cuentas de tesoreria. Las ventas
// acreditan su cuenta en tiempo real (efectivo por moneda, transferencias);
// extracciones y pagos a proveedores debitan. Saldo = creditos - debitos.
export function AccountsScreen() {
  const { user, isManager, can } = useAuth()
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
  // Cobros de mesa anteriores al fix que aun no entraron a tesoreria (backfill).
  const pendingMesa = useLiveQuery(() => accountsRepo.pendingMesaIncomeCount(), [], 0)
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

      {/* Modificar (crear cuenta): el dueño puede quitarle esta facultad al admin. */}
      {can('accounts') && (
        <button className="btn btn--ghost btn--block" onClick={() => setCreating(true)}>
          + Crear otra cuenta
        </button>
      )}

      {/* Regularizar (backfill) ingresos de mesa anteriores al fix. Solo aparece
          si hay pendientes y el usuario puede modificar cuentas; se oculta al
          terminar. Idempotente: seguro de ejecutar. */}
      {can('accounts') && pendingMesa > 0 && (
        <MesaBackfill pending={pendingMesa} userId={user.id} />
      )}

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

// Importes de un concepto POR MONEDA: [[moneda, monto], ...] con lo que no es cero.
// El dinero de cada moneda va por su lado (no se convierte a MN con la tasa: la de
// hoy no es la del dia del movimiento). Mismo criterio que el panel de custodia.
function concepto(map, key) {
  return Object.entries(map?.[key] || {}).filter(([, v]) => Math.abs(Number(v) || 0) >= 0.01)
}

// Opcion B: ingresos por concepto (de que actividad vino el dinero) y egresos.
function IncomeByConcept({ byConcept }) {
  const { credits = {}, debits = {} } = byConcept || {}
  // Cada fila se pinta solo si tiene importe, asi que las claves del modulo
  // 'remesas' ('entrega' ingreso, 'fondo' en los DOS lados) no cambian nada sin el
  // modulo: sin entregas ni fondos no hay movimientos y no se renderizan.
  //
  // 'fondo' va en las dos listas a proposito: sale de la cuenta (egreso) y VUELVE
  // cuando el mensajero lo devuelve. Antes solo se pintaba la salida, asi que el
  // egreso se leia en BRUTO —"Fondo de mensajeros −5 000" aunque hubiera devuelto
  // 4 000—. Ahora se ven las dos patas y el neto se saca de un vistazo; el que vuelve
  // lleva su propia etiqueta (no es un ingreso del negocio, es dinero suyo que regresa).
  const incomeKeys = ['own', 'consignment', 'thirdparty', 'entrega', 'fondo']
  const egressKeys = ['provider', 'withdrawal', 'fondo']
  const anyIncome = incomeKeys.some((k) => concepto(credits, k).length > 0)
  const anyEgress = egressKeys.some((k) => concepto(debits, k).length > 0)
  if (!anyIncome && !anyEgress) return null

  return (
    <section className="card">
      <h3>Ingresos por concepto</h3>
      <p className="muted">De qué actividad vino el dinero (cada moneda por separado, todo el historial).</p>
      {incomeKeys.map((k) => concepto(credits, k).length > 0 && (
        <div key={k} className="kv">
          <span className="muted">{conceptLabel(k, 'credit')}</span>
          <strong className="ok-text">
            {concepto(credits, k).map(([c, v]) => `+${formatMoney(v, c)}`).join(' · ')}
          </strong>
        </div>
      ))}
      {anyEgress && <p className="muted" style={{ marginTop: 8 }}>Egresos</p>}
      {egressKeys.map((k) => concepto(debits, k).length > 0 && (
        <div key={k} className="kv">
          <span className="muted">{conceptLabel(k, 'debit')}</span>
          <strong className="warn-text">
            {concepto(debits, k).map(([c, v]) => `−${formatMoney(v, c)}`).join(' · ')}
          </strong>
        </div>
      ))}
    </section>
  )
}

// Regularizacion (backfill) de los cobros de mesa que no entraron a tesoreria
// antes del fix. Idempotente (no duplica); crea cada ingreso con la fecha
// original de su venta. Solo se muestra si hay pendientes.
function MesaBackfill({ pending, userId }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const run = async () => {
    if (!confirm(`Se creará el ingreso en tesorería de ${pending} cobro(s) de mesa anteriores, con su fecha original. Es seguro y no duplica. ¿Continuar?`)) return
    setBusy(true)
    setResult(null)
    try {
      const r = await accountsRepo.backfillMesaSaleIncome({ userId })
      setResult(r)
    } catch (e) {
      setResult({ error: e.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card card--warn">
      <h3>Regularizar ingresos de mesas</h3>
      <p className="muted">
        Hay <strong>{pending}</strong> cobro(s) de mesa anteriores que no entraron a las cuentas
        (ya se corrigió para que entren solos). Al regularizar se crea su ingreso con la
        <strong> fecha original</strong>. Es seguro: no duplica si lo repites.
      </p>
      {result && !result.error && (
        <p className="ok-text">
          ✓ Regularizados {result.credited} cobro(s)
          {result.skipped ? ` · ${result.skipped} ya estaban al día` : ''}.
        </p>
      )}
      {result?.error && <p className="error">Error: {result.error}</p>}
      <button className="btn btn--primary btn--block" disabled={busy} onClick={run}>
        {busy ? 'Regularizando…' : `Regularizar ${pending} cobro(s)`}
      </button>
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
  const { can } = useAuth()
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
        {/* Modificar (ajuste manual): el dueño puede quitarle esta facultad al admin. */}
        {can('accounts') && (
          <button className="btn btn--ghost btn--block" onClick={() => setAdjusting(true)}>
            Registrar ajuste manual
          </button>
        )}
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
