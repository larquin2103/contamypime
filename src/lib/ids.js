// UUID string como clave primaria de todas las colecciones.
// Amigable para la replicacion a Firestore/RxDB en Fase 4.
export function newId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }
  // Fallback muy improbable en navegadores modernos.
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}
