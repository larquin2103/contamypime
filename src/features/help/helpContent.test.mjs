// Pruebas PURAS del filtro de visibilidad de la AYUDA.
// Sin framework: ejecutar con  `node src/features/help/helpContent.test.mjs`.
//
// QUE EXISTE ESTA SUITE PARA CAZAR: una FUGA DE LICENCIA por la ayuda. Explicar en
// la guia una funcion que el negocio no compro es una fuga como cualquier otra, y
// este predicado es lo unico que lo impide. Hasta B4 estaba COPIADO literalmente en
// `HelpScreen` y en `helpPdf`: bastaba con tocar una copia y olvidar la otra para
// que el PDF colara lo que la pantalla oculta. Ahora es una sola funcion, y estas
// aserciones la fijan.
import { HELP_ARTICLES, HELP_SECTIONS, isArticleVisible, visibleArticles } from './helpContent.js'

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  console.error(`FAIL ${label}\n  esperado: ${e}\n  obtenido: ${a}`)
}
const ok = (cond, label) => eq(!!cond, true, label)

const base = { id: 'x', section: 'Uso diario', audience: 'owner', title: 't', teaser: 't', body: [] }
const seller = { ...base, audience: 'seller' }

// --- 1) El lado SEGURO por defecto -------------------------------------------
// `modules` vacio por defecto: quien llame sin pasarlo OCULTA la ayuda de los
// modulos en vez de colarla. Es el mismo criterio que el default de downloadHelpPdf.
eq(isArticleVisible({ ...base, module: 'cocina' }), false,
  'sin pasar modulos, un articulo de modulo NO se ve')
eq(isArticleVisible({ ...base, modules: ['cocina', 'cocteleria'] }), false,
  'sin pasar modulos, un articulo multi-modulo tampoco')
eq(isArticleVisible(base), true, 'un articulo BASE se ve siempre')
eq(isArticleVisible(null), false, 'sin articulo, false (no revienta)')

// --- 2) `module`: exige ESE modulo -------------------------------------------
{
  const a = { ...base, module: 'mesas' }
  eq(isArticleVisible(a, { modules: [] }), false, 'module: sin el, no se ve')
  eq(isArticleVisible(a, { modules: ['cocina'] }), false, 'module: con otro, no se ve')
  eq(isArticleVisible(a, { modules: ['mesas'] }), true, 'module: con el suyo, se ve')
  eq(isArticleVisible(a, { modules: ['mesas', 'cocina'] }), true, 'module: entre varios, se ve')
}

// --- 3) `modules`: basta con UNO (lo que necesita el articulo del descubierto) --
{
  const a = { ...base, modules: ['cocina', 'cocteleria'] }
  eq(isArticleVisible(a, { modules: [] }), false, 'modules: sin ninguno, no se ve')
  eq(isArticleVisible(a, { modules: ['mesas'] }), false, 'modules: con uno ajeno, no se ve')
  eq(isArticleVisible(a, { modules: ['cocina'] }), true, 'modules: basta con el primero')
  eq(isArticleVisible(a, { modules: ['cocteleria'] }), true, 'modules: basta con el segundo')
  eq(isArticleVisible(a, { modules: ['cocina', 'cocteleria'] }), true, 'modules: con los dos, se ve')
}

// --- 4) `module` + `modules` juntos: se exigen LOS DOS criterios --------------
{
  const a = { ...base, module: 'mesas', modules: ['cocina', 'cocteleria'] }
  eq(isArticleVisible(a, { modules: ['mesas'] }), false, 'module+modules: falta el any-of')
  eq(isArticleVisible(a, { modules: ['cocina'] }), false, 'module+modules: falta el exigido')
  eq(isArticleVisible(a, { modules: ['mesas', 'cocina'] }), true, 'module+modules: con ambos, se ve')
}

// --- 5) El ROL manda por encima del modulo -----------------------------------
eq(isArticleVisible(base, { isManager: false }), false, 'el vendedor NO ve un articulo de dueño')
eq(isArticleVisible(seller, { isManager: false }), true, 'el vendedor ve los suyos')
eq(isArticleVisible(seller, { isManager: true }), true, 'el mando ve tambien los del vendedor')
eq(isArticleVisible({ ...seller, module: 'cocina' }, { isManager: false, modules: [] }), false,
  'un articulo del vendedor CON modulo sigue exigiendo el modulo')

// --- 6) El contenido real cumple el contrato ---------------------------------
// Cada articulo con puerta de licencia debe declararla bien, y ningun articulo puede
// quedarse sin seccion valida (si no, no se pinta en ningun sitio).
for (const a of HELP_ARTICLES) {
  ok(HELP_SECTIONS.includes(a.section), `"${a.id}" pertenece a una seccion existente`)
  ok(a.audience === 'owner' || a.audience === 'seller', `"${a.id}" tiene audiencia valida`)
  if (a.modules) ok(Array.isArray(a.modules) && a.modules.length > 0, `"${a.id}" declara \`modules\` como lista no vacia`)
}
// Los articulos gateados de hoy, y que NINGUNO se cuela sin su licencia.
const gated = HELP_ARTICLES.filter((a) => a.module || a.modules).map((a) => a.id)
eq(gated, ['cocteleria', 'descubierto', 'ficha-que-es', 'ficha-llenar'],
  'la lista de articulos con puerta de licencia es la esperada')
eq(visibleArticles({ modules: [] }).filter((a) => gated.includes(a.id)), [],
  'con licencia pelada NO se cuela NINGUNO de ellos')
eq(visibleArticles({ modules: ['cocteleria'] }).filter((a) => gated.includes(a.id)).map((a) => a.id),
  ['cocteleria', 'descubierto'],
  'con solo cocteleria se ven los dos suyos y ninguno de fichas')

console.log(`${pass} pass, ${fail} fail`)
if (fail) process.exit(1)
