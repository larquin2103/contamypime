// Pruebas PURAS del motor de la Ficha de costos y gastos (Res. 148/2023 MFP).
// Sin framework: ejecutar con  `node src/lib/fichaCosto.test.mjs`.
//
// El fixture es el ejemplo "Pan suave" (200 u) del artefacto que aprobo el dueño
// el 31-08-2026 y que esta escrito fila por fila en `docs/FICHA-COSTO.md` §5.1.
// NO cambiar los numeros: si la suite usa otros, el motor deja de cuadrar con el
// documento aprobado y la ficha impresa no coincidiria con lo que se enseño.
//
// Las tres trampas que esta suite existe para cazar:
//   A - el coeficiente de indirectos del Art. 9 (aviso, nunca cerrojo).
//   B - la BASE de la utilidad NO es la Fila 12 (nota ** del Anexo II). Es la
//       asercion mas importante del fichero: con la base mal puesta el precio
//       unitario sale 197,28 en vez de 170,08.
//   C - el metodo por correlacion puede dar utilidad NEGATIVA = subsidio.
import {
  FICHA_ACTIVITIES,
  FICHA_METHODS,
  inputsTotal,
  missingRateInputs,
  carriersTotal,
  laborTotal,
  otherDirectTotal,
  taxRow,
  totals,
  indirectCheck,
  utilityBase,
  maxUtility,
  priceRows,
  subsidyWarning
} from './fichaCosto.js'

let pass = 0
let fail = 0
const eq = (name, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp)
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${ok ? '' : `  got=${JSON.stringify(got)} exp=${JSON.stringify(exp)}`}`)
  ok ? pass++ : fail++
}

// --- Fixture "Pan suave", columna Costo Nuevo -------------------------------
// Insumo = 7 columnas del anexo: la (7) importe = (5) norma de consumo x (6) precio unitario.
const INSUMOS = [
  { code: 'HAR', name: 'Harina', unit: 'kg', qty: 25, unitPrice: 420 },
  { code: 'LEV', name: 'Levadura', unit: 'kg', qty: 0.5, unitPrice: 1800 },
  { code: 'ACE', name: 'Aceite', unit: 'l', qty: 1.5, unitPrice: 950 },
  { code: 'AZU', name: 'Azucar', unit: 'kg', qty: 2, unitPrice: 380 },
  { code: 'SAL', name: 'Sal', unit: 'kg', qty: 0.4, unitPrice: 150 }
]
// Portadores: NO son productos del catalogo, van con cantidad y precio unitario.
const PORTADORES = {
  fuel: { qty: 12, unitPrice: 100 }, // fila 1.2
  energy: { qty: 340, unitPrice: 2.5 }, // fila 1.3
  water: { qty: 8, unitPrice: 15 } // fila 1.4
}
// Salario = 9 columnas del anexo: la (9) gasto = (3) x ((6) + (7)) x (8).
const SALARIO = [
  { operation: 'Amasado', workers: 2, hourly: 350, extraHourly: 50, hours: 6 },
  { operation: 'Empaque', workers: 1, hourly: 300, extraHourly: 0, hours: 3 }
]
const OTROS_DIRECTOS = [
  { concept: 'Depreciacion', amount: 600 },
  { concept: 'Mantenimiento', amount: 300 }
]
const FILAS = { r4: 3200, r41: 1900, r6: 4100, r61: 2400, r7: 1600, r71: 700, r8: 250, r9: 0, taxSS: 0, taxFT: 0 }

const PAN = {
  name: 'Pan suave',
  code: 'PAN-001',
  unit: 'u',
  productionLevel: 200,
  capacityPct: 78,
  activity: FICHA_ACTIVITIES.BIENES,
  method: FICHA_METHODS.GASTOS,
  inputs: INSUMOS,
  carriers: PORTADORES,
  labor: SALARIO,
  otherDirect: OTROS_DIRECTOS,
  rows: FILAS
}

// --- Anexos: los dos que la norma obliga a desagregar (Art. 5) ---------------
eq('insumos: suma del anexo (25x420 + 0,5x1800 + 1,5x950 + 2x380 + 0,4x150)', inputsTotal(INSUMOS), 13645)
eq('portadores: 1.2 + 1.3 + 1.4 = 1200 + 850 + 120', carriersTotal(PORTADORES), 2170)
eq('salario: 2x(350+50)x6 + 1x(300+0)x3', laborTotal(SALARIO), 5700)
eq('otros directos: depreciacion 600 + mantenimiento 300', otherDirectTotal(OTROS_DIRECTOS), 900)

// --- Las 16 filas -----------------------------------------------------------
const T = totals(PAN)
eq('fila 1.1 insumos', T.r1_1, 13645)
eq('fila 1.2 combustible 12 L x 100', T.r1_2, 1200)
eq('fila 1.3 energia 340 kw x 2,50', T.r1_3, 850)
eq('fila 1.4 agua 8 m3 x 15', T.r1_4, 120)
eq('fila 1 GASTO MATERIAL = 1.1+1.2+1.3+1.4', T.r1, 15815)
eq('fila 2 salario directo', T.r2, 5700)
eq('fila 3 otros gastos directos', T.r3, 900)
eq('fila 4 asociados a la produccion (capturada)', T.r4, 3200)
eq('fila 4.1 de ello salarios (capturada)', T.r41, 1900)
eq('fila 5 COSTO TOTAL = 1+2+3+4', T.r5, 25615)
eq('fila 10 tributarios = (2+4.1+6.1+7.1) x (tipos 0) = 10700 x 0', T.r10, 0)
eq('fila 11 TOTAL DE GASTOS = 6+7+8+9+10', T.r11, 5950)
eq('fila 12 TOTAL DE COSTOS Y GASTOS = 5+11 (errata de la Gaceta resuelta)', T.r12, 31565)

// La errata: el cuerpo de la Gaceta dice "6+11" y el Anexo I rotula "(5+11)".
// Con 6+11 la fila 6 se contaria dos veces y las filas 1-4 desapareceriaan del
// precio. Esta asercion fija la lectura correcta para siempre.
eq('fila 12 NO es 6+11 (seria 10050, y perderia las filas 1-4)', T.r12 === FILAS.r6 + T.r11, false)

// --- Fila 10: los tipos SI se aplican cuando el dueño los configura ----------
eq('fila 10 con Seg.Social 12,5% + Fuerza de Trabajo 5% sobre base 10700',
  taxRow({ ...PAN, rows: { ...FILAS, taxSS: 0.125, taxFT: 0.05 } }), 1872.5)
eq('base de la fila 10 = 2 + 4.1 + 6.1 + 7.1 (5700+1900+2400+700), NO la fila 5',
  taxRow({ ...PAN, rows: { ...FILAS, taxSS: 1, taxFT: 0 } }), 10700)

// --- CONTROL A: coeficiente maximo de gastos indirectos (Art. 9) -------------
const A = indirectCheck(PAN)
eq('control A: 4+6+7 = 3200+4100+1600', A.sum, 8900)
eq('control A: limite = 1,5 x fila 2 (produccion de bienes)', A.limit, 8550)
eq('control A: exceso en IMPORTE, no en porcentaje', A.excess, 350)
eq('control A: coeficiente aplicado 8900/5700', A.coefficient, 1.56)
eq('control A: se pasa -> ok=false (AVISO, la app no bloquea, Art. 6)', A.ok, false)

eq('control A servicios: limite = 1,0 x fila 2',
  indirectCheck({ ...PAN, activity: FICHA_ACTIVITIES.SERVICIOS }).limit, 5700)
eq('control A gastronomia popular (Art. 16): indirectos <= salario directo',
  indirectCheck({ ...PAN, activity: FICHA_ACTIVITIES.GASTRONOMIA }).limit, 5700)
eq('control A agropecuaria: es produccion -> 1,5',
  indirectCheck({ ...PAN, activity: FICHA_ACTIVITIES.AGROPECUARIA }).limit, 8550)
eq('control A alta tecnologia: decision del dueño 01-09-2026 -> 1,0 (lado que avisa antes)',
  indirectCheck({ ...PAN, activity: FICHA_ACTIVITIES.ALTA_TEC }).limit, 5700)
eq('control A: dentro del limite -> ok=true y exceso 0',
  (() => { const r = indirectCheck({ ...PAN, rows: { ...FILAS, r4: 2000 } }); return [r.ok, r.excess] })(), [true, 0])
eq('control A: sin salario directo no se inventa un limite (division por cero)',
  (() => { const r = indirectCheck({ ...PAN, labor: [] }); return [r.limit, r.coefficient] })(), [0, 0])

// --- CONTROL B: LA BASE DE LA UTILIDAD NO ES EL TOTAL ------------------------
// Nota ** del Anexo II. Es el detalle que casi todos pierden.
eq('base bienes = 2+3+4 = 5700+900+3200 (NO la fila 12)', utilityBase(PAN), 9800)
eq('base servicios y comercializacion = 2+3+4 igual',
  utilityBase({ ...PAN, activity: FICHA_ACTIVITIES.SERVICIOS }), 9800)
eq('base agropecuaria = fila 12 COMPLETA (excepcion del Anexo II)',
  utilityBase({ ...PAN, activity: FICHA_ACTIVITIES.AGROPECUARIA }), 31565)
eq('base alta tecnologia/informatica/ciencia = fila 12 COMPLETA',
  utilityBase({ ...PAN, activity: FICHA_ACTIVITIES.ALTA_TEC }), 31565)
eq('base gastronomia popular = 2+3+4+7 (Art. 16 NO descuenta distribucion y venta)',
  utilityBase({ ...PAN, activity: FICHA_ACTIVITIES.GASTRONOMIA }), 11400)

eq('tasa maxima produccion de bienes', maxUtility(FICHA_ACTIVITIES.BIENES), 0.25)
eq('tasa maxima agropecuaria', maxUtility(FICHA_ACTIVITIES.AGROPECUARIA), 0.3)
eq('tasa maxima servicios y comercializacion', maxUtility(FICHA_ACTIVITIES.SERVICIOS), 0.15)
eq('tasa maxima alta tecnologia/informatica/ciencia', maxUtility(FICHA_ACTIVITIES.ALTA_TEC), 0.3)
eq('tasa maxima gastronomia popular (Art. 16)', maxUtility(FICHA_ACTIVITIES.GASTRONOMIA), 0.1)

// --- Filas 13, 14 y 15 por el metodo de GASTOS ------------------------------
const P = priceRows(PAN)
eq('fila 13 utilidad = 25% de la base 9800', P.r13, 2450)
eq('fila 14 PRECIO O TARIFA = 12 + 13', P.r14, 34015)
eq('fila 15 precio unitario = 14 / 200 (redondeo de 170,075)', P.r15, 170.08)

// La trampa B con numeros. OJO: no se puede montar cambiando la actividad a
// agropecuaria, porque eso ademas sube la tasa del 25% al 30% y ya es otro
// escenario. La trampa es usar la fila 12 como base MANTENIENDO el 25% de
// produccion de bienes: 31565 x 0,25 = 7891,25 y el unitario 197,28.
// Lo que se verifica es que el motor NO cae ahi.
eq('trampa B: la utilidad NO es el 25% de la fila 12 (serian 7891,25)', P.r13 === 7891.25, false)
eq('trampa B: el unitario NO sale 197,28 (que es lo que da la base mal puesta)', P.r15 === 197.28, false)
eq('trampa B: la utilidad correcta es 3,2 veces menor que la equivocada',
  Math.round((7891.25 / P.r13) * 10) / 10, 3.2)
// Y la agropecuaria, que SI usa la fila 12, lleva ademas su propia tasa del 30%.
const AGRO = priceRows({ ...PAN, activity: FICHA_ACTIVITIES.AGROPECUARIA })
eq('agropecuaria: utilidad = 30% de la fila 12 completa', AGRO.r13, 9469.5)
eq('agropecuaria: unitario = (31565 + 9469,50) / 200', AGRO.r15, 205.17)

// --- CONTROL C: metodo por correlacion --------------------------------------
const CORR = { ...PAN, method: FICHA_METHODS.CORRELACION, correlationPrice: 28000 }
const C = priceRows(CORR)
eq('correlacion: fila 13 = precio del similar - fila 12 = 28000 - 31565', C.r13, -3565)
eq('correlacion: fila 14 ES el precio del similar', C.r14, 28000)
eq('correlacion: fila 15 = 28000 / 200', C.r15, 140)
eq('correlacion: utilidad negativa = SUBSIDIO -> aviso rojo', subsidyWarning(CORR), true)
eq('por gastos con utilidad positiva: sin aviso de subsidio', subsidyWarning(PAN), false)
eq('correlacion por encima del costo: sin aviso',
  subsidyWarning({ ...CORR, correlationPrice: 40000 }), false)

// --- Columna Costo Base (la revision anterior, para el delta) ---------------
const BASE = {
  ...PAN,
  inputs: [{ code: 'X', name: 'Insumos base', unit: 'u', qty: 1, unitPrice: 12900 }],
  carriers: { fuel: { qty: 1, unitPrice: 1150 }, energy: { qty: 1, unitPrice: 820 }, water: { qty: 1, unitPrice: 110 } },
  labor: [{ operation: 'Base', workers: 1, hourly: 5400, extraHourly: 0, hours: 1 }],
  otherDirect: [{ concept: 'Base', amount: 900 }],
  rows: { r4: 3050, r41: 1800, r6: 3900, r61: 2300, r7: 1500, r71: 660, r8: 240, r9: 0, taxSS: 0, taxFT: 0 }
}
const TB = totals(BASE)
eq('costo base: fila 1 = 12900+1150+820+110', TB.r1, 14980)
eq('costo base: fila 5 = 24330', TB.r5, 24330)
eq('costo base: fila 11 = 5640', TB.r11, 5640)
eq('costo base: fila 12 = 29970', TB.r12, 29970)
eq('costo base: base de utilidad = 5400+900+3050', utilityBase(BASE), 9350)
const PB = priceRows(BASE)
eq('costo base: fila 13 = 25% de 9350', PB.r13, 2337.5)
eq('costo base: fila 14 = 32307,50', PB.r14, 32307.5)
eq('costo base: fila 15 = 161,54 (redondeo de 161,5375)', PB.r15, 161.54)

// --- Insumo en DIVISA: con tasa convierte, sin tasa NO se inventa nada -------
// Invariante de la app (kitchenRepo.produce): el par priceCurrency/priceRate va
// CONGELADO en la linea. El motor es puro: NO lanza, DEVUELVE el bloqueo, y la
// pantalla decide. Es el estilo de custodyMath/productCustodyMath/remesas.
const CON_TASA = [{ code: 'IMP', name: 'Importado', unit: 'kg', qty: 2, unitPrice: 3, priceCurrency: 'USD', priceRate: 320 }]
const SIN_TASA = [{ code: 'IMP', name: 'Importado', unit: 'kg', qty: 2, unitPrice: 3, priceCurrency: 'USD', priceRate: 0 }]
eq('insumo en divisa CON tasa: 2 x 3 USD x 320 = 1920 MN', inputsTotal(CON_TASA), 1920)
eq('insumo en divisa SIN tasa: no aporta importe inventado', inputsTotal(SIN_TASA), 0)
eq('insumo en divisa SIN tasa: sale senalado para que la pantalla bloquee',
  missingRateInputs(SIN_TASA).map((i) => i.code), ['IMP'])
eq('insumo en divisa CON tasa: no señala nada', missingRateInputs(CON_TASA), [])
eq('insumo en MN: nunca señala nada aunque no traiga tasa', missingRateInputs(INSUMOS), [])
eq('divisa igual a la base (MN) no se convierte',
  inputsTotal([{ code: 'A', qty: 2, unitPrice: 10, priceCurrency: 'MN', priceRate: 0 }]), 20)

// --- Ficha VACIA: cero NaN en cualquier fila (arranque de un borrador) -------
const VACIA = { productionLevel: 0, activity: FICHA_ACTIVITIES.BIENES, method: FICHA_METHODS.GASTOS }
const TV = totals(VACIA)
eq('ficha vacia: ninguna fila es NaN', Object.values(TV).every((v) => Number.isFinite(v)), true)
eq('ficha vacia: fila 12 en cero', TV.r12, 0)
const PV = priceRows(VACIA)
eq('ficha vacia: filas 13, 14 y 15 en cero (nivel de produccion 0 no divide)',
  [PV.r13, PV.r14, PV.r15], [0, 0, 0])
eq('ficha vacia: control A no explota', indirectCheck(VACIA).ok, true)
eq('ficha vacia: base de utilidad en cero', utilityBase(VACIA), 0)
eq('totales con listas ausentes no son NaN',
  [inputsTotal(undefined), carriersTotal(undefined), laborTotal(undefined), otherDirectTotal(undefined)], [0, 0, 0, 0])

// --- Basura en los campos: el dueño teclea, y a veces teclea cualquier cosa --
eq('texto en una cantidad no contamina el total',
  inputsTotal([{ qty: 'x', unitPrice: 100 }, { qty: 2, unitPrice: 50 }]), 100)
eq('negativos en salario no restan de la nomina',
  laborTotal([{ workers: -2, hourly: 100, extraHourly: 0, hours: 5 }]), 0)
eq('nivel de produccion negativo no da un unitario negativo',
  priceRows({ ...PAN, productionLevel: -200 }).r15, 0)

// --- Redondeo a 2, con el MISMO criterio que lib/currency.round2 -------------
eq('redondeo: 170,075 -> 170,08 (no 170,07)', priceRows(PAN).r15, 170.08)
eq('redondeo: importe de insumo 0,1 x 0,2 no arrastra binario',
  inputsTotal([{ qty: 0.1, unitPrice: 0.2 }]), 0.02)

console.log(`\n${pass} pass, ${fail} fail`)
if (fail > 0) process.exit(1)
