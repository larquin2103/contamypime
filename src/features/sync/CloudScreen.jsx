import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../app/providers/AuthProvider'
import { useSync } from '../../app/providers/SyncProvider'
import { isFirebaseConfigured } from '../../lib/firebase'
import {
  observeAuth,
  createBusinessAccount,
  linkDevice,
  unlinkDevice
} from './syncService'
import { syncNow, initialPull } from './syncEngine'

export function CloudScreen() {
  const { isOwner } = useAuth()
  const { refresh } = useSync()
  const [cloudUser, setCloudUser] = useState(undefined) // undefined = cargando
  const [mode, setMode] = useState('link') // 'create' | 'link'
  const [form, setForm] = useState({ email: '', password: '', businessName: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  useEffect(() => {
    let unsub = null
    let active = true
    observeAuth((u) => {
      if (active) setCloudUser(u)
    }).then((fn) => {
      unsub = fn
    })
    return () => {
      active = false
      if (unsub) unsub()
    }
  }, [])

  if (!isOwner) {
    return (
      <div className="screen">
        <h2>Sincronización</h2>
        <p className="muted">Solo el dueño configura la cuenta de nube del negocio.</p>
        <Link className="btn btn--primary btn--block" to="/">Volver</Link>
      </div>
    )
  }

  if (!isFirebaseConfigured()) {
    return (
      <div className="screen">
        <h2>Sincronización</h2>
        <p className="error">Falta la configuración de Firebase en este build.</p>
      </div>
    )
  }

  const upd = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async () => {
    setError('')
    setOk('')
    if (!form.email.trim() || !form.password) {
      setError('Escribe correo y contraseña.')
      return
    }
    setBusy(true)
    try {
      if (mode === 'create') {
        await createBusinessAccount(form)
        setOk('Cuenta del negocio creada y este dispositivo vinculado.')
      } else {
        await linkDevice(form)
        setOk('Dispositivo vinculado a la cuenta del negocio.')
      }
      setForm({ email: '', password: '', businessName: '' })
      await refresh()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const doSync = async () => {
    setError('')
    setOk('')
    setBusy(true)
    try {
      const { up } = await syncNow() // sube lo local
      const down = await initialPull() // y baja de la nube (getDocs, fiable)
      if (!down.ok) {
        setError('Subida: ' + up.queued + '. Bajada fallo: ' + down.reason)
      } else {
        setOk(`Sincronizado: ${up.queued} enviado(s), ${down.total} recibido(s) de la nube.`)
      }
    } catch (e) {
      setError('No se pudo sincronizar: ' + (e?.code || e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  const doUnlink = async () => {
    if (!confirm('¿Desvincular este dispositivo de la nube? Los datos locales se conservan.')) return
    setBusy(true)
    try {
      await unlinkDevice()
      await refresh()
      setOk('Dispositivo desvinculado. Los datos locales siguen intactos.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <h2>Sincronización</h2>
      <p className="muted">
        Conecta este dispositivo a la cuenta de nube del negocio para sincronizar entre
        teléfonos cuando haya internet. Sin conexión la app sigue funcionando igual.
      </p>

      {cloudUser === undefined && <p className="muted">Comprobando estado…</p>}

      {cloudUser && (
        <section className="card">
          <h3>✅ Dispositivo vinculado</h3>
          <p className="muted">Cuenta del negocio:</p>
          <p><strong>{cloudUser.email}</strong></p>
          <p className="muted"><small>ID del negocio: {cloudUser.uid}</small></p>
          <button className="btn btn--primary btn--block" disabled={busy} onClick={doSync}>
            {busy ? 'Sincronizando…' : '🔄 Sincronizar ahora'}
          </button>
          <button className="btn btn--block" disabled={busy} onClick={doUnlink}>
            Desvincular este dispositivo
          </button>
        </section>
      )}

      {cloudUser === null && (
        <>
          <div className="seg">
            <button
              className={`seg__btn ${mode === 'link' ? 'seg__btn--on' : ''}`}
              onClick={() => { setMode('link'); setError('') }}
            >
              Vincular dispositivo
            </button>
            <button
              className={`seg__btn ${mode === 'create' ? 'seg__btn--on' : ''}`}
              onClick={() => { setMode('create'); setError('') }}
            >
              Crear cuenta del negocio
            </button>
          </div>

          <section className="card">
            <h3>{mode === 'create' ? 'Crear cuenta del negocio' : 'Vincular este dispositivo'}</h3>
            <p className="muted">
              {mode === 'create'
                ? 'Solo la primera vez, en el dispositivo del dueño. Crea la cuenta única del negocio.'
                : 'Inicia sesión con la cuenta del negocio ya creada (el mismo correo y contraseña en cada teléfono).'}
            </p>

            {mode === 'create' && (
              <label className="field">
                <span>Nombre del negocio</span>
                <input value={form.businessName} onChange={upd('businessName')} placeholder="Mi tienda" />
              </label>
            )}
            <label className="field">
              <span>Correo del negocio</span>
              <input
                type="email"
                inputMode="email"
                autoComplete="username"
                value={form.email}
                onChange={upd('email')}
                placeholder="correo@ejemplo.com"
              />
            </label>
            <label className="field">
              <span>Contraseña {mode === 'create' && '(mínimo 6 caracteres)'}</span>
              <input
                type="password"
                autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
                value={form.password}
                onChange={upd('password')}
              />
            </label>

            {error && <p className="error">{error}</p>}
            <button className="btn btn--primary btn--block" disabled={busy} onClick={submit}>
              {busy ? 'Conectando…' : mode === 'create' ? 'Crear y vincular' : 'Vincular dispositivo'}
            </button>
            <p className="muted">
              <small>Necesitas internet solo para este primer paso. Después funciona offline.</small>
            </p>
          </section>
        </>
      )}

      {ok && <p className="ok-text">{ok}</p>}
    </div>
  )
}
