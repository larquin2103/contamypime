import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../app/providers/AuthProvider'
import { useSync } from '../../app/providers/SyncProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { isFirebaseConfigured } from '../../lib/firebase'
import { PasswordInput } from '../../components/PasswordInput'
import {
  observeAuth,
  createBusinessAccount,
  linkDevice,
  unlinkDevice
} from './syncService'
import { syncNow, initialPull } from './syncEngine'
import { listDevices, removeDevice, getDeviceId } from './deviceRegistry'
import { countResend, forceResend } from './pushEngine'
import { RESENDABLE, localInputToIso } from './resend'

export function CloudScreen() {
  const { isOwner } = useAuth()
  // `enabled` ya es el valor VIVO que SyncProvider deriva de syncConfig.isEnabled()
  // (Ronda 1, hallazgo C): reusarlo evita una segunda lectura y un segundo estado
  // que pudiera desincronizarse del que ya muestra el resto de la pantalla.
  const { refresh, enabled: syncEnabled } = useSync()
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

      {cloudUser && syncEnabled && <ResendPanel />}

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
              <PasswordInput
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

// Etiquetas de las cuatro colecciones inmutables reenviables (auditoria Burger
// Premium, H3-a). El orden sigue el de RESENDABLE.
const RESEND_LABELS = {
  stockMovements: 'Libro de existencias',
  productions: 'Producciones',
  purchases: 'Entradas',
  transfers: 'Salidas del almacén'
}

// Ronda 1 (hallazgo A): `forceResend` reusa `pushChanges`, que puede terminar
// SIN subir nada por una razon ajena al reenvio (no confundir con "0 filas
// desde esa fecha", que ya se ve al Contar). Traduce el `skipped` de `doPush`
// a una frase honesta en español; nunca se pinta como si hubiera funcionado.
const RESEND_SKIP_REASONS = {
  disabled: 'La sincronización está desactivada en este aparato.',
  'no-business': 'Este aparato no tiene un negocio vinculado a la nube.',
  'no-auth': 'No hay sesión abierta con la nube en este aparato.'
}

// Panel «Reenviar a la nube»: repara el dano ya hecho por el cursor que nunca
// retrocede (H3-a). Solo reparacion manual, con el dueno confirmando cuanto
// va a gastar de la cuota antes de disparar el reenvio.
function ResendPanel() {
  const [col, setCol] = useState(RESENDABLE[0])
  const [when, setWhen] = useState('')
  const [sinceIso, setSinceIso] = useState(null)
  const [count, setCount] = useState(null) // null = aun no contado
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  const resetCount = () => {
    setCount(null)
    setSinceIso(null)
    setOk('')
  }

  const changeCol = (e) => { setCol(e.target.value); resetCount(); setError('') }
  const changeWhen = (e) => { setWhen(e.target.value); resetCount(); setError('') }

  const doCount = async () => {
    setError('')
    setOk('')
    setBusy(true)
    try {
      const iso = localInputToIso(when)
      if (!iso) throw new Error('Escribe una fecha válida.')
      const n = await countResend(col, iso)
      setSinceIso(iso)
      setCount(n)
    } catch (e) {
      setError(e.message)
      setCount(null)
      setSinceIso(null)
    } finally {
      setBusy(false)
    }
  }

  const doResend = async () => {
    setError('')
    setOk('')
    setBusy(true)
    try {
      const res = await forceResend(col, sinceIso)
      // Ronda 1 (hallazgo A): `res.skipped` significa que doPush NO subio nada
      // (sync apagada / sin negocio / sin sesion) — eso NO es un reenvio exitoso,
      // aunque el retroceso del cursor sí se haya guardado.
      if (res.skipped) {
        setError(RESEND_SKIP_REASONS[res.skipped] || `No se pudo completar la subida: ${res.skipped}.`)
        return
      }
      // Ronda 1 (hallazgo A): `res.queued` es el total de ESTA pasada de subida
      // en las 34 colecciones (no solo la elegida aquí), y las filas quedan
      // ENCOLADAS (los commits son fire-and-forget: no hay confirmación del
      // servidor todavía). No se puede decir "reenviadas" sin mentir.
      let msg = `Encoladas para subir: ${res.queued} fila(s) en esta pasada (todas las colecciones). ` +
        'Se entregan a la nube cuando haya conexión.'
      // Ronda 1 (hallazgo B): si no hizo falta retroceder el cursor (ya cubría
      // la fecha pedida), decirlo: lo que corrió fue una subida normal, no un
      // reenvio de verdad.
      if (!res.rewound) {
        msg += ' No hizo falta retroceder: la subida ya cubría esa fecha. Se lanzó una subida normal.'
      }
      setOk(msg)
      setCount(null)
      setSinceIso(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h3>Reenviar a la nube</h3>
      <label className="field">
        <span>Colección</span>
        <select value={col} onChange={changeCol}>
          {RESENDABLE.map((name) => (
            <option key={name} value={name}>{RESEND_LABELS[name] || name}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Desde</span>
        <input type="datetime-local" value={when} onChange={changeWhen} />
      </label>

      <button className="btn btn--block" disabled={busy} onClick={doCount}>
        Contar
      </button>

      {count !== null && sinceIso && (
        <p className="muted">
          Se reenviarán {count} filas desde el {new Date(sinceIso).toLocaleString('es')}. Gasta {count}{' '}
          escrituras de la cuota de Firestore, y puede gastar lecturas en los demás aparatos
          conectados (no está medido).
        </p>
      )}

      <button
        className="btn btn--primary btn--block"
        disabled={busy || count === null || count <= 0}
        onClick={doResend}
      >
        {count ? `Reenviar ${count} filas` : 'Reenviar filas'}
      </button>

      {error && <p className="error">{error}</p>}
      {ok && <p className="ok-text">{ok}</p>}

      <p className="muted">
        <small>
          Úsalo solo en el aparato que tiene las filas que faltan en los demás. Reenviar lo mismo dos
          veces no duplica nada.
        </small>
      </p>
    </section>
  )
}
