import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { recipesRepo } from '../../repositories/recipesRepo'
import { productsRepo } from '../../repositories/productsRepo'
import { configRepo } from '../../repositories/configRepo'
import { imagesRepo } from '../../repositories/imagesRepo'
import { kitchenRepo } from '../../repositories/kitchenRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { cleanQty } from '../../lib/qty'
import { useEscapeClose } from '../../lib/useEscapeClose'

// Tablero de cocina (modulo 'cocina'). Lo opera el COCINERO (y tambien el mando).
// Muestra una tarjeta por receta con "Puedes elaborar: N" y, en 3 toques
// (receta -> cantidad + area -> Elaborar y enviar), llama a kitchenRepo.produce,
// que consume insumos de la cocina, crea el elaborado y lo envia al area elegida.
// Aqui NO se ven costos (alcance del rol): el analisis financiero vive en Reportes.
export function KitchenScreen() {
  const { user, isCook, isManager } = useAuth()
  const { hasModule } = useLicense()

  const recipes = useLiveQuery(() => recipesRepo.listActive(), [], [])
  const products = useLiveQuery(() => productsRepo.listActive(), [], [])
  const areas = useLiveQuery(() => configRepo.getAreas(), [], [])
  const photos = useLiveQuery(() => imagesRepo.mapByType('product'), [], new Map())
  const recent = useLiveQuery(() => kitchenRepo.recent(8), [], [])

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

  // Compuerta del modulo y del rol (cocinero o mando).
  if (!hasModule(LICENSE_MODULES.KITCHEN)) {
    return (
      <div className="screen">
        <h2>Cocina</h2>
        <section className="card">
          <p>El módulo <strong>Cocina y recetas</strong> no está activo en esta licencia.</p>
          <Link className="btn btn--primary btn--block" to="/">Volver al inicio</Link>
        </section>
      </div>
    )
  }
  if (!isCook && !isManager) {
    return (
      <div className="screen">
        <h2>Cocina</h2>
        <section className="card">
          <p>Solo el <strong>cocinero</strong> (o el dueño/administrativo) opera el tablero de cocina.</p>
          <Link className="btn btn--primary btn--block" to="/">Volver al inicio</Link>
        </section>
      </div>
    )
  }

  const openProduce = (r) => {
    setError('')
    setOkMsg('')
    setUnits('1')
    setToArea(areas.length === 1 ? areas[0] : '')
    setProducing(r)
  }

  const doProduce = async () => {
    setError('')
    if (!(Number(units) > 0)) return setError('Indica una cantidad válida (mayor que 0)')
    if (!toArea) return setError('Elige el área de destino')
    setBusy(true)
    try {
      const res = await kitchenRepo.produce({
        recipeId: producing.id,
        units: Number(units),
        toArea,
        byUserId: user.id
      })
      setOkMsg(`✅ ${cleanQty(res.units)} de "${producing.name}" elaboradas y enviadas a ${res.toArea}.`)
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

  const canNow = producing ? kitchenRepo.canMake(producing, productById) : 0

  return (
    <div className="screen">
      <h2>Tablero de cocina</h2>
      <p className="muted">
        Toca una receta, indica cuántas unidades y el área, y envíala. Se descuentan los insumos de
        la cocina. “Puedes elaborar” se calcula con lo que hay en la cocina ahora mismo.
      </p>
      {okMsg && <p className="ok-text">{okMsg}</p>}

      {areas.length === 0 && (
        <section className="card">
          <p>No hay <strong>áreas de venta</strong> configuradas. El dueño debe definirlas en Ajustes
            antes de poder enviar elaborados.</p>
        </section>
      )}

      {recipes.length === 0 ? (
        <section className="card">
          <p className="muted">Aún no hay recetas. El dueño las crea en <strong>Cocina → Recetas</strong>.</p>
        </section>
      ) : (
        <section className="card">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
            {recipes.map((r) => {
              const n = kitchenRepo.canMake(r, productById)
              const thumb = photos.get(r.outputProductId)
              return (
                <div key={r.id} className="card" style={{ margin: 0 }}>
                  <div className="product-thumb">
                    {thumb ? <img src={thumb} alt="" loading="lazy" /> : <span className="product-thumb__ph">🍽️</span>}
                  </div>
                  <strong>{r.name}</strong>
                  <div className="muted" style={{ marginBottom: 8 }}>
                    Puedes elaborar: <strong>{n}</strong>
                  </div>
                  <button className="btn btn--primary btn--block" onClick={() => openProduce(r)}>Elaborar</button>
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
            <p className="muted">Con el stock de la cocina puedes elaborar hasta <strong>{canNow}</strong>.</p>
            <label className="field">
              <span>Cantidad a elaborar</span>
              <input type="number" inputMode="decimal" autoFocus value={units} onChange={(e) => setUnits(e.target.value)} />
            </label>
            <label className="field">
              <span>Área de destino</span>
              <select value={toArea} onChange={(e) => setToArea(e.target.value)}>
                <option value="">— Elige el área —</option>
                {areas.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            {error && <p className="error">{error}</p>}
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setProducing(null)}>Cancelar</button>
              <button className="btn btn--primary" disabled={busy} onClick={doProduce}>
                {busy ? 'Elaborando…' : 'Elaborar y enviar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
