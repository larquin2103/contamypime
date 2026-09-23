import { isCompareResendable, candidatesSince, decide, MAX_PER_RUN, summarize } from './compareResend.js'

// ---------------------------------------------------------------------------
// Nucleo del reenvio que compara (spec 2026-09-23). Todo lo externo se inyecta
// (Dexie, syncConfig, Firestore, registro), asi que se prueba con node sin nada de
// eso. compareResendFirebase.js lo conecta a lo real.
//
// No usa el cursor, ni la cola de reintentos, ni el cerrojo `running` de la
// subida: si la subida normal hace a la vez un set a ciegas del mismo documento,
// escribe la MISMA version local (sale del mismo aparato). Cerrojo propio para
// que no corran dos tandas a la vez.
// ---------------------------------------------------------------------------
const toCloud = (rec) => JSON.parse(JSON.stringify(rec)) // la misma conversion que la subida

export function createCompareResender(deps) {
  let comparing = false

  async function candidates(name, sinceIso) {
    if (!isCompareResendable(name)) throw new Error('Esa colección no se puede reparar comparando')
    if (typeof sinceIso !== 'string') throw new Error('Escribe una fecha válida.')
    return candidatesSince(await deps.listLocal(name), sinceIso)
  }

  async function count(name, sinceIso) {
    return (await candidates(name, sinceIso)).length
  }

  async function run(name, sinceIso, { onProgress } = {}) {
    if (comparing) throw new Error('Ya hay una reparación en curso: espera a que termine')
    comparing = true
    try {
      const rows = await candidates(name, sinceIso)
      if (rows.length > MAX_PER_RUN) {
        throw new Error(`Hay ${rows.length} documentos desde esa fecha: acota la fecha (máximo ${MAX_PER_RUN} por tanda).`)
      }
      const why = await deps.ready()
      if (why) throw new Error(why)
      if (!deps.isOnline()) throw new Error('Sin conexión: la reparación necesita internet para comparar con la nube')

      const pk = deps.pkOf(name)
      const results = []
      for (let i = 0; i < rows.length; i++) {
        const id = String(rows[i][pk])
        try {
          const local = await deps.getLocal(name, id) // se relee: puede haber cambiado
          if (!local) {
            results.push({ id, decision: 'error' })
            deps.log('comparar-reenvio', name, { code: 'sin-local' }, id)
          } else {
            const decision = await deps.runTx(name, id, async (cloud) => {
              const d = decide(local, cloud)
              return { decision: d, write: d === 'escribir' ? toCloud(local) : null }
            })
            results.push({ id, decision })
          }
        } catch (e) {
          results.push({ id, decision: 'error' })
          deps.log('comparar-reenvio', name, e, id)
          // Errores de RED: seguir solo gastaria tiempo (el SDK ya reintento 5 veces).
          if (e?.code === 'unavailable' || e?.code === 'deadline-exceeded') {
            if (onProgress) onProgress(i + 1, rows.length)
            return summarize(results, rows.length - (i + 1))
          }
        }
        if (onProgress) onProgress(i + 1, rows.length)
      }
      return summarize(results, 0)
    } finally {
      comparing = false
    }
  }

  return { count, run }
}
