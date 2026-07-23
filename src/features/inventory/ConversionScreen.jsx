import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { productsRepo } from '../../repositories/productsRepo'
import { conversionsRepo } from '../../repositories/conversionsRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { matchesQuery } from '../../lib/search'
import { round2, formatMoney } from '../../lib/currency'
import { WAREHOUSE } from '../../db/constants'

// Modulo mayorista: conversion de un producto del almacen central en otro con su
// propio codigo (ej. un saco de azucar de 500 lb -> varias jabas fraccionadas).
// La registra el dueño o un administrativo. Consume el origen y da de alta el
// destino en el almacen, con el costo trasladado (promedio ponderado). La rebaja
// y el alta las hace conversionsRepo.create (validada y atomica).

// Buscador/selector de un producto del catalogo (con su existencia en almacen).
function ProductPicker({ label, products, excludeId, onlyWithStock, onPick }) {
  const [query, setQuery] = useState('')
  const warehouseOf = (p) => Number(p.stockByLocation?.[WAREHOUSE] || 0)
  const results = useMemo(() => {
    let list = products.filter((p) => p.id !== excludeId)
    if (onlyWithStock) list = list.filter((p) => warehouseOf(p) > 0)
    if (query.trim()) list = list.filter((p) => matchesQuery(p, query))
    return list.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 25)
  }, [products, query, excludeId, onlyWithStock])

  return (
    <div>
      <input
        className="search-input"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={label}
      />
      {query.trim() && (
        <div className="list">
          {results.length === 0 && <p className="muted">Sin resultados.</p>}
          {results.map((p) => (
            <button key={p.id} className="list-item" onClick={() => { onPick(p); setQuery('') }}>
              <div>
                <strong>{p.name}</strong>
                <span className="muted"> {p.code ? `· ${p.code} ` : ''}· almacén: {warehouseOf(p)} {p.unit}</span>
              </div>
              <span className="muted">›</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ConversionScreen() {
  const { user, isManager } = useAuth()
  const { hasModule } = useLicense()
  const products = useLiveQuery(() => productsRepo.listActive(), [], [])

  const [fromProduct, setFromProduct] = useState(null)
  const [toProduct, setToProduct] = useState(null)
  const [fromQty, setFromQty] = useState('')
  const [toQty, setToQty] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [doneMsg, setDoneMsg] = useState('')

  // Refresca el producto elegido con el dato en vivo (existencia/costo actuales).
  const live = (p) => (p ? products.find((x) => x.id === p.id) || p : null)
  const from = live(fromProduct)
  const to = live(toProduct)

  if (!isManager) {
    return (
      <div className="screen">
        <h2>Conversión de productos</h2>
        <section className="card">
          <p>Solo el <strong>dueño o un administrativo</strong> puede convertir productos del almacén.</p>
          <Link className="btn btn--primary btn--block" to="/">Volver al inicio</Link>
        </section>
      </div>
    )
  }
  if (!hasModule(LICENSE_MODULES.WHOLESALE)) {
    return (
      <div className="screen">
        <h2>Conversión de productos</h2>
        <section className="card">
          <p>Esta función es parte del módulo <strong>Ventas mayoristas</strong> de tu licencia.</p>
          <Link className="btn btn--primary btn--block" to="/">Volver al inicio</Link>
        </section>
      </div>
    )
  }

  const warehouseOf = (p) => Number(p?.stockByLocation?.[WAREHOUSE] || 0)
  const fq = Number(fromQty) || 0
  const tq = Number(toQty) || 0
  const availFrom = warehouseOf(from)
  const over = from && fq > availFrom
  // Vista previa del costo trasladado al destino.
  const movedValue = round2(fq * Number(from?.cost || 0))
  const unitCostTo = tq > 0 ? round2(movedValue / tq) : 0

  const valid = from && to && from.id !== to.id && fq > 0 && tq > 0 && !over

  const register = async () => {
    setError('')
    setDoneMsg('')
    setBusy(true)
    try {
      const res = await conversionsRepo.create({
        fromProductId: from.id,
        toProductId: to.id,
        fromQty: fq,
        toQty: tq,
        byUserId: user.id,
        note
      })
      setDoneMsg(
        `✅ Convertido: ${fq} ${from.unit} de "${from.name}" → ${tq} ${to.unit} de "${to.name}". ` +
        `Costo por ${to.unit}: ${formatMoney(res?.unitCostTo ?? unitCostTo)}.`
      )
      setFromProduct(null); setToProduct(null)
      setFromQty(''); setToQty(''); setNote('')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <h2>Conversión de productos</h2>
      <p className="muted">
        Consume un producto del almacén central y da de alta otro con su propio código
        (ej.: un saco de azúcar → jabas fraccionadas). El costo se traslada al producto nuevo.
      </p>
      {doneMsg && <p className="ok-text">{doneMsg}</p>}

      {/* 1. Producto de origen (se consume). */}
      <section className="card">
        <h3>1. Producto a consumir (origen)</h3>
        {!from ? (
          <ProductPicker
            label="Buscar producto del almacén…"
            products={products}
            excludeId={to?.id}
            onlyWithStock
            onPick={setFromProduct}
          />
        ) : (
          <>
            <div className="entry-line__head">
              <div>
                <strong>{from.name}</strong>
                <span className="muted"> · almacén: {availFrom} {from.unit} · costo {formatMoney(from.cost || 0)}</span>
              </div>
              <button className="link-del" onClick={() => { setFromProduct(null); setFromQty('') }}>cambiar</button>
            </div>
            <label className="field">
              <span>Cantidad a consumir ({from.unit})</span>
              <input type="number" inputMode="decimal" value={fromQty}
                onChange={(e) => setFromQty(e.target.value)} />
            </label>
            {over && <p className="error">No hay tanto en el almacén (disponible {availFrom}).</p>}
          </>
        )}
      </section>

      {/* 2. Producto de destino (se da de alta). */}
      <section className="card">
        <h3>2. Producto resultante (destino)</h3>
        <p className="muted">Debe existir ya en el catálogo con su propio código.</p>
        {!to ? (
          <ProductPicker
            label="Buscar producto destino…"
            products={products}
            excludeId={from?.id}
            onPick={setToProduct}
          />
        ) : (
          <>
            <div className="entry-line__head">
              <div>
                <strong>{to.name}</strong>
                <span className="muted"> {to.code ? `· ${to.code} ` : ''}· almacén: {warehouseOf(to)} {to.unit}</span>
              </div>
              <button className="link-del" onClick={() => { setToProduct(null); setToQty('') }}>cambiar</button>
            </div>
            <label className="field">
              <span>Cantidad resultante ({to.unit})</span>
              <input type="number" inputMode="decimal" value={toQty}
                onChange={(e) => setToQty(e.target.value)} />
            </label>
          </>
        )}
      </section>

      {/* 3. Vista previa del costo y confirmar. */}
      {from && to && fq > 0 && tq > 0 && (
        <section className="card">
          <h3>3. Resumen</h3>
          <div className="kv"><span className="muted">Valor consumido</span><strong>{formatMoney(movedValue)}</strong></div>
          <div className="kv"><span className="muted">Costo por {to.unit} (nuevo)</span><strong>{formatMoney(unitCostTo)}</strong></div>
          <label className="field">
            <span>Nota (opcional)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: desglose de 1 saco" />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="btn btn--primary btn--block" disabled={!valid || busy} onClick={register}>
            {busy ? 'Convirtiendo…' : 'Registrar conversión'}
          </button>
        </section>
      )}
    </div>
  )
}
