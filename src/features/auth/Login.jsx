import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { usersRepo } from '../../repositories/usersRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { PinInput } from '../../components/PinInput'
import { ROLES } from '../../db/constants'
import { normalize } from '../../lib/search'
import { lockRemaining, recordFail, clearFails, formatWait } from '../../lib/lockout'

export function Login() {
  const { login } = useAuth()
  // SIN valor inicial a proposito: `undefined` = cargando, `[]` = de verdad no hay
  // ninguno. Con el `[]` de antes se pintaba "No hay usuarios activos" durante cada
  // arranque en frio, que en una app cuyo dato vive solo en el telefono es el susto
  // de "se borro todo".
  const users = useLiveQuery(() => usersRepo.listActive(), [])
  const [selected, setSelected] = useState(null)
  // Identificacion por nombre: el campo NO autentica, solo FILTRA en memoria la
  // lista que ya se carga. La lista arranca vacia, asi que abrir la app no enseña
  // a nadie. Al tocar una coincidencia se sigue llamando a login(u.id, pin)
  // exactamente igual que siempre: la autenticacion sigue siendo por id.
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
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
    // Se vuelve al estado en que no se ve a nadie: si no, "Cambiar usuario"
    // dejaria la lista anterior a la vista.
    setQuery('')
    setShowAll(false)
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

  const loading = users === undefined
  // Orden alfabetico ESTABLE: el repo devuelve por clave primaria (UUID), que es
  // un orden al azar y ademas distinto en cada telefono tras sincronizar, asi que
  // la memoria muscular del vendedor ("el mio es el tercero") no se sostenia.
  const all = [...(users || [])].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'))
  // El filtro es tolerante (sin acentos y por coincidencia parcial) porque es una
  // BUSQUEDA, no una comprobacion: quien acierta el nombre a medias igual se
  // encuentra, y el acierto final sigue siendo un toque sobre su id.
  const q = normalize(query)
  const matches = showAll ? all : (q ? all.filter((u) => normalize(u.name).includes(q)) : [])
  const sinCoincidencias = !!q && !showAll && matches.length === 0

  // UNA sola tarjeta con los dos campos del formulario (Usuario y PIN), como
  // cualquier pantalla de acceso: asi se lee de un golpe que esto es el login y que
  // lo primero es el nombre. El PIN se revela al elegir usuario (no se puede pedir
  // antes: el bloqueo por intentos y la recuperacion dependen de QUIEN es).
  return (
    <div className="screen screen--centered">
      <div className="card auth-card">
        <p className="brand brand--sm login-brand">MypiCuadre</p>
        {/* Con el teclado del PIN abierto la cabecera se compacta: si no, el boton
            "Entrar" se va DEBAJO del borde en un telefono de 640 px y hay que
            buscarlo con scroll (medido en captura). El subtitulo ya cumplio su
            trabajo -decir que lo primero es el nombre- cuando aun no hay usuario. */}
        <h1 className={`login-title ${selected ? 'login-title--compact' : ''}`}>Iniciar sesión</h1>

        {/* --- 1. Usuario ------------------------------------------------------ */}
        <div className="login-field">
          <span className="login-label">Usuario</span>
          {selected ? (
            // Ya elegido: se ve a nombre de quien se va a entrar, y se puede cambiar.
            <div className="login-picked">
              <span className="login-picked__name">{selected.name}</span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={backToList}>
                Cambiar
              </button>
            </div>
          ) : (
            <input
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); setShowAll(false) }}
              placeholder="Escribe tu nombre"
              autoComplete="off"
              spellCheck={false}
              disabled={loading || all.length === 0}
            />
          )}
        </div>

        {/* Coincidencias. La lista arranca VACIA: abrir la app no enseña a nadie. */}
        {!selected && (
          loading ? (
            <p className="muted">Cargando…</p>
          ) : all.length === 0 ? (
            <p className="muted">No hay usuarios activos.</p>
          ) : matches.length > 0 ? (
            <div className="user-list user-list--filtered">
              {matches.map((u) => (
                <button key={u.id} type="button" className="user-chip" onClick={() => setSelected(u)}>
                  <span className="user-chip__name">{u.name}</span>
                </button>
              ))}
            </div>
          ) : sinCoincidencias ? (
            <>
              <p className="muted">Ningún usuario coincide con «{query.trim()}».</p>
              {/* Salida de emergencia, y aparece SOLO cuando la busqueda ya fallo:
                  no enseña a nadie de entrada, pero nadie se queda fuera por no
                  recordar como se escribe su nombre. */}
              <button type="button" className="link-recover" onClick={() => setShowAll(true)}>
                Ver todos los usuarios
              </button>
            </>
          ) : (
            <p className="login-hint">Escribe tu nombre y entra con tu PIN</p>
          )
        )}

        {/* --- 2. PIN ---------------------------------------------------------- */}
        {selected && (
          <>
            <div className="login-field">
              <span className="login-label">PIN</span>
              <PinInput value={pin} onChange={setPin} />
            </div>
            <button
              className="btn btn--primary btn--block"
              disabled={pin.length < 4 || busy}
              onClick={() => tryLogin(pin)}
            >
              {busy ? 'Entrando...' : 'Entrar'}
            </button>
          </>
        )}

        {/* role="alert": sin el, "PIN incorrecto" y la espera por intentos fallidos
            son mudos para un lector de pantalla y el usuario no sabe por que no entra. */}
        {error && <p className="error" role="alert">{error}</p>}

        {selected && selected.role === ROLES.OWNER && (
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
      {error && <p className="error" role="alert">{error}</p>}
    </>
  )
}
