// Enums y catalogos fijos del dominio.

export const ROLES = {
  OWNER: 'owner',
  // Administrativo (Bloque 20.6): cargo de confianza que el dueño designa. Opera
  // "como otro dueño" en inventario y supervision (entradas/salidas del almacen,
  // autorizar al vendedor, forzar cierres, aprobar conteos) y ve la informacion
  // financiera (reportes, panel, auditoria, costos). NO gestiona usuarios, ni la
  // licencia, ni la sincronizacion: la identidad del negocio sigue siendo del dueño.
  ADMIN: 'admin',
  SELLER: 'seller',
  // Elaboracion (modulo 'elaboracion'): opera SOLO el centro de elaboracion —
  // transforma productos y hace salidas a los puntos de venta, y vende desde el
  // centro. No ve el almacen central ni los datos del dueño. Es un rol acotado,
  // separado del vendedor.
  ELABORATION: 'elaboration',
  // Cocinero (modulo 'cocina'): rol acotado al tablero de cocina. NO abre turno
  // ni maneja caja; solo elabora recetas y las envia a un area de venta. No ve el
  // almacen central, ni costos, ni datos del dueño (como ELABORATION, pero para la
  // cocina). Solo existe con el modulo 'cocina' desbloqueado.
  COOK: 'cook',
  // Mensajero (modulo 'remesas'): rol acotado a la gestion de remesas. Recibe
  // efectivo en custodia, lo lleva en ruta y lo entrega al beneficiario, y luego
  // liquida. NO es mando ni vendedor: no abre turno de venta ni maneja el
  // catalogo, no ve costos ni datos del dueño (como COOK/ELABORATION, pero para
  // remesas). Solo existe con el modulo 'remesas' desbloqueado.
  COURIER: 'courier'
}

export const ROLE_LABELS = {
  [ROLES.OWNER]: 'Dueño',
  [ROLES.ADMIN]: 'Administrativo',
  [ROLES.SELLER]: 'Vendedor',
  [ROLES.ELABORATION]: 'Elaboración',
  [ROLES.COOK]: 'Cocinero',
  [ROLES.COURIER]: 'Mensajero'
}

// Unidades de medida soportadas por producto.
export const UNITS = ['u', 'lb', 'kg', 'caja', 'oz', 'g', 'ml', 'l']

export const UNIT_LABELS = {
  u: 'Unidad',
  lb: 'Libra',
  kg: 'Kilogramo',
  caja: 'Caja',
  oz: 'Onza',
  g: 'Gramo',
  ml: 'Mililitro',
  l: 'Litro'
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

// Modulo 'divisas': divisas en que se puede FIJAR el precio/costo de un producto.
// La base (MN) NO se convierte; una divisa se convierte a MN a la tasa vigente y
// el equivalente se congela por venta. Un producto SIN moneda propia se comporta
// como la base (clasico). Ampliable (p.ej. 'MLC') sin tocar el modelo de datos.
export const FOREIGN_PRICE_CURRENCIES = ['USD']

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
  CONVERSION_IN: 'conversion_in',
  // Merma (deterioro/perdida): rebaja de inventario que NO es venta. Sale de la
  // ubicacion elegida (almacen o area). Su afectacion se valora al COSTO en el
  // reporte de mermas (cantidad x costo = perdida para el dueño).
  MERMA_OUT: 'merma_out',
  // Modulo 'remesas' (F6): carga de PRODUCTO a un mensajero (area "Entregas" -> su
  // custodia de producto) y su devolucion. El area Entregas es una ubicacion normal
  // (surtida por traspaso); el producto que carga el mensajero vive APARTE (libro de
  // custodia de producto, aislado del inventario general, como el efectivo).
  DELIVERY_OUT: 'delivery_out', // sale del area Entregas hacia el mensajero (carga)
  DELIVERY_IN: 'delivery_in' // vuelve del mensajero al area Entregas (devolucion)
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

// Estados de un pedido de mesa (modulo 'mesas'). El pedido se abre al sentarse
// el cliente, acumula lineas y se cierra al cobrar (genera la venta real).
export const ORDER_STATUS = {
  RESERVED: 'reserved', // mesa apartada, aun sin consumo
  OPEN: 'open', // mesa ocupada, pedido en curso
  CLOSED: 'closed', // cobrado -> tiene saleId (la mesa vuelve a quedar LIBRE)
  VOIDED: 'voided' // anulado sin cobro (se devolvio el stock)
}

export const ORDER_STATUS_LABELS = {
  reserved: 'Reservada',
  open: 'Ocupada',
  closed: 'Cobrada',
  voided: 'Anulada'
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

// Cocina (modulo 'cocina'). Ubicacion fija propia (centinela reservado, como el
// almacen y elaboracion, pero INDEPENDIENTE de esta ultima): guarda el stock de
// insumos que el dueño entrega a la cocina. El cocinero elabora recetas desde
// aqui y envia el producto terminado a un area de venta. Nombre visible fijo.
export const COCINA = '__cocina'
export const COCINA_LABEL = 'Cocina'

// Area de ENTREGAS (modulo 'remesas', F6): ubicacion centinela desde la que el
// mensajero CARGA el producto a entregar. Se surte por el traspaso normal (almacen
// -> Entregas) y aparece como destino solo con el modulo. El producto que el
// mensajero ya cargo vive en su custodia de producto (aparte), no aqui.
export const ENTREGAS_AREA = '__entregas'
export const ENTREGAS_AREA_LABEL = 'Entregas'

export function locationLabel(loc) {
  if (!loc || loc === WAREHOUSE) return WAREHOUSE_LABEL
  if (loc === ELABORATION) return ELABORATION_LABEL
  if (loc === COCINA) return COCINA_LABEL
  if (loc === ENTREGAS_AREA) return ENTREGAS_AREA_LABEL
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

// ---------------------------------------------------------------------------
// Modulo 'remesas': gestion de remesas (orden -> pago -> custodia -> entrega ->
// liquidacion). Aditivo y gateado; sin el modulo, nada de esto aparece y la app
// es identica a la clasica. (F1: cimientos; sin logica ni UI todavia.)
// ---------------------------------------------------------------------------

// Caja central de la operacion de remesas: centinela reservado (como WAREHOUSE
// '__almacen') que representa el efectivo aun NO asignado a ningun mensajero. La
// custodia de un mensajero se identifica con su userId; "asignar" mueve de
// __central al mensajero (neto cero, igual que un traspaso almacen->area). No es
// una ubicacion de stock: por eso vive aparte y no entra en locationLabel.
export const REMESA_CENTRAL = '__central'
export const REMESA_CENTRAL_LABEL = 'Caja central'

// Estados de una remesa. Flujo normal (orden -> cierre) mas estados de excepcion.
// El estado avanza append-only y cada transicion actualiza updatedAt (la sync es
// LWW por marca de tiempo). Sin el modulo no se crea ninguna remesa.
export const REMITTANCE_STATUS = {
  CREATED: 'created', // orden creada
  PAYMENT_PENDING: 'payment_pending', // esperando pago del remitente
  PAID: 'paid', // pagada
  VALIDATED: 'validated', // pago validado
  FUNDS_AVAILABLE: 'funds_available', // fondos disponibles para asignar
  ASSIGNED: 'assigned', // asignada a un mensajero
  HANDED_TO_COURIER: 'handed_to_courier', // efectivo entregado al mensajero
  IN_ROUTE: 'in_route', // en ruta
  DELIVERED: 'delivered', // entregada al beneficiario
  SETTLED: 'settled', // liquidada (efectivo conciliado)
  CLOSED: 'closed', // cerrada
  // Excepciones.
  CANCELLED: 'cancelled',
  FAILED: 'failed',
  BENEFICIARY_UNAVAILABLE: 'beneficiary_unavailable',
  WRONG_ADDRESS: 'wrong_address',
  REJECTED: 'rejected',
  DISPUTED: 'disputed',
  RETURNED: 'returned',
  EXPIRED: 'expired'
}

export const REMITTANCE_STATUS_LABELS = {
  created: 'Creada',
  payment_pending: 'Pago pendiente',
  paid: 'Pagada',
  validated: 'Validada',
  funds_available: 'Fondos disponibles',
  assigned: 'Asignada',
  handed_to_courier: 'Entregada al mensajero',
  in_route: 'En ruta',
  delivered: 'Entregada',
  settled: 'Liquidada',
  closed: 'Cerrada',
  cancelled: 'Cancelada',
  failed: 'Fallida',
  beneficiary_unavailable: 'Beneficiario ausente',
  wrong_address: 'Dirección incorrecta',
  rejected: 'Rechazada',
  disputed: 'En disputa',
  returned: 'Devuelta',
  expired: 'Vencida'
}

// Modo de cobro de una entrega (modulo 'remesas'). ANTICIPADO = el clasico (el
// remitente paga y recien se entrega). CONTRA ENTREGA = se entrega primero y el
// cobro al remitente queda PENDIENTE ("por cobrar") hasta registrarlo. Campo
// opcional SIN indice ni migracion (como sales.area): sin el, la entrega es
// 'upfront' = comportamiento clasico. La reconexion del dinero de "contra entrega"
// (cobro a cuenta, fondo del mensajero) llega en fases posteriores.
export const PAYMENT_MODE = {
  UPFRONT: 'upfront',
  ON_CREDIT: 'on_credit'
}

export const PAYMENT_MODE_LABELS = {
  upfront: 'Cobro anticipado',
  on_credit: 'Cobro contra entrega'
}

// Tipo de lo que se entrega (modulo 'remesas', F6). Por defecto DINERO (clasico).
// PRODUCTO entrega articulos del catalogo desde el area "Entregas" (rebaja el
// inventario) y el mensajero los lleva en su custodia de producto (aislada).
export const DELIVERY_KIND = {
  MONEY: 'money',
  PRODUCT: 'product'
}

export const DELIVERY_KIND_LABELS = {
  money: 'Dinero',
  product: 'Producto'
}

// Tipos de movimiento del LIBRO DE CUSTODIA de efectivo (modulo 'remesas'). Es
// append-only y el SALDO por tenedor+moneda se DERIVA de estos movimientos (nunca
// se guarda), igual que el stock sale del libro mayor y el saldo de una cuenta de
// sus movimientos. "Tenedor" (holder) = la caja central (REMESA_CENTRAL) o el
// userId de un mensajero. Se define el vocabulario completo (como MOVEMENT_TYPES);
// esta fase (F3) solo usa INTAKE — asignacion/entrega/devolucion llegan con el rol
// de mensajero y las entregas.
export const CUSTODY_MOVEMENT_TYPES = {
  INTAKE: 'intake', // entra efectivo a la caja central (cobro al remitente)
  ASSIGN: 'assign', // asignacion a un mensajero (debita central, acredita mensajero)
  DELIVER: 'deliver', // entrega al beneficiario (debita al mensajero)
  RETURN: 'return', // devolucion de efectivo (debita mensajero, acredita central)
  SETTLE_ADJUST: 'settle_adjust', // ajuste por diferencia al liquidar (append-only)
  FUND: 'fund' // dotacion/devolucion del FONDO del mensajero (no atado a una entrega)
}

// Resultado de un intento de ENTREGA (modulo 'remesas'). La entrega es una fila
// append-only en `deliveries`; una remesa asignada se resuelve ENTREGADA (el
// efectivo llega al beneficiario) o FALLIDA (se devuelve el efectivo a la central).
export const DELIVERY_RESULT = {
  DELIVERED: 'delivered',
  FAILED: 'failed'
}

// MOTIVOS por los que una entrega no se pudo concretar. El mando elige uno al marcarla
// fallida y ESE pasa a ser el estado de la entrega, para que el reporte diga POR QUE
// falla cada una (antes todas terminaban en 'returned' y el motivo se perdia). Son
// estados que ya existian en REMITTANCE_STATUS: aqui solo se declara cuales puede
// elegir el mando, para que `failReturn` no acepte cualquiera.
export const DELIVERY_FAIL_REASONS = [
  REMITTANCE_STATUS.RETURNED,
  REMITTANCE_STATUS.BENEFICIARY_UNAVAILABLE,
  REMITTANCE_STATUS.WRONG_ADDRESS,
  REMITTANCE_STATUS.REJECTED,
  REMITTANCE_STATUS.EXPIRED,
  REMITTANCE_STATUS.DISPUTED,
  REMITTANCE_STATUS.FAILED
]
