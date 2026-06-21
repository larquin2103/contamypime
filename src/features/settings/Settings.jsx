import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { configRepo } from '../../repositories/configRepo'
import { ratesRepo } from '../../repositories/ratesRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { FOREIGN_CURRENCIES, DEFAULT_SEMAPHORE_CONFIG } from '../../db/constants'
import { formatMoney, baseToForeign } from '../../lib/currency'
import { formatDateTime } from '../../lib/dates'

export function Settings() {
  const { user, isOwner } = useAuth()
  const { baseCurrency, rates } = useCurrency()

  if (!isOwner) {
    return (
      <div className="screen">
        <h2>Ajustes</h2>
        <p className="muted">Solo el dueno puede modificar la configuracion.</p>
      </div>
    )
  }

  return (
    <div className="screen">
      <h2>Ajustes</h2>
      <RatesSection userId={user.id} baseCurrency={baseCurrency} rates={rates} />
      <ConverterPreview baseCurrency={baseCurrency} rates={rates} />
      <SemaphoreSection />
    </div>
  )
}

function RatesSection({ userId, baseCurrency, rates }) {
  const [drafts, setDrafts] = useState({})
  const [saved, setSaved] = useState('')

  const save = async (currency) => {
    const val = Number(drafts[currency])
    if (!val || val <= 0) return
    await ratesRepo.addRate(currency, val, userId)
    setDrafts((d) => ({ ...d, [currency]: '' }))
    setSaved(currency)
    setTimeout(() => setSaved(''), 1500)
  }

  return (
    <section className="card">
      <h3>Tasas de cambio</h3>
      <p className="muted">
        Cuanta {baseCurrency} vale 1 unidad de cada moneda. Editable sin internet.
      </p>
      {FOREIGN_CURRENCIES.map((c) => {
        const current = rates?.[c.code]
        return (
          <div key={c.code} className="rate-row">
            <div className="rate-row__info">
              <strong>{c.name}</strong>
              {current ? (
                <span className="muted">
                  Actual: 1 {c.code} = {current.rate} {baseCurrency}
                  <br />
                  <small>desde {formatDateTime(current.effectiveFrom)}</small>
                </span>
              ) : (
                <span className="muted">Sin tasa definida</span>
              )}
            </div>
            <div className="rate-row__edit">
              <input
                type="number"
                inputMode="decimal"
                placeholder={current ? String(current.rate) : '0'}
                value={drafts[c.code] ?? ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [c.code]: e.target.value }))}
              />
              <button className="btn btn--primary" onClick={() => save(c.code)}>
                {saved === c.code ? '✓' : 'Guardar'}
              </button>
            </div>
          </div>
        )
      })}
    </section>
  )
}

function ConverterPreview({ baseCurrency, rates }) {
  const [amount, setAmount] = useState('')
  const n = Number(amount) || 0

  return (
    <section className="card">
      <h3>Conversor rapido</h3>
      <label className="field">
        <span>Monto en {baseCurrency}</span>
        <input
          type="number"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
        />
      </label>
      <div className="convert-grid">
        {FOREIGN_CURRENCIES.map((c) => {
          const rate = Number(rates?.[c.code]?.rate || 0)
          return (
            <div key={c.code} className="convert-cell">
              <span className="muted">{c.code}</span>
              <strong>{rate ? formatMoney(baseToForeign(n, rate), c.code) : '— sin tasa'}</strong>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function SemaphoreSection() {
  const config = useLiveQuery(() => configRepo.getSemaphoreConfig(), [], DEFAULT_SEMAPHORE_CONFIG)
  const [green, setGreen] = useState('')
  const [yellow, setYellow] = useState('')
  const [saved, setSaved] = useState(false)

  const greenVal = green !== '' ? green : config?.greenMaxPct ?? ''
  const yellowVal = yellow !== '' ? yellow : config?.yellowMaxPct ?? ''

  const save = async () => {
    await configRepo.set('semaphore', {
      greenMaxPct: Number(greenVal),
      yellowMaxPct: Number(yellowVal)
    })
    setGreen('')
    setYellow('')
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <section className="card">
      <h3>Semaforo del cuadre</h3>
      <p className="muted">Margen de diferencia tolerado al cerrar turno (% del esperado).</p>
      <label className="field">
        <span>🟢 Cuadra si la diferencia es menor o igual a (%)</span>
        <input
          type="number"
          inputMode="decimal"
          value={greenVal}
          onChange={(e) => setGreen(e.target.value)}
        />
      </label>
      <label className="field">
        <span>🟡 Diferencia menor hasta (%) — por encima es 🔴 critica</span>
        <input
          type="number"
          inputMode="decimal"
          value={yellowVal}
          onChange={(e) => setYellow(e.target.value)}
        />
      </label>
      <button className="btn btn--primary btn--block" onClick={save}>
        {saved ? 'Guardado ✓' : 'Guardar umbrales'}
      </button>
    </section>
  )
}
