import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { analyticsRepo } from '../../repositories/analyticsRepo'
import { categoriesRepo } from '../../repositories/categoriesRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { formatMoney } from '../../lib/currency'
import { formatDateTime, localDay } from '../../lib/dates'
import { areaLabel } from '../../db/constants'
import { DonutChart, TrendChart } from './Charts'

// Rangos calculados en dia LOCAL (no UTC) para que "Hoy/7/30" cuadren con el
// dia calendario del negocio (ver lib/dates.localDay).
function rangeFor(period) {
  const today = localDay()
  if (period === 'today') return { from: today, to: today }
  if (period === '7') {
    const d = new Date()
    d.setDate(d.getDate() - 6)
    return { from: localDay(d), to: today }
  }
  if (period === '30') {
    const d = new Date()
    d.setDate(d.getDate() - 29)
    return { from: localDay(d), to: today }
  }
  return { from: null, to: null } // todo
}

// Periodo inmediatamente anterior, del mismo largo, para comparar (vs anterior).
function prevRangeFor(period) {
  if (period === 'today') {
    const d = new Date(); d.setDate(d.getDate() - 1)
    return { from: localDay(d), to: localDay(d) }
  }
  if (period === '7' || period === '30') {
    const len = period === '7' ? 7 : 30
    const to = new Date(); to.setDate(to.getDate() - len)
    const from = new Date(); from.setDate(from.getDate() - (len * 2 - 1))
    return { from: localDay(from), to: localDay(to) }
  }
  return { from: null, to: null } // 'all' no compara
}

const PERIODS = [
  ['today', 'Hoy'],
  ['7', '7 días'],
  ['30', '30 días'],
  ['all', 'Todo']
]

// Variacion porcentual vs periodo anterior.
function delta(cur, prev) {
  if (prev > 0) return Math.round(((cur - prev) / prev) * 1000) / 10
  if (cur > 0) return 100
  return 0
}

function DeltaBadge({ value }) {
  if (value === 0) return <span className="kpi__delta kpi__delta--flat">— vs anterior</span>
  const up = value > 0
  return (
    <span className={`kpi__delta ${up ? 'kpi__delta--up' : 'kpi__delta--down'}`}>
      {up ? '▲' : '▼'} {Math.abs(value)}% vs anterior
    </span>
  )
}

export function DashboardScreen() {
  const { isManager } = useAuth()
  const { baseCurrency } = useCurrency()
  const [period, setPeriod] = useState('7')
  const [rotDays, setRotDays] = useState(14)
  const [tab, setTab] = useState('top')

  const range = useMemo(() => rangeFor(period), [period])
  const prevRange = useMemo(() => prevRangeFor(period), [period])
  const report = useLiveQuery(() => analyticsRepo.report(range), [range.from, range.to])
  const prev = useLiveQuery(() => analyticsRepo.report(prevRange), [prevRange.from, prevRange.to])
  const lowRot = useLiveQuery(() => analyticsRepo.lowRotation({ days: rotDays }), [rotDays], [])
  const restock = useLiveQuery(() => analyticsRepo.restock(), [], [])
  const transferDiffs = useLiveQuery(() => analyticsRepo.transferMismatches(range), [range.from, range.to], [])

  if (!isManager) {
    return (
      <div className="screen">
        <h2>Panel del dueño</h2>
        <p className="muted">Solo el dueño o un administrativo puede ver el panel.</p>
        <Link className="btn btn--primary btn--block" to="/">Volver</Link>
      </div>
    )
  }

  const m = (n) => formatMoney(n, baseCurrency)

  return (
    <div className="screen">
      <h2>Panel del dueño</h2>

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

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-card__label">Ventas netas</span>
          <strong className="stat-card__value">{m(report?.revenue ?? 0)}</strong>
          <DeltaBadge value={delta(report?.revenue ?? 0, prev?.revenue ?? 0)} />
        </div>
        <div className="stat-card">
          <span className="stat-card__label">Transacciones</span>
          <strong className="stat-card__value">{report?.salesCount ?? 0}</strong>
          <DeltaBadge value={delta(report?.salesCount ?? 0, prev?.salesCount ?? 0)} />
        </div>
      </div>

      <section className="card">
        <h3 className="section-title">Metodos de pago</h3>
        <div className="pay-breakdown">
          <DonutChart
            segments={[
              { label: 'Efectivo', value: report?.byMethod?.cash ?? 0, color: '#1fa36b' },
              { label: 'Transferencia', value: report?.byMethod?.transfer ?? 0, color: '#3b82f6' }
            ]}
            centerLabel="Ingresos"
            centerValue={m(report?.revenue ?? 0)}
          />
          <div className="legend">
            <LegendRow color="#1fa36b" label="Efectivo" value={report?.byMethod?.cash ?? 0}
                       total={report?.revenue ?? 0} money={m} />
            <LegendRow color="#3b82f6" label="Transferencia" value={report?.byMethod?.transfer ?? 0}
                       total={report?.revenue ?? 0} money={m} />
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <h3 className="section-title">Tendencia de ingresos</h3>
          <div className="card__head-right">
            <span className="muted">Ganancia</span>
            <strong className="ok-text">{m(report?.profit ?? 0)}</strong>
          </div>
        </div>
        <TrendChart points={report?.daily ?? []} />
        <p className="muted">{report?.salesCount ?? 0} venta(s) · margen {report?.marginPct ?? 0}%</p>
      </section>

      <div className="tabs">
        <button className={`tab ${tab === 'top' ? 'is-active' : ''}`} onClick={() => setTab('top')}>Mas vendidos</button>
        <button className={`tab ${tab === 'cat' ? 'is-active' : ''}`} onClick={() => setTab('cat')}>Categorías</button>
        {(report?.byArea || []).length > 0 && (
          <button className={`tab ${tab === 'area' ? 'is-active' : ''}`} onClick={() => setTab('area')}>Áreas</button>
        )}
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

      {tab === 'area' && (
        <>
          <div className="list">
            {(report?.byArea || []).map((r) => (
              <div key={r.area || '__none'} className="rank-row">
                <div className="rank-row__main">
                  <strong>{areaLabel(r.area)}</strong>
                  <span className="muted">{r.qty} vendidos · ganancia {m(r.profit)}</span>
                </div>
                <span className="price">{m(r.revenue)}</span>
              </div>
            ))}
            {(report?.byArea || []).length === 0 && <p className="muted">Sin ventas en el periodo.</p>}
          </div>

          <h3 className="section-title">Ventas cruzadas (sustitución)</h3>
          <p className="muted">
            Productos vendidos por un vendedor de otra área. Se cobraron en su caja.
          </p>
          <div className="list">
            {(report?.crossArea?.bySeller || []).map((c) => (
              <div key={c.sellerId} className="rank-row">
                <div className="rank-row__main">
                  <strong>{c.seller}</strong>
                  <span className="muted">{c.qty} producto(s) de otras áreas</span>
                </div>
                <span className="price">{m(c.revenue)}</span>
              </div>
            ))}
            {(report?.crossArea?.count ?? 0) === 0 && <p className="muted">Sin ventas cruzadas en el periodo.</p>}
          </div>
        </>
      )}

      {tab === 'alerts' && (
        <>
          <h3 className="section-title">Transferencias con diferencia</h3>
          <div className="list">
            {transferDiffs.map((t) => (
              <div key={t.id} className="list-item">
                <div>
                  <strong>{t.seller} · {formatDateTime(t.createdAt)}</strong>
                  <br />
                  <span className="muted">
                    Op. {t.reference || '—'} · esperado {m(t.expected)} · recibido {m(t.received)}
                  </span>
                  <br />
                  <span className={t.diff < 0 ? 'error' : 'warn-text'}>
                    Diferencia {m(t.diff)} {t.diff < 0 ? '(faltó)' : '(de más)'}
                  </span>
                </div>
              </div>
            ))}
            {transferDiffs.length === 0 && <p className="muted">Sin diferencias en transferencias.</p>}
          </div>

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
            <h3 className="section-title">Menor rotación</h3>
            <select value={rotDays} onChange={(e) => setRotDays(Number(e.target.value))} className="rot-select">
              <option value={7}>7+ días</option>
              <option value={14}>14+ días</option>
              <option value={30}>30+ días</option>
            </select>
          </div>
          <div className="list">
            {lowRot.map((p) => (
              <div key={p.productId} className="list-item">
                <div>
                  <strong>{p.name}</strong>
                  <br />
                  <span className="muted">
                    {p.daysSince === null ? 'Nunca vendido' : `${p.daysSince} días sin venta`} · stock {p.stock} {p.unit}
                  </span>
                </div>
              </div>
            ))}
            {lowRot.length === 0 && <p className="muted">Todo con buena rotación.</p>}
          </div>
        </>
      )}
    </div>
  )
}

function LegendRow({ color, label, value, total, money }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="legend-row">
      <span className="legend-row__dot" style={{ background: color }} />
      <span className="legend-row__label">{label}</span>
      <span className="legend-row__val">{money(value)}<small className="muted"> · {pct}%</small></span>
    </div>
  )
}

function CategoryBreakdown({ rows, money }) {
  const cats = useLiveQuery(() => categoriesRepo.list(), [], [])
  const name = useMemo(() => {
    const map = { __none: 'Sin categoría' }
    for (const c of cats) map[c.id] = c.name
    return map
  }, [cats])

  return (
    <div className="list">
      {rows.map((r) => (
        <div key={r.categoryId} className="rank-row">
          <div className="rank-row__main">
            <strong>{name[r.categoryId] || 'Sin categoría'}</strong>
            <span className="muted">{r.qty} vendidos · ganancia {money(r.profit)}</span>
          </div>
          <span className="price">{money(r.revenue)}</span>
        </div>
      ))}
      {rows.length === 0 && <p className="muted">Sin ventas en el periodo.</p>}
    </div>
  )
}
