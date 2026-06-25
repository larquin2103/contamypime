import { useState } from 'react'
import { usersRepo } from '../repositories/usersRepo'
import { PinInput } from './PinInput'

// Pide el PIN del dueño para autorizar una operacion sensible (extraccion,
// deuda interna) cuando la registra un vendedor.
export function OwnerAuthModal({ onAuthorized, onCancel }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const verify = async () => {
    setBusy(true)
    setError('')
    // Comprueba el PIN contra cualquier dueño activo (cubre duplicados).
    const owner = await usersRepo.verifyOwnerPin(pin)
    setBusy(false)
    if (owner) {
      onAuthorized(owner)
    } else {
      setError('PIN del dueño incorrecto')
      setPin('')
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Autorizacion del dueño</h3>
        <p className="muted">Esta operacion necesita el PIN del dueño para autorizarse.</p>
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
