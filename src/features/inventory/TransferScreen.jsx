import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { productsRepo } from '../../repositories/productsRepo'
import { configRepo } from '../../repositories/configRepo'
import { transfersRepo } from '../../repositories/transfersRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { matchesQuery } from '../../lib/search'
import { WAREHOUSE } from '../../db/constants'

// Bloque 20.2 - Salida del almacen central hacia un area. La registra el dueño o
// un administrativo. Resta del almacen y suma al area; el vendedor de esa area
// solo puede vender lo que aqui se le asigna.
export function TransferScreen() {
  const { user, isManager } = useAuth()
  const products = useLiveQuery(() => productsRepo.listActive(), [], [])
  const areas = useLiveQuery(() => configRepo.getAreas(), [], [])

  const [toArea, setToArea] = useState('')
  const [query, setQuery] = useState('')
  const [lines, setLines] = useState([]) // [{ productId, name, unit, qty, warehouse }]
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const warehouseOf = (p) => Number(p.stockByLocation?.[WAREHOUSE] || 0)

  const results = useMemo(() => {
    if (!query.trim()) return []
    return products.filter((p) => matchesQuery(p, query)).slice(0, 20)
  }, [products, query])

  if (!isManager) {
    return (
      <div className="screen">
        <h2>Salida a área</h2>
        <section className="card">
          <p>Solo el <strong>dueño o un administrativo</strong> puede sacar mercancía del almacén hacia las áreas.</p>
          <Link className="btn btn--primary btn--block" to="/">Volver al inicio</Link>
        </section>
      </div>
    )
  }

  if (!areas || areas.length === 0) {
    return (
      <div className="screen">
        <h2>Salida a área</h2>
        <section className="card">
          <p>Primero define las <strong>áreas de venta</strong> en Ajustes.</p>
          <Link className="btn btn--primary btn--block" to="/settings">Ir a Ajustes</Link>
        </section>
      </div>
    )
  }

  const addLine = (p) => {
    setLines((prev) => {
      if (prev.some((l) => l.productId === p.id)) return prev
      return [...prev, { productId: p.id, name: p.name, unit: p.unit, qty: 1, warehouse: warehouseOf(p) }]
    })
    setQuery('')
  }

  const update = (productId, value) =>
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, qty: value } : l)))

  const removeLine = (productId) =>
    setLines((prev) => prev.filter((l) => l.productId !== productId))

  const valid =
    !!toArea &&
    lines.length > 0 &&
    lines.every((l) => Number(l.qty) > 0 && Number(l.qty) <= l.warehouse)

  const register = async () => {
    setError('')
    setBusy(true)
    try {
      await transfersRepo.create({
        toArea,
        items: lines.map((l) => ({ productId: l.productId, name: l.name, unit: l.unit, qty: Number(l.qty) })),
        byUserId: user.id
      })
      setDone(true)
      setLines([])
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="screen">
        <div className="cuadre-banner cuadre-banner--green">
          <span className="cuadre-emoji">📦</span>
          <div>
            <strong>Salida registrada</strong>
            <p className="muted">La mercancía pasó del almacén a <strong>{toArea}</strong>.</p>
          </div>
        </div>
        <button className="btn btn--primary btn--block" onClick={() => setDone(false)}>
          Registrar otra salida
        </button>
        <Link className="btn btn--ghost btn--block" to="/catalog">Ver catálogo</Link>
      </div>
    )
  }

  return (
    <div className="screen">
      <h2>Salida a área</h2>
      <p className="muted">Saca mercancía del almacén central y asígnala a un área para que su vendedor pueda venderla.</p>

      <section className="card">
        <label className="field">
          <span>Área de destino</span>
          <select value={toArea} onChange={(e) => setToArea(e.target.value)}>
            <option value="">— Elige el área —</option>
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </section>

      <input
        className="search-input"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar producto (3 letras o codigo)…"
      />
      {results.length > 0 && (
        <div className="product-list sell-results">
          {results.map((p) => {
            const wh = warehouseOf(p)
            return (
              <button key={p.id} className="product-row" onClick={() => addLine(p)} disabled={wh <= 0}>
                <div className="product-row__main">
                  <strong>{p.name}</strong>
                  <span className="muted">
                    {p.code ? `${p.code} · ` : ''}
                    {wh <= 0 ? 'sin existencia en almacén' : `almacén: ${wh} ${p.unit}`}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      <section className="card">
        <h3>Productos a enviar</h3>
        {lines.length === 0 ? (
          <p className="muted">Busca un producto del almacén para agregarlo.</p>
        ) : (
          <div className="entry-lines">
            {lines.map((l) => {
              const over = Number(l.qty) > l.warehouse
              return (
                <div key={l.productId} className="entry-line">
                  <div className="entry-line__head">
                    <strong>{l.name}</strong>
                    <button className="link-del" onClick={() => removeLine(l.productId)}>quitar</button>
                  </div>
                  <label className="field">
                    <span>Cantidad ({l.unit}) · en almacén: {l.warehouse}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={l.qty}
                      onChange={(e) => update(l.productId, e.target.value)}
                    />
                  </label>
                  {over && <p className="error">No puedes sacar más de lo que hay en el almacén ({l.warehouse}).</p>}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {lines.length > 0 && (
        <section className="card">
          {error && <p className="error">{error}</p>}
          <button className="btn btn--primary btn--block" disabled={!valid || busy} onClick={register}>
            {busy ? 'Registrando…' : `Enviar ${lines.length} producto(s) a ${toArea || '…'}`}
          </button>
        </section>
      )}
    </div>
  )
}
