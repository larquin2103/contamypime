import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { usersRepo } from '../../repositories/usersRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { PinInput } from '../../components/PinInput'
import { ROLE_LABELS, ROLES } from '../../db/constants'
import { lockRemaining, recordFail, clearFails, formatWait } from '../../lib/lockout'

export function Login() {
  const { login } = useAuth()
  const users = useLiveQuery(() => usersRepo.listActive(), [], [])
  const [selected, setSelected] = useState(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [recovering, setRecovering] = useState(false)

  const tryLogin = async (nextPin) => {
    setBusy(true)
    setError('')
    // Bloqueo anti-fuerza-bruta por usuario (de dispositivo). Si esta en espera,
    // no se intenta verificar.
    const lockKey = `login_${selected.id}`
    const waiting = lockRemaining(lockKey)
    if (waiting > 0) {
      setError(`Demasiados intentos. Espera ${formatWait(waiting)}.`)
      setPin('')
      setBusy(false)
      return
    }
    const ok = await login(selected.id, nextPin)
    if (!ok) {
      const wait = recordFail(lockKey)
      setError(wait > 0 ? `PIN incorrecto. Espera ${formatWait(wait)}.` : 'PIN incorrecto')
      setPin('')
    } else {
      clearFails(lockKey)
    }
    setBusy(false)
  }

  const backToList = () => {
    setSelected(null)
    setPin('')
    setError('')
    setRecovering(false)
  }

  if (!selected) {
    return (
      <div className="screen screen--centered">
        <div className="card auth-card">
          <h1 className="brand">MypiCuadre</h1>
          <p className="muted">Selecciona tu usuario</p>
          <div className="user-list">
            {users.map((u) => (
              <button key={u.id} className="user-chip" onClick={() => setSelected(u)}>
                <span className="user-chip__name">{u.name}</span>
                <span className="user-chip__role">{ROLE_LABELS[u.role]}</span>
              </button>
            ))}
            {users.length === 0 && <p className="muted">No hay usuarios activos.</p>}
          </div>
        </div>
      </div>
    )
  }

  if (recovering) {
    return (
      <div className="screen screen--centered">
        <div className="card auth-card">
          <RecoverPin user={selected} onCancel={() => setRecovering(false)} onDone={tryLogin} />
        </div>
      </div>
    )
  }

  return (
    <div className="screen screen--centered">
      <div className="card auth-card">
        <button className="link-back" onClick={backToList}>
          ← Cambiar usuario
        </button>
        <h2>Hola, {selected.name}</h2>
        <p className="field-label">Introduce tu PIN</p>
        <PinInput value={pin} onChange={setPin} />
        <button
          className="btn btn--primary btn--block"
          disabled={pin.length < 4 || busy}
          onClick={() => tryLogin(pin)}
        >
          {busy ? 'Entrando...' : 'Entrar'}
        </button>
        {error && <p className="error">{error}</p>}
        {selected.role === ROLES.OWNER && (
          <button className="link-recover" onClick={() => { setRecovering(true); setError('') }}>
            ¿Olvidaste tu PIN?
          </button>
        )}
      </div>
    </div>
  )
}

// Recuperacion del PIN del dueño mediante el codigo de recuperacion.
function RecoverPin({ user, onCancel, onDone }) {
  const [code, setCode] = useState('')
  const [newPin, setNewPin] = useState('')
  const [step, setStep] = useState('code') // code -> pin
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const checkCode = async () => {
    setError('')
    const lockKey = `recover_${user.id}`
    const waiting = lockRemaining(lockKey)
    if (waiting > 0) return setError(`Demasiados intentos. Espera ${formatWait(waiting)}.`)
    const ok = await usersRepo.verifyRecovery(user.id, code)
    if (!ok) {
      const wait = recordFail(lockKey)
      return setError(
        wait > 0 ? `Código incorrecto. Espera ${formatWait(wait)}.` : 'Código de recuperación incorrecto'
      )
    }
    clearFails(lockKey)
    setStep('pin')
  }

  const saveNewPin = async () => {
    if (newPin.length < 4) return setError('El PIN debe tener al menos 4 dígitos')
    setBusy(true)
    await usersRepo.setPin(user.id, newPin)
    await onDone(newPin) // inicia sesion con el PIN nuevo
  }

  return (
    <>
      <button className="link-back" onClick={onCancel}>← Volver</button>
      <h2>Recuperar PIN</h2>
      {step === 'code' && (
        <>
          <p className="field-label">Escribe tu código de recuperación</p>
          <input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ABCD-EF12-34"
          />
          <button className="btn btn--primary btn--block" disabled={!code.trim()} onClick={checkCode}>
            Verificar
          </button>
        </>
      )}
      {step === 'pin' && (
        <>
          <p className="field-label">Crea tu nuevo PIN</p>
          <PinInput value={newPin} onChange={setNewPin} />
          <button className="btn btn--primary btn--block" disabled={newPin.length < 4 || busy} onClick={saveNewPin}>
            {busy ? 'Guardando…' : 'Guardar y entrar'}
          </button>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </>
  )
}
