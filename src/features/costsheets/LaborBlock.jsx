import { useMemo } from 'react'
import { formatMoney } from '../../lib/currency'
import { laborTotal, emptyLaborOp, splitLaborOp } from '../../lib/fichaCosto'

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
// Cada etiqueta lleva SU NUMERO DE COLUMNA, para que el pie "3 x (6 + 7) x 8"
// se pueda seguir campo por campo (y para que cuadre con lo que imprime F9).
//
// La columna (2) "Costo Base" NO se captura aqui: solo aplica cuando la ficha es
// una revision, igual que la columna (4) del anexo de insumos. Las DOS quedan
// asignadas a F8 en docs/FICHA-COSTO.md §9.10.
//
// La forma de una fila (`emptyLaborOp`) y la regla de partirla en dos
// (`splitLaborOp`) viven en el MOTOR, no aqui: son reglas del §2.8 y ahi se
// prueban con node. Partir sin borrar la norma de tiempo DOBLA la Fila 2 en
// silencio, y esa es la asercion que lo ancla.

// El importe de UNA operacion se le pide al MOTOR (una lista de una), en vez de
// repetir aqui la formula: el redondeo por linea es identico en pantalla y en el
// documento, y su Total cuadra con la suma de lo impreso.
const opAmount = (op) => laborTotal([op])

export function LaborBlock({ labor, baseCurrency, editable, onLabor }) {
  const fila2 = useMemo(() => laborTotal(labor), [labor])

  const setOp = (idx, patch) => {
    onLabor(labor.map((o, i) => (i === idx ? { ...o, ...patch } : o)))
  }

  const removeOp = (idx) => onLabor(labor.filter((_, i) => i !== idx))
  const addOp = () => onLabor([...labor, emptyLaborOp()])

  return (
    <>
      {labor.map((op, idx) => (
        <div className="ficha-item" key={idx}>
          <div className="kv">
            <span><strong>{op.operation || 'Operación sin nombre'}</strong></span>
            <span className="muted">{idx + 1} / {labor.length}</span>
          </div>

          <label className="field">
            <span>Operación (1)</span>
            <input
              value={op.operation || ''}
              readOnly={!editable}
              onChange={(e) => setOp(idx, { operation: e.target.value })}
              placeholder="Amasado y horneado"
            />
          </label>

          <div className="form-row">
            <label className="field">
              <span>Trabajadores (3)</span>
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
              <span>Categoría ocupacional (4)</span>
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
              <span>Grupo escala (5)</span>
              <input
                value={op.scaleGroup || ''}
                readOnly={!editable}
                onChange={(e) => setOp(idx, { scaleGroup: e.target.value })}
                placeholder="IV"
              />
            </label>
            <label className="field">
              <span>Norma de tiempo en horas (8)</span>
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
              <span>Salario / hora (6) · {baseCurrency}</span>
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
              <span>Pagos adicionales / hora (7) · {baseCurrency}</span>
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

          <div className="total-row">
            <span className="muted">3 × (6 + 7) × 8</span>
            <strong>{formatMoney(opAmount(op), baseCurrency)}</strong>
          </div>

          {editable && (
            <div className="kv">
              {/* Parte la operacion en dos filas independientes (§2.8). NO es una
                  accion destructiva, asi que NO va en rojo (`.link-del` es
                  `var(--danger)`): el rojo queda solo para "quitar". */}
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => onLabor(splitLaborOp(labor, idx))}>
                Otra norma de tiempo
              </button>
              <button type="button" className="link-del" onClick={() => removeOp(idx)}>quitar</button>
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
        <button type="button" className="btn btn--ghost btn--block" onClick={addOp}>
          Agregar operación
        </button>
      )}

      <p className="muted">
        Los pagos adicionales (7) son <strong>por hora</strong>: nocturnidad, peligrosidad. El
        salario directo <strong>incluye las vacaciones</strong>. Si una misma operación lleva
        normas de tiempo o grupos escala distintos, va en <strong>filas independientes</strong>:
        eso hace “Otra norma de tiempo”. Nota de la norma: los precios no se pueden incrementar
        por motivo de la aplicación del Decreto 53.
      </p>

      <div className="total-row total-row--grand">
        <span>Fila 2 · SALARIO DIRECTO (suma del anexo)</span>
        <strong>{formatMoney(fila2, baseCurrency)}</strong>
      </div>
    </>
  )
}
