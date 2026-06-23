import { useMemo, useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { countsRepo } from '../../repositories/countsRepo'
import { categoriesRepo } from '../../repositories/categoriesRepo'
import { usersRepo } from '../../repositories/usersRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { formatDateTime } from '../../lib/dates'
import { SEMAPHORE_EMOJI } from '../../lib/semaphore'

export function CountScreen() {
  const { user, isOwner } = useAuth()
  const pending = useLiveQuery(() => countsRepo.getPending(), [], undefined)
  const draft = useLiveQuery(() => countsRepo.getDraft(), [], undefined)

  if (pending === undefined || draft === undefined) {
    return <div className="screen"><p className="muted">Cargando…</p></div>
  }

  // Hay un conteo esperando aprobacion: el dueño lo revisa; el resto espera.
  if (pending) {
    return isOwner ? (
      <CountReview count={pending} ownerId={user.id} />
    ) : (
      <div className="screen">
        <h2>Conteo fisico</h2>
        <section className="card">
          <p>Hay un conteo enviado, esperando la <strong>aprobacion del dueño</strong>.</p>
        </section>
      </div>
    )
  }

  if (draft) return <CountEditor draft={draft} />

  return (
    <div className="screen">
      <h2>Conteo fisico</h2>
      <section className="card">
        <p className="muted">
          Cuenta el inventario por categorias. Al terminar, el dueño aprueba y se ajustan
          las existencias.
        </p>
        <button
          className="btn btn--primary btn--block"
          onClick={() => countsRepo.startDraft(user.id)}
        >
          Iniciar conteo fisico
        </button>
      </section>
    </div>
  )
}

// ---- Contar (borrador) ----
function CountEditor({ draft }) {
  const categories = useLiveQuery(() => categoriesRepo.list(), [], [])
  const [items, setItems] = useState(draft.items)
  const [selectedCat, setSelectedCat] = useState(null)
  const [busy, setBusy] = useState(false)

  // Si cambia el borrador en BD (otra pestana), refrescamos.
  useEffect(() => { setItems(draft.items) }, [draft.id])

  const catName = useMemo(() => {
    const m = { __none: 'Sin categoria' }
    for (const c of categories) m[c.id] = c.name
    return m
  }, [categories])

  const groups = useMemo(() => {
    const g = {}
    items.forEach((it, idx) => {
      const key = it.categoryId || '__none'
      if (!g[key]) g[key] = []
      g[key].push({ ...it, idx })
    })
    return g
  }, [items])

  const counted = items.filter((it) => it.physicalQty !== null && it.physicalQty !== '').length
  const progress = items.length ? Math.round((counted / items.length) * 100) : 0

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
        <button className="link-back" onClick={() => { save(); setSelectedCat(null) }}>← Categorias</button>
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
                    placeholder="fisico"
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
          Guardar categoria
        </button>
      </div>
    )
  }

  // Vista de categorias con progreso
  return (
    <div className="screen">
      <div className="screen__header">
        <h2>Conteo fisico</h2>
        <span className="badge">{counted}/{items.length}</span>
      </div>
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
              <span className="muted">Sistema {it.systemStock} → Fisico {it.physicalQty} {it.unit}</span>
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
          <div className="modal" onClick={(e) => e.stopPropagation()}>
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
