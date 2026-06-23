import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { shiftsRepo } from '../../repositories/shiftsRepo'
import { salesRepo } from '../../repositories/salesRepo'
import { stockRepo } from '../../repositories/stockRepo'
import { productsRepo } from '../../repositories/productsRepo'
import { usersRepo } from '../../repositories/usersRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { formatMoney } from '../../lib/currency'
import { formatDateTime } from '../../lib/dates'
import { SEMAPHORE_EMOJI } from '../../lib/semaphore'
import { SHIFT_STATUS } from '../../db/constants'

const MOVE_LABEL = {
  purchase_in: 'Entrada',
  sale_out: 'Venta',
  internal_debt_out: 'Deuda interna',
  adjustment: 'Ajuste'
}

const MAX = 200

function inRange(iso, from, to) {
  const d = (iso || '').slice(0, 10)
  if (from && d < from) return false
  if (to && d > to) return false
  return true
}

export function AuditScreen() {
  const { isOwner } = useAuth()
  const { baseCurrency } = useCurrency()
  const [tab, setTab] = useState('shifts')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const users = useLiveQuery(() => usersRepo.list(), [], [])
  const products = useLiveQuery(() => productsRepo.list(), [], [])
  const shifts = useLiveQuery(() => shiftsRepo.list(), [], [])
  const sales = useLiveQuery(() => salesRepo.listAll(), [], [])
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

  if (!isOwner) {
    return (
      <div className="screen">
        <h2>Auditoria</h2>
        <p className="muted">Solo el dueño puede ver la auditoria.</p>
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
        <div className="list">
          {closedShifts.map((s) => (
            <div key={s.id} className="audit-row">
              <div className="audit-row__head">
                <strong>{SEMAPHORE_EMOJI[s.semaphore] || ''} Turno · {userName[s.sellerId] || 'vendedor'}</strong>
                <span className="muted">{formatDateTime(s.closedAt)}</span>
              </div>
              <span className="muted">
                Esperado {m(s.expectedCash?.[baseCurrency] ?? 0)} · Declarado {m(s.declaredCash?.[baseCurrency] ?? 0)} · Dif {m(s.difference?.[baseCurrency] ?? 0)}
              </span>
              <div className="audit-flags">
                {s.forced && <span className="flag flag--warn">cerrado por dueño</span>}
                {s.countSkipped && <span className="flag flag--warn">sin conteo</span>}
              </div>
            </div>
          ))}
          {closedShifts.length === 0 && <p className="muted">Sin turnos cerrados en el rango.</p>}
        </div>
      )}

      {tab === 'sales' && (
        <div className="list">
          {salesF.map((s) => (
            <div key={s.id} className="audit-row">
              <div className="audit-row__head">
                <strong>{m(s.totalBase)} · {s.paymentMethod === 'transfer' ? 'Transferencia' : 'Efectivo'}</strong>
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
                {formatDateTime(x.createdAt)} · {userName[x.userId] || '—'}{x.note ? ` · ${x.note}` : ''}
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
                {m(p.oldPrice)} → {m(p.newPrice)} · {userName[p.userId] || '—'}{p.note ? ` · ${p.note}` : ''}
              </span>
            </div>
          ))}
          {pricesF.length === 0 && <p className="muted">Sin cambios de precio en el rango.</p>}
        </div>
      )}
    </div>
  )
}
