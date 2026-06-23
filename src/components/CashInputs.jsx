import { CASH_CURRENCIES } from '../db/constants'

// Inputs de efectivo por cada moneda (MN, USD). MLC no es efectivo en Fase 1.
export function CashInputs({ values, onChange, label, disabled = false }) {
  return (
    <div className="cash-inputs">
      {label && <p className="field-label">{label}</p>}
      <div className="form-row">
        {CASH_CURRENCIES.map((c) => (
          <label key={c} className="field">
            <span>{c}</span>
            <input
              type="number"
              inputMode="decimal"
              disabled={disabled}
              value={values[c] ?? ''}
              onChange={(e) => onChange && onChange({ ...values, [c]: e.target.value })}
              placeholder="0"
            />
          </label>
        ))}
      </div>
    </div>
  )
}
