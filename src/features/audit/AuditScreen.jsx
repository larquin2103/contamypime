import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { shiftsRepo } from '../../repositories/shiftsRepo'
import { salesRepo } from '../../repositories/salesRepo'
import { cashRepo } from '../../repositories/cashRepo'
import { stockRepo } from '../../repositories/stockRepo'
import { productsRepo } from '../../repositories/productsRepo'
import { usersRepo } from '../../repositories/usersRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { formatMoney } from '../../lib/currency'
import { formatDateTime } from '../../lib/dates'
import { SEMAPHORE_EMOJI } from '../../lib/semaphore'
import { SHIFT_STATUS, locationLabel, areaLabel } from '../../db/constants'

const MOVE_LABEL = {
  purchase_in: 'Entrada (almacén)',
  sale_out: 'Venta',
  internal_debt_out: 'Deuda interna',
  adjustment: 'Ajuste',
  transfer_out: 'Salida a área',
  transfer_in: 'Entrada a área'
}

const MAX = 200

function inRange(iso, from, to) {
  const d = (iso || '').slice(0, 10)
  if (from && d < from) return false
  if (to && d > to) return false
  return true
}

export function AuditScreen() {
  const { isManager } = useAuth()
  const { baseCurrency } = useCurrency()
  const [tab, setTab] = useState('shifts')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const users = useLiveQuery(() => usersRepo.list(), [], [])
  const products = useLiveQuery(() => productsRepo.list(), [], [])
  const shifts = useLiveQuery(() => shiftsRepo.list(), [], [])
  const sales = useLiveQuery(() => salesRepo.listAll(), [], [])
  const cashMoves = useLiveQuery(() => cashRepo.listAll(), [], [])
  const movements = useLiveQuery(() => stockRepo.listAll(), [], [])
  const prices = useLiveQuery(() => productsRepo.allPriceChanges(), [], [])

  const userName = useMemo(() => {
    const m = {}
    for (const u of users) m[u.id] = u.name
    return m
  }, [users])
  const prodName = useMemo(() => {
    const m = {}
    for (const p of products) m[p.id] = p.name
    return m
  }, [products])

  if (!isManager) {
    return (
      <div className="screen">
        <h2>Auditoria</h2>
        <p className="muted">Solo el dueño o un administrativo puede ver la auditoria.</p>
        <Link className="btn btn--primary btn--block" to="/">Volver</Link>
      </div>
    )
  }

  const m = (n) => formatMoney(n, baseCurrency)

  const closedShifts = shifts.filter((s) => s.status === SHIFT_STATUS.CLOSED && inRange(s.closedAt, from, to))
  const salesF = sales.filter((s) => inRange(s.createdAt, from, to)).slice(0, MAX)
  const movesF = movements.filter((x) => inRange(x.createdAt, from, to)).slice(0, MAX)
  const pricesF = prices.filter((p) => inRange(p.createdAt, from, to)).slice(0, MAX)

  return (
    <div className="screen">
      <h2>Auditoria</h2>
      <p className="muted">Historial inmutable: nada se borra. Cada registro guarda quien y cuando.</p>

      <div className="form-row">
        <label className="field"><span>Desde</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field"><span>Hasta</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>

      <div className="tabs tabs--scroll">
        <button className={`tab ${tab === 'shifts' ? 'is-active' : ''}`} onClick={() => setTab('shifts')}>Turnos</button>
        <button className={`tab ${tab === 'sales' ? 'is-active' : ''}`} onClick={() => setTab('sales')}>Ventas</button>
        <button className={`tab ${tab === 'inv' ? 'is-active' : ''}`} onClick={() => setTab('inv')}>Inventario</button>
        <button className={`tab ${tab === 'prices' ? 'is-active' : ''}`} onClick={() => setTab('prices')}>Precios</button>
      </div>

      {tab === 'shifts' && (
        <ShiftsAudit
          shifts={closedShifts}
          sales={sales}
          cashMoves={cashMoves}
          userName={userName}
          baseCurrency={baseCurrency}
        />
      )}

      {tab === 'sales' && (
        <div className="list">
          {salesF.map((s) => (
            <div key={s.id} className="audit-row">
              <div className="audit-row__head">
                <strong>{m(s.totalBase)} · {s.paymentMethod === 'mixed' ? 'Mixto' : s.paymentMethod === 'transfer' ? 'Transferencia' : 'Efectivo'}</strong>
                <span className="muted">{formatDateTime(s.createdAt)}</span>
              </div>
              <span className="muted">
                {userName[s.sellerId] || 'vendedor'} · {(s.items || []).length} producto(s)
                {s.paymentMethod === 'transfer' && s.transferReference ? ` · ref ${s.transferReference}` : ''}
              </span>
            </div>
          ))}
          {salesF.length === 0 && <p className="muted">Sin ventas en el rango.</p>}
        </div>
      )}

      {tab === 'inv' && (
        <div className="list">
          {movesF.map((x) => (
            <div key={x.id} className="audit-row">
              <div className="audit-row__head">
                <strong>{MOVE_LABEL[x.type] || x.type} · {prodName[x.productId] || 'producto'}</strong>
                <span className={x.qty >= 0 ? 'ok-text' : 'warn-text'}>{x.qty > 0 ? '+' : ''}{x.qty}</span>
              </div>
              <span className="muted">
                {formatDateTime(x.createdAt)} · {locationLabel(x.location)} · {userName[x.userId] || '—'}{x.note ? ` · ${x.note}` : ''}
              </span>
            </div>
          ))}
          {movesF.length === 0 && <p className="muted">Sin movimientos en el rango.</p>}
        </div>
      )}

      {tab === 'prices' && (
        <div className="list">
          {pricesF.map((p) => (
            <div key={p.id} className="audit-row">
              <div className="audit-row__head">
                <strong>{prodName[p.productId] || 'producto'}</strong>
                <span className="muted">{formatDateTime(p.createdAt)}</span>
              </div>
              <span className="muted">
                {p.kind === 'tiers' ? 'Escalas mayoristas' : `${m(p.oldPrice)} → ${m(p.newPrice)}`}
                {' '}· {userName[p.userId] || '—'}{p.note ? ` · ${p.note}` : ''}
              </span>
            </div>
          ))}
          {pricesF.length === 0 && <p className="muted">Sin cambios de precio en el rango.</p>}
        </div>
      )}
    </div>
  )
}

// Bloque F - Turnos agrupados e interactivos: el dueño agrupa los turnos
// cerrados por VENDEDOR o por FECHA, filtra por vendedor y expande cada turno
// para ver su detalle (cuadre, ventas y extracciones) sin salir de Auditoria.
function ShiftsAudit({ shifts, sales, cashMoves, userName, baseCurrency }) {
  const [groupBy, setGroupBy] = useState('seller') // 'seller' | 'date'
  const [seller, setSeller] = useState('')
  const [open, setOpen] = useState(null) // id del turno expandido

  const m = (n) => formatMoney(n, baseCurrency)

  // Ventas y extracciones por turno (para el resumen y el detalle).
  const salesByShift = useMemo(() => {
    const map = {}
    for (const s of sales) {
      if (s.voided) continue
      const e = map[s.shiftId] || (map[s.shiftId] = { count: 0, total: 0 })
      e.count++
      e.total += Number(s.totalBase || 0)
    }
    return map
  }, [sales])
  const withdrawalsByShift = useMemo(() => {
    const map = {}
    for (const c of cashMoves) {
      if (c.type !== 'withdrawal') continue
      const e = map[c.shiftId] || (map[c.shiftId] = {})
      e[c.currency] = (e[c.currency] || 0) + Number(c.amount || 0)
    }
    return map
  }, [cashMoves])

  const sellers = useMemo(() => {
    const ids = [...new Set(shifts.map((s) => s.sellerId))]
    return ids
      .map((id) => ({ id, name: userName[id] || 'vendedor' }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [shifts, userName])

  const filtered = seller ? shifts.filter((s) => s.sellerId === seller) : shifts

  // Agrupacion: por vendedor (nombre) o por dia de cierre (mas reciente primero).
  const groups = useMemo(() => {
    const map = new Map()
    for (const s of filtered) {
      const key = groupBy === 'seller'
        ? (userName[s.sellerId] || 'vendedor')
        : (s.closedAt || '').slice(0, 10)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(s)
    }
    const list = [...map.entries()].map(([label, items]) => ({
      label,
      items: items.sort((a, b) => (a.closedAt < b.closedAt ? 1 : -1))
    }))
    return groupBy === 'seller'
      ? list.sort((a, b) => a.label.localeCompare(b.label))
      : list.sort((a, b) => (a.label < b.label ? 1 : -1))
  }, [filtered, groupBy, userName])

  const currenciesOf = (s) => [
    ...new Set([
      ...Object.keys(s.expectedCash || {}),
      ...Object.keys(s.declaredCash || {})
    ])
  ]

  return (
    <>
      <div className="form-row">
        <label className="field">
          <span>Agrupar por</span>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            <option value="seller">Vendedor</option>
            <option value="date">Fecha</option>
          </select>
        </label>
        <label className="field">
          <span>Vendedor</span>
          <select value={seller} onChange={(e) => setSeller(e.target.value)}>
            <option value="">Todos</option>
            {sellers.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </label>
      </div>

      {groups.map((g) => {
        const totalG = g.items.reduce((a, s) => a + (salesByShift[s.id]?.total || 0), 0)
        return (
          <section key={g.label} className="audit-group">
            <div className="audit-row__head">
              <strong>{groupBy === 'date' ? `📅 ${g.label}` : `👤 ${g.label}`}</strong>
              <span className="muted">{g.items.length} turno(s) · vendido {m(totalG)}</span>
            </div>
            <div className="list">
              {g.items.map((s) => {
                const sl = salesByShift[s.id] || { count: 0, total: 0 }
                const isOpen = open === s.id
                return (
                  <div key={s.id} className="audit-row">
                    <button
                      className="audit-row__toggle"
                      onClick={() => setOpen(isOpen ? null : s.id)}
                    >
                      <div className="audit-row__head">
                        <strong>
                          {SEMAPHORE_EMOJI[s.semaphore] || ''}{' '}
                          {groupBy === 'date' ? (userName[s.sellerId] || 'vendedor') : formatDateTime(s.closedAt)}
                          {s.area ? ` · ${areaLabel(s.area)}` : ''}
                        </strong>
                        <span className="muted">{isOpen ? '▾' : '▸'}</span>
                      </div>
                      <span className="muted">
                        {sl.count} venta(s) · {m(sl.total)} · Dif {m(s.difference?.[baseCurrency] ?? 0)}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="audit-detail">
                        <div className="kv"><span className="muted">Abierto</span><strong>{formatDateTime(s.openedAt)}</strong></div>
                        <div className="kv"><span className="muted">Cerrado</span><strong>{formatDateTime(s.closedAt)}</strong></div>
                        {currenciesOf(s).map((cur) => (
                          <div key={cur} className="kv">
                            <span className="muted">Caja {cur}</span>
                            <strong>
                              esperado {formatMoney(s.expectedCash?.[cur] ?? 0, cur)} ·
                              declarado {formatMoney(s.declaredCash?.[cur] ?? 0, cur)} ·
                              dif {formatMoney(s.difference?.[cur] ?? 0, cur)}
                            </strong>
                          </div>
                        ))}
                        {withdrawalsByShift[s.id] && (
                          <div className="kv">
                            <span className="muted">Extracciones</span>
                            <strong>
                              {Object.entries(withdrawalsByShift[s.id])
                                .map(([cur, amt]) => formatMoney(amt, cur))
                                .join(' · ')}
                            </strong>
                          </div>
                        )}
                        <div className="audit-flags">
                          {s.forced && <span className="flag flag--warn">cerrado por dueño</span>}
                          {s.countSkipped && <span className="flag flag--warn">sin conteo de billetes</span>}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
      {groups.length === 0 && <p className="muted">Sin turnos cerrados en el rango.</p>}
    </>
  )
}
