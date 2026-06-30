import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { productsRepo } from '../../repositories/productsRepo'
import { categoriesRepo } from '../../repositories/categoriesRepo'
import { purchasesRepo } from '../../repositories/purchasesRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useShift } from '../../app/providers/ShiftProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { matchesQuery } from '../../lib/search'
import { round2, formatMoney } from '../../lib/currency'
import { WAREHOUSE } from '../../db/constants'
import { ProductForm } from '../products/ProductForm'
import { parseEntryFile, buildEntryTemplateBlob, ENTRY_TEMPLATE_HEADERS } from '../import/entryImportService'

export function EntryScreen() {
  const { user, isManager } = useAuth()
  const { activeShift, canSell } = useShift()
  const { baseCurrency } = useCurrency()
  const products = useLiveQuery(() => productsRepo.listActive(), [], [])
  const categories = useLiveQuery(() => categoriesRepo.list(), [], [])

  const [query, setQuery] = useState('')
  const [lines, setLines] = useState([]) // [{ productId, name, unit, qty, unitCost }]
  const [supplier, setSupplier] = useState('')
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [importMsg, setImportMsg] = useState(null) // { added, notFound:[], errors:[] }
  const fileRef = useRef(null)

  // Dueño o administrativo registran entradas de mercancia (y ven costos).
  if (!isManager) {
    return (
      <div className="screen">
        <h2>Entrada de mercancia</h2>
        <section className="card">
          <p>Solo el <strong>dueño o un administrativo</strong> puede registrar entradas de mercancia.</p>
          <Link className="btn btn--primary btn--block" to="/">Volver al inicio</Link>
        </section>
      </div>
    )
  }

  const results = useMemo(() => {
    if (!query.trim()) return []
    return products.filter((p) => matchesQuery(p, query)).slice(0, 20)
  }, [products, query])

  // Existencia ACTUAL en el almacen por producto (la entrada se suma a esto).
  const warehouseStock = useMemo(() => {
    const m = {}
    for (const p of products) m[p.id] = Number(p.stockByLocation?.[WAREHOUSE] ?? p.stock ?? 0)
    return m
  }, [products])

  const addLine = (p) => {
    setLines((prev) => {
      if (prev.some((l) => l.productId === p.id)) return prev
      return [...prev, { productId: p.id, name: p.name, unit: p.unit, qty: 1, unitCost: p.cost || '' }]
    })
    setQuery('')
  }

  const onCreated = async (newId) => {
    const p = await productsRepo.get(newId)
    if (p) addLine(p)
  }

  // Importacion masiva: lee el Excel, coteja por codigo/nombre y rellena las
  // lineas (sumando si un producto ya estaba). Luego se revisa y se registra.
  const downloadTemplate = async () => {
    const blob = await buildEntryTemplateBlob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'plantilla_entrada.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  }

  const onImportFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setImportMsg(null)
    try {
      const buffer = await file.arrayBuffer()
      const all = await productsRepo.list()
      const { lines: parsed, notFound, errors } = await parseEntryFile(buffer, all)
      setLines((prev) => {
        const next = [...prev]
        for (const l of parsed) {
          const i = next.findIndex((x) => x.productId === l.productId)
          if (i >= 0) next[i] = { ...next[i], qty: round2(Number(next[i].qty) + l.qty), unitCost: l.unitCost }
          else next.push(l)
        }
        return next
      })
      setImportMsg({ added: parsed.length, notFound, errors })
    } catch (err) {
      setImportMsg({ added: 0, notFound: [], errors: ['No se pudo leer el archivo: ' + err.message] })
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const update = (productId, field, value) =>
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, [field]: value } : l)))

  const removeLine = (productId) =>
    setLines((prev) => prev.filter((l) => l.productId !== productId))

  const total = useMemo(
    () => round2(lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0)),
    [lines]
  )

  const valid = lines.length > 0 && lines.every((l) => Number(l.qty) > 0 && Number(l.unitCost) >= 0)

  const register = async () => {
    setBusy(true)
    await purchasesRepo.create({
      items: lines,
      supplier,
      userId: user.id,
      shiftId: activeShift?.id ?? null
    })
    setDone(true)
    setLines([])
    setSupplier('')
    setBusy(false)
  }

  if (done) {
    return (
      <div className="screen">
        <div className="cuadre-banner cuadre-banner--green">
          <span className="cuadre-emoji">📥</span>
          <div>
            <strong>Entrada registrada</strong>
            <p className="muted">Las existencias se actualizaron al instante.</p>
          </div>
        </div>
        <button className="btn btn--primary btn--block" onClick={() => setDone(false)}>
          Registrar otra entrada
        </button>
        <Link className="btn btn--ghost btn--block" to="/catalog">Ver catalogo</Link>
      </div>
    )
  }

  return (
    <div className="screen">
      <div className="screen__header">
        <h2>Entrada de mercancia</h2>
        <div className="header-actions">
          <button className="btn btn--ghost btn--sm" onClick={() => fileRef.current?.click()} disabled={busy}>
            ⬆ Importar Excel
          </button>
          <button className="btn btn--ghost btn--sm" onClick={() => setCreating(true)}>
            + Producto nuevo
          </button>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={onImportFile}
        style={{ display: 'none' }}
      />

      <section className="card import-entry-hint">
        <p className="muted">
          Las entradas ingresan al <strong>almacén central</strong> y se <strong>suman</strong> a la
          existencia actual (no la reemplazan). Desde el almacén se reparte a las áreas con “Salida a área”.
        </p>
        <p className="muted">
          Para cargar muchos productos a la vez, usa <strong>⬆ Importar Excel</strong>.
          Columnas: {ENTRY_TEMPLATE_HEADERS.join(', ')} (coteja por codigo).{' '}
          <button className="link-inline" onClick={downloadTemplate}>Descargar plantilla</button>
        </p>
      </section>

      {importMsg && (
        <section className={`card ${importMsg.notFound.length || importMsg.errors.length ? 'import-result--warn' : 'import-result--ok'}`}>
          <strong>{importMsg.added} producto(s) agregado(s) a la entrada.</strong>
          {importMsg.notFound.length > 0 && (
            <p className="muted">
              No encontrados en el catalogo ({importMsg.notFound.length}): {importMsg.notFound.slice(0, 15).join(', ')}
              {importMsg.notFound.length > 15 ? '…' : ''}. Créalos en el catalogo y vuelve a importar.
            </p>
          )}
          {importMsg.errors.length > 0 && (
            <p className="muted">{importMsg.errors.slice(0, 10).join(' · ')}</p>
          )}
          <button className="link-inline" onClick={() => setImportMsg(null)}>Ocultar</button>
        </section>
      )}

      <input
        className="search-input"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar producto (3 letras o codigo)…"
      />
      {results.length > 0 && (
        <div className="product-list sell-results">
          {results.map((p) => (
            <button key={p.id} className="product-row" onClick={() => addLine(p)}>
              <div className="product-row__main">
                <strong>{p.name}</strong>
                <span className="muted">{p.code ? `${p.code} · ` : ''}almacén {Number(p.stockByLocation?.[WAREHOUSE] ?? p.stock ?? 0)} {p.unit}</span>
              </div>
              <span className="muted">costo {formatMoney(p.cost, baseCurrency)}</span>
            </button>
          ))}
        </div>
      )}

      <section className="card">
        <h3>Productos que entran</h3>
        {lines.length === 0 ? (
          <p className="muted">Busca un producto (o crea uno nuevo) para agregarlo.</p>
        ) : (
          <div className="entry-lines">
            {lines.map((l) => (
              <div key={l.productId} className="entry-line">
                <div className="entry-line__head">
                  <strong>{l.name}</strong>
                  <button className="link-del" onClick={() => removeLine(l.productId)}>quitar</button>
                </div>
                <p className="muted">
                  Almacén actual: {warehouseStock[l.productId] ?? 0} {l.unit}
                  {Number(l.qty) > 0 && ` → quedará: ${round2((warehouseStock[l.productId] ?? 0) + Number(l.qty))} ${l.unit}`}
                </p>
                <div className="form-row">
                  <label className="field">
                    <span>Cantidad ({l.unit})</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={l.qty}
                      onChange={(e) => update(l.productId, 'qty', e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Costo unitario ({baseCurrency})</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={l.unitCost}
                      onChange={(e) => update(l.productId, 'unitCost', e.target.value)}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {lines.length > 0 && (
        <section className="card">
          <label className="field">
            <span>Proveedor (opcional)</span>
            <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Nombre o referencia" />
          </label>
          <div className="total-row">
            <span>Total de la compra</span>
            <strong className="total-amount">{formatMoney(total, baseCurrency)}</strong>
          </div>
          <button className="btn btn--primary btn--block" disabled={!valid || busy} onClick={register}>
            {busy ? 'Registrando…' : 'Registrar entrada'}
          </button>
        </section>
      )}

      {creating && (
        <ProductForm
          categories={categories}
          hideOpeningStock
          onCreated={onCreated}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  )
}
