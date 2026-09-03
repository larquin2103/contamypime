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
  totals,
  indirectCheck,
  fichaWarnings
} from '../../lib/fichaCosto'
import { InputsBlock } from './InputsBlock'
import { LaborBlock } from './LaborBlock'
import { OtherDirectBlock } from './OtherDirectBlock'
import { IndirectBlock } from './IndirectBlock'
import { TaxesBlock } from './TaxesBlock'
import { UtilityBlock } from './UtilityBlock'
import { RefsBlock } from './RefsBlock'
import { SignBlock } from './SignBlock'
import {
  UNITS,
  UNIT_LABELS,
  FICHA_ACTIVITY_LABELS,
  FICHA_METHOD_LABELS,
  FICHA_STATUS_LABELS,
  FICHA_WARNING_LABELS
} from '../../db/constants'

// Modulo 'fichas' - Editor de la ficha de costo. Los NUEVE bloques del acordeon,
// uno abierto a la vez: 1 identificacion (F4), 2 gasto material (F5), 3 salario
// (F6), 4 otros directos, 5 indirectos, 6 financieros y tributos, 7 utilidad y
// precio (F7), 8 precios de referencia y 9 firmas y ciclo de vida (F8). Falta
// exportar el documento oficial (F9).
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
  carriers: { fuel: { qty: 0, unitPrice: 0 }, energy: { qty: 0, unitPrice: 0 }, water: { qty: 0, unitPrice: 0 } },
  // Bloque 3 (F6). Una entrada por operacion del anexo de salario.
  labor: [],
  // Bloques 4 a 7 (F7). `rows` son las filas que se capturan a mano; van TODAS
  // aunque valgan cero, porque son filas del modelo oficial y no campos
  // opcionales. `taxSS`/`taxFT` viven aqui en FRACCION (docs §5).
  otherDirect: [],
  rows: { r4: 0, r41: 0, r6: 0, r61: 0, r7: 0, r71: 0, r8: 0, r9: 0, taxSS: 0, taxFT: 0 },
  correlationPrice: '',
  // Bloques 8 y 9 (F8). `refs` es la Fila 16 (explicativa, no suma al precio) y
  // `elaboratedBy` es la primera de las dos firmas del pie de los anexos.
  refs: [],
  elaboratedBy: ''
}

// Un bloque del acordeon. Cerrado ensena su total; abierto, la ✕ para plegarlo
// (el total vive entonces al pie del cuerpo). Solo uno abierto a la vez: en un
// telefono dos cuerpos abiertos hacen la ficha inusable, que es justo el problema
// que este diseno resuelve.
function Block({ n, title, closedInfo, open, onToggle, children }) {
  return (
    <section className="card">
      <button type="button" className="ficha-block__head" onClick={onToggle}>
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
  carriers: s.carriers || EMPTY.carriers,
  labor: Array.isArray(s.labor) ? s.labor : [],
  otherDirect: Array.isArray(s.otherDirect) ? s.otherDirect : [],
  rows: { ...EMPTY.rows, ...(s.rows || {}) },
  correlationPrice: s.correlationPrice == null ? '' : String(s.correlationPrice),
  refs: Array.isArray(s.refs) ? s.refs : [],
  elaboratedBy: s.elaboratedBy || ''
  // OJO: `utilityPct` NO se copia aqui, y NO es un olvido. El repo tiene una
  // regla cruzada: al cambiar de actividad, la ficha adopta el maximo de la
  // actividad nueva SOLO si el dueño no habia escrito su propia tasa
  // (costSheetsRepo.update). Si el formulario llevara siempre `utilityPct`, el
  // autoguardado lo mandaria en cada patch, la segunda rama de esa regla ganaria
  // siempre y la tasa NUNCA se adaptaria a la actividad nueva.
  // Mientras el dueño no toque el campo, la clave no existe en el formulario, el
  // patch no la lleva y manda el repo. En cuanto la toca, `set('utilityPct', ...)`
  // la añade y a partir de ahi manda el dueño, que es exactamente lo que dice la
  // regla. Por eso `merged` la toma de `sheet` hasta que se edita.
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
  // Todas las versiones del grupo (v1, v2, v3...), para el historial del bloque 9.
  // Gateado en la consulta, como todo lo demas.
  const versions = useLiveQuery(
    () => (canFichas && sheet?.groupId ? costSheetsRepo.listByGroup(sheet.groupId) : Promise.resolve([])),
    [canFichas, sheet?.groupId],
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
  const saveTimer = useRef(null)
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
    // El `form` pertenece a la ficha que se CARGO, no necesariamente a la que
    // dice la URL: tras crear una revision, `navigate` cambia `id` de inmediato y
    // el formulario sigue siendo el de la version anterior hasta que llega la
    // nueva. Sin esta guarda, teclear en esa ventana escribiria los anexos VIEJOS
    // sobre la revision nueva y borraria las columnas "Costo Base" que acaba de
    // derivar `reviseFrom` (`num(undefined)` = 0), en silencio.
    if (loadedId.current !== id) return
    // Y mientras corre una accion del ciclo de vida no se arma ningun
    // temporizador: si el dueño teclea DURANTE el `await` de aprobar, a los 600 ms
    // `update` lanzaria "una ficha aprobada no se edita" sobre una aprobacion ya
    // correcta, que es el sintoma que `flush` existe para eliminar.
    if (busy) return
    saveTimer.current = setTimeout(() => {
      costSheetsRepo
        .update(id, form)
        .then(() => { setDirty(false); setSaved(true); setError('') })
        .catch((e) => setError(e.message))
    }, AUTOSAVE_MS)
    return () => clearTimeout(saveTimer.current)
  }, [dirty, form, id, isNew, editable, busy])

  // Volcado al salir: rescata el ultimo tecleo si aun no habia vencido el timer.
  useEffect(() => {
    return () => {
      // Misma guarda que el autoguardado: solo se vuelca si el formulario es de
      // ESTA ficha. Si no, se escribirian los anexos de la version anterior.
      if (dirtyRef.current && id && loadedId.current === id) {
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
  const pr = useMemo(() => priceRows(merged), [merged])
  const unitPrice = pr.r15
  const t = useMemo(() => totals(merged), [merged])
  const ind = useMemo(() => indirectCheck(merged), [merged])
  const warns = useMemo(() => fichaWarnings(merged), [merged])

  // VUELCA EL AUTOGUARDADO PENDIENTE antes de cualquier accion del ciclo de vida.
  // Sin esto pasan dos cosas malas a la vez: (a) lo ultimo tecleado NO entraria en
  // la ficha que se aprueba ni en la revision que se crea (`revise` copia lo que
  // hay en la base, no lo que hay en pantalla), y (b) el temporizador venceria
  // DESPUES y `update` lanzaria "una ficha aprobada no se edita", con el cambio ya
  // perdido y un error en pantalla que el dueño no podria explicarse.
  const flush = async () => {
    // Se DESARMA el temporizador antes de nada. `setDirty(false)` no basta: la
    // limpieza del efecto corre en el render siguiente, y el temporizador podia
    // vencer durante el `await` de aprobar y lanzar "una ficha aprobada no se
    // edita" DESPUES de una aprobacion correcta, dejando un error en pantalla que
    // el dueño no podria explicarse.
    if (saveTimer.current) clearTimeout(saveTimer.current)
    if (!dirty || !id || !editable) return
    if (loadedId.current !== id) return // el formulario es de otra ficha: no se vuelca
    await costSheetsRepo.update(id, form)
    setDirty(false)
  }

  const aprobar = async (approvedBy) => {
    setBusy(true)
    setError('')
    try {
      await flush()
      await costSheetsRepo.approve(id, { approvedBy, userId: user?.id || null })
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const revisar = async () => {
    setBusy(true)
    setError('')
    try {
      await flush()
      const newId = await costSheetsRepo.revise(id, { userId: user?.id || null })
      setOpenBlock(1)
      navigate(`/ficha/${newId}`)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const eliminar = async () => {
    setBusy(true)
    setError('')
    try {
      // No se vuelca nada: la ficha se va. Pero hay que DESARMAR el temporizador,
      // que si no lanzaria sobre una ficha ya eliminada.
      if (saveTimer.current) clearTimeout(saveTimer.current)
      setDirty(false)
      await costSheetsRepo.remove(id, { userId: user?.id || null })
      navigate('/fichas')
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

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

      {/* Resumen de avisos, TAMBIEN fuera del acordeon y por el mismo motivo: solo
          hay un bloque abierto a la vez, asi que un aviso pintado dentro de su
          bloque desaparece en cuanto se pasa a otro. Aqui va la PRESENCIA (una
          sola fuente: `fichaWarnings`) y en cada bloque el detalle con importes.
          Ninguno bloquea la ficha (Art. 6). */}
      {!isNew && warns.length > 0 && (
        <div
          className={`cuadre-banner ${
            warns.some((w) => w.code === 'subsidio') ? 'cuadre-banner--red' : 'cuadre-banner--yellow'
          }`}
        >
          {warns.length === 1 ? '1 aviso' : `${warns.length} avisos`}:{' '}
          {warns.map((w) => FICHA_WARNING_LABELS[w.code] || w.code).join(' · ')}. Ninguno bloquea
          la ficha: puedes seguir y aprobarla (Art. 6).
        </div>
      )}

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

      {/* Bloque 3 - Salario directo (Fila 2). Nueve columnas de la norma en
          tarjetas, una por operacion. */}
      {!isNew && (
        <Block
          n="3"
          title="Salario directo"
          closedInfo={formatMoney(t.r2, baseCurrency)}
          open={openBlock === 3}
          onToggle={() => setOpenBlock(openBlock === 3 ? 0 : 3)}
        >
          <LaborBlock
            labor={form.labor}
            baseCurrency={baseCurrency}
            editable={editable}
            esRevision={!!merged.baseFromSheetId}
            onLabor={(labor) => set('labor', labor)}
          />
        </Block>
      )}

      {/* Bloque 4 - Otros gastos directos (Fila 3). */}
      {!isNew && (
        <Block
          n="4"
          title="Otros gastos directos"
          closedInfo={formatMoney(t.r3, baseCurrency)}
          open={openBlock === 4}
          onToggle={() => setOpenBlock(openBlock === 4 ? 0 : 4)}
        >
          <OtherDirectBlock
            items={form.otherDirect}
            baseCurrency={baseCurrency}
            editable={editable}
            onItems={(items) => set('otherDirect', items)}
          />
        </Block>
      )}

      {/* Bloque 5 - Indirectos (Filas 4, 6 y 7) y el semaforo del Art. 9. */}
      {!isNew && (
        <Block
          n="5"
          title="Indirectos"
          closedInfo={formatMoney(ind.sum, baseCurrency)}
          open={openBlock === 5}
          onToggle={() => setOpenBlock(openBlock === 5 ? 0 : 5)}
        >
          <IndirectBlock
            sheet={merged}
            rows={form.rows}
            baseCurrency={baseCurrency}
            editable={editable}
            onRows={(rows) => set('rows', rows)}
          />
        </Block>
      )}

      {/* Bloque 6 - Financieros, OSDE y tributos (Filas 8, 9 y 10). */}
      {!isNew && (
        <Block
          n="6"
          title="Financieros y tributos"
          closedInfo={formatMoney(t.r8 + t.r9 + t.r10, baseCurrency)}
          open={openBlock === 6}
          onToggle={() => setOpenBlock(openBlock === 6 ? 0 : 6)}
        >
          {/* `key` por ficha: el bloque guarda el TEXTO tecleado de los dos tipos
              tributarios (se teclean en % y se guardan en fraccion), asi que abrir
              otra ficha tiene que reiniciar ese texto. */}
          <TaxesBlock
            key={sheet.id}
            sheet={merged}
            rows={form.rows}
            baseCurrency={baseCurrency}
            editable={editable}
            onRows={(rows) => set('rows', rows)}
          />
        </Block>
      )}

      {/* Bloque 7 - Utilidad y precio (Filas 13, 14 y 15) con los controles B y C. */}
      {!isNew && (
        <Block
          n="7"
          title="Utilidad y precio"
          closedInfo={formatMoney(pr.r13, baseCurrency)}
          open={openBlock === 7}
          onToggle={() => setOpenBlock(openBlock === 7 ? 0 : 7)}
        >
          <UtilityBlock
            sheet={merged}
            baseCurrency={baseCurrency}
            editable={editable}
            onMethod={(m) => set('method', m)}
            onUtilityPct={(v) => set('utilityPct', v === '' ? null : v)}
            onCorrelationPrice={(v) => set('correlationPrice', v)}
          />
        </Block>
      )}

      {/* Bloque 8 - Precios de referencia (Fila 16, explicativa). */}
      {!isNew && (
        <Block
          n="8"
          title="Precios de referencia"
          closedInfo={form.refs.length === 1 ? '1 referencia' : `${form.refs.length} referencias`}
          open={openBlock === 8}
          onToggle={() => setOpenBlock(openBlock === 8 ? 0 : 8)}
        >
          <RefsBlock
            refs={form.refs}
            method={merged.method}
            baseCurrency={baseCurrency}
            editable={editable}
            onRefs={(refs) => set('refs', refs)}
          />
        </Block>
      )}

      {/* Bloque 9 - Firmas y ciclo de vida: aprobar, revisar y eliminar. */}
      {!isNew && (
        <Block
          n="9"
          title="Firmas y aprobación"
          closedInfo={FICHA_STATUS_LABELS[sheet.status] || sheet.status}
          open={openBlock === 9}
          onToggle={() => setOpenBlock(openBlock === 9 ? 0 : 9)}
        >
          {/* `key` por ficha, como en TaxesBlock y por el MISMO motivo: el bloque
              guarda en estado local la firma tecleada. Sin esto, el camino
              "aprobar v1 -> Nueva revision" dejaba el campo "Aprobado por"
              PREESCRITO con la firma de la v1 y el boton de aprobar habilitado sin
              que nadie hubiera escrito nada, que es justo la garantia que esta
              fase añade. La pantalla no se desmonta al navegar a la revision. */}
          <SignBlock
            key={sheet.id}
            sheet={merged}
            versions={versions}
            refsCount={form.refs.length}
            warns={warns}
            baseCurrency={baseCurrency}
            editable={editable}
            busy={busy}
            onElaboratedBy={(v) => set('elaboratedBy', v)}
            onApprove={aprobar}
            onRevise={revisar}
            onRemove={eliminar}
          />
        </Block>
      )}

      {/* La tarjeta "Lo que falta de esta ficha" se retiro en F9: decia que la
          exportacion no existia, y estaba DOS CENTIMETROS DEBAJO de los botones
          que la hacen. El editor esta completo; lo que queda (la pestaña de
          Fichas en /auditoria) es de otra pantalla y se anuncia alli, en F10. */}

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
