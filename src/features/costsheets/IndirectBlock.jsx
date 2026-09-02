import { useMemo } from 'react'
import { formatMoney } from '../../lib/currency'
import { indirectCheck, totals } from '../../lib/fichaCosto'

// Modulo 'fichas' (F7) - Bloque 5: GASTOS INDIRECTOS y el CONTROL A (Art. 9).
//
// Agrupa las tres filas que el control suma, aunque no sean la misma cosa:
//   Fila 4 - asociados a la produccion   (4.1 de ello, salarios)
//   Fila 6 - generales y de administracion (6.1 de ello, salarios)
//   Fila 7 - distribucion y venta        (7.1 de ello, salarios)
//
// CONTROL A:  Fila 4 + Fila 6 + Fila 7  <=  coeficiente x Fila 2
// Produccion 1,5 · servicios y gastronomia popular 1,0. Excederlo exige consulta
// previa al MFP, asi que la pantalla AVISA CON EL IMPORTE EXACTO del exceso y
// NUNCA BLOQUEA (Art. 6): un actor no estatal puede ajustar el modelo.
//
// SIN SALARIO DIRECTO (Fila 2 = 0) EL CONTROL NO OPINA: el motor devuelve
// `applies: false` y `coefficient: null`, y aqui el semaforo SE APAGA. El
// coeficiente se pinta "—", nunca "0,00": un cero se lee como "perfecto".
//
// Los subtotales "de ello, salarios" alimentan la Fila 10 (tributos), asi que un
// 4.1 mayor que su Fila 4 no es solo raro: infla el impuesto. Se avisa en rojo.

const FILAS = [
  { key: 'r4', sub: 'r41', n: '4', label: 'Asociados a la producción', help: 'mantenimiento, explotación de equipos, dirección de la producción, control de calidad, depreciación de activos fijos de producción' },
  { key: 'r6', sub: 'r61', n: '6', label: 'Generales y de administración', help: '' },
  { key: 'r7', sub: 'r71', n: '7', label: 'Distribución y venta', help: '' }
]

export function IndirectBlock({ sheet, rows, baseCurrency, editable, onRows }) {
  const chk = useMemo(() => indirectCheck(sheet), [sheet])
  const t = useMemo(() => totals(sheet), [sheet])

  const setRow = (key, value) => onRows({ ...rows, [key]: value })
  const num = (v) => Number(v) || 0

  return (
    <>
      {/* Semaforo del Art. 9: aviso con el importe exacto, nunca cerrojo. */}
      {!chk.applies ? (
        <p className="muted">
          Sin salario directo no hay base para este control: el límite del Art. 9 se mide
          <strong> contra la Fila 2</strong>, y hoy vale cero. Captura el bloque 3 para que el
          semáforo opine.
        </p>
      ) : chk.ok ? (
        <div className="cuadre-banner cuadre-banner--green">
          Dentro del límite. Tus indirectos suman {formatMoney(chk.sum, baseCurrency)} y el máximo
          es {formatMoney(chk.limit, baseCurrency)}.
        </div>
      ) : (
        <div className="cuadre-banner cuadre-banner--yellow">
          Te pasas por <strong>{formatMoney(chk.excess, baseCurrency)}</strong>. Límite:{' '}
          {chk.max.toString().replace('.', ',')} × salario directo ={' '}
          {formatMoney(chk.limit, baseCurrency)}. Tus indirectos suman{' '}
          {formatMoney(chk.sum, baseCurrency)}. Excederlo exige consulta previa al MFP.
        </div>
      )}

      {FILAS.map((f) => (
        <div className="ficha-item" key={f.key}>
          <label className="field">
            <span>Fila {f.n} · {f.label} ({baseCurrency})</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              value={!rows[f.key] ? '' : rows[f.key]}
              readOnly={!editable}
              onChange={(e) => setRow(f.key, e.target.value)}
              placeholder="0"
            />
          </label>
          {f.help && <p className="muted">Incluye {f.help}.</p>}
          <label className="field">
            <span>{f.n}.1 · De ello, salarios</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              value={!rows[f.sub] ? '' : rows[f.sub]}
              readOnly={!editable}
              onChange={(e) => setRow(f.sub, e.target.value)}
              placeholder="0"
            />
          </label>
          {num(rows[f.sub]) > num(rows[f.key]) && (
            <p className="error">
              “De ello, salarios” no puede ser mayor que su propia Fila {f.n}: es una parte de
              ella. Además entra en la base de la Fila 10, así que un valor de más
              <strong> infla el impuesto</strong>.
            </p>
          )}
        </div>
      ))}

      <div className="total-row">
        <span className="muted">4 + 6 + 7</span>
        <strong>{formatMoney(chk.sum, baseCurrency)}</strong>
      </div>
      <div className="total-row">
        <span className="muted">Coeficiente aplicado</span>
        {/* `null` se pinta "—", NUNCA "0,00": un cero se lee como "perfecto". */}
        <strong>{chk.coefficient == null ? '—' : chk.coefficient.toFixed(2).replace('.', ',')}</strong>
      </div>
      <div className="total-row">
        <span className="muted">Máximo del Art. 9 para esta actividad</span>
        <strong>{chk.max.toFixed(2).replace('.', ',')}</strong>
      </div>

      <div className="total-row total-row--grand">
        <span>Fila 5 · COSTO TOTAL (1 + 2 + 3 + 4)</span>
        <strong>{formatMoney(t.r5, baseCurrency)}</strong>
      </div>
    </>
  )
}
