import { useState } from 'react'
import { usersRepo } from '../repositories/usersRepo'
import { useEscapeClose } from '../lib/useEscapeClose'
import { PinInput } from './PinInput'

// Pide un PIN para autorizar una operacion sensible (extraccion, deuda interna,
// retiro al cierre) que registra un vendedor.
//  - Modo por defecto (self = null): exige el PIN de un MANDO (dueño/admin).
//  - Modo "self" (self = { id, name }): el propio usuario confirma con SU PIN.
//    Lo habilita el permiso mayorista "el vendedor se autoriza con su PIN": el
//    dueño ya dio el visto bueno al activar el permiso; aqui el vendedor solo
//    prueba que es el (verifyLogin contra su id). La operacion queda a su nombre.
export function OwnerAuthModal({ onAuthorized, onCancel, self = null }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEscapeClose(onCancel)

  const verify = async () => {
    setBusy(true)
    setError('')
    if (self) {
      // El vendedor confirma con su PROPIO PIN.
      const me = await usersRepo.verifyLogin(self.id, pin)
      setBusy(false)
      if (me) return onAuthorized(me)
      setError('Tu PIN es incorrecto')
      setPin('')
      return
    }
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
        <h3>{self ? 'Confirma con tu PIN' : 'Autorización'}</h3>
        <p className="muted">
          {self
            ? 'El dueño autorizó esta operación. Confírmala con tu PIN.'
            : 'Esta operación necesita el PIN del dueño o de un administrativo.'}
        </p>
        <PinInput value={pin} onChange={setPin} />
        {error && <p className="error">{error}</p>}
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onCancel}>Cancelar</button>
          <button className="btn btn--primary" disabled={pin.length < 4 || busy} onClick={verify}>
            {busy ? 'Verificando…' : (self ? 'Confirmar' : 'Autorizar')}
          </button>
        </div>
      </div>
    </div>
  )
}
