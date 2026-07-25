import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { productsRepo } from '../../repositories/productsRepo'
import { configRepo } from '../../repositories/configRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { matchesQuery } from '../../lib/search'
import { WAREHOUSE, ELABORATION, locationLabel } from '../../db/constants'
import { buildProductLedger, buildProductsLedgerSummary, exportExcel, exportPdf } from './reportsService'

// Submayor por producto (kardex). Solo el dueño. Dos alcances:
//  - Un producto: apertura/entradas/salidas/ajustes/existencia por día o detallado.
//  - Todos / varios (resumen): una fila por producto con sus totales del período.
// Es SOLO LECTURA (deriva de stockMovements).
export function ProductLedgerScreen() {
  const { isOwner } = useAuth()
  const products = useLiveQuery(() => productsRepo.list(), [], [])
  const areas = useLiveQuery(() => configRepo.getAreas(), [], [])
  const elab = useLiveQuery(() => configRepo.getElaboration(), [], { enabled: false, name: 'Elaboración' })

  const [scope, setScope] = useState('one') // one | all
  // Un producto
  const [query, setQuery] = useState('')
  const [product, setProduct] = useState(null)
  const [mode, setMode] = useState('daily') // daily | detailed
  // Varios / todos
  const [queryAll, setQueryAll] = useState('')
  const [selected, setSelected] = useState({}) // { productId: true }
  // Filtros comunes
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [location, setLocation] = useState('')
  const [valued, setValued] = useState(false)
  const [busy, setBusy] = useState('')

  const results = useMemo(() => {
    if (!query.trim()) return []
    return products.filter((p) => p.active && matchesQuery(p, query)).slice(0, 15)
  }, [products, query])

  const eligibleAll = useMemo(() => {
    const act = products.filter((p) => p.active)
    const f = queryAll.trim() ? act.filter((p) => matchesQuery(p, queryAll)) : act
    return f.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 60)
  }, [products, queryAll])

  const selIds = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected])

  const report = useLiveQuery(
    () => (scope === 'one'
      ? buildProductLedger({ productId: product?.id || '', location, from, to, mode, valued })
      : buildProductsLedgerSummary({ productIds: selIds, location, from, to, valued })),
    [scope, product?.id, selIds.join(','), location, from, to, mode, valued],
    undefined
  )

  if (!isOwner) {
    return (
      <div className="screen">
        <h2>Submayor por producto</h2>
        <section className="card">
          <p>Solo el <strong>dueño</strong> puede ver el submayor por producto.</p>
          <Link className="btn btn--primary btn--block" to="/">Volver al inicio</Link>
        </section>
      </div>
    )
  }

  const canShow = scope === 'one' ? !!product : true
  const run = async (fmt) => {
    if (!report || !canShow) return
    setBusy(fmt)
    try {
      // Pantalla y PDF: básico (legible). Excel: detallado por concepto (full).
      let rep = report
      if (fmt === 'excel') {
        rep = scope === 'one'
          ? await buildProductLedger({ productId: product?.id || '', location, from, to, mode, valued, detail: 'full' })
          : await buildProductsLedgerSummary({ productIds: selIds, location, from, to, valued, detail: 'full' })
      }
      if (fmt === 'pdf') await exportPdf(rep)
      else await exportExcel(rep)
    } catch (e) {
      alert('No se pudo exportar: ' + e.message)
    } finally { setBusy('') }
  }
  const toggleSel = (id) => setSelected((prev) => ({ ...prev, [id]: !prev[id] }))

  return (
    <div className="screen">
      <h2>Submayor por producto</h2>
      <p className="muted">Apertura, entradas, salidas, ajustes y existencia. Solo lectura.</p>

      {/* Alcance */}
      <div className="tabs">
        <button className={`tab ${scope === 'one' ? 'is-active' : ''}`} onClick={() => setScope('one')}>Un producto</button>
        <button className={`tab ${scope === 'all' ? 'is-active' : ''}`} onClick={() => setScope('all')}>Todos / varios</button>
      </div>

      {/* 1. Producto(s) */}
      {scope === 'one' ? (
        <section className="card">
          <h3>1. Producto</h3>
          {!product ? (
            <>
              <input className="search-input" type="search" value={query}
                onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre o código…" />
              <div className="list">
                {results.map((p) => (
                  <button key={p.id} className="list-item" onClick={() => { setProduct(p); setQuery('') }}>
                    <div><strong>{p.name}</strong><span className="muted"> {p.code ? `· ${p.code} ` : ''}· total {p.stock} {p.unit}</span></div>
                    <span className="muted">›</span>
                  </button>
                ))}
                {query.trim() && results.length === 0 && <p className="muted">Sin resultados.</p>}
              </div>
            </>
          ) : (
            <div className="kv">
              <span><strong>{product.name}</strong>{product.code ? <span className="muted"> · {product.code}</span> : null}</span>
              <button className="link-del" onClick={() => setProduct(null)}>cambiar</button>
            </div>
          )}
        </section>
      ) : (
        <section className="card">
          <h3>1. Productos</h3>
          <p className="muted">
            {selIds.length === 0 ? 'Sin marcar = TODOS los productos.' : `${selIds.length} seleccionado(s).`}
            {selIds.length > 0 && <button className="link-del" onClick={() => setSelected({})} style={{ marginLeft: 8 }}>quitar todos</button>}
          </p>
          <input className="search-input" type="search" value={queryAll}
            onChange={(e) => setQueryAll(e.target.value)} placeholder="Buscar para marcar (opcional)…" />
          <div className="list">
            {eligibleAll.map((p) => (
              <label key={p.id} className={`check-row ${selected[p.id] ? 'is-checked' : ''}`}>
                <input type="checkbox" checked={!!selected[p.id]} onChange={() => toggleSel(p.id)} />
                <div className="check-row__main">
                  <strong>{p.name}</strong>
                  <span className="muted">{p.code ? `${p.code} · ` : ''}total {p.stock} {p.unit}</span>
                </div>
              </label>
            ))}
          </div>
        </section>
      )}

      {/* 2. Filtros */}
      <section className="card">
        <h3>2. Rango y filtros</h3>
        <div className="form-row">
          <label className="field"><span>Desde</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="field"><span>Hasta</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <p className="muted">Vacío = todo el historial.</p>
        <label className="field">
          <span>Ubicación</span>
          <select value={location} onChange={(e) => setLocation(e.target.value)}>
            <option value="">Todas las ubicaciones</option>
            <option value={WAREHOUSE}>{locationLabel(WAREHOUSE)}</option>
            {elab.enabled && <option value={ELABORATION}>{elab.name}</option>}
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        {scope === 'one' && (
          <div className="tabs">
            <button className={`tab ${mode === 'daily' ? 'is-active' : ''}`} onClick={() => setMode('daily')}>Por día</button>
            <button className={`tab ${mode === 'detailed' ? 'is-active' : ''}`} onClick={() => setMode('detailed')}>Detallado</button>
          </div>
        )}
        {(scope === 'all' || mode === 'daily') && (
          <label className="check-row">
            <input type="checkbox" checked={valued} onChange={(e) => setValued(e.target.checked)} />
            <div className="check-row__main"><strong>Mostrar valor (existencia × costo)</strong></div>
          </label>
        )}
      </section>

      {/* 3. Resultado */}
      {canShow && report && (
        <section className="card">
          <div className="screen__header">
            <h3>Submayor</h3>
            <div className="report-actions">
              <button className="btn btn--sm" disabled={!!busy} onClick={() => run('excel')}>{busy === 'excel' ? '...' : '⬇ Excel'}</button>
              <button className="btn btn--sm" disabled={!!busy} onClick={() => run('pdf')}>{busy === 'pdf' ? '...' : '⬇ PDF'}</button>
            </div>
          </div>
          <p className="muted">{report.subtitle}</p>
          <div style={{ overflowX: 'auto' }}>
            <table className="cash-table">
              <thead>
                <tr>{report.head.map((h, i) => <th key={i} className={i === 0 ? '' : 'num'}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {report.rows.map((r, i) => (
                  <tr key={i} className={r[0] === 'Apertura' || r[0] === 'TOTAL' || String(r[0]).startsWith('Existencia') ? 'is-strong' : ''}>
                    {r.map((c, j) => <td key={j} className={j === 0 ? '' : 'num'}>{c}</td>)}
                  </tr>
                ))}
                {report.rows.length === 0 && (
                  <tr><td colSpan={report.head.length} className="muted">Sin movimientos en el rango.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
