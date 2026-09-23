import { syncTs } from './collections.js'

// ---------------------------------------------------------------------------
// Reenvio que COMPARA antes de escribir (La Patrona §14.5; spec
// docs/superpowers/specs/2026-09-23-reenvio-comparando-design.md). PURO.
//
// El reenvio de resend.js escribe a ciegas y por eso solo admite libros
// inmutables. Este lee la nube y escribe SOLO si la nube no tiene el documento o
// lo local es ESTRICTAMENTE mas nuevo por syncTs (el mismo criterio que la bajada),
// asi que tambien vale para colecciones mutables: no puede hacer retroceder nada.
// Alcance cerrado por el duenio: las tres colecciones de La Patrona.
// ---------------------------------------------------------------------------
export const COMPARE_RESENDABLE = ['products', 'counts', 'auditEvents']

export const isCompareResendable = (name) => COMPARE_RESENDABLE.includes(name)

export const MAX_PER_RUN = 1000

// Candidatos: MISMO predicado que pushEngine (syncTs(r) > cursor, estricto).
export function candidatesSince(rows, sinceIso) {
  const list = Array.isArray(rows) ? rows : []
  return list.filter((r) => { const ts = syncTs(r); return ts && ts > (sinceIso || '') })
}

// La regla. Con marcas iguales NO se escribe: lo que pueda diferir son campos
// derivados (la cache del stock) que cada aparato recalcula por su cuenta.
export function decide(local, cloud) {
  if (!cloud) return 'escribir'
  const l = syncTs(local) || ''
  const c = syncTs(cloud) || ''
  if (l > c) return 'escribir'
  if (l === c) return 'igual'
  return 'nube-mas-nueva'
}

export function summarize(results, pendientes = 0) {
  const out = { escritos: 0, iguales: 0, nubeMasNueva: 0, errores: 0, pendientes }
  for (const r of Array.isArray(results) ? results : []) {
    if (r.decision === 'escribir') out.escritos++
    else if (r.decision === 'igual') out.iguales++
    else if (r.decision === 'nube-mas-nueva') out.nubeMasNueva++
    else out.errores++
  }
  return out
}
