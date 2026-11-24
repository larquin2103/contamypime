import { useEffect, useState } from 'react'
import { buildIdFromSrc, buildIdFromHtml, buildStatus, buildTimeFromHtml, buildTimeLabel } from '../../lib/appBuild'

// Version de la app en este telefono y si es la ultima publicada (auditoria de Rikisimo,
// 06-10-2026: un arreglo de la sync solo protege cuando TODOS los telefonos estan al dia).
// Solo LEE: el index.html publicado, con un parametro que ninguna ruta del service worker
// reconoce, para que lo responda la red y no el precache. No escribe nada.
// Se COMPARA por el hash del chunk (como siempre); lo que se MUESTRA es la fecha y hora
// del build, que viaja en una meta del index.html (nunca en el JS).
export function AppVersionCard() {
  const script = document.querySelector('script[type="module"][src*="/assets/index-"]')
  const running = buildIdFromSrc(script?.src)
  const runningLabel = buildTimeLabel(document.querySelector('meta[name="app-build-time"]')?.content)
  // undefined = comprobando; null = no se pudo; { id, time } = lo publicado
  const [latest, setLatest] = useState(undefined)

  useEffect(() => {
    let vivo = true
    if (!running || !navigator.onLine) { setLatest(null); return }
    fetch(`/index.html?version=${Date.now()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : ''))
      .then((html) => {
        if (!vivo) return
        const id = buildIdFromHtml(html)
        setLatest(id ? { id, time: buildTimeFromHtml(html) } : null)
      })
      .catch(() => { if (vivo) setLatest(null) })
    return () => { vivo = false }
  }, [running])

  const estado = latest === undefined ? 'comprobando' : buildStatus(running, latest?.id)
  const latestLabel = buildTimeLabel(latest?.time)
  return (
    <section className="card">
      <div className="kv">
        <span className="muted">Versión de la app</span>
        <strong>{runningLabel ? `Versión del ${runningLabel}` : (running || 'desarrollo')}</strong>
      </div>
      {estado === 'comprobando' && <p className="muted">Comprobando si es la última…</p>}
      {estado === 'al-dia' && <p className="ok-text">Tienes la última versión ✓</p>}
      {estado === 'nueva' && (
        <p className="warn-text">
          Hay una versión nueva ({latestLabel ? `del ${latestLabel}` : latest?.id}). Cierra la app del todo y vuelve a abrirla con internet.
        </p>
      )}
      {estado === 'desconocida' && running && (
        <p className="muted">No se pudo comprobar si es la última (sin conexión o sin respuesta).</p>
      )}
    </section>
  )
}
