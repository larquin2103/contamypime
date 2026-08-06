#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Lector PRIVADO de licencias de activacion de MypiCuadre.
//
// Complemento de  tools/gen-license.mjs : uno EMITE, este LEE. Toma un codigo de
// licencia ya emitido y muestra a detalle los datos con que se creo (negocio,
// plan, fechas, dispositivos, modulos) y verifica que la FIRMA sea autentica.
//
// Es una herramienta LOCAL de desarrollo: vive en tools/, NO se despliega ni la
// importa la app (no cambia en nada el comportamiento de la PWA). Solo lee.
//
// Algoritmo: ECDSA P-256 + SHA-256 (WebCrypto), el mismo que firma y verifica en
// gen-license.mjs y en la app, por eso es compatible bit a bit.
// Formato del codigo:  MYPI1.<datosB64url>.<firmaB64url>
//
// Uso:
//   node tools/read-license.mjs "MYPI1.xxxx.yyyy"        # un codigo
//   node tools/read-license.mjs --file codigos.txt        # uno por linea
//   cat codigos.txt | node tools/read-license.mjs         # por stdin
//   node tools/read-license.mjs --json "MYPI1..."         # payload crudo (JSON)
//
// Flags:
//   --file RUTA   archivo de texto con un codigo por linea (lee todos)
//   --key RUTA    clave publica (JWK) para verificar; por defecto usa
//                 tools/license-public-key.json y, si no existe, la clave de la
//                 app en src/lib/license.js
//   --json        imprime el/los payload(s) en JSON (para procesar con scripts)
//
// El contenido SIEMPRE se decodifica y se muestra (aunque la firma no coincida),
// para poder leer los datos de creacion pase lo que pase.
// ---------------------------------------------------------------------------
import { webcrypto as crypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
// Reutilizamos SOLO datos y funciones puras de la app (sin efectos secundarios):
// etiquetas de modulos, lista de modulos, calculo de dias y la clave publica de
// respaldo. La verificacion de firma la hacemos aqui con webcrypto (igual que
// gen-license.mjs) para poder elegir contra que clave publica se comprueba.
import {
  PUBLIC_KEY_JWK,
  LICENSE_MODULE_LABELS,
  licenseModules,
  daysUntil
} from '../src/lib/license.js'

const PREFIX = 'MYPI1'
const IMPORT_ALGO = { name: 'ECDSA', namedCurve: 'P-256' }
const VERIFY_ALGO = { name: 'ECDSA', hash: 'SHA-256' }
const LOCAL_PUB = new URL('./license-public-key.json', import.meta.url)
const BOOL_FLAGS = new Set(['json', 'help'])

const enc = new TextEncoder()
const dec = new TextDecoder()

// base64url -> bytes (Node entiende 'base64url' directamente).
function b64urlToBytes(s) {
  return new Uint8Array(Buffer.from(String(s), 'base64url'))
}

// Igual estilo que gen-license.mjs, pero separando banderas de posicionales (los
// codigos van sueltos). Las banderas booleanas no se comen el valor siguiente.
function parseArgs(argv) {
  const flags = {}
  const positionals = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      if (BOOL_FLAGS.has(key)) { flags[key] = true; continue }
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) { flags[key] = next; i++ }
      else flags[key] = true
    } else {
      positionals.push(a)
    }
  }
  return { flags, positionals }
}

// Elige la clave publica con la que verificar la firma, por prioridad:
//   1) --key RUTA        (la que indique el dueño)
//   2) tools/license-public-key.json   (el par con el que se EMITEN las licencias)
//   3) src/lib/license.js  (la clave publica que lleva la app, como respaldo)
async function resolvePublicKey(explicitPath) {
  if (explicitPath && explicitPath !== true) {
    const jwk = JSON.parse(await readFile(new URL(explicitPath, `file://${process.cwd()}/`), 'utf8'))
    return { jwk, source: String(explicitPath) }
  }
  if (existsSync(LOCAL_PUB)) {
    const jwk = JSON.parse(await readFile(LOCAL_PUB, 'utf8'))
    return { jwk, source: 'tools/license-public-key.json' }
  }
  return { jwk: PUBLIC_KEY_JWK, source: 'src/lib/license.js (clave de la app)' }
}

async function importVerifyKey(jwk) {
  // Forzamos key_ops de verificacion (algunas JWK vienen sin ese campo).
  const pub = { ...jwk, key_ops: ['verify'] }
  delete pub.d // por si acaso apuntan a un archivo con la clave privada
  return crypto.subtle.importKey('jwk', pub, IMPORT_ALGO, false, ['verify'])
}

// Estado de vigencia (independiente de la firma: es solo aritmetica de fechas).
function estadoTexto(expira) {
  if (expira == null) return 'activa · sin caducidad'
  const left = daysUntil(expira)
  if (left < 0) return `vencida hace ${-left} día(s)`
  if (left === 0) return 'vence hoy'
  if (left <= 7) return `por vencer · ${left} día(s)`
  return `activa · ${left} día(s)`
}

function modulosTexto(payload) {
  const mods = licenseModules(payload)
  if (!mods.length) return 'clásica (sin módulos)'
  return mods.map((m) => LICENSE_MODULE_LABELS[m] || m).join(', ')
}

// Lee y muestra un codigo. Devuelve el objeto (para el modo --json).
async function leerUno(token, key, keySource, { json }) {
  const raw = String(token || '').trim()
  const parts = raw.split('.')
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    if (json) return { error: 'formato', token: raw }
    console.log(`\n⚠️  Formato inválido (no es un código MYPI1 de 3 partes):\n   ${raw}`)
    return null
  }
  const [, payloadB64, sigB64] = parts

  let payload
  try {
    payload = JSON.parse(dec.decode(b64urlToBytes(payloadB64)))
  } catch {
    if (json) return { error: 'contenido', token: raw }
    console.log('\n⚠️  No se pudo decodificar el contenido de la licencia (datos corruptos).')
    return null
  }

  // Verificacion de firma (no evita mostrar los datos si falla).
  let firmaOk = false
  try {
    const signed = enc.encode(PREFIX + '.' + payloadB64)
    firmaOk = await crypto.subtle.verify(VERIFY_ALGO, key, b64urlToBytes(sigB64), signed)
  } catch {
    firmaOk = false
  }

  if (json) return { ...payload, firmaValida: firmaOk, firmaClave: keySource }

  const firma = firmaOk
    ? `✅ auténtica  (clave: ${keySource})`
    : `❌ NO coincide  (clave: ${keySource})`
  console.log('\n─────────────────────────────────────────────')
  console.log(firmaOk ? '✅ Licencia leída' : '❌ Licencia leída (firma NO válida)')
  console.log('')
  console.log('   Negocio    :', payload.negocio ?? '—')
  console.log('   Plan       :', payload.plan ?? '—')
  console.log('   Emitida    :', payload.emitida ?? '—')
  console.log('   Expira     :', payload.expira || 'sin caducidad')
  console.log('   Estado     :', estadoTexto(payload.expira ?? null))
  if (payload.maxDispositivos) console.log('   Dispositiv.:', payload.maxDispositivos)
  console.log('   Módulos    :', modulosTexto(payload))
  console.log('   licenseId  :', payload.licenseId ?? '—')
  console.log('   Firma      :', firma)
  return { ...payload, firmaValida: firmaOk }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => (data += c))
    process.stdin.on('end', () => resolve(data))
  })
}

function ayuda() {
  console.log(`Lector de licencias MypiCuadre (local).

  node tools/read-license.mjs "MYPI1.xxxx.yyyy"   leer un código
  node tools/read-license.mjs --file codigos.txt  un código por línea
  cat codigos.txt | node tools/read-license.mjs   por stdin
  node tools/read-license.mjs --json "MYPI1..."   payload en JSON

Flags: --file RUTA · --key RUTA (clave pública JWK) · --json · --help`)
}

async function main() {
  const { flags, positionals } = parseArgs(process.argv.slice(2))
  if (flags.help) { ayuda(); return }

  // Reune los codigos: --file, luego posicionales, y si no hay nada, stdin.
  const tokens = []
  if (typeof flags.file === 'string') {
    const txt = await readFile(new URL(flags.file, `file://${process.cwd()}/`), 'utf8')
    tokens.push(...txt.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))
  }
  tokens.push(...positionals)
  if (!tokens.length && !process.stdin.isTTY) {
    const txt = await readStdin()
    tokens.push(...txt.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))
  }
  if (!tokens.length) { ayuda(); return }

  const { jwk, source } = await resolvePublicKey(flags.key)
  const key = await importVerifyKey(jwk)

  const out = []
  for (const t of tokens) {
    const r = await leerUno(t, key, source, { json: !!flags.json })
    if (r) out.push(r)
  }
  if (flags.json) console.log(JSON.stringify(out.length === 1 ? out[0] : out, null, 2))
  else console.log('')
}

main().catch((e) => {
  console.error('Error:', e?.message || e)
  process.exit(1)
})
