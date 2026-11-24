# Versión legible en la Ayuda — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La tarjeta *Versión de la app* muestra `Versión del dd-mm-aaaa · HH:MM` (fecha y hora del build) en vez del hash del chunk.

**Architecture:** Un plugin mínimo en `vite.config.js` (solo en build) inyecta `<meta name="app-build-time" content="<ISO UTC>">` en el `index.html`. Dos funciones puras nuevas en `src/lib/appBuild.js` leen y formatean esa fecha. `AppVersionCard.jsx` muestra la fecha; la comprobación «al día / hay una nueva» sigue comparando el hash (`buildStatus`) sin cambios.

**Tech Stack:** Vite 6 (`transformIndexHtml`), React 18, node puro para las pruebas.

**Spec:** `docs/superpowers/specs/2026-11-24-version-legible-design.md` (aprobado 24-11-2026).

## Global Constraints

- Rama `claude/awesome-dirac-484azm` (base `e74b8d1`). Nada a `main`, sin push, no tocar `.atl/` ni `.superpowers/`.
- La fecha va **solo en el `index.html`**, nunca en el bundle JS (nada de `define`). El chunk `dist/assets/index-*.js` debe salir **byte a byte igual** en dos builds seguidos del mismo código.
- `VitePWA` y su configuración no se tocan; el plugin nuevo es aditivo y con `apply: 'build'`.
- `buildStatus`, `buildIdFromHtml` y `buildIdFromSrc` no cambian de conducta (sus 12 aserciones actuales siguen pasando sin tocarlas).
- Cero cambios en `src/db/`, `src/features/sync/`, `src/repositories/`, reglas, `package*.json`, `index.html` (fuente).
- Textos exactos: «Versión del <etiqueta>», «Hay una versión nueva (del <etiqueta>). Cierra la app del todo y vuelve a abrirla con internet.». Formato de etiqueta: `dd-mm-aaaa · HH:MM` (24 h, con ceros).
- Sin fecha disponible: se muestra lo de hoy (el hash, o «desarrollo»); nunca se inventa una fecha.
- Español en UI/comentarios/commits, estilo vecino, `npm run build` exit 0 antes de commitear, commits sin coautoría.

## Review Focus

1. **Cruce de medianoche en Cuba:** un build a las 03:10 UTC del 25 se muestra como `24-11-2026 · 22:10` en un teléfono en La Habana. Prueba `V5`.
2. **Meta ausente o corrupta** (build anterior, contenido que no es fecha): `null`, y la tarjeta cae al hash. Prueba `V3`.
3. **Orden de atributos distinto** en la etiqueta: se lee igual. Prueba `V2`.
4. **Determinismo del JS:** dos builds seguidos dan el mismo `index-*.js`. Task 1, Step 7.
5. **Ceros a la izquierda** en día, mes, hora y minuto. Prueba `V6`.

---

### Task 1: Fecha del build en el `index.html` y en la tarjeta

**Files:**
- Modify: `src/lib/appBuild.js` (añadir al final)
- Modify: `src/lib/appBuild.test.mjs` (añadir casos V1-V6 antes del `console.log` final)
- Modify: `vite.config.js` (plugin aditivo)
- Modify: `src/features/help/AppVersionCard.jsx`

**Interfaces:**
- Produces:
  - `buildTimeFromHtml(html: string|null) → string|null`: el `content` de `<meta name="app-build-time" …>` (cualquier orden de atributos) si es una fecha válida (`!isNaN(Date.parse(x))`); si no, `null`.
  - `buildTimeLabel(iso: string|null, timeZone?: string) → string|null`: `'dd-mm-aaaa · HH:MM'` en `timeZone` (por defecto la hora local del aparato), con `Intl.DateTimeFormat` (`hourCycle: 'h23'`); `null` si `iso` no es fecha válida.

- [ ] **Step 1: Línea base de las 44 suites**

Guarda la salida de cada suite (mismos comandos que en `CLAUDE.md` → «Pruebas») en `<scratch>/base-ver/<nombre>.txt`, `<scratch>` = `C:\Users\larquin\AppData\Local\Temp\claude\ee183b6b09d202b8\8231c060-52c0-4c3f-af65-cb775bb2362c\scratchpad`. Expected: 44 OK.

- [ ] **Step 2: Pruebas que fallan (en `appBuild.test.mjs`)**

```js
// V1 buildTimeFromHtml(`<meta name="app-build-time" content="2026-11-24T23:30:00.000Z">` + HTML) === '2026-11-24T23:30:00.000Z'
// V2 orden inverso: `<meta content="2026-11-24T23:30:00.000Z" name="app-build-time">` → la misma ISO
// V3 sin meta (HTML actual) → null; content="no-es-fecha" → null; '' y null → null;
//    otra meta (`<meta name="theme-color" content="#0a1f3c">`) → null
// V4 buildTimeLabel('2026-11-24T23:30:00.000Z', 'America/Havana') === '24-11-2026 · 18:30'
// V5 buildTimeLabel('2026-11-25T03:10:00.000Z', 'America/Havana') === '24-11-2026 · 22:10'
// V6 buildTimeLabel('2026-01-05T14:05:00.000Z', 'America/Havana') === '05-01-2026 · 09:05';
//    buildTimeLabel('nada') === null; buildTimeLabel(null) === null
```

- [ ] **Step 3: Ver el fallo**

Run: `node src/lib/appBuild.test.mjs` → falla (exports inexistentes).

- [ ] **Step 4: Implementar las dos funciones en `src/lib/appBuild.js`**

Comentario en el estilo del fichero: por qué la fecha vive en el `index.html` y no en el JS (determinismo del chunk), y que la versión sigue siendo el hash para comparar.

- [ ] **Step 5: Ver pasar**

Run: `node src/lib/appBuild.test.mjs` → `appBuild: 24 OK / 0 fallos` (12 de antes + 12 nuevas; si el recuento difiere, que sea porque V1-V6 tienen otro nº de `ok`, sin tocar las 12 viejas).

- [ ] **Step 6: Plugin y tarjeta**

- `vite.config.js`: constante `BUILD_TIME = new Date().toISOString()` calculada una vez al cargar la config, y un plugin `{ name: 'app-build-time', apply: 'build', transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'app-build-time', content: BUILD_TIME }, injectTo: 'head' }] }` añadido a `plugins` **antes** de `VitePWA`. Comentario en español: qué es y por qué no va en `define`.
- `AppVersionCard.jsx`: la versión en ejecución = `buildTimeLabel(document.querySelector('meta[name="app-build-time"]')?.content)`; el estado de la publicada pasa a guardar `{ id: buildIdFromHtml(html), time: buildTimeFromHtml(html) }`. `buildStatus` recibe los ids como hoy. Texto: `Versión del <etiqueta>`; sin etiqueta, lo de hoy (`running || 'desarrollo'`). En «nueva»: `(del <etiqueta de la publicada>)`, y sin ella el hash como hoy. El `null` de «no se pudo» y el `undefined` de «comprobando» conservan su significado.

- [ ] **Step 7: Verificar contra el build real**

1. `npm run build; echo $?` → 0. `dist/index.html` contiene **exactamente una** `<meta name="app-build-time" content="…">` y `buildTimeFromHtml(<contenido de dist/index.html>)` devuelve una ISO válida (comprobarlo con un one-liner de node que importe `src/lib/appBuild.js`). `buildIdFromHtml` sobre ese mismo fichero sigue devolviendo el hash del `index-*.js` que existe en `dist/assets/`.
2. Guarda el nombre y el SHA-256 de `dist/assets/index-*.js` y el `content` de la meta; vuelve a construir; el nombre y el SHA-256 del JS son **idénticos** y el `content` de la meta es **distinto** (control: demuestra que la fecha cambió y el JS no).
3. `grep -c "app-build-time" dist/assets/*.js` → 0 en todos (la fecha no se coló en el JS).

- [ ] **Step 8: Commit**

```bash
git add src/lib/appBuild.js src/lib/appBuild.test.mjs vite.config.js src/features/help/AppVersionCard.jsx
git commit -m "Ayuda: la versión se muestra como fecha y hora del build (no el código del chunk)"
```

### Task 2: Auditoría del cambio y acta

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Suites contra la línea base**

Corre las 44; las 43 distintas de `appBuild` deben dar salida **byte a byte idéntica** a `<scratch>/base-ver/` (`cmp`), con control negativo (un byte añadido a una copia se detecta). `appBuild` pasa con su nuevo recuento.

- [ ] **Step 2: Superficie**

`git diff --stat e74b8d1 HEAD -- src/db src/features/sync src/repositories firestore.rules firestore.indexes.json package.json package-lock.json index.html` → vacío. `git diff e74b8d1 HEAD -- vite.config.js` → solo líneas añadidas (leerlas). Líneas borradas en `src/` (sin tests): solo las de `AppVersionCard.jsx` sustituidas en el sitio (leerlas una a una). Cero escrituras (`.add/.put/.update/.delete/.bulkPut/.transaction(`). Identificadores libres = 0 en los 3 ficheros de producción, con control negativo.

- [ ] **Step 3: Mutaciones**

Sobre `appBuild.js`, revirtiendo con `git checkout --` tras cada una; cada una debe romper la suite: (1) formatear en UTC ignorando `timeZone`; (2) quitar los ceros a la izquierda; (3) aceptar cualquier `content` sin validar la fecha; (4) leer la primera `<meta>` de la página sin mirar `name`.

- [ ] **Step 4: Acta en `CLAUDE.md` y commit**

En «Estado del trabajo (06-10-2026)», punto 6 (versión visible en la Ayuda), una nota fechada 24-11-2026: ahora se muestra la fecha y hora del build (meta en el `index.html`, no en el JS), la comprobación sigue por hash, qué se verificó (build real, JS idéntico en dos builds, meta distinta) y lo que NO se garantiza (nadie lo ha visto en un teléfono; los teléfonos con el build viejo siguen mostrando el código hasta actualizarse; el `index.html` cambia en cada build aunque el código no). Actualiza el recuento de `appBuild` y los totales de «Pruebas».

```bash
npm run build
git add CLAUDE.md
git commit -m "Acta - versión legible en la Ayuda"
```
Borra `<scratch>/base-ver` al terminar.
