// ---------------------------------------------------------------------------
// Licencias de activacion (offline, sin servidor).
//
// Una licencia es un texto firmado con la clave PRIVADA del desarrollador, que
// nunca viaja ni se sube al repo. La app solo lleva la clave PUBLICA (la de
// abajo): no es secreta y solo sirve para VERIFICAR. Nadie puede fabricar una
// licencia valida sin la clave privada -> imposible de falsificar.
//
// Las licencias se emiten con  tools/gen-license.mjs  (script privado).
// La compuerta que bloquea la app sin licencia valida se monta en el Bloque 28.
//
// Algoritmo: ECDSA P-256 + SHA-256 (WebCrypto). Mismo que el generador en Node,
// por eso firma y verificacion son compatibles bit a bit.
// Formato del codigo:  MYPI1.<datosB64url>.<firmaB64url>
// ---------------------------------------------------------------------------

const PREFIX = 'MYPI1'
const VERIFY_ALGO = { name: 'ECDSA', hash: 'SHA-256' }
const IMPORT_ALGO = { name: 'ECDSA', namedCurve: 'P-256' }

// Clave publica del emisor (JWK). NO es secreta.
// Para produccion, genera tu propio par con `node tools/gen-license.mjs keygen`
// y reemplaza este objeto por el que imprime el comando.
export const PUBLIC_KEY_JWK = {
  "key_ops":["verify"],"ext":true,"kty":"EC","x":"6KnS_4aMxp_PCns6qDJvpyH9Xs76CDJSFfOAjgRGjW4","y":"zm322vFkZWr0SL1IRlgohTEiABIY4Ptxq69vs3aLX58","crv":"P-256"
}

const enc = new TextEncoder()
const dec = new TextDecoder()

function b64urlToBytes(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : ''
  const bin = atob(b64 + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

let cachedKey = null
async function importPublicKey() {
  if (cachedKey) return cachedKey
  cachedKey = await crypto.subtle.importKey('jwk', PUBLIC_KEY_JWK, IMPORT_ALGO, false, ['verify'])
  return cachedKey
}

// Verifica firma y formato. Devuelve { valid, payload, reason }.
// reason: 'formato' | 'firma' | 'error' (no evalua caducidad; ver evaluateLicense).
export async function verifyLicense(token) {
  try {
    const raw = String(token || '').trim()
    const parts = raw.split('.')
    if (parts.length !== 3 || parts[0] !== PREFIX) {
      return { valid: false, payload: null, reason: 'formato' }
    }
    const [, payloadB64, sigB64] = parts
    const signed = enc.encode(PREFIX + '.' + payloadB64)
    const sig = b64urlToBytes(sigB64)
    const key = await importPublicKey()
    const ok = await crypto.subtle.verify(VERIFY_ALGO, key, sig, signed)
    if (!ok) return { valid: false, payload: null, reason: 'firma' }
    const payload = JSON.parse(dec.decode(b64urlToBytes(payloadB64)))
    return { valid: true, payload, reason: null }
  } catch (e) {
    return { valid: false, payload: null, reason: 'error', error: e?.message }
  }
}

// Dia de hoy en formato YYYY-MM-DD (las licencias comparan por fecha, sin hora,
// para evitar lios de zona horaria).
export function today() {
  return new Date().toISOString().slice(0, 10)
}

// Dias entre hoy y la fecha de caducidad (puede ser negativo si ya caduco).
export function daysUntil(expira, from = today()) {
  if (!expira) return Infinity // sin caducidad
  const a = Date.parse(from + 'T00:00:00Z')
  const b = Date.parse(expira + 'T00:00:00Z')
  return Math.round((b - a) / 86400000)
}

// Evalua una licencia COMPLETA: firma + vigencia. Devuelve un estado util para
// la UI. `nowDate` permite forzar la fecha (anti-trampa de reloj en Bloque 29).
//   status: 'none' | 'invalid' | 'expired' | 'expiring' | 'active'
export async function evaluateLicense(token, { nowDate = today(), warnDays = 7 } = {}) {
  if (!token) return { status: 'none', payload: null, daysLeft: null }
  const res = await verifyLicense(token)
  if (!res.valid) return { status: 'invalid', payload: null, reason: res.reason, daysLeft: null }
  const left = daysUntil(res.payload.expira, nowDate)
  if (left < 0) return { status: 'expired', payload: res.payload, daysLeft: left }
  if (left <= warnDays) return { status: 'expiring', payload: res.payload, daysLeft: left }
  return { status: 'active', payload: res.payload, daysLeft: left }
}
