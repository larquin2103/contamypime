import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAuth } from '../../app/providers/AuthProvider'
import { useShift } from '../../app/providers/ShiftProvider'
import { shiftsRepo } from '../../repositories/shiftsRepo'
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

// Muestra un objeto de caja por moneda ({ MN: 100, USD: 5 }) en una línea.
function cashLine(obj) {
  const parts = Object.entries(obj || {})
    .filter(([, v]) => Number(v) !== 0)
    .map(([c, v]) => formatMoney(v, c))
  return parts.length ? parts.join(' · ') : '—'
}

export function HandoffScreen() {
  const { user } = useAuth()
  const { activeShift } = useShift()
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [preview, setPreview] = useState(null) // snapshot entrante
  const [applied, setApplied] = useState(false)

  // Resumen de caja/ventas del turno propio (para mostrar antes de entregar).
  const summary = useLiveQuery(
    () => (activeShift ? shiftsRepo.getSummary(activeShift.id) : null),
    [activeShift?.id],
    null
  )

  const doExport = async () => {
    setBusy(true)
    const snap = await buildSnapshot(user, activeShift)
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
    const snap = await buildSnapshot(user, activeShift)
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
        <p className="muted">Genera un archivo con existencias, precios, caja, ventas y deudas.</p>

        {/* Resumen del turno que se entrega: ventas y fondo a heredar por el próximo. */}
        {summary && (
          <div className="handoff-summary">
            {activeShift?.area && (
              <div className="kv"><span className="muted">Área</span><strong>{activeShift.area}</strong></div>
            )}
            <div className="kv"><span className="muted">Ventas (efectivo)</span><strong>{cashLine(summary.salesCash)}</strong></div>
            {Object.keys(summary.transfersByCur || {}).length > 0 && (
              <div className="kv"><span className="muted">Ventas (transferencia)</span><strong>{cashLine(summary.transfersByCur)}</strong></div>
            )}
            <div className="kv"><span className="muted">N.º de ventas</span><strong>{summary.salesCount}</strong></div>
            <div className="kv">
              <span className="muted">Fondo de caja a heredar</span>
              <strong>{cashLine(summary.expectedCash)}</strong>
            </div>
          </div>
        )}

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
            <strong>Turno recibido completamente</strong>
            <p className="muted">Existencias (por ubicación), ventas, movimientos, áreas y deudas sincronizados. Ya puedes abrir tu turno.</p>
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
  const areas = snap.config?.areas || []
  const ss = snap.shiftSummary || null
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Revisar turno entrante (v{snap.meta?.version || 1})</h3>
        <p className="muted">
          De <strong>{snap.meta?.fromUserName || 'otro vendedor'}</strong> ·{' '}
          {formatDateTime(snap.meta?.exportedAt)}
        </p>

        <h4 className="section-title" style={{ fontSize: '0.9em', marginTop: '12px' }}>Catálogo</h4>
        <div className="kv"><span className="muted">Productos</span><strong>{snap.products?.length || 0}</strong></div>
        <div className="kv"><span className="muted">Categorías</span><strong>{snap.categories?.length || 0}</strong></div>
        {areas.length > 0 && (
          <div className="kv"><span className="muted">Áreas</span><strong>{areas.join(', ')}</strong></div>
        )}

        <h4 className="section-title" style={{ fontSize: '0.9em', marginTop: '12px' }}>Historial (Bloque 20)</h4>
        <div className="kv"><span className="muted">Ventas registradas</span><strong>{snap.sales?.length || 0}</strong></div>
        <div className="kv"><span className="muted">Movimientos de stock</span><strong>{snap.stockMovements?.length || 0}</strong></div>
        {snap.transfers && (
          <div className="kv"><span className="muted">Salidas almacén→área</span><strong>{snap.transfers.length || 0}</strong></div>
        )}
        {snap.counts && (
          <div className="kv"><span className="muted">Conteos físicos</span><strong>{snap.counts.length || 0}</strong></div>
        )}

        <h4 className="section-title" style={{ fontSize: '0.9em', marginTop: '12px' }}>Caja y ventas del turno</h4>
        {ss ? (
          <>
            {ss.area && <div className="kv"><span className="muted">Área del turno</span><strong>{ss.area}</strong></div>}
            <div className="kv"><span className="muted">Ventas (efectivo)</span><strong>{cashLine(ss.salesCash)}</strong></div>
            {ss.transfersByCur && Object.keys(ss.transfersByCur).length > 0 && (
              <div className="kv"><span className="muted">Ventas (transferencia)</span><strong>{cashLine(ss.transfersByCur)}</strong></div>
            )}
            <div className="kv"><span className="muted">N.º de ventas</span><strong>{ss.salesCount ?? 0}</strong></div>
          </>
        ) : (
          <p className="muted">Sin turno abierto de referencia en el archivo.</p>
        )}
        <div className="kv"><span className="muted">Deudas pendientes</span><strong>{snap.pendingDebts?.length || 0}</strong></div>
        <div className="kv">
          <span className="muted">Fondo de caja a heredar</span>
          <strong>{cashLine(inh)}</strong>
        </div>

        <p className="muted" style={{ marginTop: '12px', fontSize: '0.85em' }}>
          ✅ Se sincronizarán: catálogo (con stock por ubicación), historial completo (ventas, movimientos, conteos),
          áreas, tasas, deudas y el fondo de caja a heredar. El estado será íntegro en este dispositivo.
        </p>
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onCancel}>Cancelar</button>
          <button className="btn btn--primary" disabled={busy} onClick={onConfirm}>
            {busy ? 'Sincronizando…' : 'Recibir turno'}
          </button>
        </div>
      </div>
    </div>
  )
}
