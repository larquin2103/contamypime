// ---------------------------------------------------------------------------
// Bateria de validacion de la auditoria del negocio "La Patrona" (ferreteria),
// respaldo del 22-09-2026 exportado por Lisett (dueña) a las 22:39:15Z.
//
// NO ENTRA EN EL BUILD. Es una herramienta de auditoria, no codigo de la app:
// no importa nada de `src/` en tiempo de ejecucion (lo LEE como texto), no
// escribe en ningun sitio y no toca la base de datos.
//
// Una sola asercion (la 33) invoca `git show` para leer el approve ANTERIOR a F3:
// la hipotesis que descarta habla de un build viejo, y ese codigo solo existe en la
// historia. Si git no esta disponible, esa asercion FALLA -no pasa en silencio-, que
// es el lado seguro. Las otras 43 solo necesitan el respaldo y `src/`.
//
// Uso:
//   node docs/auditoria/bateria-la-patrona-22-09-2026.mjs <respaldo.json> [raizSrc]
//
// El respaldo es un fichero del negocio y NO esta en el repositorio.
//   SHA256 = 683072985d0176507b8604b43f30cca167f5c428a293ee9f6c46c9986526abf5
// Comprobarlo antes de fiarse del resultado.
//
// Salida: una linea por asercion; codigo de salida 0 si todas pasan.
// ---------------------------------------------------------------------------

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const [fichero, raiz = 'src'] = process.argv.slice(2)
if (!fichero) {
  console.error('Uso: node bateria-la-patrona-22-09-2026.mjs <respaldo.json> [raizSrc]')
  process.exit(2)
}

const SRC = path.resolve(raiz) + path.sep
const src = (f) => fs.readFileSync(SRC + f.split('/').join(path.sep), 'utf8')
function todoSrc() {
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(js|jsx)$/.test(e.name)) out.push(fs.readFileSync(p, 'utf8'))
    }
  }
  walk(SRC)
  return out.join('\n')
}

const bk = JSON.parse(fs.readFileSync(fichero, 'utf8'))
const t = bk.tables
const W = '__almacen'
const TURNO = '2a732ab9-6fa3-4733-b3a0-6a88dab75a10' // turno de Claudia del 22-09
const CONTEO = 'c4998016'                            // conteo del 22-09
const GOMA = 'bee31b1c-e18c-4e72-ab06-3ef69498714a'  // "Goma de unas" (el alta del 16-09)

let n = 0
let ok = 0
const mal = []
function A(etiqueta, cond, detalle) {
  n++
  if (cond) ok++
  else mal.push(n)
  console.log((cond ? '  OK  ' : '  XX  ') + String(n).padStart(2) + '. ' + etiqueta +
    (detalle ? '  --  ' + detalle : ''))
}

const cq = (x) => {
  const v = Number(x)
  if (!Number.isFinite(v)) return 0
  const r = Math.round(v * 100) / 100
  return Object.is(r, -0) ? 0 : r
}
const byPid = new Map()
for (const m of t.stockMovements) {
  if (!byPid.has(m.productId)) byPid.set(m.productId, [])
  byPid.get(m.productId).push(m)
}
// Saldo DERIVADO del libro mayor (nunca de la cache), agrupando como recomputeStock.
const led = (pid, loc, hasta) => cq((byPid.get(pid) || [])
  .filter((m) => (m.location || W) === loc && (!hasta || m.createdAt < hasta))
  .reduce((a, m) => a + Number(m.qty || 0), 0))

const conMov = new Set(t.stockMovements.filter((m) => m.refType === 'sale').map((m) => m.refId))
const sinMov = t.sales
  .filter((s) => !s.voided && (s.items || []).length && !conMov.has(s.id))
  .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
const amPorVenta = new Map()
for (const a of t.accountMovements) {
  if (!amPorVenta.has(a.refId)) amPorVenta.set(a.refId, [])
  amPorVenta.get(a.refId).push(a)
}

console.log('\nRespaldo: ' + bk.meta.exportedAt + '  esquema ' + bk.meta.schema + '  de ' + bk.meta.fromUserName)

console.log('\n====== H3 - el transporte parte transacciones atomicas (MISMA causa que Burger Premium) ======\n')

const salesRepo = src('repositories/salesRepo.js')
A('CODIGO: salesRepo.create escribe venta y movimiento en UNA transaccion',
  salesRepo.includes("db.transaction('rw', db.sales, db.stockMovements, db.products"),
  'la venta y su movimiento nacen juntos o no nacen')

// La ventana del regex es 1200 y no 900 porque entre el guard y la escritura hay
// 918 caracteres de comentario (medido, no estimado): con 900 esta asercion fallaba
// por el umbral, no por el hecho.
A('CODIGO: la unica rama que omite el movimiento es skipStock (venta de mesa)',
  /if \(!skipStock\) \{[\s\S]{0,1200}?db\.stockMovements\.add\(/.test(salesRepo) &&
  (salesRepo.match(/db\.stockMovements\.add\(/g) || []).length === 1,
  'una sola escritura al libro en todo el repo, y va dentro de if (!skipStock)')

A('CODIGO: nadie borra de stockMovements ni de sales en todo src/',
  !/\b(stockMovements|sales)\.(delete|clear|bulkDelete)\b/.test(todoSrc()),
  'sin esto, "falta una fila" admitiria otra explicacion')

const backupSrc = src('features/backup/backupService.js')
A('CODIGO: el respaldo vuelca table.toArray() sin limite ni paginacion',
  /for \(const table of db\.tables\)[\s\S]{0,400}?await table\.toArray\(\)/.test(backupSrc),
  'ausente en el JSON = ausente en el dispositivo (descarta el falso positivo del export)')

const handoff = src('features/handoff/handoffService.js')
A('CODIGO: el traspaso de turno (v2) lleva sales Y stockMovements juntas',
  handoff.includes('const sales = await db.sales.toArray()') &&
  handoff.includes('const stockMovements = await db.stockMovements.toArray()'),
  'un JSON de turno no puede traer una sin la otra: no explica el caso')

A('DATO: 8 ventas no anuladas no tienen NINGUN movimiento de stock',
  sinMov.length === 8,
  sinMov.length + ' de ' + t.sales.filter((s) => !s.voided).length + ' ventas | ' +
  sinMov[0].createdAt.slice(11, 19) + ' a ' + sinMov[sinMov.length - 1].createdAt.slice(11, 19))

A('DATO: no son ventas de mesa (skipStock queda descartado)',
  t.orders.length === 0 && t.orderItems.length === 0 && sinMov.every((s) => s.orderId === null),
  'orders=' + t.orders.length + ' orderItems=' + t.orderItems.length + ' | las 8 con orderId null')

const campos = (s) => Object.keys(s).sort().join(',')
const normales = t.sales.filter((s) => !s.voided && (s.items || []).length && conMov.has(s.id))
const formaNormal = new Set(normales.map(campos))
A('DATO: las 8 tienen la MISMA forma de campos que las normales (mismo build)',
  sinMov.every((s) => formaNormal.has(campos(s))) &&
  sinMov.every((s) => (s.items || []).every((i) => Object.keys(i).length === 8)),
  'no son de un formato viejo ni de una importacion')

A('DATO: las 8 SI tienen su movimiento de tesoreria -> la rotura es POR COLECCION',
  sinMov.every((s) => (amPorVenta.get(s.id) || []).length >= 1),
  'de la MISMA transaccion llegaron sales y accountMovements; falta solo stockMovements')

const delTurno = t.sales.filter((s) => s.shiftId === TURNO)
  .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
const idx = delTurno.map((s) => conMov.has(s.id))
const primerNo = idx.indexOf(false)
const ultimoNo = idx.lastIndexOf(false)
A('DATO: forman un BLOQUE CONTIGUO, con ventas normales antes y despues',
  primerNo > 0 && ultimoNo < idx.length - 1 &&
  idx.slice(primerNo, ultimoNo + 1).every((v) => v === false) &&
  (ultimoNo - primerNo + 1) === 8,
  'ventas ' + (primerNo + 1) + ' a ' + (ultimoNo + 1) + ' de ' + idx.length + ' del turno')

const idsVentas = new Set(t.sales.map((s) => s.id))
A('DATO: 0 movimientos de venta sin su venta (la perdida va en UN solo sentido)',
  t.stockMovements.filter((m) => m.refType === 'sale' && !idsVentas.has(m.refId)).length === 0)

const colas = t.syncState.filter((s) => s.key.startsWith('retry:'))
A('DATO: las colas de reintento estan VACIAS (el motor cree que no hay pendientes)',
  colas.length > 0 && colas.every((s) => Array.isArray(s.value) && s.value.length === 0),
  colas.length + ' colas, todas en []')

const cursor = (col) => String((t.syncState.find((s) => s.key === 'push:' + col) || {}).value || '')
const maxTs = (rows, campo) => rows.reduce((a, r) => {
  const v = String(r[campo] || r.createdAt || '')
  return v > a ? v : a
}, '')
A('DATO: los cursores de subida coinciden con el maximo local: nada pendiente a sus ojos',
  cursor('stockMovements') === maxTs(t.stockMovements, 'createdAt') &&
  cursor('sales') === maxTs(t.sales, 'createdAt'),
  'push:stockMovements=' + cursor('stockMovements') + ' | push:sales=' + cursor('sales'))

const push = src('features/sync/pushEngine.js')
A('CODIGO: el cursor se adelanta sin esperar la confirmacion del servidor',
  /batch\s*\n?\s*\.commit\(\)\s*\n\s*\.then\(/.test(push) &&
  push.includes('await setCursorForward(col.name, maxTs)') &&
  !/await batch\.commit\(\)/.test(push),
  'commit() se lanza sin await y despues se mueve el cursor')

console.log('\n====== H4 - el ajuste del conteo es un DELTA, y aqui deja el saldo mal ======\n')

const countsRepo = src('repositories/countsRepo.js')
A('CODIGO: approve calcula delta = fisico menos libro, no un objetivo absoluto',
  countsRepo.includes('const sysNow = await stockFromLedger(it.productId, loc)') &&
  countsRepo.includes('const delta = round2(Number(it.physicalQty) - sysNow)'))

const cnt = t.counts.find((c) => c.id.startsWith(CONTEO))
const itGoma = cnt.items.find((i) => i.productId === GOMA)
const ajGoma = (byPid.get(GOMA) || []).find((m) => m.type === 'adjustment' && m.createdAt > '2026-09-22T20:00')
const antesGoma = led(GOMA, W, ajGoma.createdAt)
A('DATO: el conteo registro systemStock=18 y fisico=15, y ajusto -3',
  itGoma.systemStock === 18 && itGoma.physicalQty === 15 && ajGoma.qty === -3)

A('DATO: pero el libro de ESTE dispositivo daba 19, asi que el ajuste lo deja en 16',
  antesGoma === 19 && cq(antesGoma + ajGoma.qty) === 16 && led(GOMA, W) === 16,
  'contado 15, saldo final 16: sobra 1')

const falta = new Map()
for (const s of sinMov) {
  for (const i of s.items) falta.set(i.productId, (falta.get(i.productId) || 0) + Number(i.qty || 0))
}
A('DATO: la unidad que sobra es EXACTAMENTE la venta de 1 que no trajo su movimiento',
  falta.get(GOMA) === 1)

const afectados = [...falta.keys()].map((pid) => ({ pid, it: cnt.items.find((i) => i.productId === pid) }))
const inadvertidos = afectados.filter((x) => x.it && x.it.counted && Number(x.it.diff) === 0)
A('DATO: en 5 productos afectados el conteo dio diff=0: el error paso INADVERTIDO',
  inadvertidos.length === 5,
  'el conteo se calculo contra un libro que SI tenia esas ventas; aqui no estan')

const descuadre = afectados.filter((x) => x.it && x.it.counted && led(x.pid, W) !== Number(x.it.physicalQty))
A('DATO: 6 productos quedan por encima de lo que se conto fisicamente',
  descuadre.length === 6,
  'unidades de mas: ' + descuadre.reduce((a, x) => a + cq(led(x.pid, W) - Number(x.it.physicalQty)), 0))

A('CONTROL NEGATIVO: reinyectando las unidades ausentes, los 6 cuadran con lo contado',
  descuadre.every((x) => cq(led(x.pid, W) - falta.get(x.pid)) === Number(x.it.physicalQty)),
  'la unica causa del descuadre son esas 8 unidades')

console.log('\n====== NUEVO - dos conteos APROBADOS figuran hoy como RECHAZADOS ======\n')

const ajConteo = t.stockMovements
  .filter((m) => m.type === 'adjustment' && /Ajuste por conteo/.test(m.note || ''))
  .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
const tandas = []
for (const m of ajConteo) {
  const last = tandas[tandas.length - 1]
  if (last && Math.abs(new Date(m.createdAt) - new Date(last[0].createdAt)) < 10000) last.push(m)
  else tandas.push([m])
}
const huerfanas = tandas.filter((ta) =>
  !t.counts.some((c) => c.approvedAt && Math.abs(new Date(c.approvedAt) - new Date(ta[0].createdAt)) < 60000))
A('DATO: hay 2 tandas de ajustes que ningun conteo aprobado reclama',
  huerfanas.length === 2,
  huerfanas.map((ta) => ta[0].createdAt.slice(0, 16) + ' (' + ta.length + ' ajustes)').join(' | '))

let casan = 0
let totalAj = 0
for (const ta of huerfanas) {
  const c = t.counts.filter((x) => x.submittedAt && x.submittedAt < ta[0].createdAt)
    .sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)))[0]
  for (const m of ta) {
    totalAj++
    const it = (c.items || []).find((i) => i.productId === m.productId && Number(i.diff) === Number(m.qty))
    if (it && c.status === 'rejected') casan++
  }
}
A('DATO: los 8 ajustes casan producto Y cantidad con dos conteos hoy RECHAZADOS',
  casan === 8 && totalAj === 8,
  'el stock se ajusto de verdad; la cabecera dice "Mala actualizacion"')

A('CODIGO: approve exige estado PENDING, pero reject NO comprueba el estado',
  /async approve\(id, ownerId\) \{[\s\S]{0,260}?if \(!c \|\| c\.status !== COUNT_STATUS\.PENDING\) return/.test(countsRepo) &&
  !/async reject\([\s\S]{0,400}?c\.status !== COUNT_STATUS/.test(countsRepo),
  'un conteo ya aprobado se puede rechazar: el historial queda mintiendo')

const rechazados = t.counts.filter((c) => c.status === 'rejected')
A('DATO: los tres rechazos se firmaron el mismo minuto, semanas despues del envio',
  rechazados.length === 3 &&
  rechazados.every((c) => String(c.approvedAt).startsWith('2026-09-01T19:5')) &&
  rechazados.every((c) => new Date(c.approvedAt) - new Date(c.submittedAt) > 14 * 864e5),
  'enviados 07-08, 12-08 y 17-08; resueltos el 01-09')

console.log('\n====== CAUSAS DESCARTADAS (no estan en este negocio) ======\n')

A('F1 (el respaldo v5 de stockAtLocation) NO aplica: un solo producto sin mapa, inactivo y en 0',
  t.products.filter((p) => !p.stockByLocation).length === 1 &&
  t.products.filter((p) => !p.stockByLocation).every((p) => !p.active && cq(p.stock) === 0 &&
    (byPid.get(p.id) || []).length === 0),
  'la causa raiz de "De todo un tin" no esta aqui')

let divergentes = 0
for (const p of t.products) {
  const locs = new Set([...Object.keys(p.stockByLocation || {}),
    ...((byPid.get(p.id) || []).map((m) => m.location || W))])
  for (const l of locs) if (cq((p.stockByLocation || {})[l] || 0) !== led(p.id, l)) divergentes++
}
A('La CACHE no miente: 0 divergencias contra el libro mayor en 200 productos',
  divergentes === 0,
  'el problema no es la cache: es que al libro le faltan filas')

A('CONTROL NEGATIVO: el detector de divergencias SI encuentra una si se inyecta',
  (() => {
    const p = t.products.find((x) => (byPid.get(x.id) || []).length)
    return cq((p.stockByLocation || {})[W] || 0) + 1 !== led(p.id, W)
  })(),
  'sin esto, "0 divergencias" podria ser un detector roto')

A('H1 y H2 (mesas) NO aplican: el negocio no tiene el modulo',
  t.orders.length === 0 && t.orderItems.length === 0)

A('Solo 1 negativo en el catalogo, y es un producto dado de baja',
  (() => {
    const neg = t.products.filter((p) => Object.values(p.stockByLocation || {}).some((v) => cq(v) < 0))
    return neg.length === 1 && !!neg[0].deletedAt
  })())

console.log('\n====== RIESGO DE FONDO: el catalogo esta duplicado ======\n')

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim()
const grupos = new Map()
for (const p of t.products) {
  const k = norm(p.name)
  if (!grupos.has(k)) grupos.set(k, [])
  grupos.get(k).push(p)
}
const dup = [...grupos.values()].filter((a) => a.length > 1)
const dupVivos = dup.filter((a) => a.filter((p) => p.active && !p.deletedAt).length > 1)
A('DATO: 25 nombres repetidos en el catalogo, 6 de ellos con dos fichas ACTIVAS a la vez',
  dup.length === 25 && dupVivos.length === 6,
  dupVivos.map((a) => a[0].name).join(' | '))


console.log('\n====== CIERRE DEL DIAGNOSTICO - desde QUE libro se escribio el ajuste ======\n')

// El acta original dejaba abiertas DOS hipotesis que "explicaban los datos igual de
// bien": (a) el build es anterior a F3 y approve calculo el delta contra la FOTO del
// conteo, o (b) el build tiene F3 y approve corrio en el OTRO dispositivo. Las
// aserciones siguientes descartan (a) por CODIGO y miden (b) por DATO.

const countsRepoSrc = src('repositories/countsRepo.js')
A('CODIGO: el approve de HOY deriva el delta del LIBRO MAYOR, no de la foto del conteo',
  /const sysNow = await stockFromLedger\(it\.productId, loc\)[\s\S]{0,200}?const delta = round2\(Number\(it\.physicalQty\) - sysNow\)/.test(countsRepoSrc),
  'post-F3: el delta sale del libro del dispositivo que aprueba')

// Esta se apoya en git a proposito: la hipotesis (a) habla de un build ANTERIOR, y
// el unico sitio donde ese codigo existe es la historia. Si git no esta disponible
// la asercion FALLA (no pasa en silencio), que es el lado seguro.
let preF3 = ''
try {
  // `743e66d~1` y no `743e66d^`: en Windows execSync lanza por cmd.exe, donde `^` es
  // el caracter de escape y `743e66d^` acaba resolviendo al PROPIO commit. La asercion
  // estaba mirando el fichero equivocado, y se vio porque FALLO, no por leerla.
  preF3 = execSync('git show 743e66d~1:src/repositories/countsRepo.js', { encoding: 'utf8' })
} catch { preF3 = '' }
A('CODIGO: el approve PRE-F3 TAMPOCO usaba la foto: leia la cache EN VIVO',
  preF3.includes('const delta = round2(Number(it.physicalQty) - stockAtLocation(p, loc))') &&
  !/const delta = round2\(Number\(it\.physicalQty\) - Number\(it\.systemStock\)/.test(preF3),
  'ningun build de la app calculo nunca el delta contra it.systemStock: la hipotesis (a) es falsa')

const APR = '2026-09-22T20:43:28.977Z'          // instante del primer ajuste de ese conteo
const conteo = t.counts.find((c) => c.id.startsWith(CONTEO))
const contados = conteo.items.filter((i) => i.counted)
const faltaPorProd = new Map()
for (const s of sinMov) {
  for (const it of s.items || []) faltaPorProd.set(it.productId, (faltaPorProd.get(it.productId) || 0) + Number(it.qty))
}
const ajuste22 = (pid) => cq((byPid.get(pid) || [])
  .filter((m) => String(m.note || '').startsWith('Ajuste por conteo') && m.createdAt >= '2026-09-22')
  .reduce((a, m) => a + Number(m.qty || 0), 0))

const goma = contados.find((i) => i.productId === GOMA)
A('DATO: en Goma de unas ESTE dispositivo habria escrito -4, y lo escrito fue -3',
  led(GOMA, W, APR) === 19 && cq(goma.physicalQty) === 15 && ajuste22(GOMA) === -3 &&
  cq(goma.physicalQty) - led(GOMA, W, APR) === -4,
  'libro AQUI=19 fisico=15 -> -4 | foto del conteo=18 -> -3 | escrito=-3')

const otros = contados.filter((i) => cq(i.diff) !== 0 && i.productId !== GOMA)
A('CONTROL: el OTRO producto ajustado del mismo conteo SI cuadra con este libro',
  otros.length === 1 && cq(otros[0].physicalQty) - led(otros[0].productId, W, APR) === ajuste22(otros[0].productId),
  otros[0].name + ': libro AQUI=' + led(otros[0].productId, W, APR) + ' fisico=' + otros[0].physicalQty +
  ' -> ' + ajuste22(otros[0].productId) + ' (no le falta ninguna venta)')

const casanCon = contados.filter((i) => led(i.productId, W, APR) - (faltaPorProd.get(i.productId) || 0) === cq(i.systemStock)).length
A('DATO: los 127 items contados casan EXACTAMENTE con libro_AQUI menos las unidades ausentes',
  casanCon === contados.length && contados.length === 127,
  'el libro del dispositivo que ENVIO el conteo = este libro + los movimientos que faltan, sin ninguna otra divergencia')

const casanSin = contados.filter((i) => led(i.productId, W, APR) === cq(i.systemStock)).length
A('CONTROL NEGATIVO: sin restar las unidades ausentes solo casan 121 de 127',
  casanSin === 121,
  'sin esto, "casan 127/127" podria ser una comparacion que siempre da true')

// Quedaba UNA salida viva para la hipotesis (a): que la CACHE de este aparato
// valiera 18 aunque su libro diera 19 (el approve pre-F3 lee la cache, no el libro).
// La cierra la aritmetica, no el razonamiento: `stockRepo.record` INCREMENTA la
// cache dentro de la misma transaccion, no la recalcula. Si el ajuste se hubiera
// escrito AQUI, la cache de hoy seria cache_previa - 3; como hoy vale 16, la previa
// era 19, y con 19 los dos builds escriben -4. O sea: el ajuste no se escribio aqui.
const stockRepoSrc = src('repositories/stockRepo.js')
A('CODIGO: stockRepo.record INCREMENTA la cache (no la recalcula desde el libro)',
  stockRepoSrc.includes('byLoc[loc] = cleanQty(Number(byLoc[loc] || 0) + delta)') &&
  stockRepoSrc.includes('stock: cleanQty(Number(p.stock || 0) + delta)'),
  'por eso la cache de hoy permite deducir cuanto valia antes del ajuste')

const prodGoma = t.products.find((p) => p.id === GOMA)
const ultimoMovGoma = (byPid.get(GOMA) || []).map((m) => m.createdAt).sort().pop()
A('DATO: cierra la salida de "cache desfasada": la cache previa AQUI era 19, no 18',
  cq(prodGoma.stockByLocation[W]) === 16 && led(GOMA, W) === 16 && ultimoMovGoma === APR &&
  cq(prodGoma.stockByLocation[W]) + 3 === 19,
  'cache hoy=16 y el ajuste es el ultimo movimiento -> previa=19 -> los dos builds habrian escrito -4 aqui')

console.log('\n====== §6 y §7 - la raiz es UNA: el estado se valida contra la copia LOCAL ======\n')

A('CODIGO: getPending filtra por status, asi que CountReview solo se monta con un PENDING local',
  /getPending[\s\S]{0,200}?db\.counts\.where\('status'\)\.equals\(COUNT_STATUS\.PENDING\)/.test(countsRepoSrc) &&
  /if \(pending\) \{[\s\S]{0,200}?<CountReview count=\{pending\}/.test(src('features/inventory/CountScreen.jsx')),
  'el defecto de reject NO es "rechazar un aprobado en el mismo aparato": es que la copia local va desfasada')

A('CODIGO: approve comprueba el estado LOCAL, asi que tampoco frena la doble aprobacion',
  countsRepoSrc.includes('if (!c || c.status !== COUNT_STATUS.PENDING) return') &&
  !/counts[\s\S]{0,400}?transaction\(/.test(countsRepoSrc),
  'misma raiz que §6: local + LWW por updatedAt, sin transaccion ni candado compartido')

console.log('\n====== §9 - la mercancia en un area que ningun conteo mira ======\n')

const fer = t.stockMovements.filter((m) => m.location && m.location !== W)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
A('DATO: solo hay 3 movimientos fuera del almacen, y los 18 conteos son del almacen',
  fer.length === 3 && t.counts.every((c) => (c.location || W) === W),
  'Ferreteria existe como area pero no se cuenta nunca')

const flot = fer.find((m) => m.type === 'purchase_in' && m.createdAt.startsWith('2026-08-25'))
const ventaFlot = (byPid.get(flot.productId) || []).find((m) => m.type === 'sale_out')
A('DATO: la entrada al area y la venta del almacen son del MISMO vendedor, con 11,4 s de diferencia',
  flot.userId === ventaFlot.userId &&
  Math.abs((new Date(ventaFlot.createdAt) - new Date(flot.createdAt)) / 1000 - 11.43) < 0.01,
  'el acta decia 27 s: son 11,43 s (' + flot.createdAt.slice(11, 19) + ' -> ' + ventaFlot.createdAt.slice(11, 19) + ')')

const residuo = [...new Set(fer.map((m) => m.productId))].map((pid) => [pid, led(pid, 'Ferretería')])
A('DATO: de los 3 movimientos solo UNO deja residuo; el par de HERRAJE PALANCA se netea a cero',
  residuo.filter(([, q]) => q !== 0).length === 1 &&
  residuo.filter(([, q]) => q === 0).length === 1,
  residuo.map(([pid, q]) => (t.products.find((p) => p.id === pid) || {}).name + '=' + q).join(' | '))

console.log('\n====== ' + ok + '/' + n + ' aserciones OK' +
  (mal.length ? ' - FALLAN: ' + mal.join(', ') : '') + ' ======\n')
process.exit(mal.length ? 1 : 0)
