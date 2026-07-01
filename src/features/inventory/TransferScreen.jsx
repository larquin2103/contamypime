import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { productsRepo } from '../../repositories/productsRepo'
import { configRepo } from '../../repositories/configRepo'
import { transfersRepo } from '../../repositories/transfersRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { matchesQuery } from '../../lib/search'
import { round2 } from '../../lib/currency'
import { WAREHOUSE } from '../../db/constants'

// Bloque 20.2 - Salida del almacen central hacia las areas. La registra el dueño
// o un administrativo. Resta del almacen y suma al area; el vendedor de esa area
// solo puede vender lo que aqui se le asigna.
//
// Salida por LOTE (reaprovisionamiento): cada producto se elige UNA vez y se
// reparte a TODAS las areas en una sola pasada (una columna por area), en lugar
// de repetir "elige area -> busca productos" por cada area. La rebaja del
// almacen central NO cambia: la hace transfersRepo (validada y atomica).
export function TransferScreen() {
  const { user, isManager } = useAuth()
  const products = useLiveQuery(() => productsRepo.listActive(), [], [])
  const areas = useLiveQuery(() => configRepo.getAreas(), [], [])

  const [query, setQuery] = useState('')
  // lines: [{ productId, name, unit, warehouse, qtys: { [area]: '' } }]
  const [lines, setLines] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null) // resumen del lote enviado

  const warehouseOf = (p) => Number(p.stockByLocation?.[WAREHOUSE] || 0)

  const results = useMemo(() => {
    if (!query.trim()) return []
    return products.filter((p) => matchesQuery(p, query)).slice(0, 20)
  }, [products, query])

  if (!isManager) {
    return (
      <div className="screen">
        <h2>Salida a áreas</h2>
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
        <h2>Salida a áreas</h2>
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
      const qtys = {}
      for (const a of areas) qtys[a] = ''
      return [...prev, { productId: p.id, name: p.name, unit: p.unit, warehouse: warehouseOf(p), qtys }]
    })
    setQuery('')
  }

  const setQty = (productId, area, value) =>
    setLines((prev) =>
      prev.map((l) => (l.productId === productId ? { ...l, qtys: { ...l.qtys, [area]: value } } : l))
    )

  const removeLine = (productId) =>
    setLines((prev) => prev.filter((l) => l.productId !== productId))

  // Total repartido de una linea (suma de todas las areas).
  const sentOf = (l) =>
    round2(Object.values(l.qtys).reduce((a, v) => a + (Number(v) || 0), 0))

  // Validacion: cada linea no puede repartir mas de lo que hay en almacen, y el
  // lote debe tener al menos una cantidad > 0.
  const anyQty = lines.some((l) => sentOf(l) > 0)
  const allWithinStock = lines.every((l) => sentOf(l) <= l.warehouse)
  const valid = anyQty && allWithinStock

  const register = async () => {
    setError('')
    setBusy(true)
    try {
      // Arma las asignaciones por area a partir de la cuadricula.
      const byArea = {}
      for (const l of lines) {
        for (const a of areas) {
          const qty = Number(l.qtys[a]) || 0
          if (qty <= 0) continue
          if (!byArea[a]) byArea[a] = []
          byArea[a].push({ productId: l.productId, name: l.name, unit: l.unit, qty })
        }
      }
      const allocations = Object.entries(byArea).map(([toArea, items]) => ({ toArea, items }))
      await transfersRepo.createBatch({ allocations, byUserId: user.id })

      // Resumen para confirmar al usuario qué se envió a cada área.
      const summary = allocations.map(({ toArea, items }) => ({
        area: toArea,
        products: items.length,
        units: round2(items.reduce((a, it) => a + it.qty, 0))
      }))
      setDone(summary)
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
            <strong>Salida por lote registrada</strong>
            <p className="muted">La mercancía pasó del almacén a las áreas.</p>
          </div>
        </div>
        <section className="card">
          <h3>Resumen del envío</h3>
          {done.map((s) => (
            <div key={s.area} className="kv">
              <span><strong>{s.area}</strong></span>
              <span className="muted">{s.products} producto(s) · {s.units} u</span>
            </div>
          ))}
        </section>
        <button className="btn btn--primary btn--block" onClick={() => setDone(null)}>
          Registrar otra salida
        </button>
        <Link className="btn btn--ghost btn--block" to="/reports">Ver reporte de salidas</Link>
        <Link className="btn btn--ghost btn--block" to="/catalog">Ver catálogo</Link>
      </div>
    )
  }

  return (
    <div className="screen">
      <h2>Salida a áreas</h2>
      <p className="muted">
        Reaprovisiona varias áreas de una vez: agrega cada producto una sola vez y reparte la
        cantidad a cada área. Lo asignado se descuenta del almacén central.
      </p>

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
            const already = lines.some((l) => l.productId === p.id)
            return (
              <button key={p.id} className="product-row" onClick={() => addLine(p)} disabled={wh <= 0 || already}>
                <div className="product-row__main">
                  <strong>{p.name}</strong>
                  <span className="muted">
                    {p.code ? `${p.code} · ` : ''}
                    {already ? 'ya agregado' : wh <= 0 ? 'sin existencia en almacén' : `almacén: ${wh} ${p.unit}`}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      <section className="card">
        <h3>Reparto a áreas</h3>
        {lines.length === 0 ? (
          <p className="muted">Busca un producto del almacén para agregarlo y repartirlo a las áreas.</p>
        ) : (
          <div className="entry-lines">
            {lines.map((l) => {
              const sent = sentOf(l)
              const remaining = round2(l.warehouse - sent)
              const over = sent > l.warehouse
              return (
                <div key={l.productId} className="entry-line">
                  <div className="entry-line__head">
                    <div>
                      <strong>{l.name}</strong>
                      <span className="muted"> · almacén: {l.warehouse} {l.unit}</span>
                    </div>
                    <button className="link-del" onClick={() => removeLine(l.productId)}>quitar</button>
                  </div>
                  <div className="transfer-grid">
                    {areas.map((a) => (
                      <label key={a} className="transfer-grid__cell">
                        <span>{a}</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          value={l.qtys[a] ?? ''}
                          placeholder="0"
                          onChange={(e) => setQty(l.productId, a, e.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                  <p className={`muted transfer-grid__foot ${over ? 'error' : ''}`}>
                    {over
                      ? `Repartes ${sent} y solo hay ${l.warehouse} en almacén.`
                      : `Repartido: ${sent} ${l.unit} · queda en almacén: ${remaining} ${l.unit}`}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {lines.length > 0 && (
        <section className="card">
          {error && <p className="error">{error}</p>}
          {!anyQty && <p className="muted">Asigna una cantidad a al menos un área para enviar.</p>}
          <button className="btn btn--primary btn--block" disabled={!valid || busy} onClick={register}>
            {busy ? 'Registrando…' : 'Enviar salida por lote'}
          </button>
        </section>
      )}
    </div>
  )
}
