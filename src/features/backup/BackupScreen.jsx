import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAuth } from '../../app/providers/AuthProvider'
import { configRepo } from '../../repositories/configRepo'
import { OwnerAuthModal } from '../../components/OwnerAuthModal'
import { shareFile } from '../../lib/whatsapp'
import { formatDateTime } from '../../lib/dates'
import { requestPersistentStorage, getStorageInfo, formatBytes } from '../../lib/storage'
import { useEscapeClose } from '../../lib/useEscapeClose'
import {
  buildBackup,
  backupToBlob,
  backupFileName,
  markBackupDone,
  parseBackup,
  applyBackup,
  backupSummary
} from './backupService'

// Bloque 32 - Respaldo y proteccion de datos. Solo el dueño: el respaldo
// contiene TODO el negocio (costos, usuarios, finanzas), igual que la sync.
export function BackupScreen() {
  const { user, isOwner } = useAuth()

  if (!isOwner) {
    return (
      <div className="screen">
        <h2>Respaldo de datos</h2>
        <p className="muted">Solo el dueño puede hacer o restaurar respaldos.</p>
        <Link className="btn btn--primary btn--block" to="/">Volver</Link>
      </div>
    )
  }

  return (
    <div className="screen">
      <h2>Respaldo de datos</h2>
      <p className="muted">
        Todos los datos viven en este dispositivo. Un respaldo es tu red de seguridad si el
        teléfono se rompe, se pierde o se borra.
      </p>
      <StorageSection />
      <ExportSection user={user} />
      <RestoreSection />
    </div>
  )
}

// 32.1 - Estado de la proteccion del almacenamiento.
function StorageSection() {
  const [info, setInfo] = useState(null)
  const [asked, setAsked] = useState(false)

  const refresh = () => { getStorageInfo().then(setInfo) }
  useEffect(refresh, [])

  const protect = async () => {
    await requestPersistentStorage()
    setAsked(true)
    refresh()
  }

  if (!info) return null
  const st = info.persisted
  return (
    <section className="card">
      <h3>Protección del almacenamiento</h3>
      <div className="kv">
        <span className="muted">Estado</span>
        <strong className={st ? 'ok-text' : st === false ? 'warn-text' : 'muted'}>
          {st ? '✅ Protegido' : st === false ? '⚠️ No protegido' : 'No disponible'}
        </strong>
      </div>
      {info.usage != null && (
        <div className="kv">
          <span className="muted">Espacio usado</span>
          <strong>{formatBytes(info.usage)}{info.quota ? ` de ${formatBytes(info.quota)}` : ''}</strong>
        </div>
      )}
      {st === false && (
        <>
          <p className="warn-text">
            Sin protección, el sistema puede borrar los datos de la app si el teléfono se queda
            sin espacio. Instala la app en la pantalla de inicio y toca el botón.
          </p>
          <button className="btn btn--primary btn--block" onClick={protect}>
            {asked ? 'Volver a solicitar' : 'Proteger almacenamiento'}
          </button>
        </>
      )}
      {st && (
        <p className="muted">El sistema no borrará los datos de la app aunque falte espacio.</p>
      )}
    </section>
  )
}

// 32.2 - Exportar/compartir el respaldo completo.
function ExportSection({ user }) {
  const lastBackupAt = useLiveQuery(() => configRepo.get('lastBackupAt', null), [], undefined)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const flash = (text) => { setMsg(text); setTimeout(() => setMsg(''), 3000) }

  const download = async () => {
    setBusy(true)
    try {
      const bk = await buildBackup(user)
      const url = URL.createObjectURL(backupToBlob(bk))
      const a = document.createElement('a')
      a.href = url
      a.download = backupFileName()
      a.click()
      URL.revokeObjectURL(url)
      await markBackupDone()
      flash('Respaldo descargado. Guárdalo fuera de este teléfono.')
    } finally {
      setBusy(false)
    }
  }

  const share = async () => {
    setBusy(true)
    try {
      const bk = await buildBackup(user)
      const ok = await shareFile(backupToBlob(bk), backupFileName(), 'Respaldo de MypiCuadre')
      if (ok) {
        await markBackupDone()
        flash('Respaldo compartido.')
      } else {
        setBusy(false)
        await download()
        flash('Tu dispositivo no permite compartir directo: se descargó el archivo, adjúntalo en WhatsApp.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h3>Hacer respaldo</h3>
      <p className="muted">
        Genera un archivo con TODO el negocio: catálogo, existencias, ventas, turnos, caja,
        deudas, usuarios y configuración. Envíatelo por WhatsApp o guárdalo en otro lugar.
      </p>
      <div className="kv">
        <span className="muted">Último respaldo</span>
        <strong>{lastBackupAt ? formatDateTime(lastBackupAt) : 'Nunca'}</strong>
      </div>
      <button className="btn btn--primary btn--block" disabled={busy} onClick={share}>
        📲 Compartir por WhatsApp
      </button>
      <button className="btn btn--block" disabled={busy} onClick={download}>
        ⬇ Descargar archivo (JSON)
      </button>
      {msg && <p className="muted">{msg}</p>}
    </section>
  )
}

// 32.3 - Restaurar desde un archivo de respaldo (con PIN del dueño).
function RestoreSection() {
  const fileRef = useRef(null)
  const [preview, setPreview] = useState(null) // respaldo parseado
  const [askPin, setAskPin] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setDone(false)
    try {
      const text = await file.text()
      setPreview(parseBackup(text))
    } catch (err) {
      setError(err.message)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const restore = async () => {
    setAskPin(false)
    setBusy(true)
    try {
      await applyBackup(preview)
      setPreview(null)
      setDone(true)
    } catch (err) {
      setError(`No se pudo restaurar: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h3>Restaurar un respaldo</h3>
      <p className="muted">
        Carga un archivo de respaldo para recuperar el negocio en este dispositivo. Nada se
        borra: los datos del respaldo se fusionan con los existentes.
      </p>
      <input ref={fileRef} type="file" accept=".json,application/json" onChange={onFile} disabled={busy} />
      {error && <p className="error">{error}</p>}
      {done && (
        <div className="cuadre-banner cuadre-banner--green">
          <span className="cuadre-emoji">✅</span>
          <div>
            <strong>Respaldo restaurado</strong>
            <p className="muted">Existencias recalculadas desde el historial. Revisa el catálogo y los usuarios.</p>
          </div>
        </div>
      )}
      {preview && (
        <RestorePreview
          backup={preview}
          busy={busy}
          onConfirm={() => setAskPin(true)}
          onCancel={() => setPreview(null)}
        />
      )}
      {askPin && (
        <OwnerAuthModal onAuthorized={restore} onCancel={() => setAskPin(false)} />
      )}
    </section>
  )
}

function RestorePreview({ backup, busy, onConfirm, onCancel }) {
  const s = backupSummary(backup)
  useEscapeClose(onCancel)
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Revisar respaldo" onClick={(e) => e.stopPropagation()}>
        <h3>Revisar respaldo</h3>
        <p className="muted">
          Hecho por <strong>{backup.meta?.fromUserName || 'el dueño'}</strong> ·{' '}
          {formatDateTime(backup.meta?.exportedAt)}
        </p>
        <div className="kv"><span className="muted">Productos</span><strong>{s.products}</strong></div>
        <div className="kv"><span className="muted">Categorías</span><strong>{s.categories}</strong></div>
        <div className="kv"><span className="muted">Usuarios</span><strong>{s.users}</strong></div>
        <div className="kv"><span className="muted">Ventas</span><strong>{s.sales}</strong></div>
        <div className="kv"><span className="muted">Turnos</span><strong>{s.shifts}</strong></div>
        <div className="kv"><span className="muted">Movimientos de stock</span><strong>{s.stockMovements}</strong></div>
        <div className="kv"><span className="muted">Entradas de mercancía</span><strong>{s.purchases}</strong></div>
        <div className="kv"><span className="muted">Salidas almacén→área</span><strong>{s.transfers}</strong></div>
        <div className="kv"><span className="muted">Conteos físicos</span><strong>{s.counts}</strong></div>
        <div className="kv"><span className="muted">Deudas internas</span><strong>{s.debts}</strong></div>
        <p className="muted" style={{ marginTop: '12px', fontSize: '0.85em' }}>
          Se fusionará todo por identificador (nada se borra). La licencia y la vinculación a la
          nube de este dispositivo no se tocan. Se pedirá el PIN del dueño o de un administrativo.
        </p>
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onCancel}>Cancelar</button>
          <button className="btn btn--primary" disabled={busy} onClick={onConfirm}>
            {busy ? 'Restaurando…' : 'Restaurar'}
          </button>
        </div>
      </div>
    </div>
  )
}
