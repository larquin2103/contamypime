import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft } from 'lucide-react'
import { remittancesRepo } from '../../repositories/remittancesRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { formatMoney } from '../../lib/currency'
import { formatDateTime } from '../../lib/dates'
import { useEscapeClose } from '../../lib/useEscapeClose'
import { CASH_CURRENCIES, REMITTANCE_STATUS, REMITTANCE_STATUS_LABELS } from '../../db/constants'

// Modulo 'remesas' (F2 — Ordenes). Pantalla del MANDO para crear y seguir las
// ordenes de remesa: alta con remitente/beneficiario/monto congelados y avance de
// estado PREVIO a la custodia (pago -> validacion -> fondos disponibles) o
// cancelacion. La custodia de efectivo y la asignacion a mensajeros llegan en
// fases posteriores. Gateada por la licencia 'remesas'; sin ella, no aparece nada.

// Monedas ofrecidas para el monto (efectivo MN/USD + MLC electronico), igual que
// en la pantalla de Cuentas.
const CURRENCY_OPTIONS = [...new Set([...CASH_CURRENCIES, 'MLC'])]

// Avance lineal de estado en esta fase (solo etapas previas a la custodia).
const FORWARD = {
  [REMITTANCE_STATUS.CREATED]: { to: REMITTANCE_STATUS.PAID, label: 'Registrar pago' },
  [REMITTANCE_STATUS.PAID]: { to: REMITTANCE_STATUS.VALIDATED, label: 'Validar pago' },
  [REMITTANCE_STATUS.VALIDATED]: { to: REMITTANCE_STATUS.FUNDS_AVAILABLE, label: 'Marcar fondos disponibles' }
}

// Estados desde los que se puede cancelar en esta fase (aun no hay efectivo movido).
const CANCELLABLE = new Set([
  REMITTANCE_STATUS.CREATED,
  REMITTANCE_STATUS.PAYMENT_PENDING,
  REMITTANCE_STATUS.PAID,
  REMITTANCE_STATUS.VALIDATED,
  REMITTANCE_STATUS.FUNDS_AVAILABLE
])

function StatusBadge({ status }) {
  const cancelled = status === REMITTANCE_STATUS.CANCELLED
  return (
    <span className={`badge ${cancelled ? 'warn-text' : ''}`}>
      {REMITTANCE_STATUS_LABELS[status] || status}
    </span>
  )
}

export function RemesasScreen() {
  const { user, isManager } = useAuth()
  const { hasModule } = useLicense()
  const navigate = useNavigate()

  const canRemesas = hasModule(LICENSE_MODULES.REMESAS)
  const remittances = useLiveQuery(() => remittancesRepo.list(), [], [])
  const [openId, setOpenId] = useState(null)
  const [creating, setCreating] = useState(false)

  if (!isManager || !canRemesas) {
    return (
      <div className="screen">
        <h2>Remesas</h2>
        <p className="muted">
          {isManager
            ? 'Tu licencia no incluye el módulo de remesas.'
            : 'Solo el dueño o un administrativo puede gestionar las remesas.'}
        </p>
        <Link className="btn btn--primary btn--block" to="/">Volver</Link>
      </div>
    )
  }

  const open = openId ? remittances.find((r) => r.id === openId) : null
  if (open) {
    return <RemittanceDetail remittance={open} userId={user.id} onBack={() => setOpenId(null)} />
  }

  return (
    <div className="screen">
      <div className="pos-nav">
        <button className="pos-nav__back" onClick={() => navigate(-1)} aria-label="Volver">
          <ChevronLeft size={20} strokeWidth={2} />
        </button>
        <h2 className="pos-nav__title">Remesas</h2>
        <span className="pos-nav__action" />
      </div>
      <p className="muted">
        Órdenes de remesa. Cada orden congela remitente, beneficiario y monto al crearse.
        Toca una para ver el detalle y avanzar su estado.
      </p>

      <button className="btn btn--primary btn--block" onClick={() => setCreating(true)}>
        + Nueva remesa
      </button>

      <div className="list">
        {remittances.length === 0 ? (
          <p className="muted">Aún no hay remesas. Crea la primera con “Nueva remesa”.</p>
        ) : (
          remittances.map((r) => (
            <button key={r.id} className="list-item help-item" onClick={() => setOpenId(r.id)}>
              <span className="help-item__text">
                <strong>{r.beneficiary?.name || 'Beneficiario'}</strong>
                <span className="muted">
                  De {r.sender?.name || '—'} · <StatusBadge status={r.status} />
                </span>
              </span>
              <strong>{formatMoney(Number(r.amount) || 0, r.currency)}</strong>
            </button>
          ))
        )}
      </div>

      {creating && <RemittanceForm userId={user.id} onClose={() => setCreating(false)} />}
    </div>
  )
}

// Detalle de una remesa: partes, monto, estado y acciones de esta fase.
function RemittanceDetail({ remittance: r, userId, onBack }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)

  const forward = FORWARD[r.status]
  const canCancel = CANCELLABLE.has(r.status)
  const canEdit = r.status === REMITTANCE_STATUS.CREATED

  const advance = async (toStatus, note = '') => {
    setError('')
    setBusy(true)
    try {
      await remittancesRepo.setStatus(r.id, toStatus, { actorId: userId, note })
      onBack() // vuelve a la lista (la lista es reactiva y refleja el nuevo estado)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  const cancel = async () => {
    if (!confirm('¿Cancelar esta remesa? Queda registrada como cancelada (no se borra).')) return
    await advance(REMITTANCE_STATUS.CANCELLED, 'Cancelada por el mando')
  }

  return (
    <div className="screen">
      <button className="pos-nav__back help-back" onClick={onBack} aria-label="Volver a remesas">
        <ChevronLeft size={20} strokeWidth={2} /> Remesas
      </button>

      <section className="card">
        <div className="total-row">
          <span>Monto</span>
          <strong className="total-amount">{formatMoney(Number(r.amount) || 0, r.currency)}</strong>
        </div>
        <div className="kv">
          <span className="muted">Estado</span>
          <StatusBadge status={r.status} />
        </div>
        {Number(r.fee) > 0 && (
          <div className="kv">
            <span className="muted">Cargo</span>
            <strong>{formatMoney(Number(r.fee) || 0, r.currency)}</strong>
          </div>
        )}
        <div className="kv">
          <span className="muted">Creada</span>
          <span>{formatDateTime(r.createdAt)}</span>
        </div>
        {r.updatedAt && r.updatedAt !== r.createdAt && (
          <div className="kv">
            <span className="muted">Última actualización</span>
            <span>{formatDateTime(r.updatedAt)}</span>
          </div>
        )}
      </section>

      <section className="card">
        <h3>Remitente</h3>
        <p><strong>{r.sender?.name || '—'}</strong></p>
        {r.sender?.phone && <p className="muted">Tel: {r.sender.phone}</p>}
        {r.sender?.idDoc && <p className="muted">ID: {r.sender.idDoc}</p>}
      </section>

      <section className="card">
        <h3>Beneficiario</h3>
        <p><strong>{r.beneficiary?.name || '—'}</strong></p>
        {r.beneficiary?.phone && <p className="muted">Tel: {r.beneficiary.phone}</p>}
        {r.beneficiary?.address && <p className="muted">Dirección: {r.beneficiary.address}</p>}
        {r.beneficiary?.idDoc && <p className="muted">ID: {r.beneficiary.idDoc}</p>}
      </section>

      {r.note && (
        <section className="card">
          <h3>Nota</h3>
          <p className="muted">{r.note}</p>
        </section>
      )}

      {error && <p className="error">{error}</p>}

      <section className="card">
        <h3>Acciones</h3>
        {forward && (
          <button className="btn btn--primary btn--block" disabled={busy} onClick={() => advance(forward.to)}>
            {busy ? 'Guardando…' : forward.label}
          </button>
        )}
        {r.status === REMITTANCE_STATUS.FUNDS_AVAILABLE && (
          <p className="muted">
            Fondos disponibles. La asignación a un mensajero se habilitará en la próxima fase.
          </p>
        )}
        {canEdit && (
          <button className="btn btn--ghost btn--block" disabled={busy} onClick={() => setEditing(true)}>
            Editar datos
          </button>
        )}
        {canCancel && (
          <button className="btn btn--ghost btn--block warn-text" disabled={busy} onClick={cancel}>
            Cancelar remesa
          </button>
        )}
        {!forward && !canCancel && r.status !== REMITTANCE_STATUS.FUNDS_AVAILABLE && (
          <p className="muted">Sin acciones disponibles para este estado.</p>
        )}
      </section>

      {editing && (
        <RemittanceForm userId={userId} existing={r} onClose={() => setEditing(false)} />
      )}
    </div>
  )
}

// Formulario de alta / edicion (edicion solo permitida en estado CREATED, lo
// valida el repo). Congela remitente/beneficiario/monto al crear.
function RemittanceForm({ userId, existing = null, onClose }) {
  const isEdit = !!existing
  const [amount, setAmount] = useState(existing ? String(existing.amount ?? '') : '')
  const [currency, setCurrency] = useState(existing?.currency || 'MN')
  const [fee, setFee] = useState(existing ? String(existing.fee ?? '') : '')
  const [sName, setSName] = useState(existing?.sender?.name || '')
  const [sPhone, setSPhone] = useState(existing?.sender?.phone || '')
  const [sId, setSId] = useState(existing?.sender?.idDoc || '')
  const [bName, setBName] = useState(existing?.beneficiary?.name || '')
  const [bPhone, setBPhone] = useState(existing?.beneficiary?.phone || '')
  const [bAddr, setBAddr] = useState(existing?.beneficiary?.address || '')
  const [bId, setBId] = useState(existing?.beneficiary?.idDoc || '')
  const [note, setNote] = useState(existing?.note || '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEscapeClose(onClose)

  const save = async () => {
    setError('')
    setBusy(true)
    const payload = {
      amount,
      currency,
      fee,
      note,
      sender: { name: sName, phone: sPhone, idDoc: sId },
      beneficiary: { name: bName, phone: bPhone, address: bAddr, idDoc: bId }
    }
    try {
      if (isEdit) {
        await remittancesRepo.update(existing.id, payload, { actorId: userId })
      } else {
        await remittancesRepo.create({ ...payload, createdBy: userId })
      }
      onClose()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>{isEdit ? 'Editar remesa' : 'Nueva remesa'}</h3>

        <div className="form-row">
          <label className="field">
            <span>Monto *</span>
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
            <span>Moneda</span>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Cargo (opcional)</span>
          <input
            type="number"
            inputMode="decimal"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            placeholder="0"
          />
        </label>

        <h4>Remitente</h4>
        <label className="field">
          <span>Nombre *</span>
          <input value={sName} onChange={(e) => setSName(e.target.value)} placeholder="Quién envía" />
        </label>
        <div className="form-row">
          <label className="field">
            <span>Teléfono</span>
            <input value={sPhone} onChange={(e) => setSPhone(e.target.value)} placeholder="Opcional" />
          </label>
          <label className="field">
            <span>ID / Carné</span>
            <input value={sId} onChange={(e) => setSId(e.target.value)} placeholder="Opcional" />
          </label>
        </div>

        <h4>Beneficiario</h4>
        <label className="field">
          <span>Nombre *</span>
          <input value={bName} onChange={(e) => setBName(e.target.value)} placeholder="Quién recibe" />
        </label>
        <label className="field">
          <span>Dirección</span>
          <input value={bAddr} onChange={(e) => setBAddr(e.target.value)} placeholder="Opcional" />
        </label>
        <div className="form-row">
          <label className="field">
            <span>Teléfono</span>
            <input value={bPhone} onChange={(e) => setBPhone(e.target.value)} placeholder="Opcional" />
          </label>
          <label className="field">
            <span>ID / Carné</span>
            <input value={bId} onChange={(e) => setBId(e.target.value)} placeholder="Opcional" />
          </label>
        </div>

        <label className="field">
          <span>Nota (opcional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Referencia interna" />
        </label>

        {error && <p className="error">{error}</p>}
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancelar</button>
          <button
            className="btn btn--primary"
            disabled={busy || !(Number(amount) > 0) || !sName.trim() || !bName.trim()}
            onClick={save}
          >
            {busy ? 'Guardando…' : (isEdit ? 'Guardar cambios' : 'Crear remesa')}
          </button>
        </div>
      </div>
    </div>
  )
}
