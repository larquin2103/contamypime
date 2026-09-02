import { useMemo, useState } from 'react'
import { formatMoney } from '../../lib/currency'
import { totals, laborTotal, pctToRate, rateToPct, round2 } from '../../lib/fichaCosto'

// Modulo 'fichas' (F7) - Bloque 6: FINANCIEROS, OSDE y TRIBUTOS (Filas 8, 9 y 10).
//
//   Fila 8  - gastos financieros: SOLO intereses, comisiones bancarias y primas
//             de seguro. Nada mas entra aqui.
//   Fila 9  - financiamiento a la OSDE: NO APLICA a un actor no estatal. Va
//             PLEGADA, con su nota, porque la fila existe en el modelo oficial y
//             quitarla dejaria el documento sin una de las 16.
//   Fila 10 - gastos tributarios = (2 + 4.1 + 6.1 + 7.1) x (tipo Seg. Social +
//             tipo Utilizacion de la Fuerza de Trabajo). EXCLUYE expresamente la
//             Contribucion al Desarrollo Local.
//
// LA TRAMPA DE 100x: los dos tipos se GUARDAN en fraccion (12,5 % = 0.125) pero
// aqui se TECLEAN en PORCENTAJE, al reves que `utilityPct`/`capacityPct`, que ya
// van en porcentaje. La conversion la hace el MOTOR (`pctToRate`/`rateToPct`),
// probada con node, y no se repite en ninguna pantalla.
//
// La Resolucion NO FIJA esos tipos (remite a la legislacion tributaria): por
// defecto van en CERO y no se inventa ningun porcentaje.

export function TaxesBlock({ sheet, rows, baseCurrency, editable, onRows }) {
  const t = useMemo(() => totals(sheet), [sheet])
  // La fila 9 no aplica a un actor no estatal: nace plegada. Se despliega sola si
  // trae un valor (una ficha vieja, o una entidad que si la use).
  const [showOsde, setShowOsde] = useState(() => Number(sheet?.rows?.r9) > 0)

  const setRow = (key, value) => onRows({ ...rows, [key]: value })
  const num = (v) => Number(v) || 0

  // EL TEXTO TECLEADO VIVE AQUI Y EL REGISTRO SOLO SE ESCRIBE. Si el campo leyera
  // de vuelta la fraccion guardada, teclear "12." daria pctToRate("12.") = 0.12 y
  // el campo se repintaria como "12": EL PUNTO DECIMAL DESAPARECERIA antes de
  // poder escribir el 5, y el dueño no podria poner un 12,5 %. Es el unico sitio
  // del modulo con conversion, porque es el unico campo que se teclea en una
  // unidad distinta de la que se guarda. El padre monta este bloque con
  // `key={sheet.id}`, asi que abrir otra ficha reinicia estos textos.
  const [pct, setPct] = useState(() => ({
    taxSS: rows.taxSS ? String(rateToPct(rows.taxSS)) : '',
    taxFT: rows.taxFT ? String(rateToPct(rows.taxFT)) : ''
  }))
  const setTax = (key, text) => {
    setPct((p) => ({ ...p, [key]: text }))
    setRow(key, pctToRate(text))
  }

  // Base de la Fila 10, A LA VISTA: sin verla, el impuesto es un numero magico.
  // Se calcula IGUAL que `taxRow` en el motor, que descarta los negativos con su
  // `pos`: sumar con Number() pintaria una base distinta de la que se multiplica.
  const pos = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0 }
  const baseTributos = round2(
    laborTotal(sheet?.labor) + pos(rows.r41) + pos(rows.r61) + pos(rows.r71)
  )

  return (
    <>
      <div className="ficha-item">
        <label className="field">
          <span>Fila 8 · Gastos financieros ({baseCurrency})</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            value={!rows.r8 ? '' : rows.r8}
            readOnly={!editable}
            onChange={(e) => setRow('r8', e.target.value)}
            placeholder="0"
          />
        </label>
        <p className="muted">
          Solo <strong>intereses, comisiones bancarias y primas de seguro</strong>. Ningún otro
          gasto entra en esta fila.
        </p>
      </div>

      {/* Fila 9: existe en el modelo oficial, pero no aplica a un actor no
          estatal. Plegada por defecto para no invitar a rellenarla. */}
      <div className="ficha-item">
        <div className="kv">
          <span className="muted">Fila 9 · Financiamiento a la OSDE</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowOsde((v) => !v)}>
            {showOsde ? 'ocultar' : 'mostrar'}
          </button>
        </div>
        <p className="muted">
          <strong>No aplica a un actor no estatal.</strong> La fila se conserva porque es una de
          las 16 del modelo oficial.
        </p>
        {showOsde && (
          <label className="field">
            <span>Importe ({baseCurrency})</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              value={!rows.r9 ? '' : rows.r9}
              readOnly={!editable}
              onChange={(e) => setRow('r9', e.target.value)}
              placeholder="0"
            />
          </label>
        )}
      </div>

      <div className="ficha-item">
        <div className="form-row">
          <label className="field">
            <span>Contribución a la Seguridad Social (%)</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              value={pct.taxSS}
              readOnly={!editable}
              onChange={(e) => setTax('taxSS', e.target.value)}
              placeholder="0"
            />
          </label>
          <label className="field">
            <span>Utilización de la Fuerza de Trabajo (%)</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              value={pct.taxFT}
              readOnly={!editable}
              onChange={(e) => setTax('taxFT', e.target.value)}
              placeholder="0"
            />
          </label>
        </div>
        <p className="muted">
          Se teclean en <strong>por ciento</strong>. La Resolución <strong>no fija</strong> estos
          tipos: remite a la legislación tributaria, así que por defecto van en cero. La Fila 10
          <strong> excluye</strong> la Contribución al Desarrollo Local.
        </p>

        <div className="total-row">
          <span className="muted">Base: 2 + 4.1 + 6.1 + 7.1</span>
          <strong>{formatMoney(baseTributos, baseCurrency)}</strong>
        </div>
        <div className="total-row">
          <span className="muted">
            × {rateToPct(num(rows.taxSS) + num(rows.taxFT)).toString().replace('.', ',')} %
          </span>
          <strong>{formatMoney(t.r10, baseCurrency)}</strong>
        </div>
      </div>

      <div className="total-row total-row--grand">
        <span>Fila 11 · TOTAL DE GASTOS (6 + 7 + 8 + 9 + 10)</span>
        <strong>{formatMoney(t.r11, baseCurrency)}</strong>
      </div>
      <div className="total-row total-row--grand">
        {/* La Gaceta tiene una errata: el cuerpo dice "6+11" y el modelo del
            Anexo I rotula "(5+11)". Se implementa 5 + 11, que es la unica
            lectura coherente (con 6+11 las filas 1 a 4 desaparecerian del precio). */}
        <span>Fila 12 · TOTAL DE COSTOS Y GASTOS (5 + 11)</span>
        <strong>{formatMoney(t.r12, baseCurrency)}</strong>
      </div>
    </>
  )
}
