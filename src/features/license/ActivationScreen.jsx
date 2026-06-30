import { useState } from 'react'
import { useLicense } from '../../app/providers/LicenseProvider'

// Mensajes segun por que fallo el codigo (motivos de verifyLicense/evaluate).
const REASON_MSG = {
  formato: 'El código no tiene el formato correcto. Cópialo completo.',
  firma: 'El código no es válido (la firma no coincide).',
  error: 'No se pudo leer el código. Revísalo e inténtalo de nuevo.'
}

// ---------------------------------------------------------------------------
// Fase 5 - Bloque 28: pantalla de activacion. Es la COMPUERTA: mientras no haya
// una licencia valida, el router muestra esto y NO deja crear el dueño ni entrar.
// Sirve tanto para la primera activacion como para renovar una caducada.
// ---------------------------------------------------------------------------
export function ActivationScreen() {
  const { status, payload, activate } = useLicense()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const expired = status === 'expired'

  const submit = async () => {
    setBusy(true)
    setError('')
    const res = await activate(code)
    if (!res.ok) {
      if (res.status === 'expired') {
        setError('Esa licencia ya caducó. Pide una nueva al proveedor.')
      } else if (res.status === 'mismatch') {
        setError(`Error: ${res.detail}. Pide una licencia para el negocio correcto.`)
      } else {
        setError(REASON_MSG[res.reason] || 'El código no es válido.')
      }
    }
    // Si fue ok, el token cambia en config y el router deja pasar solo.
    setBusy(false)
  }

  return (
    <div className="screen screen--centered">
      <div className="card auth-card">
        <h1 className="brand">MypiCuadre</h1>
        {expired ? (
          <p className="muted">
            La licencia{payload?.negocio ? ` de ${payload.negocio}` : ''} caducó.
            Introduce una nueva para seguir usando la app.
          </p>
        ) : (
          <p className="muted">
            Esta aplicación necesita una licencia de activación. Pega el código
            que te entregó el proveedor.
          </p>
        )}

        <label className="field">
          <span>Código de licencia</span>
          <textarea
            rows={3}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="MYPI1...."
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <button
          className="btn btn--primary btn--block"
          disabled={!code.trim() || busy}
          onClick={submit}
        >
          {busy ? 'Verificando…' : 'Activar'}
        </button>
        {error && <p className="error">{error}</p>}

        <p className="muted activation-help">
          Funciona sin internet: la licencia se verifica en el propio dispositivo.
        </p>
      </div>
    </div>
  )
}
