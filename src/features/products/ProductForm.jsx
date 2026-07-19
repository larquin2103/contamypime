import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { productsRepo } from '../../repositories/productsRepo'
import { configRepo } from '../../repositories/configRepo'
import { UNITS, UNIT_LABELS, NO_AREA_LABEL, WAREHOUSE, locationLabel } from '../../db/constants'
import { useAuth } from '../../app/providers/AuthProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { normalizeTiers } from '../../lib/priceTiers'
import { useEscapeClose } from '../../lib/useEscapeClose'

// Alta / edicion de producto. Solo dueño (la creacion desde entrada de
// mercancia por el vendedor llega en el Bloque 7).
export function ProductForm({ product, categories, onClose, onCreated, hideOpeningStock = false }) {
  const { user } = useAuth()
  const editing = !!product
  const areas = useLiveQuery(() => configRepo.getAreas(), [], [])
  const [code, setCode] = useState(product?.code ?? '')
  const [name, setName] = useState(product?.name ?? '')
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? '')
  const [area, setArea] = useState(product?.area ?? '')
  const [unit, setUnit] = useState(product?.unit ?? UNITS[0])
  const [price, setPrice] = useState(product?.price ?? '')
  const [cost, setCost] = useState(product?.cost ?? '')
  const [minStock, setMinStock] = useState(product?.minStock ?? '')
  const [openingStock, setOpeningStock] = useState('')
  // Escalas mayoristas (Bloque B): filas { minQty, price } editables. Solo se
  // muestran/guardan si la licencia trae el modulo 'mayorista'.
  const { hasModule } = useLicense()
  const canTiers = hasModule(LICENSE_MODULES.WHOLESALE)
  const [tiers, setTiers] = useState(() =>
    (product?.priceTiers || []).map((t) => ({ minQty: String(t.minQty), price: String(t.price) }))
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEscapeClose(onClose)

  const setTier = (i, field, value) =>
    setTiers((prev) => prev.map((t, j) => (j === i ? { ...t, [field]: value } : t)))
  const addTier = () => setTiers((prev) => [...prev, { minQty: '', price: '' }])
  const removeTier = (i) => setTiers((prev) => prev.filter((_, j) => j !== i))

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
        await productsRepo.update(product.id, { code, name, categoryId, area, unit, cost, minStock: Number(minStock) || 0 })
        await productsRepo.changePrice(product.id, price, { userId: user.id })
        if (canTiers) await productsRepo.changeTiers(product.id, draftTiers, { userId: user.id })
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
          userId: user.id
        })
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
                .filter(([, q]) => Number(q) !== 0)
                .sort(([a], [b]) => (a === WAREHOUSE ? -1 : b === WAREHOUSE ? 1 : a.localeCompare(b)))
                .map(([loc, q]) => (
                  <div key={loc} className="kv">
                    <span className="muted">{locationLabel(loc)}</span>
                    <strong>{Number(q)} {product.unit}</strong>
                  </div>
                ))}
              {Object.values(product.stockByLocation).every((q) => Number(q) === 0) && (
                <p className="muted">Sin existencias.</p>
              )}
            </div>
          </div>
        )}

        <div className="form-row">
          <label className="field">
            <span>Precio venta *</span>
            <input
              type="number"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Costo</span>
            <input
              type="number"
              inputMode="decimal"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </label>
        </div>

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

        <div className="modal__actions">
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
