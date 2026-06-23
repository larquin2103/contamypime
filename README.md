# MypiCuadre

Sistema de gestión para una MYPIME cubana (comercio minorista con varios vendedores en turnos).
PWA instalable en Android desde Chrome, **100% funcional offline** (todos los datos en IndexedDB).

> Estado actual: **Fase 1 — Núcleo Operativo**, en construcción por bloques.

## Stack

- **Frontend:** React + Vite, PWA (`vite-plugin-pwa`)
- **Base de datos local:** IndexedDB vía [Dexie](https://dexie.org/)
- **Sincronización (Fase 4, no implementada):** RxDB + Firestore. El modelo de datos ya
  está pensado para migrar limpio (claves UUID string, append-only, sin borrado físico).

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

La capa `repositories/` aísla el acceso a datos: cuando llegue la Fase 4 (RxDB+Firestore),
solo se cambia esa capa, no las pantallas.

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

## Plan de implementación (Fase 4) — en curso

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

La app ya está preparada para instalarse como PWA (ver `DEPLOY.md`).
