// Motor de la Ficha de costos y gastos (Res. 148/2023 MFP, Gaceta Oficial No. 64
// Ordinaria del 6-jul-2023, pp. 1376-1387). Modulo de licencia `fichas`.
//
// PURO: sin Dexie, sin React, sin imports. Se corre con
//   node src/lib/fichaCosto.test.mjs
// La interpretacion normativa completa (las 16 filas, la errata de la Gaceta, las
// bases de utilidad y los tres controles) vive en `docs/FICHA-COSTO.md` §2.
//
// DOS COSAS QUE NO SE DEBEN "CORREGIR" SIN LEER EL DOCUMENTO:
//   1. La Fila 12 es 5 + 11, NO 6 + 11. El cuerpo de la Gaceta (p. 1383) dice
//      "6+11" pero el modelo del Anexo I (p. 1380) rotula "(5+11)"; con 6+11 la
//      fila 6 se contaria dos veces y las filas 1-4 desaparecerian del precio.
//   2. La base de la utilidad NO es el total (nota ** del Anexo II). Salvo en
//      agropecuaria / alta tecnologia / informatica / ciencia, es 2 + 3 + 4.
//
// Como los demas modulos puros de este repo (custodyMath, productCustodyMath,
// remesas), este NO lanza excepciones: DEVUELVE la condicion y la pantalla
// decide si bloquea. Lanzar es cosa de la capa de repositorios. Todo lo que el
// motor sabe y no puede resolver solo sale por `fichaWarnings`.
//
// CONVENCION DE UNIDADES (no mezclarlas: equivocarse aqui vale 100x):
//   - Los campos que acaban en `Pct` van en PORCENTAJE: `utilityPct: 25` es 25%,
//     igual que el `capacityPct: 78` del registro.
//   - Los tipos tributarios `taxSS` y `taxFT` van en FRACCION: 12,5% es 0.125.
//   - `maxUtility` y `utilityRate` devuelven FRACCION.

// Misma formula que lib/currency.round2 (se replica para que el modulo sea puro
// y autoexplicativo, sin cadena de imports que impida correrlo en node).
// Evita -0 igual que productCustodyMath.cleanQty: la Fila 13 lleva signo (puede
// ser un subsidio) y un -0 se imprimiria "-0,00" en la ficha oficial.
export function round2(n) {
  const v = Math.round((Number(n) + Number.EPSILON) * 100) / 100
  return Object.is(v, -0) ? 0 : v
}

// Magnitud capturada por el dueño: nunca negativa (un insumo no puede pesar -2 kg
// ni una operacion emplear a -1 trabajador). Texto o vacio valen cero.
const pos = (n) => {
  const v = Number(n)
  return Number.isFinite(v) && v > 0 ? v : 0
}

// Moneda base interna de la app. USD es solo la capa visible (modulo `divisas`).
const BASE_CURRENCY = 'MN'

// Tipo de actividad del Anexo II. Manda la tasa maxima de utilidad, la base
// sobre la que se aplica y el coeficiente de indirectos del Art. 9.
export const FICHA_ACTIVITIES = {
  BIENES: 'bienes', // produccion de bienes (el caso normal de una MYPIME)
  AGROPECUARIA: 'agropecuaria', // excepto derivadas del azucar
  SERVICIOS: 'servicios', // servicios y comercializacion
  ALTA_TEC: 'altaTecnologia', // alta tecnologia, informatica, ciencia e investigacion
  GASTRONOMIA: 'gastronomia' // gastronomia popular (Art. 16)
}

// Metodo de formacion del precio (Arts. 8, 10 y 12).
export const FICHA_METHODS = { GASTOS: 'gastos', CORRELACION: 'correlacion' }

// Tasa maxima de utilidad por el metodo de gastos (Anexo II). Para una MYPIME es
// REFERENCIA, no obligacion (Art. 6): por eso la app avisa y nunca bloquea.
const MAX_UTILITY = {
  [FICHA_ACTIVITIES.BIENES]: 0.25,
  [FICHA_ACTIVITIES.AGROPECUARIA]: 0.3, // excepcionalmente 40% previa consulta al MFP
  [FICHA_ACTIVITIES.SERVICIOS]: 0.15,
  [FICHA_ACTIVITIES.ALTA_TEC]: 0.3,
  [FICHA_ACTIVITIES.GASTRONOMIA]: 0.1 // Art. 16
}

// Actividades cuya base de utilidad es la Fila 12 COMPLETA (excepcion del Anexo II).
const FULL_BASE_ACTIVITIES = new Set([FICHA_ACTIVITIES.AGROPECUARIA, FICHA_ACTIVITIES.ALTA_TEC])

// Coeficiente maximo de gastos indirectos (Art. 9): produccion 1,5 y servicios 1,0.
// `altaTecnologia` no lo fija la Resolucion; el dueño decidio 1,0 el 01-09-2026
// por ser el lado que avisa antes (el control es aviso, nunca cerrojo).
const INDIRECT_COEFFICIENT = {
  [FICHA_ACTIVITIES.BIENES]: 1.5,
  [FICHA_ACTIVITIES.AGROPECUARIA]: 1.5,
  [FICHA_ACTIVITIES.SERVICIOS]: 1,
  [FICHA_ACTIVITIES.ALTA_TEC]: 1,
  [FICHA_ACTIVITIES.GASTRONOMIA]: 1 // Art. 16: los indirectos no exceden el salario directo
}

// --- Anexo "Desagregacion de los insumos fundamentales" ----------------------

// Se redondea CADA LINEA y luego se suma, no al reves. Es deliberado: el anexo
// imprime la columna (7) fila por fila y su "Total" tiene que cuadrar con la suma
// de lo impreso, que es lo que mira un inspector. Sumar en crudo y redondear al
// final daria un anexo cuyo total no cuadra con sus propias filas. Vale igual
// para la columna (9) del anexo de salario. NO "arreglarlo" en F9.
//
// Importe de una linea del anexo: columna (7) = (5) norma de consumo x (6) precio
// unitario. Si la linea esta en divisa (modulo `divisas`) se convierte a MN con
// la tasa CONGELADA en la propia linea, nunca con la de hoy.
// Sin tasa no se inventa un importe: la linea vale 0 y sale en missingRateInputs.
function inputAmount(line) {
  const raw = pos(line?.qty) * pos(line?.unitPrice)
  if (!isForeignLine(line)) return round2(raw)
  const rate = pos(line?.priceRate)
  return rate ? round2(raw * rate) : 0
}

const isForeignLine = (line) =>
  !!(line?.priceCurrency && line.priceCurrency !== BASE_CURRENCY)

// Fila 1.1: total del anexo de insumos, valorado en MN.
export function inputsTotal(inputs) {
  let total = 0
  for (const line of inputs || []) total += inputAmount(line)
  return round2(total)
}

// Lineas en divisa a las que les falta la tasa congelada. La pantalla bloquea con
// esto (mismo invariante que kitchenRepo.produce: sin tasa, no se elabora).
export function missingRateInputs(inputs) {
  return (inputs || []).filter((line) => isForeignLine(line) && !pos(line?.priceRate))
}

// --- Portadores (filas 1.2, 1.3 y 1.4) --------------------------------------
// En una MYPIME el combustible, la electricidad y el agua NO son productos del
// catalogo: se capturan como cantidad x precio unitario.
const carrierAmount = (c) => round2(pos(c?.qty) * pos(c?.unitPrice))

export function carriersTotal(carriers) {
  return round2(
    carrierAmount(carriers?.fuel) + carrierAmount(carriers?.energy) + carrierAmount(carriers?.water)
  )
}

// --- Anexo "Gasto de salario de los obreros" --------------------------------
// Columna (9) = (3) cantidad de trabajadores x ((6) salario/hora + (7) pagos
// adicionales por hora) x (8) norma de tiempo en horas.
function laborAmount(op) {
  return round2(pos(op?.workers) * (pos(op?.hourly) + pos(op?.extraHourly)) * pos(op?.hours))
}

// Fila 2: salario directo (incluye vacaciones, segun la descripcion de la fila).
export function laborTotal(labor) {
  let total = 0
  for (const op of labor || []) total += laborAmount(op)
  return round2(total)
}

// Fila 3: otros gastos directos (mantenimientos, depreciacion de AFT directos,
// amortizacion de intangibles). La norma exige desglosarlos, de ahi la lista.
export function otherDirectTotal(items) {
  let total = 0
  for (const it of items || []) total += round2(pos(it?.amount))
  return round2(total)
}

// --- Fila 10: gastos tributarios --------------------------------------------
// (Fila 2 + 4.1 + 6.1 + 7.1) x (tipo Seguridad Social + tipo Utilizacion de la
// Fuerza de Trabajo). Excluye expresamente la Contribucion al Desarrollo Local.
// Los DOS tipos los configura el dueño: la Resolucion no los fija (remite a la
// legislacion tributaria) y por defecto van en cero. No inventar porcentajes.
export function taxRow(sheet) {
  const rows = sheet?.rows || {}
  const base = laborTotal(sheet?.labor) + pos(rows.r41) + pos(rows.r61) + pos(rows.r71)
  return round2(base * (pos(rows.taxSS) + pos(rows.taxFT)))
}

// --- Las 16 filas del Anexo I -----------------------------------------------
// Devuelve las filas calculadas y tambien las capturadas, para que la pantalla y
// los reportes lean de un solo sitio. Nombres: `r1_1..r1_4` son las subfilas de
// la fila 1; `r41`, `r61` y `r71` son los "de ello, salarios" y se llaman igual
// que en el registro de `costSheets` (docs/FICHA-COSTO.md §4).
export function totals(sheet) {
  const rows = sheet?.rows || {}
  const r1_1 = inputsTotal(sheet?.inputs)
  const r1_2 = carrierAmount(sheet?.carriers?.fuel)
  const r1_3 = carrierAmount(sheet?.carriers?.energy)
  const r1_4 = carrierAmount(sheet?.carriers?.water)
  const r1 = round2(r1_1 + r1_2 + r1_3 + r1_4)
  const r2 = laborTotal(sheet?.labor)
  const r3 = otherDirectTotal(sheet?.otherDirect)
  const r4 = round2(pos(rows.r4))
  const r41 = round2(pos(rows.r41))
  const r5 = round2(r1 + r2 + r3 + r4) // COSTO TOTAL
  const r6 = round2(pos(rows.r6))
  const r61 = round2(pos(rows.r61))
  const r7 = round2(pos(rows.r7))
  const r71 = round2(pos(rows.r71))
  const r8 = round2(pos(rows.r8))
  const r9 = round2(pos(rows.r9)) // OSDE: no aplica a un actor no estatal
  const r10 = taxRow(sheet)
  const r11 = round2(r6 + r7 + r8 + r9 + r10) // TOTAL DE GASTOS
  const r12 = round2(r5 + r11) // TOTAL DE COSTOS Y GASTOS: 5+11, no 6+11
  return { r1_1, r1_2, r1_3, r1_4, r1, r2, r3, r4, r41, r5, r6, r61, r7, r71, r8, r9, r10, r11, r12 }
}

// --- CONTROL A: coeficiente maximo de gastos indirectos (Art. 9) ------------
// Fila 4 + Fila 6 + Fila 7 <= coeficiente x Fila 2.
// Devuelve el EXCESO EN IMPORTE (no un porcentaje) porque es lo que el dueño
// necesita ver para decidir. Excederlo exige consulta previa al MFP, asi que la
// pantalla AVISA: no bloquea nunca (Art. 6).
// Sin salario directo (Fila 2 = 0) el control NO OPINA (`applies: false`).
// Decision del dueño del 01-09-2026: el limite saldria 0 y CUALQUIER indirecto lo
// excederia, asi que una comercializacion donde el dueño trabaja el mismo viviria
// en ambar permanente y el semaforo se volveria ruido. El coeficiente entonces es
// INDEFINIDO (`null`), que no es cero: un cero se lee como "perfecto".
export function indirectCheck(sheet) {
  const t = totals(sheet)
  const coef = INDIRECT_COEFFICIENT[sheet?.activity] ?? 1
  const sum = round2(t.r4 + t.r6 + t.r7)
  const applies = t.r2 > 0
  const limit = applies ? round2(coef * t.r2) : 0
  const over = applies && sum > limit
  return {
    sum,
    limit,
    applies,
    excess: over ? round2(sum - limit) : 0,
    coefficient: applies ? round2(sum / t.r2) : null,
    ok: !over
  }
}

// --- CONTROL B: base y tasa de la utilidad (Anexo II) -----------------------
// LA BASE NO ES EL TOTAL. Nota ** del Anexo II:
//   Base = Fila 12 - (1 + 6 + 7 + 8 + 9 + 10) = Fila 2 + Fila 3 + Fila 4
// Excepciones:
//   - agropecuaria / alta tecnologia / informatica / ciencia: la Fila 12 COMPLETA.
//   - gastronomia popular (Art. 16): descuenta "el consumo material, los gastos
//     generales y de administracion, los financieros, tributarios y el
//     financiamiento a la OSDE". NO menciona distribucion y venta, luego
//     Base = 12 - (1 + 6 + 8 + 9 + 10) = 2 + 3 + 4 + 7. Se implementa LITERAL.
export function utilityBase(sheet) {
  const t = totals(sheet)
  if (FULL_BASE_ACTIVITIES.has(sheet?.activity)) return t.r12
  if (sheet?.activity === FICHA_ACTIVITIES.GASTRONOMIA) return round2(t.r2 + t.r3 + t.r4 + t.r7)
  return round2(t.r2 + t.r3 + t.r4)
}

// Tasa MAXIMA del Anexo II, en FRACCION. Una actividad desconocida o ausente
// devuelve `null` (indefinida), nunca 0: devolver 0 hacia que la ficha entregara
// un precio igual al costo, en silencio, que es el peor resultado posible en un
// sistema cuyo trabajo es fijar precios. El aviso sale por `fichaWarnings`.
export function maxUtility(activity) {
  return MAX_UTILITY[activity] ?? null
}

// Tasa EFECTIVA, en FRACCION. El Anexo II fija maximos y para una MYPIME son
// referencia, no obligacion (Art. 6), asi que el dueño puede escribir la suya en
// `utilityPct` (PORCENTAJE). Sin ese campo se usa el maximo de la actividad, que
// es exactamente como se comportaba antes de existir el campo. Pasarse del
// maximo NO se recorta: se avisa (aviso, nunca cerrojo).
export function utilityRate(sheet) {
  const pct = sheet?.utilityPct
  if (pct != null && pct !== '' && Number.isFinite(Number(pct))) return pos(pct) / 100
  return maxUtility(sheet?.activity)
}

// --- Filas 13, 14 y 15 ------------------------------------------------------
// Por gastos:      13 = base x tasa   ·  14 = 12 + 13
// Por correlacion: 14 = precio del similar  ·  13 = 14 - 12 (puede ser negativa)
// 15 = 14 / nivel de produccion. Sin nivel no hay unitario (y no se divide).
export function priceRows(sheet) {
  const t = totals(sheet)
  const level = pos(sheet?.productionLevel)
  let r13
  let r14
  if (sheet?.method === FICHA_METHODS.CORRELACION) {
    const similar = round2(pos(sheet?.correlationPrice))
    // Sin precio del similar todavia no hay nada que comparar: un campo en blanco
    // NO es un subsidio. Se devuelven ceros hasta que el dueño lo escriba.
    if (!similar) return { r13: 0, r14: 0, r15: 0 }
    r14 = similar
    r13 = round2(r14 - t.r12)
  } else {
    // Tasa indefinida (actividad desconocida): no se inventa una utilidad. La
    // ficha lo dice por `fichaWarnings`, no lo entierra en un cero.
    const rate = utilityRate(sheet)
    r13 = rate == null ? 0 : round2(utilityBase(sheet) * rate)
    r14 = round2(t.r12 + r13)
  }
  return { r13, r14, r15: level ? round2(r14 / level) : 0 }
}

// --- CONTROL C: subsidio ----------------------------------------------------
// Si el precio por correlacion queda por debajo del total de costos y gastos, la
// Fila 13 sale negativa: eso es un SUBSIDIO, que la norma prohibe como regla.
// Aviso rojo en la pantalla.
export function subsidyWarning(sheet) {
  if (sheet?.method === FICHA_METHODS.CORRELACION && !pos(sheet?.correlationPrice)) return false
  return priceRows(sheet).r13 < 0
}

// --- Avisos: UNA sola fuente para los semaforos de los bloques 5 y 7 ---------
// Mismo estilo que `missingRateInputs`: el motor no lanza, no inventa numeros y
// no se calla lo que sabe; devuelve QUE pasa y con QUE importe, y la pantalla
// decide como pintarlo. Todos son AVISOS (Art. 6): ninguno bloquea la ficha.
// Codigos: insumo-sin-tasa · actividad-desconocida · correlacion-sin-precio ·
//          indirectos-exceden · utilidad-sobre-maximo · subsidio
export function fichaWarnings(sheet) {
  const out = []

  const sinTasa = missingRateInputs(sheet?.inputs)
  if (sinTasa.length) out.push({ code: 'insumo-sin-tasa', lines: sinTasa })

  if (maxUtility(sheet?.activity) == null) out.push({ code: 'actividad-desconocida' })

  const correlacion = sheet?.method === FICHA_METHODS.CORRELACION
  if (correlacion && !pos(sheet?.correlationPrice)) out.push({ code: 'correlacion-sin-precio' })

  const ind = indirectCheck(sheet)
  if (ind.applies && !ind.ok) {
    out.push({ code: 'indirectos-exceden', excess: ind.excess, limit: ind.limit, coefficient: ind.coefficient })
  }

  // Solo por el metodo de gastos: por correlacion la utilidad se DERIVA del
  // precio del similar, no se elige, asi que no hay techo que exceder.
  if (!correlacion) {
    const rate = utilityRate(sheet)
    const max = maxUtility(sheet?.activity)
    if (rate != null && max != null && rate > max) {
      out.push({ code: 'utilidad-sobre-maximo', excess: round2(utilityBase(sheet) * (rate - max)), rate, max })
    }
  }

  if (subsidyWarning(sheet)) out.push({ code: 'subsidio', amount: priceRows(sheet).r13 })

  return out
}

// --- Ciclo de vida de la ficha (append-only, nada se borra) -----------------
// Estas guardas viven AQUI, puras, por el mismo motivo que las reglas de
// `lib/remesas.js`: `costSheetsRepo` habla con Dexie y no se puede correr sin
// indexedDB, asi que las reglas que hay que poder probar con node salen del repo.
// El repo las usa como candado y la pantalla como para habilitar botones: una
// sola fuente, sin que cada capa reinvente la condicion.
//
// Las ETIQUETAS de estos estados estan en `src/db/constants.js`
// (FICHA_STATUS_LABELS), y la suite comprueba que cubran esta lista exacta.
export const FICHA_STATUS = {
  BORRADOR: 'borrador', // se edita en sitio, sellando updatedAt
  APROBADA: 'aprobada', // INMUTABLE: corregirla es una revision nueva
  SUSTITUIDA: 'sustituida' // ya tiene sucesora con el mismo groupId
}

// Una ficha eliminada (borrado LOGICO) no admite ninguna operacion. Nada se
// borra de verdad: el registro y su historial se conservan.
const viva = (sheet) => !!sheet && !sheet.deletedAt

// Solo el borrador se edita en sitio. Una APROBADA es inmutable: es el documento
// con el que se sostuvo un precio ante control o negociacion, y cambiarlo por
// debajo dejaria sin respaldo lo ya presentado.
export function canEditSheet(sheet) {
  return viva(sheet) && sheet.status === FICHA_STATUS.BORRADOR
}

export function canApproveSheet(sheet) {
  return viva(sheet) && sheet.status === FICHA_STATUS.BORRADOR
}

// Una revision nace SOLO de una aprobada. De una SUSTITUIDA no: esa ya tiene
// sucesora, y revisarla otra vez abriria una segunda rama del mismo groupId,
// dejando dos "ultimas versiones" del mismo documento.
export function canReviseSheet(sheet) {
  return viva(sheet) && sheet.status === FICHA_STATUS.APROBADA
}

export function canDeleteSheet(sheet) {
  return viva(sheet)
}

// Version de la revision siguiente. Una ficha vieja sin `version` cuenta como 1.
export function nextVersion(prev) {
  return (Number(prev?.version) || 1) + 1
}
