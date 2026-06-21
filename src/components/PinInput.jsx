import { useState } from 'react'

// Teclado numerico para introducir el PIN. Pensado para pantalla tactil.
export function PinInput({ value, onChange, maxLength = 6 }) {
  const press = (digit) => {
    if (value.length >= maxLength) return
    onChange(value + digit)
  }
  const backspace = () => onChange(value.slice(0, -1))
  const clear = () => onChange('')

  return (
    <div className="pinpad">
      <div className="pinpad__display" aria-label="PIN">
        {Array.from({ length: maxLength }).map((_, i) => (
          <span key={i} className={`pinpad__dot ${i < value.length ? 'is-filled' : ''}`} />
        ))}
      </div>
      <div className="pinpad__keys">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <button key={n} type="button" className="pinpad__key" onClick={() => press(String(n))}>
            {n}
          </button>
        ))}
        <button type="button" className="pinpad__key pinpad__key--muted" onClick={clear}>
          C
        </button>
        <button type="button" className="pinpad__key" onClick={() => press('0')}>
          0
        </button>
        <button type="button" className="pinpad__key pinpad__key--muted" onClick={backspace}>
          ⌫
        </button>
      </div>
    </div>
  )
}
