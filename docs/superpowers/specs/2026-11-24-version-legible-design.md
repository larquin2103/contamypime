# Versión legible en la Ayuda — diseño corto

Fecha: 24-11-2026 · Rama: `claude/awesome-dirac-484azm` (base `7aa2e2a`) · Tamaño: cambio pequeño.

## Intención (palabras del dueño)

> «lo que quiero es que ese código sea algo entendible, no un código raro»

La tarjeta *Versión de la app* (`src/features/help/AppVersionCard.jsx`) muestra hoy el hash del chunk
de entrada (`B2nIvllc`). Debe mostrar algo que cualquiera entienda y que **siga cambiando en cada
build** (para comparar teléfonos y saber cuál va atrasado).

## Qué se construye (enfoque A, elegido por el dueño)

- **Fecha y hora del build:** la tarjeta dice `Versión del 24-11-2026 · 18:30`, y si hay una más
  nueva: «Hay una versión nueva (del 26-11-2026 · 09:15). Cierra la app del todo y vuelve a abrirla
  con internet.»
- **De dónde sale la fecha:** un plugin mínimo en `vite.config.js` (`transformIndexHtml`) escribe en
  el `index.html` del build `<meta name="app-build-time" content="<ISO UTC del build>">`.
  - La versión **en ejecución** se lee de esa etiqueta en el propio documento (el `index.html` que
    cargó este JS, servido por el precache con la misma revisión).
  - La versión **publicada** se lee de la misma etiqueta en el `index.html` que ya se descarga hoy
    para comprobar.
- **La comprobación «al día / hay una nueva» NO cambia:** sigue comparando el hash del chunk
  (`buildStatus`), que es robusto. La fecha es solo lo que se **muestra**.
- **Formato:** `dd-mm-aaaa · HH:MM` en la hora local del teléfono. Lógica pura nueva en
  `src/lib/appBuild.js` (`buildTimeFromHtml(html)` y `buildTimeLabel(iso)`), probada en
  `appBuild.test.mjs`.
- **Sin la etiqueta** (servidor de desarrollo, o un `index.html` anterior a este cambio): se cae a lo
  de hoy — «desarrollo» o el hash —, nunca se inventa una fecha.

## Decisión mía (corregible): la fecha va SOLO en el `index.html`, no en el JS

Meterla en el bundle (`define`) haría que el chunk principal cambie **en cada build aunque el código
sea el mismo**: cada despliegue obligaría a todos los teléfonos a bajarse ~314 kB gzip, y las
auditorías perderían la comparación byte a byte del JS entre árboles. En el `index.html` solo cambia
ese fichero (que ya cambia con el hash); el JS sigue siendo determinista.

**Coste declarado:** como el `index.html` cambia en cada build, el service worker verá un
`index.html` nuevo en cada despliegue aunque el código no cambie (unos pocos kB), y la tarjeta
mostraría una fecha nueva con el mismo código. Es inofensivo y coherente: es la fecha del build.

## Enfoques considerados

- **A — fecha y hora del build (elegido).**
- **B — número correlativo desde git** (`Versión 533`): entendible pero sin referencia, y vacío si
  se construye fuera de git.
- **Descartado — versión de Dexie** (`19`): no cambia entre builds; no distingue un teléfono viejo.

## Restricciones

- Cero cambios de datos, esquema, sync, repos o reglas. `vite.config.js` solo gana el plugin
  (aditivo); `VitePWA` y su configuración no se tocan.
- El chunk JS principal debe quedar **byte a byte igual** entre dos builds seguidos del mismo
  código (se comprueba).
- Español en UI y comentarios; build limpio antes de commitear; commits sin coautoría.

## Lo que no se podrá garantizar

Nadie lo verá en un teléfono durante la validación: se comprueba con el `dist/index.html` real del
build y con las pruebas puras. Los teléfonos que aún tengan un build anterior seguirán mostrando su
código hasta actualizarse (su app vieja no sabe leer la fecha).
