import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { shiftsRepo } from '../../repositories/shiftsRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useShift } from '../../app/providers/ShiftProvider'
import { OtherShiftBlocked } from './OtherShiftBlocked'
import { CashInputs } from '../../components/CashInputs'
import { CASH_CURRENCIES } from '../../db/constants'
import { formatMoney } from '../../lib/currency'
import { formatDateTime } from '../../lib/dates'
import { SEMAPHORE_EMOJI } from '../../lib/semaphore'

export function ShiftScreen() {
  const { activeShift, loading, isMine } = useShift()
  // El resultado del cierre vive aqui para que sobreviva a que el turno
  // pase a "cerrado" (si no, la pantalla saltaria a "Abrir turno").
  const [closeResult, setCloseResult] = useState(null)

  if (closeResult) {
    return <CloseResult result={closeResult} onDone={() => setCloseResult(null)} />
  }
  if (loading) {
    return <div className="screen"><p className="muted">Cargando…</p></div>
  }
  if (!activeShift) return <OpenShiftForm />
  if (isMine) return <ActiveShiftPanel shift={activeShift} onClosed={setCloseResult} />
  return <OtherShiftBlocked shift={activeShift} />
}

// ---- Abrir turno ----
function OpenShiftForm() {
  const { user } = useAuth()
  const [openingCash, setOpeningCash] = useState({})
  const [point, setPoint] = useState('Principal')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const open = async () => {
    setError('')
    setBusy(true)
    try {
      const cash = {}
      for (const c of CASH_CURRENCIES) cash[c] = Number(openingCash[c]) || 0
      await shiftsRepo.open({ sellerId: user.id, openingCash: cash, point })
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <h2>Abrir turno</h2>
      <section className="card">
        <p className="muted">Inicias turno como <strong>{user.name}</strong>.</p>
        <label className="field">
          <span>Punto de venta</span>
          <input value={point} onChange={(e) => setPoint(e.target.value)} />
        </label>
        <CashInputs
          label="Fondo inicial en caja"
          values={openingCash}
          onChange={setOpeningCash}
        />
        {error && <p className="error">{error}</p>}
        <button className="btn btn--primary btn--block" disabled={busy} onClick={open}>
          {busy ? 'Abriendo…' : 'Abrir turno'}
        </button>
      </section>
    </div>
  )
}

// ---- Turno activo (mio) ----
function ActiveShiftPanel({ shift, onClosed }) {
  const summary = useLiveQuery(() => shiftsRepo.getSummary(shift.id), [shift.id])
  const [closing, setClosing] = useState(false)

  if (closing) {
    return <CloseShiftPanel shift={shift} onCancel={() => setClosing(false)} onClosed={onClosed} />
  }

  return (
    <div className="screen">
      <div className="screen__header">
        <h2>Turno activo</h2>
        <span className="badge badge--live">● En curso</span>
      </div>

      <Link className="btn btn--primary btn--block btn--lg" to="/sell">
        💵 Registrar venta
      </Link>
      <Link className="btn btn--block" to="/entry">
        📥 Entrada de mercancia
      </Link>

      <section className="card">
        <div className="kv">
          <span className="muted">Abierto</span>
          <strong>{formatDateTime(shift.openedAt)}</strong>
        </div>
        <div className="kv">
          <span className="muted">Punto</span>
          <strong>{shift.point}</strong>
        </div>
      </section>

      <section className="card">
        <h3>Caja del turno</h3>
        {!summary ? (
          <p className="muted">Calculando…</p>
        ) : (
          <table className="cash-table">
            <thead>
              <tr>
                <th></th>
                {CASH_CURRENCIES.map((c) => <th key={c}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              <Row label="Fondo inicial" data={summary.shift.openingCash} />
              <Row label="Ventas en efectivo" data={summary.salesCash} />
              <Row label="Extracciones" data={summary.withdrawalsByCur} sign="-" />
              <Row label="Esperado en caja" data={summary.expectedCash} strong />
            </tbody>
          </table>
        )}
        {summary && summary.internalDebtTotal > 0 && (
          <p className="muted">
            Deuda interna del turno: {formatMoney(summary.internalDebtTotal)} (no es ingreso)
          </p>
        )}
        <p className="muted">{summary?.salesCount ?? 0} venta(s) registradas.</p>
      </section>

      <button className="btn btn--primary btn--block" onClick={() => setClosing(true)}>
        Cerrar turno
      </button>
    </div>
  )
}

function Row({ label, data, sign = '', strong = false }) {
  return (
    <tr className={strong ? 'is-strong' : ''}>
      <td>{label}</td>
      {CASH_CURRENCIES.map((c) => (
        <td key={c} className="num">
          {sign}
          {(data?.[c] ?? 0).toLocaleString('es-CU', { minimumFractionDigits: 2 })}
        </td>
      ))}
    </tr>
  )
}

// ---- Cerrar turno (cuadre + semaforo) ----
function CloseShiftPanel({ shift, onCancel, onClosed }) {
  const summary = useLiveQuery(() => shiftsRepo.getSummary(shift.id), [shift.id])
  const [declared, setDeclared] = useState({})
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const doClose = async () => {
    setBusy(true)
    const cash = {}
    for (const c of CASH_CURRENCIES) cash[c] = Number(declared[c]) || 0
    const res = await shiftsRepo.close({ shiftId: shift.id, declaredCash: cash, notes })
    onClosed(res)
  }

  return (
    <div className="screen">
      <button className="link-back" onClick={onCancel}>← Volver al turno</button>
      <h2>Cerrar turno</h2>

      {summary && (
        <section className="card">
          <h3>Esperado en caja</h3>
          <div className="convert-grid">
            {CASH_CURRENCIES.map((c) => (
              <div key={c} className="convert-cell">
                <span className="muted">{c}</span>
                <strong>{formatMoney(summary.expectedCash[c], c)}</strong>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <CashInputs label="Efectivo contado (declarado)" values={declared} onChange={setDeclared} />
        <label className="field">
          <span>Notas (opcional)</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button className="btn btn--primary btn--block" disabled={busy} onClick={doClose}>
          {busy ? 'Cerrando…' : 'Confirmar cierre'}
        </button>
      </section>
    </div>
  )
}

function CloseResult({ result, onDone }) {
  const { semaphore, expectedCash, declared, difference, base } = result
  const labels = {
    green: 'El turno cuadra',
    yellow: 'Diferencia menor',
    red: 'Diferencia critica'
  }
  return (
    <div className="screen">
      <div className={`cuadre-banner cuadre-banner--${semaphore.color}`}>
        <span className="cuadre-emoji">{SEMAPHORE_EMOJI[semaphore.color]}</span>
        <div>
          <strong>{labels[semaphore.color]}</strong>
          <p className="muted">
            Diferencia en {base}: {formatMoney(difference[base], base)} ({semaphore.pct}%)
          </p>
        </div>
      </div>

      <section className="card">
        <table className="cash-table">
          <thead>
            <tr>
              <th></th>
              {CASH_CURRENCIES.map((c) => <th key={c}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            <Row label="Esperado" data={expectedCash} />
            <Row label="Declarado" data={declared} />
            <Row label="Diferencia" data={difference} strong />
          </tbody>
        </table>
      </section>

      <button className="btn btn--primary btn--block" onClick={onDone}>
        Listo — abrir nuevo turno
      </button>
    </div>
  )
}
