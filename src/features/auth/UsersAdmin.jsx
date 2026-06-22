import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { usersRepo } from '../../repositories/usersRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { PinInput } from '../../components/PinInput'
import { ROLES, ROLE_LABELS } from '../../db/constants'

// Gestion de usuarios (solo dueno). Los usuarios nunca se borran: se desactivan.
// Jerarquia unica: el dueno es uno solo; aqui solo se crean vendedores.
export function UsersAdmin() {
  const { user, isOwner } = useAuth()
  const users = useLiveQuery(() => usersRepo.list(), [], [])
  const [showForm, setShowForm] = useState(false)
  const [resetting, setResetting] = useState(null) // usuario al que se le resetea el PIN

  if (!isOwner) {
    return (
      <div className="screen">
        <h2>Usuarios</h2>
        <p className="muted">Solo el dueno puede gestionar usuarios.</p>
      </div>
    )
  }

  return (
    <div className="screen">
      <div className="screen__header">
        <h2>Usuarios</h2>
        <button className="btn btn--primary" onClick={() => setShowForm(true)}>
          + Vendedor
        </button>
      </div>

      <div className="list">
        {users.map((u) => (
          <div key={u.id} className={`list-item ${u.active ? '' : 'is-inactive'}`}>
            <div>
              <strong>{u.name}</strong>
              <span className="badge">{ROLE_LABELS[u.role]}</span>
              {!u.active && <span className="badge badge--muted">Inactivo</span>}
            </div>
            <div className="item-actions">
              <button className="btn btn--ghost btn--sm" onClick={() => setResetting(u)}>
                PIN
              </button>
              {u.id !== user.id && u.role !== ROLES.OWNER && (
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => usersRepo.setActive(u.id, !u.active)}
                >
                  {u.active ? 'Desactivar' : 'Activar'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {showForm && <NewUserForm onClose={() => setShowForm(false)} />}
      {resetting && <ResetPinForm user={resetting} onClose={() => setResetting(null)} />}
    </div>
  )
}

// Solo crea VENDEDORES (el dueno es unico, definido en el onboarding).
function NewUserForm({ onClose }) {
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setError('')
    if (!name.trim()) return setError('Escribe un nombre')
    if (pin.length < 4) return setError('El PIN debe tener al menos 4 digitos')
    setBusy(true)
    try {
      await usersRepo.create({ name, role: ROLES.SELLER, pin })
      onClose()
    } catch (e) {
      setError('Error: ' + e.message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Nuevo vendedor</h3>
        <label className="field">
          <span>Nombre</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <p className="field-label">PIN (4 a 6 digitos)</p>
        <PinInput value={pin} onChange={setPin} />
        {error && <p className="error">{error}</p>}
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn--primary" disabled={busy} onClick={save}>
            {busy ? 'Guardando...' : 'Crear'}
          </button>
        </div>
      </div>
    </div>
  )
}

// El dueno resetea el PIN de cualquier usuario (incluido el suyo).
function ResetPinForm({ user, onClose }) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  const save = async () => {
    if (pin.length < 4) return
    setBusy(true)
    await usersRepo.setPin(user.id, pin)
    setSaved(true)
    setTimeout(onClose, 900)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Resetear PIN — {user.name}</h3>
        <p className="muted">Define un nuevo PIN para este usuario.</p>
        <PinInput value={pin} onChange={setPin} />
        {saved && <p className="ok-text">✓ PIN actualizado</p>}
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn--primary" disabled={pin.length < 4 || busy} onClick={save}>
            {busy ? 'Guardando...' : 'Guardar PIN'}
          </button>
        </div>
      </div>
    </div>
  )
}
