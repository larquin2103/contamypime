import { useMemo } from 'react'
import { formatMoney } from '../../lib/currency'
import { laborTotal } from '../../lib/fichaCosto'

// Modulo 'fichas' (F6) - Bloque 3: SALARIO DIRECTO (Fila 2 del Anexo I).
//
// Anexo "Gasto de salario de los obreros", con sus NUEVE columnas:
//   (1) Operacion                      (2) Gasto de salario del Costo Base
//   (3) Cantidad de trabajadores       (4) Categoria ocupacional
//   (5) Grupo escala                   (6) Salario / hora
//   (7) Pagos adicionales por hora     (8) Norma de tiempo en horas
//   (9) Gasto = (3) x ((6) + (7)) x (8)
//
// Van EN TARJETAS, una por operacion, no en tabla horizontal (decision 4 del
// dueño): las nueve columnas apiladas caben en un telefono y la tabla oficial
// sale solo en el PDF/Excel de F9. Cero scroll horizontal.
//
// La norma obliga a FILAS INDEPENDIENTES cuando cambia la norma de tiempo o el
// grupo escala dentro de la misma operacion; de ahi "otra norma de tiempo", que
// duplica la tarjeta en vez de meter dos tiempos en una.
//
// La columna (2) "Costo Base" NO se captura aqui: solo aplica cuando la ficha es
// una revision, igual que la columna (4) del anexo de insumos. Queda asignada a
// F8 en docs/FICHA-COSTO.md §9.9.

// El importe de UNA operacion se le pide al MOTOR (una lista de una), en vez de
// repetir aqui la formula: el redondeo por linea es identico en pantalla y en el
// documento, y su Total cuadra con la suma de lo impreso.
const opAmount = (op) => laborTotal([op])

// Operacion en blanco. Los campos se guardan como TEXTO (el repo los normaliza
// con `num`/`txt`) para no pelear con lo que se esta tecleando.
const EMPTY_OP = {
  operation: '',
  baseCost: 0,
  workers: '',
  category: '',
  scaleGroup: '',
  hourly: '',
  extraHourly: '',
  hours: ''
}

export function LaborBlock({ labor, baseCurrency, editable, onLabor }) {
  const fila2 = useMemo(() => laborTotal(labor), [labor])

  const setOp = (idx, patch) => {
    onLabor(labor.map((o, i) => (i === idx ? { ...o, ...patch } : o)))
  }

  const removeOp = (idx) => onLabor(labor.filter((_, i) => i !== idx))

  const addOp = () => onLabor([...labor, { ...EMPTY_OP }])

  // "Otra norma de tiempo": copia la operacion en una fila INDEPENDIENTE, que es
  // lo que exige la norma cuando el mismo trabajo lleva tiempos o grupos escala
  // distintos. Se copia TODO menos la norma de tiempo, que es lo que el boton
  // dice que va a cambiar; el grupo escala se conserva porque lo normal es que
  // siga siendo el mismo, y si no lo es se edita (borrarlo obligaria a teclear
  // otra vez algo que casi siempre no cambia). Se inserta pegada a su original
  // para que las dos filas de la misma operacion se lean juntas.
  const duplicateOp = (idx) => {
    const copia = { ...labor[idx], hours: '' }
    onLabor([...labor.slice(0, idx + 1), copia, ...labor.slice(idx + 1)])
  }

  return (
    <>
      {labor.map((op, idx) => (
        <div className="ficha-item" key={idx}>
          <div className="kv">
            <span><strong>{op.operation || 'Operación sin nombre'}</strong></span>
            <span className="muted">{idx + 1} / {labor.length}</span>
          </div>

          <label className="field">
            <span>Operación</span>
            <input
              value={op.operation || ''}
              readOnly={!editable}
              onChange={(e) => setOp(idx, { operation: e.target.value })}
              placeholder="Amasado y horneado"
            />
          </label>

          <div className="form-row">
            <label className="field">
              <span>Trabajadores</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={!op.workers ? '' : op.workers}
                readOnly={!editable}
                onChange={(e) => setOp(idx, { workers: e.target.value })}
                placeholder="0"
              />
            </label>
            <label className="field">
              <span>Categoría ocupacional</span>
              <input
                value={op.category || ''}
                readOnly={!editable}
                onChange={(e) => setOp(idx, { category: e.target.value })}
                placeholder="Obrero"
              />
            </label>
          </div>

          <div className="form-row">
            <label className="field">
              <span>Grupo escala</span>
              <input
                value={op.scaleGroup || ''}
                readOnly={!editable}
                onChange={(e) => setOp(idx, { scaleGroup: e.target.value })}
                placeholder="IV"
              />
            </label>
            <label className="field">
              <span>Norma de tiempo (h)</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={!op.hours ? '' : op.hours}
                readOnly={!editable}
                onChange={(e) => setOp(idx, { hours: e.target.value })}
                placeholder="0"
              />
            </label>
          </div>

          <div className="form-row">
            <label className="field">
              <span>Salario / hora ({baseCurrency})</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={!op.hourly ? '' : op.hourly}
                readOnly={!editable}
                onChange={(e) => setOp(idx, { hourly: e.target.value })}
                placeholder="0"
              />
            </label>
            <label className="field">
              <span>Pagos adicionales / hora</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={!op.extraHourly ? '' : op.extraHourly}
                readOnly={!editable}
                onChange={(e) => setOp(idx, { extraHourly: e.target.value })}
                placeholder="0"
              />
            </label>
          </div>
          <p className="muted">Los pagos adicionales son por hora: nocturnidad, peligrosidad.</p>

          <div className="total-row">
            <span className="muted">3 × (6 + 7) × 8</span>
            <strong>{formatMoney(opAmount(op), baseCurrency)}</strong>
          </div>

          {editable && (
            <div className="kv">
              <button className="btn btn--ghost btn--sm" onClick={() => duplicateOp(idx)}>
                Otra norma de tiempo
              </button>
              <button className="link-del" onClick={() => removeOp(idx)}>quitar</button>
            </div>
          )}
        </div>
      ))}

      {labor.length === 0 && (
        <p className="muted">
          Todavía no hay operaciones. El Art. 5 obliga a desagregar el <strong>gasto de salario
          directo</strong> en un anexo independiente.
        </p>
      )}

      {editable && (
        <button className="btn btn--ghost btn--block" onClick={addOp}>
          Agregar operación
        </button>
      )}

      <p className="muted">
        El salario directo <strong>incluye las vacaciones</strong>. Nota de la norma: los precios
        no se pueden incrementar por motivo de la aplicación del Decreto 53.
      </p>

      <div className="total-row total-row--grand">
        <span>Fila 2 · SALARIO DIRECTO</span>
        <strong>{formatMoney(fila2, baseCurrency)}</strong>
      </div>
    </>
  )
}
