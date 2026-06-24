import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../app/providers/AuthProvider'
import { useSync } from '../../app/providers/SyncProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { isFirebaseConfigured } from '../../lib/firebase'
import {
  observeAuth,
  createBusinessAccount,
  linkDevice,
  unlinkDevice
} from './syncService'
import { syncNow, initialPull } from './syncEngine'
import { listDevices, removeDevice, getDeviceId } from './deviceRegistry'

export function CloudScreen() {
  const { isOwner } = useAuth()
  const { refresh } = useSync()
  const license = useLicense()
  const maxDevices = Number(license.payload?.maxDispositivos || 0)
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
        await createBusinessAccount({ ...form, maxDevices })
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

      {cloudUser && <DevicesPanel maxDevices={maxDevices} />}

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

// Panel de dispositivos vinculados al negocio (límite de la licencia).
function DevicesPanel({ maxDevices }) {
  const [devices, setDevices] = useState(undefined) // undefined = cargando
  const [thisId, setThisId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const [list, id] = await Promise.all([listDevices(), getDeviceId()])
      setDevices(list)
      setThisId(id)
    } catch (e) {
      setError('No se pudo leer la lista (¿sin conexión?): ' + (e?.code || e?.message || e))
      setDevices([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  const remove = async (deviceId) => {
    if (deviceId === thisId) {
      if (!confirm('Este es el dispositivo actual. ¿Quitarlo de la lista? Seguirá funcionando hasta que lo desvincules.')) return
    } else if (!confirm('¿Quitar este dispositivo? Liberará una plaza del límite.')) return
    setBusy(true)
    try {
      await removeDevice(deviceId)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const fmt = (ts) => {
    const s = ts?.seconds
    if (!s) return ''
    try { return new Date(s * 1000).toLocaleDateString('es-CU') } catch { return '' }
  }

  return (
    <section className="card">
      <h3>Dispositivos vinculados</h3>
      <p className="muted">
        {maxDevices > 0
          ? `Plan con límite de ${maxDevices} dispositivo(s).`
          : 'Sin límite de dispositivos en esta licencia.'}
        {devices !== undefined && ` Activos: ${devices.length}${maxDevices > 0 ? ' / ' + maxDevices : ''}.`}
      </p>

      {devices === undefined && <p className="muted">Cargando…</p>}
      {devices && devices.length === 0 && <p className="muted">Aún no hay dispositivos registrados.</p>}

      {devices && devices.map((d) => (
        <div key={d.id} className="rate-row">
          <div className="rate-row__info">
            <strong>{d.name || 'Dispositivo'}{d.id === thisId ? ' (este)' : ''}</strong>
            <span className="muted"><small>Vinculado: {fmt(d.linkedAt) || '—'}</small></span>
          </div>
          <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => remove(d.id)}>
            Quitar
          </button>
        </div>
      ))}

      {error && <p className="error">{error}</p>}
      <button className="btn btn--block" disabled={busy} onClick={load}>Actualizar lista</button>
    </section>
  )
}
