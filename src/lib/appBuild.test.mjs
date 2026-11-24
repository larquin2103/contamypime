// Version de la app: reglas puras. Se corre con node directo.
import { buildIdFromHtml, buildIdFromSrc, buildStatus, buildTimeFromHtml, buildTimeLabel } from './appBuild.js'
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
// Fecha del build (meta app-build-time del index.html): es lo que se muestra en la Ayuda;
// la version para comparar sigue siendo el hash.
const ISO = '2026-11-24T23:30:00.000Z'
ok(buildTimeFromHtml(`<meta name="app-build-time" content="${ISO}">` + HTML) === ISO, 'V1 meta del build -> su ISO')
ok(buildTimeFromHtml(`<meta content="${ISO}" name="app-build-time">` + HTML) === ISO, 'V2 orden inverso de atributos -> la misma ISO')
ok(buildTimeFromHtml(HTML) === null, 'V3a sin meta -> null')
ok(buildTimeFromHtml('<meta name="app-build-time" content="no-es-fecha">') === null, 'V3b content que no es fecha -> null')
ok(buildTimeFromHtml('') === null && buildTimeFromHtml(null) === null, 'V3c vacio o nulo -> null')
ok(buildTimeFromHtml('<meta name="theme-color" content="#0a1f3c">') === null, 'V3d otra meta -> null')
ok(buildTimeLabel(ISO, 'America/Havana') === '24-11-2026 · 18:30', 'V4 etiqueta en hora de La Habana')
ok(buildTimeLabel('2026-11-25T03:10:00.000Z', 'America/Havana') === '24-11-2026 · 22:10', 'V5 cruce de medianoche UTC -> dia local')
ok(buildTimeLabel('2026-01-05T14:05:00.000Z', 'America/Havana') === '05-01-2026 · 09:05', 'V6a ceros a la izquierda (invierno)')
ok(buildTimeLabel('nada') === null, 'V6b no es fecha -> null')
ok(buildTimeLabel(null) === null, 'V6c nulo -> null')
ok(/^\d{2}-\d{2}-\d{4} · \d{2}:\d{2}$/.test(buildTimeLabel(ISO)), 'V6d sin zona: hora local con el mismo formato')
console.log(`appBuild: ${pass} OK / ${fail} fallos`)
if (fail) process.exit(1)
