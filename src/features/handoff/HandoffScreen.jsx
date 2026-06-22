import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../app/providers/AuthProvider'
import {
  buildSnapshot,
  snapshotToBlob,
  snapshotFileName,
  parseSnapshot,
  applySnapshot
} from './handoffService'
import { shareFile } from '../../lib/whatsapp'
import { formatMoney } from '../../lib/currency'
import { formatDateTime } from '../../lib/dates'

export function HandoffScreen() {
  const { user } = useAuth()
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [preview, setPreview] = useState(null) // snapshot entrante
  const [applied, setApplied] = useState(false)

  const doExport = async () => {
    setBusy(true)
    const snap = await buildSnapshot(user.name)
    const blob = snapshotToBlob(snap)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = snapshotFileName(user.name)
    a.click()
    URL.revokeObjectURL(url)
    setBusy(false)
    setMsg('Archivo de turno descargado.')
    setTimeout(() => setMsg(''), 2500)
  }

  const doShare = async () => {
    const snap = await buildSnapshot(user.name)
    const blob = snapshotToBlob(snap)
    const ok = await shareFile(blob, snapshotFileName(user.name), 'Turno de MypiCuadre')
    if (!ok) {
      await doExport()
      setMsg('Tu dispositivo no permite compartir directo: se descargo el archivo, adjuntalo en WhatsApp.')
    }
  }

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setMsg('')
    try {
      const text = await file.text()
      setPreview(parseSnapshot(text))
    } catch (err) {
      setMsg(err.message)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const confirmImport = async () => {
    setBusy(true)
    await applySnapshot(preview)
    setBusy(false)
    setApplied(true)
    setPreview(null)
  }

  return (
    <div className="screen">
      <h2>Traspaso de turno</h2>
      <p className="muted">Pasa el estado del negocio a otro vendedor sin internet.</p>

      <section className="card">
        <h3>Entregar mi turno</h3>
        <p className="muted">Genera un archivo con existencias, precios, caja y deudas.</p>
        <button className="btn btn--primary btn--block" disabled={busy} onClick={doShare}>
          📲 Compartir por WhatsApp
        </button>
        <button className="btn btn--block" disabled={busy} onClick={doExport}>
          ⬇ Descargar archivo (JSON)
        </button>
      </section>

      <section className="card">
        <h3>Recibir un turno</h3>
        <p className="muted">Carga el archivo que te envio el vendedor saliente.</p>
        <input ref={fileRef} type="file" accept=".json,application/json" onChange={onFile} disabled={busy} />
      </section>

      {applied && (
        <div className="cuadre-banner cuadre-banner--green">
          <span className="cuadre-emoji">✅</span>
          <div>
            <strong>Turno recibido</strong>
            <p className="muted">Existencias, precios y deudas actualizados. Ya puedes abrir tu turno.</p>
          </div>
        </div>
      )}
      {applied && <Link className="btn btn--primary btn--block" to="/shift">Abrir mi turno</Link>}

      {msg && <p className="muted">{msg}</p>}

      {preview && <ImportPreview snap={preview} busy={busy} onConfirm={confirmImport} onCancel={() => setPreview(null)} />}
    </div>
  )
}

function ImportPreview({ snap, busy, onConfirm, onCancel }) {
  const inh = snap.inheritedCash || {}
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Revisar turno entrante</h3>
        <p className="muted">
          De <strong>{snap.meta?.fromUserName || 'otro vendedor'}</strong> ·{' '}
          {formatDateTime(snap.meta?.exportedAt)}
        </p>
        <div className="kv"><span className="muted">Productos</span><strong>{snap.products?.length || 0}</strong></div>
        <div className="kv"><span className="muted">Categorias</span><strong>{snap.categories?.length || 0}</strong></div>
        <div className="kv"><span className="muted">Deudas pendientes</span><strong>{snap.pendingDebts?.length || 0}</strong></div>
        <div className="kv">
          <span className="muted">Caja a heredar</span>
          <strong>{Object.entries(inh).map(([c, v]) => formatMoney(v, c)).join(' · ') || '—'}</strong>
        </div>
        <p className="muted">Se actualizaran existencias, precios, tasas y deudas en este dispositivo.</p>
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onCancel}>Cancelar</button>
          <button className="btn btn--primary" disabled={busy} onClick={onConfirm}>
            {busy ? 'Aplicando…' : 'Aplicar turno'}
          </button>
        </div>
      </div>
    </div>
  )
}
