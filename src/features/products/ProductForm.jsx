import { useState } from 'react'
import { productsRepo } from '../../repositories/productsRepo'
import { UNITS, UNIT_LABELS } from '../../db/constants'
import { useAuth } from '../../app/providers/AuthProvider'

// Alta / edicion de producto. Solo dueño (la creacion desde entrada de
// mercancia por el vendedor llega en el Bloque 7).
export function ProductForm({ product, categories, onClose, onCreated, hideOpeningStock = false }) {
  const { user } = useAuth()
  const editing = !!product
  const [code, setCode] = useState(product?.code ?? '')
  const [name, setName] = useState(product?.name ?? '')
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? '')
  const [unit, setUnit] = useState(product?.unit ?? UNITS[0])
  const [price, setPrice] = useState(product?.price ?? '')
  const [cost, setCost] = useState(product?.cost ?? '')
  const [minStock, setMinStock] = useState(product?.minStock ?? '')
  const [openingStock, setOpeningStock] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setError('')
    if (!name.trim()) return setError('El nombre es obligatorio')
    if (price === '' || Number(price) < 0) return setError('Indica un precio de venta valido')

    // Codigo unico (si se indica).
    if (code.trim()) {
      const existing = await productsRepo.getByCode(code)
      if (existing && existing.id !== product?.id) {
        return setError(`El codigo "${code}" ya existe (${existing.name})`)
      }
    }

    setBusy(true)
    try {
      if (editing) {
        // El precio se cambia aparte para que quede en el historial.
        await productsRepo.update(product.id, { code, name, categoryId, unit, cost, minStock: Number(minStock) || 0 })
        await productsRepo.changePrice(product.id, price, { userId: user.id })
      } else {
        const newProductId = await productsRepo.create({
          code,
          name,
          categoryId,
          unit,
          price,
          cost,
          minStock: Number(minStock) || 0,
          openingStock: hideOpeningStock ? 0 : openingStock,
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
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{editing ? 'Editar producto' : 'Nuevo producto'}</h3>

        <label className="field">
          <span>Nombre *</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="form-row">
          <label className="field">
            <span>Codigo</span>
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
          <span>Categoria</span>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">— Sin categoria —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

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

        <label className="field">
          <span>Stock minimo (alerta de reabastecimiento)</span>
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
