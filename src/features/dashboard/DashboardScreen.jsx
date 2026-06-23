import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { analyticsRepo } from '../../repositories/analyticsRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { formatMoney } from '../../lib/currency'

function rangeFor(period) {
  const today = new Date().toISOString().slice(0, 10)
  if (period === 'today') return { from: today, to: today }
  if (period === '7') {
    const d = new Date()
    d.setDate(d.getDate() - 6)
    return { from: d.toISOString().slice(0, 10), to: today }
  }
  if (period === '30') {
    const d = new Date()
    d.setDate(d.getDate() - 29)
    return { from: d.toISOString().slice(0, 10), to: today }
  }
  return { from: null, to: null } // todo
}

const PERIODS = [
  ['today', 'Hoy'],
  ['7', '7 dias'],
  ['30', '30 dias'],
  ['all', 'Todo']
]

export function DashboardScreen() {
  const { isOwner } = useAuth()
  const { baseCurrency } = useCurrency()
  const [period, setPeriod] = useState('7')
  const [rotDays, setRotDays] = useState(14)
  const [tab, setTab] = useState('top')

  const range = useMemo(() => rangeFor(period), [period])
  const report = useLiveQuery(() => analyticsRepo.report(range), [range.from, range.to])
  const lowRot = useLiveQuery(() => analyticsRepo.lowRotation({ days: rotDays }), [rotDays], [])
  const restock = useLiveQuery(() => analyticsRepo.restock(), [], [])

  if (!isOwner) {
    return (
      <div className="screen">
        <h2>Panel del dueno</h2>
        <p className="muted">Solo el dueno puede ver el panel.</p>
        <Link className="btn btn--primary btn--block" to="/">Volver</Link>
      </div>
    )
  }

  const m = (n) => formatMoney(n, baseCurrency)

  return (
    <div className="screen">
      <h2>Panel del dueno</h2>

      <div className="period-row">
        {PERIODS.map(([k, label]) => (
          <button
            key={k}
            className={`btn btn--sm ${period === k ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => setPeriod(k)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="kpi-grid">
        <div className="kpi"><span className="muted">Ingresos</span><strong>{m(report?.revenue ?? 0)}</strong></div>
        <div className="kpi"><span className="muted">Ganancia</span><strong className="ok-text">{m(report?.profit ?? 0)}</strong></div>
        <div className="kpi"><span className="muted">Costo</span><strong>{m(report?.cost ?? 0)}</strong></div>
        <div className="kpi"><span className="muted">Margen</span><strong>{report?.marginPct ?? 0}%</strong></div>
      </div>
      <p className="muted">{report?.salesCount ?? 0} venta(s) en el periodo.</p>

      <div className="tabs">
        <button className={`tab ${tab === 'top' ? 'is-active' : ''}`} onClick={() => setTab('top')}>Mas vendidos</button>
        <button className={`tab ${tab === 'cat' ? 'is-active' : ''}`} onClick={() => setTab('cat')}>Categorias</button>
        <button className={`tab ${tab === 'alerts' ? 'is-active' : ''}`} onClick={() => setTab('alerts')}>Alertas</button>
      </div>

      {tab === 'top' && (
        <div className="list">
          {(report?.byProduct || []).slice(0, 10).map((p, i) => (
            <div key={p.productId} className="rank-row">
              <span className="rank-row__pos">{i + 1}</span>
              <div className="rank-row__main">
                <strong>{p.name}</strong>
                <span className="muted">{p.qty} vendidos · ganancia {m(p.profit)}</span>
              </div>
              <span className="price">{m(p.revenue)}</span>
            </div>
          ))}
          {(report?.byProduct || []).length === 0 && <p className="muted">Sin ventas en el periodo.</p>}
        </div>
      )}

      {tab === 'cat' && (
        <CategoryBreakdown rows={report?.byCategory || []} money={m} />
      )}

      {tab === 'alerts' && (
        <>
          <h3 className="section-title">Reabastecimiento</h3>
          <div className="list">
            {restock.map((p) => (
              <div key={p.productId} className="list-item">
                <div>
                  <strong>{p.name}</strong>
                  <br />
                  <span className={p.stock <= 0 ? 'error' : 'warn-text'}>
                    stock {p.stock} {p.unit}{p.minStock > 0 ? ` · min ${p.minStock}` : ''}
                  </span>
                </div>
              </div>
            ))}
            {restock.length === 0 && <p className="muted">Nada por reabastecer.</p>}
          </div>

          <div className="screen__header">
            <h3 className="section-title">Menor rotacion</h3>
            <select value={rotDays} onChange={(e) => setRotDays(Number(e.target.value))} className="rot-select">
              <option value={7}>7+ dias</option>
              <option value={14}>14+ dias</option>
              <option value={30}>30+ dias</option>
            </select>
          </div>
          <div className="list">
            {lowRot.map((p) => (
              <div key={p.productId} className="list-item">
                <div>
                  <strong>{p.name}</strong>
                  <br />
                  <span className="muted">
                    {p.daysSince === null ? 'Nunca vendido' : `${p.daysSince} dias sin venta`} · stock {p.stock} {p.unit}
                  </span>
                </div>
              </div>
            ))}
            {lowRot.length === 0 && <p className="muted">Todo con buena rotacion.</p>}
          </div>
        </>
      )}
    </div>
  )
}

function CategoryBreakdown({ rows, money }) {
  const cats = useLiveQuery(async () => {
    const { categoriesRepo } = await import('../../repositories/categoriesRepo')
    return categoriesRepo.list()
  }, [], [])
  const name = useMemo(() => {
    const map = { __none: 'Sin categoria' }
    for (const c of cats) map[c.id] = c.name
    return map
  }, [cats])

  return (
    <div className="list">
      {rows.map((r) => (
        <div key={r.categoryId} className="rank-row">
          <div className="rank-row__main">
            <strong>{name[r.categoryId] || 'Sin categoria'}</strong>
            <span className="muted">{r.qty} vendidos · ganancia {money(r.profit)}</span>
          </div>
          <span className="price">{money(r.revenue)}</span>
        </div>
      ))}
      {rows.length === 0 && <p className="muted">Sin ventas en el periodo.</p>}
    </div>
  )
}
