import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { recipesRepo } from '../../repositories/recipesRepo'
import { productsRepo } from '../../repositories/productsRepo'
import { configRepo } from '../../repositories/configRepo'
import { imagesRepo } from '../../repositories/imagesRepo'
import { kitchenRepo } from '../../repositories/kitchenRepo'
import { shiftsRepo } from '../../repositories/shiftsRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { cleanQty } from '../../lib/qty'
import { useEscapeClose } from '../../lib/useEscapeClose'
import { COCINA, COCINA_LABEL, RECIPE_KINDS } from '../../db/constants'

// Tablero de elaboracion. La MISMA pantalla sirve a los dos tableros (`kind`), para
// no mantener dos copias de lo mismo:
//
//  - COCINA (modulo 'cocina', por defecto): lo opera el COCINERO, el VENDEDOR y el
//    mando. Se elabora en la cocina y se ENVIA al area que se elija. Identico a
//    siempre: con el default, esta pantalla se comporta exactamente como antes.
//  - COCTELERIA (modulo 'cocteleria'): lo opera el VENDEDOR (con el permiso del
//    dueño) y el mando; el COCINERO no (no es lo suyo). Se elabora DENTRO de un area
//    consumiendo SU stock, y el trago queda ahi mismo: no hay envio. El vendedor
//    trabaja en el area de SU turno abierto; el mando elige el area.
//
// En 3 toques (receta -> cantidad -> Elaborar) llama a kitchenRepo.produce.
// Aqui NO se ven costos (alcance del rol): el analisis financiero vive en Reportes.
export function KitchenScreen({ kind = RECIPE_KINDS.KITCHEN }) {
  const cocktail = kind === RECIPE_KINDS.COCKTAIL
  const { user, isCook, isManager, isSeller } = useAuth()
  const { hasModule } = useLicense()

  const recipes = useLiveQuery(() => recipesRepo.listActive({ kind }), [kind], [])
  const products = useLiveQuery(() => productsRepo.listActive(), [], [])
  const areas = useLiveQuery(() => configRepo.getAreas(), [], [])
  const photos = useLiveQuery(() => imagesRepo.mapByType('product'), [], new Map())
  const recent = useLiveQuery(() => kitchenRepo.recent(8, { kind }), [kind], [])
  // Solo la cocteleria necesita el turno (de ahi sale el area del vendedor) y el
  // permiso del dueño. En el tablero de cocina ninguna de las dos consultas corre.
  const myShift = useLiveQuery(
    () => (cocktail && user?.id ? shiftsRepo.getActiveFor(user.id) : Promise.resolve(null)),
    [cocktail, user?.id],
    undefined
  )
  const cocktailAllowed = useLiveQuery(
    () => (cocktail ? configRepo.get('sellerCocktailBoard', false) : Promise.resolve(false)),
    [cocktail],
    undefined
  )

  const productById = useMemo(() => {
    const m = {}
    for (const p of products) m[p.id] = p
    return m
  }, [products])

  // Hoja de elaboracion: receta elegida (o null).
  const [producing, setProducing] = useState(null)
  const [units, setUnits] = useState('1')
  const [toArea, setToArea] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [okMsg, setOkMsg] = useState('')
  useEscapeClose(() => setProducing(null))

  // Compuerta del modulo (cada tablero tiene el suyo).
  const moduleKey = cocktail ? LICENSE_MODULES.COCKTAILS : LICENSE_MODULES.KITCHEN
  const moduleLabel = cocktail ? 'Coctelería' : 'Cocina y recetas'
  const screenTitle = cocktail ? 'Coctelería' : 'Cocina'
  if (!hasModule(moduleKey)) {
    return (
      <div className="screen">
        <h2>{screenTitle}</h2>
        <section className="card">
          <p>El módulo <strong>{moduleLabel}</strong> no está activo en esta licencia.</p>
          <Link className="btn btn--primary btn--block" to="/">Volver al inicio</Link>
        </section>
      </div>
    )
  }
  // Compuerta de rol. El cocinero opera la cocina, NO la barra.
  const roleOk = cocktail ? (isManager || isSeller) : (isCook || isManager || isSeller)
  if (!roleOk) {
    return (
      <div className="screen">
        <h2>{screenTitle}</h2>
        <section className="card">
          <p>
            {cocktail
              ? <>Solo el <strong>vendedor</strong> o el dueño/administrativo operan el tablero de coctelería.</>
              : <>Solo el <strong>cocinero</strong>, el <strong>vendedor</strong> o el dueño/administrativo operan el tablero de cocina.</>}
          </p>
          <Link className="btn btn--primary btn--block" to="/">Volver al inicio</Link>
        </section>
      </div>
    )
  }
  // Cocteleria: espera a saber el turno y el permiso antes de decidir (si no, se
  // pintaria un aviso que desaparece solo). El tablero de cocina no pasa por aqui.
  if (cocktail && (myShift === undefined || cocktailAllowed === undefined)) {
    return <div className="screen"><p className="muted">Cargando…</p></div>
  }
  // El permiso del vendedor lo concede el dueño en Ajustes (apagado por defecto).
  // Al mando no le afecta.
  if (cocktail && !isManager && !cocktailAllowed) {
    return (
      <div className="screen">
        <h2>{screenTitle}</h2>
        <section className="card">
          <p>El dueño no ha habilitado el <strong>tablero de coctelería</strong> para el vendedor.</p>
          <Link className="btn btn--primary btn--block" to="/">Volver al inicio</Link>
        </section>
      </div>
    )
  }

  // Ubicacion de trabajo. En cocteleria es el AREA (origen Y destino): la de su turno
  // si opera un vendedor, o la que elija el mando. En cocina es siempre la cocina, y
  // el area de destino se elige al elaborar (como siempre).
  const workArea = cocktail ? (isManager ? toArea : (myShift?.area || '')) : ''
  const sourceLoc = cocktail ? workArea : COCINA
  const sourceLabel = cocktail ? (workArea || 'el área') : COCINA_LABEL.toLowerCase()
  // El vendedor sin turno abierto no tiene area de la que consumir.
  const needsShift = cocktail && !isManager && !myShift

  const openProduce = (r) => {
    setError('')
    setOkMsg('')
    setUnits('1')
    // En cocina el destino se elige en la hoja (o se preselecciona si hay una sola
    // area), como siempre. En cocteleria el area ya esta fijada arriba.
    if (!cocktail) setToArea(areas.length === 1 ? areas[0] : '')
    setProducing(r)
  }

  const doProduce = async () => {
    setError('')
    if (!(Number(units) > 0)) return setError('Indica una cantidad válida (mayor que 0)')
    const target = cocktail ? workArea : toArea
    if (!target) return setError(cocktail ? 'Elige el área donde elaboras' : 'Elige el área de destino')
    setBusy(true)
    try {
      const res = await kitchenRepo.produce({
        recipeId: producing.id,
        units: Number(units),
        toArea: target,
        // Cocteleria: origen = destino (el area). Cocina: sin pasarlo -> la cocina,
        // que es el comportamiento clasico.
        ...(cocktail ? { fromLocation: target } : {}),
        byUserId: user.id
      })
      setOkMsg(cocktail
        ? `✅ ${cleanQty(res.units)} de "${producing.name}" elaboradas en ${res.toArea}.`
        : `✅ ${cleanQty(res.units)} de "${producing.name}" elaboradas y enviadas a ${res.toArea}.`)
      setProducing(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const fmt = (iso) => {
    try {
      return new Date(iso).toLocaleString('es-CU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    } catch {
      return ''
    }
  }

  // "Puedes elaborar" se calcula sobre la ubicacion de origen. En cocteleria, sin
  // area elegida todavia no hay nada que calcular.
  const canMakeIn = (r) => (cocktail && !sourceLoc ? 0 : kitchenRepo.canMake(r, productById, sourceLoc))
  const canNow = producing ? canMakeIn(producing) : 0

  // Las tarjetas salen ORDENADAS ALFABETICAMENTE por el nombre de la receta: el repo
  // las devuelve por clave primaria (UUID), que para el cocinero es un orden al azar.
  // Mismo criterio que la lista de recetas del mando (localeCompare), sin tocar el repo.
  const sortedRecipes = [...recipes].sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  return (
    <div className="screen">
      <h2>{cocktail ? 'Tablero de coctelería' : 'Tablero de cocina'}</h2>
      <p className="muted">
        {cocktail
          ? <>Toca una receta e indica cuántos tragos. Se descuentan los insumos <strong>de {sourceLabel}</strong> y
            el trago queda ahí mismo, listo para venderse. “Puedes elaborar” se calcula con lo que hay
            en esa área ahora mismo.</>
          : <>Toca una receta, indica cuántas unidades y el área, y envíala. Se descuentan los insumos de
            la cocina. “Puedes elaborar” se calcula con lo que hay en la cocina ahora mismo.</>}
      </p>
      {okMsg && <p className="ok-text">{okMsg}</p>}

      {areas.length === 0 && (
        <section className="card">
          <p>No hay <strong>áreas de venta</strong> configuradas. El dueño debe definirlas en Ajustes
            antes de poder {cocktail ? 'elaborar coctelería' : 'enviar elaborados'}.</p>
        </section>
      )}

      {/* Cocteleria: el area de trabajo. El mando la elige; el vendedor trae la de su turno. */}
      {cocktail && areas.length > 0 && (
        <section className="card">
          {isManager ? (
            <label className="field">
              <span>Área donde elaboras</span>
              <select value={toArea} onChange={(e) => { setToArea(e.target.value); setOkMsg('') }}>
                <option value="">— Elige el área —</option>
                {areas.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
          ) : needsShift ? (
            <p>Abre tu <strong>turno</strong> para elaborar: los insumos salen del área de tu turno.</p>
          ) : (
            <div className="kv">
              <span className="muted">Área donde elaboras</span>
              <strong>{workArea}</strong>
            </div>
          )}
        </section>
      )}

      {recipes.length === 0 ? (
        <section className="card">
          <p className="muted">
            Aún no hay recetas{cocktail ? ' de coctelería' : ''}. El dueño las crea en{' '}
            <strong>{cocktail ? 'Recetas → Recetas de coctelería' : 'Cocina → Recetas'}</strong>.
          </p>
        </section>
      ) : (
        <section className="card">
          <div className="kitchen-grid">
            {sortedRecipes.map((r) => {
              const n = canMakeIn(r)
              const thumb = photos.get(r.outputProductId)
              return (
                <div key={r.id} className="kitchen-tile">
                  <div className="product-thumb">
                    {thumb ? <img src={thumb} alt="" loading="lazy" /> : <span className="product-thumb__ph">{cocktail ? '🍹' : '🍽️'}</span>}
                  </div>
                  <strong className="kitchen-tile__name" title={r.name}>{r.name}</strong>
                  <div className="kitchen-tile__can muted">
                    Puedes elaborar: <strong>{n}</strong>
                  </div>
                  <button
                    className="btn btn--primary btn--block"
                    disabled={cocktail && (!sourceLoc || needsShift)}
                    onClick={() => openProduce(r)}
                  >
                    Elaborar
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="card">
          <h3>Elaboraciones recientes</h3>
          <div className="entry-lines">
            {recent.map((pr) => (
              <div key={pr.id} className="entry-line">
                <div className="entry-line__head">
                  <div><strong>{pr.recipeName}</strong><span className="muted"> · {cleanQty(pr.units)} → {pr.toArea}</span></div>
                  <span className="muted">{fmt(pr.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {producing && (
        <div className="modal-backdrop" onClick={() => setProducing(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Elaborar" onClick={(e) => e.stopPropagation()}>
            <h3>Elaborar: {producing.name}</h3>
            <p className="muted">
              Con el stock de {cocktail ? <strong>{workArea}</strong> : 'la cocina'} puedes elaborar hasta <strong>{canNow}</strong>.
            </p>
            <label className="field">
              <span>Cantidad a elaborar</span>
              <input type="number" inputMode="decimal" autoFocus value={units} onChange={(e) => setUnits(e.target.value)} />
            </label>
            {/* En cocteleria no hay area de destino: el trago se queda donde se elabora. */}
            {!cocktail && (
              <label className="field">
                <span>Área de destino</span>
                <select value={toArea} onChange={(e) => setToArea(e.target.value)}>
                  <option value="">— Elige el área —</option>
                  {areas.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
            )}
            {error && <p className="error">{error}</p>}
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setProducing(null)}>Cancelar</button>
              <button className="btn btn--primary" disabled={busy} onClick={doProduce}>
                {busy ? 'Elaborando…' : (cocktail ? 'Elaborar' : 'Elaborar y enviar')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
