# MypiCuadre

Sistema de gestión para una MYPIME cubana (comercio minorista con varios vendedores en turnos).
PWA instalable en Android desde Chrome, **100% funcional offline** (todos los datos en IndexedDB).

> Estado actual: **Fases 1–5 completas** (núcleo, caja/traspaso, conteo/auditoría/reportes,
> sincronización Firebase y seguridad por licencias), **Fase 6** (áreas de venta + almacén por
> ubicaciones + rol Administrativo) y **Fase 7 en curso** (robustez: respaldo, resiliencia).
> Además, **módulos opcionales por licencia**: mayorista, cuentas, elaboración y **mesas**.
> Multi-punto de venta físico diferido.

## Stack

- **Frontend:** React 18 + Vite 6, PWA (`vite-plugin-pwa`, `autoUpdate`). Tema oscuro
  navy/verde y tipografía **Manrope** (`@fontsource/manrope`, empaquetada, offline). Iconos
  **Lucide** (`lucide-react`).
- **Base de datos local:** IndexedDB vía [Dexie](https://dexie.org/) + `dexie-react-hooks`.
- **Sincronización (Fase 4):** **Firebase** Auth (email/contraseña) + Firestore con cache
  offline persistente. Capa de sync propia y ligera sobre Dexie (no se migró a RxDB).
- **Seguridad (Fase 5):** licencias de activación firmadas (ECDSA P-256, WebCrypto), verificadas
  **sin conexión**. El modelo es UUID string, append-only, sin borrado físico.

## Arranque

```bash
npm install
npm run dev      # desarrollo
npm run build    # build de producción (genera el service worker PWA)
npm run preview  # previsualiza el build
```

## Estructura

```
src/
├── app/
│   ├── router.jsx              # decide onboarding / login / app
│   └── providers/              # AuthProvider, CurrencyProvider
├── db/
│   ├── db.js                   # instancia Dexie + esquema/versiones
│   ├── constants.js            # enums (roles, unidades, monedas, etc.)
│   └── seed.js                 # config mínima en el primer arranque
├── repositories/               # única puerta de acceso a los datos (1 por colección)
├── features/                   # cada función de negocio en su carpeta
│   ├── auth/                   # onboarding, login PIN, gestión de usuarios
│   ├── settings/               # moneda base, tasas, umbrales del semáforo
│   └── home/
├── components/                 # UI compartida (PinInput, Layout, ...)
├── lib/                        # utilidades puras (ids, pin, currency, search, ...)
└── styles/
```

La capa `repositories/` aísla el acceso a datos: gracias a ella se montó la sincronización
(Fase 4, capa propia sobre Firestore — **no** se migró a RxDB) sin reescribir las pantallas.

## Modelo de datos (Fase 1)

Colecciones en IndexedDB (PK = UUID string en todas):

| Colección | Propósito |
|-----------|-----------|
| `users` | Usuarios y roles (dueño/vendedor). PIN con hash PBKDF2 |
| `config` | Configuración key-value (moneda base, umbrales del semáforo) |
| `exchangeRates` | Tasas USD/MLC, **append-only** (historial completo) |
| `categories` | Categorías de producto |
| `products` | Catálogo (400+), con `searchTokens` para búsqueda ágil |
| `priceChanges` | Historial de precios (auditoría) |
| `shifts` | Turnos: apertura, cierre, cuadre, semáforo. Efectivo por moneda `{MN, USD}` |
| `sales` | Ventas; precio **congelado** por línea (respeta cambios mid-turno) |
| `stockMovements` | Libro mayor de inventario (append-only); stock real se deriva de aquí |
| `purchases` | Entradas de mercancía |
| `cashMovements` | Extracciones de caja autorizadas (separadas de ventas) |
| `internalDebts` | Deuda interna (producto retirado sin pago; no es ingreso) |
| `auditEvents` | Base de auditoría para Fase 3 |

Colecciones añadidas en fases/módulos posteriores (esquema Dexie **v10**; ver
`src/db/db.js` y `CLAUDE.md` para el detalle de cada versión):

| Colección | Versión | Propósito |
|-----------|---------|-----------|
| `counts` | v2 | Conteo físico de inventario |
| `syncState` | v3 | Cursores de sincronización (marca de agua por colección) |
| `transfers` | v5 | Salidas almacén → área (Bloque 20). `stockMovements`/`products` ganan `location` |
| `errorLog` | v6 | Registro **local** de errores (no sincroniza ni viaja en respaldos) |
| `partners`, `partnerMovements` | v7 | Módulo `cuentas`: proveedores/terceros (saldo derivado) |
| `accounts`, `accountMovements` | v8 | Módulo `cuentas`: tesorería del negocio |
| `conversions` | v9 | Módulo `mayorista`: fraccionamiento en el almacén |
| `orders`, `orderItems` | v10 | Módulo `mesas`: cuenta por mesa (líneas append-only) |

> **Áreas y ubicaciones:** cada producto lleva `area` (índice, v4) y `stockByLocation`
> (`{ '__almacen': Q, 'Víveres': Q, ... }`, v5). El stock por ubicación sale del libro mayor;
> `products.stock`/`stockByLocation` son cachés que se actualizan en la misma transacción.

### Reglas de negocio clave

- Solo el vendedor con **turno activo** puede registrar ventas (ni el dueño).
- **Nada se borra:** correcciones = ajustes nuevos con nota y marca de tiempo.
- **Multimoneda:** efectivo en **MN y USD**; **MLC es electrónico** (solo visualización en
  Fase 1; el cobro real en MLC llega en Fase 2). Tasas independientes por moneda.
- Cuadre con semáforo 🟢 / 🟡 / 🔴, umbrales configurables por el dueño.

## Plan de implementación (Fase 1) — ✅ COMPLETA

- [x] **Bloque 0** — Scaffold PWA + Dexie + repositorios
- [x] **Bloque 1** — Ajustes: moneda base, tasas (USD/MLC), conversor, umbrales del semáforo
- [x] **Bloque 2** — Auth con PIN (onboarding del dueño, login, gestión de usuarios)
- [x] **Bloque 3** — Catálogo + categorías + búsqueda rápida
- [x] **Bloque 4** — Apertura/cierre de turno
- [x] **Bloque 5** — Ventas de mostrador (efectivo, cambio, descuento de stock)
- [x] **Bloque 6** — Importación Excel/CSV (plantilla + validación)
- [x] **Bloque 7** — Entradas/compras (con alta de producto en el flujo)
- [x] **Bloque 8** — Cambio de precio mid-turno + historial
- [x] **Bloque 9** — Extracciones de caja + deuda interna
- [x] **Bloque 10** — Cuadre de turno + semáforo

## Plan de implementación (Fase 2) — ✅ COMPLETA

- [x] **Bloque 11** — Pago por transferencia bancaria + captura de SMS (extrae monto/referencia)
- [x] **Bloque 12** — Cuadre por denominación de billetes + efectivo vs transferencias separados
- [x] **Bloque 13** — Gestión y saldo de deudas internas + historial de extracciones con filtros
- [x] **Bloque 14** — Exportar/importar turno (JSON) — traspaso offline con herencia de caja
- [x] **Bloque 15** — WhatsApp: compartir turno + reporte de cierre al dueño

## Plan de implementación (Fase 3) — ✅ COMPLETA (salvo multi-punto, diferido)

- [x] **Bloque 16** — Conteo físico interactivo por categorías (con aprobación del dueño)
- [x] **Bloque 17** — Panel del dueño + análisis (ganancias, ranking, rotación, reabastecimiento)
- [x] **Bloque 18** — Auditoría histórica inmutable
- [x] **Bloque 20** — Exportación PDF y Excel (ventas, cierres, inventario)
- [ ] **Bloque 19** — Multi-punto de venta *(diferido: para cuando haya más de un punto)*

## Plan de implementación (Fase 4) — ✅ COMPLETA

Sincronización multi-dispositivo con Firebase/Firestore, **offline-first**: cada vendedor
opera en su móvil sin conexión y, al haber internet, los dispositivos se sincronizan solos.
Se mantiene **Dexie como fuente de verdad local** y se monta una capa de sync propia y ligera
(en vez de migrar a RxDB). El modelo append-only la hace robusta:

- Colecciones **inmutables** (`sales`, `stockMovements`, `priceChanges`, `purchases`,
  `cashMovements`, `auditEvents`): se suben una vez, **sin conflictos**.
- Colecciones **mutables** (`products`, `users`, `config`, `exchangeRates`, `categories`,
  `shifts`, `internalDebts`, `counts`): **última escritura gana** por `updatedAt`.
- El **stock se recalcula desde `stockMovements`** tras cada fusión → dos vendedores
  vendiendo en paralelo offline no se pisan el stock.

Identidad de nube: una cuenta Firebase (email/contraseña) por negocio; el **PIN local**
sigue distinguiendo al vendedor. Todo cuelga de `businesses/{businessId}/…` en Firestore,
protegido por reglas. Encaja en el plan **Spark (gratis)**.

- [x] **Bloque 21** — Infraestructura: SDK Firebase, init con cache offline, reglas e índices Firestore
- [x] **Bloque 22** — Cuenta de nube del negocio (Auth email/contraseña) + alta de dispositivos
- [x] **Bloque 23** — Motor de subida (push) con marca de agua por `updatedAt`
- [x] **Bloque 24** — Bajada en tiempo real (pull) + recálculo de stock desde el libro mayor
- [x] **Bloque 25** — Indicador de estado de sync + alta de dispositivo desde la nube
- [x] **Bloque 26** — Reglas de seguridad por `businessId`, índices y manejo de conflictos

## Plan de implementación (Fase 5) — ✅ COMPLETA (Seguridad y licencias)

Candado de activación para vender la app a varios puntos de venta y poder emitir **licencias
temporales**. Una licencia es un texto firmado con la **clave privada** del desarrollador
(que nunca viaja ni se sube al repo); la app solo lleva la **clave pública** para verificar,
**sin conexión**. Imposible de falsificar sin la clave privada.

- [x] **Bloque 27** — Núcleo criptográfico (`src/lib/license.js`, ECDSA P-256 + SHA-256) + generador privado (`tools/gen-license.mjs`)
- [x] **Bloque 28** — Compuerta de activación en el router: sin licencia válida no se crea dueño ni se entra (`ActivationScreen`)
- [x] **Bloque 29** — Vigencia + periodo de gracia + **anti-trampa de reloj** (marca de agua de fecha) + aviso "por vencer" en la cabecera
- [x] **Bloque 30** — Estado y **renovación** de licencia desde Ajustes (negocio, plan, días restantes)
- [x] **Bloque 31** — Licencia ligada a la nube + **límite de dispositivos** (`maxDispositivos`), gestión desde Sincronización

## Fase 6 — Áreas de venta y almacén por ubicaciones — ✅ COMPLETA

Un punto puede dividirse en **áreas** (Víveres, Carnicería, …), cada una con su **caja y cuadre
propios**. Turno **por vendedor** (varios abiertos a la vez = normal); catálogo global con cobro
por área y ventas cruzadas auditadas. Un **almacén central** (`__almacen`) distribuye a las áreas
por **traspasos** (`transfers`); el stock vive por ubicación (`stockByLocation`).

- [x] **Bloque 19** — Áreas de venta: turno por vendedor, caja/cuadre por área, ventas cruzadas
- [x] **Bloque 20** — Almacén con ubicaciones: entradas al almacén, salidas a áreas, conteo por ubicación
- [x] **Bloque 20.6** — Rol **Administrativo** (mando operativo sin la identidad del negocio: no toca usuarios, licencia ni nube)

## Fase 7 — Robustez y calidad profesional — 🚧 EN CURSO

- [x] **Bloque 32** — Protección del dato local: `storage.persist()`, respaldo/restauración completa en `/backup`, recordatorio en el Home
- [x] **Bloque 33** — Resiliencia: `ErrorBoundary` global, registro local de errores (`errorLog`) y pantalla `/errors`
- [ ] **Bloques 34–39** — Pendientes (ver `docs/FASE7.md`)

## Módulos de licencia opcionales

Funciones que se venden por separado y viajan **firmadas** en la licencia (`modulos: [...]`).
Sin el campo, ningún módulo se habilita y la app es idéntica a la versión clásica. Se comprueban
con `useLicense().hasModule(...)`; **todo lo de un módulo va gateado** y quitarlo no borra nada.

- **`mayorista`** — venta desde el almacén central, precios por escala, pago mixto, conversión de productos.
- **`cuentas`** — proveedores/terceros (consignación, por pagar/cobrar) + cuentas de tesorería.
- **`elaboracion`** — centro de elaboración intermedio (almacén → elaboración → área) con rol acotado.
- **`mesas`** — cuentas abiertas por **mesa** dentro de un área (cafetería/restaurante):
  panel del salón, estados de mesa (libre/reservada/ocupada), **un toque = una unidad** con
  rebaja de stock en el acto, cargo por servicio (eximible por el mando con PIN), **ticket
  térmico 58 mm** (ESC/POS por Bluetooth) y reporte *"Ventas por mesa"*. Cobro por el camino
  normal (efectivo/transferencia/mixto); la venta se guarda **agrupada por producto**.

### Estilo y correcciones recientes

- Rediseño profesional (tema navy/verde, Manrope, iconos Lucide) en Home, Vender (POS) y Turno activo.
- Carrito del POS: cuadrícula de 2 filas (el stepper ya no se encima con la descripción en móvil).
- Transferencia: extrae importe + nº de transacción y **avisa si el monto del SMS no coincide**
  con lo cobrado; la diferencia se ve en el panel del dueño y en el reporte de ventas.
- Fechas en **hora local** del negocio (analytics/reportes/panel) → "Hoy/7/30 días" cuadran bien.
- Autorización del dueño robusta ante dueños duplicados (verifica el PIN contra cualquier dueño activo).

## Licencias de activación (uso del dueño/desarrollador)

El generador es **privado**: vive solo en tu PC. La **clave privada** (`tools/license-private-key.json`)
firma las licencias y **nunca** se sube al repo (está en `.gitignore`).

```bash
# 1) Una sola vez: genera TU par de claves (privada + pública)
node tools/gen-license.mjs keygen
#    -> escribe tools/license-private-key.json (NO subir, guárdala como oro)
#    -> imprime tu clave pública: pégala en src/lib/license.js (PUBLIC_KEY_JWK) y commitea

# 2) Emitir licencias para cada punto de venta
node tools/gen-license.mjs --negocio "Bodega Luis" --dias 30 --plan mensual
node tools/gen-license.mjs --negocio "Tienda Ana" --plan perpetua          # sin caducidad
node tools/gen-license.mjs --negocio "Kiosko X" --dias 365 --maxdisp 3      # con límite de dispositivos
```

Flags: `--negocio "<nombre>"` (obligatorio) · `--dias N` (vigencia; omitir = 30 días, o sin
caducidad si `--plan perpetua`) · `--plan demo|mensual|anual|perpetua` · `--maxdisp N` (límite
de dispositivos) · `--key <ruta>` (otra ruta de la clave privada).

El comando imprime el **código `MYPI1...`**: envíalo al cliente. En la app, pantalla de
**Activación** → pega el código → listo (cada dispositivo se activa una vez; funciona offline).
La renovación se hace pegando un código nuevo en **Ajustes → Licencia**.

> ⚠️ La clave pública embebida en el repo debe ser **la tuya** (paso 1). Si despliegas con una
> clave que no corresponde a tu clave privada, ninguna licencia que emitas abrirá la app.

La app ya está preparada para instalarse como PWA (ver `DEPLOY.md`).
