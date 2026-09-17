import { round2 } from './currency.js'

// ---------------------------------------------------------------------------
// Prorrateo del DESCUENTO de una venta entre sus lineas (modulo 'mesas').
// Aritmetica PURA, sin Dexie: se prueba con node.
//
// EL PROBLEMA QUE RESUELVE. El panel del dueño calcula el ingreso y la ganancia
// sumando `lineTotal` linea por linea, mientras que la tendencia y el donut de
// metodos de pago usan `sale.totalBase`. Un descuento vive en la CABECERA de la
// venta: baja `totalBase` pero NO los `lineTotal`. Sin corregirlo, el panel diria
// que entro mas dinero del que entro -y el dueño pidio expresamente que el panel
// muestre el valor REAL, "que no se falseen las ventas ni los estimados"-.
//
// LA CORRECCION. Cada linea aporta su importe multiplicado por el factor
// (consumo - descuento) / consumo. Es reparto PROPORCIONAL al importe de cada
// linea: el criterio contable estandar, y el unico que mantiene la suma de las
// partes igual al total (por producto, por categoria, por area y el total general
// quedan coherentes entre si).
//
// EL COSTO NO SE TOCA: la mercancia costo lo mismo aunque se regalara parte del
// precio. Regalar precio reduce la ganancia, no el costo.
//
// INVARIANTE: sin descuento (o sin el campo, o en una venta vieja) el factor es 1
// y la aritmetica del panel queda EXACTAMENTE como estaba.
// ---------------------------------------------------------------------------

// Consumo BRUTO de una venta: la suma de sus lineas (lo que el panel sumaba).
export function grossOf(sale) {
  return round2((sale?.items || []).reduce(
    (a, it) => a + Number(it?.lineTotal ?? (Number(it?.unitPrice || 0) * Number(it?.qty || 0))), 0
  ))
}

// Factor por el que hay que multiplicar cada linea. 1 = sin descuento.
export function saleNetFactor(sale) {
  const disc = Number(sale?.discountAmount || 0)
  if (!(disc > 0)) return 1
  const gross = grossOf(sale)
  // Sin consumo que repartir (venta sin lineas) no se puede prorratear: se deja 1 y
  // el descuento no distorsiona nada, porque no hay linea a la que aplicarlo.
  if (!(gross > 0)) return 1
  // Un descuento mayor que el consumo (no deberia ocurrir: la pantalla lo acota al
  // 100 %) dejaria el factor negativo, o sea un ingreso NEGATIVO. Se corta en 0.
  if (disc >= gross) return 0
  return (gross - disc) / gross
}

// Importe NETO de una linea dentro de su venta (lo que el panel debe sumar).
export function netLineRevenue(sale, item) {
  const gross = Number(item?.lineTotal ?? (Number(item?.unitPrice || 0) * Number(item?.qty || 0)))
  return round2(gross * saleNetFactor(sale))
}

// Ingreso, costo y ganancia de un conjunto de ventas. Devuelve
// `{ revenue, cost, profit, count }`, con `count` en VENTAS (no en lineas).
//
// POR QUE EXISTE (paso 3 del panel de escritorio, 17-09-2026). El Inicio muestra
// las cifras del DIA. `analyticsRepo.report()` ya las calcula, pero lee TODAS
// las ventas de la historia (`db.sales.toArray()`) y el Inicio es la pantalla
// que mas se abre; ademas corre tambien en el telefono del dueño.
//
// LA REGLA QUE APLICA, y que no se puede reinventar: el descuento de una mesa se
// PRORRATEA entre las lineas (`saleNetFactor`), para que el ingreso sea el REAL
// y no el bruto; y el COSTO no se toca, porque la mercancia costo lo mismo
// aunque se regalara el precio. Una cortesia (100 %) ingresa 0 y su costo SI
// cuenta.
//
// ESTA FUNCION Y EL BUCLE DE `report()` TIENEN QUE DAR LO MISMO. Dos sitios que
// suman el mismo dinero acaban divergiendo -es el fallo de F1 en miniatura- y
// divergir aqui significa que el Inicio y el Panel del dueño digan cifras
// distintas del mismo dia. Por eso la suite no se limita a probar casos:
// compara esta funcion contra el bucle REAL de `report()`, copiado literal,
// sobre 500 conjuntos de ventas aleatorias. Si alguien toca uno de los dos, la
// prueba lo caza.
//
// No se refactorizo `report()` para que llamara aqui: ese bucle alimenta TODO el
// panel del dueño (por producto, por categoria, por area) y tocarlo por una
// mejora de presentacion seria arriesgar dinero por estetica.
export function sumSales(sales) {
  let revenue = 0
  let cost = 0
  let count = 0
  for (const s of sales || []) {
    count++
    const netFactor = saleNetFactor(s)
    for (const it of s?.items || []) {
      revenue += round2(Number(it.lineTotal ?? it.unitPrice * it.qty) * netFactor)
      cost += Number((it.unitCost || 0) * it.qty)
    }
  }
  revenue = round2(revenue)
  cost = round2(cost)
  return { revenue, cost, profit: round2(revenue - cost), count }
}
