import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { costSheetsRepo } from '../../repositories/costSheetsRepo'
import { productsRepo } from '../../repositories/productsRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { matchesQuery } from '../../lib/search'
import { formatMoney } from '../../lib/currency'
import {
  FICHA_ACTIVITIES,
  FICHA_METHODS,
  FICHA_STATUS,
  canEditSheet,
  maxUtility,
  priceRows,
  totals
} from '../../lib/fichaCosto'
import { InputsBlock } from './InputsBlock'
import {
  UNITS,
  UNIT_LABELS,
  FICHA_ACTIVITY_LABELS,
  FICHA_METHOD_LABELS,
  FICHA_STATUS_LABELS
} from '../../db/constants'

// Modulo 'fichas' (F4) - Editor de la ficha de costo. En esta fase vive SOLO el
// bloque 1 (Identificacion); los bloques 2 a 9 llegan en F5 a F8.
//
// La identificacion va primero porque el TIPO DE ACTIVIDAD del Anexo II y el
// METODO de formacion del precio cambian todo lo de abajo: la tasa maxima de
// utilidad, la base sobre la que se aplica y el coeficiente de indirectos.
//
// El precio unitario vive fijo en la barra inferior (patron `.pay-bar` del POS)
// y se actualiza mientras se escribe: nunca se pierde de vista el resultado.

const AUTOSAVE_MS = 600 // el borrador se guarda solo; cada guardado sella updatedAt

// Los campos del bloque 1. Se guardan como TEXTO en el formulario (el repo los
// normaliza con `num`/`txt`) para no pelear con lo que se esta teclando.
const EMPTY = {
  name: '',
  productId: null,
  code: '',
  unit: 'u',
  productionLevel: '',
  capacityPct: '',
  activity: FICHA_ACTIVITIES.BIENES,
  method: FICHA_METHODS.GASTOS,
  // Bloque 2 (F5). Los portadores llevan SIEMPRE las tres filas, aunque valgan
  // cero: son filas del modelo oficial, no campos opcionales.
  inputs: [],
  carriers: { fuel: { qty: 0, unitPrice: 0 }, energy: { qty: 0, unitPrice: 0 }, water: { qty: 0, unitPrice: 0 } }
}

// Un bloque del acordeon. Cerrado ensena su total; abierto, la ✕ para plegarlo
// (el total vive entonces al pie del cuerpo). Solo uno abierto a la vez: en un
// telefono dos cuerpos abiertos hacen la ficha inusable, que es justo el problema
// que este diseno resuelve.
function Block({ n, title, closedInfo, open, onToggle, children }) {
  return (
    <section className="card">
      <button className="ficha-block__head" onClick={onToggle}>
        <h3 className="section-title">{n} · {title}</h3>
        <span className="ficha-block__total">{open ? '✕' : closedInfo}</span>
      </button>
      {open && children}
    </section>
  )
}

const pick = (s) => ({
  name: s.name || '',
  productId: s.productId || null,
  code: s.code || '',
  unit: s.unit || 'u',
  productionLevel: s.productionLevel == null ? '' : String(s.productionLevel),
  capacityPct: s.capacityPct == null ? '' : String(s.capacityPct),
  activity: s.activity || FICHA_ACTIVITIES.BIENES,
  method: s.method || FICHA_METHODS.GASTOS,
  inputs: Array.isArray(s.inputs) ? s.inputs : [],
  carriers: s.carriers || EMPTY.carriers
})

export function CostSheetScreen() {
  const { id } = useParams() // sin id = alta (/ficha/nueva)
  const isNew = !id
  const navigate = useNavigate()
  const { user, isManager } = useAuth()
  const { baseCurrency } = useCurrency()
  const { hasModule } = useLicense()

  // Compuerta EN LA CONSULTA: sin licencia o sin ser mando no se lee nada.
  const canFichas = isManager && hasModule(LICENSE_MODULES.COSTSHEETS)
  const sheet = useLiveQuery(
    () => (canFichas && id ? costSheetsRepo.get(id) : Promise.resolve(null)),
    [canFichas, id],
    undefined
  )
  const products = useLiveQuery(
    () => (canFichas ? productsRepo.listActive() : Promise.resolve([])),
    [canFichas],
    []
  )

  const [form, setForm] = useState(EMPTY)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')
  const [openBlock, setOpenBlock] = useState(1) // acordeon: un bloque a la vez

  // Espejos para el volcado final: si se sale de la pantalla con el temporizador
  // del autoguardado pendiente, se escribe igual (Dexie sobrevive al desmontaje).
  const loadedId = useRef(null)
  const formRef = useRef(form)
  const dirtyRef = useRef(false)
  formRef.current = form
  dirtyRef.current = dirty

  const editable = isNew || canEditSheet(sheet)

  // Carga el borrador en el formulario UNA sola vez por ficha. NO se resincroniza
  // en cada cambio de la base: eso pisaria lo que se esta escribiendo. El otro
  // sentido (formulario -> base) lo hace el autoguardado.
  useEffect(() => {
    if (isNew || !sheet || loadedId.current === sheet.id) return
    loadedId.current = sheet.id
    setForm(pick(sheet))
    setDirty(false)
  }, [sheet, isNew])

  // Autoguardado del BORRADOR. Solo corre si el dueño toco algo (`dirty`): sin esa
  // guarda, con solo ABRIR la ficha se sellaria `updatedAt` y el registro subiria a
  // la nube sin haber cambiado nada.
  useEffect(() => {
    if (!dirty || isNew || !id || !editable) return
    const t = setTimeout(() => {
      costSheetsRepo
        .update(id, form)
        .then(() => { setDirty(false); setSaved(true); setError('') })
        .catch((e) => setError(e.message))
    }, AUTOSAVE_MS)
    return () => clearTimeout(t)
  }, [dirty, form, id, isNew, editable])

  // Volcado al salir: rescata el ultimo tecleo si aun no habia vencido el timer.
  useEffect(() => {
    return () => {
      if (dirtyRef.current && id) {
        costSheetsRepo.update(id, formRef.current).catch(() => { /* la pantalla ya se fue */ })
      }
    }
  }, [id])

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }))
    setDirty(true)
    setSaved(false)
  }

  // Toma nombre, codigo y UM del producto del catalogo (un servicio va por texto
  // libre, sin producto). La ficha se queda con SU COPIA: no queda atada al
  // catalogo, igual que las lineas de venta congelan su precio.
  const takeProduct = (p) => {
    setForm((f) => ({ ...f, productId: p.id, name: p.name, code: p.code || '', unit: p.unit || 'u' }))
    setDirty(true)
    setSaved(false)
    setPicking(false)
    setQuery('')
  }

  const results = useMemo(() => {
    if (!picking) return []
    const list = query.trim() ? products.filter((p) => matchesQuery(p, query)) : products
    // Se lista TODO lo que coincide, como el Catalogo: cortar en silencio
    // esconderia justo el producto que se busca.
    return [...list].sort((a, b) => a.name.localeCompare(b.name))
  }, [picking, products, query])

  // La ficha "en vivo": lo guardado MAS lo que se acaba de teclear. Todos los
  // totales y la barra inferior se calculan sobre esto, para que se muevan
  // mientras se escribe (aun sin haber guardado).
  const merged = useMemo(
    () => ({ ...(sheet || {}), ...form, productionLevel: Number(form.productionLevel) || 0 }),
    [sheet, form]
  )
  const unitPrice = useMemo(() => priceRows(merged).r15, [merged])
  const t = useMemo(() => totals(merged), [merged])

  const crear = async () => {
    setError('')
    if (!form.name.trim()) {
      setError('Ponle nombre a la ficha (o elige un producto del catálogo)')
      return
    }
    setBusy(true)
    try {
      const newId = await costSheetsRepo.create({ ...form, userId: user?.id || null })
      setDirty(false) // ya quedo escrito: el autoguardado no tiene nada que rescatar
      navigate(`/ficha/${newId}`, { replace: true })
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  // --- Compuertas -----------------------------------------------------------
  if (!hasModule(LICENSE_MODULES.COSTSHEETS)) {
    return (
      <div className="screen">
        <h2>Ficha de costo</h2>
        <section className="card">
          <p>El módulo <strong>Fichas de costo</strong> no está activo en esta licencia.</p>
          <Link className="btn btn--primary btn--block" to="/">Volver al inicio</Link>
        </section>
      </div>
    )
  }
  if (!isManager) {
    return (
      <div className="screen">
        <h2>Ficha de costo</h2>
        <section className="card">
          <p>Solo el <strong>dueño o un administrativo</strong> trabaja las fichas de costo.</p>
          <Link className="btn btn--primary btn--block" to="/">Volver al inicio</Link>
        </section>
      </div>
    )
  }
  if (!isNew && sheet === undefined) {
    return <div className="screen"><p className="muted">Cargando…</p></div>
  }
  if (!isNew && !sheet) {
    return (
      <div className="screen">
        <h2>Ficha de costo</h2>
        <section className="card">
          <p>Esta ficha no existe en este dispositivo.</p>
          <Link className="btn btn--primary btn--block" to="/fichas">Volver a las fichas</Link>
        </section>
      </div>
    )
  }

  const maxPct = maxUtility(form.activity)

  return (
    <div className={`screen ${isNew ? '' : 'screen--paybar'}`}>
      <Link className="btn btn--ghost btn--sm" to="/fichas">← Fichas de costo</Link>
      <h2>{isNew ? 'Nueva ficha de costo' : form.name || 'Ficha sin nombre'}</h2>

      {!isNew && (
        <p className="muted">
          <span className="badge">{FICHA_STATUS_LABELS[sheet.status] || sheet.status}</span>
          {Number(sheet.version) > 1 && <> · versión {sheet.version}</>}
          {saved && <> · guardado</>}
        </p>
      )}

      {/* FUERA del acordeon a proposito: si el autoguardado falla mientras se
          teclea en otro bloque, el aviso tiene que verse igual. */}
      {error && <p className="error">{error}</p>}

      {/* Por que no se edita. Aprobada NO es un problema (verde): es el estado al
          que aspira la ficha. Sustituida y eliminada son historico (ambar). */}
      {!isNew && !editable && (
        <div
          className={`cuadre-banner ${
            sheet.status === FICHA_STATUS.APROBADA && !sheet.deletedAt
              ? 'cuadre-banner--green'
              : 'cuadre-banner--yellow'
          }`}
        >
          {sheet.deletedAt
            ? 'Esta ficha está eliminada. Nada se borra: se conserva como histórico y no admite cambios.'
            : sheet.status === FICHA_STATUS.APROBADA
              ? 'Ficha aprobada: es el documento con el que se sostuvo un precio, así que es inmutable. Para corregirla se crea una revisión nueva.'
              : 'Esta ficha fue sustituida por una revisión posterior. Se conserva como histórico y no se edita.'}
        </div>
      )}

      <Block
        n="1"
        title="Identificación"
        closedInfo={`${Number(form.productionLevel) || 0} ${form.unit || 'u'}`}
        open={isNew || openBlock === 1}
        onToggle={() => { if (!isNew) setOpenBlock(openBlock === 1 ? 0 : 1) }}
      >

        {/* El producto del catalogo es lo normal; un SERVICIO va por texto libre. */}
        <div className="seg">
          <button
            className={`seg__btn ${form.productId ? 'seg__btn--on' : ''}`}
            disabled={!editable}
            onClick={() => { setPicking(true); setError('') }}
          >
            Producto del catálogo
          </button>
          <button
            className={`seg__btn ${form.productId ? '' : 'seg__btn--on'}`}
            disabled={!editable}
            onClick={() => {
              setPicking(false)
              if (form.productId) set('productId', null)
            }}
          >
            Texto libre (servicio)
          </button>
        </div>

        {picking ? (
          <>
            <input
              className="search-input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar en el catálogo…"
            />
            <div className="product-list">
              {results.map((p) => (
                <button key={p.id} className="product-row" onClick={() => takeProduct(p)}>
                  <div className="product-row__main">
                    <strong>{p.name}</strong>
                    <span className="muted">{p.code ? `${p.code} · ` : ''}{UNIT_LABELS[p.unit] || p.unit}</span>
                  </div>
                </button>
              ))}
              {query.trim() && results.length === 0 && (
                <p className="muted">Sin resultados para “{query}”.</p>
              )}
            </div>
            <button className="btn btn--ghost btn--block" onClick={() => { setPicking(false); setQuery('') }}>
              Cancelar
            </button>
          </>
        ) : (
          <>
            <label className="field">
              <span>Producto o servicio</span>
              <input
                value={form.name}
                readOnly={!editable || !!form.productId}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Ej: Pan suave"
              />
            </label>
            {form.productId && (
              <p className="muted">
                Tomado del catálogo. La ficha guarda <strong>su propia copia</strong>: si el
                producto cambia de nombre, esta ficha no se altera.
              </p>
            )}

            <div className="form-row">
              <label className="field">
                <span>Código</span>
                <input
                  value={form.code}
                  readOnly={!editable}
                  onChange={(e) => set('code', e.target.value)}
                  placeholder="PAN-001"
                />
              </label>
              <label className="field">
                <span>Unidad de medida</span>
                <select value={form.unit} disabled={!editable} onChange={(e) => set('unit', e.target.value)}>
                  {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABELS[u] || u}</option>)}
                </select>
              </label>
            </div>

            {/* La actividad y el metodo van AQUI porque mandan sobre todo lo de
                abajo: tasa maxima de utilidad, base de la utilidad y coeficiente
                de indirectos del Art. 9. */}
            <label className="field">
              <span>Tipo de actividad (Anexo II)</span>
              <select value={form.activity} disabled={!editable} onChange={(e) => set('activity', e.target.value)}>
                {Object.values(FICHA_ACTIVITIES).map((a) => (
                  <option key={a} value={a}>{FICHA_ACTIVITY_LABELS[a] || a}</option>
                ))}
              </select>
            </label>
            <p className="muted">
              {maxPct == null
                ? 'Sin actividad definida no hay tasa máxima de referencia.'
                : `Tasa máxima de utilidad de referencia: ${Math.round(maxPct * 100)} %. `}
              {maxPct != null && 'Para una MYPIME el Anexo II es referencia, no obligación (Art. 6): la app avisa, nunca bloquea.'}
            </p>

            <label className="field">
              <span>Método de formación del precio</span>
              <select value={form.method} disabled={!editable} onChange={(e) => set('method', e.target.value)}>
                {Object.values(FICHA_METHODS).map((m) => (
                  <option key={m} value={m}>{FICHA_METHOD_LABELS[m] || m}</option>
                ))}
              </select>
            </label>
            <p className="muted">
              {form.method === FICHA_METHODS.CORRELACION
                ? 'Por correlación: la utilidad se deriva del precio de un similar (Fila 13 = precio del similar − Fila 12).'
                : 'Por gastos: la utilidad se calcula sobre su base del Anexo II (Fila 13 = base × tasa).'}
            </p>

            <div className="form-row">
              <label className="field">
                <span>Nivel de producción ({form.unit})</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={form.productionLevel}
                  readOnly={!editable}
                  onChange={(e) => set('productionLevel', e.target.value)}
                  placeholder="200"
                />
              </label>
              <label className="field">
                <span>% de utilización de capacidad</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={form.capacityPct}
                  readOnly={!editable}
                  onChange={(e) => set('capacityPct', e.target.value)}
                  placeholder="78"
                />
              </label>
            </div>
            <p className="muted">
              El nivel de producción es el divisor de la Fila 15: sin él no hay precio unitario.
            </p>

            {isNew && (
              <button className="btn btn--primary btn--block" disabled={busy} onClick={crear}>
                {busy ? 'Creando…' : 'Crear ficha'}
              </button>
            )}
          </>
        )}
      </Block>

      {/* Bloque 2 - Gasto material (Fila 1). Solo con la ficha ya creada: sus
          lineas se autoguardan igual que la identificacion. */}
      {!isNew && (
        <Block
          n="2"
          title="Gasto material"
          closedInfo={formatMoney(t.r1, baseCurrency)}
          open={openBlock === 2}
          onToggle={() => setOpenBlock(openBlock === 2 ? 0 : 2)}
        >
          <InputsBlock
            sheet={merged}
            inputs={form.inputs}
            carriers={form.carriers}
            products={products}
            editable={editable}
            onInputs={(inputs) => set('inputs', inputs)}
            onCarriers={(carriers) => set('carriers', carriers)}
          />
        </Block>
      )}

      {/* Honestidad sobre el estado del modulo: los bloques 3 a 9 son las fases
          siguientes del plan (docs/FICHA-COSTO.md §9). */}
      {!isNew && !picking && (
        <section className="card">
          <h3>Lo que falta de esta ficha</h3>
          <p className="muted">
            El salario directo, los otros gastos directos, los indirectos, los tributos, la
            utilidad, los precios de referencia y la exportación del documento oficial llegan en
            las fases siguientes. Hoy la ficha guarda su identificación y su gasto material.
          </p>
        </section>
      )}

      {!isNew && (
        <div className="pay-bar">
          <div className="pay-bar__info">
            <span className="pay-bar__lbl">PRECIO UNITARIO (14 ÷ nivel)</span>
            <strong className="pay-bar__amount">{formatMoney(unitPrice, baseCurrency)}</strong>
          </div>
        </div>
      )}
    </div>
  )
}
