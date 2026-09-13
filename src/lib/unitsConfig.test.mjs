// Pruebas PURAS de las unidades de medida CONFIGURABLES (U1) -> lib/unitsConfig.js.
// (No confundir con lib/units.js, que convierte CANTIDADES entre unidades de la
//  misma familia fisica y ya existia: es otra responsabilidad y no se toca.)
// Sin framework: ejecutar con  `node src/lib/unitsConfig.test.mjs`.
//
// QUE EXISTE ESTA SUITE PARA CAZAR, y son tres cosas que cuestan caro:
//  1. Que un negocio que NO toque las unidades vea algo distinto a hoy. La clave
//     nace ausente y tiene que devolver EXACTAMENTE las 8 de `constants.js`.
//  2. Que el negocio se quede SIN NINGUNA unidad activa: el alta de producto se
//     quedaria sin una sola opcion. `config` se fusiona por LWW, asi que la lista
//     rota puede LLEGAR de otro telefono; hay que repararla al leer, no solo al
//     escribir.
//  3. Que al editar un producto cuya unidad se desactivo, el desplegable la pierda.
//     Un <select> sin la <option> de su valor se pinta EN BLANCO y el dueño puede
//     guardar creyendo que dejo otra cosa. Ese fallo YA existe hoy con las AREAS
//     (ProductForm): aqui no se repite.
import {
  defaultUnits, cleanCode, cleanLabel, cleanUnits, normalizeUnits,
  hasActive, sortUnits, activeUnits, unitsForSelect, unitLabel
} from './unitsConfig.js'
import { UNITS, UNIT_LABELS } from '../db/constants.js'

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  console.error(`FAIL ${label}\n  esperado: ${e}\n  obtenido: ${a}`)
}
const ok = (cond, label) => eq(!!cond, true, label)

// --- 1) SIN configurar nada, EXACTAMENTE lo de hoy ---------------------------
{
  const d = defaultUnits()
  eq(d.length, UNITS.length, '1) hay tantas de fabrica como en constants.js')
  eq(d.map((u) => u.code), UNITS, '1) los MISMOS codigos y en el mismo orden que UNITS')
  eq(d.map((u) => u.label), UNITS.map((c) => UNIT_LABELS[c]), '1) y las MISMAS etiquetas')
  ok(d.every((u) => u.active), '1) todas nacen activas')
  // Lo que devolveria el repo con la clave ausente:
  eq(normalizeUnits(null), d, '1) clave AUSENTE -> las de fabrica, identicas')
  eq(normalizeUnits([]), d, '1) lista vacia -> las de fabrica')
  eq(normalizeUnits('basura'), d, '1) basura -> las de fabrica (no revienta)')
  eq(normalizeUnits([{ code: '  ' }, { code: null }]), d, '1) lista sin codigos validos -> las de fabrica')
}

// --- 2) EL INVARIANTE: siempre queda una activa ------------------------------
{
  const todasApagadas = [
    { code: 'u', label: 'Unidad', active: false },
    { code: 'kg', label: 'Kilogramo', active: false }
  ]
  const n = normalizeUnits(todasApagadas)
  ok(hasActive(n), '2) si llegan TODAS apagadas, se repara: queda una activa')
  eq(n[0].active, true, '2) se reactiva la PRIMERA (criterio determinista)')
  eq(n[1].active, false, '2) y solo esa: la otra sigue apagada')
  eq(n.length, 2, '2) no se inventan ni se pierden unidades al reparar')
  // hasActive sobre datos sueltos.
  eq(hasActive([{ code: 'u', active: false }]), false, '2) hasActive detecta que no hay ninguna')
  eq(hasActive([{ code: 'u' }]), true, '2) sin el campo `active` cuenta como activa')
  eq(hasActive(null), false, '2) hasActive de nada es false')

  // LO QUE SEPARA A LAS DOS FUNCIONES, y es un fallo que ya se colo una vez: el que
  // ESCRIBE tiene que mirar lo que le dieron, no lo reparado. Si `setUnits` usara
  // `normalizeUnits`, su comprobacion de "debe quedar una activa" no saltaria JAMAS
  // -la reparacion la habria hecho cierta antes de mirarla- y el dueño veria una
  // unidad reactivarse sola, sin mensaje. Si esta asercion falla, ese fallo volvio.
  eq(hasActive(cleanUnits(todasApagadas)), false,
    '2) cleanUnits NO repara: por eso el rechazo del repo puede saltar')
  eq(hasActive(normalizeUnits(todasApagadas)), true,
    '2) normalizeUnits SI repara: por eso la lectura nunca se queda sin opciones')
  eq(cleanUnits([]), [], '2) cleanUnits de una lista vacia es vacia (no mete las de fabrica)')
  eq(cleanUnits('basura'), [], '2) y de basura tambien')
  eq(cleanUnits(todasApagadas).map((u) => u.active), [false, false],
    '2) cleanUnits conserva el estado tal cual se lo dieron')
}

// --- 3) El desplegable NO puede perder la unidad del registro ----------------
{
  const lista = [
    { code: 'u', label: 'Unidad', active: true },
    { code: 'oz', label: 'Onza', active: false }, // el dueño la desactivo
    { code: 'kg', label: 'Kilogramo', active: true }
  ]
  eq(activeUnits(lista).map((u) => u.code), ['kg', 'u'], '3) el desplegable normal solo trae las activas')
  const sel = unitsForSelect(lista, 'oz')
  ok(sel.some((u) => u.code === 'oz'), '3) editando un producto en ONZAS, la onza SI aparece')
  eq(sel.map((u) => u.code), ['kg', 'oz', 'u'], '3) y con las activas, en orden alfabetico por etiqueta')
  eq(unitsForSelect(lista, 'kg').map((u) => u.code), ['kg', 'u'], '3) si su unidad esta activa, no se duplica')
  eq(unitsForSelect(lista, '').map((u) => u.code), ['kg', 'u'], '3) sin unidad actual, solo las activas')
  // Una unidad que ni siquiera esta en la lista (dato viejo o importado).
  const raro = unitsForSelect(lista, 'galon')
  ok(raro.some((u) => u.code === 'galon'), '3) una unidad DESCONOCIDA tambien se ofrece: perderla al guardar seria peor')
  eq(raro.find((u) => u.code === 'galon').label, 'galon', '3) y se muestra con su codigo crudo')
}

// --- 4) Orden alfabetico por etiqueta (lo que el usuario lee) ----------------
{
  const lista = [
    { code: 'z', label: 'Zafra' }, { code: 'a', label: 'ñame' },
    { code: 'b', label: 'Ácido' }, { code: 'c', label: 'agua' }
  ]
  eq(sortUnits(lista).map((u) => u.label), ['Ácido', 'agua', 'ñame', 'Zafra'],
    '4) alfabetico de verdad: acentos, mayusculas y ñ donde una persona los espera')
  // Desempate estable por codigo cuando la etiqueta coincide.
  eq(sortUnits([{ code: 'b', label: 'Igual' }, { code: 'a', label: 'Igual' }]).map((u) => u.code),
    ['a', 'b'], '4) dos etiquetas iguales no bailan: desempata el codigo')
}

// --- 5) Normalizacion del codigo y de la etiqueta ---------------------------
{
  eq(cleanCode('  TRAGO  '), 'trago', '5) el codigo se limpia y va en minusculas')
  eq(cleanCode('copa vino'), 'copavino', '5) sin espacios dentro (es lo que se congela en diez tablas)')
  eq(cleanCode(null), '', '5) codigo nulo -> vacio')
  eq(cleanCode(45), '45', '5) un numero se acepta como texto')
  eq(cleanLabel('  Trago 45 ml ', 'trago'), 'Trago 45 ml', '5) la etiqueta conserva espacios y mayusculas')
  eq(cleanLabel('', 'trago'), 'trago', '5) sin etiqueta se usa el codigo')
  eq(cleanLabel(null, ' DASH '), 'dash', '5) y el codigo ya limpio')
}
{
  // Duplicados: gana el primero, sin reventar.
  const n = normalizeUnits([
    { code: 'ml', label: 'Mililitro', active: true },
    { code: ' ML ', label: 'Otro', active: false }
  ])
  eq(n.length, 1, '5) un codigo repetido (aunque venga con espacios/mayusculas) no se duplica')
  eq(n[0].label, 'Mililitro', '5) y gana el primero')
}

// --- 6) El caso REAL del cliente --------------------------------------------
{
  // Quita los galones que no usa (aqui: desactiva la onza) y añade las suyas.
  const suyas = [
    ...defaultUnits().map((u) => (u.code === 'oz' ? { ...u, active: false } : u)),
    { code: 'trago', label: 'Trago (45 ml)', active: true },
    { code: 'copa120', label: 'Copa de vino blanco (120 ml)', active: true },
    { code: 'copa150', label: 'Copa de vino tinto (150 ml)', active: true },
    { code: 'copa180', label: 'Copa de espumoso (180 ml)', active: true },
    { code: 'dash', label: 'Dash', active: true },
    { code: 'crema', label: 'Trago de crema (30 ml)', active: true }
  ]
  const act = activeUnits(suyas)
  ok(!act.some((u) => u.code === 'oz'), '6) la onza desactivada NO se ofrece')
  eq(act.length, 13, '6) quedan 7 de fabrica + 6 suyas')
  eq(act[0].label, 'Caja', '6) y la lista empieza donde toca alfabeticamente')
  ok(act.some((u) => u.code === 'trago' && u.label === 'Trago (45 ml)'), '6) el trago esta, con su etiqueta')
  // Un producto viejo en onzas se sigue pudiendo editar.
  ok(unitsForSelect(suyas, 'oz').some((u) => u.code === 'oz'), '6) un producto en onzas conserva su unidad al editarlo')
  // Y la etiqueta de lo desactivado se sigue leyendo bien en reportes e historico.
  eq(unitLabel(suyas, 'oz'), 'Onza', '6) el historico en onzas sigue mostrando "Onza"')
  eq(unitLabel(suyas, 'trago'), 'Trago (45 ml)', '6) y las nuevas su etiqueta')
  eq(unitLabel(suyas, 'galon'), 'galon', '6) una unidad que nunca existio se muestra cruda, no vacia')
  eq(unitLabel(suyas, ''), '', '6) sin codigo, cadena vacia')
  eq(unitLabel(null, 'kg'), 'Kilogramo', '6) sin lista configurada, la etiqueta de fabrica')
}

console.log(`${pass} pass, ${fail} fail`)
if (fail) process.exit(1)
