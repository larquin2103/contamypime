#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Generador PRIVADO de licencias de activacion de MypiCuadre.
//
// IMPORTANTE: este script y, sobre todo, la CLAVE PRIVADA viven SOLO en tu PC.
// Nunca se suben al repo ni se despliegan. La app solo lleva la clave PUBLICA
// (que no es secreta) para verificar las licencias sin conexion.
//
// Algoritmo: ECDSA P-256 + SHA-256 (WebCrypto). El mismo en Node y en el
// navegador, por eso firma y verificacion son compatibles bit a bit.
//
// Uso:
//   1) Una sola vez, genera tu par de claves:
//        node tools/gen-license.mjs keygen
//      -> escribe tools/license-private-key.json (NO subir) y muestra la clave
//         publica para pegar en src/lib/license.js
//
//   2) Emite licencias:
//        node tools/gen-license.mjs --negocio "Bodega Luis" --dias 30 --plan mensual
//        node tools/gen-license.mjs --negocio "Tienda Ana" --plan perpetua
//
// Flags de emision:
//   --negocio   nombre del punto de venta (obligatorio)
//   --dias N    vigencia en dias desde hoy (omitir para licencia sin caducidad)
//   --plan      demo | mensual | anual | perpetua  (por defecto: mensual)
//   --maxdisp N limite opcional de dispositivos
//   --modulos   modulos premium separados por coma (ej: mayorista,cuentas);
//               omitir para una licencia clasica sin modulos
//   --key RUTA  ruta de la clave privada (por defecto tools/license-private-key.json)
// ---------------------------------------------------------------------------
import { webcrypto as crypto } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const PREFIX = 'MYPI1'
const ALGO = { name: 'ECDSA', namedCurve: 'P-256' }
const SIGN_ALGO = { name: 'ECDSA', hash: 'SHA-256' }
const KEY_FILE = new URL('./license-private-key.json', import.meta.url)
const PUB_FILE = new URL('./license-public-key.json', import.meta.url)

const enc = new TextEncoder()

function bytesToB64url(bytes) {
  return Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function todayPlus(days) {
  const d = new Date()
  d.setDate(d.getDate() + Number(days))
  return d.toISOString().slice(0, 10) // YYYY-MM-DD
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) { out[key] = next; i++ }
      else out[key] = true
    }
  }
  return out
}

async function keygen() {
  const pair = await crypto.subtle.generateKey(ALGO, true, ['sign', 'verify'])
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey)
  await writeFile(KEY_FILE, JSON.stringify(priv, null, 2))
  await writeFile(PUB_FILE, JSON.stringify(pub, null, 2))
  // Solo la parte publica de la JWK (sin el campo privado `d`).
  const { d, ...pubOnly } = pub
  console.log('\n✅ Par de claves generado.')
  console.log('   Privada -> tools/license-private-key.json  (NO la subas al repo)')
  console.log('   Publica -> tools/license-public-key.json')
  console.log('\nPega esta clave publica en src/lib/license.js (PUBLIC_KEY_JWK):\n')
  console.log(JSON.stringify(pubOnly))
  console.log('')
}

async function loadPrivateKey(path) {
  const url = path ? new URL(path, `file://${process.cwd()}/`) : KEY_FILE
  if (!existsSync(url)) {
    console.error('No encuentro la clave privada. Ejecuta primero: node tools/gen-license.mjs keygen')
    process.exit(1)
  }
  const jwk = JSON.parse(await readFile(url, 'utf8'))
  return crypto.subtle.importKey('jwk', jwk, ALGO, false, ['sign'])
}

async function mint(args) {
  if (!args.negocio || args.negocio === true) {
    console.error('Falta --negocio "Nombre del punto de venta"')
    process.exit(1)
  }
  const key = await loadPrivateKey(typeof args.key === 'string' ? args.key : null)
  const plan = typeof args.plan === 'string' ? args.plan : 'mensual'
  const expira = args.dias ? todayPlus(args.dias) : (plan === 'perpetua' ? null : todayPlus(30))
  const payload = {
    licenseId: crypto.randomUUID(),
    negocio: String(args.negocio),
    plan,
    emitida: new Date().toISOString().slice(0, 10),
    expira,
    ...(args.maxdisp ? { maxDispositivos: Number(args.maxdisp) } : {}),
    ...(typeof args.modulos === 'string' && args.modulos.trim()
      ? { modulos: args.modulos.split(',').map((m) => m.trim()).filter(Boolean) }
      : {})
  }
  const payloadB64 = bytesToB64url(enc.encode(JSON.stringify(payload)))
  const signed = enc.encode(PREFIX + '.' + payloadB64)
  const sig = new Uint8Array(await crypto.subtle.sign(SIGN_ALGO, key, signed))
  const token = `${PREFIX}.${payloadB64}.${bytesToB64url(sig)}`

  console.log('\n✅ Licencia emitida\n')
  console.log('   Negocio :', payload.negocio)
  console.log('   Plan    :', payload.plan)
  console.log('   Emitida :', payload.emitida)
  console.log('   Expira  :', payload.expira || 'sin caducidad')
  if (payload.maxDispositivos) console.log('   Disp.   :', payload.maxDispositivos)
  if (payload.modulos) console.log('   Modulos :', payload.modulos.join(', '))
  console.log('\n--- Codigo de licencia (copialo al cliente) ---\n')
  console.log(token)
  console.log('')
}

const argv = process.argv.slice(2)
if (argv[0] === 'keygen') {
  keygen()
} else {
  mint(parseArgs(argv))
}
