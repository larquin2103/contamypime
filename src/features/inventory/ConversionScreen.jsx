import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { productsRepo } from '../../repositories/productsRepo'
import { conversionsRepo } from '../../repositories/conversionsRepo'
import { transfersRepo } from '../../repositories/transfersRepo'
import { configRepo } from '../../repositories/configRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { matchesQuery, normalize } from '../../lib/search'
import { round2, formatMoney } from '../../lib/currency'
import { WAREHOUSE, COCINA, COCINA_LABEL, UNITS, UNIT_LABELS } from '../../db/constants'

// Modulo mayorista: conversion de un producto del almacen central en otro con su
// propio codigo (ej. un saco de azucar de 500 lb -> varias jabas fraccionadas).
// La registra el dueño o un administrativo. Consume el origen y da de alta el
// destino en el almacen, con el costo trasladado (promedio ponderado). La rebaja
// y el alta las hace conversionsRepo.create (validada y atomica).
//
// El destino puede ser un producto EXISTENTE (comportamiento clasico) o uno NUEVO:
// en ese caso se escribe nombre, unidad y precio de venta y, al registrar, primero
// se crea el producto en el catalogo (productsRepo.create) y enseguida se convierte
// hacia el. Nota (riesgo asumido): crear y convertir son DOS transacciones, no una;
// si la conversion fallara tras crear, quedaria un producto nuevo con 0 existencia
// (inofensivo, append-only, se puede dar de baja). No se toca conversionsRepo ni
// productsRepo; solo se usan sus metodos existentes.
//
// Tras convertir, un panel OPCIONAL permite enviar el resultante del almacen a un
// area (o a la cocina, solo con el modulo 'cocina') reusando transfersRepo.move. Es
// una operacion APARTE: primero la conversion, despues (si se quiere) el envio.

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
  const { user, isManager, can } = useAuth()
  const { hasModule } = useLicense()
  const products = useLiveQuery(() => productsRepo.listActive(), [], [])
  const areas = useLiveQuery(() => configRepo.getAreas(), [], [])

  const [fromProduct, setFromProduct] = useState(null)
  const [toProduct, setToProduct] = useState(null)
  const [fromQty, setFromQty] = useState('')
  const [toQty, setToQty] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [doneMsg, setDoneMsg] = useState('')
  // Modo del destino: 'existing' (clasico) o 'new' (se crea en el catalogo al registrar).
  const [destMode, setDestMode] = useState('existing')
  const [newName, setNewName] = useState('')
  const [newUnit, setNewUnit] = useState(UNITS[0])
  const [newPrice, setNewPrice] = useState('')
  const [newCode, setNewCode] = useState('')
  // Panel de envio (opcional) del producto resultante tras convertir.
  const [lastResult, setLastResult] = useState(null)
  const [sendTo, setSendTo] = useState('')
  const [sendQty, setSendQty] = useState('')
  const [sendBusy, setSendBusy] = useState(false)
  const [sendError, setSendError] = useState('')
  const [sendMsg, setSendMsg] = useState('')

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
  // Permiso configurable: el dueño puede quitarle esta facultad al administrativo.
  if (!can('conversion')) {
    return (
      <div className="screen">
        <h2>Conversión de productos</h2>
        <section className="card">
          <p>No tienes autorización del dueño para crear conversiones de productos.</p>
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

  // Destino segun el modo. En 'new' la unidad la elige el usuario; en 'existing' se
  // conserva la del producto (no se muta nada). El costo por unidad del destino no
  // depende del producto: sale del valor consumido / cantidad resultante.
  const destUnit = destMode === 'new' ? newUnit : (to?.unit || '')
  // Codigo repetido (solo 'new'): se valida contra el catalogo cargado, sin async.
  const codeTaken = destMode === 'new' && !!newCode.trim() &&
    products.some((p) => (p.code || '').trim() && normalize(p.code) === normalize(newCode))
  const newReady = !!newName.trim() && !!newUnit && Number(newPrice) > 0 && !codeTaken
  const destReady = destMode === 'new' ? newReady : !!to
  const valid = destMode === 'new'
    ? (!!from && newReady && fq > 0 && tq > 0 && !over)
    : (!!from && !!to && from.id !== to.id && fq > 0 && tq > 0 && !over)

  // Panel de envio: existencia en almacen del resultante (dato en vivo) y validacion.
  const resultLive = lastResult ? products.find((p) => p.id === lastResult.productId) : null
  const resultWh = resultLive ? Number(resultLive.stockByLocation?.[WAREHOUSE] || 0) : 0
  const sq = Number(sendQty) || 0
  const sendOver = sq > resultWh
  const sendValid = !!lastResult && !!sendTo && sq > 0 && !sendOver
  const canKitchen = hasModule(LICENSE_MODULES.KITCHEN)

  const register = async () => {
    setError('')
    setDoneMsg('')
    setBusy(true)
    try {
      // Destino nuevo: se crea el producto ANTES de convertir (conversionsRepo exige
      // que exista). El costo va en 0: lo fija la conversion por promedio ponderado.
      let toId, toName, toUnit
      if (destMode === 'new') {
        toId = await productsRepo.create({
          code: newCode,
          name: newName,
          unit: newUnit,
          price: Number(newPrice) || 0,
          cost: 0,
          userId: user.id
        })
        toName = newName.trim()
        toUnit = newUnit
      } else {
        toId = to.id
        toName = to.name
        toUnit = to.unit
      }
      const res = await conversionsRepo.create({
        fromProductId: from.id,
        toProductId: toId,
        fromQty: fq,
        toQty: tq,
        byUserId: user.id,
        note
      })
      setDoneMsg(
        `✅ Convertido: ${fq} ${from.unit} de "${from.name}" → ${tq} ${toUnit} de "${toName}". ` +
        `Costo por ${toUnit}: ${formatMoney(res?.unitCostTo ?? unitCostTo)}.`
      )
      // Prepara el panel de envio (opcional) con el producto resultante.
      setLastResult({ productId: toId, name: toName, unit: toUnit, qty: tq })
      setSendTo('')
      setSendQty(String(tq))
      setSendError('')
      setSendMsg('')
      // Limpia el formulario de conversion para el proximo registro.
      setFromProduct(null); setToProduct(null)
      setFromQty(''); setToQty(''); setNote('')
      setNewName(''); setNewUnit(UNITS[0]); setNewPrice(''); setNewCode('')
      setDestMode('existing')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  // Envio OPCIONAL del resultante: almacen -> area (o cocina). Operacion APARTE de la
  // conversion; reusa el motor de traspaso existente (transfersRepo.move) sin tocarlo.
  const send = async () => {
    setSendError('')
    setSendMsg('')
    setSendBusy(true)
    try {
      await transfersRepo.move({
        fromLocation: WAREHOUSE,
        toLocation: sendTo,
        items: [{ productId: lastResult.productId, name: lastResult.name, unit: lastResult.unit, qty: sq }],
        byUserId: user.id
      })
      const label = sendTo === COCINA ? COCINA_LABEL : sendTo
      setSendMsg(`✅ Enviado ${sq} ${lastResult.unit} de "${lastResult.name}" a ${label}.`)
      setLastResult(null)
    } catch (e) {
      setSendError(e.message)
    } finally {
      setSendBusy(false)
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
      {sendMsg && <p className="ok-text">{sendMsg}</p>}

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

      {/* 2. Producto de destino: existente (clasico) o nuevo (se crea al registrar). */}
      <section className="card">
        <h3>2. Producto resultante (destino)</h3>
        <div className="period-row">
          <button
            className={`btn btn--sm ${destMode === 'existing' ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => { setDestMode('existing'); setError('') }}
          >
            Existente
          </button>
          <button
            className={`btn btn--sm ${destMode === 'new' ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => { setDestMode('new'); setToProduct(null); setToQty(''); setError('') }}
          >
            Nuevo
          </button>
        </div>

        {destMode === 'existing' ? (
          <>
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
          </>
        ) : (
          <>
            <p className="muted">Si no existe, se crea en el catálogo al registrar la conversión.</p>
            <label className="field">
              <span>Nombre del producto nuevo</span>
              <input value={newName} onChange={(e) => setNewName(e.target.value)}
                placeholder="Ej.: Azúcar (jaba de 5 lb)" />
            </label>
            <label className="field">
              <span>Unidad de medida</span>
              <select value={newUnit} onChange={(e) => setNewUnit(e.target.value)}>
                {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABELS[u] || u}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Precio de venta</span>
              <input type="number" inputMode="decimal" value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)} />
            </label>
            <label className="field">
              <span>Código (opcional)</span>
              <input value={newCode} onChange={(e) => setNewCode(e.target.value)}
                placeholder="Déjalo en blanco si no usas código" />
            </label>
            {codeTaken && <p className="error">Ya existe un producto con ese código.</p>}
            <label className="field">
              <span>Cantidad resultante ({newUnit})</span>
              <input type="number" inputMode="decimal" value={toQty}
                onChange={(e) => setToQty(e.target.value)} />
            </label>
          </>
        )}
      </section>

      {/* 3. Vista previa del costo y confirmar. */}
      {from && destReady && fq > 0 && tq > 0 && (
        <section className="card">
          <h3>3. Resumen</h3>
          <div className="kv"><span className="muted">Valor consumido</span><strong>{formatMoney(movedValue)}</strong></div>
          <div className="kv"><span className="muted">Costo por {destUnit} (nuevo)</span><strong>{formatMoney(unitCostTo)}</strong></div>
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

      {/* 4. Envio OPCIONAL del resultante a un area (o cocina). Operacion aparte. */}
      {lastResult && (
        <section className="card">
          <h3>Enviar a un área (opcional)</h3>
          <p className="muted">
            “{lastResult.name}” quedó en el almacén ({resultWh} {lastResult.unit}). Puedes enviarlo ahora
            a un área o dejarlo para “Salida a áreas”.
          </p>
          {areas.length === 0 && !canKitchen ? (
            <p className="muted">No hay áreas configuradas. Defínelas en Ajustes para poder enviar.</p>
          ) : (
            <>
              <label className="field">
                <span>Destino</span>
                <select value={sendTo} onChange={(e) => setSendTo(e.target.value)}>
                  <option value="">— Elige el destino —</option>
                  {areas.map((a) => <option key={a} value={a}>{a}</option>)}
                  {canKitchen && <option value={COCINA}>{COCINA_LABEL}</option>}
                </select>
              </label>
              <label className="field">
                <span>Cantidad a enviar ({lastResult.unit})</span>
                <input type="number" inputMode="decimal" value={sendQty}
                  onChange={(e) => setSendQty(e.target.value)} />
              </label>
              {sendOver && <p className="error">No hay tanto en el almacén (disponible {resultWh}).</p>}
              {sendError && <p className="error">{sendError}</p>}
              <div className="modal__actions">
                <button className="btn btn--ghost" onClick={() => setLastResult(null)}>Ahora no</button>
                <button className="btn btn--primary" disabled={!sendValid || sendBusy} onClick={send}>
                  {sendBusy ? 'Enviando…' : 'Enviar'}
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  )
}
