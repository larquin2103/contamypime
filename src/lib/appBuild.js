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
