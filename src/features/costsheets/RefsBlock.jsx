import { formatMoney } from '../../lib/currency'
import { FICHA_METHODS } from '../../lib/fichaCosto'

// Modulo 'fichas' (F8) - Bloque 8: DATOS SOBRE PRECIOS DE REFERENCIA (Fila 16).
//
// Es una fila EXPLICATIVA: no suma al precio. Recoge los comparables -internos o
// externos- y su EVIDENCIA, que es lo que sostiene el precio ante un control, una
// negociacion o una concertacion. El Apartado Segundo de la Resolucion obliga a
// MOSTRAR LAS BASES del precio, y esta fila es donde se declaran.
//
// La norma nombra tres tipos de evidencia: facturas, solicitudes de informacion y
// conciliaciones. Son atajos para teclear, no una lista cerrada.
//
// POR CORRELACION esta fila es la que sostiene el numero: el precio del similar
// sin una referencia declarada es una afirmacion sin respaldo. Se avisa, no se
// bloquea (Art. 6), y el aviso se repite en el bloque 9, que es el momento en que
// de verdad importa: justo antes de aprobar.

const EVIDENCIAS = ['Factura', 'Solicitud de información', 'Conciliación']

export function RefsBlock({ refs, method, baseCurrency, editable, onRefs }) {
  const correlacion = method === FICHA_METHODS.CORRELACION

  const setRef = (idx, patch) => onRefs(refs.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  const removeRef = (idx) => onRefs(refs.filter((_, i) => i !== idx))
  const addRef = (source = '') => onRefs([...refs, { source, price: '', note: '' }])

  return (
    <>
      {correlacion && refs.length === 0 && (
        <div className="cuadre-banner cuadre-banner--yellow">
          El precio se está formando <strong>por correlación</strong> y no hay ninguna referencia
          declarada. Esta fila es la que sostiene ese precio ante un control: sin ella, el precio
          del similar es una afirmación sin respaldo.
        </div>
      )}

      {refs.map((r, idx) => (
        <div className="ficha-item" key={idx}>
          <label className="field">
            <span>Fuente y evidencia</span>
            <input
              value={r.source || ''}
              readOnly={!editable}
              onChange={(e) => setRef(idx, { source: e.target.value })}
              placeholder="Factura 0412 · importador"
            />
          </label>
          <label className="field">
            <span>Precio del comparable ({baseCurrency})</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              value={!r.price ? '' : r.price}
              readOnly={!editable}
              onChange={(e) => setRef(idx, { price: e.target.value })}
              placeholder="0"
            />
          </label>
          <label className="field">
            <span>Qué se compara</span>
            <input
              value={r.note || ''}
              readOnly={!editable}
              onChange={(e) => setRef(idx, { note: e.target.value })}
              placeholder="Pan suave, bolsa de 200 u"
            />
          </label>
          <div className="kv">
            <span className="muted">{formatMoney(r.price, baseCurrency)}</span>
            {editable && (
              <button type="button" className="link-del" onClick={() => removeRef(idx)}>quitar</button>
            )}
          </div>
        </div>
      ))}

      {refs.length === 0 && !correlacion && (
        <p className="muted">
          Sin referencias todavía. No son obligatorias por el método de gastos, pero el
          <strong> Apartado Segundo</strong> obliga a mostrar las bases del precio: un comparable
          declarado es lo que convierte la ficha en un documento defendible.
        </p>
      )}

      {editable && (
        <>
          <div className="chip-row">
            {EVIDENCIAS.map((c) => (
              <button type="button" key={c} className="btn btn--ghost btn--sm" onClick={() => addRef(`${c} `)}>
                + {c}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn--ghost btn--block" onClick={() => addRef()}>
            Agregar referencia
          </button>
        </>
      )}

      <div className="total-row total-row--grand">
        <span>Fila 16 · referencias declaradas</span>
        <strong>{refs.length}</strong>
      </div>
      <p className="muted">
        La Fila 16 <strong>no suma al precio</strong>: es explicativa. Vale por la evidencia que
        recoge, no por su importe.
      </p>
    </>
  )
}
