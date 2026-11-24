# Reportes de deudas internas y de extracciones de caja — diseño

Fecha: 24-11-2026 · Rama: `claude/awesome-dirac-484azm` (base `cf3344f`) · Tamaño: cambio pequeño.

## 1. Intención (palabras del dueño)

> «el dueño requiere tener detalles de las deudas de productos y sus cantidades por fecha, quién lo
> autoriza, para tener esa información»

Hoy la pantalla *Deudas y caja* (`FinancesScreen.jsx`) muestra las deudas y las extracciones, pero
**no se exporta** y en las deudas **ni siquiera dice qué producto** se llevó cada uno. No existe
ningún reporte de deudas; el dinero retirado al cerrar el turno no aparece en ninguna lista de
extracciones.

## 2. Qué se construye

Dos reportes nuevos en **Reportes → Turnos y caja**, con rango *Desde/Hasta* y exportación a
Excel/PDF por el camino de siempre (`exportExcel`/`exportPdf`).

### 2.1 «Deudas internas» (lista corrida por fecha + resumen por deudor al pie)

Fuente: `internalDebts`, filtradas por `createdAt` en el rango (día local, `inRange`), más recientes
primero, como el resto de reportes.

Columnas: **Fecha · Producto · Ubicación · Cantidad · U/M · Valor · Deudor · Autorizó · Registró ·
Estado · Nota**.

- **Producto / U/M:** del catálogo actual por `productId` (la deuda no congela el nombre). Si el
  producto ya no existe: «(producto no encontrado)».
- **Ubicación:** del movimiento del libro mayor de esa deuda (`stockMovements`, por el índice
  `type` = `internal_debt_out`, emparejado por `refId`). Sin movimiento: «—».
- **Valor:** `valueAtTime` tal cual (cantidad × precio de venta al momento).
- **Deudor** = `userId`; **Registró** = `registeredBy` (nombres por `userMap`); **Autorizó** =
  `authorizedBy` (ya es un nombre; vacío → «—»).
- **Estado:** «Pendiente» o «Saldada dd/mm/aaaa · <método>» (`DEBT_SETTLE_LABELS`).
- **Nota:** `note` de la deuda; si fue saldada con nota, se añade «· Saldo: <settleNote>».
- **Pie:** total de valor; y **Resumen por deudor**: nº de deudas, valor total, pendiente y saldado.
  Las **cantidades no se suman** entre productos (unidades distintas: u, kg, L).

### 2.2 «Extracciones y retiros de caja»

Dos fuentes, en una sola lista por fecha:

1. **Extracción** durante el turno: `cashMovements` con `type === 'withdrawal'`, por `createdAt`.
2. **Retiro al cierre:** `shifts` cerrados con `ownerWithdrawal`, por `closedAt`; **una fila por
   moneda con importe > 0**.

Columnas: **Fecha · Tipo · Turno (vendedor · área) · Registró · Monto · Moneda · Motivo · Autorizó**.

- Extracción: Registró = `userId`; Motivo = `reason`; Autorizó = `authorizedBy` (vacío → «—»).
- Retiro al cierre: Registró = quien cerró (`closedBy`); Motivo = «Retiro al cierre de turno»;
  **Autorizó = «no se registra»** (el cierre pide PIN pero no guarda quién lo dio:
  `ShiftScreen.jsx:690`).
- **Pie:** totales **por moneda, sin convertir** (criterio de la casa, como *Ingresos por
  concepto*), desglosados en Extracciones / Retiros al cierre / Total.

## 3. Divisas (decisión mía, corregible)

`CashScreen` congela `unitValue: product.price` **sin moneda**: con `divisas`, una deuda de un
producto en USD guardó su valor en USD sin marcarlo (preexistente; **no se toca**, regla 2). En el
reporte de deudas, **solo si** `divisas` está activo **y** algún producto de las filas está en divisa
(`isForeignPriced`), aparece la columna **Moneda** (deducida del producto **hoy**), los totales y el
resumen se parten por moneda, y una línea al pie avisa que la moneda es deducida. Sin eso, columnas y
totales en MN como el resto de la app (data-driven, como las columnas USD).

## 4. Restricciones

- **Solo lectura.** Cero escrituras, cero esquema Dexie, cero `SYNC_COLLECTIONS`, cero cambios en
  `src/features/sync/`, `src/db/`, `src/repositories/`, reglas y `package*.json`.
- **Función base** (sin `hasModule`): la deuda interna y la extracción también lo son. Reportes ya es
  solo de mando (`isManager`).
- Los ~30 reportes existentes quedan **idénticos byte a byte** (solo se añaden funciones al final de
  `reportsService.js` y dos entradas en `ReportsScreen.jsx`).
- Español en UI, comentarios y commits; imitar el estilo vecino; `npm run build` limpio antes de cada
  commit.

## 5. Enfoques considerados

- **A — Dos reportes de solo lectura (ELEGIDO por el dueño).** Lógica en un módulo puro nuevo en
  `src/lib/` con su suite node (patrón `productSalesHistory`), dos builders finos al final de
  `reportsService.js`. Riesgo de producción nulo.
- **B — A + guardar desde ahora quién autoriza el retiro al cierre.** Toca el flujo de cierre de turno
  (producción); solo valdría para cierres futuros y con todos los teléfonos actualizados. Descartado
  por ahora; queda como pedido aparte si el dueño lo echa en falta.
- **Descartado — exportar desde *Deudas y caja*:** los reportes viven en Reportes y esa pantalla no
  muestra el producto.

## 6. No-objetivos

- No cambiar `FinancesScreen`, `CashScreen`, `debtsRepo`, `cashRepo` ni `shiftsRepo`.
- No corregir la moneda faltante de `valueAtTime` (preexistente).
- No registrar el autorizador del retiro al cierre (enfoque B).
- No convertir monedas con la tasa.

## 7. Lo que queda al constructor

Nombre del módulo puro y de los builders, la forma de las filas de pie (siguiendo
`buildMermasReport`), el texto de las tarjetas, si `/help` tiene una lista de reportes que deba
mencionarlos, y la validación contra los respaldos reales disponibles en la máquina.

## 8. Lo que no se podrá garantizar

Nadie ejecutará la app en un dispositivo: se valida por código, build, suites node y los ficheros de
salida generados fuera del navegador. La moneda de una deuda en divisa es **deducida**, no registrada.
Los turnos cerrados antes de que existiera `ownerWithdrawal` no tienen retiro que mostrar.
