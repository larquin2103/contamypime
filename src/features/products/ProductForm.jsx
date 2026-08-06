import { useState, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { productsRepo } from '../../repositories/productsRepo'
import { imagesRepo } from '../../repositories/imagesRepo'
import { configRepo } from '../../repositories/configRepo'
import { UNITS, UNIT_LABELS, NO_AREA_LABEL, WAREHOUSE, locationLabel, FOREIGN_PRICE_CURRENCIES } from '../../db/constants'
import { useAuth } from '../../app/providers/AuthProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { fileToThumbnail } from '../../lib/image'
import { cleanQty } from '../../lib/qty'
import { normalizeTiers } from '../../lib/priceTiers'
import { useEscapeClose } from '../../lib/useEscapeClose'

// Alta / edicion de producto. Solo dueño (la creacion desde entrada de
// mercancia por el vendedor llega en el Bloque 7).
export function ProductForm({ product, categories, onClose, onCreated, hideOpeningStock = false }) {
  const { user, isOwner } = useAuth()
  const { baseCurrency } = useCurrency()
  const editing = !!product
  // Eliminar del catalogo: SOLO el dueño, con confirmacion. Es borrado logico.
  const [confirmDel, setConfirmDel] = useState(false)
  const areas = useLiveQuery(() => configRepo.getAreas(), [], [])
  const [code, setCode] = useState(product?.code ?? '')
  const [name, setName] = useState(product?.name ?? '')
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? '')
  const [area, setArea] = useState(product?.area ?? '')
  const [unit, setUnit] = useState(product?.unit ?? UNITS[0])
  const [price, setPrice] = useState(product?.price ?? '')
  const [cost, setCost] = useState(product?.cost ?? '')
  // Modulo 'divisas': moneda en que el dueño teclea precio/costo (base o divisa).
  // Ausente en el producto = base (comportamiento clasico).
  const [priceCurrency, setPriceCurrency] = useState(product?.priceCurrency || baseCurrency)
  const [minStock, setMinStock] = useState(product?.minStock ?? '')
  const [openingStock, setOpeningStock] = useState('')
  // Escalas mayoristas (Bloque B): filas { minQty, price } editables. Solo se
  // muestran/guardan si la licencia trae el modulo 'mayorista'.
  const { hasModule } = useLicense()
  const canTiers = hasModule(LICENSE_MODULES.WHOLESALE)
  // Modulo 'divisas': habilita fijar el precio/costo del producto en una divisa.
  const canCurrency = hasModule(LICENSE_MODULES.MULTICURRENCY)
  const [tiers, setTiers] = useState(() =>
    (product?.priceTiers || []).map((t) => ({ minQty: String(t.minQty), price: String(t.price) }))
  )
  // Foto del producto (Fase 8 - B4, módulo 'imagenes'). Miniatura JPEG en la
  // colección `images` (aparte del producto). Sin el módulo, nada de esto se
  // muestra ni se guarda -> el formulario queda idéntico a hoy.
  const canImages = hasModule(LICENSE_MODULES.IMAGES)
  const [photo, setPhoto] = useState('') // dataUrl actual (vacío = sin foto)
  const [photoTouched, setPhotoTouched] = useState(false) // ¿el usuario la cambió?
  const [imgBusy, setImgBusy] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEscapeClose(onClose)

  // Carga la foto existente al abrir (solo en edición y con el módulo activo).
  useEffect(() => {
    let alive = true
    if (canImages && editing) {
      imagesRepo.getDataUrl('product', product.id).then((d) => { if (alive) setPhoto(d) })
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
      const dataUrl = await fileToThumbnail(file)
      setPhoto(dataUrl)
      setPhotoTouched(true)
    } catch (err) {
      setError('No se pudo procesar la imagen: ' + err.message)
    } finally {
      setImgBusy(false)
    }
  }
  const removePhoto = () => { setPhoto(''); setPhotoTouched(true) }

  const setTier = (i, field, value) =>
    setTiers((prev) => prev.map((t, j) => (j === i ? { ...t, [field]: value } : t)))
  const addTier = () => setTiers((prev) => [...prev, { minQty: '', price: '' }])
  const removeTier = (i) => setTiers((prev) => prev.filter((_, j) => j !== i))

  const remove = async () => {
    setError('')
    setBusy(true)
    try {
      await productsRepo.remove(product.id, { userId: user.id })
      onClose()
    } catch (e) {
      setError('No se pudo eliminar: ' + e.message)
      setBusy(false)
    }
  }

  const save = async () => {
    setError('')
    if (!name.trim()) return setError('El nombre es obligatorio')
    if (price === '' || Number(price) < 0) return setError('Indica un precio de venta válido')

    // Codigo unico (si se indica).
    if (code.trim()) {
      const existing = await productsRepo.getByCode(code)
      if (existing && existing.id !== product?.id) {
        return setError(`El código "${code}" ya existe (${existing.name})`)
      }
    }

    // Escalas: valida que las filas llenas sean coherentes (cantidad > 1).
    const filledTiers = tiers.filter((t) => String(t.minQty).trim() !== '' || String(t.price).trim() !== '')
    const draftTiers = filledTiers.map((t) => ({ minQty: Number(t.minQty), price: Number(t.price) }))
    if (canTiers && normalizeTiers(draftTiers).length !== filledTiers.length) {
      return setError('Revisa las escalas: cantidad mínima mayor que 1 y precio válido, sin repetir cantidades')
    }

    setBusy(true)
    try {
      if (editing) {
        // El precio se cambia aparte para que quede en el historial.
        await productsRepo.update(product.id, { code, name, categoryId, area, unit, cost, minStock: Number(minStock) || 0, ...(canCurrency ? { priceCurrency } : {}) })
        await productsRepo.changePrice(product.id, price, { userId: user.id })
        if (canTiers) await productsRepo.changeTiers(product.id, draftTiers, { userId: user.id })
        // Foto: solo si el módulo está activo y el usuario la tocó (vacío = quitar).
        if (canImages && photoTouched) await imagesRepo.set('product', product.id, photo)
      } else {
        const newProductId = await productsRepo.create({
          code,
          name,
          categoryId,
          area,
          unit,
          price,
          cost,
          minStock: Number(minStock) || 0,
          openingStock: hideOpeningStock ? 0 : openingStock,
          priceTiers: canTiers ? draftTiers : [],
          // Solo se marca la divisa cuando difiere de la base (nuevos productos en
          // base quedan sin el campo -> identicos al clasico).
          priceCurrency: canCurrency && priceCurrency !== baseCurrency ? priceCurrency : undefined,
          userId: user.id
        })
        // La foto se guarda YA con el id del producto recién creado (aparte).
        if (canImages && photoTouched && photo) await imagesRepo.set('product', newProductId, photo)
        if (onCreated) onCreated(newProductId)
      }
      onClose()
    } catch (e) {
      setError('Error al guardar: ' + e.message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={editing ? 'Editar producto' : 'Nuevo producto'} onClick={(e) => e.stopPropagation()}>
        <h3>{editing ? 'Editar producto' : 'Nuevo producto'}</h3>

        {/* Foto del producto (módulo 'imagenes'). Sin el módulo no aparece nada. */}
        {canImages && (
          <div className="field">
            <span>Foto</span>
            <div className="img-picker">
              <div className="img-picker__preview">
                {photo
                  ? <img src={photo} alt="" />
                  : <span className="img-picker__ph">Sin foto</span>}
              </div>
              <div className="img-picker__actions">
                <label className={`btn btn--ghost btn--sm ${imgBusy ? 'is-disabled' : ''}`}>
                  {imgBusy ? 'Procesando…' : (photo ? 'Cambiar' : 'Agregar')}
                  <input type="file" accept="image/*" onChange={onPickPhoto} disabled={imgBusy} hidden />
                </label>
                {photo && !imgBusy && (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={removePhoto}>
                    Quitar
                  </button>
                )}
              </div>
            </div>
            <p className="muted">
              <small>Cámara o galería. Se guarda una miniatura (≤256 px) en este negocio; se sincroniza con la nube si la tienes.</small>
            </p>
          </div>
        )}

        <label className="field">
          <span>Nombre *</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="form-row">
          <label className="field">
            <span>Código</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Ej: AV001" />
          </label>
          <label className="field">
            <span>Unidad</span>
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABELS[u]} ({u})
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="field">
          <span>Categoría</span>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">— Sin categoría —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        {areas.length > 0 && (
          <label className="field">
            <span>Área principal (informativa)</span>
            <select value={area} onChange={(e) => setArea(e.target.value)}>
              <option value="">— {NO_AREA_LABEL} —</option>
              {areas.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </label>
        )}

        {editing && product.stockByLocation && (
          <div className="field">
            <span>Existencias por ubicación</span>
            <div className="kv-list">
              {Object.entries(product.stockByLocation)
                .filter(([, q]) => cleanQty(q) !== 0)
                .sort(([a], [b]) => (a === WAREHOUSE ? -1 : b === WAREHOUSE ? 1 : a.localeCompare(b)))
                .map(([loc, q]) => (
                  <div key={loc} className="kv">
                    <span className="muted">{locationLabel(loc)}</span>
                    <strong>{cleanQty(q)} {product.unit}</strong>
                  </div>
                ))}
              {Object.values(product.stockByLocation).every((q) => cleanQty(q) === 0) && (
                <p className="muted">Sin existencias.</p>
              )}
            </div>
          </div>
        )}

        {/* Moneda del precio (módulo 'divisas'). Sin el módulo no aparece nada y
            el precio/costo se entienden en la moneda base, como siempre. */}
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

        <div className="form-row">
          <label className="field">
            <span>Precio venta{canCurrency && priceCurrency !== baseCurrency ? ` (${priceCurrency})` : ''} *</span>
            <input
              type="number"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Costo{canCurrency && priceCurrency !== baseCurrency ? ` (${priceCurrency})` : ''}</span>
            <input
              type="number"
              inputMode="decimal"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </label>
        </div>
        {canCurrency && priceCurrency !== baseCurrency && (
          <p className="muted">
            <small>
              Precio y costo en <strong>{priceCurrency}</strong>. Al cobrar, el equivalente
              en {baseCurrency} se calcula con la tasa vigente y se congela en la venta.
            </small>
          </p>
        )}

        {canTiers && (
          <div className="field">
            <span>Escalas mayoristas (precio por {UNIT_LABELS[unit] || unit} según cantidad)</span>
            {tiers.length === 0 && (
              <p className="muted">Sin escalas: siempre rige el precio de venta normal.</p>
            )}
            {tiers.map((t, i) => (
              <div key={i} className="form-row">
                <label className="field">
                  <span>Desde (cantidad)</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={t.minQty}
                    onChange={(e) => setTier(i, 'minQty', e.target.value)}
                    placeholder="Ej: 20"
                  />
                </label>
                <label className="field">
                  <span>Precio por unidad</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={t.price}
                    onChange={(e) => setTier(i, 'price', e.target.value)}
                    placeholder="Ej: 100"
                  />
                </label>
                <button className="btn btn--ghost btn--sm" onClick={() => removeTier(i)} type="button">
                  Quitar
                </button>
              </div>
            ))}
            <button className="btn btn--ghost btn--sm" onClick={addTier} type="button">
              + Agregar escala
            </button>
          </div>
        )}

        <label className="field">
          <span>Stock mínimo (alerta de reabastecimiento)</span>
          <input
            type="number"
            inputMode="decimal"
            value={minStock}
            onChange={(e) => setMinStock(e.target.value)}
            placeholder="0"
          />
        </label>

        {!editing && !hideOpeningStock && (
          <label className="field">
            <span>Existencia inicial</span>
            <input
              type="number"
              inputMode="decimal"
              value={openingStock}
              onChange={(e) => setOpeningStock(e.target.value)}
              placeholder="0"
            />
          </label>
        )}

        {error && <p className="error">{error}</p>}

        {/* Eliminar del catalogo: solo el dueño, en edicion, con confirmacion. */}
        {editing && isOwner && confirmDel && (
          <div className="card">
            <p>
              ¿Eliminar <strong>{name}</strong> del catálogo? Se conserva todo el historial
              (ventas, movimientos, stock); solo deja de estar disponible. Queda en auditoría.
            </p>
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setConfirmDel(false)}>Cancelar</button>
              <button className="btn btn--primary" disabled={busy} onClick={remove}>
                {busy ? 'Eliminando…' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        )}

        <div className="modal__actions">
          {editing && isOwner && !confirmDel && (
            <button className="btn btn--ghost link-del" style={{ marginRight: 'auto' }} onClick={() => setConfirmDel(true)}>
              🗑 Eliminar
            </button>
          )}
          <button className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn--primary" disabled={busy} onClick={save}>
            {busy ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
