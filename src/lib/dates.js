// Marca de tiempo en ISO-8601 UTC. Ordenable lexicograficamente y portable
// a Firestore (Timestamp) sin perdida.
export function now() {
  return new Date().toISOString()
}

// Marca de tiempo para una MUTACION: nunca por debajo de la version que se esta
// reemplazando. Si el reloj del dispositivo va ATRASADO respecto a la marca que
// trajo el otro equipo, la mutacion naceria "mas vieja" que el estado anterior:
// el LWW de bajada la DESCARTARIA (fusiona solo si la marca entrante es MAYOR que
// la local) y el cursor de subida podria saltarsela. Se le pasan los campos de
// tiempo del registro que CUENTAN para su marca de sync (ver TS_FIELDS en
// features/sync/collections).
//
// Con el reloj coherente —o con un solo dispositivo— devuelve now() tal cual: el
// comportamiento clasico NO cambia. Solo se desvia (+1 ms sobre la version
// anterior) en el caso que hoy queda roto. Es PURA: no toca la base ni el reloj.
export function tsAfter(...prev) {
  const t = now()
  let max = ''
  for (const p of prev) if (typeof p === 'string' && p > max) max = p
  if (!max || max < t) return t // reloj coherente: identico a hoy
  const ms = new Date(max).getTime()
  // Marca ilegible (dato corrupto): no se bloquea la operacion, se sella con la
  // hora local como siempre.
  if (!Number.isFinite(ms)) return t
  return new Date(ms + 1).toISOString()
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
