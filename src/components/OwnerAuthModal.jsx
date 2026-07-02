import { useState } from 'react'
import { usersRepo } from '../repositories/usersRepo'
import { useEscapeClose } from '../lib/useEscapeClose'
import { PinInput } from './PinInput'

// Pide el PIN de un mando (dueño o administrativo) para autorizar una operacion
// sensible (extraccion, deuda interna, retiro al cierre) que registra un vendedor.
export function OwnerAuthModal({ onAuthorized, onCancel }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEscapeClose(onCancel)

  const verify = async () => {
    setBusy(true)
    setError('')
    // Comprueba el PIN contra cualquier dueño o administrativo activo.
    const mgr = await usersRepo.verifyManagerPin(pin)
    setBusy(false)
    if (mgr) {
      onAuthorized(mgr)
    } else {
      setError('PIN del dueño o administrativo incorrecto')
      setPin('')
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Autorización" onClick={(e) => e.stopPropagation()}>
        <h3>Autorización</h3>
        <p className="muted">Esta operación necesita el PIN del dueño o de un administrativo.</p>
        <PinInput value={pin} onChange={setPin} />
        {error && <p className="error">{error}</p>}
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onCancel}>Cancelar</button>
          <button className="btn btn--primary" disabled={pin.length < 4 || busy} onClick={verify}>
            {busy ? 'Verificando…' : 'Autorizar'}
          </button>
        </div>
      </div>
    </div>
  )
}
