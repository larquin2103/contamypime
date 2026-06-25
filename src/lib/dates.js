// Marca de tiempo en ISO-8601 UTC. Ordenable lexicograficamente y portable
// a Firestore (Timestamp) sin perdida.
export function now() {
  return new Date().toISOString()
}

// Dia calendario LOCAL ('YYYY-MM-DD') de una fecha/ISO. Las ventas se guardan en
// UTC; para contar "hoy", "7 dias", etc. hay que usar el dia local del negocio
// (en Cuba UTC-4/-5 una venta de la noche cae en el dia UTC siguiente). Usar
// esto en todos los filtros/agrupaciones por fecha para que coincidan.
export function localDay(input = new Date()) {
  const d = input instanceof Date ? input : new Date(input)
  if (isNaN(d)) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Dia local de hoy ('YYYY-MM-DD').
export function todayLocal() {
  return localDay(new Date())
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
