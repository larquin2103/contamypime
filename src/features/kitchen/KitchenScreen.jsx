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
import { shortfall } from '../../lib/kitchenMath'
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
  // Permiso del VENDEDOR para ESTE tablero (Ajustes → Tableros de elaboración). El de
  // cocina nace ACTIVADO (hoy el vendedor ya lo ve) y el de cocteleria APAGADO. El
  // valor inicial del hook sigue al default: en cocina es `true`, asi que el caso
  // normal se pinta sin pasar por una pantalla de carga, igual que siempre; en
  // cocteleria es `undefined` y SI se espera, porque ahi el default es que no se vea y
  // un parpadeo mostraria un tablero que no deberia existir.
  const boardAllowed = useLiveQuery(
    () => configRepo.get(cocktail ? 'sellerCocktailBoard' : 'sellerKitchenBoard', !cocktail),
    [cocktail],
    cocktail ? undefined : true
  )
  // Permiso de elaborar con FALTANTE (Ajustes). Apagado por defecto, y el valor
  // inicial del hook es ese mismo default: sin el, el tablero se comporta y se pinta
  // exactamente como antes de B2.
  const allowShort = useLiveQuery(() => configRepo.get('allowShortProduction', false), [], false)

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
  // Confirmacion explicita para elaborar en descubierto, y la marca que la pide cuando
  // el faltante lo detecta el MOTOR y no la cache (ver `shortfall` en lib/kitchenMath).
  const [confirmShort, setConfirmShort] = useState(false)
  const [askedByEngine, setAskedByEngine] = useState(false)
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
  if (cocktail && (myShift === undefined || boardAllowed === undefined)) {
    return <div className="screen"><p className="muted">Cargando…</p></div>
  }
  // El permiso del VENDEDOR lo concede el dueño en Ajustes. Al mando no le afecta, y al
  // cocinero tampoco (la cocina es su trabajo). Se comprueba AQUI y no solo en el Home:
  // la tarjeta puede no estar, pero la ruta sigue existiendo.
  if (isSeller && !isManager && !boardAllowed) {
    return (
      <div className="screen">
        <h2>{screenTitle}</h2>
        <section className="card">
          <p>
            El dueño no ha habilitado el <strong>tablero de {cocktail ? 'coctelería' : 'cocina'}</strong>
            {' '}para el vendedor.
          </p>
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
    setConfirmShort(false)
    setAskedByEngine(false)
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
        // El descubierto SOLO se autoriza con el permiso del dueño Y con la
        // confirmacion marcada aqui. Sin las dos cosas se manda `false`, o sea el
        // candado de siempre. Asi nadie elabora en descubierto sin haberlo visto.
        ...(allowShort && confirmShort ? { allowShort: true } : {}),
        byUserId: user.id
      })
      // El faltante REAL lo devuelve el motor (del libro mayor), no la cache: si lo
      // hubo, se dice en el mismo aviso de exito para que quede a la vista.
      const short = (res.shortages || [])
        .map((s) => `${s.name}: ${cleanQty(-s.short)}`)
        .join(', ')
      const base = cocktail
        ? `✅ ${cleanQty(res.units)} de "${producing.name}" elaboradas en ${res.toArea}.`
        : `✅ ${cleanQty(res.units)} de "${producing.name}" elaboradas y enviadas a ${res.toArea}.`
      setOkMsg(short ? `${base} ⚠️ Quedó en descubierto → ${short}.` : base)
      setProducing(null)
    } catch (e) {
      setError(e.message)
      // Faltante detectado por el MOTOR (la cache decia que alcanzaba). Con el permiso
      // del dueño se ofrece la confirmacion en vez de dejar al usuario en un callejon:
      // el aviso de arriba ya dice de que insumo y cuanto falta.
      if (e.code === 'short' && allowShort) setAskedByEngine(true)
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
  // Faltante de la cantidad que se esta tecleando, y si hay que pedir confirmacion.
  // `askedByEngine` cubre el caso en que la cache decia que alcanzaba y el libro mayor
  // dijo que no. Sin el permiso, `needsConfirm` es siempre false y nada de esto se pinta.
  const preview = allowShort && producing ? shortfall(producing, productById, sourceLoc, units) : []
  const needsConfirm = allowShort && (preview.length > 0 || askedByEngine)

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
                  {/* Con el permiso del dueño, "0" ya no significa "no puedes": significa
                      que faltan insumos y que se elaborará en descubierto. Sin el permiso
                      esta marca no existe y la tarjeta es la de siempre. */}
                  {allowShort && n === 0 && (
                    <div className="kitchen-tile__can warn-text"><small>Falta algún insumo</small></div>
                  )}
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
              <input
                type="number" inputMode="decimal" autoFocus value={units}
                onChange={(e) => { setUnits(e.target.value); setConfirmShort(false); setAskedByEngine(false) }}
              />
            </label>

            {/* Elaborar con FALTANTE (permiso del dueño). Sin el permiso este bloque no
                existe y el modal es el de siempre: el motor rechaza y se ve su mensaje. */}
            {needsConfirm && (
              <div className="card card--warn">
                <p className="warn-text"><strong>Vas a elaborar con faltante.</strong></p>
                {preview.length > 0 ? (
                  <div className="entry-lines">
                    {preview.map((s) => (
                      <div key={s.name} className="entry-line">
                        <div className="entry-line__head">
                          <div><strong>{s.name}</strong><span className="muted"> · hay {s.have} {s.unit}, se necesitan {s.need}</span></div>
                          <span className="warn-text">quedará {s.after}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted"><small>El detalle del faltante está en el aviso de arriba.</small></p>
                )}
                <label className="check-row">
                  <input type="checkbox" checked={confirmShort} onChange={(e) => setConfirmShort(e.target.checked)} />
                  <div className="check-row__main">
                    <strong>Sí, elaborar de todos modos</strong>
                    <span className="muted">La existencia quedará en negativo hasta que registres la entrada.</span>
                  </div>
                </label>
              </div>
            )}
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
              <button className="btn btn--primary" disabled={busy || (needsConfirm && !confirmShort)} onClick={doProduce}>
                {busy ? 'Elaborando…' : (cocktail ? 'Elaborar' : 'Elaborar y enviar')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
