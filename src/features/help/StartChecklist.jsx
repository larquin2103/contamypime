import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check } from 'lucide-react'
import { productsRepo } from '../../repositories/productsRepo'
import { shiftsRepo } from '../../repositories/shiftsRepo'
import { salesRepo } from '../../repositories/salesRepo'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { SHIFT_STATUS } from '../../db/constants'

const STORAGE_KEY = 'startChecklistHidden'

// Fase C - Guía de inicio: checklist que se marca SOLO según el estado real del
// negocio (no guarda progreso propio; lo deriva de la BD). Ayuda al dueño del
// demo a no perderse en los primeros minutos. Se puede ocultar y no vuelve.
export function StartChecklist() {
  const { rates } = useCurrency()
  const products = useLiveQuery(() => productsRepo.list(), [], undefined)
  const shifts = useLiveQuery(() => shiftsRepo.list(), [], undefined)
  const sales = useLiveQuery(() => salesRepo.listAll(), [], undefined)
  const [hidden, setHidden] = useState(() => localStorage.getItem(STORAGE_KEY) === '1')

  if (hidden) return null
  if (products === undefined || shifts === undefined || sales === undefined) return null

  const steps = [
    { key: 'rates', done: !!rates && Object.keys(rates).length > 0, label: 'Configura tus tasas de cambio', to: '/settings' },
    { key: 'products', done: products.length > 0, label: 'Carga tus productos', to: '/catalog' },
    { key: 'shift', done: shifts.length > 0, label: 'Abre un turno', to: '/shift' },
    { key: 'sale', done: sales.length > 0, label: 'Registra una venta', to: '/sell' },
    { key: 'close', done: shifts.some((s) => s.status === SHIFT_STATUS.CLOSED), label: 'Cierra el turno (haz tu cuadre)', to: '/shift' }
  ]
  const doneCount = steps.filter((s) => s.done).length
  const allDone = doneCount === steps.length
  const pct = Math.round((doneCount / steps.length) * 100)

  const hide = () => { localStorage.setItem(STORAGE_KEY, '1'); setHidden(true) }

  return (
    <section className="card start-guide">
      <div className="start-guide__head">
        <h3>{allDone ? '🎉 ¡Listo para trabajar!' : '🚀 Primeros pasos'}</h3>
        <span className="badge">{doneCount}/{steps.length}</span>
      </div>
      <p className="muted">
        {allDone
          ? 'Ya diste todos los pasos básicos. Puedes ocultar esta guía.'
          : 'Sigue estos pasos para poner tu negocio a andar. Se marcan solos al completarlos.'}
      </p>
      <div className="progress"><div className="progress__bar" style={{ width: `${pct}%` }} /></div>

      <ol className="start-steps">
        {steps.map((s) => (
          <li key={s.key} className={`start-step ${s.done ? 'is-done' : ''}`}>
            <span className="start-step__mark">
              {s.done ? <Check size={15} strokeWidth={3} /> : null}
            </span>
            {s.done ? (
              <span className="start-step__label">{s.label}</span>
            ) : (
              <Link to={s.to} className="start-step__label start-step__label--link">{s.label}</Link>
            )}
          </li>
        ))}
      </ol>

      <button className="btn btn--ghost btn--block btn--sm" onClick={hide}>
        {allDone ? 'Ocultar guía' : 'Ocultar por ahora'}
      </button>
    </section>
  )
}
