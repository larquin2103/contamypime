import { useMemo } from 'react'
import { formatMoney } from '../../lib/currency'
import { otherDirectTotal, negativeAmounts } from '../../lib/fichaCosto'

// Modulo 'fichas' (F7) - Bloque 4: OTROS GASTOS DIRECTOS (Fila 3 del Anexo I).
//
// Mantenimientos y reparaciones recibidos, DEPRECIACION de activos fijos
// tangibles directos y AMORTIZACION de intangibles. La norma exige DESGLOSAR la
// depreciacion, la amortizacion y las partidas de mayor peso, de ahi que sea una
// lista y no un solo importe: un numero suelto no se puede defender ante control.
//
// DECISION DE F7 SOBRE LOS IMPORTES NEGATIVOS (el plan la dejo abierta en §9.2):
// `otherDirectTotal` los IGNORA -[600, -100] da 600, no 500- porque las 16 filas
// son magnitudes de gasto. Se mantiene asi, pero la linea negativa se marca en
// ROJO en vez de descontarse en silencio: lo peligroso no era la regla, era que
// no se viera. Una correccion se hace bajando el importe de su propia linea.

// Lo que la norma nombra expresamente. Son atajos para teclear, no una lista
// cerrada: el dueño puede escribir cualquier concepto.
const SUGERIDOS = [
  'Depreciación de activos fijos tangibles directos',
  'Amortización de activos intangibles',
  'Mantenimientos y reparaciones recibidos'
]

export function OtherDirectBlock({ items, baseCurrency, editable, onItems }) {
  const fila3 = useMemo(() => otherDirectTotal(items), [items])
  // Quien decide que es un negativo es el MOTOR, no la pantalla: el mismo aviso
  // viaja por `fichaWarnings` y se ve tambien con el bloque plegado.
  const negativos = useMemo(() => new Set(negativeAmounts({ otherDirect: items })), [items])
  const hayNegativo = negativos.size > 0

  const setItem = (idx, patch) => onItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  const removeItem = (idx) => onItems(items.filter((_, i) => i !== idx))
  const addItem = (concept = '') => onItems([...items, { concept, amount: '' }])

  // Un concepto sugerido solo se ofrece si no esta ya en la lista.
  const yaEsta = (c) => items.some((i) => (i.concept || '').trim() === c)

  return (
    <>
      {items.map((it, idx) => {
        const negativo = negativos.has(`otherDirect.${idx}`)
        return (
          <div className="ficha-item" key={idx}>
            <label className="field">
              <span>Concepto</span>
              <input
                value={it.concept || ''}
                readOnly={!editable}
                onChange={(e) => setItem(idx, { concept: e.target.value })}
                placeholder="Depreciación de activos fijos tangibles directos"
              />
            </label>
            <label className="field">
              <span>Importe ({baseCurrency})</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={!it.amount ? '' : it.amount}
                readOnly={!editable}
                onChange={(e) => setItem(idx, { amount: e.target.value })}
                placeholder="0"
              />
            </label>
            {negativo && (
              <p className="error">
                Un importe negativo <strong>no se resta</strong> de la Fila 3: la norma trata estas
                filas como magnitudes de gasto, así que esta línea cuenta como cero. Para corregir,
                baja el importe de la línea que sobra.
              </p>
            )}
            <div className="kv">
              <span className="muted">{formatMoney(negativo ? 0 : it.amount, baseCurrency)}</span>
              {editable && (
                <button type="button" className="link-del" onClick={() => removeItem(idx)}>quitar</button>
              )}
            </div>
          </div>
        )
      })}

      {items.length === 0 && (
        <p className="muted">
          Sin desglose todavía. La norma <strong>exige desagregar</strong> la depreciación, la
          amortización y las partidas de mayor peso.
        </p>
      )}

      {editable && (
        <>
          {/* Atajos para teclear. NO usan `.chip-btn` a proposito: en el resto de
              la app ese pill es un chip de FILTRO (con `is-active`), y aqui la
              accion es AÑADIR. El mismo pill no puede significar dos cosas. */}
          <div className="chip-row">
            {SUGERIDOS.filter((c) => !yaEsta(c)).map((c) => (
              <button type="button" key={c} className="btn btn--ghost btn--sm" onClick={() => addItem(c)}>
                + {c.split(' ')[0]}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn--ghost btn--block" onClick={() => addItem()}>
            Agregar partida
          </button>
        </>
      )}

      {hayNegativo && (
        <p className="muted">
          Hay líneas en rojo: su importe <strong>no entra</strong> en el total de abajo.
        </p>
      )}

      <div className="total-row total-row--grand">
        <span>Fila 3 · OTROS GASTOS DIRECTOS (suma del desglose)</span>
        <strong>{formatMoney(fila3, baseCurrency)}</strong>
      </div>
    </>
  )
}
