import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { usersRepo } from '../../repositories/usersRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { PinInput } from '../../components/PinInput'
import { ROLE_LABELS } from '../../db/constants'

export function Login() {
  const { login } = useAuth()
  const users = useLiveQuery(() => usersRepo.listActive(), [], [])
  const [selected, setSelected] = useState(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const tryLogin = async (nextPin) => {
    setBusy(true)
    setError('')
    const ok = await login(selected.id, nextPin)
    if (!ok) {
      setError('PIN incorrecto')
      setPin('')
    }
    setBusy(false)
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

  return (
    <div className="screen screen--centered">
      <div className="card auth-card">
        <button className="link-back" onClick={() => { setSelected(null); setPin(''); setError('') }}>
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
      </div>
    </div>
  )
}
