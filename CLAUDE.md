# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Guía del proyecto MypiCuadre

Contexto para Claude Code (y para cualquier desarrollador) al trabajar en este repo.
El idioma del proyecto, la UI, los comentarios y los mensajes de commit es **español**.

## Reglas de desarrollo (cumplimiento estricto)

Reglas del dueño, de **cumplimiento estricto**: tienen **prioridad** sobre cualquier
comportamiento por defecto.

1. **Rama única:** todo el desarrollo va en `claude/awesome-dirac-484azm`. **NADA a `main`** sin
   autorización explícita del dueño.
2. **No afectar la lógica de producción** por ningún motivo. Todos los cambios son **aditivos**; el
   comportamiento por defecto queda **idéntico al clásico**. Nada existente se rompe ni cambia de
   conducta.
3. **Todo gateado por su módulo de licencia** con `hasModule(...)`, **sin fugas**: lo de un módulo
   solo aparece con la licencia desbloqueada; quitarlo no rompe ni borra nada (append-only).
4. **Preguntar para validar antes de programar** cuando haya ambigüedad. No se asume; se consulta.
5. **Auditoría profunda y crítica antes de fusionar a `main`**, y **honestidad**: decir claramente
   lo que **NO se puede garantizar** (se valida por **código + build**, no por runtime en el
   dispositivo del dueño). No afirmar "probado" lo que no se probó.
6. **Append-only / nada se borra:** correcciones como ajustes nuevos con nota y marca de tiempo;
   **toda mutación actualiza su timestamp** (de esto depende la sincronización).
7. **Idioma español** en UI, comentarios y mensajes de commit. **Imitar el estilo** del código vecino.
8. **Build limpio** (`npm run build`) antes de cada commit; importaciones pesadas siempre con
   `import()` **dinámico**.
9. **Commits descriptivos** por bloque/tema, en la rama de desarrollo. **No crear Pull Requests**
   salvo que el dueño lo pida.

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

**Pruebas:** NO hay script `npm test` (ni linter). **26** suites son ficheros `.test.mjs` puros que
se corren **uno a uno con node** (**1.460 aserciones**, medidas el 24-09-2026). Las tres de la
corrección Burger Premium son `orderSale` (H1/H2: el candado de venta y la reparación de la mesa
cobrada), `resend` (H3-a: el reenvío forzado) y `atomicity` (H3-b: el diagnóstico de roturas de
atomicidad). La última en llegar es `convergence`, el diagnóstico de fichas de producto cuya versión
no llegó a un aparato, que salió del respaldo B de La Patrona; y `syncLogPolicy`, la política del registro
de la sincronización en `/errors`. Ojo: casi todas viven en `src/lib/` pero `retryQueue.test.mjs` está
en `src/features/sync/`, `fichaReports.test.mjs` en `src/features/reports/` y `helpContent.test.mjs`
en `src/features/help/`, así que un glob `src/lib/*.test.mjs` **se salta tres**:

```bash
for t in src/lib/custodyMath.test.mjs src/lib/dates.test.mjs \
         src/lib/productCustodyMath.test.mjs src/lib/remesas.test.mjs \
         src/lib/fichaCosto.test.mjs src/lib/fichaLines.test.mjs \
         src/lib/kitchenMath.test.mjs src/lib/orderTotals.test.mjs \
         src/lib/saleRevenue.test.mjs src/lib/unitsConfig.test.mjs \
         src/lib/stockLocation.test.mjs src/lib/modalClose.test.mjs \
         src/lib/navSections.test.mjs \
         src/features/sync/retryQueue.test.mjs \
         src/features/reports/fichaReports.test.mjs \
         src/features/help/helpContent.test.mjs \
         src/lib/orderSale.test.mjs \
         src/features/sync/resend.test.mjs \
         src/lib/atomicity.test.mjs \
         src/lib/convergence.test.mjs \
         src/lib/syncLogPolicy.test.mjs \
         src/features/sync/commitWatch.test.mjs \
         src/features/sync/compareResend.test.mjs \
         src/features/sync/compareResendEngine.test.mjs \
         src/lib/dailySalesControl.test.mjs \
         src/lib/reportCells.test.mjs; do node "$t"; done
```

**Dos suites más, `src/repositories/ordersRepo.test.mjs` (H1/H2) y `src/lib/syncLog.test.mjs` (el
escritor del registro de la sync), usan base real y NO corren con node directo**: los repos importan sin extensión, así que hace falta empaquetarla con el esbuild que ya
trae Vite y `fake-indexeddb` (`devDependency` desde el 23-09-2026) antes de ejecutarla. Comando
exacto (copiado del comentario de cabecera del propio fichero; para `syncLog` es el mismo con su ruta):

```bash
npx esbuild src/repositories/ordersRepo.test.mjs --bundle --platform=node \
  --format=esm --outfile=<scratch>/ordersRepo.test.bundle.mjs && node <scratch>/ordersRepo.test.bundle.mjs
```

Con esas dos dentro: **28 suites / 1.518 aserciones** en total, medidas el 24-09-2026 tras las
dos revisiones de la rama (`ordersRepo` 23→47, `orderSale` 18→29, `resend` 22→28), con
`convergence` (15), `syncLogPolicy` (29), `syncLog` (11), `commitWatch` (36, el vigilante de lotes
de subida sin confirmar), `compareResend` (23) y `compareResendEngine` (28), el reenvío que compara
antes de escribir, `dailySalesControl` (57), el Control de Ventas Diarias, y `reportCells` (10).

Las cifras de suites/aserciones que aparecen más abajo en las **actas de auditoría** son de su
fecha (8 suites / 462 aserciones el 11-09) y se dejan tal cual: son el registro de lo que se
midió entonces, no el estado de hoy.

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
│   ├── tables/               # módulo 'mesas' (salón, cuenta por mesa, ticket)
│   ├── partners/ accounts/   # módulo 'cuentas' (proveedores/terceros + tesorería)
│   ├── license/ backup/ errors/  # activación, respaldo local, registro de errores
├── components/               # UI compartida (PinInput, Layout, CashInputs, ...)
├── lib/                      # utilidades puras (ids, pin, currency, dates, search, firebase, theme, image)
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
- **Y esa marca NUNCA nace por debajo de la versión que reemplaza** — `tsAfter(...)` en
  `src/lib/dates.js`. Los relojes de dos teléfonos no coinciden: si el que sella la
  transición va **atrasado**, el cambio nace *más viejo* que el estado anterior, el LWW
  de bajada lo **descarta** y el estado se pierde (pasó de verdad con una entrega). Con
  el reloj coherente `tsAfter` devuelve `now()` **exactamente igual que antes**; solo se
  desvía (+1 ms sobre la versión previa) en el caso roto. Se aplica **solo a `updatedAt`**
  (la clave del LWW) en las cabeceras que mutan dos dispositivos en segundos:
  `remittances` (entregas), `counts` (conteo físico) y `orders`/`orderItems` (mesas). Las
  fechas de **negocio** (`createdAt` de los libros append-only y de auditoría, `openedAt`,
  `closedAt`, `settledAt`, `collectedAt`, `approvedAt`…) conservan el **reloj real**: son
  el hecho, y son la evidencia del desfase. `shifts` queda fuera a propósito (se abre y se
  cierra con horas de separación: el desfase no alcanza).

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
  `usersRepo.verifyManagerPin`) — salvo que el dueño active el permiso mayorista
  `sellerSelfAuthorize`, con el que el vendedor las confirma (y el retiro al cerrar turno) con
  **su propio PIN**. **NO** hace entradas, NO cambia precios, NO ve costos, NO crea usuarios.
- **Elaboración (ELABORATION, módulo `elaboracion`)**: rol **acotado** al centro de elaboración
  (transforma productos y hace salidas a los puntos de venta). NO ve el almacén central ni los
  datos del dueño; no abre turnos de venta. Solo existe con el módulo `elaboracion`.
- **Cocinero (COOK, módulo `cocina`)**: rol **acotado** a la cocina (elabora recetas y las envía a
  las áreas desde el **tablero** `/cocina`). Como el elaborador: **no es mando ni vendedor**, no
  abre turno ni maneja caja (el `Layout` le oculta la pestaña *Turno*), no ve costos ni ganancia. En
  su sesión ve el **tablero** (solo recetas) y un **Catálogo de la cocina** (los insumos que hay en
  `__cocina`, reusando la vista por ubicación del vendedor, sin turno). El flag `isCook` (en
  `AuthProvider`) **no** entra en `isManager`. Solo existe con el módulo `cocina`.
- **Mensajero (COURIER, módulo `remesas`)**: rol **acotado** a las entregas. Recibe un **fondo**
  de efectivo y/o **producto en custodia**, entrega al beneficiario y luego **liquida**. Como el
  cocinero: **no es mando ni vendedor**, no abre turno ni maneja caja, no ve costos ni datos del
  dueño. En su sesión ve **solo las entregas que tiene asignadas** y su propia custodia. El flag
  `isCourier` **no** entra en `isManager`. Solo existe con el módulo `remesas`.
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
- **Venta solo del área (el Bloque 20 supera al 19):** con el stock por ubicación, cada vendedor
  **solo puede vender lo que hay en SU área**. La venta rebaja de la ubicación del turno y
  `salesRepo.create` **revalida la existencia contra el libro mayor dentro de la misma
  transacción** (candado de última instancia). La antigua **"venta cruzada" quedó retirada**:
  `sale.hasCrossArea` se escribe siempre `false` en ventas nuevas (solo sobrevive como dato
  **histórico** de ventas previas); el snapshot `item.area` por línea sí se conserva. El
  dueño/admin sin área abierto (como "Almacén central") vende del **almacén**.
- **Sin áreas configuradas:** la app opera como un solo punto (comportamiento clásico).
- **Degradación de licencia:** quitar un área de la lista **no borra** productos ni ventas
  (append-only); solo deja de ofrecerse para nuevos turnos.

## Almacén con ubicaciones (Fase 6 — Bloque 20)

**Modelo:** un almacén central (`WAREHOUSE = '__almacen'`) distribuye a áreas. Cada
producto tiene `stockByLocation = { '__almacen': Q1, 'Víveres': Q2, ... }`:
- **Entradas** (compras) suman al almacén por defecto: `stockByLocation[WAREHOUSE] += qty`.
  (Excepción: el vendedor con permiso `sellerEntries` puede entrar directo a **su área**; ver
  "Permisos del vendedor". El mando siempre entra al almacén.)
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

## Mermas (deterioro/pérdida)

Rebaja de inventario que **NO es venta** (no entra dinero): solo baja la existencia y deja
constancia de la afectación al **costo**. Pantalla `features/inventory/MermaScreen.jsx` (`/mermas`),
repo `mermasRepo`. Es una **función base** (no gateada por licencia); solo la usa el **mando**
(dueño/administrativo, que ve costos).
- **Por ubicación:** el mando elige almacén central, un área o —con el módulo `cocina`— la
  **Cocina**; se valida la existencia en ella. La opción de Cocina va gateada con
  `hasModule('cocina')`: sin el módulo no existe y la pantalla queda **idéntica a la clásica**
  (comprobado renderizando la pantalla real con y sin licencia; ver el acta del 23-09-2026).
  **`mermasRepo` no se tocó**: ya recibía `location`, validaba la existencia en ella y escribía
  el `MERMA_OUT` con esa ubicación. Lo único que faltaba era **ofrecerla**.
- **Snapshot append-only:** cada merma congela precio de venta y costo (pueden cambiar después) y
  genera un `MERMA_OUT` en `stockMovements` que rebaja el stock real. Nunca se edita/borra.
- **Reporte "Mermas"** (Reportes, Excel/PDF): fecha, producto, ubicación, cantidad, precio de
  venta, costo unitario, **importe del costo (afectación = cant × costo)** y motivo; con totales
  de afectación y de precio de venta perdido. En el submayor cuenta como "otras salidas".
- **Nota de robustez:** la validación de existencia usa la **caché** (`stockByLocation`), no una
  re-derivación del libro mayor dentro de la transacción (a diferencia de `salesRepo`, que
  revalida contra el ledger como *candado de última instancia*). Es seguro porque las mermas solo
  las hace el **mando** (sin ventas en paralelo compitiendo por ese stock); si en el futuro se
  abriera a actores concurrentes, convendría revalidar contra el ledger.
  **Matiz añadido el 23-09-2026, con la Cocina dentro:** la premisa de esa nota («sin nadie
  compitiendo») ya era **discutible antes** —un vendedor vende de su área mientras el mando merma
  en esa misma área— y con `__cocina` el competidor es el **cocinero**, que consume por
  `kitchenRepo.produce`. Ese camino **sí** revalida contra el libro mayor, así que el que puede
  quedarse corto es el de las mermas. **Decisión explícita del dueño (23-09-2026): NO se tocó**
  `mermasRepo`, para no cambiar lógica de producción que funciona (regla 2). El hueco es el mismo
  que ya existía con las áreas, ni mayor ni menor. **Queda ABIERTO**: cerrarlo es derivar la
  existencia del libro dentro de la transacción, y afectaría a **todas** las ubicaciones.

## Permisos del vendedor (independientes de módulos)

Además de los permisos del módulo `mayorista`, hay permisos del vendedor **independientes de
cualquier módulo**, que el dueño activa en Ajustes → *Permisos del vendedor* (apagados por
defecto, sincronizados):
- **`sellerEntries`** — el vendedor puede registrar **entradas de mercancía**. El **mando entra
  siempre al almacén central** (sin selector, como siempre). El **vendedor con turno abierto**
  puede elegir entre el **almacén central** o el **área de su turno**: si elige su área, la
  mercancía entra directo a ella (se salta el traspaso). `purchasesRepo.create` recibe un
  `location` opcional (default almacén → sin pasarlo, todo idéntico a hoy); el `PURCHASE_IN`
  lleva esa ubicación y el stock por ubicación se deriva del libro mayor (la sync lo recalcula
  igual en cada dispositivo). El reporte de entradas muestra la **ubicación**. Sin el permiso,
  `EntryScreen` lo bloquea.

## Unidades de medida configurables (base, 13-09-2026)

La lista de unidades la maneja **el dueño** desde Ajustes → *Unidades de medida*: **desactiva**
las que su negocio no usa (pidió no ver los galones «para no pincharlos por error») y **añade**
las suyas de gastronomía (trago de 45 ml, copas de vino de 120/150/180, dash, crema de 30 ml).
Es función **BASE**, no de módulo. Plan y acta de ejecución en **`docs/UNIDADES-DE-MEDIDA.md`**.

- **Clave `config.units`** con `{ code, label, active }`; **clave ausente = las 8 de
  `constants.js`**, así que un negocio que no entre ahí se comporta **idéntico al clásico**.
  **CERO esquema Dexie y CERO colecciones de sync**: `config` ya existe, ya sincroniza y `units`
  no está en `LOCAL_CONFIG_KEYS`. Se fusiona por **LWW de la clave entera**, como las áreas.
- **Lógica pura en `src/lib/unitsConfig.js`** (suite propia con node). **No confundir con
  `src/lib/units.js`**, que ya existía y convierte **cantidades** entre unidades de la misma
  familia física (1 L → 1000 ml): son responsabilidades distintas y no se tocan.
- **Se DESACTIVA, nunca se borra** (regla 6): un producto que ya usa esa unidad tiene que poder
  seguir editándose. Solo se puede *quitar* una que se acaba de añadir y aún no se guardó.
- **El CÓDIGO nunca se edita; la ETIQUETA sí** (incluida la de las de fábrica). El código se
  congela como copia en **diez** tablas (ventas, compras, mermas, conteos, producciones,
  conversiones, traspasos, líneas de mesa, movimientos de terceros y líneas de ficha), y
  **muchas pantallas imprimen el código** («5 trago»), no el nombre largo: por eso la tarjeta
  pide que sea corto y legible.
- **Siempre queda al menos una activa.** `setUnits` lo **rechaza** (con `cleanUnits`, que NO
  repara) y la lectura lo **repara** (`normalizeUnits`): la lista rota puede **llegar** por la
  sync de otro teléfono o de un respaldo viejo, y sin eso el alta de producto se quedaría sin
  una sola opción.
- **Los cuatro desplegables** leen la lista: `ProductForm`, `RecipeForm` (`cocina`/`cocteleria`),
  `ConversionScreen` (`mayorista`) y `CostSheetScreen` (`fichas`). **Incluyen SIEMPRE la unidad
  que el registro ya tiene, aunque esté desactivada** (`unitsForSelect`): un `<select>` sin la
  `<option>` de su valor se pinta **en blanco** y se guardaría otra cosa sin querer. *Ese fallo
  sigue existiendo con las **áreas** en `ProductForm`; no se tocó.* Y **al crear**, si la unidad
  por defecto está desactivada se cae a la **primera activa**; al editar no se toca nunca.
- **La importación valida contra la lista real** (`parseUnitCode`, solo activas): una unidad
  desactivada **no entra por el Excel ni con su alias de fábrica** («onzas» no pasa si la onza
  está apagada) — sin eso, desactivar el galón no serviría de nada. Los **alias de las ocho de
  fábrica** («kilos», «litros», «cc») se conservan **letra por letra** en `UNIT_ALIASES`, así que
  un fichero que hoy importa bien sigue igual; las **nuevas** van por **código exacto**. El
  mensaje de error se **deriva** de la lista (antes iba escrito a mano y quedaría mintiendo), y
  la plantilla trae una hoja **«Unidades»** con los códigos del negocio.
- **Nadie ha ejecutado esto en un dispositivo:** build + 13 suites node. Peso: **+7.97 kB**
  (+0.82 %; gzip +2.66), CSS sin cambios.

## Módulos de licencia (funciones que se venden por separado)

Cada licencia puede traer, **firmados** en su payload (`modulos: [...]`), módulos opcionales.
Sin el campo → **ningún módulo** y la app es idéntica a la versión clásica. Definidos en
`src/lib/license.js` (`LICENSE_MODULES`) y comprobados en las pantallas con
`useLicense().hasModule(...)` (solo cuentan si la licencia está **desbloqueada**; no se pueden
autoactivar). Regla de oro: **todo lo de un módulo va gateado**; quitarlo no rompe ni borra nada
(append-only) — solo deja de ofrecerse.

**La AYUDA también se gatea (desde F10).** Un artículo de `src/features/help/helpContent.js` puede
llevar un campo **opcional** `module`: con él, solo se ve si ese módulo está desbloqueado. Explicar
en la ayuda una función que el negocio no tiene comprada es una fuga como cualquier otra. Filtran
los **dos** consumidores —`HelpScreen` y `helpPdf`, que si no la colaría por el PDF— y el
parámetro `modules` de `downloadHelpPdf` llega **vacío por defecto**, que es el lado seguro
(oculta, no cuela). Sin el campo, el artículo se ve siempre, igual que antes.

- **`mayorista`** — venta desde el almacén central por el vendedor (con permiso del dueño),
  precios por escala (mayoreo), pago mixto, conversión/fraccionamiento de productos. Trae dos
  permisos que el dueño activa en Ajustes → *Ventas mayoristas* (ambos apagados por defecto,
  sincronizados, y gateados también en la lectura): `sellerWarehouseSale` (vender del almacén
  central) y `sellerSelfAuthorize` (el vendedor confirma **extracciones de caja, deudas internas
  y el retiro de efectivo al cerrar turno** con **su propio PIN** vía `OwnerAuthModal self=...`,
  sin necesitar el PIN de un mando; la operación queda a su nombre).
- **`cuentas`** — proveedores y terceros (consignación, por pagar/cobrar) + cuentas de
  tesorería del negocio (`features/partners/`, `features/accounts/`). *Ingresos por concepto*
  (`accountsRepo.byConcept`) agrupa por **concepto Y MONEDA** → `{ concepto: { moneda: monto } }`,
  y tanto la pantalla como el reporte *Movimientos de cuentas* muestran **cada moneda por
  separado**. **No se convierte a MN con la tasa** a propósito (la de hoy no es la del día del
  movimiento y el histórico cambiaría de valor); es el criterio del panel de custodia y del cuadre
  de turno. Antes se sumaban todas las monedas en un solo número etiquetado "MN": un cobro en USD
  engordaba el total como si fuera MN. Con un negocio solo en MN se ve **igual que siempre**.
  El concepto **`fondo` se muestra en los dos lados** (sale de la cuenta y **vuelve** cuando el
  mensajero lo devuelve): la vuelta lleva su propia etiqueta —`ACCOUNT_CONCEPTS_IN`, vía
  `conceptLabel(clave, lado)`— para que no se lea como un ingreso del negocio; antes solo se
  pintaba la salida y el egreso quedaba en **bruto**. Las etiquetas del **origen** (`refType`)
  viven en `ACCOUNT_REF_LABELS` (una sola lista para pantalla y reporte): incluyen `remittance`
  y `fund`, que salían crudos en inglés. Todo **data-driven**: sin el módulo `remesas` no existe
  ningún movimiento de esos conceptos y no se pinta nada (sin fuga de licencia). **Degradación —
  decisión del dueño:** si se QUITA `remesas`, esas filas **siguen mostrando su histórico** (no se
  ocultan). Ese dinero entró y salió de verdad de las cuentas: ocultarlo dejaría la suma de
  conceptos sin cuadrar con el saldo. No es una fuga (un negocio que nunca tuvo el módulo no tiene
  esos movimientos y no ve nada); lo que sí desaparece con la licencia es el módulo — pantalla,
  reportes y rol. **No "corregir" esto ocultando las filas.**
- **`elaboracion`** — centro de elaboración intermedio (almacén → elaboración → área) con su
  rol acotado `ELABORATION`.
- **`mesas`** — cuentas abiertas por mesa dentro de un área (cafetería/restaurante). Ver abajo.
- **`imagenes`** — miniaturas sincronizadas (fotos de producto + carta de mesas). Ver "Fase 8".
  Nota: los **avatares** de usuario son **base** (no gateados), no cuentan como este módulo.
- **`divisas`** — precios de catálogo en **divisa** (USD): el dueño fija precio/costo en USD y el
  cliente paga en USD o MN (MN = USD × tasa vigente). OFF por defecto. Ver "Divisas" abajo.
- **`cocina`** — recetas + tablero de cocina: el dueño define recetas (insumos y consumo por unidad)
  y el **Cocinero** (rol `COOK`) elabora y envía a las áreas. OFF por defecto. Ver "Cocina" abajo.
- **`cocteleria`** — recetas de coctelería + tablero `/cocteleria`: el trago se elabora **DENTRO
  del área**, consumiendo SU stock, y **se queda en ella** (sin traspasos). **Independiente de
  `cocina`**: un bar sin cocina central puede comprar solo este. **NO crea ningún rol nuevo**. OFF
  por defecto. Ver "Coctelería" abajo.
- **`remesas`** — entregas a domicilio (dinero o producto) con su rol acotado `COURIER`
  (Mensajero): orden → cobro → asignación → entrega → liquidación. OFF por defecto. Ver
  "Entregas" abajo.
- **`fichas`** — **F0 a F11 HECHAS, H3 CERRADO y FUSIONADO A `main` el 11-09-2026** (`origin/main` = `fd24823`). Ficha de costos y gastos de la **Res. 148/2023 MFP**:
  reutiliza el catálogo y el stock para construir el documento oficial de 16 filas con sus dos
  anexos, y lo exporta. Solo **mando** (expone costos y ganancia). OFF por defecto. Hecho hasta
  hoy: motor puro `lib/fichaCosto.js` (probado con node), Dexie **v18 + v19** (`costSheets` y
  `costSheetLines`),
  `costSheetsRepo`, el módulo de licencia, y de F4 la **lista `/fichas`** y el **bloque 1
  (Identificación)** del editor (`/ficha/nueva`, `/ficha/:id`) en `features/costsheets/`, con la
  tarjeta gateada del Home, de F5 el **bloque 2 (gasto material)** —anexo de insumos, portadores
  e importación desde una receta de `cocina`—, de F6 el **bloque 3 (salario directo)** —el anexo
  de las nueve columnas en tarjetas— y de F7 los **bloques 4 a 7**: otros gastos directos,
  indirectos con el **Control A** (Art. 9), financieros/OSDE/tributos, y utilidad y precio con el
  **Control B** (la base del Anexo II **no es el total**) y el **Control C** (subsidio por
  correlación). Los tres controles son **avisos y nunca cerrojos** (Art. 6), y salen de
  `fichaWarnings`, con un resumen **fuera del acordeón** para que no dependan de qué bloque quede
  abierto. Y de F8 los **bloques 8 y 9**: precios de referencia (Fila 16, explicativa) y el
  **ciclo de vida** —firmas *Elaborado por* / *Aprobado por* con cargo, **aprobar** (la ficha
  queda inmutable), **nueva revisión** (hereda la anterior como **Costo Base**, derivado por
  `reviseFrom` en el motor, y la deja *sustituida*), **eliminar** en lógico e historial de
  versiones—. Con esto **el editor está completo**: la ficha calcula su precio y se aprueba. Y de
  F9 la **exportación**: `features/reports/fichaReports.js` arma las **tres hojas oficiales** —la
  ficha de 16 filas con sus dos columnas de valores, el anexo de insumos (7 columnas) y el de
  salario (9, horizontal)—, **cada una a su propio PDF y Excel** con su encabezado de
  identificación y su pie de firmas, desde el bloque 9 del editor. Para eso `exportPdf` y
  `exportExcel` de `reportsService.js` ganan dos campos **opcionales** (`header`/`footer`): los
  ~20 reportes existentes no los pasan y **su salida queda idéntica byte a byte**, comprobado
  generando los ficheros con `xlsx` y `jspdf` en node (ver `docs/FICHA-COSTO.md` §9.13). Y de F10
  la **integración**: pestaña *Fichas* en `/auditoria` (quién creó, aprobó, revisó o eliminó cada
  ficha — los eventos se escribían desde F2 y **nadie los leía**) y dos artículos en `/help`.
  **F11 (la auditoría profunda antes de `main`) HECHA.** Y del **07-09-2026** el cierre del
  hallazgo **H3**: los cuatro anexos pasaron a ser **filas sueltas** (`costSheetLines`, Dexie
  **v19**) y el editor guarda **por diferencias** y se **resincroniza**, porque la ficha la
  llenan **dos** mandos y con los anexos dentro del documento la fusión LWW le borraba al otro el
  anexo entero (§9.16). **`costSheets` y `costSheetLines` YA están en
  `SYNC_COLLECTIONS`** (LWW por `updatedAt`, lote de 400). Las pantallas entran por **import
  estático** como las demás: la decisión de `React.lazy` se revocó con evidencia (el service
  worker precachea todos los chunks, así que diferir no ahorra datos a nadie). **Regla de escala
  cerrada en F5:** la receta define el consumo de **una** unidad y la columna (5) del anexo es el
  del **nivel de producción completo**, así que al importar se **multiplica por el nivel** (sin
  eso la ficha se subvalúa ×nivel, en silencio). **No queda nada del módulo por programar** y **ya está en `main`**: lo
  que sigue abierto es **un** hallazgo (la carrera al crear revisiones) y, sobre todo, que
  **nadie ha ejecutado la app** con el módulo. Todo el
  traspaso está en **`docs/FICHA-COSTO.md`** (leerlo antes de tocar nada del módulo).

## Entregas (módulo `remesas`)

Entregas a domicilio de **dinero** o de **producto**, con el rol acotado **Mensajero**
(`COURIER`). Gateado por la licencia `remesas`; sin él —y sin el rol— la app queda **idéntica a
la clásica**. Pantalla única `features/remesas/RemesasScreen.jsx` (`/remesas`, mando y mensajero).
Repos: `remittancesRepo` (cabecera), `custodyRepo` (efectivo), `productCustodyRepo` (producto),
`deliveriesRepo`, `settlementsRepo`. Reportes en `features/reports/remesasReports.js`.

- **DOS DINEROS DISTINTOS — no confundirlos nunca:**
  1. **Lo que paga el remitente** → entra a una **cuenta de tesorería** (`accountMovements`,
     concepto `entrega`) vía `remittancesRepo.collect`. Anticipado (antes de asignar) o contra
     entrega (después de entregar, queda "por cobrar" con contador rojo).
  2. **El fondo del mensajero** → sale de una **cuenta de tesorería** (concepto `fondo`,
     `custodyRepo.provisionFund`) y entra a su **custodia**; cada entrega se lo descuenta.
     `returnFund` es el espejo exacto. Es dinero del negocio **en la calle**.
  La antigua "caja central" (`REMESA_CENTRAL`) quedó **retirada** del flujo: nada la acreditaba
  y su saldo solo podía ser negativo. Sus movimientos históricos se conservan (append-only).
- **Custodia = libro propio, saldo derivado.** `custodyMovements` (efectivo) y `productCustody`
  (producto) son libros **append-only** de los que se DERIVA el saldo por tenedor (nunca se
  guarda), como el stock sale del libro mayor. La matemática vive en `lib/custodyMath.js` y
  `lib/productCustodyMath.js` (**puras y testeadas con node**, sin Dexie).
- **Entrega de PRODUCTO ligada al inventario.** El área centinela `ENTREGAS_AREA = '__entregas'`
  se surte por el **traspaso normal** (almacén → Entregas) y **se cuenta** en el conteo físico.
  Asignar carga al mensajero (`DELIVERY_OUT`, rebaja el área); devolver reingresa (`DELIVERY_IN`).
  Lo que el mensajero ya carga vive en su custodia de producto —**aparte del inventario**— y por
  eso NO entra en el conteo. `deliver` **valida contra el libro de custodia dentro de la
  transacción** (candado de última instancia, como `salesRepo`): sin eso se podía devolver el
  producto y acto seguido marcarlo entregado, contándolo dos veces. Al **crear** la entrega, el
  selector ofrece **solo lo que hay en `__entregas`** (`stockByLocation > 0`), **ordenado
  alfabéticamente** y con la existencia al lado — el mismo criterio de `TransferScreen`, que solo
  ofrece lo que hay en el almacén. Es un **filtro de la UI**: el candado real sigue siendo
  `assign` (varias entregas pendientes comparten esa existencia), y la lista avisa en rojo si una
  línea pide más de lo que hay.
- **Modo de cobro: idéntico en dinero y en producto.** El dueño elige *anticipado* o *contra
  entrega* en ambos tipos, y el dinero entra a la **cuenta de tesorería** que él elija por el
  **mismo camino** (`collect`, concepto `entrega`): anticipado = "Registrar pago" antes de
  asignar (deja la entrega en *Fondos disponibles*); contra entrega = "Registrar cobro" tras
  entregar (mientras tanto cuenta en *Por cobrar*). **Por defecto no cambia nada**: dinero sigue
  naciendo *anticipado* y producto *contra entrega* (`create` sin `paymentMode` da ese clásico).
  Con anticipado el **monto es obligatorio** (no hay pago de cero); solo el producto *contra
  entrega* puede ir sin monto (entrega sin cobro), como siempre.
- **Estados (append-only, nada se borra).** Creada → (cobro) → Fondos disponibles → Asignada →
  Entregada → **Liquidada** → Cerrada. Una entrega fallida guarda **su motivo** como estado
  (ausente, dirección incorrecta, rechazada, vencida, en disputa, devuelta, fallida).
- **Liquidación = cuadre del efectivo del mensajero** (`settlements`), con el mismo patrón que el
  cierre de turno: teórico (del libro) vs físico (contado) vs diferencia + semáforo. Marca como
  **Liquidadas** las entregas de ese mensajero que ya estaban entregadas, **de dinero** y **sin
  cobro pendiente** — estas últimas se excluyen a propósito: "liquidada" habla del efectivo *del
  mensajero* y "por cobrar" del dinero *que debe el remitente*; marcarlas las sacaría del
  contador de "Por cobrar".
- **Editar / eliminar (dos niveles).** Monto, moneda, modo de cobro y productos: **solo antes de
  cobrar**. Remitente, beneficiario y nota: mientras la entrega siga viva. **Eliminar** es
  **borrado lógico** (`deletedAt`) y solo si **no se movió nada** (sin cobro, sin mensajero); si
  ya se movió algo, el camino es **cancelar** (que es un estado, no una desaparición).
- **Idempotencia.** Todo lo que mueve dinero o inventario usa **ids deterministas con guarda de
  existencia** (`delivery-out:<entrega>:<producto>`, `custody:deliver:<entrega>`,
  `acctmov:fund:<mensajero>:<instante>`…) para que un doble toque, un reintento o una fusión de
  la sync **no puedan duplicar**.
- **Sincronización.** Seis colecciones nuevas en `SYNC_COLLECTIONS` (`remittances` LWW por
  `updatedAt`; `custodyMovements`, `deliveries`, `settlements`, `collections`, `productCustody`
  append-only). `deliveries` y `collections` llevan **foto** de comprobante, así que suben en
  lotes de **50** (como `images`): a 400 se pasaban del límite de ~10 MiB por petición.
- **Degradación.** Quitar `remesas` no borra nada (append-only): las tablas quedan como están y
  solo deja de ofrecerse. Conviene **cambiar el rol** de un Mensajero antes de quitarlo.

## Mesas (módulo `mesas`)

Cuentas abiertas por **mesa** dentro de un área (cafetería/restaurante). Gateado por la
licencia `mesas`; sin él, la app queda idéntica a la clásica. Pantallas en `features/tables/`:
`SalonScreen` (panel del salón), `TableScreen` (cuenta de una mesa) y `TablesSettings` (mesas
por área, % de cargo por servicio, encabezado/pie del ticket). Repo: `ordersRepo`.

- **Estados de mesa:** LIBRE · RESERVADA (apartada, sin consumo) · OCUPADA (cuenta en curso;
  se resalta si lleva >1 h). Al **cobrar**, el pedido pasa a `closed` y la mesa vuelve a LIBRE
  al instante. El dueño/admin ve todas las áreas; el vendedor solo la de su turno.
- **Append-only por líneas:** cada consumo es una fila de `orderItems` (NO un array dentro del
  pedido) para que la sync "última escritura gana" **fusione** adiciones de dos dispositivos
  (camarero + caja) sin pisarse. Quitar una línea la marca `voided` con su movimiento de
  compensación; nunca se borra.
- **Un toque = una unidad.** El stock del área **se rebaja al agregar** cada ítem
  (`ordersRepo.addItem` valida existencia): no se puede prometer lo que no hay. Una mesa
  SIEMPRE consume del área de su turno (aquí no existe el almacén central).
- **Cobro por el camino normal:** al cobrar se crea la venta con `salesRepo.create({ skipStock:
  true })` (el inventario ya se movió al agregar) → reutiliza todo el cobro existente (efectivo,
  transferencia, **mixto**, cuentas, consignación). La venta se guarda **agrupada por producto**
  (una línea "5 × Refresco") igual que una venta directa, para que ticket y reportes no repitan.
- **Cargo por servicio** configurable por área; el mando puede **eximirlo** con su PIN
  (`OwnerAuthModal`). El **ticket térmico 58 mm** (impresora ESC/POS por Bluetooth) se imprime
  con `window.print()` y `@media print`.
- **Cierre de turno bloqueado** si el área tiene mesas abiertas/reservadas: hay que cobrarlas o
  liberarlas antes (las vacías se liberan de golpe). Reporte **"Ventas por mesa"** en Reportes.
- **DESCUENTO de la cuenta (14-09-2026).** Un % que rebaja el consumo de una mesa abierta.
  **El orden manda y lo cerró el dueño:** `descuento = subtotal × %`, `servicio = (subtotal −
  descuento) × %servicio`, `total = subtotal − descuento + servicio` — si se regala parte del
  consumo, **no se cobra servicio por esa parte**. La aritmética vive en `lib/orderTotals.js`
  (pura, probada con node); con `discountPct = 0` devuelve **exactamente** lo que devolvía la
  fórmula anterior, comprobado campo por campo (1440 casos).
  - **Autorización:** el mando lo aplica y lo retira directo; el **vendedor** con el **PIN de un
    mando** (`OwnerAuthModal`, el patrón exacto de *"Eximir servicio"*). La operación queda a
    nombre de **quien autoriza**. Poner y quitar dejan **cada uno su evento** en `auditEvents`.
  - **LA VERDAD VIVE EN LOS EVENTOS, no en la cabecera.** `orders.discountPct` es solo una
    **caché** —como `products.stock` frente al libro mayor—: la cabecera se fusiona por LWW de
    documento entero, y bastaba con que un camarero agregara una cerveza desde un teléfono que aún
    no había recibido el descuento para que su subida lo **borrara** y la mesa se cobrara completa
    (medido, no supuesto). Los eventos son append-only con id propio y no se pueden perder, así
    que el % vigente se **deriva** de ellos (`discountFromEvents`; empate al milisegundo → gana
    QUITAR, porque los relojes van desfasados y un descuento aplicado sin querer cuesta dinero).
    `ordersRepo.reconcileDiscount` **repara** la caché al abrir el salón y la mesa, y **NO toca
    `updatedAt`** (es derivado, igual que `recomputeStock` y `reconcileFromDeliveries`).
  - **Candado al cobrar:** antes de mover dinero se re-deriva el % de los eventos; si no coincide
    con lo que hay pintado, **no se cobra** y se avisa. Cobrar en silencio un total distinto del
    que el cliente está viendo sería peor que no cobrar.
  - La venta congela `discountPct`/`discountAmount`/`discountBy` (0/null sin descuento = idéntico
    al clásico), el **ticket** lleva su línea entre consumo y servicio, el **salón** avisa arriba
    y en la baldosa, y el reporte *Ventas por mesa* gana la columna **Descuento** solo si hay
    alguno en el rango (data-driven, como las columnas USD).
  - **Red de seguridad:** reporte *"Descuentos autorizados no aplicados"* — mesas cobradas
    completas pese a haber un descuento autorizado en los eventos. Delata el caso en que la fusión
    pisó la cabecera.
  - **CORTESÍA — la mesa regalada al 100% (16-09-2026).** El 100% siempre se pudo aplicar, pero
    entonces el total daba 0 y el cobro exigía `total > 0`: la mesa quedaba **congelada sin ninguna
    salida** (*Liberar* solo funciona con la mesa vacía), y con ella **el cierre de turno**, que se
    bloquea si el área tiene mesas abiertas. Ahora se cierra por el **camino normal** como una venta
    de **importe 0**: el consumo y su **costo** quedan registrados y el ingreso es 0 — que es
    exactamente lo que se pedía, *"el costo sí, la venta no"*. No hizo falta inventar nada: la venta
    ya congelaba el `unitCost` de cada línea, el stock ya salió al agregar cada ítem y `saleRevenue`
    ya prorratea el descuento **sin tocar el costo**. **No se guarda ninguna marca nueva:** una venta
    con `discountPct === 100` **ES** la cortesía (derivable, sin esquema Dexie ni colección de sync).
    La regla vive en `lib/orderTotals.js` (`isCourtesy`, pura y probada) y exige **las tres cosas a
    la vez**: que haya líneas (si no, una mesa vacía se "cobraría" y nacería una venta de la nada),
    que el descuento sea del 100% (si no, se colaría cualquier mesa que dé 0 por otro motivo, que no
    autorizó nadie) y que no quede importe por cobrar. Con cortesía **no se pide forma de pago** y el
    cobro se fuerza a **efectivo 0** en la moneda base (si no, podía nacer una "transferencia de 0"
    con referencia vacía); sumar 0 no mueve la caja ni el arqueo, y `salesRepo` ya ignora los
    importes de 0 al acreditar tesorería. El **ticket** imprime `CORTESÍA · NO COBRADO` y el reporte
    *Ventas por mesa* marca esas filas como **Cortesía** —la columna *Método* diría "Efectivo", que
    es mentira— con un pie de cuántas y cuánto consumo se regaló, **data-driven**: sin ninguna, el
    reporte sale idéntico. **Sin descuento del 100% nada cambia**, y no se razonó: se extrajo el
    `canPay` real de la rama y el de `main` y se compararon sobre **2.160 combinaciones**, con
    **0 diferencias** fuera de la cortesía y control negativo que sí las detecta (608); y el
    `buildTablesReport` **real de los dos árboles** se ejecutó sobre la misma base sembrada
    (`fake-indexeddb`): **salida idéntica** sin cortesías, con y sin `divisas`. **El criterio del
    100% vive en UN solo sitio** (`isCourtesyPct`) porque escribirlo tres veces —pantalla, ticket y
    reporte— ya había divergido: el ticket **reimpreso** no decía CORTESÍA. Acta y los tres
    hallazgos de la auditoría en `docs/COCTELERIA-Y-MESAS.md` **§C6**.
  - **El panel del dueño muestra el valor REAL:** el descuento se **prorratea** entre las líneas
    de la venta (`lib/saleRevenue.js`), en proporción a su importe, para que total, por producto,
    por categoría y por área queden coherentes entre sí. **El costo no se toca** (la mercancía
    costó lo mismo aunque se regalara el precio). Sin descuento el factor es 1 y la aritmética es
    **idéntica** a la de antes (200.000 comparaciones, 0 diferencias).

## Cierre de los modales (base, 16-09-2026)

**Ningún modal se cierra por accidente llevándose lo que estabas escribiendo.** Nace de un fallo
real: el dueño seleccionaba con el ratón el valor de un campo, soltaba el botón un poco más allá
del borde del recuadro **y el formulario se cerraba perdiéndolo todo**.

**Por qué pasaba.** Los **30** modales se montan igual —un fondo `.modal-backdrop` con `onClick`
que cierra y, dentro, el recuadro con `stopPropagation`—. Esa parada protege el clic normal de
dentro, pero **no** el gesto que empieza dentro y termina fuera: el navegador dispara el `click`
sobre el **ancestro común** de donde se apretó y donde se soltó, y ese ancestro **es el fondo**. El
evento no viene de dentro, así que no hay nada que detener.

- **La regla vive en `src/lib/modalClose.js`** (pura, con su suite: `shouldCloseOnBackdrop` y los
  dos manejadores `backdropProps`). **No es un hook**: la marca del gesto se guarda en el propio
  nodo del fondo (`dataset`), así que se puede llamar dentro de un `&&` o un `map` sin las reglas
  de los hooks, el cambio en cada pantalla es de **una línea**, y el comportamiento **completo** se
  prueba con node sin React.
- **Dos reglas.** (1) El fondo cierra solo si el gesto **empezó** en el fondo — esto mata el caso
  del arrastre **sin preguntar nada**, porque seleccionar texto nunca fue una intención de cerrar.
  (2) Los **22 modales con campos** no se cierran por el fondo **en absoluto**: se sale por
  *Cancelar*, por la X o con **Escape** (`useEscapeClose`, que no se tocó). Los **8 de aviso**
  —PIN, bienvenida, menú de mesa, motivo de entrega fallida…— **conservan** el cierre por el fondo:
  ahí no hay nada que perder.
- **Se descartó preguntar «¿hay cambios sin guardar?»**, y conviene saber por qué: sin tocar la
  lógica de cada formulario solo se puede **adivinar** desde fuera, y en esta app hay datos que se
  meten **sin escribir en un campo** —el PIN es un teclado de botones, los insumos de una receta se
  marcan, las escalas de precio se añaden con un botón—, así que la adivinanza tendría huecos y
  prometería una protección que no da.
- **Antes de tocar nada se comprobó que nadie queda encerrado:** los 22 formularios tienen salida
  visible (botón *Cancelar* o equivalente). Era el único modo real de romper algo.
- **CERO lógica de negocio tocada, cero esquema, cero sincronización.** El diff son **exactamente**
  la línea del fondo y el `import`, en 18 ficheros: medido fichero a fichero (`+n+1 / -n`), **0
  cambios inesperados**.

## Vista de escritorio (base, 16-09-2026)

En la computadora la app se veía **igual que en el teléfono**: una columna de 480 px centrada, sea
cual sea el monitor. Ahora, **a partir de 1.024 px**, el mismo armazón se reordena en una rejilla con
**barra lateral** a la izquierda y contenido ancho. Plan, validación y acta en
**`docs/VISTA-ESCRITORIO.md`** (§11 la validación del plan, §12 la ejecución de F1+F2).

- **El teléfono NO cambia, y está demostrado byte a byte.** Todo vive dentro de
  `@media screen and (min-width: 1024px)`: por debajo de ese ancho **no existe ni una regla nueva**,
  y `screen` deja el **ticket térmico** intacto **por construcción** (nunca aplica al imprimir). El
  diff de `global.css` es **+246 / −0**: cero borrados, estrictamente aditivo. La prueba se hizo
  montando el **`Layout` real** con el **CSS real** en un arnés de Vite (los cuatro proveedores
  sustituidos por stubs) y capturando con Edge headless a 390 px: `SHA256` **idéntico** contra
  `HEAD`, capturas **deterministas** (`--virtual-time-budget` + `--force-device-scale-factor=1`) y
  **control negativo** (umbral bajado a 320 px) que **sí** difiere. La primera tanda salió **en
  blanco** —`file://` bloquea los módulos ES— con los tres ficheros del **mismo tamaño**: sin
  abrirlos, «idénticas» habría sido una mentira perfecta.
- **La única regla fuera del `@media` es `.app-side { display: none }`.** La barra lateral se monta
  siempre y el CSS la oculta, **en vez de preguntar el ancho desde JavaScript**: así se conserva la
  propiedad de que **ningún componente de la app mide la ventana** (cero `innerWidth`, `matchMedia`,
  `ResizeObserver`, `clientWidth` y `offsetWidth` en todo `src/`), que es la que permite afirmar que
  el móvil no puede cambiar de comportamiento. `display:none` además la saca del orden de tabulación
  y del árbol de accesibilidad: en el teléfono no existe ni para un lector de pantalla.
- **Qué entradas lleva la barra lo decide `src/lib/navSections.js`, un módulo PURO** (sin React, sin
  Dexie y sin lucide) con **suite propia de 277 aserciones**. **No decide nada nuevo:** replica,
  entrada por entrada, las puertas que ya aplican `Home.jsx` y la barra inferior. Se hizo así porque
  la barra inferior tiene 6 entradas y la lateral pasa de veinte: repetir ahí `hasModule(...)` a mano
  es **exactamente como nace una fuga de licencia**. La suite comprueba que sin licencia **ninguna**
  ruta de módulo aparece para **ninguno** de los cuatro roles, que con **un solo** módulo salen las
  suyas y **no las de los otros nueve** (esto caza la puerta copiada y pegada mal), y que **ningún
  grupo queda vacío** — un título «GESTIÓN» sobre la nada delata el módulo aunque no haya nada
  clicable. Con **control negativo**: sin él, todas esas aserciones pasarían aunque la función
  devolviera siempre una lista vacía.
- **`Layout.jsx`: +118 / −3**, y las tres bajas son sustituciones en el sitio (el `import` de lucide,
  el `useAuth` y la línea del `<nav>`). Monta **una** consulta viva a `config` (no cinco) y el
  contador de entregas por cobrar **gateado en la consulta**, no solo en el render. **Solo lee.**
- **Movimiento: uno solo y autoral** — al cambiar de pantalla, el contenido entra (280 ms). Continúa
  el idioma que la app ya tenía (misma curva `cubic-bezier(0.22, 1, 0.36, 1)` y misma duración del
  acordeón) en vez de inventar otro. Lo demás son **estados** de puntero (hover y foco en la lateral
  y en las tarjetas), que en un móvil no existen y que con ratón son la diferencia entre una tarjeta
  clicable y un rectángulo. Todo se apaga con `prefers-reduced-motion`.
- **Dos defectos propios, encontrados midiendo y corregidos:** `--text-3` sobre el blanco del tema
  claro da **4,47:1** (por debajo del 4,5 exigido) y se cambió a `--muted` (5,36 oscuro / 5,14
  claro); y `auto-fill` en `.kpi-grid` dejaba una pista vacía que descuadraba el borde derecho →
  `auto-fit` (en `.home-grid` se deja `auto-fill` **a propósito**: son fichas, y dos fichas
  estiradas a 1.100 px serían peor que un hueco al final).
- **CERO lógica de negocio, cero esquema Dexie, cero `SYNC_COLLECTIONS`, cero escrituras a la base.**
  **Riesgos de convivencia de versiones: ninguno** — no cambia ningún dato ni formato, así que un
  teléfono actualizado y otro sin actualizar se entienden exactamente igual que hoy. Quitar el
  bloque `@media` y el componente `SideNav` devuelve la app a como estaba.
- **Peso:** CSS 81,52 → **84,92 kB**; chunk principal 990,50 → **999,33 kB** (gzip 288,01 →
  **290,85**). En conjunto **+3,53 kB gzip (+1,2 %)**. Como el chunk lleva hash, actualizar cuesta
  la descarga completa (~291 kB gzip por teléfono), no el delta.
- **NADIE HA EJECUTADO LA APP en una computadora.** Y **solo se compuso el Inicio**: las otras 37
  pantallas heredan lo transversal (armazón, tope de ancho, medida de lectura de 72ch y tope de los
  campos) pero **no están revisadas una a una** — eso es la **F3**. `.modal` (560 px) no se tocó, y
  los dos defectos preexistentes de accesibilidad (`.btn--sm` ~34 px, `.badge--bad` 3,72:1) siguen
  donde estaban.

## Divisas (módulo `divisas`)

Precios de catálogo en **divisa** (USD). Gateado por la licencia `divisas` (OFF por defecto); sin
él —o sin productos en divisa— la app queda **idéntica a la clásica**. Diseño validado con el dueño:
el precio **flota en USD** y el **MN se deriva al cobrar** con la tasa vigente (conversión inversa:
`MN = USD × tasa`). **MN sigue siendo la base interna**; USD es solo la capa **visible**.

- **Por producto (mixto):** cada producto puede fijarse en su moneda con el campo `priceCurrency`
  en `products` (p.ej. `USD`). Sin el campo = MN = comportamiento clásico. Helper
  `isForeignPriced(product, base)` en `src/lib/currency.js`. Es un campo **sin índice y sin
  migración** Dexie (opcional, como `sales.area`).
- **Autoría gateada:** el selector *"Moneda del precio"* en `ProductForm` y la columna *"Moneda"*
  opcional de la importación solo aparecen con `hasModule('divisas')`. El precio/costo se guardan
  tal cual (en USD); nada se convierte al guardar.
- **POS (venta directa):** al agregar al carrito se convierte USD→MN con la **tasa vigente** y se
  **congela por línea** el par `priceCurrency`/`priceRate` (junto al precio, que ya se congelaba).
  Sin tasa definida no deja vender (aviso "Falta tasa"). El resto del cobro (efectivo/transf./mixto)
  no cambia: siempre cuadra en MN.
- **Mesas y mermas:** igual. `ordersRepo.addItem` lee la tasa internamente y congela el par por
  línea; las mermas valoran la afectación (costo) en MN a la tasa vigente. Sin tasa, ambas bloquean.
- **Ticket de mesas (impresión):** si el cobro fue en **divisa** (USD), el ticket térmico muestra el
  **monto pagado en esa moneda** (efectivo: total/pagó/vuelto; transferencia: pagó), leyendo los
  importes **congelados** de la venta —el **mismo cálculo que muestra el turno** (`ShiftSalesSummary`)—.
  Gateado por `divisas` y solo si la moneda del cobro ≠ base; sin eso, el ticket queda **idéntico**
  al clásico. El pago mixto ya listaba cada parte en su moneda (base de `mesas`) y se conserva.
- **Reportes (valor en MN + columnas USD de referencia):** los reportes se **valoran en MN**
  respetando `priceCurrency`, y —**solo con el módulo activo y si hay productos en divisa**— ganan
  columnas de **referencia en USD** (precio, importe, costo y sus **totales**) y el inventario pasa
  a horizontal. Cada builder recibe `divisas`; cada columna/total cuelga de
  `hasForeign = divisas && <hay algún ítem en divisa>`. Sin eso: columnas, filas y orientación
  **idénticas** al clásico.
- **Conversión data-driven (degradación segura, decisión del dueño):** la **conversión** USD→MN se
  hace **siempre** que la línea/el producto tenga `priceCurrency` (con o sin módulo), para que
  **quitar la licencia no distorsione** ventas ni productos ya en divisa (se siguen valorando bien
  en MN). Lo que el módulo gatea es la **autoría** (elegir divisa) y la **presentación** (columnas
  USD y el monto en divisa del ticket). Quitar `divisas` no rompe ni borra nada (append-only): solo
  desaparecen esas columnas/el monto en divisa y la opción de fijar nuevos productos en divisa.

## Cocina (módulo `cocina`)

Recetas + **tablero de cocina**: el dueño define recetas y el **Cocinero** (rol `COOK`) elabora y
envía a las áreas. Gateado por la licencia `cocina`; sin él —y sin el rol— la app queda **idéntica
a la clásica**. Pantallas en `features/kitchen/`: `RecipesScreen` (recetas + *Abastecer cocina*,
solo mando), `RecipeForm` (editor) y `KitchenScreen` (tablero `/cocina`). Repos: `recipesRepo`,
`kitchenRepo`. Ubicación **sentinel** `COCINA = '__cocina'` (como `__almacen`/`__elaboracion`).

- **Receta = insumos + su producto elaborado.** `recipesRepo.create` da de **alta el elaborado**
  REUSANDO `productsRepo` (no reimplementa el catálogo), en **una transacción** (producto + receta).
  `items = [{ productId, qty }]` = consumo por **1 unidad** del elaborado. Foto (`imagenes`) y
  *"Moneda del precio"* (`divisas`) gateadas igual que en `ProductForm`. El costo del elaborado **no
  se teclea**: se deriva al producir (promedio ponderado).
- **Abastecer cocina (mando):** envía insumos del **almacén central → `__cocina`** reusando el
  traspaso general (`transfersRepo.move`, sin cambios): es una **salida** como hacia cualquier área.
  El panel **NO lista los elaborados** (la salida de una receta): esos se producen, no se abastecen.
  El checklist de insumos de una receta tampoco lista elaborados.
- **Tablero (`/cocina`, cocinero y mando):** una tarjeta por receta con *"Puedes elaborar: N"*
  (`kitchenRepo.canMake` = mínimo sobre insumos de `floor(stockCocina / consumo)`); en 3 toques
  (receta → cantidad + área → *Elaborar y enviar*) llama a `kitchenRepo.produce`. **No muestra
  costos** (alcance del rol). Mosaico responsive (`.kitchen-grid/.kitchen-tile`) que aguanta 20+ recetas.
- **`kitchenRepo.produce` (motor, atómico):** elabora `units` y las ENVÍA al área en **una
  transacción**. Replica el patrón de `conversionsRepo` (consumir insumos → crear elaborado) +
  `transfersRepo` (cocina → área) DENTRO de su propia transacción (no toca esos repos). Valida cada
  insumo contra el **LIBRO MAYOR** (`[productId+location]`, candado de última instancia como
  `salesRepo`), no la caché. **Costo por promedio ponderado**; insumo en divisa → costo a MN a la
  tasa vigente; sin tasa **bloquea**. El costo del elaborado se guarda en **su** moneda (invariante:
  precio y costo van en `priceCurrency`); movimientos y snapshot llevan MN. Usa tipos **existentes**
  `CONVERSION_OUT/IN` (cocina) + `TRANSFER_OUT` (cocina) / `TRANSFER_IN` (área): neto en cocina = 0,
  el total sube `+u` y termina en el área. Snapshot append-only en `productions`.
- **Ciclo de vida de la receta (solo dueño):** *dar de baja/reactivar* (`setActive`, transaccional)
  **sincroniza el elaborado**: darla de baja lo retira del catálogo; reactivarla lo **restablece** (y
  limpia su baja si se había eliminado del catálogo). *Eliminar* (`remove`) = **borrado lógico**
  (`deletedAt` + baja del elaborado con evento en Auditoría → *Bajas*); nada se borra (producciones y
  ventas se conservan). `list()/listActive()` no listan las eliminadas.
- **Conteo físico (base + cocina):** en *"¿Qué vas a contar?"* aparece **Cocina** con el módulo. Y
  como cambio **de base** (todas las ubicaciones), al teclear el real contado el mando ve el
  **importe** de la diferencia (sistema − real): por **precio de venta** en áreas (venta estimada
  sin carrito) y por **costo** en la cocina (lo consumido), en MN a la tasa; con total del área y el
  **sobrante** aparte. Es **solo informativo** (no cambia el ajuste, que sigue igualando el stock al real).
- **Reportes y auditoría:** *Producción de cocina* (Reportes, gateado): receta, área, unidades y
  **costo** (insumos y unitario), sin precio ni ganancia. *Inventario por ubicación* capta la columna
  **Cocina** (data-driven: solo si hay existencia). Auditoría → pestaña **Cocina** (elaboraciones +
  abastecimientos). El submayor ya clasifica `CONVERSION_*/TRANSFER_*`, sin cambios.
- **Datos y degradación:** Dexie **v13** (`recipes`, `productions`), ambas en `SYNC_COLLECTIONS`
  (`recipes` LWW por `updatedAt`; `productions` append-only). Sin el módulo quedan vacías y la app es
  idéntica. Quitar `cocina` no borra recetas ni elaborados (append-only); conviene **cambiar el rol**
  de un Cocinero antes de quitarlo (si no, queda sin turno ni tablero).

## Coctelería (módulo `cocteleria`)

El trago se elabora **DENTRO del área** (la terraza, el bar), consumiendo **su** stock, y **queda
ahí mismo** listo para venderse. Gateado por la licencia `cocteleria`; sin ella la app queda
**idéntica a la clásica**. **Independiente de `cocina`** (un bar sin cocina central compra solo
este) y **NO crea ningún rol nuevo**. Plan y actas de ejecución en
**`docs/COCTELERIA-Y-MESAS.md`** (leerlo antes de tocar el módulo). **CERO esquema Dexie y CERO
colecciones de sync nuevas.**

- **Un solo motor para los dos tableros.** `kitchenRepo.produce` gana `fromLocation` (**default =
  `__cocina`**, o sea el comportamiento clásico) y `KitchenScreen` recibe un `kind`: la MISMA
  pantalla sirve `/cocina` y `/cocteleria`. **Qué** movimientos se escriben lo decide
  `lib/kitchenMath.js` (puro, probado con node): cuando **origen = destino** NO se emiten
  traspasos —serían neto cero y ensuciarían el submayor con traspasos que nunca ocurrieron—; con
  el default sale **exactamente** la misma secuencia de siempre (`CONVERSION_OUT` por insumo,
  `CONVERSION_IN`, `TRANSFER_OUT`, `TRANSFER_IN`), comprobado contra `main`.
- **Candado de coherencia en el motor** (última instancia, aunque el llamador se equivoque): una
  receta de coctelería no se puede elaborar desde la cocina ni con origen ≠ destino, y una de
  cocina solo desde `__cocina`. La receta manda.
- **Tipo de receta:** campo `recipes.kind` **opcional, sin índice ni migración** (como
  `sales.area`); **ausente = cocina**, que es como nacieron todas las existentes, y solo se
  escribe cuando vale `'cocteleria'`. **No se edita** (`recipesRepo.update` no lo toca): cambiarlo
  movería la ubicación de la que consume y dejaría su historial sin sentido.
- **Quién lo opera:** el **mando** (elige el área) y el **vendedor** con el permiso del dueño, que
  trabaja en el área de **su turno abierto** (sin turno no hay área de la que consumir). El
  **cocinero NO** (no es lo suyo). Los insumos llegan al área por el **traspaso normal**
  (`TransferScreen`, sin cambios): la coctelería **no se abastece aparte**.
- **Ajustes → *Tableros de elaboración*:** `sellerKitchenBoard` nace **ACTIVADO** (hoy el vendedor
  ya ve el tablero de cocina; apagarlo por defecto le quitaría algo que tiene — regla 2) y
  `sellerCocktailBoard` **APAGADO** (función nueva). Un solo interruptor **global**, no por área:
  el filtro real lo pone el stock (un área sin insumos muestra *"Puedes elaborar: 0"*).
- **Elaborar con FALTANTE (`allowShortProduction`, apagado por defecto, para los DOS tableros).**
  Para cuando la mercancía **está físicamente** pero falta registrar su entrada. Sin el permiso,
  el candado de siempre: falta un insumo y no se elabora. Con él, el descubierto se **confirma
  explícitamente**, se anota en `productions.shortages` y la existencia queda en **negativo**
  hasta que una entrada, un traspaso o el conteo la neteen. El error de faltante va marcado con
  `code:'short'` para que la pantalla lo distinga sin comparar textos (la caché puede ir por
  detrás del libro mayor tras una sync). **No relaja ningún otro candado**: producto inexistente o
  dado de baja, y falta de tasa de una divisa, siguen lanzando (son faltas de DATO, no de
  mercancía). Aviso al dueño en el **centro de notificaciones** (categoría `elaboracion`, deriva
  del EVENTO con su fecha y su autor, no de un barrido del stock).
- **Reportes y auditoría:** la tarjeta de producción es **una sola** para los dos módulos y el
  builder filtra por los tipos que la licencia permite (**default `[cocina]`** = el lado seguro:
  oculta, no cuela). Con solo `cocina`, título, columnas y nombre de fichero son **los de
  siempre**; con coctelería gana la columna **Tipo** y el "Área destino" pasa a **Área** (con
  coctelería dentro, "destino" sería mentira en la mitad de las filas). Auditoría: la pestaña
  sirve a los dos módulos y **cada fila se filtra por el módulo de SU tipo** (sin fugas).
- **Degradación:** quitar `cocteleria` no borra nada — las recetas quedan y los tragos siguen en
  el catálogo con su stock y su historial de ventas; solo deja de ofrecerse el tablero, la
  tarjeta, el selector de tipo, el interruptor, el artículo de ayuda y el filtro del reporte. Las
  producciones de coctelería **dejan de listarse** (a diferencia de las filas de `remesas` en
  cuentas, que sí se conservan a la vista: allí había dinero de tesorería y ocultarlo descuadraba
  la suma; aquí el inventario ya está en el libro mayor y no se descuadra nada). **No queda ningún
  rol huérfano.**

## Fusión del 23-09-2026 — Cocina en Mermas y en el Submayor por producto

**FUSIONADO A `main` EL 23-09-2026**, con autorización explícita del dueño. Fast-forward de los
**dos** commits de `claude/awesome-dirac-484azm`: `origin/main` pasó de `dd49df4` a **`e4ac3ab`**, y
rama y `main` quedaron **idénticas** (`git rev-list --left-right --count origin/main...HEAD` = `0 0`
y `git diff HEAD origin/main` **vacío**). Se hizo con `git push origin HEAD:main`, **sin `--force`**
y sin checkout de `main`: si no hubiera sido fast-forward, el servidor lo habría rechazado en vez de
reescribir historia; comprobado **después** que `dd49df4` sigue siendo **ancestro** de `origin/main`.
De los dos commits, **uno es solo `CLAUDE.md`** (`8484f5c`, el acta de la fusión anterior, +5/−1):
el diff de **código** contra `main` es **únicamente** este cambio. **Comprobar el commit real con
`git rev-parse origin/main` tras un `git fetch`: esta acta se autoinvalida en cuanto ella misma se
suba, así que no dar por bueno ningún hash escrito aquí salvo el del código (`e4ac3ab`).**

**Qué hace.** La cocina (`__cocina`) es una ubicación más del inventario, pero no se ofrecía ni para
registrar **mermas** ni para filtrar el **submayor por producto**. Un insumo que se echaba a perder
en la cocina no tenía cómo registrarse, y el movimiento de los productos por la cocina no se podía
consultar aislado.

**El cambio son DOS `<option>` gateadas, y esa es la noticia:** no hizo falta tocar ni el motor ni
los repos, porque **ya eran genéricos por ubicación** (verificado leyéndolos, no supuesto):
- `mermasRepo.create` recibe `location`, valida la existencia en ella con `stockAtLocation` y
  escribe el `MERMA_OUT` con esa ubicación. Con `__cocina` funciona sin cambiar una línea.
- `buildProductLedger` / `buildProductsLedgerSummary` filtran por
  `(m.location || WAREHOUSE) === location`, o sea por la cadena que reciban.
- `ledgerKey` ya clasifica los `CONVERSION_OUT/IN` y `TRANSFER_OUT` que la cocina escribe
  (`consumo`, `producido`, `traspOut`), así que **ningún movimiento cae en el cajón de sastre**
  `ajustes`.

Orden y forma copiados **literalmente** de `CountScreen.jsx`, precedente ya fusionado del mismo
patrón: `{canKitchen && <option value={COCINA}>{locationLabel(COCINA)}</option>}`. **Sin emoji a
propósito**: no existe ninguno de cocina en todo `src/` (0 coincidencias) y no se inventa vocabulario
visual nuevo.

**Auditoría previa (ejecutada, no citada), y verificada OTRA VEZ después sobre el árbol que quedó
en `main`:**

- `npm run build` **exit 0** · **26 suites / 1.451 aserciones** en verde, **0 fallos** (1.393 en las
  24 de node directo + 47 de `ordersRepo` + 11 de `syncLog`).
- **La salida de las 24 suites es BYTE A BYTE idéntica** a una línea base capturada **antes de tocar
  nada** y guardada fichero a fichero (`diff -r` sin diferencias). Es la prueba de que nada existente
  cambió de conducta, no una inferencia.
- **CERO cambios en los ficheros sensibles** contra `origin/main`: `src/db/db.js`,
  `src/features/sync/`, `src/repositories/`, `firestore.rules`, `firestore.indexes.json`,
  `package.json` y `package-lock.json` — `git diff --stat` **vacío**. Dexie sigue en **v19** y
  `SYNC_COLLECTIONS` en **34**, leídos del árbol. **No hay que redesplegar reglas de Firestore**
  (usan el comodín `{document=**}`, `firestore.rules:19`).
- **CERO escrituras a la base en todo el diff** (`.add/.put/.update/.delete/transaction` = 0) y
  **2 líneas borradas en todo `src`**, leídas una a una: son los dos `import` de constantes que ganan
  `COCINA`. El diff completo es **+19 / −2** y cabe en una pantalla.
- **Sin fugas de licencia, y PROBADO RENDERIZANDO las dos pantallas reales** en node
  (`react-dom/server`, con los proveedores sustituidos por stubs y las pantallas **sin modificar**):
  con los **otros nueve** módulos el HTML es **idéntico** al de sin licencia, y quitando **solo** esa
  `<option>` del HTML con `cocina`, vuelve a ser **byte a byte** el de sin licencia. Con **control
  negativo** que sí distingue los dos estados — sin él la prueba no mediría nada. Las puertas suben
  (`MermaScreen` 0→2, `ProductLedgerScreen` 2→3) y **ninguna existente se relajó**: Home 17→17,
  `Layout` 4→4, Reportes 12→12, Auditoría 5→5, y **0** `hasModule`/`isOwner`/`isManager` borrados.
- **Prueba de punta a punta con BASE REAL** (`fake-indexeddb`) y código de producción: la merma en
  cocina rebaja 14 → 10, el `MERMA_OUT` sale de `__cocina` con −4, el candado de existencia sigue
  rechazando (*«Solo hay 10 u de Queso en Cocina»*, que además demuestra que `locationLabel` etiqueta
  bien), y el submayor filtrado por Cocina da **Traspasos 20 / Consumo −6 / Mermas −4 / Ajustes 0 /
  Existencia 10** (cuadra: 20−6−4). **Control negativo:** una venta de −99 en «Cafetería» **no** entra
  en el submayor de Cocina y **sí** aparece filtrando por Cafetería. *(Ese arnés era temporal y **NO
  se commiteó**: no protege contra regresiones futuras.)*
- **Riesgos de CONVIVENCIA de versiones: NINGUNO**, verificado contra el código de `origin/main`, no
  razonado. El build **viejo** ya tiene `COCINA` en `constants.js:213` y su `locationLabel` devuelve
  `Cocina` en `:262`, así que un teléfono sin actualizar que reciba una merma de cocina imprime
  **«Cocina»**, no `__cocina` en crudo; y su `recomputeStock` usa `const loc = m.location ||
  WAREHOUSE` **sin lista blanca**, así que reconstruye el stock de `__cocina` igual que el nuevo.
  `mermas` y `stockMovements` **ya estaban** en `SYNC_COLLECTIONS`: no hay formato de dato nuevo.
- **Peso:** CSS con **hash idéntico** (`index-B34NE6G1.css`, 87.657 bytes) → byte a byte igual. Chunk
  principal 1.017,18 → **1.017,37 kB** (gzip 297,22 → **297,24**): **+186 bytes crudos, +68 gzip
  (+0,02 %)**, medido reconstruyendo `main` con el **mismo** comando de gzip, no comparando contra el
  número que imprime Vite.
- **Esta fusión NO sube esquema** (v19 en los dos árboles), así que el retroceso a un build del mismo
  esquema es viable. El respaldo previo al despliegue sigue siendo lo sensato.

**EL DUEÑO LO PROBÓ EN LA APP y funciona correctamente.** Es la validación de runtime que el resto de
las actas no pudo dar, y por eso se dice aquí explícitamente. **Pero cubre lo que se probó:** no
consta que se ejercitaran el **submayor filtrado por Cocina**, la app **sin la licencia `cocina`**,
ni **dos aparatos sincronizando** una merma de cocina. Esas tres siguen sin evidencia de runtime.

**Lo que esta fusión NO puede garantizar:**
- **Ninguna suite cubre estas dos pantallas, ni puede:** el proyecto no tiene pruebas de pantalla. La
  prueba de render fue un arnés temporal, fuera del repo.
- En ese arnés `useLiveQuery` está stubeado, así que la lista de **áreas salió vacía**: el **orden**
  de la opción respecto a las áreas (Almacén → Cocina → áreas) está verificado **leyendo el diff** y
  copiado de `CountScreen`, **no** renderizado con áreas pobladas.
- **`mermasRepo` sigue validando contra la caché**, no contra el libro mayor (decisión del dueño; ver
  el matiz en la sección «Mermas»).

**Degradación (declarada y aceptada por el dueño):** si se QUITA `cocina`, las mermas ya registradas
en la cocina **siguen apareciendo** en el reporte *Mermas* y en la lista de recientes, etiquetadas
«Cocina» — `buildMermasReport` no filtra por ubicación ni por módulo. Es el criterio de las filas de
`remesas` en Cuentas: un negocio que nunca tuvo el módulo no tiene **ninguna** de esas filas y no ve
nada, así que **no es una fuga**; ocultarlas, en cambio, descuadraría el total de afectación al
costo. **No «corregir» esto ocultando las filas.**

**Dato preexistente que conviene no confundir con este cambio:** el submayor con «Todas las
ubicaciones» **ya sumaba** los movimientos de `__cocina` antes de esto, sin módulo. Lo único nuevo es
poder **filtrar** por ella.

**Lo que NO se amplió, a propósito:** Mermas sigue **sin** ofrecer Elaboración ni Entregas (nunca las
ofreció), el rol **no** cambió (`/mermas` sigue siendo `isManager`: el cocinero no entra) y el reporte
de Mermas no se filtró por licencia.

**Fusionar NO es desplegar:** lo que hay en producción sigue siendo el build anterior hasta que el
dueño corra `npm run deploy`.

## Estado del trabajo en curso (24-09-2026)

**EN LA RAMA, SIN FUSIONAR: «Control de Ventas Diarias»** (Reportes → Ventas), que pide Burger
Premium para sustituir su hoja de papel. Es su **documento primario**. Spec y plan en
`docs/superpowers/specs|plans/2026-09-24-control-ventas-diarias*.md`.

- **Qué muestra:** por día y ubicación, en orden alfabético, las columnas saldo inicio, entrada,
  salida, merma, venta, **ajuste**, precio, importe y saldo final.
- **De dónde sale:** todo del **libro mayor**, con el `ledgerKey` existente inyectado. **Ninguna
  cifra sale de la caché.** Las cantidades usan `cleanQty` (sin perder gramos).
- **Qué comprueba el propio reporte, y lo imprime:**
  - el dinero: consumo cobrado contra los importes, con servicio, descuentos y causas;
  - que la caché coincide con el libro;
  - la integridad del libro (`atomicity.js`).
- **Dónde vive:** lógica pura en `src/lib/dailySalesControl.js`. En `reportsService.js`, tres
  funciones de solo lectura **al final** (+40 / −0; el byte NUL preexistente, intacto). Una ficha
  en *Ventas* con selectores de ubicación y categoría.
- **Validado con los 4 respaldos reales**
  (`docs/auditoria/validar-control-ventas.mjs`, con `TZ=America/Havana`):
  - **16.485 filas** contra un recálculo independiente del libro, y **1.828 cotejos** con el
    submayor consolidado: todo cuadra;
  - La Patrona A avisa de las 8 ventas sin movimiento, y B de ninguna;
  - control negativo de la validación completa: **6.775 fallos**.
- **Lo que no se puede garantizar:**
  - cómo se ve el PDF en el teléfono del cliente;
  - si el aparato tiene el libro incompleto (H3), el reporte **lo avisa** pero no inventa las
    filas;
  - «Tres leches» y «Javas», del papel, **no existen** con ese nombre en el sistema.

## Estado anterior (23-09-2026)

**FUSIONADO A `main` EL 23-09-2026** (fast-forward `732f4ec` → **`dd49df4`**, autorizado por el
dueño, tras una auditoría previa ejecutada: build exit 0, CSS idéntico byte a byte, chunk
+5,6 kB (gzip +1,9 kB), 26 suites / 1.451 aserciones, 0 líneas borradas en `src`, sync y esquema
sin cambios, SDK de Firebase fuera del chunk principal, dos revisiones independientes sin críticos).
**Sin desplegar.** El **reenvío que compara antes de escribir** (spec
`docs/superpowers/specs/2026-09-23-reenvio-comparando-design.md`, plan
`docs/superpowers/plans/2026-09-23-reenvio-comparando.md`). Sirve para reparar desde `/cloud` las
versiones de `products`, `counts` y `auditEvents` que un aparato tiene y la nube no. Es lo que le
falta a La Patrona de A hacia B.

- **Cómo decide:** una `runTransaction` por documento lee del servidor y escribe **solo** si la nube
  no lo tiene o lo local es **estrictamente** más nuevo por `syncTs`. Con marcas iguales no escribe,
  y si la nube es más nueva no escribe nunca.
- **Dónde vive:** en ficheros nuevos (`compareResend.js` puro, `compareResendEngine.js` con todo
  inyectado, `compareResendFirebase.js`). **`pushEngine.js` no se toca.** El panel solo lo ve el
  dueño con la sync activa, y la tanda tiene un tope de 1.000 documentos.
- **Validado con los respaldos reales:**
  - A → B escribe 36 fichas, 3 conteos y 5 eventos, con 0 casos de «la nube tenía uno más
    nuevo»; B → A escribe **0**;
  - con `mergeIncoming` + `recomputeStock` reales, B recibe precio y baja de A en 36 de 36, y su
    stock sigue igual a su propio libro.
- **Límite de la garantía** (revisión final independiente, sin críticos): es **por marca, no por
  contenido**. En `products`, cada venta sube `updatedAt` y reescribe la ficha entera. Un aparato que
  vendió sin haber recibido un cambio de precio repondría el precio viejo: por eso **se lanza desde el
  aparato con los datos buenos**, y el panel lo dice. En La Patrona no ocurre: los 3 precios y 3
  costos que se escriben son cambios del propio A, comprobado campo a campo.
- **Lo que no se puede garantizar:**
  - **no se ha ejecutado contra la Firestore real** ni en un teléfono;
  - cada documento escrito puede costar una lectura en cada aparato conectado;
  - **no repara lo que ningún aparato tiene**.

**FUSIONADO A `main` EL 23-09-2026**, con autorización explícita del dueño: fast-forward de 27
commits, `0711357` → **`732f4ec`** (ese es el árbol de código validado; comprobar `main` de hoy con
`git fetch` + `git rev-parse origin/main`, porque las actas posteriores lo adelantan). Entraron
Burger Premium 1–4 con sus dos revisiones, el diagnóstico de convergencia, el registro de la sync
en `/errors` y el vigilante de lotes. **Auditoría previa (ejecutada):**
- build exit 0 en los dos árboles; 24 suites / 1.400 aserciones;
- Dexie sigue en v19 y la sync sin cambios, salvo una línea de `doPush` verificada con `diff`;
- solo `fake-indexeddb` como dependencia de desarrollo;
- gzip +3,4 kB (+1,17 %);
- cinco revisiones independientes, ninguna con fallos críticos.

**Fusionar no es desplegar:** el despliegue lo hace el dueño. **Aviso al desplegar:** el candado
contra el doble cobro solo protege del todo cuando **todos** los teléfonos del negocio se han
actualizado.

**Sigue SIN resolver:** H3, la causa raíz, que solo tiene herramientas; La Patrona de A hacia B
(36 fichas con precios y bajas, que el reenvío actual no cubre a propósito); los conteos de La
Patrona §6/§7; y `applyBackup` sin LWW. Detalle en `docs/AUDITORIA-LA-PATRONA-22-09-2026.md` §14.

**Lo de abajo describe los puntos 1–4 tal como se programaron, antes de fusionar:** estaban
PROGRAMADOS, PROBADOS Y COMMITEADOS en `claude/awesome-dirac-484azm`. El
plan ejecutado está en `docs/superpowers/plans/2026-09-23-correccion-burger-premium.md`; el acta
completa de esta ronda —los cinco hallazgos de contrastar el §10 con el código, las decisiones
D1–D4, los resultados del control positivo y el hallazgo nuevo del pedido `180a7687`— está en
**`docs/AUDITORIA-BURGER-PREMIUM-21-09-2026.md` §11 (23-09-2026)**.

- **1 — H1 (hecho, commits `5375a4b`, `dba835f`):** candado de venta en `ordersRepo.voidItem` **y**
  en `ordersRepo.voidOrder` (el §10 solo preveía `voidItem`; `voidOrder` necesita el suyo propio
  porque una mesa sin líneas vivas no pasa por `voidItem` — hallazgo de esta ronda). Entra por el
  índice `shiftId`, cae a `filter` si es `null` (mesa reservada). La ronda de revisión añadió
  `catch` por mesa en los dos `releaseEmpties` de `ShiftScreen` (sin él, una mesa que el candado
  rechaza cortaba en silencio la liberación de las demás) y cerrar el modal de PIN al rechazar en
  `SalonScreen`.
- **2 — H2 (hecho, commit `fceba7d`; sube de "en espera" a hecho por D1 = a):** `charge` en
  `TableScreen` también queda bloqueado si ya hay venta viva (evita un cobro duplicado), y
  `ordersRepo.reconcileClosed` repara la cabecera `open` → `closed` + `saleId` al abrir el salón o
  la mesa, con el mismo patrón que `reconcileDiscount`: escribe **solo** `status` y `saleId`, nunca
  `updatedAt` ni `closedAt` (cuentan en `syncTs`; escribirlos re-subiría la reparación y podría
  pisar en la nube la cabecera real). **D1 = a:** sin esta salida, el candado del punto 1 dejaba una
  mesa cobrada pero `open` sin forma de cerrarla ni de liberarla, bloqueando el cierre de turno.
- **3 — H3-a (hecho, commits `f9e9e39`, `410bc62`):** panel «Reenviar a la nube» en `/cloud`,
  **solo** para las cuatro colecciones inmutables (`stockMovements`, `productions`, `purchases`,
  `transfers` — verificado sin `update`/`put`/`delete` en `src/`). Retrocede el cursor local
  `push:<colección>` y reusa `pushChanges()`, bajo el mismo cerrojo `running`. `doPush` no se tocó
  ni una línea (verificado con `grep '^-'`, vacío).
- **4 — H3-b (hecho, commits `c88132a`, `9a9a32b`):** `src/lib/atomicity.js` (puro) +
  `docs/auditoria/diagnostico-atomicidad.mjs` (CLI sobre un respaldo, fuera del bundle). Corrido
  contra los respaldos reales A1 y A2 de Burger: cuadra con lo que medía el acta (3
  `production-sin-mov`, 1 `mov-sin-production`, 1 `purchase-sin-mov`, 3 `transfer-sin-mov`) y
  encontró un **caso nuevo, no documentado antes**: el pedido `180a7687` ("Mesa 1") tiene un
  movimiento `order_void` sin su línea anulada, presente en A1 **y** A2 — mismo mecanismo H3, otra
  instancia. El backup **B** (Burger) y el de **La Patrona** no estaban en la máquina: su control
  positivo **no se ejecutó**.
- **Revisión de toda la rama (23-09-2026, commit `d7998d2`):** revisor independiente, veredicto
  *fusionable con arreglos menores*, **sin críticos ni importantes**. El dueño eligió arreglar los
  hallazgos **1, 3 y 4**: el candado de `voidItem` y el cierre de `voidOrder` **revalidan la venta
  dentro de su transacción**; al rechazar por venta viva la mesa **se repara en el acto**
  (`rejectCharged` → `reconcileClosed`, fuera de la transacción), también desde `charge`; y el
  mensaje dice que la mesa *queda cerrada con su venta*. **Después, también el 2 y el 7**: `addItem`
  gana el mismo candado (una línea nueva en una mesa cobrada rebajaba stock y no se cobraba) y el
  cobro pasa por un **cerrojo síncrono** (`createGate`, en un `useRef`) contra el **doble toque**
  en *Cobrar*, que podía crear dos ventas (**preexistente en `main`**). **Quedan abiertos, por
  decisión del dueño:** ~~el ticket reimpreso (5), el aviso de lecturas (6) y dos cosméticos
  (8, 9)~~ — **también hechos** el 23-09, con una **segunda revisión independiente** (veredicto
  *sí*, sin críticos) cuyos menores 1, 3 y 4 se corrigieron (§11.13). **Quedan abiertos a decisión
  del dueño:** el cerrojo del cobro es **por pantalla** (cerrarlo del todo exige tocar
  `salesRepo.create`, el camino de todas las ventas), `voidOrder`/`decrementOne` hacen varias
  transacciones seguidas (**preexistente**; la ventana es más estrecha, no cerrada) y el **punto 5
  (H3-c)**, que no se tocó. Acta en los §11.11 a §11.13 de la auditoría.
- **5 (H3-c): SIGUE EN ESPERA.** Que nada dependa solo del cursor de `pushEngine` es cirugía en el
  motor de sync y el dueño lo decide aparte, con la cifra del punto 4 ya en la mano (9 roturas en
  A1, 13 en A2, de las cuales la mayoría son huérfanos append-only ya conocidos, no crecimiento sin
  control).
- **D1 = a, D2 = sí, D3 = script, D4 = sí** (resueltas 23-09-2026, tabla completa en el plan): el
  punto 4 (H2) sube inmediatamente detrás del 1 como su salida; se instala `fake-indexeddb` como
  `devDependency` para probar los repos con base real; el diagnóstico queda como script de node
  (no entra al bundle); el reenvío se limita a las cuatro colecciones inmutables.
- **H4 sigue DESCARTADO**, sin cambios respecto al 22-09 (es síntoma del transporte, se cierra con
  el 5, no antes).

**Lo que esta ronda NO puede garantizar:**
- **Nadie ha ejecutado la app.** Ni un candado disparado en un teléfono, ni una mesa cobrada dos
  veces evitada de verdad, ni un cobro cortado a medias reparándose solo al abrir el salón.
- **El reenvío nunca corrió contra Firestore real.** La Task 3 se probó hasta el retroceso del
  cursor local; `writeBatch`/`setDoc` son los de siempre y no se ejecutan en node.
- **El control positivo del diagnóstico (punto 4) solo corrió sobre A1 y A2 de Burger.** Los
  respaldos **B** (Burger) y el de **La Patrona** no estaban disponibles en esta máquina, así que
  su control positivo queda **sin ejecutar** — el `kind` `sale-sin-mov` que mediría La Patrona está
  cubierto por un caso de prueba puro, pero no por datos reales.
- **El mecanismo exacto** por el que se pierden filas bajo el cursor sigue siendo hipótesis
  razonada, no observación directa (detalle en `docs/AUDITORIA-BURGER-PREMIUM-21-09-2026.md` §11).

**Orden operativo para el dueño, en este orden y no en otro:**
1. Correr `node docs/auditoria/diagnostico-atomicidad.mjs <respaldo.json>` sobre el respaldo de
   **cada** aparato del negocio, para ver qué colección le falta a cada uno.
2. Elegir, para cada colección con roturas, el aparato que **sí** tiene las filas completas (el
   diagnóstico lo señala: es el que no tiene `*-sin-mov`).
3. Desde ESE aparato, usar «Reenviar a la nube» (`/cloud`) para esa colección, desde una fecha
   anterior a la primera rotura.
4. **Solo después** de reenviar — nunca antes — volver a contar el producto o la ubicación
   afectada. Contar antes escribiría un delta en sentido contrario que rompería el otro aparato.

**🛑 Aviso operativo heredado del 22-09, sigue vigente hasta completar el paso 3:** no volver a
contar el producto que aparece en negativo en el aparato que lo muestra.

**Lo de abajo es el registro de las fusiones anteriores y se deja tal cual.**

## Estado del trabajo anterior (19-09-2026)

**YA ESTÁ FUSIONADO.** La vista de escritorio, el cierre de los modales y la cuenta de mesa
subieron a `main` el **19-09-2026**. Su acta está justo debajo. La de la interfaz (15-09-2026) y
las anteriores se dejan tal cual, como registro.

### Fusión del 19-09-2026 — escritorio, modales y la cuenta de una mesa

**FUSIONADO A `main` el 19-09-2026.** **Fast-forward** de los **21 commits de código** de
`claude/awesome-dirac-484azm` desde `5e1bc3d`, que dejaron `main` en **`e222fbf`** — **ese es el
árbol que se valida abajo y el que se despliega**. Verificado **después** del push, con `git fetch`
delante: rama y `main` idénticas (`git rev-list --left-right --count origin/main...HEAD` = `0 0` y
`git diff HEAD origin/main` **vacío**), y `5e1bc3d` **ancestro** de `e222fbf`, o sea que no se
reescribió historia.

**Después de eso subió esta acta**, que es **solo documentación** (`CLAUDE.md`, cero código), así
que **`origin/main` ya NO vale `e222fbf`**: va por delante en los commits de acta que se hayan
escrito, **sin que el build cambie**. Es la trampa de siempre y se repite a propósito aquí: **un
acta que escribe el hash de `main` se autoinvalida en cuanto ella misma se sube.** Por eso el único
hash que esta acta fija es el del **código** (`e222fbf`); para saber dónde está `main` **hoy**,
`git rev-parse origin/main` tras un `git fetch`, y para contar la distancia
`git rev-list --count e222fbf..origin/main`. **No dar por bueno ningún hash leído aquí.**

**El acta se escribió dos veces dando la fusión por hecha sin que se hubiera ejecutado; luego el
riesgo fue el contrario —decir «no fusionado» cuando ya lo estaba—. La regla es la misma en los dos
sentidos: comprobar el commit real, no leer el acta.**

**Validación posterior a la fusión, ejecutada sobre el commit exacto que está en `main`
(`e222fbf`), no citada:**

- `npm run build` **exit 0** · **16 suites / 1.191 aserciones** en verde, **0 fallos**.
- **CERO cambios en los ficheros sensibles** entre `5e1bc3d` y `origin/main`: `src/db/db.js`,
  `src/features/sync/`, `firestore.rules`, `firestore.indexes.json`, `package.json` y
  `package-lock.json` — `git diff --stat` **vacío**. Dexie sigue en **v19** y `SYNC_COLLECTIONS`
  en **34**, leídos del árbol. **No hay que redesplegar reglas de Firestore.**
- **Esta fusión no sube esquema**, así que el retroceso a un build del mismo esquema es viable. El
  respaldo previo al despliegue (`/backup` desde un dispositivo bueno, guardado **fuera** del
  teléfono) sigue siendo lo sensato.
- **Peso del build recién hecho:** CSS **87,66 kB** (gzip 27,10) y chunk principal **1.002,35 kB**
  (gzip **291,95**) — las mismas cifras que declaraba el acta previa.

**Fusionar NO es desplegar:** lo que hay en producción sigue siendo el build anterior hasta que se
corra `npm run deploy`. **El despliegue lo hace el dueño.**

Subieron la **vista de escritorio** (barra lateral, F3a del Inicio y los tres pasos del panel), el
**cierre de los modales** (`lib/modalClose.js`), la **cuenta de una mesa en el teléfono** (una fila,
nombre completo, columnas alineadas) y dos fallos de lógica del descuento de mesa.

**Auditoría previa (ejecutada, no citada):**

- **Sin esquema, sin sincronización, sin dependencias:** `src/db/db.js`, `src/features/sync/`,
  `firestore.rules`, `firestore.indexes.json` y `package.json` **con CERO cambios**. Dexie sigue en
  **v19** y `SYNC_COLLECTIONS` en **34**. No hay que redesplegar reglas.
- **CERO escrituras a la base en todo el diff** (`.add/.put/.update/.delete/transaction` = 0). De ahí
  que el **riesgo de convivencia entre teléfonos sea NINGUNO**: sin esquema, sin formato de dato
  nuevo y sin una sola escritura, un aparato actualizado y otro sin actualizar intercambian
  exactamente lo mismo que hoy.
- **Un solo fichero de la capa de datos:** `analyticsRepo.js` (+25/−1), **aditivo y de solo lectura**.
  `todaySummary()` consulta por el índice `createdAt` —comprobado que **existe** en `db.js:27`, y es
  el mismo patrón que ya usa `notificationService`— con ventana de 48 h, y filtra el día local.
- **Las dos sumas de dinero no pueden separarse:** `sumSales` se comparó línea a línea con el bucle
  real de `report()` (son idénticos) y su suite los contrasta sobre **500 conjuntos aleatorios**.
  **Control negativo:** un error del 0,01 % en el costo hace fallar 499 de 500.
- **Sin fugas de licencia:** abriendo la puerta de `navSections` (`has = () => true`) su suite pasa
  de **277 OK a 93 fallos**. Las puertas de `hasModule` de las pantallas existentes no cambian
  (Home 17→17, TableScreen 5→5, Remesas 10→10); `Layout` gana 4, o sea **más** restrictivo.
- **39 líneas borradas en todo `src`**, leídas una a una: 30 son la línea del fondo de los modales,
  3 imports sustituidos, 2 desestructuraciones ampliadas, el `<nav>` que gana `aria-label` y las 3
  del arreglo del descuento. **`global.css` es +593 / −0** contra `main`: estrictamente aditivo.
- **Solo 3 reglas CSS nuevas fuera de toda `@media`:** `.app-side` y `.desk-only` (clases **nuevas**,
  0 apariciones en el CSS y el JSX de `main`) y `.order-line__right`, que es el arreglo del botón
  descolocado. Todo lo demás vive dentro de `min-width:1024` o de los bloques del teléfono.
- **0 identificadores sin definir** en los 24 ficheros JS/JSX tocados (esbuild + acorn), con
  **control negativo**. Es la puerta que el build NO cubre, porque no hay linter.
- **Nadie queda encerrado:** los **30** modales (22 con campos, 8 de aviso) tienen salida visible,
  comprobado fichero a fichero.
- `npm run build` **exit 0** · **16 suites / 1.191 aserciones** en verde.
- **Peso**, construyendo `origin/main` en un worktree aparte: CSS **81,52 → 87,63 kB**, chunk
  **992,85 → 1.002,35 kB** (gzip **288,90 → 291,95**). En conjunto **+4,26 kB gzip (+1,35 %)**. Como
  el chunk lleva hash, **actualizar cuesta la descarga completa (~292 kB gzip por teléfono)**.

**UNA REGRESIÓN PROPIA, ENCONTRADA DESPUÉS DEL ACTA Y YA CORREGIDA (19-09-2026, `e3b4274`).** El
acta de arriba **no la vio**, y conviene saber por qué: el dueño reportó que la **ficha de costo** se
veía mal en su teléfono y que «la fuente se ve un poco más grande». Eran el mismo defecto, y lo
introdujo `82fc72f` de esta rama: puso dos reglas del descuento de mesa —`flex-wrap: nowrap` y
`flex: none` sobre `.total-row`— dentro de `@media (max-width:560px)`, y **`.total-row` no es una
clase de mesas: la usan DIECISÉIS pantallas** (solo `features/costsheets/` tiene 31 filas; también
ventas, cuentas, socios, entregas, cocina, entradas y traspasos). La etiqueta dejó de poder envolver
Y de poder encoger, y la fila se salía de la tarjeta llevándose el importe fuera del borde.
**Medido, no estimado**, con el CSS real de los dos árboles y Edge headless en 11 anchos: a 390 px
—el teléfono del dueño— `main` desbordaba **0 filas** y esta rama **8 filas y 6 tarjetas**; a 320 px
eran **catorce**. La letra **no** era mayor (17,6 px en los dos árboles): al no envolver, la etiqueta
cruzaba la tarjeta de borde a borde y el ojo lo leía como letra mayor.
El arreglo acota las dos reglas con `:has(> .order-line__right)`, clase que existe **solo** en
`TableScreen.jsx`; un navegador sin `:has()` las ignora y la fila vuelve a envolver como en `main`
(degradación al lado seguro, no pantalla rota). Verificado con **0 diferencias sobre 3.213
comparaciones** contra `main` y **control negativo** que sí las detecta (1.097 de 3.213).
**La lección para la próxima auditoría:** el acta comprobó que `global.css` era *aditivo* y que las
clases nuevas no existían en `main`, pero **no** comprobó a cuántas pantallas afectaban las reglas
añadidas sobre clases **ya existentes**. Aditivo no es inocuo.

**Hallazgo abierto que deja ese arreglo:** la fila del descuento de la mesa **sigue desbordando por
debajo de 414 px** (también antes de aquel commit): el caso real del dueño pide 314 px y tiene 309 a
390 px. Decisión del dueño.

**Cambios visibles que verán TODOS, también en el teléfono:** los modales **con campos ya no se
cierran tocando el fondo** (se sale por *Cancelar*, la X o Escape); la **cuenta de la mesa** pasa a
una fila con el nombre completo, el precio unitario y las columnas alineadas; el botón ***Quitar*
del descuento aparece siempre que la mesa esté abierta** (colgaba de `canPay`, que es la condición
del cobro — fallo preexistente en `main`); y el **porcentaje se acota a 100 al escribir**. Además, en
el Inicio de un mando el teléfono **lanza dos consultas que no se ven** (las tarjetas de escritorio
se montan y el CSS las oculta), y `Layout` mantiene viva `remittancesRepo.list()` en todas las
pantallas para un mando con `remesas` (es el contador rojo).

**Dos hallazgos que se dejan ABIERTOS a propósito:**
1. La prueba de equivalencia usa una **COPIA** del bucle de `report()`. Hoy coinciden (verificado
   línea a línea), pero si alguien edita `report()` la copia no le sigue y la garantía se apaga en
   silencio.
2. **Coste, no corrección:** `remittancesRepo.list()` en el `Layout` es un barrido de tabla y va
   vivo en todas las pantallas; en el Inicio se duplica con la consulta propia del Inicio.

*(El tercer hallazgo —el modal del descuento sin Escape— se corrigió antes de fusionar; ver
`docs/VISTA-ESCRITORIO.md` §18.9.)*

**Lo que NO se pudo garantizar: NADIE HA EJECUTADO LA APP.** Ni una pantalla abierta en la
computadora, ni la barra lateral, ni el panel del día, ni la fila de la mesa en un teléfono real.
Código, build, pruebas en node y el CSS real renderizado en un arnés. Y **no hubo prueba entre dos
dispositivos**, aunque nada toca la sincronización.

**Esta fusión no sube esquema**, así que el retroceso a un build del mismo esquema es viable; el
respaldo previo al despliegue sigue siendo lo sensato.

**EL MÓDULO `fichas` YA ESTÁ FUSIONADO A `main`.** El dueño lo autorizó el **11-09-2026** y se
hizo **fast-forward** de los **28 commits** de `claude/awesome-dirac-484azm`: `origin/main` pasó de
`4e28ab0` a **`fd24823`**, y rama y `main` quedaron **idénticas**
(`git rev-list --left-right --count origin/main...HEAD` = `0 0`). Subió F0–F11 del módulo **más**
el cierre de H3, el plan `docs/SYNC-LECTURAS.md` (solo documentación) y el alta del plugin
superpowers en `.claude/settings.json`. Auditoría de esa fusión, con sus mediciones, en
**«Auditoría de la fusión a `main` (11-09-2026)»**, más abajo.

**Fusionar NO es desplegar:** lo que hay en producción sigue siendo el build anterior hasta que
alguien corra `npm run deploy`. **Antes de ese despliegue hay que tomar el respaldo de retroceso**
(ver el aviso de v18/v19 más abajo: el esquema es de ida).

### Fusión del 15-09-2026 — interfaz (acordeones, login, accesibilidad) + corrección de existencias

**FUSIONADO A `main` el 15-09-2026**, con autorización explícita del dueño. **Fast-forward** de los
**13 commits** de `claude/awesome-dirac-484azm`: `origin/main` pasó de `95fbf39` a **`9a3784b`**, y
rama y `main` quedaron **idénticas** (`git rev-list --left-right --count origin/main...HEAD` = `0 0`
y `git diff HEAD origin/main` **vacío**). Se hizo con `git push origin HEAD:main`, **sin `--force`**
y sin checkout de `main`: si no hubiera sido fast-forward, el servidor lo habría rechazado en vez de
reescribir historia. **Comprobar el commit real con `git rev-parse origin/main` tras un `git fetch`:
no dar por bueno ningún hash escrito aquí.**

Subieron 12 commits de **interfaz** —el acordeón reutilizable `components/Accordion.jsx` y el paso a
categorías plegables de Inicio, Ajustes, Reportes y Auditoría; el agrupado por día de Entregas y del
tablero de elaboración; el selector de ubicación del mando en el Catálogo; y el rediseño del Login
con sus dos P0 de accesibilidad— **más** `docs/CORRECCION-EXISTENCIAS.md` reescrito (ver el apartado
propio, más abajo).

**Auditoría previa (ejecutada, no citada):**

- `npm run build` **exit 0** y **13 suites / 774 aserciones** en verde, medidas **en el commit exacto
  que se fusionó** (`9a3784b`), no en uno anterior.
- **CERO cambios en `src/features/sync/`, `src/db/db.js`, `src/repositories/`, `firestore.rules` y
  `package.json`.** Dexie sigue en **v19** y `SYNC_COLLECTIONS` en **34**. El único fichero sensible
  tocado es `src/lib/dates.js`, y su cambio es **estrictamente aditivo** (una función `dayLabel` al
  final): **`tsAfter` no aparece en el diff**.
- **Cero escrituras a la base en las 1.900 líneas.** Las tres coincidencias de `.add(` son
  `Set.add()` en memoria. Y cero cambios en consultas (`useLiveQuery`/`toArray`/`where`/repos) en
  Auditoría, Entregas y Ajustes: **sus refactors son puramente de presentación**.
- **Sin fugas de licencia.** Saltó una alarma y se investigó hasta el fondo: `ReportsScreen` pasó de
  **6 a 2** menciones de `LICENSE_MODULES.REMESAS`. **No es una fuga**: las cinco puertas
  individuales se consolidaron en **una** categoría `{ id: 'entregas', show: hasModule(REMESAS) }`
  que contiene **los mismos cinco reportes**, y el render filtra por `show` a nivel de categoría y de
  ficha. La puerta del descargador (`key.startsWith('remesas') && hasModule(...)`) sigue intacta.
  **Fragilidad latente anotada:** el filtro es `show !== false`, o sea **fail-open**; hoy es seguro
  porque `hasModule` es `modules.includes(m)` (booleano estricto) y `modules` nunca es `undefined`
  (`LicenseProvider.jsx:104`), pero un `show:` que evalúe a `undefined` **se colaría**.
- **Puertas de rol intactas** en los siete ficheros, salvo `Catalog`, que **suma cuatro**
  (`isManager` 7→11): más restrictivo, no menos. Su selector de ubicación nace en `''` = "Todas", con
  lo que `locMode`/`shownLoc` valen **exactamente** lo que valían `areaMode`/`viewLoc`: sin tocarlo,
  la pantalla es la de hoy.
- **0 identificadores no definidos** en los 11 ficheros JS/JSX (esbuild + acorn). Es la puerta que el
  build NO cubre, porque **no hay linter**. La herramienta se validó con **control negativo** (inyectar
  un identificador inexistente lo detecta; el fichero limpio da 0). **Limitación declarada:** es una
  aproximación de ámbito **plano** — caza erratas y nombres inexistentes, **no** cazaría usar una
  variable de otra función.
- **Nada de lo que no se tocó cambia de aspecto.** De las 26 clases de las reglas CSS nuevas, solo
  **tres** existían ya (`.card`, `.link-recover`, `.user-chip`), y las dos últimas se usan **solo en
  `Login.jsx`**; `.card` únicamente dentro de `.acc-stack > .card:last-child`. Sin contenido perdido
  en el refactor: los enlaces `to="/…"` salen 41→41 (Inicio), 3→3 (Ajustes) y 1→1 (Reportes).
- **Los ids repetidos de `Home.jsx` no son un fallo**, aunque lo parezcan: hay **cuatro** `<Accordion>`
  en una cadena ternaria `isCook ? … : isCourier ? … : isManager ? … : (…)`, y **solo uno se pinta a
  la vez**. No hay ids duplicados en el DOM.
- **Accesibilidad comprobada en el código, no supuesta:** el panel cerrado del acordeón recibe
  `visibility:hidden` de verdad (`global.css:3356`), así que su contenido **no queda navegable con el
  teclado** pese a seguir en el árbol; `prefers-reduced-motion` está contemplado; `.sr-only` existe y
  es el patrón estándar. `dayLabel` lleva sus pruebas **con control negativo** que demuestra que la
  versión ingenua (`new Date(dia)`) desfasa los 365 días del año.
- **Peso**, construyendo `95fbf39` en un worktree aparte: el chunk principal pasa de **983.55 kB**
  (gzip 285.61) a **990.50 kB** (gzip **288.01**): **+6.95 kB, +0.71 %**. El CSS, de 78.05 a
  **81.52 kB** (gzip +0.70). En conjunto **+3.10 kB gzip (+1,0 %)**. Como el chunk lleva hash,
  **actualizar cuesta la descarga completa (~288 kB gzip por teléfono)**, no el delta.

**Riesgos de CONVIVENCIA de versiones: NINGUNO.** Es la diferencia de fondo con la fusión del 14-09,
que traía tres. Todo es interfaz: sin esquema, sin formato de dato nuevo, sin escrituras. Un teléfono
actualizado y otro sin actualizar intercambian **exactamente** lo mismo que hoy. La única persistencia
nueva es `localStorage mc_acc_*` (sección abierta del acordeón), **local del dispositivo** como
`mc_theme`: no viaja a la nube ni entra en respaldos, y si la sección recordada ya no existe —se quitó
un módulo, cambió el rol— el componente se queda con todo cerrado en vez de dejar un estado imposible.

**Cambio visible que hay que avisar al vendedor ANTES de desplegar:** el **login ya no lista a los
usuarios**; hay que escribir el nombre. El campo **no autentica**: filtra en memoria la lista que ya
se cargaba, y al tocar una coincidencia se sigue llamando a `login(u.id, pin)` **igual que siempre**.
Hay salida de emergencia («Ver todos los usuarios»), pero **solo aparece cuando la búsqueda no
encuentra a nadie**: si alguien teclea una letra que casa con *otro* usuario, ve una lista sin él y
sin escape, y tiene que borrar y reescribir. **Es una arista conocida, no un fallo.**

**Lo que NO se pudo garantizar: NADIE HA EJECUTADO LA APP.** Ni un login, ni un acordeón abierto en un
teléfono. Código, build y pruebas en node.

**Esta fusión no sube esquema**, así que el retroceso a un build del mismo esquema es viable; el
respaldo previo al despliegue sigue siendo lo sensato.

### Corrección de existencias — PLAN ABIERTO, cero código escrito (15-09-2026)

**Todo el traspaso vive en `docs/CORRECCION-EXISTENCIAS.md`: LEERLO ANTES DE TOCAR NADA.** Lo que
subió en esta fusión es **solo ese documento**; **F1–F4 no están programados**. Nace de la auditoría
forense sobre los dos respaldos del negocio *De todo un tin* (12-09-2026, `schema 19`), esta vez
**con los respaldos cargados y calculados**, no leídos.

- **La causa raíz no es la caché: es una línea obsoleta que la lee mal.** Los datos están sanos (305
  claves de `stockByLocation`, **0 divergentes** contra el libro en los dos aparatos). Lo que miente
  es el **respaldo heredado de la v5** en `stockAtLocation`: cuando falta la clave `__almacen`
  devuelve el **total del producto** como si estuviera en el almacén central. **58 productos
  afectados**, en los dos respaldos. La línea está **copiada en 13 sitios** de `src/`, y
  `recomputeStock` la regenera en cada bajada de sync, así que **reaparece sola**.
- **🛑 AVISO OPERATIVO, vigente hasta que F1 se despliegue:** contar el **Almacén central** clavaría
  **−1.482 unidades negativas** nuevas (54 productos fantasma de los 56 que entran al conteo), y el
  **traspaso** almacén→área deja sacar esas mismas 1.482 unidades de un almacén vacío
  (`transfersRepo.js:33`; la pantalla se usa: 27 traspasos registrados). **El conteo de Tienda sí es
  seguro** (0 divergencias). La versión anterior del documento mandaba contar las dos ubicaciones:
  esa instrucción era una bomba y **ya está corregida**.
- **Orden de los arreglos:** **F1** (quitar el respaldo obsoleto — una línea, **coste cero**, valida
  58→0 divergencias en los dos respaldos con control negativo) → **F2** (el conteo ve los negativos:
  `> 0` → `!== 0` en **tres** compuertas, `countsRepo:81` y `CountScreen:265` y `:162`, no en una) →
  **F3** (`submit`/`approve` derivan del libro mayor) → **F4** (candado de existencia en la deuda
  interna). **F4 no puede desplegarse antes que F2**: si el candado rechaza una deuda por existencia
  en cero, el único remedio es el conteo.
- **F3 renuncia a reusar `recomputeStock`**: exigía editar `src/features/sync/` y **no hace falta**.
  Ninguno de los cuatro toca la sincronización, ni el esquema, ni `SYNC_COLLECTIONS`.
- **Ninguna de las 13 suites cubre F1–F4, ni puede** (`countsRepo`, `transfersRepo` y `debtsRepo`
  necesitan base de datos). Se propone **`fake-indexeddb` como `devDependency`** —aditivo, fuera del
  bundle, con precedente en `docs/FICHA-COSTO.md` §9.17— para probarlos de verdad.
- Los cuatro tocan **lógica de producción**, así que chocan con la regla 2: son **correcciones de
  defecto** y necesitan **autorización explícita del dueño** antes de escribirse.

### Fusión del 14-09-2026 — `cocteleria`, descuento de mesa y unidades de medida

**FUSIONADO A `main` el 14-09-2026**, con autorización explícita del dueño. Fast-forward de los
**37 commits** de `claude/awesome-dirac-484azm` desde `328ec95`. Subieron los tres bloques de
`docs/COCTELERIA-Y-MESAS.md` (módulo `cocteleria`, elaborar con faltante, descuento de mesa +
panel del dueño), las **unidades de medida configurables** (`docs/UNIDADES-DE-MEDIDA.md`) y la
carta de mesas a dos columnas. **Comprobar el commit real con `git rev-parse origin/main` tras un
`git fetch`: no dar por bueno ningún hash escrito aquí.**

**Auditoría previa (ejecutada, no citada):**
- `npm run build` **exit 0**; **13 suites / 766 aserciones** en verde.
- **`src/db/db.js` SIN cambios → NO hay migración Dexie** (sigue en **v19**) y **`src/features/sync/`
  SIN cambios → `SYNC_COLLECTIONS` sigue en 34**. A diferencia de las dos fusiones anteriores,
  **este despliegue no sube esquema**, así que el retroceso a un build del mismo esquema es viable
  (el respaldo previo sigue siendo barato y conviene igual).
- **Equivalencia con `main` medida, no razonada**, en los cinco caminos refactorizados:
  `orderTotals` sin descuento (1440 casos), `productionMovements` cocina→área (24), `canMake`
  (150), `parseUnitCode` con la clave `units` ausente vs. el `parseUnit` viejo (456 entradas) y el
  `round2(línea × 1)` del panel del dueño (200.000 comparaciones). **0 diferencias**, con
  **control negativo** que sí las detecta (1530 y 24) — sin él la prueba no mediría nada.
- **0 identificadores no definidos** en los 35 ficheros JS/JSX tocados (esbuild + acorn, con su
  control negativo). Es la puerta que el build NO cubre, porque **no hay linter**.
- Índices verificados **antes** de usarlos: `auditEvents.entityId` y `productions.createdAt`
  existen. Los **tres** lectores de `auditEvents` filtran por `entity` (`product`/`costSheet`/
  `order`): no se cruzan.
- **Peso:** el chunk principal pasa de **946.63 kB** (gzip 274.11) a **983.55 kB** (gzip 285.61):
  **+36.92 kB, +3.9 %**. Lo pagan **también** los negocios sin las licencias nuevas (import
  estático), y como el chunk lleva hash **actualizar cuesta ~286 kB gzip por teléfono**.

**Lo que NO se pudo garantizar: NADIE HA EJECUTADO LA APP.** Ni un descuento aplicado, ni un trago
elaborado, ni una unidad creada, ni una fusión entre dos aparatos. Código, build y pruebas en node.

**Riesgos de CONVIVENCIA de versiones** (un teléfono actualizado y otro no, que es lo normal
mientras la PWA se refresca). Verificados leyendo el código de `main`, no supuestos:
1. **El de dinero:** el `TableScreen` viejo **no lee `discount`** (0 coincidencias). Un descuento
   autorizado desde un teléfono nuevo y **cobrado desde uno viejo se cobra completo**. El reporte
   *"Descuentos autorizados no aplicados"* lo delata después.
2. El `kitchenRepo` viejo **no conoce `kind`** (0 coincidencias): con `cocteleria` vendida,
   listaría las recetas de trago en su tablero de cocina. **Emitir esa licencia DESPUÉS de que
   todos los teléfonos hayan actualizado.**
3. El `ProductForm` viejo pinta el `<select>` **en blanco** ante una unidad nueva del dueño.

**Hallazgo menor abierto (no bloqueante):** `InputsBlock` (fichas) llama `recipesRepo.listActive()`
sin filtrar tipo; si se **quita** `cocteleria` a un negocio que ya la tenía, sus recetas de trago
seguirían apareciendo en el selector de insumos de la ficha. Encaja con la doctrina de degradación
(no se borra nada) y no toca dinero.

**Cambios visibles que verán TODOS, incluidos los negocios sin las licencias nuevas:** el panel del
dueño gana la tarjeta **«Gastos (costo de lo vendido)»** (es **base**, no gateada; no calcula nada
nuevo: muestra el `cost` que `analyticsRepo.report` ya devolvía); el mensaje de faltante de cocina
pasa de *"en la cocina"* a *"en Cocina"*; y **todas** las ventas nuevas escriben
`discountPct: 0, discountAmount: 0, discountBy: null`, también las de mostrador.

### Fusión anterior — módulo `remesas` (28-08-2026)

**FUSIONADO A `main`.** `origin/main` quedó entonces en **`864a440`**, idéntico byte a byte a
`claude/awesome-dirac-484azm` (`git diff HEAD origin/main` vacío, divergencia `0/0`). El
fast-forward se registró el **28-08-2026 21:20**. Subieron los **34 commits** del módulo de
Entregas (`remesas`, Fases F1–F9 + Entregas 1–6c) **más** la corrección de la pérdida de estado
entre dispositivos. **Ojo:** el ref local `origin/main` se queda viejo; **hacer `git fetch` antes
de juzgar** si algo está fusionado (sin él se lee `64542b9` y parece que falta subir). La rama
local `main` también se queda atrás: es solo el ref, no afecta a lo publicado
(`git branch -f main origin/main` la realinea). **Al 05-09-2026 `origin/main` ya no está en
`864a440` sino en `4e28ab0`** (le siguieron la validación de saldo de `returnFund` y
`docs/SEGURIDAD-LICENCIAS.md`): **no dar por bueno ningún commit escrito aquí; comprobarlo con
`git rev-parse origin/main` después de un `git fetch`.**

**Auditoría de la fusión (28-08-2026, verificada, no asumida):**
- **Esquema:** v15/v16/v17 solo **añaden tablas vacías**, sin `.upgrade()` y sin tocar ningún
  store existente. Ningún nombre de tabla nuevo colisiona con la instancia Dexie (comprobado
  **empíricamente en 4.4.4**: `remittances`, `custodyMovements`, `deliveries`, `settlements`,
  `collections`, `productCustody`).
- **Firestore:** `firestore.rules` usa comodín `{document=**}` → cubre las 6 colecciones nuevas.
  **NO hace falta redesplegar reglas.**
- **Cambio de forma:** `accountsRepo.byConcept` pasó de `{concepto: monto}` a
  `{concepto: {moneda: monto}}`. Tiene **exactamente dos** consumidores (`AccountsScreen` y
  `reportsService`) y **ambos están adaptados**. Un tercero sin adaptar fallaría en SILENCIO
  (`{} > 0` es `false` → filas desaparecidas): si se añade otro, adaptarlo.
- **`tsAfter` sobre producción:** los campos sellados coinciden con `TS_FIELDS` de `syncTs`
  (`counts`: updatedAt+createdAt; `orders`: updatedAt+closedAt+openedAt; `orderItems`:
  updatedAt+createdAt). En `addItem` (camino caliente de mesas) `order` ya se leía antes: **no
  añade E/S**.
- **Libro mayor:** `DELIVERY_OUT` con `qty` negativa e `IN` positiva en `__entregas`;
  `ledgerKey` los mapea a claves YA existentes (`traspOut`/`traspIn`) → el submayor de un negocio
  sin el módulo sale **idéntico**.
- **Puertas de licencia: sin fugas.** Y gateadas **en la consulta**, no solo en el render
  (`canRemesas ? repo.list() : Promise.resolve([])` en Home y Auditoría).
- `npm run build` **limpio** (exit 0) y **96 aserciones** en verde en 5 suites node.
- **Probado por el dueño en DOS dispositivos reales: funcionó correctamente.** Es la validación
  de runtime; el resto es código + build + pruebas node. **No se probó la app en ejecución**
  durante la auditoría (ni un cobro, ni una liquidación, ni una fusión entre dos aparatos).

**CERRADO — `custodyRepo.returnFund` ya valida el saldo (28-08-2026).** Era el único hallazgo con
consecuencia **contable**: el mando podía devolver más fondo del que el mensajero llevaba, la
custodia quedaba en negativo y la tesorería recibía un crédito por un efectivo que nunca volvió de
la calle. Ahora lleva el **mismo candado de última instancia** que su espejo
`remittancesRepo.returnProduct`: el saldo se **deriva del libro dentro de la misma transacción**
(no de una caché) y se compara **por moneda**. La guarda va **después** de la de idempotencia a
propósito — un reintento de una devolución ya aplicada debe salir en silencio, no fallar, porque
el saldo ya bajó. Devolver el fondo **completo** sigue permitido (es el caso normal); solo se
rechaza pasarse. Único llamador: la pantalla de Entregas, que ya mostraba el saldo y pinta el
error. La liquidación no llama a `returnFund` (solo lee `balanceOf`), así que no cambia.

**Hallazgos abiertos (no bloqueantes, decisión del dueño):**
2. **Byte NUL literal** en `src/features/reports/reportsService.js` (dentro de una cadena, como
   separador de clave). **Es PREEXISTENTE en `main`**, no lo introduce esta rama. **CORRECCIÓN a
   la versión anterior de esta nota, que exageraba el efecto:** git lo trata como TEXTO con
   normalidad — `git diff --numstat` da `39 21` y `git blame` funciona. Los únicos afectados son
   `grep`/ripgrep, que se saltan su contenido. Es molestia de herramientas, **no** riesgo de
   fusión. Sustituirlo por un espacio sería equivalente en runtime.
3. **Deuda conocida (Hallazgo 5):** el cursor de subida por colección de `pushEngine` puede tapar
   un registro escrito por debajo de él. `tsAfter` lo hace mucho menos probable (y de hecho
   RESCATA el caso: una mutación sellada por encima de la versión previa también supera un cursor
   que esa misma fila había levantado), pero arreglarlo de verdad exige tocar `pushEngine`.
4. **Quirk preexistente del módulo:** `deliver` y `failReturn` comparten el id determinista
   `delivery:<entrega>` (`remittancesRepo.js:472` y `:519`) con guarda de existencia, así que una
   entrega solo puede tener **una** constancia. Si falló y luego se entregó, no nace fila
   "entregada" y `reconcileFromDeliveries` no podría repararla. Hoy es inalcanzable desde la UI
   (`assign` exige FONDOS DISPONIBLES).
5. **Los relojes de los teléfonos siguen desfasados ~21 s.** El software garantiza el ORDEN, no la
   hora: las fechas del rastro de auditoría solo se corrigen poniendo fecha y hora **automáticas**
   en los dos aparatos. Es lo único que no puede arreglar el código.

**Hallazgos NUEVOS de la auditoría del 28-08-2026:**
6. **El despliegue es de IDA: el retroceso NO puede ser `git revert` de `main`.** No hay manejo de
   `VersionError` en ninguna parte. En cuanto un teléfono abre el build nuevo, su IndexedDB queda
   en **v17**; volver a un build que pide v14 deja ese aparato **sin poder abrir la base** (y el
   `ErrorBoundary` mostraría un error, no una app funcionando). Es inherente a cualquier subida de
   esquema, pero aquí suben tres de golpe. **Antes de actualizar, hacer respaldo** (`/backup`) de
   un dispositivo bueno: ese es el plan de retroceso real.
   **AMPLIACIÓN VERIFICADA (01-09-2026): el "antes" es obligatorio, no una recomendación.**
   `backupService.js:86` rechaza restaurar cualquier respaldo cuyo `meta.schema` supere al esquema
   de la app (`if ((bk.meta.schema || 1) > db.verno) throw`), y el respaldo sella
   `meta.schema = db.verno` (`:49`). Es decir: **un respaldo hecho ya con el esquema nuevo NO se
   puede restaurar en un build viejo.** El retroceso solo existe con un respaldo tomado **antes**
   de que el aparato abra el build nuevo, y guardado fuera del teléfono.
7. **El bundle creció 785.89 KB → 856.31 KB** (gzip 231.13 → 248.30, **+7.4%**), medido
   construyendo `64542b9` en un worktree aparte. `RemesasScreen` (1522 líneas) entra por **import
   estático** en `router.jsx`, así que ese peso **lo pagan también los negocios SIN la licencia**.
   Es coherente con cómo entran las demás pantallas, pero es la más grande: si el peso llega a
   molestar en datos móviles, la salida es `React.lazy` en la ruta.
8. **No hay linter configurado** (ni `.eslintrc*` ni script `lint`): `npm run build` es la **única**
   puerta estática. Nadie detecta variables muertas ni imports huérfanos.
9. **`CLAUDE.md` tenía su propio byte NUL** (línea 478), escrito por accidente al documentar el
   hallazgo 2 — la nota sobre el NUL contenía un NUL. **Ya eliminado.**

**Cambio visible declarado:** el panel *Ingresos por concepto* y el reporte *Movimientos de
cuentas* ahora separan **por moneda**. Con un negocio solo en MN la salida es **idéntica byte a
byte**; con USD/MLC cambia porque antes se sumaban todas las monedas en un número etiquetado "MN"
(un cobro en USD engordaba el total como si fuera MN). Es corrección de un error real.

## Módulo `fichas` (Ficha de costo, Res. 148/2023 MFP) — F0 a F11 + H3, EN `main` (11-09-2026)

**Todo el traspaso vive en `docs/FICHA-COSTO.md`: LEERLO ANTES DE TOCAR NADA DEL MÓDULO.** Ahí
está la interpretación normativa completa de las 16 filas, la errata de la Gaceta (Fila 12 =
**5+11**), los tres controles, las **tres** fórmulas de la base de utilidad sobre cinco
actividades, las decisiones cerradas con el dueño, el esquema Dexie **v18 + v19**, el motor puro
`lib/fichaCosto.js` con su fixture obligado ("Pan suave", 200 u), la interfaz de 9 bloques, las
fases **F0–F11** con lo que hizo cada una (§9.8 a §9.14) y **la lista de lo que sigue abierto**,
que es con la que hay que auditar F11.

Diseño visual aprobado por el dueño el 31-08-2026:
https://claude.ai/code/artifact/1134b7b2-d636-4a6a-9856-19e3ddb3a879

**F11 CONTRASTÓ EL §2 CONTRA LA GACETA (04-09-2026), y era la deuda más vieja del módulo.** Se
descargó el PDF oficial de la Resolución desde `mfp.gob.cu` y se extrajo su texto con `pdftotext`
(que **sí** está en el entorno, aunque el lector de PDF busque `pdftoppm`, que no). Resultado: la
aritmética del precio **cuadra con la norma**, incluida la errata de la Fila 12 y la base de la
utilidad. El detalle, cita por cita, en `docs/FICHA-COSTO.md` §9.15, junto con **lo que NO cumplía
y se corrigió** y **tres cosas que la Resolución no dice y el módulo interpreta**.

**Lo que sigue sin poder garantizarse: NADIE HA EJECUTADO LA APP.** Ni antes ni después de
fusionar: la validación fue **código + build + pruebas node**, nunca runtime. Y **v18/v19 son de
ida**, así que el respaldo de retroceso hay que tomarlo **antes de desplegar**
(`backupService.js:86` rechaza restaurar un respaldo cuyo esquema supere al de la app, y el
respaldo sella `meta.schema = db.verno` en `:49`).

### Auditoría de la fusión a `main` (11-09-2026, verificada, no asumida)

Hecha **después** del fast-forward, para responder a una pregunta concreta del dueño: *si esto se
despliega, ¿puede romper algo de lo que hoy funciona?* **Ejecutado, no citado** (todo reproducible):

- **Pruebas y build:** las **8 suites** node en verde, **462/462** aserciones
  (21+16+9+32+243+54+18+69), y `npm run build` **exit 0**.
- **Superficie real del cambio:** de 34 ficheros, **22 son nuevos** (no pueden romper nada que no
  los importe) y solo **12 son preexistentes**, con **17 líneas borradas en todo `src/`**. Los 12
  se leyeron enteros, uno a uno.
- **Los exportadores de reportes — el punto de mayor riesgo — NO cambian su salida.** Se extrajeron
  de git las dos versiones de `exportExcel`/`exportPdf` (la de `4e28ab0` y la de `fd24823`), se
  neutralizó solo la descarga al navegador y se generaron los ficheros en node con `xlsx` y
  `jspdf`: **idénticos byte a byte** en tres reportes (vertical con acentos/`null`/celda vacía,
  landscape de 120 filas que pagina, y uno sin filas), en **xlsx y en pdf**. Dos cautelas que hacen
  la prueba válida: el PDF lleva `/CreationDate`, así que **dos corridas de la misma versión ya
  difieren** — se normalizó esa marca, y solo esa—, y se corrió un **control negativo** (con
  `header`/`footer` la salida **sí** cambia), sin el cual la prueba no mediría nada.
- **Nadie más produce `header`/`footer`:** los únicos tres sitios son `fichaReports.js`. Ningún
  builder preexistente los pasa.
- **`useLicense().modules` nunca es `undefined`** (`LicenseProvider.jsx:104` da `[]` si la licencia
  no está desbloqueada), así que el nuevo filtro de `/help` no puede tumbar la pantalla de Ayuda. Y
  `downloadHelpPdf` tiene **un solo llamador**, que sí le pasa `modules`.
- **Los nombres de tabla nuevos no colisionan con Dexie**, comprobado instanciando **Dexie 4.4.4** y
  declarando los stores: `db.costSheets` y `db.costSheetLines` son `Table` reales (`.name` correcto,
  `bulkPut`/`where` presentes). Era el fallo silencioso que avisa la nota de v16.
- **CSS:** `.ficha-*` no existía antes (0 coincidencias en `4e28ab0`); las 3 clases nuevas van al
  final y no redefinen ninguna existente.
- **`auditEvents` es la única tabla de producción que el módulo escribe**, con `entity:'costSheet'`.
  Su **único** lector filtra `entity === 'product'` (`productsRepo.js:121`): no se cruzan. De los
  repos ajenos solo usa `productsRepo.listActive()` y `recipesRepo.listActive()`, **en lectura y
  gateados**.
- **Migración v17 → v19 CON DATOS DENTRO, ejecutada** (no leída): se sembró una base con el
  esquema real de `4e28ab0` —productos, venta, movimiento del libro mayor, usuario, evento de
  auditoría y turno—, se cerró y se **reabrió con el esquema de hoy** sobre `fake-indexeddb`.
  **Abre sin `VersionError`, los datos quedan intactos, los índices viejos siguen consultando** y
  las dos tablas nuevas nacen vacías. **0 fallos.** Es la prueba que faltaba: lo que le pasa al
  teléfono del dueño al abrir el build nuevo. *(En esa misma prueba el esquema viejo pudo reabrir
  la base migrada, lo que NO concuerda con lo escrito sobre el retroceso; es un IndexedDB simulado,
  así que no prueba nada en un navegador real y **la regla del respaldo previo no cambia** — ver
  `docs/FICHA-COSTO.md` §9.17.)*
- **Convivencia de versiones** (un teléfono actualizado y otro no, que es lo normal mientras la PWA
  se refresca): el build viejo no tiene las dos colecciones nuevas en `SYNC_COLLECTIONS`, así que ni
  las consulta; y los `auditEvents` de ficha que sí le llegan los ignora por el filtro de arriba.

**Lo que SÍ cambia para todos, incluidos los negocios sin la licencia** (no es una ruptura, pero es
un coste que hay que saber antes de desplegar):

- **Peso, medido construyendo `4e28ab0` en un worktree aparte:** el chunk principal pasa de
  **856.45 kB** (gzip **248.33**) a **941.56 kB** (gzip **272.49**): **+85.11 kB, +9.9 %**. El CSS,
  +0.44 kB. Se paga por el **import estático** de las pantallas en `router.jsx`. Y como el chunk
  lleva hash, **la actualización cuesta la descarga completa (~272 kB gzip por teléfono)**, no el
  delta.
- **Sync:** `SYNC_COLLECTIONS` pasa de 32 a **34**: dos `onSnapshot` permanentes más por
  dispositivo y dos consultas más en cada enganche en frío, aunque el negocio no tenga el módulo.
  **Tamaño del efecto, para no alarmar de más:** según el modelo del propio `docs/SYNC-LECTURAS.md`
  (lecturas ≈ documentos × arranques en frío × dispositivos), dos colecciones **vacías** cuestan
  ~1 lectura cada una por enganche — **decenas de lecturas al día frente a las 60.000 medidas**.
  Va en la dirección contraria a ese plan, pero **no mueve la aguja**: la avería de cuota (120 %
  del tope) es **preexistente e independiente** de este módulo.

**Lo que esta auditoría NO puede decir:** que la app funcione. **No se ejecutó**: ni una ficha
creada, ni un PDF descargado desde el teléfono, ni una fusión entre dos aparatos. Todo lo de arriba
es código, build y pruebas en node.

### Auditoría de la rama antes de `main` (05-09-2026, verificada, no asumida)

*Acta de esa fecha, se deja tal cual. El cierre de H3 el 07-09 movió tres cifras: esquema **v19**,
**8 suites / 462 aserciones**, y el chunk **941.56 kB** (gzip **272.49**) con **34** colecciones
de sync. Ver `docs/FICHA-COSTO.md` §9.16.*

Ejecutado, no citado: `npm run build` **exit 0**; **408/408** aserciones en las 7 suites node *(hoy
son 8 suites y 462 aserciones: H3 añadió `fichaLines.test.mjs`)*; el
build de `origin/main` en un worktree aparte para medir; y el Anexo II **releído del texto de la
Gaceta**, no de `docs/FICHA-COSTO.md`.

- **Aritmética contra la norma:** tasas **25 / 30 / 15 / 30** del Anexo II, base de utilidad
  `r2+r3+r4` (la nota `(**)` descuenta consumo material, generales y admin, distribución y venta,
  financieros, tributarios y OSDE), excepción de base completa para agropecuaria y alta tecnología,
  Art. 9 **1,5 / 1,0** y Art. 16 **10 %** con coeficiente que no excede el salario directo. **Todo
  coincide con el motor.**
- **Sin fugas de licencia**, y gateado **en la consulta**: Home, `/auditoria`, `/help` (pantalla
  **y** PDF), `/fichas` y `/ficha/*`. Los eventos van con `entity:'costSheet'` y la pestaña *Bajas*
  filtra `entity==='product'` (`productsRepo.js:121`): no se cuelan ahí.
- **Cero escrituras a tablas ajenas** desde el módulo (`grep` de `db.products/sales/stockMovements/
  priceChanges/config/accounts` = 0). Solo escribe `costSheets` y `auditEvents` *(y, desde H3,
  `costSheetLines`)*.
- **`exportPdf`/`exportExcel`:** sin `header`/`footer`, `startY` sigue valiendo 28 y el AOA sigue
  siendo exactamente `[head, ...rows]`. Los ~20 reportes existentes no cambian.
- **`firestore.rules`** usa comodín `{document=**}` → cubre `costSheets`. **No hay que redesplegar
  reglas.**
- **Peso:** el chunk principal pasa de **856.45 kB** (gzip 248.33) a **936.25 kB** (gzip 270.62):
  **+79.80 kB**, +9 %. Lo pagan **también** los negocios sin la licencia (import estático). Y como
  el chunk lleva hash, **actualizar cuesta ~271 kB gzip por teléfono**, no 22. *(Cifra de esa
  fecha; con H3 dentro son **941.56 kB** / gzip **272.49** — remedido el 11-09.)*
- **Sync:** `SYNC_COLLECTIONS` pasa de 32 a **33**. Un `getDocs` más por barrido inicial (consulta
  vacía = 1 lectura) y un `onSnapshot` permanente más. Ruido frente a la cuota Spark. *(Con H3 son
  **34** colecciones: `costSheetLines` añade otro par.)*

**Hallazgo 1 (los anexos por LWW): CERRADO el 07-09-2026.** El dueño confirmó que la ficha la
llenan **el dueño Y el administrativo**, con lo que la justificación escrita ("la ficha la edita
UN SOLO actor") quedó falsada. Se aplicó el patrón de `orderItems`: los cuatro anexos son ahora
**filas sueltas** en `costSheetLines` (Dexie **v19**, en `SYNC_COLLECTIONS`), y el editor guarda
**por diferencias** —solo lo que el mando cambió respecto de lo último que él mismo guardó—, así
que una línea que no tocó no se escribe nunca y no puede pisar la del otro. Además el editor **se
resincroniza**: si la ficha cambió en la base, se recarga sola cuando no hay nada a medio teclear
y **avisa** con una banda cuando sí lo hay. La aritmética **no se tocó** (la ficha se *hidrata* al
leerla). Lo que **no** cierra, y hay que saberlo: los **campos de cabecera** siguen fusionándose
por LWW de documento entero, como en toda la app; la diferencia es que ahora se ve. Todo el
detalle —incluido un fallo real que apareció haciéndolo, la copia de "otra norma de tiempo" que
heredaba el id— en `docs/FICHA-COSTO.md` **§9.16**.

**Un hallazgo sigue ABIERTO** (no bloqueante; se fusionó con él dentro, con conocimiento del dueño)**:**

1. **Carrera al crear revisiones.** `revise` calcula `nextVersion(prev)` en una transacción
   **local**: dos dispositivos que revisen la misma ficha aprobada crean **dos v2** con el mismo
   `groupId`. Nada se pierde (append-only), pero el historial queda con dos "v2" y hay que elegir a
   mano. Probabilidad baja; consecuencia: confusión, no dinero.

**Dos interpretaciones que conviene tener presentes:** la Gaceta imprime literal *"Fila 12 … suma
de las Filas 6+11"* y el motor calcula **5+11** (6+11 duplicaría la Fila 6 y dejaría fuera las
filas 1 a 4: es errata evidente, pero es apartarse de la letra impresa). Y el Anexo II y el Art. 9
están escritos para **entidades estatales**; aplicarlos a una MYPIME se sostiene en el Art. 6 y en
que los tres controles **avisan y nunca bloquean**.

## Reportes (`features/reports/reportsService.js`, solo lectura)

Cada reporte es un *builder* `build*()` que **solo lee** (`.toArray()` + filtrar/mapear, nunca
muta) y devuelve `{ title, subtitle, head, rows, filename, orientation }`. Se exportan con
`exportExcel` / `exportPdf`, ambos con **`import()` dinámico** de `xlsx` / `jspdf`. Los rangos usan
el **día local** del negocio (`localDay`, no UTC) y se excluyen las ventas anuladas.

- **Base:** ventas (detalle), inventario por ubicación, entradas, salidas almacén→área, cierres de
  turno, ventas del turno, submayor por producto (kardex) y consolidado, conteo físico (submayor).
- **Por licencia:** *Ventas por área* y *por vendedor* (áreas), *Movimientos de cuentas* (`cuentas`),
  *Ventas por mesa* (`mesas`), consolidado/salidas/cuadre de **elaboración** (que **no** exponen
  costo ni ganancia, por el alcance del rol), *Mermas* (afectación al costo) y *Producción de cocina*
  (`cocina`: receta, área, unidades y costo de insumos/unitario en MN, sin precio ni ganancia).
  Con `remesas`, cinco reportes más en `remesasReports.js` (archivo propio, no toca
  `reportsService.js`): entregas, cobros, custodia, liquidaciones y entregas de producto. Las
  entregas **eliminadas** (borrado lógico) quedan fuera.
- **Columnas USD (módulo `divisas`):** todos los reportes con importes/costos ganan columnas de
  **referencia en USD** (precio, importe, costo y sus totales) SOLO con el módulo activo y si hay
  productos en divisa; sin eso, columnas y filas **idénticas** al clásico. Ver "Divisas".
- El submayor/kardex deriva TODO del libro mayor (`stockMovements`) clasificando cada movimiento
  con `ledgerKey` (compras, ventas, traspasos, mermas, ajustes, carga inicial…), coherente con el
  invariante de que el stock sale del ledger.

## Fase 8 — Tema, cambio de rol e imágenes (`docs/FASE8.md`)

Mejoras visuales y de gestión. Regla transversal: **default = comportamiento actual**; todo lo
de imágenes va gateado (salvo los avatares, que son base).

- **Tema claro/oscuro (B1, base):** `src/lib/theme.js`. La preferencia vive en **localStorage**
  (`mc_theme`) — **local del dispositivo, NO sincroniza** — y se aplica en `main.jsx` **antes de
  pintar** (sin parpadeo) poniendo `data-theme` en `<html>`. El **oscuro es el default** (`:root`
  base, intacto); el claro **sobreescribe variables** bajo `:root[data-theme="light"]` en
  `styles/global.css`. Toggle en la cabecera (`Layout.jsx`), visible para **todos los roles**. El
  **ticket térmico** queda siempre negro-sobre-blanco.
- **Cambio de rol dinámico (B2, base):** en `UsersAdmin` (solo dueño) → `usersRepo.setRole`.
  **Doble candado OWNER:** `ASSIGNABLE_ROLES = [SELLER, ADMIN, ELABORATION]` — el dueño nunca es
  origen ni destino, y la capa de datos rechaza OWNER además de la UI. Sin PIN (solo confirmación);
  **bloqueado si el usuario tiene turno abierto**. Transaccional: rol + `updatedAt` + evento
  `role_change` en `auditEvents`. El `AuthProvider` relee el rol de la BD al montar → el afectado
  toma el rol nuevo al **recargar** (su sesión viva sigue con el viejo hasta entonces).
- **Imágenes (módulo `imagenes`, B3–B6):** **miniaturas sincronizadas**, NO Firebase Storage (se
  mantiene en el plan gratis). `src/lib/image.js` → `fileToThumbnail(file, { fit })` comprime **en
  el cliente** (canvas, lado mayor ≤256 px, JPEG **<40 KB**, fondo blanco). Dexie **v12 `images`**
  con id **determinista** `img:<refType>:<refId>` (dos dispositivos no duplican; LWW por
  `updatedAt`); la foto **vive aparte** (no engorda `products`/`users`). `imagesRepo`
  (`get/getDataUrl/set/clear/mapByType`); **quitar = `dataUrl` vacío** (no borra). Cubre **fotos de
  producto** (B4: `ProductForm` + miniatura en `Catalog`), **carta de mesas con foto** (B5:
  `TableScreen` reutiliza la MISMA foto del producto) y **avatares de usuario** (B6: `Home`, cada
  uno edita el suyo). **Gate:** producto y carta requieren `hasModule('imagenes')`; los **avatares
  son BASE** (no gateados). Sin el módulo: cero storage/sync de fotos y DOM idéntico.

## Modelo de datos (Dexie)

Versiones en `src/db/db.js`:
- **v1**: `users, config, exchangeRates, categories, products (*searchTokens), priceChanges,
  shifts, sales, stockMovements, purchases, cashMovements, internalDebts, auditEvents`.
- **v2**: `counts` (conteo físico).
- **v3**: `syncState` (cursores de sincronización `push:<colección>`).
- **v4**: índice `area` en `products` (áreas de venta, Bloque 19). `shifts.area`, `sales.area`,
  `sales.hasCrossArea` e `items[].area` son campos nuevos (no requieren índice). Nota: desde el
  Bloque 20, `sales.hasCrossArea` se escribe siempre `false` (la venta cruzada quedó retirada); el
  campo persiste solo para ventas históricas.
- **v5**: `transfers` (salidas almacén→área, Bloque 20). `stockMovements` y `products` ganan
  dimensión `location` (almacén o área). Migración: establece `location = '__almacen'` en
  movimientos previos, inicializa `stockByLocation` en productos.
- **v6**: `errorLog` (registro local de errores, Bloque 33). LOCAL del dispositivo: no se
  sincroniza a la nube ni viaja en respaldos; se poda a las 200 entradas más recientes.
- **v7**: `partners`, `partnerMovements` (módulo `cuentas`: proveedores/terceros). El saldo se
  deriva de los movimientos (nunca se guarda), como el stock. Migración aditiva.
- **v8**: `accounts`, `accountMovements` (módulo `cuentas`: tesorería). Cuentas de sistema con
  ids FIJOS (`acc_cash_mn`, …) para que dos dispositivos no las dupliquen. Migración aditiva.
- **v9**: `conversions` (módulo `mayorista`: fraccionamiento en el almacén; `CONVERSION_OUT/IN`
  en el libro mayor). Migración aditiva.
- **v10**: `orders`, `orderItems` (módulo `mesas`). `orders` = cabecera (mesa, área, turno,
  estado); `orderItems` = líneas append-only (una por consumo, correcciones marcadas `voided`).
  Migración aditiva. Campos nuevos en `sales` (sin índice): `orderId`, `table`, `subtotal`,
  `serviceChargePct`, `serviceChargeAmount`, `serviceWaivedBy`.
- **v11**: `mermas` (deterioro/pérdida). Snapshot para el reporte de afectación (precio de venta
  y costo AL MOMENTO de la merma); el libro mayor lleva el movimiento `MERMA_OUT` que deriva el
  stock, como `purchases` acompaña a las entradas. Migración aditiva.
- **v12**: `images` (módulo `imagenes`, Fase 8): miniaturas JPEG (`dataUrl` ≤256 px, <40 KB) de
  producto/carta/avatar, con id determinista `img:<refType>:<refId>` (no duplican entre
  dispositivos; LWW por `updatedAt`). Viven **aparte** de `products`/`users`. Migración aditiva.
- **v13**: `recipes`, `productions` (módulo `cocina`). `recipes` = receta del dueño (insumos y
  consumo por unidad del elaborado; sus `items` viven como array en el doc — la edita solo el dueño,
  LWW por `updatedAt`). `productions` = bitácora **append-only** de cada elaboración (snapshot para
  el reporte, como `mermas`/`purchases`); el stock lo mueven los `CONVERSION_*/TRANSFER_*` del libro
  mayor. Migración aditiva (dos tablas vacías).
- **v14**: `notifications` (centro de avisos del dueño). Migración aditiva.
- **v15**: `remittances`, `deliveries`, `custodyMovements`, `settlements` (módulo `remesas`).
  `remittances` = cabecera de la entrega (remitente/beneficiario/monto congelados; LWW por
  `updatedAt`). `deliveries` = bitácora **append-only** de cada intento. `custodyMovements` =
  libro **append-only** del efectivo en custodia: el saldo por tenedor+moneda se **deriva** de
  él (índice `[holder+currency]`), nunca se guarda. `settlements` = snapshot de cada liquidación.
  Migración aditiva (cuatro tablas vacías).
- **v16**: `collections` (módulo `remesas`): snapshot append-only del **cobro al remitente**
  (comprobante y pagador). El crédito real vive en `accountMovements`; esto es la constancia.
  Migración aditiva. Nota: `collections` **no** choca con nada de Dexie (verificado en 4.x); ojo
  con nombres de tabla como `tables`, `name`, `verno`, `on` o `core`, que **sí** colisionarían en
  silencio con la instancia (`db.X` no sería la Table y la sync fallaría sin avisar).
- **v17**: `productCustody` (módulo `remesas`): libro **append-only** del producto que carga el
  mensajero, **aislado del inventario general** (no entra en el recálculo de `products.stock`).
  El área `__entregas` sí es inventario y se mueve por `DELIVERY_OUT/IN` en `stockMovements`.
  Migración aditiva.
- **v18**: `costSheets` (módulo `fichas`): la **cabecera** de la ficha de costo de la
  Res. 148/2023 (identificación, portadores, filas capturadas del Anexo I, tasa de utilidad,
  firmas, estado y versión). LWW por `updatedAt`; **toda** mutación lo sella (incluida `approve`,
  porque `approvedAt` NO está en `TS_FIELDS` y sin `updatedAt` la aprobación no se subiría nunca,
  en silencio). Migración aditiva.
- **v19**: `costSheetLines` (módulo `fichas`): las **líneas** de los cuatro anexos (insumos,
  salario, otros gastos directos, precios de referencia), **una fila por línea** —como
  `orderItems` y al revés que `recipes.items`—. `{ id, sheetId, kind, pos, voided, ...campos }`.
  Nació de un hallazgo: la ficha la llenan **dos** mandos (dueño y administrativo), y con los
  anexos dentro del documento la fusión LWW le borraba al otro el anexo **entero**, en silencio.
  Se anulan (`voided`), nunca se borran. La ficha se **hidrata** al leerla, así que el motor y los
  reportes siguen viendo `sheet.inputs` y compañía. Migración aditiva.

**Multimoneda:** base **MN**; efectivo **MN/USD**; **MLC** electrónico. Tasas = "cuánta MN
vale 1 unidad de la moneda", append-only en `exchangeRates`. El módulo `divisas` añade el campo
`priceCurrency` a `products` (moneda del precio, p.ej. `USD`) y el par congelado
`priceCurrency`/`priceRate` a las líneas de venta — **sin índice y sin migración Dexie** (campos
nuevos opcionales, como `sales.area`). Sin el campo, el producto es MN = clásico.

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
  respaldo en el Home del dueño). Bloque 33 ✅ (resiliencia: ErrorBoundary global,
  registro local de errores en `errorLog` — Dexie v6, local, no sincroniza ni viaja en
  respaldos — y pantalla `/errors` para verlo/compartirlo). Bloques 34–39 pendientes.
- **Fase 8 — Tema, cambio de rol e imágenes:** EN CURSO (plan en `docs/FASE8.md`). Tema
  claro/oscuro (B1, base) ✅; cambio de rol dinámico (B2, base) ✅; módulo `imagenes` (B3–B6):
  infraestructura ✅, fotos de producto ✅, carta de mesas con foto ✅, avatares de usuario (BASE)
  ✅. Default = comportamiento actual; imágenes gateadas (salvo avatares).
- **Módulos de licencia** (opcionales, ver sección "Módulos de licencia"): `mayorista` ✅
  (venta del almacén, escalas, pago mixto, conversión), `cuentas` ✅ (proveedores/terceros +
  tesorería), `elaboracion` ✅ (centro intermedio + rol acotado), `mesas` ✅ (cuentas por mesa,
  ticket térmico y reporte "Ventas por mesa"), `imagenes` ✅ (miniaturas sync: fotos de producto
  y carta de mesas), `divisas` ✅ (precios de catálogo en USD; cobro en USD/MN a la tasa; ticket de
  mesa y reportes con el monto/columnas en USD, todo gateado) y `cocina` ✅ (recetas + tablero: el
  Cocinero elabora y envía a las áreas; motor atómico contra el libro mayor, reporte de producción,
  cocina contable en el conteo físico y pestaña de cocina en auditoría; rol acotado `COOK`) y
  **`cocteleria` ✅** (el trago se elabora DENTRO del área con su propio stock y queda en ella, sin
  traspasos; mismo motor que `cocina` con `fromLocation`, permiso de elaborar con faltante con
  aviso al dueño, reporte y auditoría compartidos y gateados por tipo; sin rol nuevo y sin esquema
  Dexie nuevo) y
  `remesas` ✅ (entregas de dinero o producto: cobro a tesorería, fondo del mensajero que sale de
  las cuentas del negocio, custodia de efectivo y de producto con saldo derivado, liquidación con
  semáforo, editar/eliminar, cinco reportes y pestaña de auditoría; rol acotado `COURIER`). Cada
  uno gateado con `hasModule(...)`. Y **`fichas` ✅** (ficha de costos y gastos de la Res. 148/2023:
  motor puro, editor de 9 bloques, aprobación y revisiones, tres hojas oficiales a PDF/Excel,
  auditoría y ayuda gateadas; solo mando): F0–F11 + el cierre de H3, **fusionado a `main` el
  11-09-2026**. **Ninguno se ha ejecutado en un dispositivo con el módulo `fichas` dentro.**

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
  solo lo cambiado, en lotes de 400 (**50 para `images`**, que pesan más). **No espera
  confirmación del servidor** (Firestore guarda en cache persistente y entrega al reconectar)
  → no se cuelga offline.
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
- **Estado derivado de la constancia (`remesas`):** `remittancesRepo.reconcileFromDeliveries()`
  repara la cabecera de una entrega **en curso** (asignada/en ruta) cuando ya existe su fila
  en `deliveries` con resultado *entregada* y sin anular: la cabecera se fusiona por LWW y
  puede perderse, pero la constancia es **append-only con id determinista** y llega siempre.
  Es el mismo patrón que `recomputeStock` en el `pullEngine` y —como aquél— **NO toca
  `updatedAt`**: es un valor derivado que todos los dispositivos calculan igual, así que
  re-subirlo solo provocaría eco. La regla (`shouldReconcileDelivered`, en `lib/remesas.js`,
  pura y probada con node) es **deliberadamente estrecha**: solo promueve a *entregada*, no
  regresa ningún estado, no interpreta fallos (el motivo vive en el estado, no en la
  constancia) y no toca las eliminadas. Se llama al abrir *Entregas*, antes de liquidar y
  antes de generar sus reportes (**los builders siguen siendo de solo lectura**). En pareja,
  `failReturn` **rechaza** marcar fallida una entrega que ya tiene constancia de entregada.
- **Seguridad:** `firestore.rules` → `auth.uid == businessId`, append-only (delete prohibido).
  **Matiz de robustez:** las reglas bloquean el `delete` pero **permiten `update`** (lo necesita la
  fusión LWW) y **no** imponen inmutabilidad por campo; la disciplina append-only (correcciones =
  registros nuevos, nunca editar/borrar) vive en la **capa de app**, no en las reglas.

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
