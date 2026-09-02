import { useMemo } from 'react'
import { formatMoney } from '../../lib/currency'
import {
  FICHA_METHODS,
  totals,
  priceRows,
  utilityBase,
  utilityBaseRows,
  utilityRate,
  maxUtility,
  fichaWarnings
} from '../../lib/fichaCosto'
import { FICHA_ACTIVITY_LABELS } from '../../db/constants'

// Modulo 'fichas' (F7) - Bloque 7: UTILIDAD Y PRECIO (Filas 13, 14 y 15).
//
// POR GASTOS      13 = base x tasa        ·  14 = 12 + 13
// POR CORRELACION 14 = precio del similar ·  13 = 14 - 12  (puede ser NEGATIVA)
//                 15 = 14 / nivel de produccion
//
// CONTROL B - LA BASE NO ES EL TOTAL. Es la nota ** del Anexo II y el detalle que
// casi todos pierden: la base es 2 + 3 + 4, no la Fila 12. Con la Fila 12 el
// fixture "Pan suave" daria 7 891,25 de utilidad en vez de 2 450,00 y un unitario
// de 197,28 en vez de 170,08. Por eso la pantalla ENSEÑA LA RESTA, no solo el
// resultado, y QUE filas la componen lo decide el motor (`utilityBaseRows`), que
// es donde vive la excepcion del Anexo II.
//
// CONTROL C - SUBSIDIO. Por correlacion la utilidad NO se teclea: se deriva del
// precio del similar. Si sale negativa hay subsidio, que la norma prohibe como
// regla, y ahi el aviso se pone rojo. Un campo en blanco NO es un subsidio: el
// aviso solo sale con un precio capturado.
//
// Los dos avisos son AVISOS (Art. 6): ninguno bloquea la ficha, y los dos salen
// de `fichaWarnings`, que es la unica fuente de los semaforos.

// Etiqueta de cada fila que puede componer la base.
const ROW_LABELS = {
  r2: 'Fila 2 · salario directo',
  r3: 'Fila 3 · otros gastos directos',
  r4: 'Fila 4 · asociados a la producción',
  r7: 'Fila 7 · distribución y venta',
  r12: 'Fila 12 · total de costos y gastos'
}

export function UtilityBlock({ sheet, baseCurrency, editable, onMethod, onUtilityPct, onCorrelationPrice }) {
  const t = useMemo(() => totals(sheet), [sheet])
  const pr = useMemo(() => priceRows(sheet), [sheet])
  const warns = useMemo(() => fichaWarnings(sheet), [sheet])

  const correlacion = sheet.method === FICHA_METHODS.CORRELACION
  const max = maxUtility(sheet.activity)
  const rate = utilityRate(sheet)
  const base = utilityBase(sheet)
  const baseRows = utilityBaseRows(sheet)

  const sobreMaximo = warns.find((w) => w.code === 'utilidad-sobre-maximo')
  const subsidio = warns.find((w) => w.code === 'subsidio')
  const nivel = Number(sheet.productionLevel) || 0

  const pctText = (v) => (v == null ? '—' : `${Math.round(v * 1000) / 10} %`.replace('.', ','))

  return (
    <>
      {/* El metodo tambien vive en el bloque 1 (es identificacion). Aqui se
          repite porque es AQUI donde se ve su consecuencia; los dos escriben el
          mismo campo. */}
      <div className="seg">
        <button
          type="button"
          className={`seg__btn ${!correlacion ? 'seg__btn--on' : ''}`}
          disabled={!editable}
          onClick={() => onMethod(FICHA_METHODS.GASTOS)}
        >
          Por gastos
        </button>
        <button
          type="button"
          className={`seg__btn ${correlacion ? 'seg__btn--on' : ''}`}
          disabled={!editable}
          onClick={() => onMethod(FICHA_METHODS.CORRELACION)}
        >
          Por correlación
        </button>
      </div>

      {correlacion ? (
        <>
          {/* CONTROL C. Solo con un precio capturado: un campo en blanco no es
              un subsidio. */}
          {subsidio && (
            <div className="cuadre-banner cuadre-banner--red">
              <strong>Estarías subsidiando.</strong> El precio por correlación queda{' '}
              {formatMoney(Math.abs(subsidio.amount), baseCurrency)} por debajo de tus costos y
              gastos. La norma prohíbe el subsidio como regla.
            </div>
          )}

          <div className="ficha-item">
            <label className="field">
              <span>Precio del similar, por correlación ({baseCurrency})</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={!sheet.correlationPrice ? '' : sheet.correlationPrice}
                readOnly={!editable}
                onChange={(e) => onCorrelationPrice(e.target.value)}
                placeholder="0"
              />
            </label>
            <p className="muted">
              Precio de un similar de exportación, de importación o de un sustituto interno de
              calidad equivalente. La <strong>evidencia</strong> de ese precio va en el bloque de
              precios de referencia (Fila 16): es lo que lo sostiene ante un control.
            </p>
          </div>

          <div className="total-row">
            <span className="muted">Fila 12 · costos y gastos</span>
            <strong>{formatMoney(t.r12, baseCurrency)}</strong>
          </div>
          <div className="total-row">
            <span className="muted">13 = correlación − 12</span>
            <strong>{formatMoney(pr.r13, baseCurrency)}</strong>
          </div>
          <p className="muted">
            Por correlación la utilidad <strong>no se teclea: se deriva</strong> del precio del
            similar.
          </p>
        </>
      ) : (
        <>
          <div className="total-row">
            <span className="muted">Actividad</span>
            <strong>{FICHA_ACTIVITY_LABELS[sheet.activity] || 'sin definir'}</strong>
          </div>
          <div className="total-row">
            <span className="muted">Tasa máxima (Anexo II)</span>
            <strong>{pctText(max)}</strong>
          </div>
          {max == null && (
            <p className="error">
              Sin actividad definida no hay tasa máxima de referencia, así que la ficha
              <strong> no propone utilidad</strong>. Elige la actividad en el bloque 1.
            </p>
          )}

          {/* CONTROL B: se ensena la RESTA, no solo el resultado. */}
          <div className="ficha-item">
            <div className="kv">
              <span className="muted">BASE DE LA UTILIDAD</span>
              <span className="badge badge--muted">no es el total</span>
            </div>
            {baseRows.map((k) => (
              <div className="total-row" key={k}>
                <span className="muted">{ROW_LABELS[k] || k}</span>
                <strong>{formatMoney(t[k], baseCurrency)}</strong>
              </div>
            ))}
            <div className="total-row total-row--grand">
              <span>{baseRows.map((k) => k.replace('r', '')).join(' + ')}</span>
              <strong>{formatMoney(base, baseCurrency)}</strong>
            </div>
            <p className="muted">
              La nota del Anexo II dice que la base <strong>no es</strong> el total de costos y
              gastos
              {baseRows.length === 1
                ? ', salvo en agropecuaria, alta tecnología, informática y ciencia, que es justo esta actividad: aquí sí es la Fila 12 entera.'
                : '. Con la Fila 12 como base, la utilidad saldría varias veces mayor.'}
            </p>
          </div>

          {/* La tasa del dueño. Nace con el maximo de su actividad ya puesto, asi
              que sin tocarla se comporta igual que cuando no era editable.
              Pasarse NO se recorta: se avisa con el exceso en importe (Art. 6). */}
          <label className="field">
            <span>Tasa de utilidad aplicada (%)</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              value={sheet.utilityPct == null ? '' : sheet.utilityPct}
              readOnly={!editable}
              onChange={(e) => onUtilityPct(e.target.value)}
              placeholder={max == null ? '0' : String(Math.round(max * 1000) / 10)}
            />
          </label>
          {sobreMaximo ? (
            <div className="cuadre-banner cuadre-banner--yellow">
              Estás <strong>{formatMoney(sobreMaximo.excess, baseCurrency)}</strong> por encima del
              máximo del Anexo II ({pctText(sobreMaximo.max)}). Para una MYPIME el Anexo II es
              referencia, no obligación (Art. 6): la ficha <strong>no recorta</strong> tu tasa,
              solo te lo dice.
            </div>
          ) : (
            <p className="muted">
              Máximo {pctText(max)} de {formatMoney(base, baseCurrency)}
              {rate != null && max != null && rate === max && <> · <span className="badge badge--ok">al tope</span></>}
            </p>
          )}
        </>
      )}

      <div className="total-row total-row--grand">
        <span>Fila 13 · UTILIDAD</span>
        <strong>{formatMoney(pr.r13, baseCurrency)}</strong>
      </div>
      {!correlacion && (
        <div className="total-row">
          <span className="muted">Fila 12 · costos y gastos</span>
          <strong>{formatMoney(t.r12, baseCurrency)}</strong>
        </div>
      )}
      <div className="total-row total-row--grand">
        <span>Fila 14 · PRECIO O TARIFA (12 + 13)</span>
        <strong>{formatMoney(pr.r14, baseCurrency)}</strong>
      </div>
      <div className="total-row total-row--grand">
        <span>Fila 15 · PRECIO UNITARIO (14 ÷ {nivel || '—'} {sheet.unit || 'u'})</span>
        <strong>{formatMoney(pr.r15, baseCurrency)}</strong>
      </div>
      {!nivel && (
        <p className="error">
          Sin nivel de producción no hay precio unitario: la Fila 15 divide entre él. Ponlo en el
          bloque 1.
        </p>
      )}
    </>
  )
}
