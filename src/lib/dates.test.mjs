// Pruebas PURAS de la marca de tiempo monotona por registro (tsAfter).
// Sin framework: ejecutar con  `node src/lib/dates.test.mjs`.
//
// Que se verifica (la garantia de NO-REGRESION de la Capa 1):
//  - Reloj COHERENTE (o registro nuevo): devuelve now() tal cual -> el valor
//    escrito es el MISMO que hoy, no cambia nada del comportamiento clasico.
//  - Reloj ATRASADO respecto a la marca que trajo el otro equipo: devuelve la
//    marca anterior + 1 ms, que es lo minimo que hace falta para que el LWW de
//    bajada (fusiona solo si la entrante es MAYOR) no descarte la mutacion.
//  - Reproduccion del caso REAL de los respaldos (desfase de ~21 s).
//  - Robustez: marcas ilegibles no lanzan (no pueden abortar una transaccion).
import { tsAfter, now } from './dates.js'

let pass = 0
let fail = 0
const eq = (name, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp)
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${ok ? '' : `  got=${JSON.stringify(got)} exp=${JSON.stringify(exp)}`}`)
  ok ? pass++ : fail++
}
const ok = (name, cond) => eq(name, !!cond, true)

// --- reloj coherente: identico a hoy ---------------------------------------
{
  const antes = now()
  const t = tsAfter() // sin version previa (registro nuevo)
  const despues = now()
  ok('sin marca previa devuelve now()', t >= antes && t <= despues)
  ok('sin marca previa: formato ISO-Z', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(t))
}
{
  const vieja = new Date(Date.now() - 60_000).toISOString() // version de hace 1 min
  const antes = now()
  const t = tsAfter(vieja)
  const despues = now()
  ok('version mas vieja que el reloj -> now() exacto', t >= antes && t <= despues)
  ok('version mas vieja: no se toca la marca previa', t > vieja)
}
{
  // Varias marcas previas (updatedAt/settledAt/createdAt): manda la mayor.
  const a = new Date(Date.now() - 90_000).toISOString()
  const b = new Date(Date.now() - 30_000).toISOString()
  const antes = now()
  const t = tsAfter(a, b, null, undefined, 0)
  ok('varias marcas viejas -> now()', t >= antes)
}

// --- reloj ATRASADO: +1 ms sobre la version anterior ------------------------
{
  const futura = new Date(Date.now() + 21_000).toISOString() // el otro equipo va 21 s adelante
  const t = tsAfter(futura)
  eq('reloj atrasado -> marca previa + 1 ms', t, new Date(new Date(futura).getTime() + 1).toISOString())
  ok('reloj atrasado: la mutacion GANA el LWW (t > previa)', t > futura)
}
{
  // La MAYOR de las marcas manda, no la primera.
  const alta = new Date(Date.now() + 21_000).toISOString()
  const baja = new Date(Date.now() - 5_000).toISOString()
  eq('manda la marca MAYOR', tsAfter(baja, alta), new Date(new Date(alta).getTime() + 1).toISOString())
}
{
  // Mutaciones encadenadas en el mismo dispositivo atrasado: cada una supera a
  // la anterior (monotonia estricta), que es lo que el cursor de subida exige.
  let v = new Date(Date.now() + 21_000).toISOString()
  const serie = []
  for (let i = 0; i < 5; i++) { v = tsAfter(v); serie.push(v) }
  ok('cadena de mutaciones: estrictamente creciente',
    serie.every((x, i) => i === 0 || x > serie[i - 1]))
}

// --- caso REAL de los respaldos (entrega que se perdio) ---------------------
{
  // El mensajero (reloj adelantado) dejo la cabecera en 15:03:22.955; el dueño
  // (20,788 s atrasado) marco ENTREGADA con su reloj: 15:03:02.167. Hoy esa
  // mutacion nace MAS VIEJA que el estado que reemplaza -> el LWW la descarta.
  // El DESFASE es lo que importa, asi que se reproduce contra el reloj de ahora
  // (una fecha fija del pasado ya no reproduciria nada: seria mas vieja que now()).
  const DESFASE_MS = new Date('2026-08-27T15:03:22.955Z') - new Date('2026-08-27T15:03:02.167Z')
  eq('caso real: el desfase medido en los respaldos', DESFASE_MS, 20788)
  const relojLocal = now() // el dueño sella con SU reloj (atrasado)
  const previa = new Date(Date.now() + DESFASE_MS).toISOString() // marca del mensajero
  ok('caso real: hoy la mutacion nace mas vieja (bug)', relojLocal < previa)
  const t = tsAfter(previa)
  eq('caso real: con tsAfter queda 1 ms por encima de la previa',
    t, new Date(new Date(previa).getTime() + 1).toISOString())
  ok('caso real: gana el LWW de bajada (entrante > local)', t > previa)
  ok('caso real: supera el cursor de subida si estaba en la marca previa', t > previa)
}

// --- robustez: nada de esto puede abortar una transaccion -------------------
{
  const antes = now()
  ok('marca ilegible -> now() (no lanza)', tsAfter('no-es-una-fecha-###') >= antes)
  ok('tipos raros se ignoran', tsAfter(null, undefined, 123, {}, []) >= antes)
}

console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
