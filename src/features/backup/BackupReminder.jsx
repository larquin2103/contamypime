import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { configRepo } from '../../repositories/configRepo'
import { salesRepo } from '../../repositories/salesRepo'

// Bloque 32.4 - Recordatorio de respaldo en el Home del dueño. Solo aparece si
// NO hay sincronizacion en la nube (con sync, los datos ya estan a salvo) y el
// ultimo respaldo es viejo (o nunca se hizo y ya hay ventas que perder).
const REMINDER_DAYS = 7

export function BackupReminder() {
  const syncEnabled = useLiveQuery(() => configRepo.get('syncEnabled', false), [], undefined)
  const lastBackupAt = useLiveQuery(() => configRepo.get('lastBackupAt', null), [], undefined)
  const salesCount = useLiveQuery(() => salesRepo.count(), [], 0)

  if (syncEnabled === undefined || lastBackupAt === undefined) return null
  if (syncEnabled) return null

  let stale = false
  if (!lastBackupAt) {
    stale = salesCount > 0 // sin respaldo nunca: avisa en cuanto haya algo que perder
  } else {
    const ageDays = (Date.now() - new Date(lastBackupAt).getTime()) / 86400000
    stale = ageDays > REMINDER_DAYS
  }
  if (!stale) return null

  return (
    <Link to="/backup" className="shift-status shift-status--other">
      <span>
        💾 {lastBackupAt
          ? `Tu último respaldo tiene más de ${REMINDER_DAYS} días. Toca para hacer uno nuevo.`
          : 'Aún no has hecho ningún respaldo de tus datos. Toca para hacer el primero.'}
      </span>
    </Link>
  )
}
