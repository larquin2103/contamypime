import { useMemo } from 'react'
import { round2 } from '../lib/currency'

// Conteo de caja por denominacion (Fase 2). El usuario indica cuantos billetes
// de cada valor hay; el total se calcula solo. onChange recibe { counts, total }.
export function DenominationCounter({ currency, denominations, counts, onChange }) {
  const total = useMemo(
    () => round2(denominations.reduce((acc, d) => acc + d * (Number(counts[d]) || 0), 0)),
    [denominations, counts]
  )

  const setCount = (d, value) => {
    onChange({ ...counts, [d]: value })
  }

  return (
    <div className="denom">
      <div className="denom__head">
        <strong>{currency}</strong>
        <span className="denom__total">{total.toLocaleString('es-CU', { minimumFractionDigits: 2 })}</span>
      </div>
      <div className="denom__grid">
        {denominations.map((d) => (
          <label key={d} className="denom__row">
            <span className="denom__value">{d}</span>
            <span className="denom__x">×</span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              value={counts[d] ?? ''}
              onChange={(e) => setCount(d, e.target.value)}
              placeholder="0"
            />
          </label>
        ))}
      </div>
    </div>
  )
}

// Calcula el total declarado por moneda a partir de los conteos por denominacion.
export function totalsFromCounts(countsByCurrency, denominations) {
  const out = {}
  for (const cur of Object.keys(denominations)) {
    const counts = countsByCurrency[cur] || {}
    out[cur] = round2(denominations[cur].reduce((acc, d) => acc + d * (Number(counts[d]) || 0), 0))
  }
  return out
}
