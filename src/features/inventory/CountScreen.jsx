import { useMemo, useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { countsRepo } from '../../repositories/countsRepo'
import { categoriesRepo } from '../../repositories/categoriesRepo'
import { usersRepo } from '../../repositories/usersRepo'
import { productsRepo } from '../../repositories/productsRepo'
import { configRepo } from '../../repositories/configRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useShift } from '../../app/providers/ShiftProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { formatDateTime } from '../../lib/dates'
import { useEscapeClose } from '../../lib/useEscapeClose'
import { SEMAPHORE_EMOJI } from '../../lib/semaphore'
import { WAREHOUSE, ELABORATION, locationLabel } from '../../db/constants'

// Existencia de un producto en una ubicacion (espejo de countsRepo) para saber
// si hay algo que contar en el destino elegido.
function stockAt(p, location) {
  const byLoc = p.stockByLocation
  if (byLoc && byLoc[location] != null) return Number(byLoc[location])
  return location === WAREHOUSE ? Number(p.stock || 0) : 0
}

// Si el vendedor llego aqui desde el asistente de cierre, le permitimos volver
// a retomar el cierre (sin perder el flujo) tras contar o decidir no contar.
function CloseReturnBanner() {
  const navigate = useNavigate()
  if (typeof sessionStorage === 'undefined' || !sessionStorage.getItem('closeFlowShift')) return null
  return (
    <button className="btn btn--primary btn--block" onClick={() => navigate('/shift')}>
      ← Volver al cierre del turno
    </button>
  )
}

export function CountScreen() {
  const { user, isManager } = useAuth()
  const { activeShift } = useShift()
  const { hasModule } = useLicense()
  // Borrador PROPIO (cada vendedor cuenta su area de forma independiente).
  const draft = useLiveQuery(() => countsRepo.getDraft(user.id), [user.id], undefined)
  // Conteo enviado: el mando revisa cualquiera (cola); el vendedor solo el suyo.
  const pending = useLiveQuery(
    () => (isManager ? countsRepo.getPending() : countsRepo.getPending(user.id)),
    [isManager, user.id],
    undefined
  )
  const areas = useLiveQuery(() => configRepo.getAreas(), [], [])
  const products = useLiveQuery(() => productsRepo.list(), [], [])
  // Bloque A (mayorista): permiso del dueño para que el vendedor opere el almacén.
  const warehouseAllowed = useLiveQuery(() => configRepo.get('sellerWarehouseSale', false), [], false)
  // Módulo elaboración: el dueño/admin también puede contar el centro de elaboración.
  const elab = useLiveQuery(() => configRepo.getElaboration(), [], { enabled: false, name: 'Elaboración' })
  const [countLoc, setCountLoc] = useState(WAREHOUSE)
  // Ubicación elegida por el vendedor (null hasta que la cambie; por defecto, su área).
  const [sellerPick, setSellerPick] = useState(null)

  // El vendedor cuenta SU área (la de su turno); no elige ni ve el almacén.
  const sellerArea = activeShift?.area || ''
  // Bloque A: si la licencia trae 'mayorista' y el dueño lo permitió, el vendedor
  // con área puede, además de su área, contar el ALMACÉN central al cierre (para
  // cuadrar lo que vendió como mayorista). Sin módulo/permiso: solo su área.
  const canSellerWarehouse =
    !isManager && !!sellerArea && !!warehouseAllowed && hasModule(LICENSE_MODULES.WHOLESALE)
  const sellerCountLoc = canSellerWarehouse ? (sellerPick ?? sellerArea) : (sellerArea || WAREHOUSE)

  if (pending === undefined || draft === undefined) {
    return <div className="screen"><p className="muted">Cargando…</p></div>
  }

  // 1. Mi borrador en curso: lo sigo contando (tiene prioridad sobre la cola).
  // Para el vendedor, un borrador de OTRA ubicación (p.ej. del almacén, creado
  // antes de tener área) está obsoleto: no se muestra; al reiniciar se reconvierte
  // a su área. El dueño/administrativo retoma cualquier borrador suyo.
  const draftLoc = draft?.location || WAREHOUSE
  // El vendedor con permiso mayorista tiene DOS ubicaciones válidas (su área y el
  // almacén); ambos borradores se retoman. Sin permiso, solo el de su área.
  const sellerValidLocs = canSellerWarehouse ? [sellerArea, WAREHOUSE] : [sellerArea || WAREHOUSE]
  const draftIsValidHere = draft && (isManager || sellerValidLocs.includes(draftLoc))
  if (draftIsValidHere) return <CountEditor draft={draft} />

  // 2. Hay un conteo enviado: el mando lo revisa; el vendedor que lo envió espera.
  if (pending) {
    return isManager ? (
      <CountReview count={pending} ownerId={user.id} />
    ) : (
      <div className="screen">
        <h2>Conteo físico</h2>
        <section className="card">
          <p>Tu conteo fue enviado y espera la <strong>aprobación del dueño o administrativo</strong>.</p>
        </section>
        <CloseReturnBanner />
      </div>
    )
  }

  // Vendedor sin turno abierto: no tiene área que contar.
  if (!isManager && areas.length > 0 && !sellerArea) {
    return (
      <div className="screen">
        <h2>Conteo físico</h2>
        <CloseReturnBanner />
        <section className="card">
          <p>Para contar tu área necesitas tener <strong>tu turno abierto</strong>.</p>
          <Link className="btn btn--primary btn--block" to="/shift">Ir a Turno</Link>
        </section>
      </div>
    )
  }

  // Ubicación a contar: el dueño/administrativo elige; el vendedor cuenta su área
  // (o el almacén, si tiene el permiso mayorista y lo eligió).
  const targetLoc = isManager ? countLoc : sellerCountLoc
  // ¿Hay algo que contar en ese destino? (existencia > 0 en esa ubicación)
  const hasItems = products.some((p) => p.active && stockAt(p, targetLoc) > 0)

  return (
    <div className="screen">
      <h2>Conteo físico</h2>
      <CloseReturnBanner />
      <section className="card">
        <p className="muted">
          {isManager
            ? `Vas a contar: ${targetLoc === ELABORATION ? elab.name : locationLabel(targetLoc)}. Al terminar se ajustan las existencias de esa ubicación.`
            : canSellerWarehouse
              ? `Elige qué contar: tu área (${sellerArea}) o el almacén central. Al terminar, el dueño o administrativo aprueba y se ajustan.`
              : `Contarás los productos de tu área (${sellerArea || 'tu punto'}). Al terminar, el dueño o administrativo aprueba y se ajustan.`}
        </p>
        {isManager && (areas.length > 0 || elab.enabled) && (
          <label className="field">
            <span>¿Qué vas a contar?</span>
            <select value={countLoc} onChange={(e) => setCountLoc(e.target.value)}>
              <option value={WAREHOUSE}>{locationLabel(WAREHOUSE)}</option>
              {elab.enabled && <option value={ELABORATION}>{elab.name}</option>}
              {areas.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
        )}
        {canSellerWarehouse && (
          <label className="field">
            <span>¿Qué vas a contar?</span>
            <select value={sellerCountLoc} onChange={(e) => setSellerPick(e.target.value)}>
              <option value={sellerArea}>{sellerArea}</option>
              <option value={WAREHOUSE}>{locationLabel(WAREHOUSE)}</option>
            </select>
          </label>
        )}
        {!hasItems ? (
          <p className="muted">
            {isManager || targetLoc === WAREHOUSE
              ? `No hay existencias en ${locationLabel(targetLoc)} para contar.`
              : <>Aún no tienes productos asignados a <strong>{sellerArea || 'tu área'}</strong>. Pídele al dueño o administrativo una <strong>salida del almacén</strong> hacia tu área.</>}
          </p>
        ) : (
          <button
            className="btn btn--primary btn--block"
            onClick={() => countsRepo.startDraft(user.id, targetLoc)}
          >
            Iniciar conteo físico de {locationLabel(targetLoc)}
          </button>
        )}
      </section>
    </div>
  )
}

// ---- Contar (borrador) ----
function CountEditor({ draft }) {
  const categories = useLiveQuery(() => categoriesRepo.list(), [], [])
  // Productos EN VIVO: para que el "Sistema" mostrado refleje las ventas/salidas
  // recientes (igual que el catálogo) y no la foto congelada al iniciar el conteo.
  const liveProducts = useLiveQuery(() => productsRepo.list(), [], [])
  const [items, setItems] = useState(draft.items)
  const [selectedCat, setSelectedCat] = useState(null)
  const [busy, setBusy] = useState(false)

  // Si cambia el borrador en BD (otra pestana), refrescamos.
  useEffect(() => { setItems(draft.items) }, [draft.id])

  // Stock del sistema en vivo por producto, en la ubicación del conteo.
  const draftLoc = draft.location || WAREHOUSE
  const liveStock = useMemo(() => {
    const m = {}
    for (const p of liveProducts) m[p.id] = stockAt(p, draftLoc)
    return m
  }, [liveProducts, draftLoc])
  // Stock del sistema a usar: el vivo si está disponible; si no, la foto del borrador.
  const sysOf = (it) => (liveStock[it.productId] != null ? liveStock[it.productId] : Number(it.systemStock || 0))

  const catName = useMemo(() => {
    const m = { __none: 'Sin categoría' }
    for (const c of categories) m[c.id] = c.name
    return m
  }, [categories])

  // Un ítem es contable si su sistema EN VIVO es > 0, o si ya tiene un físico
  // anotado (para no perder lo contado si una venta lo dejó en 0 mientras tanto).
  const isVisible = (it) =>
    Number(sysOf(it)) > 0 || (it.physicalQty !== null && it.physicalQty !== '')

  const groups = useMemo(() => {
    const g = {}
    items.forEach((it, idx) => {
      if (!isVisible(it)) return // los agotados (en vivo) no se cuentan
      const key = it.categoryId || '__none'
      if (!g[key]) g[key] = []
      // Sobrescribe systemStock con el valor EN VIVO para mostrar y calcular diff.
      g[key].push({ ...it, idx, systemStock: sysOf(it) })
    })
    return g
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, liveStock])

  const visible = items.filter(isVisible)
  const counted = visible.filter((it) => it.physicalQty !== null && it.physicalQty !== '').length
  const progress = visible.length ? Math.round((counted / visible.length) * 100) : 0

  const setItem = (idx, patch) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  const save = async () => {
    setBusy(true)
    await countsRepo.saveItems(draft.id, items)
    setBusy(false)
  }

  const submit = async () => {
    setBusy(true)
    await countsRepo.saveItems(draft.id, items)
    await countsRepo.submit(draft.id)
    setBusy(false)
  }

  // Vista de una categoria
  if (selectedCat) {
    const list = groups[selectedCat] || []
    return (
      <div className="screen">
        <button className="link-back" onClick={() => { save(); setSelectedCat(null) }}>← Categorías</button>
        <h2>{catName[selectedCat]}</h2>
        <div className="count-list">
          {list.map((it) => {
            const phys = it.physicalQty
            const has = phys !== null && phys !== ''
            const diff = has ? Number(phys) - it.systemStock : null
            return (
              <div key={it.productId} className="count-row">
                <div className="count-row__main">
                  <strong>{it.name}</strong>
                  <span className="muted">Sistema: {it.systemStock} {it.unit}</span>
                </div>
                <div className="count-row__input">
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="físico"
                    value={phys ?? ''}
                    onChange={(e) => setItem(it.idx, { physicalQty: e.target.value })}
                  />
                  {has && (
                    <span className={`count-diff ${diff === 0 ? 'ok-text' : 'warn-text'}`}>
                      {diff > 0 ? '+' : ''}{diff}
                    </span>
                  )}
                </div>
                {has && diff !== 0 && (
                  <input
                    className="count-note"
                    placeholder="Motivo de la diferencia (opcional)"
                    value={it.note ?? ''}
                    onChange={(e) => setItem(it.idx, { note: e.target.value })}
                  />
                )}
              </div>
            )
          })}
        </div>
        <button className="btn btn--primary btn--block" onClick={() => { save(); setSelectedCat(null) }}>
          Guardar categoría
        </button>
      </div>
    )
  }

  // Vista de categorias con progreso
  return (
    <div className="screen">
      <div className="screen__header">
        <h2>Conteo físico</h2>
        <span className="badge">{counted}/{visible.length}</span>
      </div>
      <p className="muted">Ubicación: <strong>{locationLabel(draft.location)}</strong></p>
      <CloseReturnBanner />
      <div className="progress">
        <div className="progress__bar" style={{ width: `${progress}%` }} />
      </div>

      <div className="list">
        {Object.entries(groups).map(([cat, list]) => {
          const done = list.filter((it) => it.physicalQty !== null && it.physicalQty !== '').length
          return (
            <button key={cat} className="list-item count-cat" onClick={() => setSelectedCat(cat)}>
              <div>
                <strong>{catName[cat]}</strong>
                <span className="muted"> · {done}/{list.length} contados</span>
              </div>
              <span className={done === list.length ? 'ok-text' : 'muted'}>
                {done === list.length ? '✓' : '›'}
              </span>
            </button>
          )
        })}
      </div>

      <button className="btn btn--block" disabled={busy} onClick={save}>
        Guardar borrador
      </button>
      <button className="btn btn--primary btn--block" disabled={busy || counted === 0} onClick={submit}>
        Enviar para aprobacion
      </button>
    </div>
  )
}

// ---- Revision / aprobacion (dueño) ----
function CountReview({ count, ownerId }) {
  const creator = useLiveQuery(() => usersRepo.get(count.createdBy), [count.createdBy])
  const [busy, setBusy] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  useEscapeClose(() => setRejecting(false))

  const counted = count.items.filter((it) => it.counted)
  const withDiff = counted.filter((it) => it.diff !== 0)

  const approve = async () => {
    setBusy(true)
    await countsRepo.approve(count.id, ownerId)
    setBusy(false)
  }
  const doReject = async () => {
    setBusy(true)
    await countsRepo.reject(count.id, ownerId, reason)
    setBusy(false)
  }

  return (
    <div className="screen">
      <h2>Revisar conteo</h2>
      <section className="card">
        <p className="muted">
          Enviado por <strong>{creator?.name || 'vendedor'}</strong> · {formatDateTime(count.submittedAt)}
        </p>
        <div className="kv"><span className="muted">Ubicación</span><strong>{locationLabel(count.location)}</strong></div>
        <div className="kv"><span className="muted">Productos contados</span><strong>{counted.length}</strong></div>
        <div className="kv"><span className="muted">Con diferencia</span><strong>{withDiff.length}</strong></div>
      </section>

      <h3 className="section-title">Diferencias</h3>
      <div className="count-list">
        {withDiff.length === 0 && <p className="muted">Sin diferencias. Todo cuadra 🟢</p>}
        {withDiff.map((it) => (
          <div key={it.productId} className="count-row">
            <div className="count-row__main">
              <strong>{SEMAPHORE_EMOJI[it.semaphore]} {it.name}</strong>
              <span className="muted">Sistema {it.systemStock} → Físico {it.physicalQty} {it.unit}</span>
              {it.note && <span className="muted">Nota: {it.note}</span>}
            </div>
            <span className={`count-diff ${it.diff === 0 ? 'ok-text' : 'warn-text'}`}>
              {it.diff > 0 ? '+' : ''}{it.diff}
            </span>
          </div>
        ))}
      </div>

      <p className="muted">Al aprobar, el stock se ajusta para coincidir con lo contado.</p>
      <button className="btn btn--primary btn--block" disabled={busy} onClick={approve}>
        {busy ? 'Aplicando…' : 'Aprobar y ajustar stock'}
      </button>
      <button className="btn btn--ghost btn--block" onClick={() => setRejecting(true)}>
        Rechazar
      </button>

      {rejecting && (
        <div className="modal-backdrop" onClick={() => setRejecting(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Rechazar conteo" onClick={(e) => e.stopPropagation()}>
            <h3>Rechazar conteo</h3>
            <label className="field">
              <span>Motivo (opcional)</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setRejecting(false)}>Cancelar</button>
              <button className="btn btn--primary" disabled={busy} onClick={doReject}>Rechazar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
