import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../app/providers/AuthProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { productsRepo } from '../../repositories/productsRepo'
import {
  buildTemplateBlob,
  parseAndValidate,
  commitImport,
  templateHeaders
} from './importService'

const STATUS_META = {
  ok: { chip: '✓ Listo', cls: 'is-ok' },
  dup: { chip: '⚠ Duplicado', cls: 'is-dup' },
  error: { chip: '✗ Error', cls: 'is-error' }
}

export function ImportScreen() {
  const { user, isManager } = useAuth()
  const { hasModule } = useLicense()
  const withTiers = hasModule(LICENSE_MODULES.WHOLESALE)
  const navigate = useNavigate()
  const fileRef = useRef(null)
  const [result, setResult] = useState(null) // { rows, summary, fileName }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null) // nro creados

  if (!isManager) {
    return (
      <div className="screen">
        <h2>Importar inventario</h2>
        <p className="muted">Solo el dueño o un administrativo puede importar el catalogo.</p>
      </div>
    )
  }

  const downloadTemplate = async () => {
    const blob = await buildTemplateBlob({ withTiers })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'plantilla_productos.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  }

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setBusy(true)
    try {
      const buffer = await file.arrayBuffer()
      const existingProducts = await productsRepo.list()
      const res = await parseAndValidate(buffer, { existingProducts })
      setResult({ ...res, fileName: file.name })
    } catch (err) {
      setError('No se pudo leer el archivo: ' + err.message)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const confirm = async () => {
    setBusy(true)
    try {
      const okRows = result.rows.filter((r) => r.status === 'ok')
      const created = await commitImport(okRows, { userId: user.id, withTiers })
      setDone(created)
      setResult(null)
    } catch (err) {
      setError('Error al importar: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  if (done != null) {
    return (
      <div className="screen">
        <div className="cuadre-banner cuadre-banner--green">
          <span className="cuadre-emoji">✅</span>
          <div>
            <strong>{done} producto(s) importado(s)</strong>
            <p className="muted">El catalogo y las existencias iniciales ya estan cargados.</p>
          </div>
        </div>
        <button className="btn btn--primary btn--block" onClick={() => navigate('/catalog')}>
          Ver catalogo
        </button>
        <button className="btn btn--ghost btn--block" onClick={() => setDone(null)}>
          Importar otro archivo
        </button>
      </div>
    )
  }

  return (
    <div className="screen">
      <h2>Importar inventario</h2>

      <section className="card">
        <h3>1. Descarga la plantilla</h3>
        <p className="muted">
          Columnas: {templateHeaders(withTiers).join(', ')}. Llenala con tu inventario (Excel, lista, cuaderno).
        </p>
        <button className="btn btn--block" onClick={downloadTemplate}>
          ⬇ Descargar plantilla Excel
        </button>
      </section>

      <section className="card">
        <h3>2. Sube tu archivo</h3>
        <p className="muted">Acepta Excel (.xlsx) o CSV. Validamos antes de importar.</p>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={onFile}
          disabled={busy}
        />
      </section>

      {busy && <p className="muted">Procesando…</p>}
      {error && <p className="error">{error}</p>}

      {result && <Preview result={result} onConfirm={confirm} busy={busy} />}
    </div>
  )
}

function Preview({ result, onConfirm, busy }) {
  const { rows, summary, fileName } = result
  return (
    <>
      <section className="card">
        <h3>3. Vista previa — {fileName}</h3>
        <div className="import-summary">
          <span className="chip is-ok">{summary.ok} listos</span>
          <span className="chip is-dup">{summary.dup} duplicados</span>
          <span className="chip is-error">{summary.error} con error</span>
        </div>
        <p className="muted">
          Se importarán solo los {summary.ok} válidos. Los duplicados y los que tienen error se
          omiten — corrige el archivo y vuelve a subirlo si quieres incluirlos.
        </p>
      </section>

      <div className="import-rows">
        {rows.map((r) => {
          const meta = STATUS_META[r.status]
          return (
            <div key={r.line} className={`import-row ${meta.cls}`}>
              <div className="import-row__main">
                <strong>{r.draft.name || <em className="muted">(sin nombre)</em>}</strong>
                <span className="muted">
                  {r.draft.code ? `${r.draft.code} · ` : ''}
                  {r.draft.unit || '?'} · {r.draft.price ?? '—'}
                  {r.draft.category ? ` · ${r.draft.category}` : ''}
                  {r.draft.area ? ` · área: ${r.draft.area}` : ''}
                </span>
                {r.status === 'error' && <span className="row-msg">{r.errors.join(' · ')}</span>}
                {r.status === 'dup' && <span className="row-msg">{r.dupReason}</span>}
              </div>
              <span className={`chip ${meta.cls}`}>{meta.chip}</span>
            </div>
          )
        })}
      </div>

      <button
        className="btn btn--primary btn--block"
        disabled={busy || summary.ok === 0}
        onClick={onConfirm}
      >
        {busy ? 'Importando…' : `Importar ${summary.ok} producto(s)`}
      </button>
    </>
  )
}
