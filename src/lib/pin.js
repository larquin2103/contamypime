// Hash de PIN con PBKDF2 (WebCrypto). Nunca guardamos el PIN en claro,
// ni siquiera en la base local.
const enc = new TextEncoder()
const ITERATIONS = 100_000

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  return out
}

async function deriveHex(pin, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(String(pin)),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  )
  return bytesToHex(new Uint8Array(bits))
}

// Devuelve { hash, salt } (ambos hex). Genera salt nuevo si no se pasa.
export async function hashPin(pin, saltHex) {
  const saltBytes = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16))
  const hash = await deriveHex(pin, saltBytes)
  return { hash, salt: bytesToHex(saltBytes) }
}

// Comparacion en tiempo constante: no corta al primer caracter distinto, para
// no filtrar por tiempo cuanto del hash coincide. En este modelo local el
// riesgo es minimo, pero es higiene barata al comparar secretos.
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function verifyPin(pin, saltHex, expectedHash) {
  if (!saltHex || !expectedHash) return false
  const { hash } = await hashPin(pin, saltHex)
  return constantTimeEqual(hash, expectedHash)
}

// Codigo de recuperacion para el PIN del dueño (offline, sin correo).
// Formato legible: ABCD-EF12-34. Se muestra una vez y se guarda hasheado.
export function genRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(5))
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 10)}`
}

// Normaliza el codigo que teclea el usuario (sin guiones, mayusculas).
export function normalizeRecoveryCode(code) {
  return String(code || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
}
