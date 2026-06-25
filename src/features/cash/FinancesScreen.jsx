import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { debtsRepo } from '../../repositories/debtsRepo'
import { cashRepo } from '../../repositories/cashRepo'
import { usersRepo } from '../../repositories/usersRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { formatMoney, round2 } from '../../lib/currency'
import { formatDateTime, localDay } from '../../lib/dates'
import { DEBT_SETTLE_METHODS, DEBT_SETTLE_LABELS } from '../../db/constants'

// Gestion de deudas internas y historial de extracciones (solo dueño).
export function FinancesScreen() {
  const { user, isOwner } = useAuth()
  const [tab, setTab] = useState('deudas')

  if (!isOwner) {
    return (
      <div className="screen">
        <h2>Deudas y caja</h2>
        <p className="muted">Solo el dueño puede ver esta seccion.</p>
        <Link className="btn btn--primary btn--block" to="/">Volver al inicio</Link>
      </div>
    )
  }

  return (
    <div className="screen">
      <h2>Deudas y caja</h2>
      <div className="tabs">
        <button className={`tab ${tab === 'deudas' ? 'is-active' : ''}`} onClick={() => setTab('deudas')}>
          Deudas internas
        </button>
        <button className={`tab ${tab === 'extracciones' ? 'is-active' : ''}`} onClick={() => setTab('extracciones')}>
          Extracciones
        </button>
      </div>
      {tab === 'deudas' ? <DebtsTab user={user} /> : <WithdrawalsTab />}
    </div>
  )
}

function DebtsTab({ user }) {
  const debts = useLiveQuery(() => debtsRepo.listAll(), [], [])
  const users = useLiveQuery(() => usersRepo.list(), [], [])
  const [showSettled, setShowSettled] = useState(false)
  const [toSettle, setToSettle] = useState(null) // deuda elegida para liquidar

  const userName = useMemo(() => {
    const m = {}
    for (const u of users) m[u.id] = u.name
    return m
  }, [users])

  const pending = debts.filter((d) => !d.settled)
  const totalPending = round2(pending.reduce((a, d) => a + Number(d.valueAtTime || 0), 0))

  // Saldo por deudor (solo pendientes).
  const byDebtor = useMemo(() => {
    const m = {}
    for (const d of pending) m[d.userId] = round2((m[d.userId] || 0) + Number(d.valueAtTime || 0))
    return m
  }, [pending])

  const visible = showSettled ? debts : pending

  return (
    <>
      <section className="card">
        <div className="kv">
          <span className="muted">Total pendiente</span>
          <strong className="total-amount">{formatMoney(totalPending)}</strong>
        </div>
        {Object.keys(byDebtor).length > 0 && (
          <div className="list">
            {Object.entries(byDebtor).map(([uid, val]) => (
              <div key={uid} className="kv">
                <span>{userName[uid] || 'usuario'}</span>
                <strong>{formatMoney(val)}</strong>
              </div>
            ))}
          </div>
        )}
      </section>

      <label className="toggle-row">
        <input type="checkbox" checked={showSettled} onChange={(e) => setShowSettled(e.target.checked)} />
        <span>Mostrar tambien las saldadas</span>
      </label>

      <div className="list">
        {visible.map((d) => (
          <div key={d.id} className={`list-item ${d.settled ? 'is-inactive' : ''}`}>
            <div>
              <strong>{formatMoney(d.valueAtTime)}</strong>
              <span className="muted"> · {userName[d.userId] || 'usuario'}</span>
              <br />
              <span className="muted">
                {d.qty} u · {formatDateTime(d.createdAt)}
                {d.settled && ` · saldada ${formatDateTime(d.settledAt)}`}
                {d.settled && d.settleMethod && ` · ${DEBT_SETTLE_LABELS[d.settleMethod] || d.settleMethod}`}
              </span>
              {d.settled && d.settleNote && (
                <>
                  <br />
                  <span className="muted">Nota: {d.settleNote}</span>
                </>
              )}
            </div>
            {!d.settled && (
              <button className="btn btn--ghost btn--sm" onClick={() => setToSettle(d)}>
                Saldar
              </button>
            )}
          </div>
        ))}
        {visible.length === 0 && <p className="muted">No hay deudas {showSettled ? '' : 'pendientes'}.</p>}
      </div>

      {toSettle && (
        <SettleDebtModal
          debt={toSettle}
          debtorName={userName[toSettle.userId] || 'usuario'}
          onCancel={() => setToSettle(null)}
          onConfirm={async ({ method, note }) => {
            await debtsRepo.settle(toSettle.id, user.id, { method, note })
            setToSettle(null)
          }}
        />
      )}
    </>
  )
}

// Modal de liquidacion: el dueño confirma y deja registrado COMO se salda la
// deuda (efectivo/transferencia/nomina/condonada) + nota opcional. Evita saldar
// por error de un toque y deja rastro auditable.
function SettleDebtModal({ debt, debtorName, onCancel, onConfirm }) {
  const [method, setMethod] = useState(DEBT_SETTLE_METHODS.CASH)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    await onConfirm({ method, note })
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Liquidar deuda</h3>
        <div className="kv">
          <span className="muted">{debtorName}</span>
          <strong className="total-amount">{formatMoney(debt.valueAtTime)}</strong>
        </div>
        <label className="field">
          <span>¿Cómo se salda?</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {Object.entries(DEBT_SETTLE_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Nota (opcional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: cobrado el 25/06" />
        </label>
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onCancel} disabled={busy}>Cancelar</button>
          <button className="btn btn--primary" onClick={confirm} disabled={busy}>
            {busy ? 'Saldando…' : 'Confirmar liquidación'}
          </button>
        </div>
      </div>
    </div>
  )
}

function WithdrawalsTab() {
  const all = useLiveQuery(() => cashRepo.listAll(), [], [])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const filtered = useMemo(() => {
    return all.filter((w) => {
      const day = w.createdAt ? localDay(w.createdAt) : ''
      if (from && day < from) return false
      if (to && day > to) return false
      return true
    })
  }, [all, from, to])

  const totalsByCur = useMemo(() => {
    const m = {}
    for (const w of filtered) m[w.currency] = round2((m[w.currency] || 0) + Number(w.amount || 0))
    return m
  }, [filtered])

  return (
    <>
      <section className="card">
        <div className="form-row">
          <label className="field">
            <span>Desde</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            <span>Hasta</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <div className="kv">
          <span className="muted">Total extraido</span>
          <strong>
            {Object.keys(totalsByCur).length
              ? Object.entries(totalsByCur).map(([c, v]) => formatMoney(v, c)).join(' · ')
              : formatMoney(0)}
          </strong>
        </div>
      </section>

      <div className="list">
        {filtered.map((w) => (
          <div key={w.id} className="list-item">
            <div>
              <strong>{formatMoney(w.amount, w.currency)}</strong>
              <span className="muted"> · {w.reason}</span>
              <br />
              <span className="muted">Autoriza: {w.authorizedBy} · {formatDateTime(w.createdAt)}</span>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="muted">Sin extracciones en el rango.</p>}
      </div>
    </>
  )
}
