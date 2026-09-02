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
  round2,
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
  utilityRate,
  priceRows,
  subsidyWarning,
  fichaWarnings,
  FICHA_STATUS,
  canEditSheet,
  canApproveSheet,
  canReviseSheet,
  canDeleteSheet,
  nextVersion,
  inputLineFor,
  recipeToInputs,
  emptyLaborOp,
  splitLaborOp
} from './fichaCosto.js'
import { FICHA_ACTIVITY_LABELS, FICHA_METHOD_LABELS, FICHA_STATUS_LABELS } from '../db/constants.js'
import { LICENSE_MODULES, LICENSE_MODULE_LABELS } from './license.js'

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
// Con 6+11 la fila 6 se contaria dos veces y las filas 1-4 desaparecerian del
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
eq('control A: con nomina el control SI opina', A.applies, true)

// Sin salario directo (fila 2 = 0) el limite saldria 0 y CUALQUIER indirecto lo
// excederia: una comercializacion donde el dueño trabaja el mismo quedaria en
// ambar permanente y el semaforo se volveria ruido. Decision del dueño
// 01-09-2026: el control NO OPINA. No se inventa un limite ni se pinta un ambar
// que no significa nada; el coeficiente es INDEFINIDO (null), que no es cero.
const SIN_NOMINA = indirectCheck({ ...PAN, labor: [] })
eq('control A sin nomina: el control no opina', SIN_NOMINA.applies, false)
eq('control A sin nomina: no se inventa un limite', SIN_NOMINA.limit, 0)
eq('control A sin nomina: coeficiente INDEFINIDO, que no es cero', SIN_NOMINA.coefficient, null)
eq('control A sin nomina: no se pinta exceso', SIN_NOMINA.excess, 0)
eq('control A sin nomina: no se pinta rojo', SIN_NOMINA.ok, true)
eq('control A sin nomina: la suma de indirectos SI se sigue mostrando', SIN_NOMINA.sum, 8900)

// --- Filas capturadas: cada una tiene su asercion (el §5 pide "cada fila") ---
eq('filas capturadas 6, 6.1, 7, 7.1, 8 y 9 llegan intactas',
  [T.r6, T.r61, T.r7, T.r71, T.r8, T.r9], [4100, 2400, 1600, 700, 250, 0])

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

// --- Tasa de utilidad ESCRIBIBLE (decision del dueño 01-09-2026) ------------
// El Anexo II fija tasas MAXIMAS y para una MYPIME son referencia, no obligacion
// (Art. 6). La ficha nace con el maximo de su actividad, asi que sin tocar nada
// se comporta igual que antes; pero el dueño puede poner la SUYA.
// CONVENCION DE UNIDADES: los campos que acaban en `Pct` van en PORCENTAJE
// (utilityPct: 25 = 25%, igual que capacityPct: 78); los tipos tributarios
// taxSS/taxFT van en FRACCION (0,125 = 12,5%). No mezclarlas.
eq('sin utilityPct: se usa el maximo de la actividad (compatibilidad exacta)', priceRows(PAN).r13, 2450)
eq('utilityPct 15 -> 15% de la base 9800', priceRows({ ...PAN, utilityPct: 15 }).r13, 1470)
eq('utilityPct 15: el precio unitario baja en consecuencia',
  priceRows({ ...PAN, utilityPct: 15 }).r15, 165.18)
eq('utilityPct 0 es una tasa valida (vender al costo a proposito), no "sin dato"',
  priceRows({ ...PAN, utilityPct: 0 }).r13, 0)
eq('utilityRate devuelve FRACCION aunque utilityPct sea porcentaje',
  utilityRate({ ...PAN, utilityPct: 25 }), 0.25)
eq('utilityRate sin utilityPct cae en el maximo del Anexo II', utilityRate(PAN), 0.25)
eq('utilityPct por encima del maximo NO se recorta (Art. 6: aviso, no cerrojo)',
  priceRows({ ...PAN, utilityPct: 30 }).r13, 2940)

// --- Actividad desconocida o vacia: NO se regala la ganancia en silencio -----
// Antes devolvia tasa 0 y la ficha entregaba un precio igual al costo sin avisar.
// En un sistema que existe para fijar precios ese es el peor resultado posible.
eq('actividad desconocida: la tasa maxima es INDEFINIDA, no cero', maxUtility(undefined), null)
eq('actividad inventada: tambien indefinida', maxUtility('loQueSea'), null)
eq('actividad desconocida: utilityRate tambien indefinida', utilityRate({ ...PAN, activity: undefined }), null)
eq('actividad desconocida: la utilidad NO se calcula (no se inventa un 0 legitimo)',
  priceRows({ ...PAN, activity: undefined }).r13, 0)
eq('actividad desconocida: sale AVISADA, que es lo que faltaba',
  fichaWarnings({ ...PAN, activity: undefined }).map((w) => w.code).includes('actividad-desconocida'), true)
eq('actividad conocida: no avisa de eso',
  fichaWarnings(PAN).map((w) => w.code).includes('actividad-desconocida'), false)

// --- Correlacion sin precio capturado: un campo en blanco NO es un subsidio --
// OJO: estas fichas llevan r4 = 2000 en vez de 3200 a proposito. El fixture "Pan
// suave" YA excede el coeficiente de indirectos, asi que con su r4 original cada
// una de estas listas traeria ademas el aviso de indirectos y la asercion no
// estaria mirando lo que dice mirar.
const CORR_VACIA = { ...PAN, method: FICHA_METHODS.CORRELACION, rows: { ...FILAS, r4: 2000 } }
eq('correlacion sin precio: filas 13, 14 y 15 en cero, no en -31565',
  [priceRows(CORR_VACIA).r13, priceRows(CORR_VACIA).r14, priceRows(CORR_VACIA).r15], [0, 0, 0])
eq('correlacion sin precio: NO se pinta el aviso rojo de subsidio', subsidyWarning(CORR_VACIA), false)
eq('correlacion sin precio: se avisa de que falta el precio, que es lo cierto',
  fichaWarnings(CORR_VACIA).map((w) => w.code), ['correlacion-sin-precio'])
eq('correlacion CON precio por debajo del costo: ahi si es subsidio', subsidyWarning(CORR), true)

// --- fichaWarnings: una sola fuente para los semaforos de los bloques 5 y 7 --
eq('ficha limpia dentro de limites: sin avisos',
  fichaWarnings({ ...PAN, rows: { ...FILAS, r4: 2000 } }).map((w) => w.code), [])
eq('el fixture Pan suave avisa de indirectos, con el exceso en IMPORTE',
  fichaWarnings(PAN).map((w) => [w.code, w.excess ?? null]), [['indirectos-exceden', 350]])
// Con el fixture REAL (r4 = 3200) salen DOS avisos, y en orden estable: primero
// el de indirectos (bloque 5) y despues el de utilidad (bloque 7), que es el
// orden en que el dueño recorre la ficha.
eq('tasa 30% sobre el maximo 25%: dos avisos, en orden, con sus importes',
  fichaWarnings({ ...PAN, utilityPct: 30 }).map((w) => [w.code, w.excess]),
  [['indirectos-exceden', 350], ['utilidad-sobre-maximo', 490]])
eq('el exceso de utilidad es 9800 x (30% - 25%) = 490, en IMPORTE y no en puntos',
  fichaWarnings({ ...PAN, utilityPct: 30 }).find((w) => w.code === 'utilidad-sobre-maximo').excess, 490)
eq('insumo en divisa sin tasa: tambien entra en la lista de avisos',
  fichaWarnings({ ...PAN, inputs: SIN_TASA, rows: { ...FILAS, r4: 2000 } })
    .map((w) => w.code), ['insumo-sin-tasa'])
eq('subsidio: entra en la lista con su importe canonico, detras del de indirectos',
  fichaWarnings(CORR).map((w) => [w.code, w.amount ?? null]),
  [['indirectos-exceden', null], ['subsidio', -3565]])
eq('por correlacion NO se avisa de "utilidad sobre el maximo": ahi la utilidad se DERIVA',
  fichaWarnings({ ...CORR, utilityPct: 99 }).map((w) => w.code),
  ['indirectos-exceden', 'subsidio'])
eq('ficha vacia: no se avisa de nada (un borrador recien abierto no esta mal)',
  fichaWarnings(VACIA).map((w) => w.code), [])

// --- round2 nunca devuelve -0 (guarda copiada de productCustodyMath.cleanQty)
eq('round2 no devuelve -0 (imprimiria "-0,00" en la ficha)', Object.is(round2(-0.0000001), 0), true)

// --- F2: ciclo de vida de la ficha (append-only, nada se borra) --------------
// Las guardas del repo viven aqui, PURAS, por el mismo motivo que las reglas de
// `lib/remesas.js`: son las que hay que poder probar con node, porque el repo
// habla con Dexie y no se puede correr sin indexedDB.
const borrador = (extra = {}) => ({ id: 'F1', status: FICHA_STATUS.BORRADOR, version: 1, ...extra })
const aprobada = (extra = {}) => ({ id: 'F1', status: FICHA_STATUS.APROBADA, version: 1, ...extra })
const sustituida = (extra = {}) => ({ id: 'F1', status: FICHA_STATUS.SUSTITUIDA, version: 1, ...extra })

eq('un borrador se edita en sitio', canEditSheet(borrador()), true)
eq('una ficha APROBADA es inmutable: corregirla es una revision nueva', canEditSheet(aprobada()), false)
eq('una sustituida tampoco se edita', canEditSheet(sustituida()), false)
eq('una eliminada no se edita', canEditSheet(borrador({ deletedAt: '2026-09-01T10:00:00.000Z' })), false)
eq('sin ficha no se edita nada', canEditSheet(null), false)

eq('solo un borrador se puede aprobar', canApproveSheet(borrador()), true)
eq('una aprobada no se re-aprueba', canApproveSheet(aprobada()), false)
eq('una eliminada no se aprueba', canApproveSheet(borrador({ deletedAt: '2026-09-01T10:00:00.000Z' })), false)

eq('solo desde una APROBADA nace una revision', canReviseSheet(aprobada()), true)
eq('un borrador no se revisa: se edita', canReviseSheet(borrador()), false)
// Una sustituida YA tiene sucesora. Revisarla otra vez abriria una segunda rama
// del mismo groupId y habria dos "ultimas versiones" del mismo documento.
eq('una sustituida NO se revisa otra vez (abriria una bifurcacion)', canReviseSheet(sustituida()), false)
eq('una eliminada no se revisa', canReviseSheet(aprobada({ deletedAt: '2026-09-01T10:00:00.000Z' })), false)

eq('lo no eliminado se puede eliminar (borrado LOGICO)', canDeleteSheet(aprobada()), true)
eq('lo ya eliminado no se vuelve a eliminar', canDeleteSheet(borrador({ deletedAt: '2026-09-01T10:00:00.000Z' })), false)

eq('la revision siguiente sube la version', nextVersion(aprobada({ version: 1 })), 2)
eq('y sigue subiendo en la tercera', nextVersion(aprobada({ version: 2 })), 3)
eq('una ficha vieja sin version se trata como la 1', nextVersion({}), 2)

// --- F2: las etiquetas cubren EXACTAMENTE lo que el motor conoce -------------
// Esta es la asercion que hace imposible la deriva: si mañana se añade una
// actividad al motor y nadie le pone etiqueta, la suite se cae aqui en vez de
// que la pantalla pinte "altaTecnologia" en crudo delante del dueño.
const cubre = (labels, enumObj) => {
  const vals = Object.values(enumObj).sort()
  const keys = Object.keys(labels).sort()
  return JSON.stringify(vals) === JSON.stringify(keys)
}
eq('cada actividad del Anexo II tiene su etiqueta, y no sobra ninguna',
  cubre(FICHA_ACTIVITY_LABELS, FICHA_ACTIVITIES), true)
eq('cada metodo tiene su etiqueta', cubre(FICHA_METHOD_LABELS, FICHA_METHODS), true)
eq('cada estado tiene su etiqueta', cubre(FICHA_STATUS_LABELS, FICHA_STATUS), true)
eq('ninguna etiqueta esta vacia',
  [...Object.values(FICHA_ACTIVITY_LABELS), ...Object.values(FICHA_METHOD_LABELS), ...Object.values(FICHA_STATUS_LABELS)]
    .every((s) => typeof s === 'string' && s.trim().length > 0), true)

// --- F3: el modulo de licencia esta declarado y etiquetado ------------------
eq('el modulo se llama "fichas" (es lo que viaja FIRMADO en la licencia)',
  LICENSE_MODULES.COSTSHEETS, 'fichas')
eq('y tiene su etiqueta en español', LICENSE_MODULE_LABELS.fichas, 'Fichas de costo')
// Settings.jsx:328 pinta `LICENSE_MODULE_LABELS[m] || m`: un modulo sin etiqueta
// se le enseña al dueño con la CLAVE en crudo. Esta guarda vale para los nueve.
eq('TODOS los modulos de licencia tienen etiqueta (si no, Ajustes pinta la clave cruda)',
  Object.values(LICENSE_MODULES).filter((m) => !LICENSE_MODULE_LABELS[m]), [])

// --- F5: traer insumos desde una receta (la ESCALA vale x nivel) ------------
// La trampa D del modulo, y la mas cara despues de la base de la utilidad:
// `recipes.items[].qty` es el consumo de UNA unidad del elaborado, mientras que
// la columna (5) del anexo es el consumo del NIVEL COMPLETO. Estas aserciones
// existen para que nadie vuelva a derivarlo al reves: con el fixture "Pan suave"
// (200 u) la harina de la receta (0,125 kg por pan) tiene que salir 25 kg.
const CAT = new Map([
  ['p-har', { id: 'p-har', code: 'HAR', name: 'Harina', unit: 'kg', cost: 420 }],
  ['p-lev', { id: 'p-lev', code: 'LEV', name: 'Levadura', unit: 'kg', cost: 1800 }],
  ['p-usd', { id: 'p-usd', code: 'USD', name: 'Insumo en divisa', unit: 'u', cost: 3, priceCurrency: 'USD' }]
])
const RECETA_PAN = [{ productId: 'p-har', qty: 0.125 }, { productId: 'p-lev', qty: 0.0025 }]

const impPan = recipeToInputs({ items: RECETA_PAN, productById: CAT, level: 200 })
eq('la receta se multiplica por el nivel: 0,125 kg/pan x 200 = 25 kg', impPan.lines[0].qty, 25)
eq('y la levadura del fixture: 0,0025 x 200 = 0,5 kg', impPan.lines[1].qty, 0.5)
eq('el importe de esas dos lineas es el del fixture (10 500 + 900)', inputsTotal(impPan.lines), 11400)
eq('el precio unitario nace del costo del producto, CONGELADO', impPan.lines[0].unitPrice, 420)
eq('sin nivel de produccion NO se inventa una escala: se devuelve el motivo',
  recipeToInputs({ items: RECETA_PAN, productById: CAT, level: 0 }),
  { lines: [], repeated: 0, missing: 0, missingRate: [], error: 'sin-nivel' })
eq('la cantidad escalada se limpia a la milesima (0,003 x 200 no es 0.6000000000000001)',
  recipeToInputs({ items: [{ productId: 'p-har', qty: 0.003 }], productById: CAT, level: 200 }).lines[0].qty, 0.6)
eq('un insumo que ya no esta en el catalogo se cuenta, no se cuela',
  recipeToInputs({ items: [{ productId: 'fantasma', qty: 1 }], productById: CAT, level: 10 }),
  { lines: [], repeated: 0, missing: 1, missingRate: [], error: null })
eq('un insumo ya capturado en la ficha no se duplica',
  recipeToInputs({ items: RECETA_PAN, productById: CAT, usedIds: new Set(['p-har']), level: 200 }).repeated, 1)

// Insumo en divisa: con tasa se congela el par; sin tasa NO se trae (valdria 0).
const impUsd = recipeToInputs({
  items: [{ productId: 'p-usd', qty: 2 }], productById: CAT, level: 10, rateOf: () => 120
})
eq('insumo en divisa CON tasa: se congela moneda y tasa en la linea',
  [impUsd.lines[0].priceCurrency, impUsd.lines[0].priceRate], ['USD', 120])
eq('y su importe usa la tasa congelada: 20 u x 3 USD x 120', inputsTotal(impUsd.lines), 7200)
const impSinTasa = recipeToInputs({ items: [{ productId: 'p-usd', qty: 2 }], productById: CAT, level: 10 })
eq('insumo en divisa SIN tasa: NO se trae, y se dice cual', impSinTasa.missingRate, ['Insumo en divisa'])
eq('lo que no se trae no deja linea suelta', impSinTasa.lines, [])

// Linea traida a mano (sin receta): la norma de consumo la escribe el dueño.
eq('linea del catalogo a mano: norma en cero y forma completa',
  inputLineFor(CAT.get('p-har')),
  { productId: 'p-har', code: 'HAR', name: 'Harina', unit: 'kg', baseCost: 0, qty: 0, unitPrice: 420, priceCurrency: null, priceRate: 0 })
eq('un producto sin unidad cae a "u", nunca a vacio', inputLineFor({ id: 'x' }).unit, 'u')

// --- F6: partir una operacion del anexo de salario (§2.8) -------------------
// La norma obliga a filas INDEPENDIENTES cuando cambia la norma de tiempo o el
// grupo escala. La trampa: la lectura ingenua de "duplicar" copia tambien las
// horas, y entonces la Fila 2 se DOBLA en silencio. Esta es la asercion que lo
// impide, y la razon por la que la regla no vive en la pantalla.
const PARTIDO = splitLaborOp(SALARIO, 0)
eq('partir la operacion 1 NO mueve la Fila 2 (5 700, no 10 500)', laborTotal(PARTIDO), 5700)
eq('la copia se inserta PEGADA a su original', PARTIDO.map((o) => o.operation),
  ['Amasado', 'Amasado', 'Empaque'])
eq('la copia nace SIN norma de tiempo (es lo que va a cambiar)', PARTIDO[1].hours, '')
eq('y por eso aporta cero hasta que se escriba', laborTotal([PARTIDO[1]]), 0)
eq('la copia NO arrastra el Costo Base de la columna (2): es uno, no dos',
  PARTIDO[1].baseCost, 0)
eq('el original queda intacto', laborTotal([PARTIDO[0]]), 4800)
eq('partir no muta la lista original (append-only en memoria)', SALARIO.length, 2)
eq('partir por un indice que no existe no inventa filas', splitLaborOp(SALARIO, 9).length, 2)
eq('partir sobre una lista vacia no revienta', splitLaborOp([], 0), [])
eq('partir sobre algo que no es lista tampoco', splitLaborOp(null, 0), [])
// El grupo escala SI se conserva: partir por tiempo no debe obligar a reteclearlo.
const CON_GRUPO = splitLaborOp([{ operation: 'Amasado', workers: 2, hourly: 350, extraHourly: 50, hours: 6, scaleGroup: 'IV' }], 0)
eq('la copia conserva el grupo escala', CON_GRUPO[1].scaleGroup, 'IV')

// Operacion en blanco: la MISMA forma que normaliza `cleanLabor` en el repo.
eq('la operacion en blanco trae las ocho columnas capturables',
  Object.keys(emptyLaborOp()).sort(),
  ['baseCost', 'category', 'extraHourly', 'hourly', 'hours', 'operation', 'scaleGroup', 'workers'])
eq('y vale cero, sin NaN', laborTotal([emptyLaborOp()]), 0)
eq('sus numericos nacen VACIOS, no en cero (un cero tecleado dice otra cosa)',
  [emptyLaborOp().workers, emptyLaborOp().hours], ['', ''])

// --- F6: lo que de verdad llega del formulario son CADENAS -------------------
// El bloque 3 guarda texto (el repo normaliza al escribir), asi que el importe
// por tarjeta se calcula sobre cadenas mientras se teclea. Sin esto, un cambio en
// `pos()` podria dejar la pantalla en NaN sin que ninguna asercion se enterara.
const TECLEADO = [
  { operation: 'Amasado', workers: '2', hourly: '350', extraHourly: '50', hours: '6' },
  { operation: 'Empaque', workers: '1', hourly: '300', extraHourly: '', hours: '3' }
]
eq('tarjeta con valores de TEXTO: 2x(350+50)x6', laborTotal([TECLEADO[0]]), 4800)
eq('adicional VACIO cuenta como cero: 1x(300+0)x3', laborTotal([TECLEADO[1]]), 900)
eq('la suma de las tarjetas cuadra con el pie del bloque',
  TECLEADO.reduce((acc, o) => acc + laborTotal([o]), 0), laborTotal(TECLEADO))
eq('texto no numerico vale 0, nunca NaN', laborTotal([{ workers: 'dos', hourly: 'x', hours: 'y' }]), 0)
eq('un adicional negativo no rebaja el salario/hora',
  laborTotal([{ workers: '1', hourly: '300', extraHourly: '-100', hours: '1' }]), 300)
// Redondeo POR LINEA: dos lineas de 0,005 dan 0,02 en pantalla Y 0,02 de total.
// Sumar en crudo y redondear al final daria 0,01 y el anexo no cuadraria consigo.
const MENUDO = [{ workers: 1, hourly: 0.005, hours: 1 }, { workers: 1, hourly: 0.005, hours: 1 }]
eq('el total cuadra con la suma de lo IMPRESO, no con la suma en crudo',
  laborTotal(MENUDO), MENUDO.reduce((acc, o) => acc + laborTotal([o]), 0))

console.log(`\n${pass} pass, ${fail} fail`)
if (fail > 0) process.exit(1)
