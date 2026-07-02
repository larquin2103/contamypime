import { useRef, useState, useEffect } from 'react'
import { usersRepo } from '../../repositories/usersRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { PinInput } from '../../components/PinInput'
import { ROLES } from '../../db/constants'
import { genRecoveryCode } from '../../lib/pin'
import { parseSnapshot, applySnapshot } from '../handoff/handoffService'
import { isFirebaseConfigured } from '../../lib/firebase'
import { linkDevice } from '../sync/syncService'
import { initialPull } from '../sync/syncEngine'
import { useSync } from '../../app/providers/SyncProvider'

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
  const fileRef = useRef(null)

  // Un telefono nuevo arranca vacio. Si el vendedor recibio un turno por
  // WhatsApp, al cargarlo obtiene los usuarios y el catalogo, y luego puede
  // iniciar sesion. (Al aplicar, el conteo de usuarios sube y la app pasa al login.)
  const receiveTurno = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setBusy(true)
    try {
      const snap = parseSnapshot(await file.text())
      await applySnapshot(snap)
      // No hace falta navegar: el conteo de usuarios cambia y aparece el login.
    } catch (err) {
      setError(err.message)
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // Validamos y mostramos el codigo, pero AUN no creamos el usuario: si lo
  // creamos aqui, el conteo de usuarios pasa a 1 y la app saltaria al login,
  // ocultando el codigo de recuperacion. Se crea al confirmar "Ya lo guarde".
  const submit = () => {
    setError('')
    if (pin.length < 4) return setError('El PIN debe tener al menos 4 dígitos')
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
        <p className="muted">Configuración inicial — crea la cuenta del dueño</p>

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

            <div className="auth-divider"><span>o</span></div>
            <p className="muted">¿Eres vendedor y te enviaron un turno?</p>
            <button
              className="btn btn--block"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? 'Recibiendo…' : '🔄 Recibir turno (archivo)'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              onChange={receiveTurno}
              style={{ display: 'none' }}
            />

            <CloudLinkInline />
          </>
        )}

        {step === 'pin' && (
          <>
            <p className="field-label">Crea un PIN (4 a 6 dígitos)</p>
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
            <p className="field-label">Tu código de recuperación</p>
            <p className="muted">
              Guárdalo en un lugar seguro. Es la única forma de recuperar tu PIN si lo olvidas.
            </p>
            <div className="recovery-code">{recovery}</div>
            <button className="btn btn--primary btn--block" onClick={finish}>
              Ya lo guardé — entrar
            </button>
          </>
        )}

        {error && <p className="error">{error}</p>}
      </div>
    </div>
  )
}

// Alta de un dispositivo nuevo desde la nube: el vendedor inicia sesion con la
// cuenta del negocio y, al vincularse, la sincronizacion baja los usuarios y el
// catalogo. En cuanto llegan los usuarios, la app pasa sola al login.
function CloudLinkInline() {
  const { refresh } = useSync()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [slow, setSlow] = useState(false)

  // Si tras vincular tarda demasiado en llegar la lista de usuarios, avisamos
  // y ofrecemos reintentar (no dejar la pantalla colgada sin salida).
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setSlow(true), 12000)
    return () => clearTimeout(t)
  }, [done])

  if (!isFirebaseConfigured()) return null

  const submit = async () => {
    setError('')
    if (!email.trim() || !password) return setError('Escribe correo y contraseña.')
    setBusy(true)
    try {
      await linkDevice({ email, password })
      await refresh() // arranca la sync en vivo
      // Descarga inicial fiable (getDocs); si falla, mostramos el error real.
      const res = await initialPull()
      if (!res.ok) {
        setError('Vinculado, pero no se pudieron descargar los datos: ' + res.reason)
        setBusy(false)
        return
      }
      if (res.total === 0) {
        setError('Vinculado, pero la cuenta de la nube esta vacia. ¿Subiste los datos desde el otro dispositivo, y usaste el mismo correo?')
        setBusy(false)
        return
      }
      setDone(true) // ya hay usuarios -> el router pasa al login
    } catch (e) {
      setError('No se pudo descargar: ' + (e?.code || e?.message || e))
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="cloud-link">
        <p className="ok-text">Dispositivo vinculado. Descargando datos del negocio…</p>
        <p className="muted"><small>En unos segundos aparecerá la lista de usuarios para entrar.</small></p>
        {slow && (
          <>
            <p className="muted">
              <small>
                Está tardando. Verifica que tengas internet y que el otro dispositivo ya haya
                subido los datos (en él: ☁️ Sincronización → Sincronizar ahora).
              </small>
            </p>
            <button className="btn btn--block" onClick={() => window.location.reload()}>
              Reintentar
            </button>
          </>
        )}
      </div>
    )
  }

  if (!open) {
    return (
      <button className="btn btn--block" onClick={() => setOpen(true)}>
        ☁️ Vincular a la nube del negocio
      </button>
    )
  }

  return (
    <div className="cloud-link">
      <p className="muted">Inicia sesión con la cuenta de nube del negocio (la creó el dueño).</p>
      <label className="field">
        <span>Correo del negocio</span>
        <input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="field">
        <span>Contraseña</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="btn btn--primary btn--block" disabled={busy} onClick={submit}>
        {busy ? 'Vinculando…' : 'Vincular y descargar'}
      </button>
    </div>
  )
}
