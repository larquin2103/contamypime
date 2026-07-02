// Bloque 32.1 - Proteccion del almacenamiento local.
//
// Toda la contabilidad vive en IndexedDB. Si el almacenamiento NO esta marcado
// como persistente, el navegador (Chrome/Android) puede DESALOJARLO bajo
// presion de espacio (telefono lleno de fotos) y borrar el negocio completo.
// `navigator.storage.persist()` pide al navegador que lo proteja; instalar la
// PWA aumenta mucho la probabilidad de que lo conceda.

// Pide proteccion persistente. Devuelve true/false segun la conceda, o null si
// el navegador no soporta la API (WebView viejo).
export async function requestPersistentStorage() {
  try {
    if (!navigator.storage?.persist) return null
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return null
  }
}

// Estado actual: { persisted: true/false/null, usage, quota } (bytes o null).
export async function getStorageInfo() {
  const info = { persisted: null, usage: null, quota: null }
  try {
    if (navigator.storage?.persisted) info.persisted = await navigator.storage.persisted()
  } catch { /* sin soporte */ }
  try {
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate()
      info.usage = e.usage ?? null
      info.quota = e.quota ?? null
    }
  } catch { /* sin soporte */ }
  return info
}

// Bytes -> texto legible ("3.2 MB").
export function formatBytes(n) {
  if (!Number.isFinite(n)) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
