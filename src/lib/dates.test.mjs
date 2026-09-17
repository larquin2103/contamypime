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
//
// Y la etiqueta de DIA (dayLabel), que usan las listas agrupadas por fecha (las
// entregas del dia, las elaboraciones del tablero): "Hoy"/"Ayer" y, sobre todo,
// que NO se desfase un dia por zona horaria, que es su unico riesgo real.
import { tsAfter, now, localDay, todayLocal, dayLabel, timeLabel, formatDateTime } from './dates.js'

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

// --- etiqueta de DIA (dayLabel) ---------------------------------------------
// Cabecera de las listas agrupadas por fecha. Vivio dentro de RemesasScreen hasta
// que la necesito tambien el tablero de elaboracion.
//
// El numero de dia se comprueba por TOKENS (partiendo la etiqueta por lo que no
// sea un digito) y no comparando la cadena entera: asi la prueba no depende del
// idioma ni del formato que tenga instalado el node de turno, solo de que el dia
// que sale sea el dia que se pidio.
const diaDe = (etq) => etq.split(/[^0-9]+/)
{
  eq('dia vacio -> "Sin fecha"', dayLabel(''), 'Sin fecha')
  eq('dia nulo -> "Sin fecha"', dayLabel(null), 'Sin fecha')
  eq('dia de hoy -> "Hoy"', dayLabel(todayLocal()), 'Hoy')

  const ayer = new Date()
  ayer.setDate(ayer.getDate() - 1)
  eq('dia de ayer -> "Ayer"', dayLabel(localDay(ayer)), 'Ayer')

  const anteayer = new Date()
  anteayer.setDate(anteayer.getDate() - 2)
  const etqAnteayer = dayLabel(localDay(anteayer))
  ok('anteayer NO es "Hoy" ni "Ayer"', etqAnteayer !== 'Hoy' && etqAnteayer !== 'Ayer')
  ok('anteayer sale en fecha corta con SU numero de dia',
    diaDe(etqAnteayer).includes(String(anteayer.getDate()).padStart(2, '0')))

  // EL RIESGO REAL: `new Date('2026-08-28')` se interpreta como UTC, y con offset
  // negativo (Cuba, UTC-4/-5) devuelve el dia ANTERIOR. Se recorre un año entero:
  // la etiqueta tiene que llevar SIEMPRE el numero de dia de su clave.
  let desfases = 0
  for (let i = 0; i < 365; i++) {
    const d = new Date(2026, 0, 1 + i)
    const etq = dayLabel(localDay(d))
    if (etq === 'Hoy' || etq === 'Ayer') continue // el dia corriente no lleva numero
    if (!diaDe(etq).includes(String(d.getDate()).padStart(2, '0'))) desfases++
  }
  eq('365 dias: ninguna etiqueta se desfasa del dia de su clave', desfases, 0)

  // CONTROL NEGATIVO: sin el, la prueba de arriba no mediria nada. La version
  // ingenua (pasar la clave por `new Date`) SI se desfasa. Solo se exige donde el
  // fallo existe: con offset <= 0 (UTC o al este de Greenwich) no se reproduce.
  if (new Date().getTimezoneOffset() > 0) {
    const ingenua = (day) => new Date(day).toLocaleDateString('es-CU', {
      day: '2-digit', month: 'short', year: 'numeric'
    })
    let rotas = 0
    for (let i = 0; i < 365; i++) {
      const clave = localDay(new Date(2026, 0, 1 + i))
      if (!diaDe(ingenua(clave)).includes(clave.slice(-2))) rotas++
    }
    eq('control negativo: la version ingenua desfasa los 365 dias', rotas, 365)
  }
}


// ---------------------------------------------------------------------------
// timeLabel: la HORA de un instante, sin la fecha.
//
// PARA QUE: el panel de escritorio dice "Turno abierto desde las 8:14". La fecha
// ahi sobra -es de hoy- y `formatDateTime` la incluye siempre, asi que quedaria
// "17/09/26, 08:14". Se separa en su propia funcion en vez de recortar la cadena
// de `formatDateTime`: recortar por posicion se rompe en cuanto cambie el
// formato, y esta regla se va a usar en mas sitios del panel.
//
// Misma configuracion regional que `formatDateTime` (es-CU), para que las dos
// impriman la hora IGUAL y no se vea una en 24h y otra en 12h en la misma
// pantalla.
{
  const h = (iso) => timeLabel(iso)
  // Un instante concreto, construido en LOCAL para que la prueba no dependa de
  // la zona horaria de la maquina que la corre (en UTC daria otra hora).
  const d = new Date(2026, 8, 17, 8, 14, 0)
  const esperado = d.toLocaleTimeString('es-CU', { hour: '2-digit', minute: '2-digit' })
  eq('timeLabel devuelve la hora local del instante', h(d.toISOString()), esperado)
  ok('timeLabel no incluye la fecha', !/\d{2}\/\d{2}/.test(h(d.toISOString())))

  // Robustez: lo pinta una pantalla, asi que no puede reventar con basura.
  eq('timeLabel sin valor devuelve cadena vacia', h(''), '')
  eq('timeLabel con null devuelve cadena vacia', h(null), '')
  eq('timeLabel con undefined devuelve cadena vacia', h(undefined), '')
  eq('timeLabel con una fecha invalida devuelve el valor tal cual', h('no-es-fecha'), 'no-es-fecha')

  // Coherencia con formatDateTime: la hora que imprimen las dos es la MISMA.
  const iso = new Date(2026, 8, 17, 20, 5, 0).toISOString()
  ok('timeLabel coincide con la hora que imprime formatDateTime',
    formatDateTime(iso).includes(timeLabel(iso)))
}
console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
