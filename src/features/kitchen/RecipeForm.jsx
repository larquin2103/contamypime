import { useMemo, useState, useEffect } from 'react'
import { recipesRepo } from '../../repositories/recipesRepo'
import { imagesRepo } from '../../repositories/imagesRepo'
import { UNITS, UNIT_LABELS, NO_AREA_LABEL, FOREIGN_PRICE_CURRENCIES } from '../../db/constants'
import { useAuth } from '../../app/providers/AuthProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { fileToThumbnail } from '../../lib/image'
import { matchesQuery } from '../../lib/search'
import { useEscapeClose } from '../../lib/useEscapeClose'

// Alta / edicion de una receta del modulo 'cocina'. La define el DUEÑO. Imita a
// ProductForm (mismo estilo, misma foto/moneda gateadas) y agrega el checklist de
// INSUMOS con su consumo por unidad (patron del checklist de "Salida a areas").
//
// Al guardar, recipesRepo se encarga de crear/actualizar el PRODUCTO elaborado
// (reusa el catalogo). El costo del elaborado no se teclea: se deriva al producir.
export function RecipeForm({ recipe, outputProduct, products, categories, areas, onClose, onSaved }) {
  const { user } = useAuth()
  const { baseCurrency } = useCurrency()
  const { hasModule } = useLicense()
  const editing = !!recipe
  // Moneda del precio (modulo 'divisas'): fijar el precio del elaborado en divisa.
  const canCurrency = hasModule(LICENSE_MODULES.MULTICURRENCY)
  // Foto del elaborado (modulo 'imagenes'): miniatura en la coleccion `images`,
  // ligada al PRODUCTO (refType 'product') -> se ve tambien en el catalogo.
  const canImages = hasModule(LICENSE_MODULES.IMAGES)

  const [name, setName] = useState(recipe?.name ?? '')
  const [unit, setUnit] = useState(recipe?.unit ?? outputProduct?.unit ?? UNITS[0])
  const [categoryId, setCategoryId] = useState(outputProduct?.categoryId ?? '')
  const [area, setArea] = useState(outputProduct?.area ?? '')
  const [price, setPrice] = useState(outputProduct?.price ?? '')
  const [priceCurrency, setPriceCurrency] = useState(outputProduct?.priceCurrency || baseCurrency)
  const [normas, setNormas] = useState(recipe?.normas ?? '')
  // Insumos seleccionados: { [productId]: cantidadPorUnidad (texto) }.
  const [selected, setSelected] = useState(() => {
    const m = {}
    for (const it of recipe?.items || []) m[it.productId] = String(it.qty)
    return m
  })
  const [query, setQuery] = useState('')
  const [photo, setPhoto] = useState('')
  const [photoTouched, setPhotoTouched] = useState(false)
  const [imgBusy, setImgBusy] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEscapeClose(onClose)

  // Carga la foto existente del elaborado al abrir (solo en edicion, con el modulo).
  useEffect(() => {
    let alive = true
    if (canImages && editing && outputProduct?.id) {
      imagesRepo.getDataUrl('product', outputProduct.id).then((d) => { if (alive) setPhoto(d) })
    }
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onPickPhoto = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // permite volver a elegir el MISMO archivo
    if (!file) return
    setError('')
    setImgBusy(true)
    try {
      setPhoto(await fileToThumbnail(file))
      setPhotoTouched(true)
    } catch (err) {
      setError('No se pudo procesar la imagen: ' + err.message)
    } finally {
      setImgBusy(false)
    }
  }
  const removePhoto = () => { setPhoto(''); setPhotoTouched(true) }

  const productById = useMemo(() => {
    const m = {}
    for (const p of products) m[p.id] = p
    return m
  }, [products])

  const catName = useMemo(() => {
    const m = { __none: 'Sin categoría' }
    for (const c of categories) m[c.id] = c.name
    return m
  }, [categories])

  // Insumos elegibles: todos los productos activos MENOS el propio elaborado (una
  // receta no se consume a si misma). Agrupados por categoria para marcar comodo.
  const groups = useMemo(() => {
    const selfId = recipe?.outputProductId
    const eligible = products.filter((p) => p.id !== selfId)
    const filtered = query.trim() ? eligible.filter((p) => matchesQuery(p, query)) : eligible
    filtered.sort((a, b) => a.name.localeCompare(b.name))
    const g = {}
    for (const p of filtered) {
      const key = p.categoryId || '__none'
      if (!g[key]) g[key] = []
      g[key].push(p)
    }
    return g
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, query, recipe])

  const toggle = (p) =>
    setSelected((prev) => {
      const next = { ...prev }
      if (p.id in next) delete next[p.id]
      else next[p.id] = '1'
      return next
    })
  const setQty = (productId, value) => setSelected((prev) => ({ ...prev, [productId]: value }))

  const selectedList = Object.keys(selected).map((id) => productById[id]).filter(Boolean)
  const qtyOf = (id) => Number(selected[id]) || 0
  const insumosValid = selectedList.length > 0 && selectedList.every((p) => qtyOf(p.id) > 0)

  const save = async () => {
    setError('')
    if (!name.trim()) return setError('El nombre del elaborado es obligatorio')
    if (price === '' || Number(price) < 0) return setError('Indica un precio de venta válido')
    if (!insumosValid) return setError('Agrega al menos un insumo con cantidad por unidad mayor que 0')

    const items = selectedList.map((p) => ({ productId: p.id, qty: qtyOf(p.id) }))
    setBusy(true)
    try {
      if (editing) {
        await recipesRepo.update(
          recipe.id,
          {
            name,
            unit,
            price,
            area,
            categoryId,
            items,
            normas,
            ...(canCurrency ? { priceCurrency } : {})
          },
          { userId: user.id }
        )
        if (canImages && photoTouched && outputProduct?.id) {
          await imagesRepo.set('product', outputProduct.id, photo)
        }
      } else {
        await recipesRepo.create({
          name,
          unit,
          price,
          area,
          categoryId: categoryId || null,
          // Solo se marca la divisa si difiere de la base (base = sin campo = clasico).
          priceCurrency: canCurrency && priceCurrency !== baseCurrency ? priceCurrency : null,
          items,
          normas,
          photo: canImages ? photo : '',
          userId: user.id
        })
      }
      if (onSaved) onSaved()
      onClose()
    } catch (e) {
      setError('Error al guardar: ' + e.message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={editing ? 'Editar receta' : 'Nueva receta'} onClick={(e) => e.stopPropagation()}>
        <h3>{editing ? 'Editar receta' : 'Nueva receta'}</h3>

        {/* Foto del elaborado (modulo 'imagenes'). Sin el modulo no aparece nada. */}
        {canImages && (
          <div className="field">
            <span>Foto</span>
            <div className="img-picker">
              <div className="img-picker__preview">
                {photo ? <img src={photo} alt="" /> : <span className="img-picker__ph">Sin foto</span>}
              </div>
              <div className="img-picker__actions">
                <label className={`btn btn--ghost btn--sm ${imgBusy ? 'is-disabled' : ''}`}>
                  {imgBusy ? 'Procesando…' : (photo ? 'Cambiar' : 'Agregar')}
                  <input type="file" accept="image/*" onChange={onPickPhoto} disabled={imgBusy} hidden />
                </label>
                {photo && !imgBusy && (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={removePhoto}>Quitar</button>
                )}
              </div>
            </div>
          </div>
        )}

        <label className="field">
          <span>Nombre del elaborado *</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Pizza de queso" />
        </label>

        <div className="form-row">
          <label className="field">
            <span>Unidad</span>
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABELS[u]} ({u})</option>)}
            </select>
          </label>
          <label className="field">
            <span>Categoría</span>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">— Sin categoría —</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>

        {areas.length > 0 && (
          <label className="field">
            <span>Área principal (informativa)</span>
            <select value={area} onChange={(e) => setArea(e.target.value)}>
              <option value="">— {NO_AREA_LABEL} —</option>
              {areas.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
        )}

        {/* Moneda del precio (modulo 'divisas'). Sin el modulo no aparece: el precio
            se entiende en la moneda base, como siempre. */}
        {canCurrency && (
          <label className="field">
            <span>Moneda del precio</span>
            <select value={priceCurrency} onChange={(e) => setPriceCurrency(e.target.value)}>
              {Array.from(new Set([baseCurrency, ...FOREIGN_PRICE_CURRENCIES])).map((c) => (
                <option key={c} value={c}>{c === baseCurrency ? `${c} (base)` : c}</option>
              ))}
            </select>
          </label>
        )}

        <label className="field">
          <span>Precio de venta{canCurrency && priceCurrency !== baseCurrency ? ` (${priceCurrency})` : ''} *</span>
          <input type="number" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        {canCurrency && priceCurrency !== baseCurrency && (
          <p className="muted">
            <small>
              Precio en <strong>{priceCurrency}</strong>. Al cobrar el elaborado, el equivalente
              en {baseCurrency} se calcula con la tasa vigente y se congela en la venta.
            </small>
          </p>
        )}

        {/* Insumos: consumo por 1 unidad del elaborado. Checklist por categoria. */}
        <div className="field">
          <span>Insumos por unidad *</span>
          {selectedList.length === 0
            ? <p className="muted">Marca abajo los productos que consume 1 unidad de este elaborado.</p>
            : (
              <div className="entry-lines">
                {selectedList.map((p) => (
                  <div key={p.id} className="entry-line">
                    <div className="entry-line__head">
                      <div><strong>{p.name}</strong></div>
                      <button className="link-del" onClick={() => toggle(p)}>quitar</button>
                    </div>
                    <label className="field">
                      <span>Cantidad por unidad ({p.unit})</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={selected[p.id] ?? ''}
                        onChange={(e) => setQty(p.id, e.target.value)}
                      />
                    </label>
                  </div>
                ))}
              </div>
            )}
        </div>

        <input
          className="search-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar insumo por nombre o código…"
        />
        {Object.keys(groups).length === 0
          ? <p className="muted">No hay productos en el catálogo para usar como insumo.</p>
          : Object.entries(groups).map(([cat, list]) => (
            <div key={cat} className="check-group">
              <p className="check-group__title">{catName[cat]}</p>
              {list.map((p) => {
                const checked = p.id in selected
                return (
                  <label key={p.id} className={`check-row ${checked ? 'is-checked' : ''}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggle(p)} />
                    <div className="check-row__main">
                      <strong>{p.name}</strong>
                      <span className="muted">{p.code ? `${p.code} · ` : ''}{UNIT_LABELS[p.unit] || p.unit}</span>
                    </div>
                  </label>
                )
              })}
            </div>
          ))}

        <label className="field">
          <span>Normas de consumo (opcional)</span>
          <textarea
            value={normas}
            onChange={(e) => setNormas(e.target.value)}
            rows={3}
            placeholder="Notas de preparación o mermas esperadas…"
          />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" disabled={busy} onClick={save}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
