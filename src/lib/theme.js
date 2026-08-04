// Tema claro/oscuro (Fase 8 - B1). Preferencia LOCAL del dispositivo: vive en
// localStorage para poder aplicarse ANTES de pintar (sin parpadeo) y NO viaja a
// la nube (cada dispositivo elige el suyo). El DEFAULT es 'dark' (el tema
// clasico de la app): sin nada guardado, todo queda igual que hoy.
//
// Se aplica poniendo data-theme en <html>; el CSS del modo claro sobreescribe
// las variables solo cuando data-theme="light" (el :root oscuro no se toca).
const KEY = 'mc_theme'

export function getTheme() {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

// Aplica el tema al documento (idempotente). Devuelve el tema aplicado.
export function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark'
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = t
  return t
}

// Guarda la preferencia y la aplica. Devuelve el tema activo.
export function setTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark'
  try { localStorage.setItem(KEY, t) } catch { /* almacenamiento no disponible */ }
  return applyTheme(t)
}
