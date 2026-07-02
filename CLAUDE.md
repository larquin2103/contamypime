# CLAUDE.md — Guía del proyecto MypiCuadre

Contexto para Claude Code (y para cualquier desarrollador) al trabajar en este repo.
El idioma del proyecto, la UI, los comentarios y los mensajes de commit es **español**.

## Qué es

**MypiCuadre**: sistema de gestión para una **MYPIME cubana** (comercio minorista con
varios vendedores por turnos). Es una **PWA instalable** en Android, **offline-first**:
todos los datos viven en IndexedDB y la app funciona al 100% sin internet. La
sincronización en la nube (Fase 4) es opcional y se activa por dispositivo.

## Stack

- **React 18 + Vite 6**, PWA con `vite-plugin-pwa` (service worker `autoUpdate`).
- **IndexedDB vía [Dexie](https://dexie.org/)** + `dexie-react-hooks` (`useLiveQuery`).
- **Firebase** (Fase 4): Auth (email/contraseña) + Firestore (cache offline persistente).
  Hosting en Firebase (plan Spark, gratis).
- **xlsx** (SheetJS), **jspdf** + **jspdf-autotable** para exportar — todos por
  importación dinámica (code-split).
- Sin framework de estado externo: Context Providers + Dexie live queries.

## Comandos

```bash
npm install        # instala dependencias (incluye el SDK firebase)
npm run dev        # desarrollo (localhost:5173)
npm run build      # build de producción a dist/ (NO imprime URL)
npm run preview    # previsualiza el build (localhost:4173)
npm run host       # dev server expuesto en la LAN (probar desde el teléfono)
npm run deploy     # build + firebase deploy --only hosting (AQUÍ sale la URL)
```

`firebase-tools` es una CLI **global por máquina** (no viene con `npm install`):
`npm install -g firebase-tools` + `firebase login`. Reglas de Firestore:
`firebase deploy --only firestore:rules`.

## Arquitectura y convenciones

```
src/
├── app/
│   ├── router.jsx            # decide onboarding / login / app
│   └── providers/            # AuthProvider, CurrencyProvider, ShiftProvider, SyncProvider
├── db/
│   ├── db.js                 # instancia Dexie + versiones de esquema
│   ├── constants.js          # enums (roles, monedas, estados, etc.)
│   └── seed.js               # config mínima en el primer arranque
├── repositories/             # ÚNICA puerta de acceso a datos (1 por colección)
├── features/                 # cada función de negocio en su carpeta
│   ├── auth/ settings/ home/ products/ import/ shifts/ sales/
│   ├── inventory/ cash/ handoff/ dashboard/ audit/ reports/ sync/ help/
├── components/               # UI compartida (PinInput, Layout, CashInputs, ...)
├── lib/                      # utilidades puras (ids, pin, currency, dates, search, firebase)
└── styles/global.css         # estilos globales (tema oscuro, clases .card .btn .field ...)
```

**Reglas de diseño (respetarlas siempre):**
- **Claves primarias = UUID string** en todas las colecciones → migración limpia a la nube.
- **Nada se borra:** borrado lógico (`deletedAt`/`voided`/`active`) y correcciones como
  **ajustes nuevos** con nota y marca de tiempo (append-only / auditable).
- **El stock real se deriva de `stockMovements`** (libro mayor). `products.stock` es solo
  una **caché** para mostrar rápido; se actualiza dentro de la misma transacción.
- **El precio se congela por línea de venta** (un cambio de precio no altera ventas pasadas).
- **La capa `repositories/` aísla el acceso a datos.** Las pantallas NO tocan Dexie
  directamente; van por los repos. Esto permitió montar la sync sin reescribir pantallas.
- **Toda mutación actualiza una marca de tiempo** (`updatedAt`/`closedAt`/`settledAt`/...).
  De esto depende el motor de sincronización; mantenerlo al crear nuevos repos.

**Estilo de código:** imita el código vecino (densidad de comentarios, nombres, idioma).
Importaciones pesadas (xlsx/jspdf/firebase) siempre con `import()` dinámico.

## Roles y autenticación

- **Login por PIN** (hash PBKDF2 vía WebCrypto, `src/lib/pin.js`). Sesión en `sessionStorage`.
- **Dueño (OWNER)**: único; hace todo. Etiqueta `ROLE_LABELS.OWNER = 'Dueño'` (con ñ).
- **Administrativo (ADMIN, Bloque 20.6)**: cargo de confianza que el dueño designa en
  *Usuarios*. Opera **como otro dueño** en inventario y supervisión: entradas y salidas del
  almacén, **autoriza** al vendedor (su PIN sirve en `OwnerAuthModal`), fuerza cierres de turno,
  aprueba conteos físicos, cambia precios/catálogo y **ve la información financiera** (reportes,
  panel del dueño, auditoría, costos). **NO** gestiona usuarios, **ni** la licencia, **ni** la
  sincronización (la identidad del negocio sigue siendo del dueño). El flag derivado
  `isManager = isOwner || isAdmin` (en `AuthProvider`) habilita todo lo de "mando"; lo exclusivo
  del dueño se sigue comprobando con `isOwner`.
- **Vendedor (SELLER)**: solo **ventas + extracciones de caja + deuda interna**, estas dos
  últimas **con autorización del dueño o de un administrativo** (`OwnerAuthModal` →
  `usersRepo.verifyManagerPin`). **NO** hace entradas, NO cambia precios, NO ve costos, NO crea usuarios.
- **Regla de oro:** solo el vendedor con **su turno abierto** puede vender (ni el dueño sin turno).
  Desde el Bloque 19, **varios vendedores pueden tener turno a la vez** (uno por área); el turno
  es por vendedor (`shiftsRepo.getActiveFor(sellerId)`), no global.
- **Recuperación de PIN** del dueño mediante **código de recuperación** (hash) que se genera
  en el onboarding y se puede regenerar en Ajustes.

## Áreas de venta (Fase 6 — Bloque 19)

Un punto de venta puede dividirse en **áreas** (ej: Víveres, Carnicería), cada una con su
**caja y cuadre propios**. Diseño (validado con el dueño):
- **Turno por vendedor:** cada vendedor abre su turno eligiendo un área (lista fija definida por
  el dueño en Ajustes → clave de config `areas`). Varios turnos abiertos a la vez = normal.
  La caja inicial se hereda del **último cierre de la misma área** (`lastClosedCash(area)`).
- **Catálogo global, cobro por área:** cada producto tiene un campo `area` (índice en `products`,
  Dexie v4). Todos los vendedores ven todo el catálogo; lo que venden entra en **su** caja.
- **Ventas cruzadas (sustitución):** si un vendedor cobra un producto de otra área, la venta se
  marca (`sale.hasCrossArea`, `item.area` snapshot por línea). El dueño la ve en el panel
  (pestaña *Áreas*) y en todos los reportes (Ventas, Cierres, Inventario, *Ventas por área*).
- **Sin áreas configuradas:** la app opera como un solo punto (comportamiento clásico).
- **Degradación de licencia:** quitar un área de la lista **no borra** productos ni ventas
  (append-only); solo deja de ofrecerse para nuevos turnos.

## Almacén con ubicaciones (Fase 6 — Bloque 20)

**Modelo:** un almacén central (`WAREHOUSE = '__almacen'`) distribuye a áreas. Cada
producto tiene `stockByLocation = { '__almacen': Q1, 'Víveres': Q2, ... }`:
- **Entradas** (compras) suman al almacén: `stockByLocation[WAREHOUSE] += qty`.
- **Salidas** (transfers) restan del almacén, suman al área: `WAREHOUSE -= qty`, `area += qty`.
  La pantalla `TransferScreen` trabaja **por área con selección múltiple**: eliges el área, marcas
  con checkbox varios productos del catálogo del almacén (agrupados por categoría), pones la
  cantidad de cada uno y los envías de golpe; al enviar se limpia para repetir con otra área. La
  rebaja la hace `transfersRepo.create` (validada y atómica), sin cambios en esa lógica.
- **Ventas** desde un área restan de esa área (si hay vendedor con turno de área), o del almacén
  (si es dueño/admin sin área abierto como "Almacén central").
- **Conteo físico** por ubicación (dueño elige almacén o área; vendedor cuenta su área
  automáticamente). **Aislado por usuario:** cada vendedor ve solo SU borrador y pendiente;
  un borrador obsoleto (p.ej. del almacén, creado antes de tener área) se reconvierte en el
  destino actual **sin borrarse** (append-only).

**Catálogo + entradas:** coherencia de plantilla (mismo formato, mismo orden de columnas).

## Modelo de datos (Dexie)

Versiones en `src/db/db.js`:
- **v1**: `users, config, exchangeRates, categories, products (*searchTokens), priceChanges,
  shifts, sales, stockMovements, purchases, cashMovements, internalDebts, auditEvents`.
- **v2**: `counts` (conteo físico).
- **v3**: `syncState` (cursores de sincronización `push:<colección>`).
- **v4**: índice `area` en `products` (áreas de venta, Bloque 19). `shifts.area`, `sales.area`,
  `sales.hasCrossArea` e `items[].area` son campos nuevos (no requieren índice).
- **v5**: `transfers` (salidas almacén→área, Bloque 20). `stockMovements` y `products` ganan
  dimensión `location` (almacén o área). Migración: establece `location = '__almacen'` en
  movimientos previos, inicializa `stockByLocation` en productos.

**Multimoneda:** base **MN**; efectivo **MN/USD**; **MLC** electrónico. Tasas = "cuánta MN
vale 1 unidad de la moneda", append-only en `exchangeRates`.

**Cuadre de turno:** semáforo 🟢/🟡/🔴 con umbrales configurables; conteo por denominación
de billetes; efectivo vs transferencias separados. El dueño puede forzar el cierre de un
turno abandonado; si se cierra sin contar billetes se marca con bandera.

## Estado por fases

- **Fase 1 — Núcleo Operativo:** ✅ COMPLETA (bloques 0–10).
- **Fase 2 — Caja completa + traspaso offline:** ✅ COMPLETA (bloques 11–15:
  transferencia + captura de SMS, denominaciones, deudas/extracciones, export/import de
  turno JSON, compartir por WhatsApp).
- **Fase 3 — Conteo físico + auditoría + reportes:** ✅ COMPLETA salvo multi-punto:
  - 16 conteo físico · 17 panel del dueño/analítica · 18 auditoría inmutable ·
    20 export PDF/Excel.
  - **19 Multi-punto FÍSICO: DIFERIDO** (varios puntos de venta independientes; para Premium).
- **Fase 4 — Sincronización Firebase:** ✅ COMPLETA (bloques 21–26). Ver abajo.
- **Fase 6 — Áreas de venta dentro de un punto:** ✅ COMPLETA (Bloque 19, ver sección "Áreas de
  venta"). Turno por vendedor, caja/cuadre por área, catálogo global con cobro por área y
  ventas cruzadas auditadas. (Distinto del multi-punto físico, que sigue diferido.)
- **Bloque 20 — Almacén con ubicaciones:** ✅ COMPLETA (v5 migration, transfers, stock por
  ubicación, conteo aislado por vendedor, ventas del dueño desde almacén central).
- **Bloque 20.6 — Rol Administrativo:** ✅ COMPLETA (nuevo rol ADMIN: mando operativo sin
  identidad del negocio; verifyManagerPin; isManager flag; 16+ pantallas ajustadas).
- **Fase 7 — Robustez y calidad profesional:** EN CURSO (plan completo en `docs/FASE7.md`).
  Bloque 32 ✅ (protección del dato local: `storage.persist()` al arranque, respaldo y
  restauración completa de la BD en `/backup` — `features/backup/` —, recordatorio de
  respaldo en el Home del dueño). Bloques 33–39 pendientes.

## Fase 4 — Sincronización (cómo funciona)

Diseño: **Dexie sigue siendo la fuente de verdad local**; encima va una capa de sync propia
y ligera contra Firestore (NO se migró a RxDB). Carpeta `src/features/sync/`.

- **Identidad:** una cuenta de Firebase (email/contraseña) **por negocio**; el `uid` de esa
  cuenta **ES el `businessId`**. Todos los datos cuelgan de `/businesses/{businessId}/...`.
  Cada dispositivo inicia sesión con la **misma cuenta**; el PIN local distingue al vendedor.
- **`syncService.js`**: `createBusinessAccount`, `linkDevice`, `unlinkDevice`, `observeAuth`,
  `syncConfig` (flags locales en `config`: `syncEnabled/syncBusinessId/syncEmail`).
- **`collections.js`**: colecciones a sincronizar, `LOCAL_CONFIG_KEYS` (no viajan a la nube)
  y `syncTs(rec)` (mayor marca de tiempo del registro).
- **`pushEngine.js`** (subida): por colección, cursor de marca de agua en `syncState`; sube
  solo lo cambiado, en lotes de 400. **No espera confirmación del servidor** (Firestore
  guarda en cache persistente y entrega al reconectar) → no se cuelga offline.
- **`pullEngine.js`** (bajada): fusión **última escritura gana** (LWW) por `syncTs`; tras
  fusionar movimientos/productos **recalcula `products.stock` desde el libro mayor**
  (sin tocar `updatedAt`) → ventas paralelas offline no se pisan el stock.
- **`syncEngine.js`**: `syncNow()` (push) + `startRealtime/stopRealtime` (`onSnapshot`).
- **`SyncProvider`** (`app/providers`): arranca la sync a nivel de app **solo si está
  activada** (si no, ni carga Firebase). Sube al reconectar y cada 20 s. Expone estado para
  el indicador ☁️/🔄/📴 de la cabecera (`components/Layout.jsx`).
- **Alta de dispositivo**: el dueño crea/vincula desde `☁️ Sincronización` (`/cloud`,
  `CloudScreen`); el vendedor puede vincular desde el **onboarding** (baja usuarios/catálogo
  y la app pasa sola al login).
- **Conflictos:** si tras sincronizar hay 2+ turnos abiertos a la vez, el Home avisa al dueño.
- **Seguridad:** `firestore.rules` → `auth.uid == businessId`, append-only (delete prohibido).

**Activación (consola + CLI, una vez):** Firestore Database → Crear (modo producción);
Auth Email/Password activado; `firebase deploy --only firestore:rules`; luego en la app
crear/vincular cuenta. Detalle en `DEPLOY.md` (paso 4b).

**Aviso de fusión:** si dos dispositivos ya tienen datos **distintos** y luego se vinculan,
los UUID propios de cada uno provocan **duplicados**. Recomendado: elegir un dispositivo
"bueno", vincularlo primero (sube todo), y en los demás vincular sobre datos vacíos/de prueba.

## Despliegue

- `firebase.json`: hosting `site: "mypicuadre"`, public `dist`, rewrites SPA, cache headers
  (sw/manifest no-cache, assets immutable) + sección `firestore` (rules/indexes).
- `.firebaserc`: proyecto por defecto `mypicuadre`.
- Actualizar lo desplegado: `git pull origin main` → `npm install` → `npm run deploy`.
- En el teléfono la PWA se auto-actualiza al reabrir con internet (cerrar del todo y reabrir).

## Flujo de git

- Rama de desarrollo: **`claude/awesome-dirac-484azm`**. También se mantiene **`main`** al día
  (de ahí se despliega): commit en la rama → merge fast-forward a `main` → push de ambas.
- Mensajes de commit en español, descriptivos, por bloque (ej. "Fase 4 - Bloque 23: ...").
- **No** crear Pull Requests salvo que se pida explícitamente.
- El entorno remoto tiene el proxy de git en solo lectura; los push directos van con token
  transitorio del usuario (NUNCA persistir el token en el repo ni en la config).
