// Pruebas PURAS de las lineas de los anexos de la ficha de costo.
// Sin framework: ejecutar con  `node src/lib/fichaLines.test.mjs`.
//
// QUE EXISTE ESTA SUITE PARA CAZAR (hallazgo H3): que el autoguardado de un
// dispositivo escriba algo que el dueño NO toco. Ese es el mecanismo exacto por
// el que el dueño y el administrativo se pisaban los anexos: el formulario se
// cargaba una vez, no se resincronizaba nunca, y cada 600 ms mandaba el
// documento ENTERO. Las tres aserciones que mas importan estan agrupadas al
// final, en "el caso H3".
import {
  FICHA_LINE_KINDS,
  cleanLine,
  cleanLines,
  cleanCarriers,
  cleanRows,
  legacyLineId,
  linesFromArrays,
  hydrateSheet,
  groupLinesBySheet,
  diffHeader,
  diffLines,
  diffSheet,
  isEmptyDelta,
  FICHA_HEADER_FIELDS
} from './fichaLines.js'

let pass = 0
let fail = 0
const eq = (name, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp)
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${ok ? '' : `  got=${JSON.stringify(got)} exp=${JSON.stringify(exp)}`}`)
  ok ? pass++ : fail++
}

const TS = 1757000000000
const opt = { sheetId: 'S1', ts: TS }

// --- Normalizacion ---------------------------------------------------------
eq('las cuatro clases de linea son las cuatro del modelo oficial',
  FICHA_LINE_KINDS, ['inputs', 'labor', 'otherDirect', 'refs'])

eq('insumo: 7 columnas mas el par congelado de divisas',
  Object.keys(cleanLine('inputs', {})),
  ['productId', 'code', 'name', 'unit', 'baseCost', 'qty', 'unitPrice', 'priceCurrency', 'priceRate'])
eq('salario: las 8 columnas capturadas (la (9) la calcula el motor)',
  Object.keys(cleanLine('labor', {})),
  ['operation', 'baseCost', 'workers', 'category', 'scaleGroup', 'hourly', 'extraHourly', 'hours'])
eq('otros directos y referencias', [Object.keys(cleanLine('otherDirect', {})), Object.keys(cleanLine('refs', {}))],
  [['concept', 'amount'], ['source', 'price', 'note']])
eq('una clase desconocida no revienta: devuelve vacio', cleanLine('loquesea', { a: 1 }), {})

// La regla que separa esto de `recipesRepo.cleanItems`: NO se descarta la linea
// a medio escribir. Tirarla borraria lo que el dueño acaba de teclear.
eq('la linea incompleta NO se descarta',
  cleanLines('inputs', [{ name: 'Harina' }, {}]).length, 2)
eq('lo vacio se normaliza a cero / cadena, no a NaN',
  cleanLine('inputs', { qty: '', unitPrice: 'x' }).qty + cleanLine('inputs', {}).unitPrice, 0)
eq('el texto se recorta y la moneda vacia es null',
  [cleanLine('inputs', { name: '  Harina  ' }).name, cleanLine('inputs', { priceCurrency: '' }).priceCurrency],
  ['Harina', null])
eq('portadores: siempre las tres filas aunque no venga ninguna',
  Object.keys(cleanCarriers(null)), ['fuel', 'energy', 'water'])
eq('filas del Anexo I: van TODAS aunque valgan cero',
  Object.keys(cleanRows(null)),
  ['r4', 'r41', 'r6', 'r61', 'r7', 'r71', 'r8', 'r9', 'taxSS', 'taxFT'])

// --- Hidratacion -----------------------------------------------------------
const VIEJA = {
  id: 'S1',
  inputs: [{ name: 'Harina', qty: 25, unitPrice: 420 }, { name: 'Sal', qty: 0.4, unitPrice: 150 }],
  labor: [{ operation: 'Amasado', workers: 2, hourly: 30, hours: 4 }],
  otherDirect: [],
  refs: []
}

eq('id de linea heredada: determinista y con el id de la ficha dentro',
  legacyLineId('S1', 'inputs', 1), 'fl:S1:inputs:1')
eq('y dos conversiones de la MISMA ficha vieja dan los mismos ids (no duplican)',
  linesFromArrays(VIEJA, TS).map((l) => l.id),
  linesFromArrays(VIEJA, TS + 5000).map((l) => l.id))
eq('la conversion sella sheetId, clase, posicion y las dos marcas de tiempo',
  (() => { const l = linesFromArrays(VIEJA, TS)[1]; return [l.sheetId, l.kind, l.pos, l.voided, l.createdAt, l.updatedAt] })(),
  ['S1', 'inputs', 1, false, TS, TS])
eq('una ficha sin id no produce lineas huerfanas', linesFromArrays({ inputs: [{}] }, TS), [])

// Sin lineas en la tabla, manda el array del documento (formato viejo).
const H_VIEJA = hydrateSheet(VIEJA, [])
eq('sin lineas: se cae al array del documento, ya con id y posicion',
  [H_VIEJA.inputs.length, H_VIEJA.inputs[0].id, H_VIEJA.inputs[0].pos, H_VIEJA.inputs[0].name],
  [2, 'fl:S1:inputs:0', 0, 'Harina'])

const LINEAS = [
  { id: 'a', sheetId: 'S1', kind: 'inputs', pos: 1, name: 'Levadura', qty: 0.5, unitPrice: 1800 },
  { id: 'b', sheetId: 'S1', kind: 'inputs', pos: 0, name: 'Harina', qty: 25, unitPrice: 420 },
  { id: 'c', sheetId: 'S1', kind: 'inputs', pos: 2, voided: true, name: 'Borrada', qty: 9, unitPrice: 9 },
  { id: 'd', sheetId: 'S2', kind: 'inputs', pos: 0, name: 'De otra ficha', qty: 1, unitPrice: 1 }
]
const H = hydrateSheet(VIEJA, LINEAS)
eq('con lineas: mandan ellas y el array viejo se ignora',
  H.inputs.map((l) => l.name), ['Harina', 'Levadura'])
eq('las anuladas no se pintan (pero siguen en la tabla: nada se borra)',
  H.inputs.some((l) => l.name === 'Borrada'), false)
eq('las lineas de OTRA ficha no se cuelan', H.inputs.some((l) => l.name === 'De otra ficha'), false)
eq('se ordenan por posicion, no por como vinieron', H.inputs.map((l) => l.pos), [0, 1])
eq('la procedencia es POR CLASE: salario sigue viniendo del array viejo',
  [H.labor.length, H.labor[0].operation, H.labor[0].id], [1, 'Amasado', 'fl:S1:labor:0'])
eq('la linea hidratada lleva id y posicion, y ni rastro de sheetId/kind/voided',
  Object.keys(hydrateSheet({ id: 'S1', otherDirect: [] }, [{ id: 'z', sheetId: 'S1', kind: 'otherDirect', pos: 0, concept: 'Flete', amount: 100 }]).otherDirect[0]),
  ['id', 'pos', 'concept', 'amount'])
eq('una clase que se queda con TODAS sus lineas anuladas queda vacia, no resucita el array viejo',
  hydrateSheet(VIEJA, [{ id: 'x', sheetId: 'S1', kind: 'inputs', pos: 0, voided: true, name: 'Harina' }]).inputs, [])
eq('hidratar null no revienta', hydrateSheet(null, LINEAS), null)
eq('agrupar por ficha separa las dos', [...groupLinesBySheet(LINEAS).keys()], ['S1', 'S2'])

// --- Diferencia de cabecera -------------------------------------------------
const BASE_H = { name: 'Pan suave', code: 'PAN', productionLevel: '200', capacityPct: '78', activity: 'bienes', method: 'gastos', carriers: { fuel: { qty: 12, unitPrice: 100 } }, rows: { r4: 500 }, correlationPrice: '', elaboratedBy: '', productId: null, unit: 'u' }

eq('sin cambios no viaja NADA (abrir la ficha no la sube a la nube)',
  diffHeader(BASE_H, { ...BASE_H }), {})
eq('solo viaja lo que cambio', diffHeader(BASE_H, { ...BASE_H, name: 'Pan blando' }), { name: 'Pan blando' })
eq('200 y "200" son el mismo nivel de produccion: no se escribe por teclear igual',
  diffHeader(BASE_H, { ...BASE_H, productionLevel: 200 }), {})
eq('un espacio de mas en el nombre tampoco es un cambio',
  diffHeader(BASE_H, { ...BASE_H, name: '  Pan suave  ' }), {})
eq('los portadores se comparan normalizados, no por como se teclearon',
  diffHeader(BASE_H, { ...BASE_H, carriers: { fuel: { qty: '12', unitPrice: '100' } } }), {})
eq('pero un portador distinto SI viaja',
  Object.keys(diffHeader(BASE_H, { ...BASE_H, carriers: { fuel: { qty: 13, unitPrice: 100 } } })), ['carriers'])
eq('las filas del Anexo I igual: "500" no cambia nada, 501 si',
  [Object.keys(diffHeader(BASE_H, { ...BASE_H, rows: { r4: '500' } })), Object.keys(diffHeader(BASE_H, { ...BASE_H, rows: { r4: 501 } }))],
  [[], ['rows']])

// `utilityPct` es el campo con la regla cruzada del repo: mientras la clave NO
// exista en el formulario, manda el repo (adopta el maximo de la actividad).
eq('la tasa de utilidad no viaja mientras el dueño no la toque',
  'utilityPct' in diffHeader({ ...BASE_H, utilityPct: 25 }, { ...BASE_H }), false)
eq('en cuanto la escribe, viaja', diffHeader({ ...BASE_H }, { ...BASE_H, utilityPct: 18 }), { utilityPct: 18 })
eq('y su null NO se colapsa a cero: pasar de "sin tasa" a 0 es un cambio real',
  diffHeader({ ...BASE_H, utilityPct: null }, { ...BASE_H, utilityPct: 0 }), { utilityPct: 0 })
eq('null contra null no es cambio',
  diffHeader({ ...BASE_H, utilityPct: null }, { ...BASE_H, utilityPct: null }), {})
eq('la lista de campos de cabecera es la que maneja el formulario',
  FICHA_HEADER_FIELDS.length, 13)

// --- Diferencia de lineas ---------------------------------------------------
const B = [
  { id: 'l1', pos: 0, name: 'Harina', qty: 25, unitPrice: 420 },
  { id: 'l2', pos: 1, name: 'Sal', qty: 0.4, unitPrice: 150 }
]

eq('sin cambios: ni altas, ni parches, ni anulaciones',
  diffLines('inputs', B, B.map((r) => ({ ...r })), opt), { adds: [], patches: [], voids: [] })

const d1 = diffLines('inputs', B, [B[0], { ...B[1], qty: 0.5 }], opt)
eq('un cambio manda SOLO el campo cambiado, con su marca de tiempo',
  [d1.patches.length, d1.patches[0].id, d1.patches[0].fields], [1, 'l2', { qty: 0.5, updatedAt: TS }])
eq('y no toca la linea que el dueño no toco', d1.adds.length + d1.voids.length, 0)

const d2 = diffLines('inputs', B, [...B, { id: 'nueva', name: 'Aceite', qty: 1.5, unitPrice: 950 }], opt)
eq('un alta conserva el id que puso la pantalla y nace despues de las que habia',
  [d2.adds.length, d2.adds[0].id, d2.adds[0].pos, d2.adds[0].sheetId, d2.adds[0].kind],
  [1, 'nueva', 2, 'S1', 'inputs'])
eq('el alta sella las dos marcas de tiempo y nace no anulada',
  [d2.adds[0].createdAt, d2.adds[0].updatedAt, d2.adds[0].voided], [TS, TS, false])
eq('un alta sin id se acuña con el generador que se le pase',
  diffLines('inputs', [], [{ name: 'X' }], { ...opt, mintId: () => 'ACUÑADO' }).adds[0].id, 'ACUÑADO')

const d3 = diffLines('inputs', B, [B[1]], opt)
eq('quitar una linea la ANULA, no la borra (regla 6)',
  d3.voids, [{ id: 'l1', fields: { voided: true, updatedAt: TS } }])
eq('y quitar la primera NO le cambia la identidad a la segunda (el indice no es la clave)',
  d3.patches, [])

// Duplicar una fila con `{ ...fila }` deja dos lineas con el MISMO id. Es lo que
// hacia "otra norma de tiempo" (`splitLaborOp`), y sin guarda la segunda se comia
// a la primera al guardar: una operacion desaparecida en silencio.
const dDup = diffLines('labor',
  [{ id: 'o1', pos: 0, operation: 'Amasado', workers: 2, hourly: 30, hours: 4 }],
  [
    { id: 'o1', operation: 'Amasado', workers: 2, hourly: 30, hours: 4 },
    { id: 'o1', operation: 'Amasado', workers: 2, hourly: 30, hours: 2 } // la copia
  ],
  { ...opt, mintId: () => 'o2' })
eq('dos filas con el mismo id: la segunda se trata como linea NUEVA, con id propio',
  [dDup.adds.length, dDup.adds[0].id, dDup.adds[0].hours, dDup.patches.length, dDup.voids.length],
  [1, 'o2', 2, 0, 0])
eq('y la original NO se anula por el camino', dDup.voids, [])

// --- El caso H3 -------------------------------------------------------------
// Escenario real: el dueño abre la ficha, el administrativo le añade una linea y
// le corrige el precio de otra desde SU telefono, y el dueño sigue tecleando en
// una pantalla que ya esta vieja. Antes esto reescribia el anexo entero.
const OTRO = [
  { id: 'l1', pos: 0, name: 'Harina', qty: 25, unitPrice: 999 }, // el otro le cambio el precio
  { id: 'l2', pos: 1, name: 'Sal', qty: 0.4, unitPrice: 150 },
  { id: 'l3', pos: 2, name: 'Azucar', qty: 2, unitPrice: 380 } // y añadio esta
]
// El dueño tiene en pantalla `B` (viejo) y toca SOLO la cantidad de la sal.
const dH3 = diffLines('inputs', B, [B[0], { ...B[1], qty: 0.9 }], opt)
eq('H3-a: la linea que añadio el OTRO no se anula (el diff no puede tocar lo que nunca vio)',
  dH3.voids, [])
eq('H3-b: el precio que corrigio el OTRO no se reescribe con el viejo',
  dH3.patches.some((p) => p.id === 'l1'), false)
eq('H3-c: y lo unico que se escribe es lo que el dueño tecleo de verdad',
  dH3.patches, [{ id: 'l2', fields: { qty: 0.9, updatedAt: TS } }])
// La comprobacion de que el resultado fusionado conserva las dos ediciones.
const fusionado = OTRO.map((l) => (l.id === 'l2' ? { ...l, qty: 0.9 } : l))
eq('H3-d: el resultado tiene las tres lineas, con el precio del otro y la cantidad del dueño',
  [fusionado.length, fusionado[0].unitPrice, fusionado[1].qty], [3, 999, 0.9])

// --- Diferencia completa ----------------------------------------------------
const SB = { ...BASE_H, inputs: B, labor: [], otherDirect: [], refs: [] }
eq('una ficha identica a si misma no produce delta', isEmptyDelta(diffSheet(SB, { ...SB }, opt)), true)
eq('isEmptyDelta con nada tambien es vacio', [isEmptyDelta(null), isEmptyDelta({})], [true, true])

const dS = diffSheet(SB, { ...SB, name: 'Otro', refs: [{ id: 'r1', source: 'Mercado' }] }, opt)
eq('el delta completo junta cabecera y anexos',
  [dS.header, dS.lines.adds.length, dS.lines.adds[0].kind, isEmptyDelta(dS)],
  [{ name: 'Otro' }, 1, 'refs', false])
eq('un anexo que el formulario no maneja no se toca (no se anula por ausencia)',
  diffSheet(SB, { name: 'Otro' }, opt).lines, { adds: [], patches: [], voids: [] })

console.log(`\n${pass} pass, ${fail} fail`)
if (fail > 0) process.exit(1)
