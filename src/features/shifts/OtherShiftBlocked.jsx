import { useLiveQuery } from 'dexie-react-hooks'
import { usersRepo } from '../../repositories/usersRepo'
import { formatDateTime } from '../../lib/dates'

// Hay un turno activo de OTRO vendedor: ni el dueno puede operar sobre el.
export function OtherShiftBlocked({ shift }) {
  const seller = useLiveQuery(() => usersRepo.get(shift.sellerId), [shift.sellerId])

  return (
    <div className="screen">
      <h2>Turno en curso</h2>
      <section className="card">
        <p>
          Hay un turno abierto por <strong>{seller?.name || 'otro vendedor'}</strong> desde{' '}
          {formatDateTime(shift.openedAt)}.
        </p>
        <p className="muted">
          Solo quien abrio el turno puede registrar ventas y cerrarlo. Espera a que cierre
          su turno para abrir el tuyo.
        </p>
      </section>
    </div>
  )
}
