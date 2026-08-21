import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { usersRepo } from '../../repositories/usersRepo'
import { shiftsRepo } from '../../repositories/shiftsRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { PinInput } from '../../components/PinInput'
import { ROLES, ROLE_LABELS } from '../../db/constants'
import { formatDateTime } from '../../lib/dates'
import { useEscapeClose } from '../../lib/useEscapeClose'

// Gestion de usuarios (solo dueño). Los usuarios nunca se borran: se desactivan.
// Tras sincronizar pueden aparecer duplicados (si se creo un dueño local antes
// de vincular); aqui se pueden desactivar, conservando siempre un dueño activo.
export function UsersAdmin() {
  const { user, isOwner } = useAuth()
  const users = useLiveQuery(() => usersRepo.list(), [], [])
  const [showForm, setShowForm] = useState(false)
  const [resetting, setResetting] = useState(null) // usuario al que se le resetea el PIN
  const [editing, setEditing] = useState(null) // usuario al que se le edita nombre/rol

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
                {/* Editar nombre (todos, incluido el dueño) y —si no es dueño— el rol. */}
                <button className="btn btn--ghost btn--sm" onClick={() => setEditing(u)}>
                  Editar
                </button>
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
      {editing && <EditUserForm user={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

// Edita NOMBRE y ROL de un usuario (Fase 8 - B2). El nombre se puede cambiar a
// cualquiera (incluido el dueño): es solo etiqueta, no la identidad del negocio.
// El ROL solo se ofrece si NO es dueño (su rol es intocable) y con destinos
// Vendedor / Administrativo / Elaboración (esta última solo con su módulo, o si
// el usuario ya la tiene, para poder sacarlo de ella). Sin PIN: basta confirmar,
// igual que desactivar un usuario o resetear su PIN. El cambio de ROL se BLOQUEA
// si el usuario tiene un turno abierto (el de NOMBRE no: es cosmético). Los
// cambios toman efecto cuando el usuario vuelve a entrar/recarga; el rol queda
// registrado en auditoría (setRole).
function EditUserForm({ user, onClose }) {
  const { user: actor } = useAuth()
  const { hasModule } = useLicense()
  const [name, setName] = useState(user.name)
  const [role, setRole] = useState(user.role)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEscapeClose(onClose)

  const canRole = user.role !== ROLES.OWNER
  // Turno abierto del usuario (reactivo): si lo tiene, no se permite CAMBIAR EL ROL.
  const openShift = useLiveQuery(
    () => (canRole ? shiftsRepo.getActiveFor(user.id) : Promise.resolve(null)),
    [user.id, canRole],
    undefined
  )
  const roleBlocked = canRole && !!openShift

  // Destinos posibles. Elaboración solo con su módulo (o si el usuario ya lo es,
  // para permitir moverlo FUERA de ese rol aunque el módulo se haya apagado).
  const roleOptions = [ROLES.SELLER, ROLES.ADMIN]
  if (hasModule(LICENSE_MODULES.ELABORATION) || user.role === ROLES.ELABORATION) {
    roleOptions.push(ROLES.ELABORATION)
  }
  // Cocinero solo con el módulo 'cocina' (o si el usuario ya lo es, para poder
  // sacarlo de ese rol aunque el módulo se haya apagado).
  if (hasModule(LICENSE_MODULES.KITCHEN) || user.role === ROLES.COOK) {
    roleOptions.push(ROLES.COOK)
  }
  // Mensajero solo con el módulo 'remesas' (o si el usuario ya lo es, para poder
  // sacarlo de ese rol aunque el módulo se haya apagado).
  if (hasModule(LICENSE_MODULES.REMESAS) || user.role === ROLES.COURIER) {
    roleOptions.push(ROLES.COURIER)
  }

  const cleanName = name.trim()
  const nameChanged = cleanName.length > 0 && cleanName !== user.name
  const roleChanged = canRole && role !== user.role
  const canSave = !busy && (nameChanged || roleChanged) && !!cleanName

  const save = async () => {
    setError('')
    if (!cleanName) return setError('Escribe un nombre')
    if (!nameChanged && !roleChanged) return
    // El cambio de ROL exige que no haya turno abierto (chequeo AUTORITATIVO por
    // si la consulta reactiva aún carga). El de NOMBRE nunca se bloquea.
    if (roleChanged) {
      const shift = await shiftsRepo.getActiveFor(user.id)
      if (shift) return setError('Tiene un turno abierto: ciérralo o fuérzalo antes de cambiar el rol. (Puedes cambiar solo el nombre dejando el rol igual.)')
    }
    const parts = []
    if (nameChanged) parts.push(`nombre a "${cleanName}"`)
    if (roleChanged) parts.push(`rol a ${ROLE_LABELS[role]}`)
    if (!confirm(`¿Cambiar ${parts.join(' y ')} de "${user.name}"?`)) return
    setBusy(true)
    try {
      if (nameChanged) await usersRepo.setName(user.id, cleanName)
      if (roleChanged) await usersRepo.setRole(user.id, role, { actorId: actor.id })
      onClose()
    } catch (e) {
      setError('Error: ' + e.message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Editar ${user.name}`} onClick={(e) => e.stopPropagation()}>
        <h3>Editar — {user.name}</h3>

        <label className="field">
          <span>Nombre</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        {canRole ? (
          <>
            <label className="field">
              <span>Rol</span>
              <select value={role} onChange={(e) => setRole(e.target.value)} disabled={roleBlocked}>
                {roleOptions.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </label>
            {roleBlocked && (
              <p className="error">
                Tiene un <strong>turno abierto</strong>: para cambiar el rol, ciérralo o fuérzalo antes
                (el nombre sí puedes cambiarlo).
              </p>
            )}
            {roleChanged && role === ROLES.ADMIN && (
              <p className="muted">
                Como <strong>administrativo</strong> verá reportes, costos y el panel del dueño, y podrá
                autorizar al vendedor, forzar cierres y aprobar conteos. No gestiona usuarios, licencia ni sincronización.
              </p>
            )}
            {roleChanged && role === ROLES.ELABORATION && (
              <p className="muted">
                Operará solo el <strong>centro de elaboración</strong>; no verá el almacén central ni los datos del dueño.
              </p>
            )}
            {roleChanged && role === ROLES.COOK && (
              <p className="muted">
                Operará solo el <strong>tablero de cocina</strong> (elaborar y enviar a las áreas); no verá el almacén central, ni costos, ni los datos del dueño.
              </p>
            )}
            {roleChanged && role === ROLES.SELLER && (
              <p className="muted">
                Como <strong>vendedor</strong> solo vende en su turno; no ve costos ni datos del dueño.
              </p>
            )}
            {roleChanged && role === ROLES.COURIER && (
              <p className="muted">
                Como <strong>mensajero</strong> solo gestiona sus remesas asignadas (recibe efectivo en
                custodia, entrega al beneficiario y devuelve lo que sobre); no vende, no abre turno ni ve el negocio.
              </p>
            )}
          </>
        ) : (
          <p className="muted">
            Es el <strong>dueño</strong>: su rol no se cambia (identidad del negocio). Solo el nombre.
          </p>
        )}

        <p className="muted">
          <small>Los cambios toman efecto cuando el usuario vuelva a iniciar sesión o recargue la app.</small>
        </p>
        {error && <p className="error">{error}</p>}

        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" disabled={!canSave} onClick={save}>
            {busy ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Crea VENDEDORES o ADMINISTRATIVOS (el dueño es unico, definido en el onboarding).
function NewUserForm({ onClose }) {
  const { hasModule } = useLicense()
  const [name, setName] = useState('')
  const [role, setRole] = useState(ROLES.SELLER)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEscapeClose(onClose)

  const save = async () => {
    setError('')
    if (!name.trim()) return setError('Escribe un nombre')
    if (pin.length < 4) return setError('El PIN debe tener al menos 4 dígitos')
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
      <div className="modal" role="dialog" aria-modal="true" aria-label="Nuevo usuario" onClick={(e) => e.stopPropagation()}>
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
            {hasModule(LICENSE_MODULES.ELABORATION) && (
              <option value={ROLES.ELABORATION}>{ROLE_LABELS[ROLES.ELABORATION]}</option>
            )}
            {hasModule(LICENSE_MODULES.KITCHEN) && (
              <option value={ROLES.COOK}>{ROLE_LABELS[ROLES.COOK]}</option>
            )}
            {hasModule(LICENSE_MODULES.REMESAS) && (
              <option value={ROLES.COURIER}>{ROLE_LABELS[ROLES.COURIER]}</option>
            )}
          </select>
        </label>
        {role === ROLES.ELABORATION && (
          <p className="muted">
            Opera solo el <strong>centro de elaboración</strong>: transforma productos, hace salidas
            a los puntos de venta y vende desde el centro. No ve el almacén central ni los datos del dueño.
          </p>
        )}
        {role === ROLES.ADMIN && (
          <p className="muted">
            El administrativo opera como el dueño en inventario y supervisión (entradas,
            salidas, autorizar al vendedor, forzar cierres, aprobar conteos) y ve reportes y
            costos. No gestiona usuarios, licencia ni sincronización.
          </p>
        )}
        {role === ROLES.COOK && (
          <p className="muted">
            Opera solo el <strong>tablero de cocina</strong>: elabora recetas y las envía a las
            áreas de venta. No ve el almacén central, ni costos, ni los datos del dueño.
          </p>
        )}
        {role === ROLES.COURIER && (
          <p className="muted">
            Opera solo sus <strong>remesas asignadas</strong>: recibe efectivo en custodia, lo
            entrega al beneficiario y devuelve lo que sobre. No vende, no abre turno ni ve el negocio.
          </p>
        )}
        <p className="field-label">PIN (4 a 6 dígitos)</p>
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
  useEscapeClose(onClose)

  const save = async () => {
    if (pin.length < 4) return
    setBusy(true)
    await usersRepo.setPin(user.id, pin)
    setSaved(true)
    setTimeout(onClose, 900)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Resetear PIN de ${user.name}`} onClick={(e) => e.stopPropagation()}>
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
