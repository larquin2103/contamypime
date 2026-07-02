import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { categoriesRepo } from '../../repositories/categoriesRepo'
import { useEscapeClose } from '../../lib/useEscapeClose'

// Gestion de categorias (solo dueño). Baja logica: nunca se borran.
export function CategoryManager({ onClose }) {
  const categories = useLiveQuery(() => categoriesRepo.list(), [], [])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  useEscapeClose(onClose)

  const add = async () => {
    if (!name.trim()) return
    setBusy(true)
    await categoriesRepo.create(name)
    setName('')
    setBusy(false)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Categorías" onClick={(e) => e.stopPropagation()}>
        <h3>Categorías</h3>

        <div className="form-row form-row--inline">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nueva categoría"
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button className="btn btn--primary" disabled={busy || !name.trim()} onClick={add}>
            Añadir
          </button>
        </div>

        <div className="list">
          {categories.map((c) => (
            <div key={c.id} className={`list-item ${c.active ? '' : 'is-inactive'}`}>
              <strong>{c.name}</strong>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => categoriesRepo.setActive(c.id, !c.active)}
              >
                {c.active ? 'Desactivar' : 'Activar'}
              </button>
            </div>
          ))}
          {categories.length === 0 && <p className="muted">Aún no hay categorías.</p>}
        </div>

        <div className="modal__actions">
          <button className="btn btn--primary btn--block" onClick={onClose}>
            Listo
          </button>
        </div>
      </div>
    </div>
  )
}
