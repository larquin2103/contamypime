// Pruebas de LAS TRES HOJAS OFICIALES de la ficha de costo (Res. 148/2023 MFP).
// Sin framework: ejecutar con  `node src/features/reports/fichaReports.test.mjs`.
//
// Estos builders son PUROS a proposito (reciben la ficha ya cargada, no tocan
// Dexie), y es por esto: lo que imprimen es el documento con el que el dueño
// sostiene un precio ante un control. Es lo ultimo del modulo que puede fallar en
// silencio, porque nadie lee un PDF con una calculadora al lado.
//
// El fixture es el mismo "Pan suave" (200 u) de docs/FICHA-COSTO.md §5.1.
//
// LA ASERCION QUE MAS IMPORTA de este fichero: en los dos anexos, LA SUMA DE LO
// IMPRESO tiene que dar EL TOTAL IMPRESO. Es lo que mira un inspector, y es la
// razon por la que el motor redondea por linea y no al final (§5).
import { buildFichaSheet, buildInputsSheet, buildLaborSheet, FICHA_SHEETS } from './fichaReports.js'
import { FICHA_ACTIVITIES, FICHA_METHODS, FICHA_STATUS } from '../../lib/fichaCosto.js'

let pass = 0
let fail = 0
const eq = (name, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp)
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${ok ? '' : `  got=${JSON.stringify(got)} exp=${JSON.stringify(exp)}`}`)
  ok ? pass++ : fail++
}

const PAN = {
  id: 'a', groupId: 'a', version: 1, status: FICHA_STATUS.APROBADA,
  name: 'Pan suave', code: 'PAN-001', unit: 'u',
  productionLevel: 200, capacityPct: 78,
  activity: FICHA_ACTIVITIES.BIENES, method: FICHA_METHODS.GASTOS,
  inputs: [
    { code: 'HAR', name: 'Harina', unit: 'kg', qty: 25, unitPrice: 420, baseCost: 0 },
    { code: 'LEV', name: 'Levadura', unit: 'kg', qty: 0.5, unitPrice: 1800, baseCost: 0 },
    { code: 'ACE', name: 'Aceite', unit: 'l', qty: 1.5, unitPrice: 950, baseCost: 0 },
    { code: 'AZU', name: 'Azucar', unit: 'kg', qty: 2, unitPrice: 380, baseCost: 0 },
    { code: 'SAL', name: 'Sal', unit: 'kg', qty: 0.4, unitPrice: 150, baseCost: 0 }
  ],
  carriers: {
    fuel: { qty: 12, unitPrice: 100 },
    energy: { qty: 340, unitPrice: 2.5 },
    water: { qty: 8, unitPrice: 15 }
  },
  labor: [
    { operation: 'Amasado', workers: 2, category: 'Obrero', scaleGroup: 'IV', hourly: 350, extraHourly: 50, hours: 6, baseCost: 0 },
    { operation: 'Empaque', workers: 1, category: 'Obrero', scaleGroup: 'II', hourly: 300, extraHourly: 0, hours: 3, baseCost: 0 }
  ],
  otherDirect: [{ concept: 'Depreciacion', amount: 600 }, { concept: 'Mantenimiento', amount: 300 }],
  rows: { r4: 3200, r41: 1900, r6: 4100, r61: 2400, r7: 1600, r71: 700, r8: 250, r9: 0, taxSS: 0, taxFT: 0 },
  utilityPct: 25, correlationPrice: 0, refs: [],
  elaboratedBy: 'Ana Pérez · administradora', approvedBy: 'Juan Díaz · dueño',
  approvedAt: '2026-09-03T10:00:00.000Z'
}

// --- HOJA 1: la ficha y sus 16 filas ---------------------------------------
const F = buildFichaSheet({ sheet: PAN })
const filaDe = (n) => F.rows.find((r) => r[0] === n)
const nuevoDe = (n) => filaDe(n)[3]

eq('la hoja 1 tiene las cuatro columnas del modelo (Fila, Concepto, Base, Nuevo)',
  F.head.length, 4)
eq('y las 16 filas con sus subfilas: 23 lineas', F.rows.length, 23)
eq('Fila 1 = gasto material', nuevoDe('1'), 15815)
eq('Fila 1.1 = insumos', nuevoDe('1.1'), 13645)
eq('Filas 1.2, 1.3 y 1.4 = portadores', [nuevoDe('1.2'), nuevoDe('1.3'), nuevoDe('1.4')], [1200, 850, 120])
eq('Fila 2 = salario directo', nuevoDe('2'), 5700)
eq('Fila 3 = otros directos', nuevoDe('3'), 900)
eq('Fila 5 = COSTO TOTAL', nuevoDe('5'), 25615)
eq('Fila 11 = TOTAL DE GASTOS', nuevoDe('11'), 5950)
eq('Fila 12 = TOTAL DE COSTOS Y GASTOS (5+11, no 6+11)', nuevoDe('12'), 31565)
eq('y su concepto IMPRIME la formula, para que se pueda auditar',
  filaDe('12')[1], 'TOTAL DE COSTOS Y GASTOS (5 + 11)')
eq('Fila 13 = utilidad', nuevoDe('13'), 2450)
eq('Fila 14 = PRECIO O TARIFA', nuevoDe('14'), 34015)
eq('Fila 15 = PRECIO UNITARIO', nuevoDe('15'), 170.08)
eq('la Fila 16 es EXPLICATIVA: no lleva importe', filaDe('16')[2], '')
eq('la columna Costo Base va VACIA si no hay version anterior',
  F.rows.every((r) => r[2] === ''), true)
eq('ningun importe impreso es NaN',
  F.rows.every((r) => r[3] === '' || typeof r[3] === 'string' || Number.isFinite(r[3])), true)

// Con una version anterior, la columna Base SI se llena.
const V0 = { ...PAN, inputs: PAN.inputs.map((l) => ({ ...l, unitPrice: l.unitPrice * 0.9 })) }
const FREV = buildFichaSheet({ sheet: PAN, base: V0 })
eq('con version anterior, la Fila 1.1 base es la de ESA version', FREV.rows[1][2], 12280.5)
eq('y la nueva no cambia', FREV.rows[1][3], 13645)

// Encabezado y pie: cada hoja se sostiene sola (decision 5).
eq('la hoja lleva la identificacion del producto', F.header[0], 'Producto o servicio: Pan suave')
eq('con codigo y UM', F.header[1].includes('PAN-001') && F.header[1].includes('Unidad'), true)
eq('con nivel de produccion y capacidad',
  F.header[2].includes('200 u') && F.header[2].includes('78 %'), true)
eq('y con la version y el estado', F.header[4].includes('Versión 1') && F.header[4].includes('Aprobada'), true)
eq('el pie lleva las DOS firmas',
  [F.footer.some((l) => l.startsWith('Elaborado por: Ana')), F.footer.some((l) => l.startsWith('Aprobado por: Juan'))],
  [true, true])
eq('sin firma se imprime la raya, para firmar a mano',
  buildFichaSheet({ sheet: { ...PAN, elaboratedBy: '', approvedBy: '', approvedAt: null } })
    .footer.includes('Elaborado por: ____________________'), true)
// Las referencias (Fila 16) son las BASES del precio: van al pie, no en la tabla.
const CON_REFS = buildFichaSheet({
  sheet: { ...PAN, refs: [{ source: 'Factura 0412', price: 30000, note: 'bolsa de 200 u' }] }
})
eq('la Fila 16 cuenta las referencias', CON_REFS.rows[22][3], '1 referencia(s)')
eq('y el detalle de cada una va al pie',
  CON_REFS.footer.some((l) => l.includes('Factura 0412') && l.includes('bolsa de 200 u')), true)

// --- HOJA 2: anexo de insumos (7 columnas) ---------------------------------
const I = buildInputsSheet({ sheet: PAN })
eq('la hoja 2 tiene las SIETE columnas del anexo', I.head.length, 7)
eq('cinco insumos + TOTAL + los dos portadores fijos = 8 filas', I.rows.length, 8)
eq('la columna (7) de la harina: 25 x 420', I.rows[0][6], 10500)
eq('la (5) y la (6) se imprimen tal cual', [I.rows[0][4], I.rows[0][5]], [25, 420])
eq('el TOTAL INSUMOS es 13 645', I.rows[5][6], 13645)
// LA ASERCION DEL INSPECTOR: la suma de lo impreso da el total impreso.
eq('la suma de las columnas (7) impresas ES el TOTAL impreso',
  I.rows.slice(0, 5).reduce((a, r) => a + r[6], 0), I.rows[5][6])
eq('el anexo lleva las dos filas fijas de la norma, con su UM',
  [I.rows[6][1], I.rows[6][2], I.rows[7][1], I.rows[7][2]],
  ['Combustibles y lubricantes', 'LITROS', 'Energía eléctrica', 'kw'])
eq('y sus importes', [I.rows[6][6], I.rows[7][6]], [1200, 850])
eq('el anexo va VERTICAL (7 columnas caben)', I.orientation, 'portrait')
// Un insumo en divisa dice su moneda y su tasa CONGELADA, y su importe va en MN.
const USD = buildInputsSheet({
  sheet: { ...PAN, inputs: [{ code: 'X', name: 'Insumo', unit: 'u', qty: 2, unitPrice: 3, priceCurrency: 'USD', priceRate: 120 }] }
})
eq('un insumo en divisa declara moneda y tasa en el propio anexo',
  USD.rows[0][1], 'Insumo (precio en USD, tasa 120)')
eq('su precio unitario se imprime en SU moneda (columna 6)', USD.rows[0][5], 3)
eq('y su costo propuesto en la base: 2 x 3 x 120', USD.rows[0][6], 720)

// --- HOJA 3: anexo de salario (9 columnas) ---------------------------------
const S = buildLaborSheet({ sheet: PAN })
eq('la hoja 3 tiene las NUEVE columnas del anexo', S.head.length, 9)
eq('dos operaciones + TOTAL = 3 filas', S.rows.length, 3)
eq('la columna (9) del amasado: 2 x (350+50) x 6', S.rows[0][8], 4800)
eq('la del empaque: 1 x (300+0) x 3', S.rows[1][8], 900)
eq('el TOTAL es la Fila 2 de la ficha', S.rows[2][8], 5700)
eq('la suma de las columnas (9) impresas ES el TOTAL impreso',
  S.rows.slice(0, 2).reduce((a, r) => a + r[8], 0), S.rows[2][8])
eq('se imprimen categoria y grupo escala, que la norma pide',
  [S.rows[0][3], S.rows[0][4]], ['Obrero', 'IV'])
eq('nueve columnas NO caben en vertical: la hoja va horizontal', S.orientation, 'landscape')
eq('y lleva la nota del Decreto 53, que vive solo en este anexo',
  S.header.some((l) => l.includes('Decreto 53')), true)

// --- Las tres hojas, y lo que no puede faltar en ninguna --------------------
eq('son TRES hojas', FICHA_SHEETS.length, 3)
for (const h of FICHA_SHEETS) {
  const r = h.build({ sheet: PAN })
  eq(`"${h.label}": tiene titulo, columnas, filas y nombre de fichero`,
    [!!r.title, r.head.length > 0, r.rows.length > 0, !!r.filename], [true, true, true, true])
  eq(`"${h.label}": se sostiene sola (encabezado de identificacion y pie de firmas)`,
    [r.header.length > 0, r.footer.length > 0], [true, true])
  eq(`"${h.label}": el nombre del fichero no lleva acentos ni espacios`,
    /^[a-z0-9-]+$/.test(r.filename), true)
}

// Una ficha vacia no puede reventar el exportador ni imprimir NaN.
const VACIA = { rows: {}, inputs: [], labor: [], otherDirect: [], carriers: {}, refs: [] }
for (const h of FICHA_SHEETS) {
  const r = h.build({ sheet: VACIA })
  eq(`"${h.label}": una ficha vacia no imprime NaN`,
    r.rows.flat().every((c) => typeof c === 'string' || Number.isFinite(c)), true)
}

console.log(`\n${pass} pass, ${fail} fail`)
if (fail > 0) process.exit(1)
