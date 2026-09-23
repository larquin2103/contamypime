// Pruebas PURAS de la politica del registro de la sincronizacion (La Patrona §14.5).
// Sin framework: ejecutar con  `node src/lib/syncLogPolicy.test.mjs`.
//
// QUE CAZA: (1) que los avisos de la sync, que se repiten cada 20/45 s, inunden el
// registro; (2) que se coman el presupuesto de los errores de pantalla (va aparte);
// (3) que un detalle cambiante (ids, fechas) rompa la deduplicacion; (4) que un
// mensaje se pase del tope de 500 del registro.
import { createSyncGate, syncKey, codeOf, syncMessage } from './syncLogPolicy.js'

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return }
  fail++
  console.error(`FAIL ${label}\n  esperado: ${expected}\n  obtenido: ${actual}`)
}

// Clave: etapa + coleccion + codigo. Nunca el detalle.
eq(syncKey('subida-lote-rechazado', 'products', 'unavailable'), 'subida-lote-rechazado|products|unavailable', 'clave completa')
eq(syncKey('bajada-periodica', null, ''), 'bajada-periodica|-|-', 'clave sin coleccion ni codigo')

// Codigo: el de Firestore si lo hay; si no, un prefijo ESTABLE del mensaje.
eq(codeOf({ code: 'resource-exhausted', message: 'Quota exceeded.' }), 'resource-exhausted', 'codigo de Firestore')
eq(codeOf(new Error('Failed to get documents from server')), 'Failed to get documents from server', 'sin code: el mensaje')
eq(codeOf(new Error('x'.repeat(200))).length, 60, 'sin code: prefijo acotado a 60')
eq(codeOf('texto suelto'), 'texto suelto', 'un string tambien vale')
eq(codeOf(null), 'desconocido', 'nada -> desconocido')

// Puerta: una vez por clave y sesion, con presupuesto propio.
{
  const g = createSyncGate({ budget: 3 })
  eq(g.shouldLog('a'), true, 'primera vez: se registra')
  eq(g.shouldLog('a'), false, 'repetida: no (el ciclo de 45 s no inunda)')
  eq(g.shouldLog('b'), true, 'otra clave: si')
  eq(g.shouldLog('c'), true, 'tercera clave: si')
  eq(g.shouldLog('d'), false, 'presupuesto agotado: no')
  eq(g.left(), 0, 'presupuesto a cero')
}
{
  const g1 = createSyncGate({ budget: 1 })
  const g2 = createSyncGate({ budget: 1 })
  g1.shouldLog('a')
  eq(g2.shouldLog('a'), true, 'dos puertas no comparten estado (la de la app va aparte)')
}
eq(createSyncGate().left(), 30, 'presupuesto por defecto: 30 por sesion (decision del duenio)')
// Revision (menor 5): una etapa con mensajes cambiantes no se come las 30.
{
  const g = createSyncGate({ budget: 30, perStage: 5 })
  let n = 0
  for (let i = 0; i < 20; i++) if (g.shouldLog(syncKey('bajada-periodica', null, `msg-${i}`))) n++
  eq(n, 5, 'tope por etapa: 5')
  eq(g.shouldLog(syncKey('subida-periodica', null, 'x')), true, 'otra etapa sigue teniendo hueco')
  eq(g.left(), 24, 'el tope por etapa no gasta presupuesto de mas')
}
eq(createSyncGate().shouldLog('solo-clave'), true, 'una clave sin separador tambien vale (etapa = la clave)')
// Revision del commit 2: 2 de las 30 quedan RESERVADAS para el vigilante de lotes;
// las demas etapas no pueden gastarlas. El total sigue siendo 30 (decision del duenio).
{
  const g = createSyncGate({ budget: 30, perStage: 30, reserve: { stages: ['vig-a', 'vig-b'], slots: 2 } })
  let n = 0
  for (let i = 0; i < 40; i++) if (g.shouldLog(syncKey('otra', null, `c${i}`))) n++
  eq(n, 28, 'las demas etapas se paran en 28')
  eq(g.shouldLog(syncKey('vig-a', null, 'en-linea')), true, 'la reservada a entra')
  eq(g.shouldLog(syncKey('vig-b', null, 'lotes')), true, 'la reservada b entra')
  eq(g.shouldLog(syncKey('vig-a', null, 'otro')), false, 'y el total no pasa de 30')
  eq(g.left(), 0, 'presupuesto agotado exacto')
}
{
  const g = createSyncGate({ budget: 30, reserve: { stages: ['vig-a'], slots: 2 } })
  eq(g.shouldLog(syncKey('vig-a', null, 'x')), true, 'la reservada tambien entra con hueco libre')
}

// Mensaje: legible, con el detalle, y nunca pasado del tope del registro.
eq(syncMessage('bajada-oyente-caido', 'products', 'permission-denied', ''), 'bajada-oyente-caido products permission-denied', 'mensaje sin detalle')
eq(syncMessage('subida-lote-rechazado', 'stockMovements', 'unavailable', '3 filas'), 'subida-lote-rechazado stockMovements unavailable: 3 filas', 'mensaje con detalle')
eq(syncMessage('bajada-periodica', null, 'x', ''), 'bajada-periodica x', 'sin coleccion no deja huecos')
eq(syncMessage('e', 'c', 'k', 'z'.repeat(1000)).length, 480, 'mensaje acotado a 480')

console.log(`syncLogPolicy: ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
