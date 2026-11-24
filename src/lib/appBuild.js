// Version de la app (auditoria de Rikisimo, 06-10-2026). `package.json` dice 0.1.0 desde
// junio y no distingue builds; lo que SI cambia en cada build es el nombre del chunk de
// entrada que Vite escribe en index.html (/assets/index-<hash>.js). Ese hash ES la version.
// Puras: no tocan el DOM ni la red; la tarjeta de la Ayuda les pasa el texto.
const ENTRY = /\/assets\/index-([A-Za-z0-9_-]+)\.js/

export function buildIdFromSrc(src) {
  const m = ENTRY.exec(String(src || ''))
  return m ? m[1] : null
}

// Hash del chunk de entrada dentro de un index.html. Solo cuenta el <script>: el CSS
// (index-*.css) y los demas chunks (index.esm-*.js) no son la version.
export function buildIdFromHtml(html) {
  const tags = String(html || '').match(/<script\b[^>]*\bsrc="[^"]*"[^>]*>/g) || []
  for (const t of tags) {
    const id = buildIdFromSrc(/\bsrc="([^"]*)"/.exec(t)[1])
    if (id) return id
  }
  return null
}

// Sin uno de los dos no se puede afirmar que esta al dia: 'desconocida', nunca 'al-dia'.
export function buildStatus(running, latest) {
  if (!running || !latest) return 'desconocida'
  return running === latest ? 'al-dia' : 'nueva'
}

// Fecha y hora del build, para MOSTRAR en la Ayuda (el hash no le dice nada al dueno).
// Viaja en una meta del index.html (`app-build-time`, la pone vite.config.js al construir)
// y NUNCA dentro del JS: si entrara al bundle, el chunk cambiaria de hash en cada build
// aunque el codigo fuera el mismo. La version para COMPARAR sigue siendo el hash de arriba.
export function buildTimeFromHtml(html) {
  const tags = String(html || '').match(/<meta\b[^>]*>/g) || []
  for (const t of tags) {
    if (!/\bname="app-build-time"/.test(t)) continue
    const c = /\bcontent="([^"]*)"/.exec(t)
    if (c && !isNaN(Date.parse(c[1]))) return c[1]
  }
  return null
}

// 'dd-mm-aaaa · HH:MM' en la zona dada (por defecto, la hora local del aparato).
export function buildTimeLabel(iso, timeZone) {
  if (!iso || isNaN(Date.parse(iso))) return null
  const p = {}
  for (const x of new Intl.DateTimeFormat('en-GB', {
    timeZone, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(iso))) p[x.type] = x.value
  return `${p.day}-${p.month}-${p.year} · ${p.hour}:${p.minute}`
}
