import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { costSheetsRepo } from '../../repositories/costSheetsRepo'
import { recipesRepo } from '../../repositories/recipesRepo'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { matchesQuery } from '../../lib/search'
import { formatMoney, isForeignPriced } from '../../lib/currency'
import { inputsTotal, carriersTotal, totals, inputLineFor, recipeToInputs } from '../../lib/fichaCosto'
import { UNIT_LABELS } from '../../db/constants'

// Modulo 'fichas' (F5) - Bloque 2: GASTO MATERIAL (Fila 1 del Anexo I).
//
//   1.1 Insumos  = anexo "Desagregacion de los insumos fundamentales"
//   1.2 Combustibles y lubricantes  ·  1.3 Energia electrica  ·  1.4 Agua
//   Fila 1 = 1.1 + 1.2 + 1.3 + 1.4
//
// Los PORTADORES van aparte porque en una MYPIME el combustible, la corriente y
// el agua NO son productos del catalogo: se capturan como cantidad x precio.
//
// El precio unitario del insumo es `product.cost` CONGELADO al traerlo y
// EDITABLE linea por linea (decision del dueño): no se deriva de `purchases`
// (falla en productos sin compras) ni se teclea siempre a mano.

// Unidad de cada portador segun el modelo oficial del anexo.
const CARRIERS = [
  { key: 'fuel', row: '1.2', label: 'Combustibles y lubricantes', unit: 'L' },
  { key: 'energy', row: '1.3', label: 'Energía eléctrica', unit: 'kw' },
  { key: 'water', row: '1.4', label: 'Agua', unit: 'm³' }
]

// El importe de UNA linea se pide al MOTOR (pasandole una lista de una), en vez
// de repetir aqui la formula. Asi la pantalla y el PDF no pueden discrepar: el
// motor redondea POR LINEA y luego suma, que es lo que mira un inspector.
const lineAmount = (line) => inputsTotal([line])
const carrierAmount = (c) => carriersTotal({ fuel: c })

export function InputsBlock({ sheet, inputs, carriers, products, editable, onInputs, onCarriers }) {
  const { baseCurrency, rateOf } = useCurrency()
  const { hasModule } = useLicense()

  // null = solo la lista capturada; 'catalogo' = selector; 'receta' = importar.
  const [mode, setMode] = useState(null)
  const [query, setQuery] = useState('')
  const [onlyStock, setOnlyStock] = useState(true) // encendido por defecto y apagable
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const canKitchen = hasModule(LICENSE_MODULES.KITCHEN)
  // Gateado EN LA CONSULTA: sin la licencia 'cocina' no se lee ninguna receta.
  const recipes = useLiveQuery(
    () => (canKitchen ? recipesRepo.listActive() : Promise.resolve([])),
    [canKitchen],
    []
  )

  // Costo Base (columna 4 del anexo): solo existe cuando la ficha es una REVISION,
  // que es exactamente para lo que la norma pide esa columna. Hasta F8 no nacen
  // revisiones, asi que esto queda dormido: es data-driven, no una pantalla aparte.
  const baseSheet = useLiveQuery(
    () => (sheet?.baseFromSheetId ? costSheetsRepo.get(sheet.baseFromSheetId) : Promise.resolve(null)),
    [sheet?.baseFromSheetId],
    null
  )

  const usedIds = useMemo(() => new Set(inputs.map((i) => i.productId).filter(Boolean)), [inputs])

  // Un solo paso por el motor: `r1_1` es el total del anexo y `r1` la Fila 1
  // completa (1.1 + 1.2 + 1.3 + 1.4). No se recalcula nada aqui.
  const t = useMemo(() => totals({ inputs, carriers }), [inputs, carriers])
  const fila11 = t.r1_1
  const fila1 = t.r1

  // Catalogo elegible: sin lo ya capturado y sin el propio producto de la ficha
  // (un producto no puede ser insumo de si mismo).
  const eligible = useMemo(() => {
    let list = products.filter((p) => !usedIds.has(p.id) && p.id !== sheet?.productId)
    if (onlyStock) list = list.filter((p) => Number(p.stock || 0) > 0)
    if (query.trim()) list = list.filter((p) => matchesQuery(p, query))
    return [...list].sort((a, b) => a.name.localeCompare(b.name))
  }, [products, usedIds, sheet?.productId, onlyStock, query])

  // La linea la construye el MOTOR (`inputLineFor`), no la pantalla: el precio
  // unitario congelado, el par moneda + tasa de `divisas` y la limpieza de la
  // cantidad son la misma regla en las dos entradas del bloque (catalogo y
  // receta), y ahi se puede probar con node.
  const addProduct = (p) => {
    setMsg('')
    setError('')
    onInputs([...inputs, inputLineFor(p, { rateOf })])
    setMode(null)
    setQuery('')
  }

  const setLine = (idx, patch) => {
    onInputs(inputs.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  }

  const removeLine = (idx) => {
    setMsg('')
    onInputs(inputs.filter((_, i) => i !== idx))
  }

  const setCarrier = (key, patch) => {
    onCarriers({ ...carriers, [key]: { ...(carriers?.[key] || {}), ...patch } })
  }

  // Importar desde una receta de 'cocina'. La ficha se queda con SU COPIA
  // congelada: no queda atada a la receta.
  //
  // La regla (y sobre todo LA ESCALA, que vale x nivel de produccion) vive en
  // `recipeToInputs`, en el motor, con sus aserciones de node. Aqui solo se le
  // pasan los datos y se cuenta lo que decidio dejar fuera: nada se cuela en
  // silencio, ni un insumo borrado del catalogo ni uno en divisa sin tasa.
  const importRecipe = (r) => {
    setMsg('')
    setError('')
    const level = Number(sheet?.productionLevel) || 0
    const res = recipeToInputs({
      items: r.items,
      productById: new Map(products.map((p) => [p.id, p])),
      usedIds,
      level,
      rateOf
    })
    if (res.error === 'sin-nivel') {
      setError('Pon primero el nivel de producción en el bloque 1: la receta define el consumo de UNA unidad y hay que multiplicarlo.')
      return
    }
    const sinTasa = res.missingRate.length
      ? ` ${res.missingRate.length} no se trajeron porque falta su tasa de cambio: ${res.missingRate.join(', ')}.`
      : ''
    if (!res.lines.length) {
      setError(`Esa receta no aporta ningún insumo nuevo a esta ficha.${sinTasa}`)
      return
    }
    // Se AÑADE, no se reemplaza: borrarle al dueño lo que ya capturó seria peor.
    onInputs([...inputs, ...res.lines])
    setMode(null)
    setMsg(
      `Traídos ${res.lines.length} insumos de «${r.name}», multiplicados por el nivel de producción (${level}).` +
      (res.repeated ? ` ${res.repeated} ya estaban en la ficha.` : '') +
      (res.missing ? ` ${res.missing} ya no están en el catálogo.` : '') +
      sinTasa
    )
  }

  // --- Costo Base y su delta (solo si la ficha es revision) -----------------
  const baseFila1 = baseSheet ? totals(baseSheet).r1 : null
  const delta = baseFila1 == null ? null : Math.round((fila1 - baseFila1) * 100) / 100
  const deltaPct = baseFila1 ? Math.round(((fila1 - baseFila1) / baseFila1) * 1000) / 10 : null
  // EL COLOR VA INVERTIDO respecto al signo, a proposito. `.kpi__delta--up` es
  // verde y `--down` es rojo porque estan pensados para ventas, donde subir es
  // bueno. EN UNA FICHA DE COSTO SUBIR ES MALO: un "+5,6 % de gasto material"
  // pintado en verde le mentiria al dueño en la unica pantalla cuyo trabajo es
  // avisarle de que el costo se le fue. No se crean clases nuevas: se elige.
  const deltaClass = delta == null || delta === 0
    ? 'kpi__delta--flat'
    : delta > 0 ? 'kpi__delta--down' : 'kpi__delta--up'

  return (
    <>
      {error && <p className="error">{error}</p>}
      {msg && <p className="muted">{msg}</p>}

      {mode === 'catalogo' ? (
        <>
          <div className="chip-row">
            <button
              className={`chip-btn ${onlyStock ? 'is-active' : ''}`}
              onClick={() => setOnlyStock((v) => !v)}
            >
              {onlyStock ? '✓ ' : ''}Solo con existencia
            </button>
          </div>
          <input
            className="search-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar en el catálogo…"
          />
          <div className="product-list">
            {eligible.map((p) => {
              // Producto en divisa sin tasa definida: NO se puede traer, porque su
              // importe seria 0 en silencio. Mismo candado que al vender.
              const foreign = isForeignPriced(p, baseCurrency)
              const sinTasa = foreign && !(rateOf(p.priceCurrency) > 0)
              return (
                <button
                  key={p.id}
                  className="product-row"
                  disabled={sinTasa}
                  onClick={() => addProduct(p)}
                >
                  <div className="product-row__main">
                    <strong>{p.name}</strong>
                    <span className="muted">
                      {p.code ? `${p.code} · ` : ''}{UNIT_LABELS[p.unit] || p.unit}
                      {` · existencia ${Number(p.stock || 0)} ${p.unit || 'u'}`}
                    </span>
                  </div>
                  <div className="product-row__meta">
                    {sinTasa
                      ? <span className="badge badge--warn">Falta tasa</span>
                      : <span className="price">{formatMoney(p.cost, p.priceCurrency || baseCurrency)}</span>}
                    <span className="stock">costo</span>
                  </div>
                </button>
              )
            })}
            {eligible.length === 0 && (
              <p className="muted">
                {query.trim()
                  ? `Sin resultados para “${query}”.`
                  : onlyStock
                    ? 'Ningún producto con existencia por traer. Apaga “Solo con existencia” para ver todo el catálogo.'
                    : 'No queda nada del catálogo por traer.'}
              </p>
            )}
          </div>
          <button className="btn btn--ghost btn--block" onClick={() => { setMode(null); setQuery('') }}>
            Cancelar
          </button>
        </>
      ) : mode === 'receta' ? (
        <>
          <p className="muted">
            La receta define el consumo de <strong>una unidad</strong>. Se multiplicará por el
            nivel de producción de esta ficha ({Number(sheet?.productionLevel) || 0} {sheet?.unit || 'u'}).
          </p>
          <div className="product-list">
            {[...recipes].sort((a, b) => a.name.localeCompare(b.name)).map((r) => (
              <button key={r.id} className="product-row" onClick={() => importRecipe(r)}>
                <div className="product-row__main">
                  <strong>{r.name}</strong>
                  <span className="muted">{(r.items || []).length} insumos</span>
                </div>
              </button>
            ))}
            {recipes.length === 0 && <p className="muted">No hay recetas activas.</p>}
          </div>
          <button className="btn btn--ghost btn--block" onClick={() => setMode(null)}>Cancelar</button>
        </>
      ) : (
        <>
          {/* 1.1 Insumos: el anexo, linea por linea. */}
          {inputs.map((l, idx) => {
            const foreign = !!(l.priceCurrency && l.priceCurrency !== baseCurrency)
            return (
              <div className="ficha-item" key={`${l.productId || 'libre'}-${idx}`}>
                <div className="kv">
                  <span><strong>{l.name || 'Insumo sin nombre'}</strong></span>
                  {editable && (
                    <button className="link-del" onClick={() => removeLine(idx)}>quitar</button>
                  )}
                </div>
                <span className="muted">
                  {l.code ? `${l.code} · ` : ''}{UNIT_LABELS[l.unit] || l.unit || 'u'}
                </span>
                <div className="form-row">
                  <label className="field">
                    <span>Norma de consumo ({l.unit || 'u'})</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      value={!l.qty ? '' : l.qty}
                      readOnly={!editable}
                      onChange={(e) => setLine(idx, { qty: e.target.value })}
                      placeholder="0"
                    />
                  </label>
                  <label className="field">
                    <span>Precio unitario ({l.priceCurrency || baseCurrency})</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      value={!l.unitPrice ? '' : l.unitPrice}
                      readOnly={!editable}
                      onChange={(e) => setLine(idx, { unitPrice: e.target.value })}
                      placeholder="0"
                    />
                  </label>
                </div>
                <div className="total-row">
                  <span className="muted">(5) × (6){foreign && ` · tasa congelada ${l.priceRate || 0}`}</span>
                  <strong>{formatMoney(lineAmount(l), baseCurrency)}</strong>
                </div>
                {foreign && !(Number(l.priceRate) > 0) && (
                  <p className="error">
                    Esta línea está en {l.priceCurrency} y no tiene tasa congelada: su importe
                    cuenta como cero. Quítala y vuelve a traerla con la tasa definida.
                  </p>
                )}
              </div>
            )
          })}

          {inputs.length === 0 && (
            <p className="muted">
              Todavía no hay insumos. El Art. 5 obliga a desagregar los <strong>insumos
              principales</strong> en un anexo independiente.
            </p>
          )}

          {editable && (
            <>
              <button className="btn btn--ghost btn--block" onClick={() => { setMode('catalogo'); setError('') }}>
                Agregar insumo del catálogo
              </button>
              {/* Solo con la licencia 'cocina'. Sin ella la opcion ni aparece. */}
              {canKitchen && (
                <button className="btn btn--ghost btn--block" onClick={() => { setMode('receta'); setError('') }}>
                  Traer insumos de una receta
                </button>
              )}
            </>
          )}

          <p className="muted">
            Las normas de consumo son las del <strong>nivel de producción completo</strong>
            ({Number(sheet?.productionLevel) || 0} {sheet?.unit || 'u'}), no las de una unidad.
            Si cambias el nivel en el bloque 1, hay que revisarlas.
          </p>

          <div className="total-row total-row--grand">
            <span>1.1 INSUMOS</span>
            <strong>{formatMoney(fila11, baseCurrency)}</strong>
          </div>

          {/* Portadores (1.2, 1.3 y 1.4): no son productos del catalogo. */}
          <h4 className="section-title">Portadores</h4>
          {CARRIERS.map((c) => {
            const val = carriers?.[c.key] || {}
            return (
              <div className="ficha-item" key={c.key}>
                <div className="kv">
                  <span><strong>{c.label}</strong></span>
                  <span className="muted">{c.row}</span>
                </div>
                <div className="form-row">
                  <label className="field">
                    <span>Cantidad ({c.unit})</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      value={!val.qty ? '' : val.qty}
                      readOnly={!editable}
                      onChange={(e) => setCarrier(c.key, { qty: e.target.value })}
                      placeholder="0"
                    />
                  </label>
                  <label className="field">
                    <span>Precio unitario ({baseCurrency})</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      value={!val.unitPrice ? '' : val.unitPrice}
                      readOnly={!editable}
                      onChange={(e) => setCarrier(c.key, { unitPrice: e.target.value })}
                      placeholder="0"
                    />
                  </label>
                </div>
                <div className="total-row">
                  <span className="muted">cantidad × precio</span>
                  <strong>{formatMoney(carrierAmount(val), baseCurrency)}</strong>
                </div>
              </div>
            )
          })}
          <p className="muted">
            El combustible incluye sus <strong>tasas de recargo</strong>; la energía y el agua van
            a la <strong>tarifa que paga el negocio</strong>.
          </p>

          <div className="total-row total-row--grand">
            <span>Fila 1 · GASTO MATERIAL (1.1 + 1.2 + 1.3 + 1.4)</span>
            <strong>{formatMoney(fila1, baseCurrency)}</strong>
          </div>

          {/* Costo Base: solo cuando la ficha es revision (columna 4 del anexo). */}
          {baseFila1 != null && (
            <div className="total-row">
              <span className="muted">Costo base {formatMoney(baseFila1, baseCurrency)}</span>
              <span className={`kpi__delta ${deltaClass}`}>
                {delta > 0 ? '▲' : delta < 0 ? '▼' : '='} {formatMoney(Math.abs(delta), baseCurrency)}
                {deltaPct != null && ` · ${Math.abs(deltaPct)} %`}
              </span>
            </div>
          )}
        </>
      )}
    </>
  )
}
