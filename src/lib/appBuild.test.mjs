// Version de la app: reglas puras. Se corre con node directo.
import { buildIdFromHtml, buildIdFromSrc, buildStatus } from './appBuild.js'
let pass = 0
let fail = 0
const ok = (c, l) => { if (c) pass++; else { fail++; console.error('FAIL', l) } }
// Fragmento LITERAL de dist/index.html (build del 06-10-2026): script, css y el registro del sw.
const HTML = `    <script type="module" crossorigin src="/assets/index-B2nIvllc.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-B34NE6G1.css">
  <link rel="manifest" href="/manifest.webmanifest"><script id="vite-plugin-pwa:register-sw" src="/registerSW.js"></script></head>`
ok(buildIdFromHtml(HTML) === 'B2nIvllc', `hash del index.html real (${buildIdFromHtml(HTML)})`)
ok(buildIdFromHtml('<link href="/assets/index-B34NE6G1.css">') === null, 'el CSS no cuenta como version')
ok(buildIdFromHtml('<script src="/assets/index.esm-D9CbOI2C.js"></script>') === null, 'otros chunks (index.esm-) no cuentan')
ok(buildIdFromHtml('<script type="module" src="/src/main.jsx"></script>') === null, 'servidor de desarrollo -> null')
ok(buildIdFromHtml('') === null && buildIdFromHtml(null) === null, 'vacio o nulo -> null')
ok(buildIdFromSrc('https://mypicuadre.web.app/assets/index-B2nIvllc.js') === 'B2nIvllc', 'src absoluto del documento')
ok(buildIdFromSrc('/assets/index-Ab_c-12.js') === 'Ab_c-12', 'hash con _ y -')
ok(buildIdFromSrc(undefined) === null, 'sin src -> null')
ok(buildIdFromSrc('/assets/index-B34NE6G1.css') === null, 'un src .css no es la version (ENTRY exige .js)')
ok(buildStatus('B2nIvllc', 'B2nIvllc') === 'al-dia', 'iguales -> al dia')
ok(buildStatus('B2nIvllc', 'Zz99yyXX') === 'nueva', 'distintos -> hay una nueva')
ok(buildStatus(null, 'B2nIvllc') === 'desconocida' && buildStatus('B2nIvllc', null) === 'desconocida', 'si falta uno -> desconocida, nunca "al dia"')
console.log(`appBuild: ${pass} OK / ${fail} fallos`)
if (fail) process.exit(1)
