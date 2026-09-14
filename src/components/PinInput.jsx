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
      {/* Los puntos comunican el avance SOLO con forma y color, asi que por si
          solos son mudos: el `aria-label` que habia aqui ni siquiera se anunciaba,
          porque un `div` sin `role` no lo soporta y los lectores lo ignoran. Con
          `role="status"` (region viva discreta) mas el texto de abajo, quien no ve
          la pantalla oye cuantos digitos lleva; sin el, podia quedarse bloqueado
          10 minutos por intentos fallidos sin saber por que. */}
      <div className="pinpad__display" role="status">
        {Array.from({ length: maxLength }).map((_, i) => (
          <span key={i} className={`pinpad__dot ${i < value.length ? 'is-filled' : ''}`} aria-hidden="true" />
        ))}
        <span className="sr-only">
          {value.length === 0
            ? 'PIN vacío'
            : `${value.length} ${value.length === 1 ? 'dígito' : 'dígitos'} de ${maxLength}`}
        </span>
      </div>
      <div className="pinpad__keys">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <button key={n} type="button" className="pinpad__key" onClick={() => press(String(n))}>
            {n}
          </button>
        ))}
        {/* "C" y "⌫" no dicen nada leidos en voz alta: el segundo es un simbolo que
            cada lector nombra a su manera. Se les pone su nombre real. */}
        <button type="button" className="pinpad__key pinpad__key--muted" aria-label="Borrar todo" onClick={clear}>
          C
        </button>
        <button type="button" className="pinpad__key" onClick={() => press('0')}>
          0
        </button>
        <button type="button" className="pinpad__key pinpad__key--muted" aria-label="Borrar el último dígito" onClick={backspace}>
          ⌫
        </button>
      </div>
    </div>
  )
}
