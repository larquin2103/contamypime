import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { usersRepo } from '../../repositories/usersRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { PinInput } from '../../components/PinInput'
import { ROLES, ROLE_LABELS } from '../../db/constants'

// Gestion de usuarios (solo dueno). Los usuarios nunca se borran: se desactivan.
export function UsersAdmin() {
  const { user, isOwner } = useAuth()
  const users = useLiveQuery(() => usersRepo.list(), [], [])
  const [showForm, setShowForm] = useState(false)

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
          + Nuevo
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
            {u.id !== user.id && (
              <button
                className="btn btn--ghost"
                onClick={() => usersRepo.setActive(u.id, !u.active)}
              >
                {u.active ? 'Desactivar' : 'Activar'}
              </button>
            )}
          </div>
        ))}
      </div>

      {showForm && <NewUserForm onClose={() => setShowForm(false)} />}
    </div>
  )
}

function NewUserForm({ onClose }) {
  const [name, setName] = useState('')
  const [role, setRole] = useState(ROLES.SELLER)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setError('')
    if (!name.trim()) return setError('Escribe un nombre')
    if (pin.length < 4) return setError('El PIN debe tener al menos 4 digitos')
    setBusy(true)
    try {
      await usersRepo.create({ name, role, pin })
      onClose()
    } catch (e) {
      setError('Error: ' + e.message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Nuevo usuario</h3>
        <label className="field">
          <span>Nombre</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Rol</span>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value={ROLES.SELLER}>{ROLE_LABELS[ROLES.SELLER]}</option>
            <option value={ROLES.OWNER}>{ROLE_LABELS[ROLES.OWNER]}</option>
          </select>
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
