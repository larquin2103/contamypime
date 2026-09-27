// FALSO de 'firebase/firestore' SOLO para pruebas (pushTrace, pushEcho). Se
// inyecta con --alias de esbuild; la app NUNCA lo importa (nadie usa
// import.meta.glob). Registra cada escritura en globalThis.__escrituras para
// ver exactamente que habria subido doPush, sin red y sin el SDK.
const log = () => (globalThis.__escrituras ||= [])

export const SELLO = '__serverTimestamp__'
export function initializeFirestore() { return { falso: true } }
export function persistentLocalCache() { return {} }
export function persistentMultipleTabManager() { return {} }
export function doc(_fs, ...segs) { return segs.join('/') }
export function serverTimestamp() { return { [SELLO]: true } }
export function setDoc(ref, data) {
  log().push({ via: 'setDoc', ref, data })
  return Promise.resolve()
}
export function writeBatch() {
  const ops = []
  return {
    set(ref, data) { ops.push({ via: 'batch', ref, data }) },
    commit() {
      log().push(...ops)
      return Promise.resolve()
    }
  }
}
