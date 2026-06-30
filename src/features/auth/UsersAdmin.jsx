import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { usersRepo } from '../../repositories/usersRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { PinInput } from '../../components/PinInput'
import { ROLES, ROLE_LABELS } from '../../db/constants'
import { formatDateTime } from '../../lib/dates'

// Gestion de usuarios (solo dueño). Los usuarios nunca se borran: se desactivan.
// Tras sincronizar pueden aparecer duplicados (si se creo un dueño local antes
// de vincular); aqui se pueden desactivar, conservando siempre un dueño activo.
export function UsersAdmin() {
  const { user, isOwner } = useAuth()
  const users = useLiveQuery(() => usersRepo.list(), [], [])
  const [showForm, setShowForm] = useState(false)
  const [resetting, setResetting] = useState(null) // usuario al que se le resetea el PIN

  if (!isOwner) {
    return (
      <div className="screen">
        <h2>Usuarios</h2>
        <p className="muted">Solo el dueño puede gestionar usuarios.</p>
      </div>
    )
  }

  const activeOwners = users.filter((u) => u.role === ROLES.OWNER && u.active).length
  const hasDuplicates = users.filter((u) => u.active).length > new Set(
    users.filter((u) => u.active).map((u) => `${u.role}:${u.name.trim().toLowerCase()}`)
  ).size

  const toggle = (u) => {
    if (u.active && u.role === ROLES.OWNER) {
      if (!confirm(`¿Desactivar al dueño "${u.name}"? Úsalo solo para quitar un duplicado; conserva el dueño correcto.`)) return
    }
    usersRepo.setActive(u.id, !u.active)
  }

  return (
    <div className="screen">
      <div className="screen__header">
        <h2>Usuarios</h2>
        <button className="btn btn--primary" onClick={() => setShowForm(true)}>
          + Usuario
        </button>
      </div>

      {hasDuplicates && (
        <p className="muted" style={{ marginBottom: 10 }}>
          Hay usuarios con el mismo nombre. Si son <strong>duplicados de la sincronización</strong>,
          desactiva los sobrantes (deja activo el que usas para entrar en cada dispositivo).
        </p>
      )}

      <div className="list">
        {users.map((u) => {
          // Se puede alternar si no eres tu mismo y no dejas al negocio sin dueño.
          const canToggle = u.id !== user.id && !(u.role === ROLES.OWNER && u.active && activeOwners <= 1)
          return (
            <div key={u.id} className={`list-item ${u.active ? '' : 'is-inactive'}`}>
              <div>
                <strong>{u.name}</strong>
                <span className="badge">{ROLE_LABELS[u.role]}</span>
                {!u.active && <span className="badge badge--muted">Inactivo</span>}
                {u.id === user.id && <span className="badge badge--muted">Tú</span>}
                <br />
                <span className="muted"><small>#{u.id.slice(0, 6)} · creado {formatDateTime(u.createdAt)}</small></span>
              </div>
              <div className="item-actions">
                <button className="btn btn--ghost btn--sm" onClick={() => setResetting(u)}>
                  PIN
                </button>
                {canToggle && (
                  <button className="btn btn--ghost btn--sm" onClick={() => toggle(u)}>
                    {u.active ? 'Desactivar' : 'Activar'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {showForm && <NewUserForm onClose={() => setShowForm(false)} />}
      {resetting && <ResetPinForm user={resetting} onClose={() => setResetting(null)} />}
    </div>
  )
}

// Crea VENDEDORES o ADMINISTRATIVOS (el dueño es unico, definido en el onboarding).
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
            <option value={ROLES.ADMIN}>{ROLE_LABELS[ROLES.ADMIN]}</option>
          </select>
        </label>
        {role === ROLES.ADMIN && (
          <p className="muted">
            El administrativo opera como el dueño en inventario y supervisión (entradas,
            salidas, autorizar al vendedor, forzar cierres, aprobar conteos) y ve reportes y
            costos. No gestiona usuarios, licencia ni sincronización.
          </p>
        )}
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

// El dueño resetea el PIN de cualquier usuario (incluido el suyo).
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
