// Enums y catalogos fijos del dominio.

export const ROLES = {
  OWNER: 'owner',
  SELLER: 'seller'
}

export const ROLE_LABELS = {
  [ROLES.OWNER]: 'Dueno',
  [ROLES.SELLER]: 'Vendedor'
}

// Unidades de medida soportadas por producto.
export const UNITS = ['u', 'kg', 'caja']

export const UNIT_LABELS = {
  u: 'Unidad',
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

// Tipos de movimiento del libro mayor de inventario.
export const MOVEMENT_TYPES = {
  PURCHASE_IN: 'purchase_in',
  SALE_OUT: 'sale_out',
  INTERNAL_DEBT_OUT: 'internal_debt_out',
  ADJUSTMENT: 'adjustment'
}

// Estados de turno.
export const SHIFT_STATUS = {
  OPEN: 'open',
  CLOSED: 'closed'
}

// Colores del semaforo de cuadre.
export const SEMAPHORE = {
  GREEN: 'green',
  YELLOW: 'yellow',
  RED: 'red'
}

// Umbrales por defecto del semaforo (editables por el dueno en Ajustes).
export const DEFAULT_SEMAPHORE_CONFIG = {
  greenMaxPct: 1, // |dif| <= 1% del esperado  -> cuadra
  yellowMaxPct: 3 // |dif| <= 3%               -> diferencia menor; mas -> critica
}
