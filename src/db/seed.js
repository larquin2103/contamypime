import { db } from './db'
import { now } from '../lib/dates'
import { DEFAULT_SEMAPHORE_CONFIG } from './constants'

// Garantiza la configuracion minima en el primer arranque.
// NO crea usuarios ni tasas: eso lo hace el dueño en el onboarding / Ajustes.
export async function ensureSeed() {
  const baseCurrency = await db.config.get('baseCurrency')
  if (!baseCurrency) {
    await db.config.put({ key: 'baseCurrency', value: 'MN', updatedAt: now() })
  }

  const semaphore = await db.config.get('semaphore')
  if (!semaphore) {
    await db.config.put({
      key: 'semaphore',
      value: DEFAULT_SEMAPHORE_CONFIG,
      updatedAt: now()
    })
  }
}
