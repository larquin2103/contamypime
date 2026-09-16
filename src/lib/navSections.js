// Inventario de navegacion de la barra LATERAL de escritorio (>=1024px).
//
// POR QUE ES UN MODULO PURO Y NO CONDICIONALES DENTRO DEL JSX:
// la regla de oro del proyecto es que lo de un modulo SOLO aparece con su
// licencia desbloqueada. La barra inferior tiene 6 entradas y sus puertas caben
// de un vistazo; la lateral lleva mas de veinte y repetir ahi `hasModule(...)`
// a mano es exactamente como nacen las fugas. Aqui la decision es una funcion
// sin React, sin Dexie y sin lucide, asi que se puede probar con node -que es
// como se prueba todo en este repo- y una fuga se caza en la suite, no en
// produccion.
//
// NO DECIDE NADA NUEVO: replica, entrada por entrada, las puertas que ya
// aplican `Home.jsx` (acordeon y destacados) y `Layout.jsx` (barra inferior).
// Si una entrada no se ve hoy en el Inicio, tampoco se ve aqui.
//
// El icono viaja como CLAVE de texto (`icon: 'package'`), no como componente:
// asi el modulo no importa lucide y la suite corre en node pelado. El mapa
// clave -> componente vive en `Layout.jsx`, que es quien pinta.

import { LICENSE_MODULES } from './license.js'

// Quita las entradas apagadas y los grupos que se quedan sin ninguna. Un grupo
// vacio pintaria su titulo sobre la nada -y con modulos, eso SI seria una fuga:
// "GESTION" sin nada debajo delata que hay algo que no se compro.
function compact(groups) {
  return groups
    .map((g) => ({ ...g, items: g.items.filter(Boolean) }))
    .filter((g) => g.items.length > 0)
}

// Azucar: la entrada solo existe si `when` es cierto. Devuelve `null` y
// `compact` la limpia.
const when = (cond, item) => (cond ? item : null)

/**
 * Construye las secciones de la barra lateral.
 *
 * @param {object} ctx
 * @param {boolean} ctx.isOwner       dueno
 * @param {boolean} ctx.isManager     dueno o administrativo
 * @param {boolean} ctx.isSeller      vendedor
 * @param {boolean} ctx.isCook        cocinero (rol acotado de `cocina`)
 * @param {boolean} ctx.isCourier     mensajero (rol acotado de `remesas`)
 * @param {boolean} ctx.isElaborator  elaborador (rol acotado de `elaboracion`)
 * @param {boolean} ctx.canSell       tiene turno abierto y puede vender
 * @param {string[]} ctx.modules      modulos DESBLOQUEADOS de la licencia
 * @param {string[]} ctx.areas        areas de venta configuradas
 * @param {{enabled:boolean,name:string}} ctx.elaboration  centro de elaboracion
 * @param {boolean} ctx.sellerEntries        permiso: el vendedor da entradas
 * @param {boolean} ctx.sellerKitchenBoard   permiso: tablero de cocina al vendedor
 * @param {boolean} ctx.sellerCocktailBoard  permiso: tablero de cocteleria al vendedor
 * @param {number} ctx.pendingCollection     entregas por cobrar (contador rojo)
 * @returns {Array<{id:string,label:string|null,items:Array<object>}>}
 */
export function buildNavSections(ctx = {}) {
  const {
    isOwner = false,
    isManager = false,
    isSeller = false,
    isCook = false,
    isCourier = false,
    isElaborator = false,
    canSell = false,
    modules = [],
    areas = [],
    elaboration = { enabled: false, name: 'Elaboración' },
    sellerEntries = false,
    sellerKitchenBoard = false,
    sellerCocktailBoard = false,
    pendingCollection = 0
  } = ctx

  // Misma semantica que `useLicense().hasModule`: la lista llega VACIA si la
  // licencia no esta desbloqueada, asi que aqui no hay forma de autoactivar nada.
  const has = (m) => modules.includes(m)
  const elab = elaboration || { enabled: false, name: 'Elaboración' }

  // El cocinero y el mensajero son roles ACOTADOS: su barra es la de su tablero,
  // no una version recortada de la del mando.
  if (isCook) {
    return compact([
      { id: 'principal', label: null, items: [
        { to: '/', label: 'Inicio', icon: 'home', end: true },
        { to: '/catalog', label: 'Catálogo', icon: 'package' }
      ] },
      { id: 'cocina', label: 'Cocina', items: [
        { to: '/cocina', label: 'Tablero de cocina', icon: 'pot' }
      ] },
      { id: 'ayuda', label: null, items: [
        { to: '/help', label: 'Ayuda', icon: 'help' }
      ] }
    ])
  }

  if (isCourier) {
    return compact([
      { id: 'principal', label: null, items: [
        { to: '/', label: 'Inicio', icon: 'home', end: true }
      ] },
      { id: 'entregas', label: 'Entregas', items: [
        { to: '/remesas', label: 'Mis entregas', icon: 'money' }
      ] },
      { id: 'ayuda', label: null, items: [
        { to: '/help', label: 'Ayuda', icon: 'help' }
      ] }
    ])
  }

  if (isManager) {
    const canKitchen = has(LICENSE_MODULES.KITCHEN)
    const canCocktails = has(LICENSE_MODULES.COCKTAILS)
    // Misma etiqueta que el Inicio: con solo 'cocina' dice "Cocina", igual que siempre.
    const boardsLabel = canKitchen && canCocktails
      ? 'Cocina y coctelería'
      : (canKitchen ? 'Cocina' : 'Coctelería')

    return compact([
      { id: 'principal', label: null, items: [
        { to: '/', label: 'Inicio', icon: 'home', end: true },
        { to: '/dashboard', label: 'Panel del dueño', icon: 'dashboard' }
      ] },
      { id: 'vender', label: 'Vender y caja', items: [
        when(canSell, { to: '/sell', label: 'Vender', icon: 'money' }),
        { to: '/shift', label: 'Turno', icon: 'shift' },
        when(has(LICENSE_MODULES.TABLES), { to: '/salon', label: 'Mesas', icon: 'tables' }),
        { to: '/handoff', label: 'Traspaso de turno', icon: 'swap' },
        { to: '/finances', label: 'Deudas y caja', icon: 'wallet' }
      ] },
      { id: 'inventario', label: 'Inventario', items: [
        { to: '/catalog', label: 'Catálogo', icon: 'package' },
        { to: '/entry', label: 'Entrada de mercancía', icon: 'in' },
        when(areas.length > 0, { to: '/transfer', label: 'Salida a áreas', icon: 'send' }),
        when(has(LICENSE_MODULES.WHOLESALE), { to: '/convert', label: 'Conversión', icon: 'split' }),
        when(has(LICENSE_MODULES.ELABORATION) && elab.enabled,
          { to: '/elaboracion', label: elab.name, icon: 'factory' }),
        { to: '/count', label: 'Conteo físico', icon: 'clipboard' },
        { to: '/mermas', label: 'Mermas', icon: 'out' }
      ] },
      { id: 'cocina', label: boardsLabel, items: [
        when(canKitchen || canCocktails, { to: '/recetas', label: 'Recetas', icon: 'chef' }),
        when(canKitchen, { to: '/cocina', label: 'Tablero de cocina', icon: 'pot' }),
        when(canCocktails, { to: '/cocteleria', label: 'Tablero de coctelería', icon: 'cocktail' })
      ] },
      { id: 'gestion', label: 'Gestión', items: [
        { to: '/reports', label: 'Reportes', icon: 'file' },
        when(isOwner, { to: '/submayor', label: 'Submayor por producto', icon: 'book' }),
        { to: '/audit', label: 'Auditoría', icon: 'shield' },
        when(has(LICENSE_MODULES.ACCOUNTS), { to: '/partners', label: 'Proveedores y terceros', icon: 'handshake' }),
        when(has(LICENSE_MODULES.ACCOUNTS), { to: '/accounts', label: 'Cuentas', icon: 'wallet' }),
        when(has(LICENSE_MODULES.COSTSHEETS), { to: '/fichas', label: 'Fichas de costo', icon: 'calc' }),
        when(has(LICENSE_MODULES.REMESAS),
          { to: '/remesas', label: 'Entregas', icon: 'money', badge: pendingCollection })
      ] },
      { id: 'sistema', label: 'Sistema', items: [
        when(isOwner, { to: '/cloud', label: 'Sincronización', icon: 'sync' }),
        when(isOwner, { to: '/backup', label: 'Respaldo', icon: 'save' }),
        when(isOwner, { to: '/users', label: 'Usuarios', icon: 'users' }),
        when(isOwner, { to: '/settings', label: 'Ajustes', icon: 'settings' })
      ] },
      { id: 'ayuda', label: null, items: [
        { to: '/help', label: 'Ayuda', icon: 'help' }
      ] }
    ])
  }

  // Vendedor y elaborador. Los dos tableros exigen SU modulo Y el permiso del
  // dueno, y solo los ve el vendedor: el elaborador comparte esta rama y no.
  const sellerKitchen = isSeller && has(LICENSE_MODULES.KITCHEN) && sellerKitchenBoard
  const sellerCocktails = isSeller && has(LICENSE_MODULES.COCKTAILS) && sellerCocktailBoard
  const boardsLabel = sellerKitchen && sellerCocktails
    ? 'Cocina y coctelería'
    : (sellerKitchen ? 'Cocina' : 'Coctelería')

  return compact([
    { id: 'principal', label: null, items: [
      { to: '/', label: 'Inicio', icon: 'home', end: true },
      { to: '/catalog', label: 'Catálogo', icon: 'package' }
    ] },
    { id: 'vender', label: 'Vender y caja', items: [
      when(canSell, { to: '/sell', label: 'Vender', icon: 'money' }),
      { to: '/shift', label: 'Turno', icon: 'shift' },
      when(has(LICENSE_MODULES.TABLES), { to: '/salon', label: 'Mesas', icon: 'tables' })
    ] },
    { id: 'elaboracion', label: 'Elaboración', items: [
      when(isElaborator && has(LICENSE_MODULES.ELABORATION) && elab.enabled,
        { to: '/elaboracion', label: elab.name, icon: 'factory' })
    ] },
    { id: 'tableros', label: boardsLabel, items: [
      when(sellerKitchen, { to: '/cocina', label: 'Tablero de cocina', icon: 'pot' }),
      when(sellerCocktails, { to: '/cocteleria', label: 'Tablero de coctelería', icon: 'cocktail' })
    ] },
    { id: 'inventario', label: 'Inventario', items: [
      when(sellerEntries, { to: '/entry', label: 'Entrada de mercancía', icon: 'in' })
    ] },
    { id: 'operacion', label: 'Operación', items: [
      { to: '/handoff', label: 'Traspaso de turno', icon: 'swap' },
      { to: '/count', label: 'Conteo físico', icon: 'clipboard' }
    ] },
    { id: 'ayuda', label: null, items: [
      { to: '/help', label: 'Ayuda', icon: 'help' }
    ] }
  ])
}

// Todas las rutas que la barra puede llegar a ofrecer, para que la suite pueda
// afirmar "con licencia vacia NINGUNA ruta de modulo aparece" sin tener que
// repetir la lista a mano (una lista repetida a mano se queda vieja y la prueba
// deja de medir).
export const MODULE_ROUTES = {
  [LICENSE_MODULES.TABLES]: ['/salon'],
  [LICENSE_MODULES.WHOLESALE]: ['/convert'],
  [LICENSE_MODULES.ELABORATION]: ['/elaboracion'],
  // `/recetas` la abre CUALQUIERA de los dos modulos de elaboracion; se lista
  // aqui una sola vez porque lo que la suite comprueba es que sin NINGUN modulo
  // no aparezca.
  [LICENSE_MODULES.KITCHEN]: ['/cocina', '/recetas'],
  [LICENSE_MODULES.COCKTAILS]: ['/cocteleria'],
  [LICENSE_MODULES.ACCOUNTS]: ['/partners', '/accounts'],
  [LICENSE_MODULES.COSTSHEETS]: ['/fichas'],
  [LICENSE_MODULES.REMESAS]: ['/remesas']
}

// Aplana a rutas, que es como la suite y la pantalla quieren mirarlo.
export const flatRoutes = (groups) => groups.flatMap((g) => g.items.map((i) => i.to))
