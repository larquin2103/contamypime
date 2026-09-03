// Los imports llevan la EXTENSION `.js`, al reves que el resto del proyecto. No
// es un descuido: node exige la extension en ESM y Vite la acepta igual, y sin
// ella este fichero no se podria correr con `node` -que es justo lo que permite
// probar el documento oficial-. Los cuatro modulos que importa no tienen a su vez
// ningun import, asi que la cadena entera es ejecutable fuera del navegador.
import { round2 } from '../../lib/currency.js'
import { formatDateTime } from '../../lib/dates.js'
import { totals, priceRows, inputsTotal, laborTotal, carrierAmount } from '../../lib/fichaCosto.js'
import {
  UNIT_LABELS,
  FICHA_ACTIVITY_LABELS,
  FICHA_METHOD_LABELS,
  FICHA_STATUS_LABELS
} from '../../db/constants.js'

// Modulo 'fichas' (F9) - Las TRES HOJAS OFICIALES de la Res. 148/2023 MFP.
//
// Vive en su PROPIO fichero, como `remesasReports.js`, para no tocar los ~20
// builders de `reportsService.js`. De alli solo se reusan `exportExcel` y
// `exportPdf`, a las que F9 añade dos campos OPCIONALES (`header` y `footer`)
// para el encabezado de identificacion y el pie de firmas que la norma pide en
// cada hoja. Los reportes existentes no los pasan y su salida queda IDENTICA.
//
// A DIFERENCIA de todos los demas builders del proyecto, estos son PUROS: reciben
// la ficha ya cargada (la pantalla la tiene en memoria) y no tocan Dexie. Eso no
// es un capricho: permite probarlos con node, y lo que imprimen es EL DOCUMENTO
// OFICIAL con el que el dueño sostiene un precio ante un control. Es lo ultimo
// que puede fallar en silencio.
//
// Cada hoja se sostiene SOLA (decision 5 del dueño): encabezado de
// identificacion, cuerpo y pie de firmas. No hay un PDF unico con los tres
// anexos, porque cada uno se presenta por separado.
//
// Los importes van como NUMEROS, no como texto, igual que en el resto de los
// reportes: asi Excel los suma.

const num = (v) => Number(v) || 0
const money = (v) => round2(num(v))

// Identificacion, comun a las tres hojas. El Anexo I la pide en su encabezado y
// las decisiones del dueño la repiten en cada hoja para que ninguna dependa de
// las otras.
function idHeader(sheet) {
  const um = UNIT_LABELS[sheet?.unit] || sheet?.unit || 'u'
  return [
    `Producto o servicio: ${sheet?.name || '—'}`,
    `Código: ${sheet?.code || '—'}   ·   UM: ${um}`,
    `Nivel de producción: ${num(sheet?.productionLevel)} ${sheet?.unit || 'u'}   ·   ` +
      `Utilización de la capacidad: ${num(sheet?.capacityPct)} %`,
    `Actividad: ${FICHA_ACTIVITY_LABELS[sheet?.activity] || '—'}   ·   ` +
      `Método: ${FICHA_METHOD_LABELS[sheet?.method] || '—'}`,
    `Versión ${num(sheet?.version) || 1}   ·   ${FICHA_STATUS_LABELS[sheet?.status] || sheet?.status || '—'}`
  ]
}

// Pie de firmas. Los dos anexos que el Art. 5 obliga a desagregar lo llevan con
// cargo; la ficha lo lleva por la decision 5 (cada hoja se sostiene sola). Si no
// hay firma se deja la raya: es un documento que se imprime y se firma a mano.
function signFooter(sheet) {
  const raya = '____________________'
  const out = [
    '',
    `Elaborado por: ${sheet?.elaboratedBy || raya}`,
    `Aprobado por: ${sheet?.approvedBy || raya}`
  ]
  if (sheet?.approvedAt) out.push(`Aprobada el ${formatDateTime(sheet.approvedAt)}`)
  return out
}

// Trozo de nombre de fichero, sin acentos ni espacios.
function slug(sheet) {
  const base = (sheet?.code || sheet?.name || 'ficha').toString()
  return base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'ficha'
}

// --- HOJA 1: la ficha, sus 16 filas y sus DOS columnas de valores -----------
// "Costo Base" es la columna de la version anterior: solo tiene numeros cuando la
// ficha es una revision. La columna existe SIEMPRE porque es una de las dos del
// modelo oficial; vacia dice "no hay con que comparar", que es la verdad.
export function buildFichaSheet({ sheet, base = null, baseCurrency = 'MN' } = {}) {
  const t = totals(sheet)
  const p = priceRows(sheet)
  const tb = base ? totals(base) : null
  const pb = base ? priceRows(base) : null

  // Cada fila: [numero, concepto, valor en la base, valor nuevo].
  const fila = (n, concepto, vBase, vNuevo) => [n, concepto, vBase === null ? '' : money(vBase), money(vNuevo)]

  const rows = [
    fila('1', 'Gasto material (1.1 + 1.2 + 1.3 + 1.4)', tb && tb.r1, t.r1),
    fila('1.1', 'Insumos', tb && tb.r1_1, t.r1_1),
    fila('1.2', 'Combustibles y lubricantes', tb && tb.r1_2, t.r1_2),
    fila('1.3', 'Energía eléctrica', tb && tb.r1_3, t.r1_3),
    fila('1.4', 'Agua', tb && tb.r1_4, t.r1_4),
    fila('2', 'Salario directo (incluye vacaciones)', tb && tb.r2, t.r2),
    fila('3', 'Otros gastos directos', tb && tb.r3, t.r3),
    fila('4', 'Gastos asociados a la producción', tb && tb.r4, t.r4),
    fila('4.1', 'De ello, salarios', tb && tb.r41, t.r41),
    fila('5', 'COSTO TOTAL (1 + 2 + 3 + 4)', tb && tb.r5, t.r5),
    fila('6', 'Gastos generales y de administración', tb && tb.r6, t.r6),
    fila('6.1', 'De ello, salarios', tb && tb.r61, t.r61),
    fila('7', 'Gastos de distribución y venta', tb && tb.r7, t.r7),
    fila('7.1', 'De ello, salarios', tb && tb.r71, t.r71),
    fila('8', 'Gastos financieros', tb && tb.r8, t.r8),
    fila('9', 'Financiamiento a la OSDE', tb && tb.r9, t.r9),
    fila('10', 'Gastos tributarios', tb && tb.r10, t.r10),
    fila('11', 'TOTAL DE GASTOS (6 + 7 + 8 + 9 + 10)', tb && tb.r11, t.r11),
    // La Gaceta tiene una errata: el cuerpo dice "6+11" y el modelo del Anexo I
    // rotula "(5+11)". Se imprime 5 + 11, que es la unica lectura coherente.
    fila('12', 'TOTAL DE COSTOS Y GASTOS (5 + 11)', tb && tb.r12, t.r12),
    fila('13', 'Utilidad', pb && pb.r13, p.r13),
    fila('14', 'PRECIO O TARIFA (12 + 13)', pb && pb.r14, p.r14),
    fila('15', 'Precio o tarifa unitario (14 ÷ nivel de producción)', pb && pb.r15, p.r15),
    // La 16 es EXPLICATIVA: no lleva importe. Su contenido va en el pie.
    ['16', 'Datos sobre precios de referencia', '', `${(sheet?.refs || []).length} referencia(s)`]
  ]

  // Las referencias declaradas van al pie: son las BASES del precio, que el
  // Apartado Segundo obliga a mostrar, y no caben en una fila de dos columnas.
  const refs = (sheet?.refs || [])
    .filter((r) => (r.source || '').trim() || num(r.price) || (r.note || '').trim())
    .map((r) => `   · ${r.source || 'sin fuente'}${r.note ? ` — ${r.note}` : ''}` +
      (num(r.price) ? ` — ${money(r.price)} ${baseCurrency}` : ''))

  return {
    title: 'Ficha de costos y gastos',
    subtitle: `Res. 148/2023 MFP · ${sheet?.name || ''}`,
    head: ['Fila', 'Concepto', `Costo Base (${baseCurrency})`, `Costo Nuevo (${baseCurrency})`],
    rows,
    filename: `ficha-costo-${slug(sheet)}`,
    orientation: 'portrait',
    header: idHeader(sheet),
    footer: [
      ...(refs.length ? ['', 'Precios de referencia (Fila 16):', ...refs] : []),
      ...signFooter(sheet)
    ]
  }
}

// --- HOJA 2: anexo "Desagregacion de los insumos fundamentales" (7 columnas) --
// (1) Codigo (2) Productos (3) UM (4) Costo Base (5) Norma de consumo
// (6) Precio unitario (7) Costo propuesto = 5 x 6.
//
// El modelo del anexo lleva al pie DOS filas fijas: combustibles y lubricantes
// (en litros) y energia electrica (en kw). El AGUA no esta en este anexo -si en
// la Fila 1.4 de la ficha-, y se respeta el modelo: no se inventan filas.
export function buildInputsSheet({ sheet, baseCurrency = 'MN' } = {}) {
  const lineas = sheet?.inputs || []
  const c = sheet?.carriers || {}

  const rows = lineas.map((l) => {
    const foreign = !!(l.priceCurrency && l.priceCurrency !== baseCurrency)
    return [
      l.code || '',
      `${l.name || ''}${foreign ? ` (precio en ${l.priceCurrency}, tasa ${num(l.priceRate)})` : ''}`,
      l.unit || 'u',
      // Columna (4): la rellena `reviseFrom` al crear una revision. VACIA si no la
      // hay, nunca 0: para un inspector "el costo base era cero" no es lo mismo
      // que "no hay costo base". Es el mismo criterio que la hoja 1.
      l.baseCost ? money(l.baseCost) : '',
      num(l.qty), // (5) norma de consumo, para el NIVEL DE PRODUCCION completo
      num(l.unitPrice), // (6) el monto que se paga al suministrador, en su moneda
      // (7) se pide al MOTOR linea a linea: el redondeo por linea es el que hace
      // que el Total cuadre con la suma de lo impreso, que es lo que mira un
      // inspector. Va en la moneda base, convertido con la tasa CONGELADA.
      inputsTotal([l])
    ]
  })

  rows.push(['', 'TOTAL INSUMOS', '', '', '', '', inputsTotal(lineas)])
  // El importe se le pide al MOTOR (`carrierAmount`), no se recalcula: es el
  // mismo numero que la hoja 1 imprime en las Filas 1.2 y 1.3, y recalcularlo
  // aqui con `Number` en vez de con el `pos` del motor las habria puesto en
  // desacuerdo ante una cantidad negativa.
  rows.push(['', 'Combustibles y lubricantes', 'LITROS', '', num(c.fuel?.qty), num(c.fuel?.unitPrice),
    carrierAmount(c.fuel)])
  rows.push(['', 'Energía eléctrica', 'kw', '', num(c.energy?.qty), num(c.energy?.unitPrice),
    carrierAmount(c.energy)])

  return {
    title: 'Desagregación de los insumos fundamentales',
    subtitle: `Res. 148/2023 MFP · ${sheet?.name || ''}`,
    head: [
      'Código', 'Productos', 'UM', `Costo Base (${baseCurrency})`,
      'Norma de consumo', 'Precio unitario', `Costo propuesto (${baseCurrency})`
    ],
    rows,
    filename: `anexo-insumos-${slug(sheet)}`,
    orientation: 'portrait',
    header: idHeader(sheet),
    footer: signFooter(sheet)
  }
}

// --- HOJA 3: anexo "Gasto de salario de los obreros" (9 columnas) ------------
// (1) Operacion (2) Gasto del Costo Base (3) Trabajadores (4) Categoria
// ocupacional (5) Grupo escala (6) Salario/hora (7) Pagos adicionales por hora
// (8) Norma de tiempo en horas (9) Gasto = 3 x (6 + 7) x 8.
// Nueve columnas no caben en vertical: esta hoja va HORIZONTAL.
export function buildLaborSheet({ sheet, baseCurrency = 'MN' } = {}) {
  const ops = sheet?.labor || []

  const rows = ops.map((o) => [
    o.operation || '',
    o.baseCost ? money(o.baseCost) : '', // (2) vacia si no hay revision, nunca 0
    num(o.workers),
    o.category || '',
    o.scaleGroup || '',
    num(o.hourly),
    num(o.extraHourly),
    num(o.hours),
    laborTotal([o]) // (9) al motor, linea a linea, por el mismo motivo que la (7)
  ])

  rows.push(['TOTAL', '', '', '', '', '', '', '', laborTotal(ops)])

  return {
    title: 'Gasto de salario de los obreros',
    subtitle: `Res. 148/2023 MFP · ${sheet?.name || ''}`,
    head: [
      'Operación', `Gasto del Costo Base (${baseCurrency})`, 'Trabajadores',
      'Categoría ocupacional', 'Grupo escala', `Salario/hora (${baseCurrency})`,
      `Pagos adicionales/hora (${baseCurrency})`, 'Norma de tiempo (h)', `Gasto (${baseCurrency})`
    ],
    rows,
    filename: `anexo-salario-${slug(sheet)}`,
    orientation: 'landscape',
    header: [
      ...idHeader(sheet),
      // Nota de la norma que vive en este anexo y en ningun otro sitio.
      'Los precios no se pueden incrementar por motivo de la aplicación del Decreto 53.'
    ],
    footer: signFooter(sheet)
  }
}

// Las tres hojas, en el orden en que se presentan. La utilidad de tenerlas juntas
// es que la pantalla no tenga que conocer sus nombres.
export const FICHA_SHEETS = [
  { key: 'ficha', label: 'Ficha de costos y gastos', build: buildFichaSheet },
  { key: 'insumos', label: 'Anexo: insumos fundamentales', build: buildInputsSheet },
  { key: 'salario', label: 'Anexo: gasto de salario', build: buildLaborSheet }
]
