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
- **Por ubicación:** el mando elige almacén central o un área; se valida la existencia en ella.
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

## Módulos de licencia (funciones que se venden por separado)

Cada licencia puede traer, **firmados** en su payload (`modulos: [...]`), módulos opcionales.
Sin el campo → **ningún módulo** y la app es idéntica a la versión clásica. Definidos en
`src/lib/license.js` (`LICENSE_MODULES`) y comprobados en las pantallas con
`useLicense().hasModule(...)` (solo cuentan si la licencia está **desbloqueada**; no se pueden
autoactivar). Regla de oro: **todo lo de un módulo va gateado**; quitarlo no rompe ni borra nada
(append-only) — solo deja de ofrecerse.

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
- **`elaboracion`** — centro de elaboración intermedio (almacén → elaboración → área) con su
  rol acotado `ELABORATION`.
- **`mesas`** — cuentas abiertas por mesa dentro de un área (cafetería/restaurante). Ver abajo.
- **`imagenes`** — miniaturas sincronizadas (fotos de producto + carta de mesas). Ver "Fase 8".
  Nota: los **avatares** de usuario son **base** (no gateados), no cuentan como este módulo.
- **`divisas`** — precios de catálogo en **divisa** (USD): el dueño fija precio/costo en USD y el
  cliente paga en USD o MN (MN = USD × tasa vigente). OFF por defecto. Ver "Divisas" abajo.
- **`cocina`** — recetas + tablero de cocina: el dueño define recetas (insumos y consumo por unidad)
  y el **Cocinero** (rol `COOK`) elabora y envía a las áreas. OFF por defecto. Ver "Cocina" abajo.
- **`remesas`** — entregas a domicilio (dinero o producto) con su rol acotado `COURIER`
  (Mensajero): orden → cobro → asignación → entrega → liquidación. OFF por defecto. Ver
  "Entregas" abajo.

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
  `remesas` ✅ (entregas de dinero o producto: cobro a tesorería, fondo del mensajero que sale de
  las cuentas del negocio, custodia de efectivo y de producto con saldo derivado, liquidación con
  semáforo, editar/eliminar, cinco reportes y pestaña de auditoría; rol acotado `COURIER`). Cada
  uno gateado con `hasModule(...)`.

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
