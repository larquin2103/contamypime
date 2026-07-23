// Enums y catalogos fijos del dominio.

export const ROLES = {
  OWNER: 'owner',
  // Administrativo (Bloque 20.6): cargo de confianza que el dueño designa. Opera
  // "como otro dueño" en inventario y supervision (entradas/salidas del almacen,
  // autorizar al vendedor, forzar cierres, aprobar conteos) y ve la informacion
  // financiera (reportes, panel, auditoria, costos). NO gestiona usuarios, ni la
  // licencia, ni la sincronizacion: la identidad del negocio sigue siendo del dueño.
  ADMIN: 'admin',
  SELLER: 'seller'
}

export const ROLE_LABELS = {
  [ROLES.OWNER]: 'Dueño',
  [ROLES.ADMIN]: 'Administrativo',
  [ROLES.SELLER]: 'Vendedor'
}

// Unidades de medida soportadas por producto.
export const UNITS = ['u', 'lb', 'kg', 'caja']

export const UNIT_LABELS = {
  u: 'Unidad',
  lb: 'Libra',
  kg: 'Kilogramo',
  caja: 'Caja'
}

// Monedas.
//  - MN  : moneda nacional (base por defecto), efectivo
//  - USD : efectivo (el vendedor puede recibir billetes)
//  - MLC : SOLO electronico/visualizacion en Fase 1 (no es efectivo).
//          El cobro real en MLC llega en Fase 2 (transferencias).
export const CURRENCIES = [
  { code: 'MN', name: 'Moneda Nacional', isBase: true, cash: true },
  { code: 'USD', name: 'Dolar (USD)', isBase: false, cash: true },
  { code: 'MLC', name: 'MLC', isBase: false, cash: false, electronic: true }
]

// Monedas extranjeras con tasa editable (todo menos la base).
export const FOREIGN_CURRENCIES = CURRENCIES.filter((c) => !c.isBase)

// Monedas que se aceptan como EFECTIVO en ventas / cuadre (Fase 1).
export const CASH_CURRENCIES = CURRENCIES.filter((c) => c.cash).map((c) => c.code)

// Monedas para pago por TRANSFERENCIA (Fase 2): bancaria en MN y electronica MLC.
export const TRANSFER_CURRENCIES = ['MN', 'MLC']

// Metodos de pago de una venta.
export const PAYMENT_METHODS = {
  CASH: 'cash',
  TRANSFER: 'transfer',
  // Bloque H (modulo mayorista): venta cobrada en VARIAS partes (efectivo +
  // transferencia, o monedas distintas). El detalle viaja en sale.payments[].
  MIXED: 'mixed'
}

// Formas en que el dueño liquida (salda) una deuda interna. Queda registrada
// en la deuda para que el cuadre/auditoria muestre COMO se resolvio.
export const DEBT_SETTLE_METHODS = {
  CASH: 'cash', // el deudor pago en efectivo
  TRANSFER: 'transfer', // el deudor pago por transferencia
  PAYROLL: 'payroll', // se descuenta de su pago/nomina
  WRITEOFF: 'writeoff' // condonada (el dueño no cobra)
}

export const DEBT_SETTLE_LABELS = {
  [DEBT_SETTLE_METHODS.CASH]: 'Pagada en efectivo',
  [DEBT_SETTLE_METHODS.TRANSFER]: 'Pagada por transferencia',
  [DEBT_SETTLE_METHODS.PAYROLL]: 'Descontada del pago',
  [DEBT_SETTLE_METHODS.WRITEOFF]: 'Condonada (sin cobro)'
}

// Tipos de movimiento del libro mayor de inventario.
export const MOVEMENT_TYPES = {
  PURCHASE_IN: 'purchase_in',
  SALE_OUT: 'sale_out',
  INTERNAL_DEBT_OUT: 'internal_debt_out',
  ADJUSTMENT: 'adjustment',
  // Salida del almacen central hacia un area (Bloque 20). Es un traspaso: el
  // mismo evento genera un TRANSFER_OUT en el almacen y un TRANSFER_IN en el area.
  TRANSFER_OUT: 'transfer_out',
  TRANSFER_IN: 'transfer_in',
  // Entrega de mercancia del almacen a un TERCERO (Bloque C, modulo cuentas).
  PARTNER_OUT: 'partner_out',
  // Conversion de producto en el almacen (modulo mayorista): se consume un
  // producto (CONVERSION_OUT, -) y se da de alta otro con su propio codigo
  // (CONVERSION_IN, +). Ej: un saco de azucar -> varias jabas fraccionadas.
  CONVERSION_OUT: 'conversion_out',
  CONVERSION_IN: 'conversion_in'
}

// Terceros del negocio (Bloque C, modulo 'cuentas').
export const PARTNER_TYPES = {
  PROVIDER: 'provider', // proveedor: nos deja mercancia en consignacion
  CREDITOR: 'creditor' // acreedor/tercero: le entregamos mercancia y nos debe
}

export const PARTNER_TYPE_LABELS = {
  provider: 'Proveedor',
  creditor: 'Tercero (nos debe)'
}

// Movimientos de la cuenta de un tercero (append-only; el saldo se deriva).
export const PARTNER_MOVEMENT_TYPES = {
  CONSIGNMENT_DUE: 'consignment_due', // se vendio consignado -> le debemos al proveedor
  GOODS_OUT: 'goods_out', // le entregamos mercancia -> el tercero nos debe
  PAYMENT_OUT: 'payment_out', // le pagamos al proveedor (rebaja la deuda)
  PAYMENT_IN: 'payment_in' // el tercero nos pago (rebaja lo que nos debe)
}

export const PARTNER_MOVEMENT_LABELS = {
  consignment_due: 'Venta consignada',
  goods_out: 'Entrega de mercancía',
  payment_out: 'Pago realizado',
  payment_in: 'Cobro recibido'
}

// Estados de turno.
export const SHIFT_STATUS = {
  OPEN: 'open',
  CLOSED: 'closed'
}

// Areas de venta (Fase 6 - Bloque 19). Un punto de venta puede dividirse en
// varias areas, cada una con su propia caja/cuadre. La lista la define el dueño
// en Ajustes (clave de config 'areas'). Un producto sin area asignada se
// muestra como "General" y cualquier vendedor puede venderlo sin marcarlo como
// venta cruzada.
export const NO_AREA = ''
export const NO_AREA_LABEL = 'General'

export function areaLabel(area) {
  return area && String(area).trim() ? String(area).trim() : NO_AREA_LABEL
}

// Inventario por ubicacion (Bloque 20). Una "ubicacion" del stock es el ALMACEN
// central o el nombre de un area. El almacen usa un centinela reservado para no
// chocar con un area que se llamara "Almacen". El stock de cada ubicacion se
// deriva del libro mayor (cada stockMovement lleva su `location`).
export const WAREHOUSE = '__almacen'
export const WAREHOUSE_LABEL = 'Almacén'

// Centro de elaboracion (modulo 'elaboracion'). Es una ubicacion intermedia entre
// el almacen y las areas de venta: guarda stock pero NO es punto de venta (no se
// abren turnos ni se vende desde ahi). Usa un centinela reservado, igual que el
// almacen, para no chocar con un area que se llamara "Elaboracion". El nombre
// visible es configurable (config 'elaborationName'); ELABORATION_LABEL es el
// valor por defecto.
export const ELABORATION = '__elaboracion'
export const ELABORATION_LABEL = 'Elaboración'

export function locationLabel(loc) {
  if (!loc || loc === WAREHOUSE) return WAREHOUSE_LABEL
  if (loc === ELABORATION) return ELABORATION_LABEL
  return String(loc)
}

// Estados de un conteo fisico (Fase 3).
export const COUNT_STATUS = {
  DRAFT: 'draft', // en progreso
  PENDING: 'pending', // enviado, espera aprobacion del dueño
  APPROVED: 'approved', // aprobado -> ajustes aplicados
  REJECTED: 'rejected'
}

// Colores del semaforo de cuadre.
export const SEMAPHORE = {
  GREEN: 'green',
  YELLOW: 'yellow',
  RED: 'red'
}

// Umbrales por defecto del semaforo (editables por el dueño en Ajustes).
export const DEFAULT_SEMAPHORE_CONFIG = {
  greenMaxPct: 1, // |dif| <= 1% del esperado  -> cuadra
  yellowMaxPct: 3 // |dif| <= 3%               -> diferencia menor; mas -> critica
}

// Denominaciones por defecto para el conteo de caja al cierre (Fase 2).
// Editables por el dueño en Ajustes.
export const DEFAULT_DENOMINATIONS = {
  MN: [1000, 500, 200, 100, 50, 20, 10, 5, 3, 1],
  USD: [100, 50, 20, 10, 5, 1]
}
