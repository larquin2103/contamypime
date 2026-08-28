import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft } from 'lucide-react'
import { remittancesRepo } from '../../repositories/remittancesRepo'
import { custodyRepo } from '../../repositories/custodyRepo'
import { settlementsRepo } from '../../repositories/settlementsRepo'
import { accountsRepo } from '../../repositories/accountsRepo'
import { productsRepo } from '../../repositories/productsRepo'
import { productCustodyRepo } from '../../repositories/productCustodyRepo'
import { usersRepo } from '../../repositories/usersRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { formatMoney, round2 } from '../../lib/currency'
import { formatDateTime } from '../../lib/dates'
import { fileToThumbnail } from '../../lib/image'
import { useEscapeClose } from '../../lib/useEscapeClose'
import { SEMAPHORE_EMOJI } from '../../lib/semaphore'
import { remittanceGroup, isPendingCollection } from '../../lib/remesas'
import {
  CASH_CURRENCIES, ROLES, REMITTANCE_STATUS, REMITTANCE_STATUS_LABELS,
  REMESA_CENTRAL, REMESA_CENTRAL_LABEL, PAYMENT_MODE, PAYMENT_MODE_LABELS, DELIVERY_FAIL_REASONS,
  DELIVERY_KIND, DELIVERY_KIND_LABELS, ENTREGAS_AREA, ENTREGAS_AREA_LABEL
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

// Avance de estado (solo el mando). Contra entrega: de creada, directo a "lista para
// asignar" (el cobro es despues de entregar). Anticipado: el avance lo hace "Registrar
// pago" (cobra a la cuenta y deja lista para asignar); por eso aqui no hay avance plano.
function forwardFor(r) {
  // LIQUIDADA (el efectivo del mensajero ya se concilió) -> se archiva.
  if (r.status === REMITTANCE_STATUS.SETTLED) {
    return { to: REMITTANCE_STATUS.CLOSED, label: 'Cerrar entrega' }
  }
  // Entregada y sin nada pendiente de cobrar -> se puede CERRAR (archivarla). Antes
  // se quedaba en "Entregada" para siempre y el estado CERRADA no se alcanzaba nunca.
  // Las de DINERO normalmente pasan antes por LIQUIDADA (al cuadrar al mensajero);
  // las de PRODUCTO no tocan la custodia de efectivo y se cierran directo desde aquí.
  if (r.status === REMITTANCE_STATUS.DELIVERED && !isPendingCollection(r)) {
    return { to: REMITTANCE_STATUS.CLOSED, label: 'Cerrar entrega' }
  }
  if (r.paymentMode === PAYMENT_MODE.ON_CREDIT) {
    return r.status === REMITTANCE_STATUS.CREATED
      ? { to: REMITTANCE_STATUS.FUNDS_AVAILABLE, label: 'Preparar para asignar' }
      : null
  }
  return null
}

// Estados desde los que se puede cancelar SIN mover dinero (antes de cobrar). Una vez
// registrado el cobro, el dinero YA ENTRO A UNA CUENTA de tesoreria; cancelar entonces
// exigiria un reembolso (flujo de devolucion), que llega en una fase posterior. Por eso
// se limita la cancelacion a antes del cobro: nunca deja dinero sin resolver.
const CANCELLABLE = new Set([
  REMITTANCE_STATUS.CREATED,
  REMITTANCE_STATUS.PAYMENT_PENDING
])

// Estados en los que la entrega sigue VIVA y el mando puede corregir sus datos de
// contacto (espeja EDITABLE_CONTACT de remittancesRepo, que es quien manda: aquí solo
// se decide si se ofrece el botón). Una entrega cerrada, cancelada o fallida no se toca.
const EDITABLE_CONTACT_UI = new Set([
  REMITTANCE_STATUS.CREATED,
  REMITTANCE_STATUS.PAYMENT_PENDING,
  REMITTANCE_STATUS.PAID,
  REMITTANCE_STATUS.VALIDATED,
  REMITTANCE_STATUS.FUNDS_AVAILABLE,
  REMITTANCE_STATUS.ASSIGNED,
  REMITTANCE_STATUS.HANDED_TO_COURIER,
  REMITTANCE_STATUS.IN_ROUTE,
  REMITTANCE_STATUS.DELIVERED
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

// Panel de custodia: saldo de efectivo por tenedor (derivado del libro). El mando ve
// todos los tenedores; el mensajero ve SOLO el suyo (mineId). Hoy los tenedores son
// los mensajeros: la "caja central" quedó retirada del flujo y solo puede aparecer
// aquí si el negocio tiene movimientos HISTÓRICOS contra ella (append-only, no se
// borran). Se oculta si no hay efectivo en custodia (todo en cero).
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

// Panel de custodia de PRODUCTO: lo que cada mensajero lleva encima (aislado del
// inventario general). El mando ve a todos; el mensajero ve lo suyo. Oculto si vacio.
function ProductCustodyPanel({ userName, mineId = null }) {
  const balances = useLiveQuery(() => productCustodyRepo.balances(), [], {})
  const movs = useLiveQuery(() => productCustodyRepo.allMovements(), [], [])
  const nameMap = {}
  for (const m of (movs || [])) if (m.name) nameMap[m.productId] = m.name
  let entries = Object.entries(balances || {})
  if (mineId) entries = entries.filter(([h]) => h === mineId)
  const holders = entries
    .map(([holder, byProd]) => [holder, Object.entries(byProd).filter(([, q]) => Math.abs(Number(q) || 0) >= 0.0005)])
    .filter(([, prods]) => prods.length > 0)
  if (holders.length === 0) return null
  const label = (h) => (h === mineId ? 'Tu carga de producto' : userName(h))
  return (
    <section className="card">
      <h3>Producto en poder del mensajero</h3>
      {holders.map(([holder, prods]) => (
        <div key={holder} style={{ marginBottom: 8 }}>
          <div className="muted">{label(holder)}</div>
          {prods.map(([pid, q]) => (
            <div key={pid} className="kv"><span>{nameMap[pid] || pid}</span><strong>× {q}</strong></div>
          ))}
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
  // "Por cobrar": entregas contra entrega ya entregadas y aun sin cobrar. Solo el mando.
  const pendingCount = isManager ? allRemittances.filter(isPendingCollection).length : 0

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

      {isManager && pendingCount > 0 && (
        <p style={{ marginTop: 4 }}>
          <span className="badge badge--bad">{pendingCount}</span>{' '}
          <span className="muted">por cobrar</span>
        </p>
      )}

      <CustodyPanel balances={custody} userName={userName} mineId={isManager ? null : user.id} />
      <ProductCustodyPanel userName={userName} mineId={isManager ? null : user.id} />

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

      {isManager && <PendingCollectionsSection remittances={allRemittances} userId={user.id} />}

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
  const [collecting, setCollecting] = useState(false)
  const [failing, setFailing] = useState(false)

  const isAssignedToMe = r.assignedCourierId === userId
  const forward = isManager ? forwardFor(r) : null
  const canAssign = isManager && r.status === REMITTANCE_STATUS.FUNDS_AVAILABLE
  // Editar: el monto y los productos solo antes de cobrar (CREADA); los datos de
  // CONTACTO mientras la entrega siga viva —corregir un teléfono o una dirección no
  // toca ni un centavo ni una existencia, y es lo que hace falta corregir sobre la
  // marcha—. El repo vuelve a comprobarlo (la UI no es el candado).
  const canEdit = isManager && !r.deletedAt && EDITABLE_CONTACT_UI.has(r.status)
  const canCancel = isManager && CANCELLABLE.has(r.status)
  const canDeliver =
    (r.status === REMITTANCE_STATUS.ASSIGNED || r.status === REMITTANCE_STATUS.IN_ROUTE) &&
    (isManager || isAssignedToMe)
  // Cobro al remitente: solo el mando, en entrega contra entrega ya entregada y sin cobrar.
  const canCollect = isManager && isPendingCollection(r)
  // Pago anticipado: cobra a la cuenta ANTES de asignar (deja la entrega lista para asignar).
  const canPay = isManager && r.paymentMode !== PAYMENT_MODE.ON_CREDIT && !r.collectedAt &&
    (r.status === REMITTANCE_STATUS.CREATED || r.status === REMITTANCE_STATUS.PAYMENT_PENDING)
  // Eliminar (borrado LOGICO): solo el mando y solo si no se movio nada — sin cobro
  // registrado y sin mensajero asignado. Con algo movido, el camino es CANCELAR.
  const canDelete = isManager && !r.collectedAt && !r.assignedCourierId && !r.deletedAt
  const noActions = !forward && !canAssign && !canDeliver && !canEdit && !canCancel &&
    !canCollect && !canPay && !canDelete

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
  // Fallida: el mando elige el MOTIVO, que pasa a ser el estado (así el reporte dice
  // por qué falla cada una). El mensajero conserva lo que llevaba: lo devuelve al
  // cerrar (fondo) o con "Devolver producto".
  const fail = (reason) =>
    run(
      () => remittancesRepo.failReturn(r.id, { reason, actorId: userId }),
      `¿Marcar como “${REMITTANCE_STATUS_LABELS[reason] || 'fallida'}”? El mensajero conserva lo que lleva hasta que lo devuelva.`
    )
  const removeIt = () =>
    run(
      () => remittancesRepo.remove(r.id, { actorId: userId }),
      '¿Eliminar esta entrega? Deja de aparecer en la lista y en los reportes, pero queda registrada en auditoría (no se borra de la base).'
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
        <div className="kv">
          <span className="muted">Modo de cobro</span>
          <span>{PAYMENT_MODE_LABELS[r.paymentMode] || PAYMENT_MODE_LABELS.upfront}</span>
        </div>
        {r.collectedAt && (
          <div className="kv">
            <span className="muted">Cobrado</span>
            <strong>{formatMoney(Number(r.collectedAmount ?? r.amount) || 0, r.collectedCurrency || r.currency)}</strong>
          </div>
        )}
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

      {r.kind === DELIVERY_KIND.PRODUCT && Array.isArray(r.items) && r.items.length > 0 && (
        <section className="card">
          <h3>Productos a entregar</h3>
          {r.items.map((it, i) => (
            <div key={i} className="kv"><span>{it.name}</span><strong>× {it.qty}</strong></div>
          ))}
        </section>
      )}

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
        {canPay && (
          <button className="btn btn--primary btn--block" disabled={busy} onClick={() => setCollecting(true)}>
            Registrar pago
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
            <button className="btn btn--ghost btn--block warn-text" disabled={busy} onClick={() => setFailing(true)}>
              Entrega fallida…
            </button>
          </>
        )}
        {canCollect && (
          <button className="btn btn--primary btn--block" disabled={busy} onClick={() => setCollecting(true)}>
            Registrar cobro
          </button>
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
        {canDelete && (
          <button className="btn btn--ghost btn--block warn-text" disabled={busy} onClick={removeIt}>
            Eliminar entrega
          </button>
        )}
        {noActions && <p className="muted">Sin acciones disponibles para este estado.</p>}
      </section>

      {failing && (
        <FailReasonModal
          onClose={() => setFailing(false)}
          onPick={(reason) => { setFailing(false); fail(reason) }}
        />
      )}
      {editing && <RemittanceForm userId={userId} existing={r} onClose={() => setEditing(false)} />}
      {assigning && (
        <AssignModal remittance={r} userId={userId} couriers={couriers} onClose={() => setAssigning(false)} onDone={onBack} />
      )}
      {delivering && (
        <DeliverModal remittance={r} userId={userId} onClose={() => setDelivering(false)} onDone={onBack} />
      )}
      {collecting && (
        <CollectModal remittance={r} userId={userId} onClose={() => setCollecting(false)} onDone={onBack} />
      )}
    </div>
  )
}

// Asigna la remesa (con fondos disponibles) a un mensajero. NO mueve efectivo: el
// mensajero reparte desde su FONDO (que la entrega le descuenta al confirmarse).
// Asignar lo designa y, si la entrega es de PRODUCTO, le carga la mercancía (sale
// del área Entregas y entra a su custodia de producto).
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
          Se le carga{' '}
          <strong>
            {r.kind === DELIVERY_KIND.PRODUCT
              ? (r.items || []).map((it) => `${it.name} × ${it.qty}`).join(', ')
              : formatMoney(Number(r.amount) || 0, r.currency)}
          </strong>{' '}
          al mensajero{r.kind === DELIVERY_KIND.PRODUCT ? ' (sale del área Entregas)' : ' en custodia'}.
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
          Se entrega{' '}
          <strong>
            {r.kind === DELIVERY_KIND.PRODUCT
              ? (r.items || []).map((it) => `${it.name} × ${it.qty}`).join(', ')
              : formatMoney(Number(r.amount) || 0, r.currency)}
          </strong>{' '}
          a <strong>{r.beneficiary?.name || 'el beneficiario'}</strong>. Confirma cuando lo haya recibido.
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

// Cobro al remitente de una entrega CONTRA ENTREGA: elige la cuenta de tesoreria
// (modulo 'cuentas'), el monto recibido (por defecto el de la entrega), quien pago y
// un comprobante (foto). Al confirmar acredita la cuenta y la entrega sale de "por
// cobrar". Sin el modulo 'cuentas' se marca cobrada sin cuenta (degradacion limpia).
function CollectModal({ remittance: r, userId, onClose, onDone }) {
  const { hasModule } = useLicense()
  const hasAccounts = hasModule(LICENSE_MODULES.ACCOUNTS)
  const accounts = useLiveQuery(() => (hasAccounts ? accountsRepo.list() : Promise.resolve([])), [hasAccounts], [])
  const [accountId, setAccountId] = useState('')
  const [amount, setAmount] = useState(String(r.amount ?? ''))
  const [payerName, setPayerName] = useState(r.sender?.name || '')
  const [proof, setProof] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEscapeClose(onClose)

  // Preselecciona la primera cuenta al cargar (sin pisar una eleccion del usuario).
  useEffect(() => {
    if (hasAccounts && !accountId && accounts.length > 0) setAccountId(accounts[0].id)
  }, [accounts, hasAccounts, accountId])

  const acc = accounts.find((a) => a.id === accountId) || null
  const curLabel = acc ? acc.currency : r.currency
  // Anticipado = "pago" (antes de asignar); contra entrega = "cobro" (tras entregar).
  const isPago = r.paymentMode !== PAYMENT_MODE.ON_CREDIT && r.status !== REMITTANCE_STATUS.DELIVERED

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
      await remittancesRepo.collect(r.id, {
        accountId: hasAccounts ? (accountId || null) : null,
        amount: Number(amount) || 0,
        payerName,
        proofDataUrl: proof,
        note,
        actorId: userId
      })
      onDone()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>{isPago ? 'Registrar pago' : 'Registrar cobro'}</h3>
        <p className="muted">
          {isPago ? 'Pago del remitente ' : 'Cobro del remitente '}
          <strong>{r.sender?.name || '—'}</strong>. Entra a la cuenta que elijas.
        </p>

        {hasAccounts ? (
          accounts.length > 0 ? (
            <label className="field">
              <span>Cuenta destino</span>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
              </select>
            </label>
          ) : (
            <p className="muted">No hay cuentas de tesorería. Se marcará cobrada sin cuenta; crea una en <strong>Cuentas</strong>.</p>
          )
        ) : (
          <p className="muted">Sin el módulo de Cuentas se marca cobrada sin acreditar cuenta.</p>
        )}

        <label className="field">
          <span>Monto recibido{curLabel ? ` (${curLabel})` : ''}</span>
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
          <span>Pagó (nombre)</span>
          <input value={payerName} onChange={(e) => setPayerName(e.target.value)} placeholder="Quién envió el pago" />
        </label>

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
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Referencia" />
        </label>

        {error && <p className="error">{error}</p>}
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" disabled={busy || !(Number(amount) > 0)} onClick={save}>
            {busy ? 'Guardando…' : (isPago ? 'Confirmar pago' : 'Confirmar cobro')}
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
  const [paymentMode, setPaymentMode] = useState(existing?.paymentMode || PAYMENT_MODE.UPFRONT)
  const [kind, setKind] = useState(existing?.kind || DELIVERY_KIND.MONEY)
  const [items, setItems] = useState(existing?.items ? existing.items.map((it) => ({ ...it })) : [])
  const [pickProduct, setPickProduct] = useState('')
  const [pickQty, setPickQty] = useState('')
  const products = useLiveQuery(() => productsRepo.listActive(), [], [])
  const isProduct = kind === DELIVERY_KIND.PRODUCT
  // Solo lo que HAY en el area "Entregas" —lo que el mando le dio salida desde el
  // almacen— y ordenado alfabeticamente. No se puede prometer lo que no esta ahi: es
  // la MISMA existencia que valida `remittancesRepo.assign` al cargar al mensajero.
  // Mismo criterio (y mismo codigo) que la salida a areas, que solo ofrece lo que hay
  // en el almacen. Se muestra la existencia disponible junto al nombre.
  const stockEntregas = (p) => Number(p.stockByLocation?.[ENTREGAS_AREA] || 0)
  const entregasProducts = useMemo(
    () => (products || [])
      .filter((p) => stockEntregas(p) > 0)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [products]
  )
  // Existencia en Entregas por producto, para avisar en la lista si se pide mas de lo
  // que hay. Es solo un AVISO: el candado de verdad sigue siendo `assign` (que valida
  // dentro de su transaccion), porque varias entregas pendientes comparten esa misma
  // existencia y el almacen puede reponerla antes de asignar.
  const stockById = useMemo(() => {
    const m = {}
    for (const p of (products || [])) m[p.id] = stockEntregas(p)
    return m
  }, [products])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Dinero y mercancía CONGELADOS: solo se corrigen antes de cobrar. Después ya hay un
  // cobro en una cuenta y/o producto cargado; se editan solo los datos de contacto.
  const moneyLocked = isEdit && existing.status !== REMITTANCE_STATUS.CREATED
  // Con cobro ANTICIPADO hay un pago que registrar, así que el monto es obligatorio
  // (en dinero lo es siempre). Solo en producto CONTRA ENTREGA puede quedar en cero
  // —entrega sin cobro—, que es como funcionaba hasta ahora.
  const needsAmount = !isProduct || paymentMode === PAYMENT_MODE.UPFRONT
  useEscapeClose(onClose)

  // Agrega/quita una linea de producto (se acumula por producto).
  const addItem = () => {
    const p = entregasProducts.find((x) => x.id === pickProduct)
    const qty = Number(pickQty) || 0
    if (!p || qty <= 0) return
    setItems((prev) => {
      const idx = prev.findIndex((it) => it.productId === p.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], qty: round2(Number(next[idx].qty) + qty) }
        return next
      }
      return [...prev, { productId: p.id, name: p.name, qty }]
    })
    setPickProduct('')
    setPickQty('')
  }
  const removeItem = (i) => setItems((prev) => prev.filter((_, idx) => idx !== i))

  const save = async () => {
    setError('')
    setBusy(true)
    // Editando una entrega que YA se movió (cobrada o asignada) solo viajan los datos
    // de CONTACTO: el monto y los productos quedan congelados porque ya hay un cobro
    // asentado en una cuenta y/o mercancía cargada a un mensajero. El repo lo vuelve a
    // comprobar (la UI no es el candado).
    const payload = moneyLocked
      ? {
        note,
        sender: { name: sName, phone: sPhone, idDoc: sId },
        beneficiary: { name: bName, phone: bPhone, address: bAddr, idDoc: bId }
      }
      : {
        amount,
        currency,
        fee,
        note,
        paymentMode,
        kind,
        items,
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

        {moneyLocked && (
          <p className="muted">
            Esta entrega ya se movió: el <strong>monto y los productos quedan fijos</strong>.
            Puedes corregir los datos del remitente, del beneficiario y la nota.
          </p>
        )}

        {!moneyLocked && (
          <label className="field">
            <span>Tipo de entrega</span>
            {/* Al cambiar el tipo se pone el modo de cobro POR DEFECTO de ese tipo, el
                mismo de siempre: dinero = anticipado, producto = contra entrega. El
                dueño puede cambiarlo despues en el selector de abajo. */}
            <select
              value={kind}
              onChange={(e) => {
                const k = e.target.value
                setKind(k)
                setPaymentMode(k === DELIVERY_KIND.PRODUCT ? PAYMENT_MODE.ON_CREDIT : PAYMENT_MODE.UPFRONT)
              }}
              disabled={isEdit}
            >
              <option value={DELIVERY_KIND.MONEY}>{DELIVERY_KIND_LABELS.money}</option>
              <option value={DELIVERY_KIND.PRODUCT}>{DELIVERY_KIND_LABELS.product}</option>
            </select>
          </label>
        )}

        {!moneyLocked && isProduct && (
          <>
            <p className="field-label">Productos a entregar</p>
            {entregasProducts.length === 0 ? (
              <p className="muted">
                No hay existencia en el área <strong>{ENTREGAS_AREA_LABEL}</strong>. Envía primero
                la mercancía desde <strong>Salida a áreas</strong> (almacén → {ENTREGAS_AREA_LABEL}).
              </p>
            ) : (
              <div className="form-row">
                <label className="field" style={{ flex: 2 }}>
                  <span>Producto</span>
                  <select value={pickProduct} onChange={(e) => setPickProduct(e.target.value)}>
                    <option value="">— Elige —</option>
                    {entregasProducts.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} (hay {stockEntregas(p)})</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Cantidad</span>
                  <input type="number" inputMode="decimal" value={pickQty} onChange={(e) => setPickQty(e.target.value)} placeholder="0" />
                </label>
              </div>
            )}
            <button type="button" className="btn btn--ghost btn--sm" disabled={!pickProduct || !(Number(pickQty) > 0)} onClick={addItem}>
              + Agregar producto
            </button>
            {items.length > 0 && (
              <div className="list" style={{ marginTop: 8 }}>
                {items.map((it, i) => (
                  <div key={i} className="list-item" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ flex: 1 }}>
                      {it.name} × {it.qty}
                      {Number(it.qty) > Number(stockById[it.productId] || 0) && (
                        <span className="warn-text"> · en {ENTREGAS_AREA_LABEL} solo hay {Number(stockById[it.productId] || 0)}</span>
                      )}
                    </span>
                    <button type="button" className="btn btn--ghost btn--sm warn-text" onClick={() => removeItem(i)}>Quitar</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {!moneyLocked && (
          <div className="form-row">
            <label className="field">
              <span>{needsAmount ? 'Monto *' : 'Monto a cobrar (opcional)'}</span>
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
        )}
        {/* Modo de cobro: IGUAL para dinero y para producto. El dinero del remitente
            entra a la cuenta de tesoreria que elija el dueño al registrar el pago
            (anticipado, antes de asignar) o el cobro (contra entrega, tras entregar).
            En producto el modo por defecto sigue siendo CONTRA ENTREGA, como hasta
            ahora: quien no lo toque no nota ningun cambio. */}
        {!moneyLocked && (
          <>
            <label className="field">
              <span>Modo de cobro</span>
              <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
                <option value={PAYMENT_MODE.UPFRONT}>{PAYMENT_MODE_LABELS.upfront}</option>
                <option value={PAYMENT_MODE.ON_CREDIT}>{PAYMENT_MODE_LABELS.on_credit}</option>
              </select>
            </label>
            {paymentMode === PAYMENT_MODE.ON_CREDIT ? (
              <p className="muted">
                Se entrega primero; el cobro al remitente queda “por cobrar”
                {isProduct ? ' (si pusiste monto)' : ''}.
              </p>
            ) : (
              <p className="muted">
                El remitente paga antes: registra el pago —entra a la cuenta que elijas— y
                queda lista para asignar al mensajero.
              </p>
            )}
          </>
        )}
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
            disabled={
              busy || !sName.trim() || !bName.trim() ||
              (isProduct && items.length === 0) ||
              (needsAmount && !(Number(amount) > 0))
            }
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

// Cierre de cobros (F5, solo mando): lista lo que esta POR COBRAR (contra entrega ya
// entregada y sin cobrar) para revisarlo entrega por entrega y registrar el pago; el
// dinero entra a la cuenta elegida (F3). Se oculta si no hay nada pendiente.
function PendingCollectionsSection({ remittances, userId }) {
  const [collectId, setCollectId] = useState(null)
  const pending = (remittances || []).filter(isPendingCollection)
  if (pending.length === 0) return null

  const totals = {}
  for (const r of pending) {
    const c = r.currency || 'MN'
    totals[c] = round2((totals[c] || 0) + (Number(r.amount) || 0))
  }
  const totalStr = Object.entries(totals).map(([c, v]) => formatMoney(v, c)).join(' · ')
  const target = collectId ? pending.find((r) => r.id === collectId) : null

  return (
    <section className="card">
      <h3>Por cobrar</h3>
      <p className="muted">
        Entregas ya entregadas cuyo cobro al remitente está pendiente. Total:{' '}
        <strong className="warn-text">{totalStr}</strong>
      </p>
      <div className="list">
        {pending.map((r) => (
          <div key={r.id} className="list-item" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="help-item__text" style={{ flex: 1 }}>
              <strong>{r.beneficiary?.name || 'Beneficiario'}</strong>
              <span className="muted">De {r.sender?.name || '—'} · {formatMoney(Number(r.amount) || 0, r.currency)}</span>
            </span>
            <button className="btn btn--primary btn--sm" onClick={() => setCollectId(r.id)}>Cobrar</button>
          </div>
        ))}
      </div>
      {target && (
        <CollectModal remittance={target} userId={userId} onClose={() => setCollectId(null)} onDone={() => setCollectId(null)} />
      )}
    </section>
  )
}

// Liquidaciones (F6, solo mando): cuadra el efectivo en custodia de un mensajero
// (teorico del libro vs contado fisico + semaforo) y muestra las recientes.
function SettlementsSection({ couriers, balances, settlements, userId, userName }) {
  const [settling, setSettling] = useState(false)
  const [fundMode, setFundMode] = useState(null)
  const [returningProduct, setReturningProduct] = useState(false)
  const recent = (settlements || []).slice(0, 8)
  return (
    <section className="card">
      <h3>Fondo y cierre del mensajero</h3>
      <p className="muted">Dale un fondo al mensajero para repartir; cada entrega se lo descuenta. Al cerrar, cuadra su efectivo (teórico del libro vs contado) o devuelve lo que sobra.</p>
      <div className="form-row">
        <button className="btn btn--ghost" style={{ flex: 1 }} onClick={() => setFundMode('provision')}>Dar fondo</button>
        <button className="btn btn--ghost" style={{ flex: 1 }} onClick={() => setFundMode('return')}>Devolver fondo</button>
      </div>
      <button className="btn btn--ghost btn--block" onClick={() => setSettling(true)}>
        Liquidar mensajero
      </button>
      <button className="btn btn--ghost btn--block" onClick={() => setReturningProduct(true)}>
        Devolver producto al área
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
      {fundMode && (
        <FundModal
          mode={fundMode}
          couriers={couriers}
          balances={balances}
          userId={userId}
          onClose={() => setFundMode(null)}
          onDone={() => setFundMode(null)}
        />
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
      {returningProduct && (
        <ReturnProductModal
          couriers={couriers}
          userId={userId}
          onClose={() => setReturningProduct(false)}
          onDone={() => setReturningProduct(false)}
        />
      )}
    </section>
  )
}

// Motivo por el que una entrega no se pudo concretar. El mando elige uno y ESE pasa a
// ser el estado de la entrega, para que el reporte diga POR QUE falla cada una (antes
// todas terminaban como "Devuelta" y el motivo se perdia).
function FailReasonModal({ onClose, onPick }) {
  useEscapeClose(onClose)
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Motivo de la entrega fallida" onClick={(e) => e.stopPropagation()}>
        <h3>¿Por qué no se entregó?</h3>
        <p className="muted">
          El mensajero conserva lo que lleva (efectivo o producto) hasta que lo devuelva.
        </p>
        {DELIVERY_FAIL_REASONS.map((s) => (
          <button key={s} className="btn btn--ghost btn--block" onClick={() => onPick(s)}>
            {REMITTANCE_STATUS_LABELS[s] || s}
          </button>
        ))}
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}

// Fondo del mensajero (F4): DAR (dotar) o DEVOLVER efectivo del fondo que reparte.
// El fondo SALE DE LAS CUENTAS DEL NEGOCIO: se elige la cuenta de tesoreria de la que
// sale (y a la que vuelve al devolver), igual que el cobro. Muestra el fondo actual
// (derivado del libro) para decidir cuanto. Solo el mando. Sin el modulo 'cuentas' no
// hay selector y se registra sin mover cuenta (degradacion limpia, como el cobro).
function FundModal({ mode, couriers, balances, userId, onClose, onDone }) {
  const provision = mode === 'provision'
  const { hasModule } = useLicense()
  const hasAccounts = hasModule(LICENSE_MODULES.ACCOUNTS)
  const accounts = useLiveQuery(() => (hasAccounts ? accountsRepo.list() : Promise.resolve([])), [hasAccounts], [])
  const [accountId, setAccountId] = useState('')
  const [courierId, setCourierId] = useState(couriers[0]?.id || '')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('MN')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEscapeClose(onClose)

  // Preselecciona la primera cuenta al cargar (sin pisar una eleccion del usuario).
  useEffect(() => {
    if (hasAccounts && !accountId && accounts.length > 0) setAccountId(accounts[0].id)
  }, [accounts, hasAccounts, accountId])

  // Con cuenta elegida manda SU moneda (tesoreria y custodia quedan en la misma).
  const acc = accounts.find((a) => a.id === accountId) || null
  const curLabel = acc ? acc.currency : currency

  const bal = balances[courierId] || {}
  const balStr = Object.entries(bal)
    .filter(([, a]) => Math.abs(Number(a) || 0) >= 0.01)
    .map(([c, a]) => formatMoney(a, c))
    .join(' · ')

  const save = async () => {
    setError('')
    setBusy(true)
    try {
      const fn = provision ? custodyRepo.provisionFund : custodyRepo.returnFund
      await fn({
        courierId,
        amount: Number(amount) || 0,
        currency,
        accountId: hasAccounts ? (accountId || null) : null,
        actorId: userId
      })
      onDone()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>{provision ? 'Dar fondo al mensajero' : 'Devolver fondo'}</h3>
        {couriers.length === 0 ? (
          <p className="muted">No hay mensajeros activos. Crea uno en <strong>Usuarios</strong> (rol Mensajero).</p>
        ) : (
          <>
            <label className="field">
              <span>Mensajero</span>
              <select value={courierId} onChange={(e) => setCourierId(e.target.value)}>
                {couriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            {balStr && <p className="muted">Fondo actual: <strong>{balStr}</strong></p>}
            {hasAccounts && (
              <label className="field">
                <span>{provision ? 'Cuenta de la que sale' : 'Cuenta a la que vuelve'}</span>
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
                  ))}
                </select>
              </label>
            )}
            <div className="form-row">
              <label className="field">
                <span>Monto</span>
                <input autoFocus type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
              </label>
              <label className="field">
                <span>Moneda</span>
                {acc ? (
                  <input value={curLabel} readOnly />
                ) : (
                  <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    {CURRENCY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
              </label>
            </div>
            {acc && (
              <p className="muted">
                {provision
                  ? `Se descontará de ${acc.name} y quedará en manos del mensajero.`
                  : `Volverá a ${acc.name}.`}
              </p>
            )}
          </>
        )}
        {error && <p className="error">{error}</p>}
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" disabled={busy || !courierId || !(Number(amount) > 0)} onClick={save}>
            {busy ? 'Guardando…' : (provision ? 'Dar fondo' : 'Devolver')}
          </button>
        </div>
      </div>
    </div>
  )
}

// Devolver al area "Entregas" el producto que un mensajero ya no entregara (sobrante
// o entrega fallida). Muestra lo que carga y el mando elige cuanto devolver. Solo mando.
function ReturnProductModal({ couriers, userId, onClose, onDone }) {
  const [courierId, setCourierId] = useState(couriers[0]?.id || '')
  const carried = useLiveQuery(() => (courierId ? productCustodyRepo.holderProducts(courierId) : Promise.resolve({})), [courierId], {})
  const names = useLiveQuery(() => (courierId ? productCustodyRepo.holderNames(courierId) : Promise.resolve({})), [courierId], {})
  const [qtys, setQtys] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEscapeClose(onClose)

  const changeCourier = (id) => { setCourierId(id); setQtys({}) }
  const entries = Object.entries(carried || {})

  const save = async () => {
    setError('')
    setBusy(true)
    try {
      const items = entries
        .map(([pid]) => ({ productId: pid, name: names[pid] || '', qty: Number(qtys[pid]) || 0 }))
        .filter((it) => it.qty > 0)
      if (items.length === 0) throw new Error('Indica cuánto devolver')
      await remittancesRepo.returnProduct({ courierId, items, actorId: userId })
      onDone()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>Devolver producto al área</h3>
        {couriers.length === 0 ? (
          <p className="muted">No hay mensajeros activos.</p>
        ) : (
          <>
            <label className="field">
              <span>Mensajero</span>
              <select value={courierId} onChange={(e) => changeCourier(e.target.value)}>
                {couriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            {entries.length === 0 ? (
              <p className="muted">Este mensajero no lleva producto.</p>
            ) : (
              entries.map(([pid, q]) => (
                <label key={pid} className="field">
                  <span>{names[pid] || pid} (lleva {q})</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={qtys[pid] ?? ''}
                    onChange={(e) => setQtys((p) => ({ ...p, [pid]: e.target.value }))}
                    placeholder="0"
                  />
                </label>
              ))
            )}
          </>
        )}
        {error && <p className="error">{error}</p>}
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" disabled={busy || entries.length === 0} onClick={save}>
            {busy ? 'Guardando…' : 'Devolver'}
          </button>
        </div>
      </div>
    </div>
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
