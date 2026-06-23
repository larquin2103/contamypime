import { pushChanges } from './pushEngine'

// ---------------------------------------------------------------------------
// Fase 4 - Orquestador de sincronizacion.
//
// Bloque 23: sube los cambios locales. (La bajada en tiempo real y el
// arranque automatico llegan en los bloques 24 y 25.)
// ---------------------------------------------------------------------------
export async function syncNow() {
  const up = await pushChanges()
  return { up }
}
