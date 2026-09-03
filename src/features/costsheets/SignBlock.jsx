import { useState } from 'react'
import { formatMoney } from '../../lib/currency'
import { formatDateTime } from '../../lib/dates'
import { FICHA_METHODS, FICHA_STATUS, canApproveSheet, canReviseSheet, canDeleteSheet, priceRows } from '../../lib/fichaCosto'
import { FICHA_STATUS_LABELS, FICHA_WARNING_LABELS } from '../../db/constants'

// Modulo 'fichas' (F8) - Bloque 9: FIRMAS Y CICLO DE VIDA.
//
// Los dos anexos que la norma obliga a desagregar llevan al pie "Elaborado por" y
// "Aprobado por" CON CARGO: son parte del documento, no un adorno. El elaborador
// se teclea mientras la ficha es borrador; el aprobador se firma en el momento de
// aprobar, que es cuando de verdad se asume.
//
// APROBAR HACE LA FICHA INMUTABLE. Es la unica accion del modulo que no se puede
// deshacer editando: corregir una aprobada crea una REVISION nueva (mismo grupo,
// version + 1) que hereda la anterior como Costo Base y la deja 'sustituida'.
// Nada se borra: eliminar es logico.
//
// LOS AVISOS NO BLOQUEAN LA APROBACION (Art. 6): un actor no estatal puede
// ajustar el modelo, y los tres controles son avisos. Pero se enseñan AQUI, justo
// antes de aprobar, porque es el unico momento en que decidir con ellos delante
// cambia algo. La exportacion del documento oficial llega en F9.

export function SignBlock({
  sheet,
  versions,
  refsCount,
  warns,
  baseCurrency,
  editable,
  busy,
  onElaboratedBy,
  onApprove,
  onRevise,
  onRemove
}) {
  const [approvedBy, setApprovedBy] = useState('')

  const puedeAprobar = canApproveSheet(sheet)
  const puedeRevisar = canReviseSheet(sheet)
  const puedeEliminar = canDeleteSheet(sheet)
  const unitario = priceRows(sheet).r15

  // Lo que conviene saber ANTES de aprobar. Ninguno bloquea: son cosas que dejan
  // el documento oficial incompleto o discutible, no errores de la app.
  const pendientes = [
    ...warns.map((w) => FICHA_WARNING_LABELS[w.code] || w.code),
    !String(sheet.elaboratedBy || '').trim() && 'falta “Elaborado por” en el pie del anexo',
    !(Number(sheet.productionLevel) > 0) && 'sin nivel de producción no hay precio unitario',
    sheet.method === FICHA_METHODS.CORRELACION && refsCount === 0 &&
      'por correlación y sin ninguna referencia que sostenga el precio'
  ].filter(Boolean)

  const aprobar = () => {
    const firma = approvedBy.trim()
    if (!firma) return // el boton ya va deshabilitado; guarda por si acaso
    const aviso = pendientes.length
      ? `\n\nOJO: quedan ${pendientes.length} punto(s) sin resolver:\n· ${pendientes.join('\n· ')}`
      : ''
    if (!confirm(
      `¿Aprobar la ficha "${sheet.name || 'sin nombre'}" con un precio unitario de ` +
      `${formatMoney(unitario, baseCurrency)}?\n\nQuedará INMUTABLE: para corregirla habrá que ` +
      `crear una revisión nueva. Nada se borra.${aviso}`
    )) return
    onApprove(firma)
  }

  const revisar = () => {
    if (!confirm(
      `¿Crear la revisión v${(Number(sheet.version) || 1) + 1} de "${sheet.name || 'sin nombre'}"?\n\n` +
      'Nace como borrador con los mismos datos y hereda esta versión como Costo Base. ' +
      'Esta ficha queda como “sustituida” y se conserva entera.'
    )) return
    onRevise()
  }

  const eliminar = () => {
    if (!confirm(
      `¿Eliminar la ficha "${sheet.name || 'sin nombre'}"?\n\n` +
      'Es un borrado lógico: desaparece de la lista pero NADA se borra, y queda constancia en ' +
      'Auditoría. Úsalo para una ficha de prueba o creada por error.'
    )) return
    onRemove()
  }

  return (
    <>
      {/* --- Firmas del pie del anexo --- */}
      <div className="ficha-item">
        <label className="field">
          <span>Elaborado por (nombre y cargo)</span>
          <input
            value={sheet.elaboratedBy || ''}
            readOnly={!editable}
            onChange={(e) => onElaboratedBy(e.target.value)}
            placeholder="Ana Pérez · administradora"
          />
        </label>
        <div className="total-row">
          <span className="muted">Aprobado por</span>
          <strong>{sheet.approvedBy || '—'}</strong>
        </div>
        {sheet.approvedAt && (
          <div className="total-row">
            <span className="muted">Aprobada el</span>
            <strong>{formatDateTime(sheet.approvedAt)}</strong>
          </div>
        )}
        <p className="muted">
          Los dos anexos oficiales llevan estas dos firmas <strong>con cargo</strong> al pie: son
          parte del documento.
        </p>
      </div>

      {/* --- Aprobar (solo un borrador) --- */}
      {puedeAprobar && (
        <div className="ficha-item">
          <h4 className="section-title">Aprobar la ficha</h4>
          {pendientes.length > 0 && (
            <div className="cuadre-banner cuadre-banner--yellow">
              Antes de aprobar, {pendientes.length === 1 ? 'queda' : 'quedan'}{' '}
              {pendientes.length} punto{pendientes.length === 1 ? '' : 's'} sin resolver:{' '}
              {pendientes.join(' · ')}. <strong>No impiden aprobar</strong> (Art. 6), pero conviene
              decidirlos con esto delante.
            </div>
          )}
          <label className="field">
            <span>Aprobado por (nombre y cargo)</span>
            <input
              value={approvedBy}
              onChange={(e) => setApprovedBy(e.target.value)}
              placeholder="Juan Díaz · dueño"
            />
          </label>
          <p className="muted">
            Al aprobar, la ficha queda <strong>inmutable</strong> con un precio unitario de{' '}
            <strong>{formatMoney(unitario, baseCurrency)}</strong>. Corregirla después crea una
            revisión nueva.
          </p>
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={busy || !approvedBy.trim()}
            onClick={aprobar}
          >
            {busy ? 'Aprobando…' : 'Aprobar ficha'}
          </button>
          {!approvedBy.trim() && (
            <p className="muted">Escribe quién la aprueba: es la firma del documento.</p>
          )}
        </div>
      )}

      {/* --- Revisar (solo una aprobada) --- */}
      {puedeRevisar && (
        <div className="ficha-item">
          <h4 className="section-title">Corregir esta ficha</h4>
          <p className="muted">
            Una ficha aprobada no se edita: es el documento con el que se sostuvo un precio. La
            revisión nace como borrador con los mismos datos y <strong>hereda esta versión como
            Costo Base</strong>, que es para lo que la norma pide esa columna.
          </p>
          <button type="button" className="btn btn--primary btn--block" disabled={busy} onClick={revisar}>
            {busy ? 'Creando…' : `Nueva revisión (v${(Number(sheet.version) || 1) + 1})`}
          </button>
        </div>
      )}

      {/* --- Historial del grupo --- */}
      {versions.length > 1 && (
        <div className="ficha-item">
          <h4 className="section-title">Versiones de esta ficha</h4>
          {versions.map((v) => (
            <div className="total-row" key={v.id}>
              {/* `listByGroup` NO filtra las eliminadas, y hace bien: el historial
                  es el historial. Pero una eliminada conserva su `status`
                  ('borrador'), asi que sin esto se pintaria como si estuviera
                  viva. La palabra va inline y NO en FICHA_STATUS_LABELS, que la
                  suite exige que cubra EXACTAMENTE los tres estados del motor. */}
              <span className={v.id === sheet.id ? '' : 'muted'}>
                v{v.version || 1} · {v.deletedAt ? 'eliminada' : (FICHA_STATUS_LABELS[v.status] || v.status)}
                {v.id === sheet.id && ' · esta'}
              </span>
              <strong>{formatMoney(priceRows(v).r15, baseCurrency)}</strong>
            </div>
          ))}
          <p className="muted">
            Nada se borra: cada versión se conserva entera con su precio, que es lo que permite
            explicar un cambio de precio ante un control.
          </p>
        </div>
      )}

      {/* --- Eliminar (borrado logico) --- */}
      {puedeEliminar && (
        <div className="ficha-item">
          <div className="kv">
            <span className="muted">
              {sheet.status === FICHA_STATUS.BORRADOR
                ? 'Eliminar este borrador'
                : 'Eliminar esta ficha'}
            </span>
            <button type="button" className="link-del" disabled={busy} onClick={eliminar}>
              eliminar
            </button>
          </div>
          <p className="muted">
            Borrado <strong>lógico</strong>: sale de la lista, pero nada se borra y queda
            constancia en Auditoría.
          </p>
        </div>
      )}
    </>
  )
}
