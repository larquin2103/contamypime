import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft } from 'lucide-react'
import { remittancesRepo } from '../../repositories/remittancesRepo'
import { custodyRepo } from '../../repositories/custodyRepo'
import { settlementsRepo } from '../../repositories/settlementsRepo'
import { usersRepo } from '../../repositories/usersRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { formatMoney, round2 } from '../../lib/currency'
import { formatDateTime } from '../../lib/dates'
import { fileToThumbnail } from '../../lib/image'
import { useEscapeClose } from '../../lib/useEscapeClose'
import { SEMAPHORE_EMOJI } from '../../lib/semaphore'
import { remittanceGroup } from '../../lib/remesas'
import {
  CASH_CURRENCIES, ROLES, REMITTANCE_STATUS, REMITTANCE_STATUS_LABELS,
  REMESA_CENTRAL, REMESA_CENTRAL_LABEL
} from '../../db/constants'

// Modulo 'remesas' (F2 Ordenes · F3 Custodia · F4 Mensajeros · F5 Entregas).
// Pantalla unica con conciencia de ROL:
//  - MANDO (dueño/admin): crea y sigue las ordenes, avanza pago/validacion,
//    ASIGNA el efectivo a un mensajero y ve la custodia de todos.
//  - MENSAJERO (rol acotado): ve SOLO sus remesas asignadas y su efectivo en
//    custodia; ENTREGA al beneficiario o marca fallida (devuelve el efectivo).
// Gateada por la licencia 'remesas'; sin ella, no aparece nada.

// Monedas ofrecidas para el monto (efectivo MN/USD + MLC electronico).
const CURRENCY_OPTIONS = [...new Set([...CASH_CURRENCIES, 'MLC'])]

// Avance lineal de estado PREVIO a la custodia (solo el mando).
const FORWARD = {
  [REMITTANCE_STATUS.CREATED]: { to: REMITTANCE_STATUS.PAID, label: 'Registrar pago' },
  [REMITTANCE_STATUS.PAID]: { to: REMITTANCE_STATUS.VALIDATED, label: 'Validar pago' },
  [REMITTANCE_STATUS.VALIDATED]: { to: REMITTANCE_STATUS.FUNDS_AVAILABLE, label: 'Marcar fondos disponibles' }
}

// Estados desde los que se puede cancelar SIN mover efectivo (antes del pago). Tras
// marcar Pagada, el efectivo ya entro a la caja central de custodia; cancelar
// entonces exigiria un reembolso (flujo de devolucion), que llega en una fase
// posterior. Por eso se limita la cancelacion a antes del pago: nunca deja dinero
// de custodia sin resolver.
const CANCELLABLE = new Set([
  REMITTANCE_STATUS.CREATED,
  REMITTANCE_STATUS.PAYMENT_PENDING
])

function StatusBadge({ status }) {
  const cancelled = status === REMITTANCE_STATUS.CANCELLED || status === REMITTANCE_STATUS.RETURNED
  return (
    <span className={`badge ${cancelled ? 'warn-text' : ''}`}>
      {REMITTANCE_STATUS_LABELS[status] || status}
    </span>
  )
}

// Badge del GRUPO legible (Por cobrar / En proceso / Completado): lo ve el dueno en
// la lista para saber de un vistazo en que va cada entrega. El detalle sigue
// mostrando el estado preciso (StatusBadge).
function GroupBadge({ remittance }) {
  const g = remittanceGroup(remittance)
  const cls =
    g.tone === 'ok' ? 'badge--ok' : g.tone === 'warn' ? 'badge--warn' : g.tone === 'bad' ? 'badge--bad' : 'badge--muted'
  return <span className={`badge ${cls}`}>{g.label}</span>
}

// Panel de custodia: saldo de efectivo por tenedor (derivado del libro). El mando
// ve todos los tenedores (caja central + mensajeros); el mensajero ve SOLO el suyo
// (mineId). Se oculta si no hay efectivo en custodia (todo en cero).
function CustodyPanel({ balances, userName, mineId = null }) {
  let entries = Object.entries(balances || {})
  if (mineId) entries = entries.filter(([h]) => h === mineId)
  const holders = entries
    .map(([holder, byCur]) => [holder, Object.entries(byCur).filter(([, a]) => Math.abs(Number(a) || 0) >= 0.01)])
    .filter(([, curs]) => curs.length > 0)
  if (holders.length === 0) return null
  const label = (h) =>
    h === REMESA_CENTRAL ? REMESA_CENTRAL_LABEL : (h === mineId ? 'Tu efectivo en custodia' : userName(h))
  return (
    <section className="card">
      <h3>Custodia de efectivo</h3>
      {holders.map(([holder, curs]) => (
        <div key={holder} className="kv">
          <span className="muted">{label(holder)}</span>
          <strong>{curs.map(([c, a]) => formatMoney(a, c)).join(' · ')}</strong>
        </div>
      ))}
    </section>
  )
}

export function RemesasScreen() {
  const { user, isManager, isCourier } = useAuth()
  const { hasModule } = useLicense()
  const navigate = useNavigate()

  const canRemesas = hasModule(LICENSE_MODULES.REMESAS)
  const allRemittances = useLiveQuery(() => remittancesRepo.list(), [], [])
  const custody = useLiveQuery(() => custodyRepo.balances(), [], {})
  const users = useLiveQuery(() => usersRepo.list(), [], [])
  const settlements = useLiveQuery(() => settlementsRepo.list(), [], [])
  const [openId, setOpenId] = useState(null)
  const [creating, setCreating] = useState(false)

  if (!(isManager || isCourier) || !canRemesas) {
    return (
      <div className="screen">
        <h2>Entregas</h2>
        <p className="muted">
          {(isManager || isCourier)
            ? 'Tu licencia no incluye el módulo de entregas.'
            : 'No tienes acceso a las entregas.'}
        </p>
        <Link className="btn btn--primary btn--block" to="/">Volver</Link>
      </div>
    )
  }

  const userName = (id) => users.find((u) => u.id === id)?.name || '—'
  const couriers = users.filter((u) => u.role === ROLES.COURIER && u.active)
  // El mensajero ve SOLO sus remesas asignadas; el mando ve todas.
  const remittances = isManager ? allRemittances : allRemittances.filter((r) => r.assignedCourierId === user.id)

  const open = openId ? remittances.find((r) => r.id === openId) : null
  if (open) {
    return (
      <RemittanceDetail
        remittance={open}
        userId={user.id}
        isManager={isManager}
        couriers={couriers}
        userName={userName}
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
        <h2 className="pos-nav__title">{isManager ? 'Entregas' : 'Mis entregas'}</h2>
        <span className="pos-nav__action" />
      </div>
      <p className="muted">
        {isManager
          ? 'Órdenes de entrega. Crea, cobra, valida y asigna el efectivo a un mensajero.'
          : 'Tus entregas asignadas. Entrega al beneficiario o marca fallida para devolver el efectivo.'}
      </p>

      <CustodyPanel balances={custody} userName={userName} mineId={isManager ? null : user.id} />

      {isManager && (
        <button className="btn btn--primary btn--block" onClick={() => setCreating(true)}>
          + Nueva entrega
        </button>
      )}

      <div className="list">
        {remittances.length === 0 ? (
          <p className="muted">
            {isManager ? 'Aún no hay entregas. Crea la primera con “Nueva entrega”.' : 'No tienes entregas asignadas.'}
          </p>
        ) : (
          remittances.map((r) => (
            <button key={r.id} className="list-item help-item" onClick={() => setOpenId(r.id)}>
              <span className="help-item__text">
                <strong>{r.beneficiary?.name || 'Beneficiario'}</strong>
                <span className="muted">
                  De {r.sender?.name || '—'} · <GroupBadge remittance={r} />
                </span>
              </span>
              <strong>{formatMoney(Number(r.amount) || 0, r.currency)}</strong>
            </button>
          ))
        )}
      </div>

      {isManager && (
        <SettlementsSection
          couriers={couriers}
          balances={custody}
          settlements={settlements}
          userId={user.id}
          userName={userName}
        />
      )}

      {creating && <RemittanceForm userId={user.id} onClose={() => setCreating(false)} />}
    </div>
  )
}

// Detalle de una remesa: partes, monto, estado y acciones segun el rol.
function RemittanceDetail({ remittance: r, userId, isManager, couriers, userName, onBack }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [delivering, setDelivering] = useState(false)

  const isAssignedToMe = r.assignedCourierId === userId
  const forward = isManager ? FORWARD[r.status] : null
  const canAssign = isManager && r.status === REMITTANCE_STATUS.FUNDS_AVAILABLE
  const canEdit = isManager && r.status === REMITTANCE_STATUS.CREATED
  const canCancel = isManager && CANCELLABLE.has(r.status)
  const canDeliver =
    (r.status === REMITTANCE_STATUS.ASSIGNED || r.status === REMITTANCE_STATUS.IN_ROUTE) &&
    (isManager || isAssignedToMe)
  const noActions = !forward && !canAssign && !canDeliver && !canEdit && !canCancel

  const run = async (fn, confirmMsg) => {
    if (confirmMsg && !confirm(confirmMsg)) return
    setError('')
    setBusy(true)
    try {
      await fn()
      onBack() // vuelve a la lista (reactiva: refleja el nuevo estado)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  const advance = (toStatus) => run(() => remittancesRepo.setStatus(r.id, toStatus, { actorId: userId }))
  const cancel = () =>
    run(
      () => remittancesRepo.setStatus(r.id, REMITTANCE_STATUS.CANCELLED, { actorId: userId, note: 'Cancelada por el mando' }),
      '¿Cancelar esta entrega? Queda registrada como cancelada (no se borra).'
    )
  const fail = () =>
    run(
      () => remittancesRepo.failReturn(r.id, { actorId: userId }),
      '¿Entrega fallida? Se devuelve el efectivo a la caja central y la entrega queda como devuelta.'
    )

  return (
    <div className="screen">
      <button className="pos-nav__back help-back" onClick={onBack} aria-label="Volver a entregas">
        <ChevronLeft size={20} strokeWidth={2} /> Entregas
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
        {r.assignedCourierId && (
          <div className="kv">
            <span className="muted">Mensajero</span>
            <span>{userName(r.assignedCourierId)}</span>
          </div>
        )}
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
        {canAssign && (
          <button className="btn btn--primary btn--block" disabled={busy} onClick={() => setAssigning(true)}>
            Asignar a mensajero
          </button>
        )}
        {canDeliver && (
          <>
            <button className="btn btn--primary btn--block" disabled={busy} onClick={() => setDelivering(true)}>
              Marcar entregada
            </button>
            <button className="btn btn--ghost btn--block warn-text" disabled={busy} onClick={fail}>
              Entrega fallida (devolver efectivo)
            </button>
          </>
        )}
        {canEdit && (
          <button className="btn btn--ghost btn--block" disabled={busy} onClick={() => setEditing(true)}>
            Editar datos
          </button>
        )}
        {canCancel && (
          <button className="btn btn--ghost btn--block warn-text" disabled={busy} onClick={cancel}>
            Cancelar entrega
          </button>
        )}
        {noActions && <p className="muted">Sin acciones disponibles para este estado.</p>}
      </section>

      {editing && <RemittanceForm userId={userId} existing={r} onClose={() => setEditing(false)} />}
      {assigning && (
        <AssignModal remittance={r} userId={userId} couriers={couriers} onClose={() => setAssigning(false)} onDone={onBack} />
      )}
      {delivering && (
        <DeliverModal remittance={r} userId={userId} onClose={() => setDelivering(false)} onDone={onBack} />
      )}
    </div>
  )
}

// Asigna la remesa (con fondos disponibles) a un mensajero: el efectivo pasa de la
// caja central a su custodia.
function AssignModal({ remittance: r, userId, couriers, onClose, onDone }) {
  const [courierId, setCourierId] = useState(couriers[0]?.id || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEscapeClose(onClose)

  const save = async () => {
    setError('')
    setBusy(true)
    try {
      await remittancesRepo.assign(r.id, courierId, { actorId: userId })
      onDone()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>Asignar a mensajero</h3>
        <p className="muted">
          Se entregan <strong>{formatMoney(Number(r.amount) || 0, r.currency)}</strong> en custodia al mensajero.
        </p>
        {couriers.length === 0 ? (
          <p className="muted">No hay mensajeros activos. Crea uno en <strong>Usuarios</strong> (rol Mensajero).</p>
        ) : (
          <label className="field">
            <span>Mensajero</span>
            <select value={courierId} onChange={(e) => setCourierId(e.target.value)}>
              {couriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" disabled={busy || !courierId} onClick={save}>
            {busy ? 'Asignando…' : 'Asignar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Entrega al beneficiario: comprobante (foto) opcional y nota. Al confirmar, el
// efectivo sale de la custodia del mensajero y la remesa queda ENTREGADA.
function DeliverModal({ remittance: r, userId, onClose, onDone }) {
  const [proof, setProof] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEscapeClose(onClose)

  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    setBusy(true)
    try {
      setProof(await fileToThumbnail(file, { fit: 'contain' }))
    } catch (err) {
      setError('No se pudo procesar la imagen: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    setError('')
    setBusy(true)
    try {
      await remittancesRepo.deliver(r.id, { proofDataUrl: proof, note, actorId: userId })
      onDone()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>Entregar al beneficiario</h3>
        <p className="muted">
          Se entregan <strong>{formatMoney(Number(r.amount) || 0, r.currency)}</strong> a{' '}
          <strong>{r.beneficiary?.name || 'el beneficiario'}</strong>. Confirma cuando lo haya recibido.
        </p>

        <p className="field-label">Comprobante (opcional)</p>
        <div className="img-picker__actions">
          <label className={`btn btn--ghost btn--sm ${busy ? 'is-disabled' : ''}`}>
            {proof ? 'Cambiar foto' : 'Agregar foto'}
            <input type="file" accept="image/*" onChange={pick} disabled={busy} hidden />
          </label>
          {proof && !busy && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setProof('')}>Quitar</button>
          )}
        </div>
        {proof && <img src={proof} alt="Comprobante" style={{ maxWidth: '100%', borderRadius: 8, marginTop: 8 }} />}

        <label className="field">
          <span>Nota (opcional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: recibió su hijo" />
        </label>

        {error && <p className="error">{error}</p>}
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" disabled={busy} onClick={save}>
            {busy ? 'Guardando…' : 'Confirmar entrega'}
          </button>
        </div>
      </div>
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
        <h3>{isEdit ? 'Editar entrega' : 'Nueva entrega'}</h3>

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
            {busy ? 'Guardando…' : (isEdit ? 'Guardar cambios' : 'Crear entrega')}
          </button>
        </div>
      </div>
    </div>
  )
}

// Primera moneda con diferencia distinta de cero de un mapa { moneda: valor }.
function firstNonZeroDiff(map) {
  for (const [currency, v] of Object.entries(map || {})) {
    if (Math.abs(Number(v) || 0) >= 0.01) return { currency, value: round2(Number(v)) }
  }
  return null
}

// Liquidaciones (F6, solo mando): cuadra el efectivo en custodia de un mensajero
// (teorico del libro vs contado fisico + semaforo) y muestra las recientes.
function SettlementsSection({ couriers, balances, settlements, userId, userName }) {
  const [settling, setSettling] = useState(false)
  const recent = (settlements || []).slice(0, 8)
  return (
    <section className="card">
      <h3>Liquidaciones</h3>
      <p className="muted">Cuadra el efectivo en custodia de un mensajero: teórico (libro) vs contado.</p>
      <button className="btn btn--ghost btn--block" onClick={() => setSettling(true)}>
        Liquidar mensajero
      </button>
      {recent.length > 0 && (
        <div className="list">
          {recent.map((s) => {
            const nz = firstNonZeroDiff(s.difference)
            return (
              <div key={s.id} className="audit-row">
                <div className="audit-row__head">
                  <strong>{SEMAPHORE_EMOJI[s.semaphore] || ''} {userName(s.courierId)}</strong>
                  <span className={nz && nz.value < 0 ? 'warn-text' : 'ok-text'}>
                    {nz ? `${nz.value > 0 ? '+' : ''}${nz.value} ${nz.currency}` : 'Cuadró'}
                  </span>
                </div>
                <span className="muted">{formatDateTime(s.settledAt || s.createdAt)}</span>
              </div>
            )
          })}
        </div>
      )}
      {settling && (
        <SettleModal
          couriers={couriers}
          balances={balances}
          userId={userId}
          onClose={() => setSettling(false)}
          onDone={() => setSettling(false)}
        />
      )}
    </section>
  )
}

// Modal de liquidacion: elige mensajero, muestra el teorico por moneda (derivado
// del libro), teclea lo contado y ve la diferencia en vivo. Al registrar, guarda el
// snapshot append-only (no mueve el libro; una diferencia queda marcada).
function SettleModal({ couriers, balances, userId, onClose, onDone }) {
  const [courierId, setCourierId] = useState(couriers[0]?.id || '')
  const [counted, setCounted] = useState({})
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEscapeClose(onClose)

  const theoretical = balances[courierId] || {}
  const currencies = Object.keys(theoretical).length ? Object.keys(theoretical) : ['MN']
  const changeCourier = (id) => { setCourierId(id); setCounted({}) }
  const setCur = (c, v) => setCounted((p) => ({ ...p, [c]: v }))

  const save = async () => {
    setError('')
    setBusy(true)
    try {
      const countedNum = {}
      for (const c of currencies) countedNum[c] = Number(counted[c]) || 0
      await settlementsRepo.create({ courierId, counted: countedNum, note, settledBy: userId })
      onDone()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>Liquidar mensajero</h3>
        {couriers.length === 0 ? (
          <p className="muted">No hay mensajeros activos. Crea uno en <strong>Usuarios</strong> (rol Mensajero).</p>
        ) : (
          <>
            <label className="field">
              <span>Mensajero</span>
              <select value={courierId} onChange={(e) => changeCourier(e.target.value)}>
                {couriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <p className="muted">Teórico en custodia (según el libro) frente a lo que cuentas físicamente:</p>
            {currencies.map((c) => {
              const th = round2(Number(theoretical[c]) || 0)
              const cnt = Number(counted[c]) || 0
              const diff = round2(cnt - th)
              return (
                <div key={c} style={{ marginBottom: 12 }}>
                  <div className="kv">
                    <span className="muted">Teórico {c}</span>
                    <strong>{formatMoney(th, c)}</strong>
                  </div>
                  <label className="field">
                    <span>Contado {c}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={counted[c] ?? ''}
                      onChange={(e) => setCur(c, e.target.value)}
                      placeholder="0"
                    />
                  </label>
                  <div className="kv">
                    <span className="muted">Diferencia</span>
                    <strong className={Math.abs(diff) >= 0.01 ? 'warn-text' : 'ok-text'}>
                      {diff > 0 ? '+' : ''}{diff} {c}
                    </strong>
                  </div>
                </div>
              )
            })}
            <label className="field">
              <span>Nota (opcional)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Observaciones" />
            </label>
          </>
        )}
        {error && <p className="error">{error}</p>}
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" disabled={busy || !courierId} onClick={save}>
            {busy ? 'Guardando…' : 'Registrar liquidación'}
          </button>
        </div>
      </div>
    </div>
  )
}
