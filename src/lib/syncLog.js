import { errorsRepo } from '../repositories/errorsRepo'
import { version as appVersion } from '../../package.json'
import { createSyncGate, syncKey, codeOf, syncMessage } from './syncLogPolicy'

// Registro de la SINCRONIZACION en /errors (La Patrona §14.5). La politica (que
// se guarda y cuanto) vive en syncLogPolicy.js, pura y probada; esto solo escribe.
// Como logError: nunca lanza y nunca se espera (no frena la sync ni el cobro).
const gate = createSyncGate({ budget: 30 })

export function logSyncEvent(stage, col, error, detail = '') {
  try {
    const code = codeOf(error)
    if (!gate.shouldLog(syncKey(stage, col, code))) return
    const msg = error?.message && error.message !== code ? error.message : ''
    errorsRepo.add({
      source: 'sync',
      message: syncMessage(stage, col, code, [detail, msg].filter(Boolean).join(' · ')),
      route: globalThis.location?.pathname || '', // sin window no lanza (revision, menor 3)
      appVersion
    })
  } catch { /* jamas tumbar la sync por registrar */ }
}
