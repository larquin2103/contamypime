import { useState } from 'react'
import { usersRepo } from '../../repositories/usersRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { PinInput } from '../../components/PinInput'
import { ROLES } from '../../db/constants'
import { genRecoveryCode } from '../../lib/pin'

// Primer arranque: no hay usuarios. Creamos al DUEÑO con su PIN.
export function Onboarding() {
  const { login } = useAuth()
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [step, setStep] = useState('name') // name -> pin -> confirm -> recovery
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [recovery, setRecovery] = useState(null)
  const [createdId, setCreatedId] = useState(null)

  // Validamos y mostramos el codigo, pero AUN no creamos el usuario: si lo
  // creamos aqui, el conteo de usuarios pasa a 1 y la app saltaria al login,
  // ocultando el codigo de recuperacion. Se crea al confirmar "Ya lo guarde".
  const submit = () => {
    setError('')
    if (pin.length < 4) return setError('El PIN debe tener al menos 4 digitos')
    if (pin !== confirm) {
      setConfirm('')
      setStep('confirm')
      return setError('Los PIN no coinciden, intenta de nuevo')
    }
    setRecovery(genRecoveryCode())
    setStep('recovery')
  }

  const finish = async () => {
    setBusy(true)
    try {
      const id = await usersRepo.create({ name, role: ROLES.OWNER, pin })
      await usersRepo.setRecoveryCode(id, recovery)
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
        <p className="muted">Configuracion inicial — crea la cuenta del dueño</p>

        {step === 'name' && (
          <>
            <label className="field">
              <span>Nombre del dueño</span>
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

        {step === 'recovery' && (
          <>
            <p className="field-label">Tu codigo de recuperacion</p>
            <p className="muted">
              Guardalo en un lugar seguro. Es la unica forma de recuperar tu PIN si lo olvidas.
            </p>
            <div className="recovery-code">{recovery}</div>
            <button className="btn btn--primary btn--block" onClick={finish}>
              Ya lo guarde — entrar
            </button>
          </>
        )}

        {error && <p className="error">{error}</p>}
      </div>
    </div>
  )
}
