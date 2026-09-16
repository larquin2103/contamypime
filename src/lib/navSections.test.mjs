// Pruebas PURAS del inventario de la barra lateral de escritorio.
// Sin framework: ejecutar con  `node src/lib/navSections.test.mjs`.
//
// QUE EXISTE ESTA SUITE PARA CAZAR: una FUGA DE LICENCIA. La barra inferior
// tiene 6 entradas y sus puertas se leen de un vistazo; la lateral pasa de
// veinte, y ahi es donde un `hasModule(...)` olvidado deja a la vista -y
// clicable- una funcion que el negocio no compro. Tambien caza el caso mas
// sutil: el TITULO de un grupo que se queda solo, que delata el modulo aunque
// no haya ninguna entrada debajo.
import { buildNavSections, MODULE_ROUTES, flatRoutes } from './navSections.js'
import { LICENSE_MODULES } from './license.js'

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return }
  fail++
  console.error(`FAIL ${label}\n  esperado: ${expected}\n  obtenido: ${actual}`)
}
const ok = (cond, label) => eq(!!cond, true, label)
const no = (cond, label) => eq(!!cond, false, label)

const rutas = (ctx) => flatRoutes(buildNavSections(ctx))
const tiene = (ctx, ruta) => rutas(ctx).includes(ruta)
const etiquetas = (ctx) => buildNavSections(ctx).map((g) => g.label).filter(Boolean)

// Los diez modulos que existen hoy, para "con todo comprado" y para el barrido.
const TODOS = Object.values(LICENSE_MODULES)
// Todas las rutas que algun modulo abre.
const RUTAS_DE_MODULO = Object.values(MODULE_ROUTES).flat()

// Contextos base. El mando es el que trabaja en la computadora, asi que es el
// que mas se prueba.
const duenoPelado = { isOwner: true, isManager: true, modules: [] }
const duenoTodo = {
  isOwner: true, isManager: true, modules: TODOS, areas: ['Víveres'],
  elaboration: { enabled: true, name: 'Elaboración' }, pendingCollection: 3
}
const admin = { isOwner: false, isManager: true, modules: [] }
const vendedor = { isSeller: true, canSell: true, modules: [] }

// ---------------------------------------------------------------- 1. Fugas

console.log('1. Fugas de licencia')

// La prueba central: licencia SIN modulos -> ninguna ruta de modulo, para
// ninguno de los roles que pueden llegar a verla.
for (const [quien, ctx] of [
  ['dueño', duenoPelado],
  ['administrativo', admin],
  ['vendedor', vendedor],
  ['elaborador', { isElaborator: true, modules: [] }]
]) {
  const rs = rutas(ctx)
  for (const r of RUTAS_DE_MODULO) {
    no(rs.includes(r), `sin licencia, ${quien} no ve ${r}`)
  }
}

// Y el barrido inverso: con UN SOLO modulo comprado, aparecen sus rutas y NO
// las de los otros nueve. Esto es lo que caza una puerta copiada y pegada mal
// (el fallo clasico: gatear "Cuentas" con el modulo de "Mesas").
for (const m of Object.keys(MODULE_ROUTES)) {
  const ctx = {
    ...duenoTodo, modules: [m],
    // El centro de elaboracion necesita ADEMAS su interruptor de configuracion.
    elaboration: { enabled: true, name: 'Elaboración' }
  }
  const rs = rutas(ctx)
  for (const r of MODULE_ROUTES[m]) ok(rs.includes(r), `con '${m}' aparece ${r}`)
  for (const [otro, suyas] of Object.entries(MODULE_ROUTES)) {
    if (otro === m) continue
    for (const r of suyas) {
      // '/recetas' la abren cocina Y cocteleria, y '/cocina'/'/cocteleria' son
      // rutas propias de cada uno: solo se exige exclusion de lo que no comparte.
      if (MODULE_ROUTES[m].includes(r)) continue
      if (r === '/recetas' && m === LICENSE_MODULES.COCKTAILS) continue
      no(rs.includes(r), `con solo '${m}' NO aparece ${r} (de '${otro}')`)
    }
  }
}

// CONTROL NEGATIVO: sin el, las 100+ aserciones de arriba pasarian aunque la
// funcion devolviera siempre una lista vacia. Aqui se comprueba que el metodo
// SI detecta lo que dice detectar.
{
  const conTodo = rutas(duenoTodo)
  let vistas = 0
  for (const r of RUTAS_DE_MODULO) if (conTodo.includes(r)) vistas++
  eq(vistas, RUTAS_DE_MODULO.length, 'control negativo: con los 10 modulos SI salen las 10 rutas')
}

// ------------------------------------------------- 2. Grupos vacios/titulos

console.log('2. Ningun titulo huerfano')

// Un grupo sin entradas delata el modulo aunque no haya nada clicable.
for (const ctx of [duenoPelado, admin, vendedor, { isCook: true, modules: [] }, { isCourier: true, modules: [] }]) {
  for (const g of buildNavSections(ctx)) {
    ok(g.items.length > 0, `ningun grupo vacio (${g.id})`)
  }
}
// Sin cocina ni cocteleria, el grupo de tableros no existe -ni con su etiqueta.
no(etiquetas(duenoPelado).includes('Cocina'), 'sin modulos no hay grupo "Cocina"')
no(etiquetas(duenoPelado).includes('Coctelería'), 'sin modulos no hay grupo "Coctelería"')
no(etiquetas(duenoPelado).includes('Cocina y coctelería'), 'sin modulos no hay grupo combinado')

// La etiqueta combinada solo con los DOS modulos (igual que en el Inicio).
const conCocina = { ...duenoPelado, modules: [LICENSE_MODULES.KITCHEN] }
const conCoctel = { ...duenoPelado, modules: [LICENSE_MODULES.COCKTAILS] }
const conAmbos = { ...duenoPelado, modules: [LICENSE_MODULES.KITCHEN, LICENSE_MODULES.COCKTAILS] }
ok(etiquetas(conCocina).includes('Cocina'), 'solo cocina -> "Cocina"')
ok(etiquetas(conCoctel).includes('Coctelería'), 'solo cocteleria -> "Coctelería"')
ok(etiquetas(conAmbos).includes('Cocina y coctelería'), 'los dos -> "Cocina y coctelería"')

// ------------------------------------------------------- 3. Puertas de rol

console.log('3. Puertas de rol')

// Lo exclusivo del dueño no lo ve el administrativo (que es mando, pero no dueño).
for (const r of ['/settings', '/users', '/cloud', '/backup', '/submayor']) {
  ok(tiene({ ...duenoTodo }, r), `el dueño ve ${r}`)
  no(tiene({ ...duenoTodo, isOwner: false }, r), `el administrativo NO ve ${r}`)
}
// El mando ve el panel; el vendedor no.
ok(tiene(duenoPelado, '/dashboard'), 'el mando ve el panel del dueño')
no(tiene(vendedor, '/dashboard'), 'el vendedor NO ve el panel del dueño')
// El mensajero no maneja catalogo ni turno (igual que en la barra inferior).
no(tiene({ isCourier: true, modules: TODOS }, '/catalog'), 'el mensajero NO ve el catálogo')
no(tiene({ isCourier: true, modules: TODOS }, '/shift'), 'el mensajero NO ve el turno')
// El cocinero no maneja turno, pero si catalogo (como en la barra inferior).
no(tiene({ isCook: true, modules: TODOS }, '/shift'), 'el cocinero NO ve el turno')
ok(tiene({ isCook: true, modules: TODOS }, '/catalog'), 'el cocinero SI ve el catálogo')
// Roles acotados: no se les cuela nada del mando aunque el negocio tenga todo.
for (const r of ['/dashboard', '/reports', '/audit', '/settings', '/accounts', '/fichas']) {
  no(tiene({ isCook: true, modules: TODOS }, r), `al cocinero no se le cuela ${r}`)
  no(tiene({ isCourier: true, modules: TODOS }, r), `al mensajero no se le cuela ${r}`)
}

// ------------------------------------------------- 4. Permisos y config

console.log('4. Permisos del dueño y configuracion')

// "Vender" solo con turno abierto: es la regla de oro del proyecto.
ok(tiene({ ...duenoTodo, canSell: true }, '/sell'), 'con turno abierto aparece Vender')
no(tiene({ ...duenoTodo, canSell: false }, '/sell'), 'sin turno NO aparece Vender')
// "Salida a áreas" no tiene sentido sin areas configuradas.
ok(tiene({ ...duenoTodo, areas: ['Víveres'] }, '/transfer'), 'con areas aparece la salida')
no(tiene({ ...duenoTodo, areas: [] }, '/transfer'), 'sin areas NO aparece la salida')
// El centro de elaboracion exige modulo Y su interruptor.
no(tiene({ ...duenoTodo, elaboration: { enabled: false, name: 'Elaboración' } }, '/elaboracion'),
  'modulo elaboracion pero apagado -> no aparece')
// El vendedor solo da entradas con el permiso del dueño.
no(tiene(vendedor, '/entry'), 'vendedor sin permiso NO ve entradas')
ok(tiene({ ...vendedor, sellerEntries: true }, '/entry'), 'vendedor con permiso SI ve entradas')
// Los tableros del vendedor: modulo Y permiso, y nunca para el elaborador.
no(tiene({ ...vendedor, modules: [LICENSE_MODULES.KITCHEN] }, '/cocina'),
  'vendedor con cocina pero sin permiso NO ve el tablero')
ok(tiene({ ...vendedor, modules: [LICENSE_MODULES.KITCHEN], sellerKitchenBoard: true }, '/cocina'),
  'vendedor con cocina y permiso SI ve el tablero')
no(tiene({ isElaborator: true, modules: [LICENSE_MODULES.KITCHEN], sellerKitchenBoard: true }, '/cocina'),
  'el elaborador NUNCA ve el tablero de cocina')

// ----------------------------------------------------- 5. Forma del dato

console.log('5. Forma del dato')

// Ninguna ruta repetida: la misma pantalla dos veces en la barra es un error
// de composicion (y en la lateral se ve enseguida).
for (const ctx of [duenoTodo, vendedor, { isCook: true, modules: TODOS }]) {
  const rs = rutas(ctx)
  eq(new Set(rs).size, rs.length, 'sin rutas repetidas')
}
// Toda entrada tiene destino, etiqueta e icono: sin uno de los tres la barra
// pinta un hueco mudo.
for (const g of buildNavSections(duenoTodo)) {
  for (const it of g.items) {
    ok(typeof it.to === 'string' && it.to.startsWith('/'), `destino valido: ${it.label}`)
    ok(typeof it.label === 'string' && it.label.length > 0, `etiqueta: ${it.to}`)
    ok(typeof it.icon === 'string' && it.icon.length > 0, `icono: ${it.to}`)
  }
}
// El Inicio va con `end` (si no, se queda marcado en TODAS las rutas).
{
  const inicio = buildNavSections(duenoTodo)[0].items[0]
  eq(inicio.to, '/', 'la primera entrada es el Inicio')
  ok(inicio.end, 'el Inicio va con `end` para no quedarse activo en todo')
}
// El contador de "por cobrar" viaja hasta la entrada de Entregas.
{
  const e = buildNavSections(duenoTodo).flatMap((g) => g.items).find((i) => i.label === 'Entregas')
  eq(e?.badge, 3, 'el contador de entregas por cobrar llega a la barra')
}
// Llamarla sin contexto no puede reventar (la barra se monta antes de que
// resuelvan las consultas de configuracion).
{
  const vacio = buildNavSections()
  ok(Array.isArray(vacio), 'sin contexto devuelve una lista')
  eq(flatRoutes(vacio).filter((r) => RUTAS_DE_MODULO.includes(r)).length, 0,
    'sin contexto no se cuela ninguna ruta de modulo')
}

console.log(`\n${pass} aserciones OK, ${fail} fallos`)
process.exit(fail === 0 ? 0 : 1)
