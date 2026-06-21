// Marca de tiempo en ISO-8601 UTC. Ordenable lexicograficamente y portable
// a Firestore (Timestamp) sin perdida.
export function now() {
  return new Date().toISOString()
}

// Formato corto local para mostrar en pantalla.
export function formatDateTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('es-CU', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return iso
  }
}
