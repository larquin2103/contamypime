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
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { ratesRepo } from '../../repositories/ratesRepo'
import { formatMoney, isForeignPriced, foreignToBase, round2 } from '../../lib/currency'
import { formatDateTime } from '../../lib/dates'
import { useEscapeClose } from '../../lib/useEscapeClose'
import { SEMAPHORE_EMOJI } from '../../lib/semaphore'
import { WAREHOUSE, ELABORATION, COCINA, locationLabel } from '../../db/constants'

// Existencia de un producto en una ubicacion (espejo de countsRepo) para saber
// si hay algo que contar en el destino elegido.
function stockAt(p, location) {
  const byLoc = p.stockByLocation
  if (byLoc && byLoc[location] != null) return Number(byLoc[location])
  return location === WAREHOUSE ? Number(p.stock || 0) : 0
}

// Valor unitario en MN para el IMPORTE informativo del conteo: en la COCINA por
// COSTO del insumo (lo consumido); en el resto por PRECIO de venta (venta sin
// carrito). Convierte divisa a MN a la tasa vigente (0 si falta la tasa). Data-driven,
// como los reportes: se convierte si el producto tiene priceCurrency, con o sin modulo.
function unitValueMap(products, isCocina, rates) {
  const m = {}
  const rateOf = (cur) => Number(rates?.[cur]?.rate || 0)
  for (const p of products) {
    const raw = isCocina ? Number(p.cost || 0) : Number(p.price || 0)
    let mn = raw
    if (isForeignPriced(p)) {
      const r = rateOf(p.priceCurrency)
      mn = r > 0 ? foreignToBase(raw, r) : 0
    }
    m[p.id] = round2(mn)
  }
  return m
}

// Suma el importe de las diferencias del conteo (informativo): `short` = faltante
// (sistema > fisico: salio sin registrarse en el carrito) y `over` = sobrante
// (fisico > sistema), ambos en positivo. sysOf(it) da el stock de sistema del item.
function sumCountValue(items, valMap, sysOf) {
  let short = 0
  let over = 0
  for (const it of items) {
    const phys = it.physicalQty
    if (phys === null || phys === '') continue
    const q = round2(Number(sysOf(it)) - Number(phys))
    const val = round2(q * (valMap[it.productId] || 0))
    if (q > 0) short += val
    else if (q < 0) over += -val
  }
  return { short: round2(short), over: round2(over) }
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
  const canKitchen = hasModule(LICENSE_MODULES.KITCHEN)
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
        {isManager && (areas.length > 0 || elab.enabled || canKitchen) && (
          <label className="field">
            <span>¿Qué vas a contar?</span>
            <select value={countLoc} onChange={(e) => setCountLoc(e.target.value)}>
              <option value={WAREHOUSE}>{locationLabel(WAREHOUSE)}</option>
              {elab.enabled && <option value={ELABORATION}>{elab.name}</option>}
              {canKitchen && <option value={COCINA}>{locationLabel(COCINA)}</option>}
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
  const { isManager } = useAuth()
  const { baseCurrency } = useCurrency()
  const categories = useLiveQuery(() => categoriesRepo.list(), [], [])
  // Productos EN VIVO: para que el "Sistema" mostrado refleje las ventas/salidas
  // recientes (igual que el catálogo) y no la foto congelada al iniciar el conteo.
  const liveProducts = useLiveQuery(() => productsRepo.list(), [], [])
  // Tasas vigentes: para valorar en MN los productos fijados en divisa (importe).
  const rates = useLiveQuery(() => ratesRepo.currentRates(), [], null)
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

  // Importe INFORMATIVO (solo mando): valor de la diferencia sistema − real contado.
  // En la COCINA por COSTO (lo consumido); en el resto por PRECIO de venta (venta sin
  // carrito). NO cambia el ajuste de existencias, que sigue igualando el sistema al real.
  const isCocina = draftLoc === COCINA
  const valMap = useMemo(() => unitValueMap(liveProducts, isCocina, rates), [liveProducts, isCocina, rates])
  const totals = useMemo(
    () => sumCountValue(items, valMap, sysOf),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, valMap, liveStock]
  )

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
    // Orden ALFABETICO por nombre dentro de cada categoria (igual que el catalogo).
    // Es solo de PRESENTACION: cada item conserva su `idx` original, por lo que el
    // mapeo al borrador (setItem por idx) y los datos guardados quedan intactos.
    for (const key of Object.keys(g)) {
      g[key].sort((a, b) => a.name.localeCompare(b.name))
    }
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
            // round2: evita colas decimales de la resta flotante (0.3-0.1) en el badge.
            const diff = has ? round2(Number(phys) - it.systemStock) : null
            // Importe de la diferencia (sistema − real) × valor unitario (costo en
            // cocina, precio de venta en el resto). Positivo = faltante; negativo = sobrante.
            const soldQty = has ? round2(it.systemStock - Number(phys)) : 0
            const imp = round2(soldQty * (valMap[it.productId] || 0))
            return (
              <div key={it.productId} className="count-row">
                <div className="count-row__main">
                  <strong>{it.name}</strong>
                  <span className="muted">Sistema: {it.systemStock} {it.unit}</span>
                  {isManager && has && imp !== 0 && (
                    <span className={soldQty > 0 ? 'ok-text' : 'warn-text'} style={{ fontSize: '0.82rem' }}>
                      {isCocina ? 'Costo' : (soldQty > 0 ? 'Venta est.' : 'Sobrante')}: {formatMoney(Math.abs(imp), baseCurrency)}
                    </span>
                  )}
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

      {isManager && (totals.short !== 0 || totals.over !== 0) && (
        <section className="card">
          <div className="kv">
            <span className="muted">{isCocina ? 'Costo consumido (estimado)' : 'Venta estimada sin carrito'}</span>
            <strong>{formatMoney(totals.short, baseCurrency)}</strong>
          </div>
          {totals.over !== 0 && (
            <div className="kv">
              <span className="muted">{isCocina ? 'Sobrante contado' : 'Sobrante (¿cobrado sin entregar?)'}</span>
              <strong className="warn-text">{formatMoney(totals.over, baseCurrency)}</strong>
            </div>
          )}
          <p className="muted"><small>
            Estimado informativo: existencia en sistema − real contado, por {isCocina ? 'costo' : 'precio de venta'}.
            No cambia el ajuste de existencias.
          </small></p>
        </section>
      )}

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
