import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { productsRepo } from '../../repositories/productsRepo'
import { configRepo } from '../../repositories/configRepo'
import { transfersRepo } from '../../repositories/transfersRepo'
import { conversionsRepo } from '../../repositories/conversionsRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { matchesQuery } from '../../lib/search'
import { round2, formatMoney } from '../../lib/currency'
import { WAREHOUSE, ELABORATION } from '../../db/constants'

// Módulo elaboración. Centro intermedio entre el almacén y las áreas de venta.
// Tres acciones para el dueño/admin: (1) enviar crudo del almacén a elaboración,
// (2) transformar en elaboración (consume crudo -> nuevo código, con merma),
// (3) enviar lo elaborado a un área de venta. Todo gateado por el módulo.

const stockAt = (p, loc) =>
  Number(p?.stockByLocation?.[loc] ?? (loc === WAREHOUSE ? p?.stock : 0) ?? 0)

// Panel de traspaso de una ubicación a otra (checklist con cantidades).
function TransferPanel({ title, hint, products, fromLocation, fixedTo, areas = [], byUserId }) {
  const [toArea, setToArea] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [doneMsg, setDoneMsg] = useState('')

  const productById = useMemo(() => {
    const m = {}; for (const p of products) m[p.id] = p; return m
  }, [products])

  const eligible = useMemo(() => {
    const list = products.filter((p) => stockAt(p, fromLocation) > 0)
    const filtered = query.trim() ? list.filter((p) => matchesQuery(p, query)) : list
    return filtered.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 40)
  }, [products, query, fromLocation])

  const to = fixedTo || toArea
  const toggle = (p) => {
    setDoneMsg('')
    setSelected((prev) => {
      const next = { ...prev }
      if (p.id in next) delete next[p.id]; else next[p.id] = '1'
      return next
    })
  }
  const setQty = (id, v) => setSelected((prev) => ({ ...prev, [id]: v }))
  const selectedList = Object.keys(selected).map((id) => productById[id]).filter(Boolean)
  const qtyOf = (id) => Number(selected[id]) || 0
  const overOf = (p) => qtyOf(p.id) > stockAt(p, fromLocation)
  const allValid = selectedList.every((p) => qtyOf(p.id) > 0 && !overOf(p))
  const valid = !!to && selectedList.length > 0 && allValid

  const register = async () => {
    setError(''); setBusy(true)
    try {
      const items = selectedList.map((p) => ({ productId: p.id, name: p.name, unit: p.unit, qty: qtyOf(p.id) }))
      await transfersRepo.move({ fromLocation, toLocation: to, items, byUserId })
      setDoneMsg(`✅ ${items.length} producto(s) enviados.`)
      setSelected({}); setQuery('')
    } catch (e) {
      setError(e.message)
    } finally { setBusy(false) }
  }

  return (
    <section className="card">
      <h3>{title}</h3>
      <p className="muted">{hint}</p>
      {!fixedTo && (
        <label className="field">
          <span>Área de destino</span>
          <select value={toArea} onChange={(e) => { setToArea(e.target.value); setDoneMsg('') }}>
            <option value="">— Elige el área —</option>
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      )}
      {doneMsg && <p className="ok-text">{doneMsg}</p>}

      {selectedList.length > 0 && (
        <div className="entry-lines">
          {selectedList.map((p) => {
            const avail = stockAt(p, fromLocation)
            return (
              <div key={p.id} className="entry-line">
                <div className="entry-line__head">
                  <div><strong>{p.name}</strong><span className="muted"> · disp: {avail} {p.unit}</span></div>
                  <button className="link-del" onClick={() => toggle(p)}>quitar</button>
                </div>
                <label className="field">
                  <span>Cantidad ({p.unit})</span>
                  <input type="number" inputMode="decimal" value={selected[p.id] ?? ''}
                    onChange={(e) => setQty(p.id, e.target.value)} />
                </label>
                {overOf(p) && <p className="error">No hay tanto disponible ({avail}).</p>}
              </div>
            )
          })}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {selectedList.length > 0 && (
        <button className="btn btn--primary btn--block" disabled={!valid || busy} onClick={register}>
          {busy ? 'Enviando…' : `Enviar ${selectedList.length} producto(s)`}
        </button>
      )}

      <input className="search-input" type="search" value={query}
        onChange={(e) => setQuery(e.target.value)} placeholder="Buscar producto…" />
      <div className="list">
        {eligible.length === 0 && <p className="muted">No hay productos con existencia aquí.</p>}
        {eligible.map((p) => {
          const checked = p.id in selected
          return (
            <label key={p.id} className={`check-row ${checked ? 'is-checked' : ''}`}>
              <input type="checkbox" checked={checked} onChange={() => toggle(p)} />
              <div className="check-row__main">
                <strong>{p.name}</strong>
                <span className="muted">{p.code ? `${p.code} · ` : ''}disp: {stockAt(p, fromLocation)} {p.unit}</span>
              </div>
            </label>
          )
        })}
      </div>
    </section>
  )
}

// Panel de transformación en elaboración: consume un crudo y da de alta otro
// producto (nuevo código) en elaboración, con merma. Costo por promedio ponderado.
function TransformPanel({ products, byUserId }) {
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [fromQty, setFromQty] = useState('')
  const [toQty, setToQty] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [doneMsg, setDoneMsg] = useState('')

  const byId = useMemo(() => { const m = {}; for (const p of products) m[p.id] = p; return m }, [products])
  const from = byId[fromId] || null
  const to = byId[toId] || null
  // Origen: solo productos con existencia en elaboración.
  const origins = useMemo(
    () => products.filter((p) => stockAt(p, ELABORATION) > 0).sort((a, b) => a.name.localeCompare(b.name)),
    [products]
  )
  const dests = useMemo(
    () => products.filter((p) => p.id !== fromId).sort((a, b) => a.name.localeCompare(b.name)),
    [products, fromId]
  )

  const fq = Number(fromQty) || 0
  const tq = Number(toQty) || 0
  const avail = stockAt(from, ELABORATION)
  const over = from && fq > avail
  const movedValue = round2(fq * Number(from?.cost || 0))
  const unitCostTo = tq > 0 ? round2(movedValue / tq) : 0
  const rendimiento = from && to && fq > 0 && tq > 0 ? Math.round((tq / fq) * 100) : null
  const valid = from && to && from.id !== to.id && fq > 0 && tq > 0 && !over

  const register = async () => {
    setError(''); setDoneMsg(''); setBusy(true)
    try {
      const res = await conversionsRepo.create({
        fromProductId: from.id, toProductId: to.id, fromQty: fq, toQty: tq,
        byUserId, note, location: ELABORATION
      })
      setDoneMsg(`✅ ${fq} ${from.unit} de "${from.name}" → ${tq} ${to.unit} de "${to.name}". Costo por ${to.unit}: ${formatMoney(res?.unitCostTo ?? unitCostTo)}.`)
      setFromId(''); setToId(''); setFromQty(''); setToQty(''); setNote('')
    } catch (e) {
      setError(e.message)
    } finally { setBusy(false) }
  }

  return (
    <section className="card">
      <h3>2. Transformar en elaboración</h3>
      <p className="muted">Consume un producto crudo de elaboración y da de alta el elaborado (otro código, ya creado en el catálogo). Puede haber merma.</p>
      {doneMsg && <p className="ok-text">{doneMsg}</p>}

      <label className="field">
        <span>Producto crudo a consumir</span>
        <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
          <option value="">— Elige el crudo (en elaboración) —</option>
          {origins.map((p) => <option key={p.id} value={p.id}>{p.name} (disp: {stockAt(p, ELABORATION)} {p.unit})</option>)}
        </select>
      </label>
      {from && (
        <label className="field">
          <span>Cantidad a consumir ({from.unit})</span>
          <input type="number" inputMode="decimal" value={fromQty} onChange={(e) => setFromQty(e.target.value)} />
        </label>
      )}
      {over && <p className="error">No hay tanto en elaboración (disponible {avail}).</p>}

      <label className="field">
        <span>Producto elaborado (destino)</span>
        <select value={toId} onChange={(e) => setToId(e.target.value)}>
          <option value="">— Elige el elaborado —</option>
          {dests.map((p) => <option key={p.id} value={p.id}>{p.name}{p.code ? ` (${p.code})` : ''}</option>)}
        </select>
      </label>
      {to && (
        <label className="field">
          <span>Cantidad resultante ({to.unit})</span>
          <input type="number" inputMode="decimal" value={toQty} onChange={(e) => setToQty(e.target.value)} />
        </label>
      )}

      {valid && (
        <>
          <div className="kv"><span className="muted">Rendimiento</span><strong>{rendimiento}%{rendimiento < 100 ? ` (merma ${100 - rendimiento}%)` : ''}</strong></div>
          <div className="kv"><span className="muted">Valor consumido</span><strong>{formatMoney(movedValue)}</strong></div>
          <div className="kv"><span className="muted">Costo por {to.unit} (nuevo)</span><strong>{formatMoney(unitCostTo)}</strong></div>
          <label className="field">
            <span>Nota (opcional)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: fileteado de 1 pieza" />
          </label>
        </>
      )}
      {error && <p className="error">{error}</p>}
      <button className="btn btn--primary btn--block" disabled={!valid || busy} onClick={register}>
        {busy ? 'Transformando…' : 'Registrar transformación'}
      </button>
    </section>
  )
}

export function ElaborationScreen() {
  const { user, isManager } = useAuth()
  const { hasModule } = useLicense()
  const products = useLiveQuery(() => productsRepo.listActive(), [], [])
  const areas = useLiveQuery(() => configRepo.getAreas(), [], [])
  const elab = useLiveQuery(() => configRepo.getElaboration(), [], undefined)

  if (!isManager) {
    return (
      <div className="screen">
        <h2>Elaboración</h2>
        <section className="card">
          <p>Solo el <strong>dueño o un administrativo</strong> puede operar el centro de elaboración.</p>
          <Link className="btn btn--primary btn--block" to="/">Volver al inicio</Link>
        </section>
      </div>
    )
  }
  if (!hasModule(LICENSE_MODULES.ELABORATION)) {
    return (
      <div className="screen">
        <h2>Elaboración</h2>
        <section className="card">
          <p>Esta función es parte del módulo <strong>Centro de elaboración</strong> de tu licencia.</p>
          <Link className="btn btn--primary btn--block" to="/">Volver al inicio</Link>
        </section>
      </div>
    )
  }
  if (elab === undefined) return <div className="screen"><p className="muted">Cargando…</p></div>
  if (!elab.enabled) {
    return (
      <div className="screen">
        <h2>Elaboración</h2>
        <section className="card">
          <p>Primero <strong>activa el centro de elaboración</strong> en Ajustes.</p>
          <Link className="btn btn--primary btn--block" to="/settings">Ir a Ajustes</Link>
        </section>
      </div>
    )
  }

  return (
    <div className="screen">
      <h2>{elab.name}</h2>
      <p className="muted">
        Centro intermedio entre el almacén y las áreas de venta. Envía el crudo aquí,
        transfórmalo (con su nuevo código) y mándalo ya elaborado a un área.
      </p>

      <TransferPanel
        title="1. Enviar al centro de elaboración"
        hint="Saca productos crudos del almacén central hacia elaboración."
        products={products}
        fromLocation={WAREHOUSE}
        fixedTo={ELABORATION}
        byUserId={user.id}
      />

      <TransformPanel products={products} byUserId={user.id} />

      <TransferPanel
        title="3. Enviar a un área de venta"
        hint="Manda lo ya elaborado a un área para venderlo."
        products={products}
        fromLocation={ELABORATION}
        areas={areas}
        byUserId={user.id}
      />
    </div>
  )
}
