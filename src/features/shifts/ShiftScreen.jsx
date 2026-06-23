import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { shiftsRepo } from '../../repositories/shiftsRepo'
import { configRepo } from '../../repositories/configRepo'
import { usersRepo } from '../../repositories/usersRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useShift } from '../../app/providers/ShiftProvider'
import { OtherShiftBlocked } from './OtherShiftBlocked'
import { CashInputs } from '../../components/CashInputs'
import { OwnerAuthModal } from '../../components/OwnerAuthModal'
import { DenominationCounter, totalsFromCounts } from '../../components/DenominationCounter'
import { ShiftSalesSummary } from './ShiftSalesSummary'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { CASH_CURRENCIES } from '../../db/constants'
import { formatMoney, round2 } from '../../lib/currency'
import { formatDateTime } from '../../lib/dates'
import { SEMAPHORE_EMOJI } from '../../lib/semaphore'
import { buildCloseReport, openWhatsapp } from '../../lib/whatsapp'

export function ShiftScreen() {
  const { activeShift, loading, isMine } = useShift()
  const { isOwner } = useAuth()
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
  // Turno de otro vendedor: el dueño puede cerrarlo (p.ej. quedo abierto); el
  // resto solo ve el bloqueo.
  if (isOwner) return <ForeignShiftOwner shift={activeShift} onClosed={setCloseResult} />
  return <OtherShiftBlocked shift={activeShift} />
}

// ---- Abrir turno ----
function OpenShiftForm() {
  const { user } = useAuth()
  // Caja a heredar: primero un traspaso explicito por archivo (config local);
  // si no, el fondo del ultimo turno cerrado (que SI sincroniza entre equipos).
  const inherited = useLiveQuery(async () => {
    const local = await configRepo.get('inheritedOpeningCash', null)
    if (local && Object.keys(local).length) return local
    return shiftsRepo.lastClosedCash()
  }, [], undefined)
  const [openingCash, setOpeningCash] = useState({})
  const [point, setPoint] = useState('Principal')
  const [usedInherited, setUsedInherited] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Prefill con la caja heredada (una sola vez).
  if (inherited && !usedInherited && Object.keys(openingCash).length === 0 && Object.keys(inherited).length) {
    setOpeningCash(Object.fromEntries(CASH_CURRENCIES.map((c) => [c, String(inherited[c] ?? '')])))
    setUsedInherited(true)
  }

  const open = async () => {
    setError('')
    setBusy(true)
    try {
      const cash = {}
      for (const c of CASH_CURRENCIES) cash[c] = Number(openingCash[c]) || 0
      await shiftsRepo.open({ sellerId: user.id, openingCash: cash, point })
      await configRepo.set('inheritedOpeningCash', {}) // consumida
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
        {usedInherited && (
          <p className="muted">💡 Fondo prellenado con la caja del turno recibido.</p>
        )}
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
        <Link className="btn btn--ghost btn--block" to="/handoff">
          🔄 Recibir turno de otro vendedor
        </Link>
      </section>
    </div>
  )
}

// ---- Turno activo (mio) ----
function ActiveShiftPanel({ shift, onClosed }) {
  const { isOwner } = useAuth()
  const summary = useLiveQuery(() => shiftsRepo.getSummary(shift.id), [shift.id])
  const [closing, setClosing] = useState(false)
  const [showSales, setShowSales] = useState(false)

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
      <Link className="btn btn--block" to="/cash">
        💸 Caja y deudas
      </Link>
      {isOwner && (
        <>
          <Link className="btn btn--block" to="/entry">
            📥 Entrada de mercancia
          </Link>
          <Link className="btn btn--block" to="/price">
            🏷️ Cambiar precio
          </Link>
        </>
      )}

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
        {summary && summary.transfersCount > 0 && (
          <p className="muted">
            Transferencias (no es efectivo):{' '}
            {Object.entries(summary.transfersByCur).map(([c, v]) => formatMoney(v, c)).join(' · ')}
            {' '}({summary.transfersCount})
          </p>
        )}
        {summary && summary.internalDebtTotal > 0 && (
          <p className="muted">
            Deuda interna del turno: {formatMoney(summary.internalDebtTotal)} (no es ingreso)
          </p>
        )}
        <p className="muted">{summary?.salesCount ?? 0} venta(s) registradas.</p>
      </section>

      <section className="card">
        <div className="screen__header">
          <h3>Ventas del turno</h3>
          <button className="btn btn--ghost btn--sm" onClick={() => setShowSales((v) => !v)}>
            {showSales ? 'Ocultar' : 'Ver detalle'}
          </button>
        </div>
        {showSales && <ShiftSalesSummary shiftId={shift.id} />}
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

// ---- Turno de otro vendedor, visto por el dueño (p.ej. quedo abierto) ----
function ForeignShiftOwner({ shift, onClosed }) {
  const seller = useLiveQuery(() => usersRepo.get(shift.sellerId), [shift.sellerId])
  const [closing, setClosing] = useState(false)

  if (closing) {
    return (
      <CloseShiftPanel
        shift={{ ...shift, sellerName: seller?.name }}
        forcedByOwner
        onCancel={() => setClosing(false)}
        onClosed={onClosed}
      />
    )
  }

  return (
    <div className="screen">
      <h2>Turno abierto de otro vendedor</h2>
      <section className="card">
        <p>
          Hay un turno abierto por <strong>{seller?.name || 'un vendedor'}</strong> desde{' '}
          {formatDateTime(shift.openedAt)}.
        </p>
        <p className="muted">
          Si el vendedor salio de la app sin cerrar, sus ventas y movimientos siguen guardados.
          Como dueño puedes cerrar su turno haciendo el cuadre, o esperar a que el vuelva.
        </p>
        <button className="btn btn--primary btn--block" onClick={() => setClosing(true)}>
          Cerrar turno de {seller?.name || 'vendedor'}
        </button>
      </section>
    </div>
  )
}

// ---- Cerrar turno: asistente guiado (conteo -> ventas -> cuadre -> fondo -> cierre) ----
const CLOSE_STEPS = ['Conteo', 'Ventas', 'Cuadre', 'Fondo', 'Cerrar']

function CloseShiftPanel({ shift, onCancel, onClosed, forcedByOwner = false }) {
  const { user, isOwner } = useAuth()
  const summary = useLiveQuery(() => shiftsRepo.getSummary(shift.id), [shift.id])
  const denominations = useLiveQuery(() => configRepo.getDenominations(), [], null)
  const [step, setStep] = useState(1)
  const [counts, setCounts] = useState({}) // { MN: {1000: '2', ...}, USD: {...} }
  const [notes, setNotes] = useState('')
  const [floatCash, setFloatCash] = useState(null) // fondo para el proximo turno
  const [floatUnlocked, setFloatUnlocked] = useState(false) // el dueño autorizo retirar
  const [askOwner, setAskOwner] = useState(false)
  const [busy, setBusy] = useState(false)
  const [warnNoCount, setWarnNoCount] = useState(false)

  if (!summary || !denominations) {
    return <div className="screen"><p className="muted">Calculando…</p></div>
  }

  const declared = totalsFromCounts(counts, denominations)
  const diff = {}
  for (const c of CASH_CURRENCIES) diff[c] = round2((declared[c] || 0) - summary.expectedCash[c])
  const setCurrencyCounts = (cur, next) => setCounts((prev) => ({ ...prev, [cur]: next }))

  const declaredTotal = CASH_CURRENCIES.reduce((a, c) => a + (declared[c] || 0), 0)
  const expectedTotal = CASH_CURRENCIES.reduce((a, c) => a + summary.expectedCash[c], 0)
  const noCount = declaredTotal === 0 && expectedTotal > 0

  // Fondo para el proximo turno: por defecto, todo lo declarado (no se retira).
  const fondo = floatCash ?? Object.fromEntries(CASH_CURRENCIES.map((c) => [c, String(declared[c] ?? 0)]))
  const retiro = {}
  for (const c of CASH_CURRENCIES) retiro[c] = round2(Math.max(0, (declared[c] || 0) - (Number(fondo[c]) || 0)))
  const canEditFloat = isOwner || floatUnlocked
  const retiroTotal = CASH_CURRENCIES.reduce((a, c) => a + retiro[c], 0)

  const goToFloat = () => {
    // Al entrar al paso de fondo, prellenar con lo declarado.
    if (floatCash === null) setFloatCash(Object.fromEntries(CASH_CURRENCIES.map((c) => [c, String(declared[c] ?? 0)])))
    setStep(4)
  }

  const doClose = async (countSkipped) => {
    setBusy(true)
    const cash = {}
    for (const c of CASH_CURRENCIES) cash[c] = declared[c] || 0
    const closingFloat = {}
    for (const c of CASH_CURRENCIES) closingFloat[c] = Number(fondo[c]) || 0
    const autoNote = [
      notes,
      countSkipped ? '[cerrado sin contar efectivo]' : '',
      forcedByOwner ? '[cerrado por el dueño]' : '',
      retiroTotal > 0 ? '[retiro del dueño al cierre]' : ''
    ].filter(Boolean).join(' ')
    const res = await shiftsRepo.close({
      shiftId: shift.id,
      declaredCash: cash,
      denominations: counts,
      notes: autoNote,
      closedBy: user.id,
      countSkipped,
      closingFloat
    })
    onClosed(res)
  }

  const onConfirm = () => {
    if (noCount) setWarnNoCount(true)
    else doClose(false)
  }

  return (
    <div className="screen">
      <button className="link-back" onClick={onCancel}>← Volver</button>
      <h2>Cerrar turno{forcedByOwner ? ` de ${shift.sellerName || 'vendedor'}` : ''}</h2>

      <ol className="close-steps">
        {CLOSE_STEPS.map((label, i) => (
          <li key={label} className={`close-step ${step === i + 1 ? 'is-active' : ''} ${step > i + 1 ? 'is-done' : ''}`}>
            <span className="close-step__n">{i + 1}</span>{label}
          </li>
        ))}
      </ol>

      {/* Paso 1: conteo fisico (recomendado, saltable) */}
      {step === 1 && (
        <section className="card">
          <h3>1. Conteo físico (recomendado)</h3>
          <p className="muted">
            Antes de cerrar, conviene contar el inventario. Los productos agotados no se listan.
            Si ya lo hiciste (o no toca hoy), puedes continuar.
          </p>
          <Link className="btn btn--block" to="/count">📋 Ir al conteo físico</Link>
          <button className="btn btn--primary btn--block" onClick={() => setStep(2)}>
            Continuar
          </button>
        </section>
      )}

      {/* Paso 2: resumen de ventas del turno */}
      {step === 2 && (
        <section className="card">
          <h3>2. Ventas del turno</h3>
          <ShiftSalesSummary shiftId={shift.id} />
          <div className="modal__actions">
            <button className="btn btn--ghost" onClick={() => setStep(1)}>Atrás</button>
            <button className="btn btn--primary" onClick={() => setStep(3)}>Continuar</button>
          </div>
        </section>
      )}

      {/* Paso 3: cuadre por denominacion */}
      {step === 3 && (
        <>
          <section className="card">
            <h3>3. Cuenta el efectivo por denominación</h3>
            {CASH_CURRENCIES.map((c) => (
              <div key={c} className="close-cur">
                <DenominationCounter
                  currency={c}
                  denominations={denominations[c] || []}
                  counts={counts[c] || {}}
                  onChange={(next) => setCurrencyCounts(c, next)}
                />
                <div className="cuadre-mini">
                  <span>Esperado {formatMoney(summary.expectedCash[c], c)}</span>
                  <span className={diff[c] === 0 ? 'ok-text' : 'warn-text'}>
                    Dif {formatMoney(diff[c], c)}
                  </span>
                </div>
              </div>
            ))}
          </section>
          {summary.transfersCount > 0 && (
            <section className="card">
              <h3>Transferencias (aparte del efectivo)</h3>
              {Object.entries(summary.transfersByCur).map(([c, v]) => (
                <div key={c} className="kv"><span className="muted">{c}</span><strong>{formatMoney(v, c)}</strong></div>
              ))}
            </section>
          )}
          <div className="modal__actions">
            <button className="btn btn--ghost" onClick={() => setStep(2)}>Atrás</button>
            <button className="btn btn--primary" onClick={goToFloat}>Continuar</button>
          </div>
        </>
      )}

      {/* Paso 4: fondo para el proximo turno / retiro del dueño */}
      {step === 4 && (
        <section className="card">
          <h3>4. Fondo para el próximo turno</h3>
          <p className="muted">
            Lo que dejes aquí pasa como caja inicial del siguiente turno. La diferencia con lo
            declarado se registra como <strong>retiro del dueño</strong> (ajuste del saldo final).
          </p>
          <CashInputs
            label="Fondo a dejar en caja"
            values={fondo}
            onChange={canEditFloat ? setFloatCash : undefined}
            disabled={!canEditFloat}
          />
          {!canEditFloat && (
            <button className="btn btn--block" onClick={() => setAskOwner(true)}>
              🔒 Autorizar retiro (PIN del dueño)
            </button>
          )}
          <div className="cuadre-mini">
            <span>Declarado {formatMoney(declaredTotal, CASH_CURRENCIES[0])}…</span>
            <span className={retiroTotal > 0 ? 'warn-text' : 'ok-text'}>
              Retiro del dueño: {CASH_CURRENCIES.map((c) => formatMoney(retiro[c], c)).join(' · ')}
            </span>
          </div>
          <div className="modal__actions">
            <button className="btn btn--ghost" onClick={() => setStep(3)}>Atrás</button>
            <button className="btn btn--primary" onClick={() => setStep(5)}>Continuar</button>
          </div>
        </section>
      )}

      {/* Paso 5: confirmar */}
      {step === 5 && (
        <section className="card">
          <h3>5. Confirmar cierre</h3>
          <div className="kv"><span className="muted">Declarado</span><strong>{CASH_CURRENCIES.map((c) => formatMoney(declared[c] || 0, c)).join(' · ')}</strong></div>
          <div className="kv"><span className="muted">Fondo próximo turno</span><strong>{CASH_CURRENCIES.map((c) => formatMoney(Number(fondo[c]) || 0, c)).join(' · ')}</strong></div>
          {retiroTotal > 0 && (
            <div className="kv"><span className="muted">Retiro del dueño</span><strong>{CASH_CURRENCIES.map((c) => formatMoney(retiro[c], c)).join(' · ')}</strong></div>
          )}
          <label className="field">
            <span>Notas (opcional)</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div className="modal__actions">
            <button className="btn btn--ghost" onClick={() => setStep(4)}>Atrás</button>
            <button className="btn btn--primary" disabled={busy} onClick={onConfirm}>
              {busy ? 'Cerrando…' : 'Confirmar cierre'}
            </button>
          </div>
        </section>
      )}

      {askOwner && (
        <OwnerAuthModal
          onAuthorized={() => { setFloatUnlocked(true); setAskOwner(false) }}
          onCancel={() => setAskOwner(false)}
        />
      )}

      {warnNoCount && (
        <div className="modal-backdrop" onClick={() => setWarnNoCount(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>⚠️ No contaste el efectivo</h3>
            <p>
              Se registrara la caja declarada en <strong>0</strong> y quedara una diferencia de{' '}
              <strong>{formatMoney(diff[CASH_CURRENCIES[0]], CASH_CURRENCIES[0])}</strong>.
              El cierre quedara marcado como <em>sin conteo</em> para que el dueño lo revise.
            </p>
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setWarnNoCount(false)}>
                Volver a contar
              </button>
              <button className="btn btn--primary" disabled={busy} onClick={() => doClose(true)}>
                Cerrar sin contar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CloseResult({ result, onDone }) {
  const {
    semaphore,
    expectedCash,
    declared,
    difference,
    base,
    salesCount,
    salesCash,
    withdrawalsByCur,
    internalDebtTotal,
    transfersByCur = {},
    transfersCount = 0,
    forced = false,
    countSkipped = false,
    closingFloat = null,
    ownerWithdrawal = null,
    shift
  } = result
  const retiroTotal = ownerWithdrawal ? CASH_CURRENCIES.reduce((a, c) => a + Number(ownerWithdrawal[c] || 0), 0) : 0
  const { toBase } = useCurrency()
  const { user } = useAuth()
  const ownerWhatsapp = useLiveQuery(() => configRepo.get('ownerWhatsapp', ''), [], '')
  const labels = {
    green: 'El turno cuadra',
    yellow: 'Diferencia menor',
    red: 'Diferencia critica'
  }

  const sendReport = () => {
    openWhatsapp(ownerWhatsapp, buildCloseReport(result, user.name))
  }

  // Equivalencia informativa: todo el efectivo declarado expresado en base.
  const declaredInBase = CASH_CURRENCIES.reduce(
    (acc, c) => acc + (c === base ? Number(declared[c] || 0) : toBase(Number(declared[c] || 0), c)),
    0
  )

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

      {(forced || countSkipped) && (
        <div className="alert-flags">
          {forced && <span className="flag flag--warn">Cerrado por el dueño</span>}
          {countSkipped && <span className="flag flag--warn">Sin conteo de efectivo</span>}
        </div>
      )}

      <section className="card">
        <h3>Cuadre de caja</h3>
        <table className="cash-table">
          <thead>
            <tr>
              <th></th>
              {CASH_CURRENCIES.map((c) => <th key={c}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            <Row label="Fondo inicial" data={shift.openingCash} />
            <Row label="Ventas efectivo" data={salesCash} />
            <Row label="Extracciones" data={withdrawalsByCur} sign="-" />
            <Row label="Esperado" data={expectedCash} strong />
            <Row label="Declarado" data={declared} />
            <Row label="Diferencia" data={difference} strong />
          </tbody>
        </table>
        <p className="muted equiv">
          Equivalente declarado en {base}: <strong>{formatMoney(declaredInBase, base)}</strong>
        </p>
      </section>

      <section className="card">
        <h3>Resumen del turno</h3>
        <div className="kv"><span className="muted">Ventas</span><strong>{salesCount}</strong></div>
        {transfersCount > 0 && (
          <div className="kv">
            <span className="muted">Transferencias (no efectivo)</span>
            <strong>
              {Object.entries(transfersByCur).map(([c, v]) => formatMoney(v, c)).join(' · ')}
            </strong>
          </div>
        )}
        <div className="kv">
          <span className="muted">Deuda interna (no es ingreso)</span>
          <strong>{formatMoney(internalDebtTotal)}</strong>
        </div>
        {closingFloat && (
          <div className="kv">
            <span className="muted">Fondo para el próximo turno</span>
            <strong>{CASH_CURRENCIES.map((c) => formatMoney(Number(closingFloat[c] || 0), c)).join(' · ')}</strong>
          </div>
        )}
        {retiroTotal > 0 && (
          <div className="kv">
            <span className="muted">Retiro del dueño al cierre</span>
            <strong>{CASH_CURRENCIES.map((c) => formatMoney(Number(ownerWithdrawal[c] || 0), c)).join(' · ')}</strong>
          </div>
        )}
      </section>

      <button className="btn btn--block" onClick={sendReport}>
        📲 Enviar reporte al dueño {ownerWhatsapp ? '' : '(WhatsApp)'}
      </button>
      <Link className="btn btn--block" to="/handoff">
        🔄 Entregar turno (traspaso)
      </Link>
      <button className="btn btn--primary btn--block" onClick={onDone}>
        Listo — abrir nuevo turno
      </button>
    </div>
  )
}
