import { useState } from 'react'
import { usersRepo } from '../../repositories/usersRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { PinInput } from '../../components/PinInput'
import { ROLES } from '../../db/constants'

// Primer arranque: no hay usuarios. Creamos al DUENO con su PIN.
export function Onboarding() {
  const { login } = useAuth()
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [step, setStep] = useState('name') // name -> pin -> confirm
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setError('')
    if (pin.length < 4) return setError('El PIN debe tener al menos 4 digitos')
    if (pin !== confirm) {
      setConfirm('')
      setStep('confirm')
      return setError('Los PIN no coinciden, intenta de nuevo')
    }
    setBusy(true)
    try {
      const id = await usersRepo.create({ name, role: ROLES.OWNER, pin })
      await login(id, pin)
    } catch (e) {
      setError('No se pudo crear el usuario: ' + e.message)
      setBusy(false)
    }
  }

  return (
    <div className="screen screen--centered">
      <div className="card auth-card">
        <h1 className="brand">MypiCuadre</h1>
        <p className="muted">Configuracion inicial — crea la cuenta del dueno</p>

        {step === 'name' && (
          <>
            <label className="field">
              <span>Nombre del dueno</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Maria"
              />
            </label>
            <button
              className="btn btn--primary btn--block"
              disabled={!name.trim()}
              onClick={() => setStep('pin')}
            >
              Continuar
            </button>
          </>
        )}

        {step === 'pin' && (
          <>
            <p className="field-label">Crea un PIN (4 a 6 digitos)</p>
            <PinInput value={pin} onChange={setPin} />
            <button
              className="btn btn--primary btn--block"
              disabled={pin.length < 4}
              onClick={() => setStep('confirm')}
            >
              Continuar
            </button>
          </>
        )}

        {step === 'confirm' && (
          <>
            <p className="field-label">Repite el PIN</p>
            <PinInput value={confirm} onChange={setConfirm} />
            <button
              className="btn btn--primary btn--block"
              disabled={confirm.length < 4 || busy}
              onClick={submit}
            >
              {busy ? 'Creando...' : 'Crear cuenta'}
            </button>
          </>
        )}

        {error && <p className="error">{error}</p>}
      </div>
    </div>
  )
}
