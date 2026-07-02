import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAuth } from '../../app/providers/AuthProvider'
import { errorsRepo } from '../../repositories/errorsRepo'
import { shareFile } from '../../lib/whatsapp'
import { formatDateTime } from '../../lib/dates'

const SOURCE_LABEL = {
  window: 'Error de la app',
  promise: 'Operación fallida',
  react: 'Error de pantalla'
}

// Bloque 33.3 - Registro de errores (solo dueño/admin). Convierte "se me
// trabo" en un reporte diagnostico que se puede compartir por WhatsApp.
export function ErrorLogScreen() {
  const { isOwner, isManager } = useAuth()
  const errors = useLiveQuery(() => errorsRepo.listRecent(50), [], undefined)
  const [msg, setMsg] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)

  if (!isManager) {
    return (
      <div className="screen">
        <h2>Registro de errores</h2>
        <p className="muted">Solo el dueño o un administrativo puede ver el registro.</p>
        <Link className="btn btn--primary btn--block" to="/">Volver</Link>
      </div>
    )
  }
  if (errors === undefined) return null

  const flash = (text) => { setMsg(text); setTimeout(() => setMsg(''), 3000) }

  const buildReport = () => {
    const lines = ['Registro de errores — MypiCuadre', '']
    for (const e of errors) {
      lines.push(`[${formatDateTime(e.createdAt)}] ${SOURCE_LABEL[e.source] || e.source} (v${e.appVersion || '?'})`)
      lines.push(`Pantalla: ${e.route || '—'}`)
      lines.push(e.message)
      if (e.stack) lines.push(e.stack)
      lines.push('')
    }
    lines.push(`Dispositivo: ${navigator.userAgent}`)
    return lines.join('\n')
  }

  const share = async () => {
    const blob = new Blob([buildReport()], { type: 'text/plain' })
    const day = new Date().toISOString().slice(0, 10)
    const ok = await shareFile(blob, `errores_mypicuadre_${day}.txt`, 'Registro de errores de MypiCuadre')
    if (!ok) {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `errores_mypicuadre_${day}.txt`
      a.click()
      URL.revokeObjectURL(url)
      flash('Tu dispositivo no permite compartir directo: se descargó el archivo.')
    }
  }

  const clear = async () => {
    await errorsRepo.clear()
    setConfirmClear(false)
    flash('Registro vaciado.')
  }

  return (
    <div className="screen">
      <h2>Registro de errores</h2>
      <p className="muted">
        Aquí quedan los problemas técnicos de la app en este dispositivo. Si algo falla,
        comparte este registro con el soporte para diagnosticarlo.
      </p>

      {errors.length === 0 ? (
        <section className="card">
          <p className="muted">✅ Sin errores registrados. Todo en orden.</p>
        </section>
      ) : (
        <>
          <button className="btn btn--primary btn--block" onClick={share}>
            📲 Compartir registro ({errors.length})
          </button>
          {errors.map((e) => (
            <section key={e.id} className="card">
              <div className="kv">
                <span className="muted">{SOURCE_LABEL[e.source] || e.source}</span>
                <strong>{formatDateTime(e.createdAt)}</strong>
              </div>
              <p className="error" style={{ wordBreak: 'break-word' }}>{e.message}</p>
              <p className="muted" style={{ fontSize: '0.85em' }}>
                Pantalla: {e.route || '—'}{e.appVersion ? ` · v${e.appVersion}` : ''}
              </p>
            </section>
          ))}
          {isOwner && !confirmClear && (
            <button className="btn btn--ghost btn--block" onClick={() => setConfirmClear(true)}>
              Vaciar registro
            </button>
          )}
          {isOwner && confirmClear && (
            <section className="card">
              <p className="warn-text">¿Vaciar el registro de errores? No afecta los datos del negocio.</p>
              <div className="modal__actions">
                <button className="btn btn--ghost" onClick={() => setConfirmClear(false)}>Cancelar</button>
                <button className="btn btn--primary" onClick={clear}>Vaciar</button>
              </div>
            </section>
          )}
        </>
      )}
      {msg && <p className="muted">{msg}</p>}
    </div>
  )
}
