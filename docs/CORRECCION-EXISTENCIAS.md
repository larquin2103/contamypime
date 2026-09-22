# Corrección de existencias — arreglos pendientes y puesta al día del cliente

Documento de traspaso. Nace de la **auditoría forense del 12-09-2026** sobre los dos respaldos
del negocio *De todo un tin* (`respaldo_mypicuadre_2026-09-12` de la dueña y del vendedor, ambos
`schema 19`), que investigó **cuatro productos con saldo negativo**.

**Revisado a fondo el 15-09-2026**, ya **con los dos respaldos cargados y calculados**. Esa segunda
pasada encontró una causa raíz que la primera no vio, **invalidó una de sus conclusiones** y
**cambió el orden de los arreglos**. Lo que cambió está en el §0; lo demás se corrigió en su sitio.

**F1, F2, F3 y F4 están LOS CUATRO programados en la rama** (ver sus actas, y la validación del
§7 contra los respaldos reales). Aquí está el qué, el dónde y el por qué, más el
procedimiento que el cliente puede seguir. Todo lo que se afirma se verificó leyendo el código y
calculando sobre los respaldos; **la app NO se ejecutó**.

---

## 0. Qué cambió en la revisión del 15-09-2026

Cuatro cosas, y la primera es grave:

1. **La causa raíz no es la caché: es una línea obsoleta que la lee mal.** Los datos están
   sanos (305 claves de `stockByLocation`, **0 divergentes** contra el libro en los dos aparatos).
   Lo que miente es el **respaldo heredado de la v5** dentro de `stockAtLocation`, que devuelve el
   **total del producto** como si estuviera en el almacén cuando falta la clave `__almacen`.
   **58 productos afectados**, en los dos respaldos. Ver §2.
2. **El paso 4 de este mismo documento era una bomba.** Mandaba contar el *Almacén central*.
   Hacerlo hoy **clavaría −1.482 unidades negativas nuevas** en el libro. El procedimiento está
   corregido en §5; **el conteo de Tienda sí es seguro** (0 divergencias).
3. **La conclusión "hoy la caché cuadra con el libro" era correcta pero medía lo que no era.**
   Comparaba el diccionario `stockByLocation`; el código no usa el diccionario, usa
   `stockAtLocation()`, que tiene el respaldo. Con la función real son **58 divergencias**, no 0.
4. **El arreglo del conteo (antiguo A3) no funcionaba tal como estaba escrito.** Hay **tres**
   compuertas `> 0`, no una; el documento solo encontró la del repo. Ver §3-F2.

También: la línea base de pruebas que se citaba (*8 suites / 462 aserciones*) estaba vencida. Hoy
son **14 suites / 814 aserciones** (F1–F3 añadieron `stockLocation.test.mjs`), medidas el 15-09-2026, todas en verde, con `npm run build`
**exit 0**.

---

## 1. Lo que se encontró (evidencia)

| Producto | Saldo final | Ubicación | Origen |
|---|---|---|---|
| Galletas de soda | −30 | Tienda | 3 unidades vendidas de más; **ajuste de conteo físico −41**; entrada +14 |
| Chupa chiquito | −14 | Tienda | 15 vendidas sin una sola entrada en el libro; entrada +1 |
| Refresco Limón | −5 | Tienda | **deuda interna** — único movimiento del producto en su vida |
| Chicle de menta | −1 | Tienda | 1 vendido sin entrada |

**Los cuatro negativos están en Tienda. El almacén central no tiene ninguno** (verificado sobre el
libro: `__almacen` → 0 negativos).

Comprobaciones que descartan otras causas:

- **No se perdió nada en la sincronización.** Las 249 compras, 713 ventas y 27 traspasos tienen su
  movimiento en `stockMovements` y las cantidades cuadran una a una. El respaldo del vendedor es
  superconjunto del de la dueña (713 ventas vs 710, 1.621 movimientos vs 1.613).
- **No hubo movimiento borrado.** Los 78 ajustes de la base son todos
  `Ajuste por conteo físico (Tienda)`. **Cero ajustes de "Existencia inicial"**.
- **El diccionario `stockByLocation` está sano**: 305 claves presentes, **0 divergentes** contra el
  libro, en los dos aparatos. *(Esto sigue siendo cierto — y es justo lo que hace que el §2 sea un
  defecto de LECTURA y no de datos: no hay nada que reparar en la base.)*
- **226 productos no tienen ningún movimiento** (confirmado exacto) y por eso ni siquiera tienen el
  mapa `stockByLocation`.
- **Los aparatos no corrían este código durante el incidente.** La ventana acotable es
  **[27-07, 20-08)** y el candado de venta entró el **05-08** (`cd76bf2`), **dentro** de esa
  ventana: **no se puede determinar desde los datos** si estaba.

---

## 2. La causa raíz: un respaldo obsoleto de la v5

`src/repositories/countsRepo.js:12-16`:

```js
function stockAtLocation(p, location) {
  const byLoc = p.stockByLocation
  if (byLoc && byLoc[location] != null) return Number(byLoc[location])
  return location === WAREHOUSE ? Number(p.stock || 0) : 0   // <-- p.stock es el TOTAL
}
```

Si un producto **nunca tuvo un movimiento en el almacén**, su mapa no tiene la clave `__almacen`, y
esa última línea devuelve **el total del producto en todas las ubicaciones** como si estuviera en el
almacén central.

La línea **es obsoleta**: la migración v5 (`db.js:66`) le puso
`stockByLocation = { __almacen: stock }` a **todo** lo que existía entonces. Hoy "clave ausente"
significa **cero**, no "mira el total".

**Medido sobre los dos respaldos** (réplica literal de la función):

```
                          divergencias vs LIBRO
[dueña]      HOY: 58          con el arreglo: 0
[vendedor]   HOY: 58          con el arreglo: 0
```

Los 58 son todos el mismo caso: productos que solo han vivido en `Tienda`
(`byLoc={"Tienda":240}`) y que el almacén reporta como si los tuviera.

### Por qué es alcanzable, y por qué va a seguir apareciendo

`recomputeStock` (`pullEngine.js:49`) reconstruye el mapa **solo con las ubicaciones que tienen
movimientos**. Así que después de **cualquier** bajada de sync, todo producto que nunca pasó por el
almacén queda sin esa clave. No es un accidente de una migración vieja: **se regenera solo**.

### Dónde está copiada esa línea

**13 sitios** (barrido completo de `src/`, incluido `reportsService.js`, que `grep` se salta por su
byte NUL):

| Fichero | Efecto | ¿Expuesto en este negocio? |
|---|---|---|
| `repositories/countsRepo.js:15` | **escribe el asiento del conteo** | **SÍ — 58 productos** |
| `repositories/transfersRepo.js:33` | **valida el traspaso almacén→área** | **SÍ — 54 productos** |
| `repositories/mermasRepo.js:29` | valida la merma | sí (función base) |
| `repositories/conversionsRepo.js:53` | valida la conversión — **cae al total en CUALQUIER ubicación**, no solo el almacén | no (requiere `mayorista`) |
| `repositories/partnersRepo.js:163` | valida la entrega a terceros | no (requiere `cuentas`) |
| `features/inventory/CountScreen.jsx:26` | muestra | sí |
| `features/cash/CashScreen.jsx:177` | muestra | sí |
| `features/inventory/EntryScreen.jsx:77` | muestra | sí |
| `features/inventory/MermaScreen.jsx:37` | muestra | sí |
| `features/inventory/ElaborationScreen.jsx:25` | muestra | no (requiere `elaboracion`) |
| `features/sales/SalesScreen.jsx:80` | muestra (venta del almacén) | no (requiere `mayorista`) |
| `features/partners/PartnersScreen.jsx:367` | muestra | no (requiere `cuentas`) |
| `features/tables/TableScreen.jsx:162` | **ya está bien** (`?? 0`, sin respaldo) | — |

`TableScreen` es la prueba de que `?? 0` es la semántica que se quería: **es el único que no copió
el respaldo.**

### Lo que provoca hoy, en los dos aparatos

**Conteo del almacén central** (simulado sobre los datos reales):

```
productos que HOY entran al conteo del almacen: 56
de ellos FANTASMA (el libro dice 0):            54
si se cuentan a 0 y se aprueba -> NEGATIVOS NUEVOS: -1482 unidades

   Hamburguesa      -240      Bombón          -153      Sazon tocinito   -42
   Chupa Chupa      -191      Paletica         -88      Lamore (grande)  -42
   Bombón de Coco   -156      Jaba Naylon      -50
```

Hoy hay **50 unidades negativas**. Ese conteo las dejaría en **1.532**.

**Traspaso almacén→área** (`transfersRepo.js:33`, y la pantalla se usa: 27 traspasos registrados):

```
productos que el repo cree tener en el almacen sin tenerlos: 54
unidades que dejaria sacar de un almacen vacio:            1482
```

**El conteo de Tienda es seguro: 0 divergencias.**

---

## 3. Los arreglos

Los cuatro tocan **lógica de producción**, así que chocan con la regla 2 (cambios aditivos). Son
**correcciones de defecto**, no funciones nuevas. Ninguno va gateado por licencia: los cuatro son
función base. **Ninguno toca `src/features/sync/`, ni el esquema Dexie, ni `SYNC_COLLECTIONS`.**

### F1 — Quitar el respaldo obsoleto — ✅ **HECHO en la rama (15-09-2026)**

> **Acta.** Implementado en dos commits: el **motor** (`src/lib/stockLocation.js` + su suite) y el
> **cableado** de los doce sitios. Se hizo por **TDD con el ciclo observado**: la suite falla primero
> por módulo ausente, después se crea el módulo con la lógica **vieja** y falla en los tres asertos
> que importan —con los números reales del respaldo: Hamburguesa 240 en el almacén, Galletas −30—, y
> solo entonces se corrige. **16/16 en verde.** Validado además con la **función real** contra los
> dos respaldos: divergencias contra el libro **58 → 0**, y **305 de 305** casos con la clave
> presente **idénticos** a la versión vieja. Efecto medido de punta a punta:
>
> | Escenario (respaldo del 12-09) | antes (`main`) | después (F1) |
> |---|---|---|
> | Conteo del **almacén** contando 0 físico | 56 productos, clavaría **−1.486** | 2 productos, **−4** (los dos que sí existen allí) |
> | **Traspaso** almacén→área desde un almacén vacío | 54 productos, **1.482 u** | **0** |
> | Conteo de **Tienda** (trabajo diario) | 150 productos, 3.120 u | **150, 3.120 — idéntico** |
>
> `TableScreen` **no se tocó**: ya estaba bien (`?? 0`), era el único de los trece que no había
> copiado el fallo. Sin imports huérfanos (comprobado a mano: no hay linter). Build **exit 0**,
> **14 suites / 790 aserciones**, y **0 identificadores no definidos** en los doce ficheros, con
> control negativo. **Nadie lo ha ejecutado en un dispositivo.**

- **Qué:** cuando el mapa existe, una clave ausente vale **0**. El respaldo al total queda **solo**
  para los productos pre-v5 que no tienen mapa.

```js
if (byLoc) return Number(byLoc[location] || 0)              // clave ausente = 0
return location === WAREHOUSE ? Number(p.stock || 0) : 0    // solo pre-v5 sin mapa
```

- **Dónde:** los 7 sitios expuestos (los 5 repos y las 4 pantallas de la tabla del §2 marcados
  "sí"). Los demás conviene arreglarlos igual, por coherencia, aunque su módulo esté apagado —
  sobre todo `conversionsRepo`, que es el peor de los 13.
- **Coste: cero.** No añade ninguna consulta. No cambia el esquema. No repara datos (no hace falta:
  el mapa ya es correcto).
- **Validación de que no rompe producción** — ejecutada sobre los **dos** respaldos:

```
[dueña]                                    [vendedor]
 1. clave PRESENTE : 304 -> identicos 304   305 -> identicos 305   OK (no-op exacto)
 2. clave AUSENTE  :  72 -> = LIBRO     72    71 -> = LIBRO     71   OK
 3. SIN mapa (pre-v5): 452 -> cambian    0   452 -> cambian     0   OK (rama intacta)
 4. direccion: 55 casos BAJAN (mas restrictivo), 3 SUBEN
 5. los 4 negativos entran al conteo de Tienda con F1+F2: 4/4       OK
```

  Con **control negativo** (un producto solo en Tienda consultado en el almacén: hoy devuelve 9,
  con F1 devuelve 0) que demuestra que la prueba distingue las dos implementaciones. Sin él no
  mediría nada.

- **Los 3 casos que "suben"** son Refresco Limón (−5→0), Chicle de menta (−1→0) y Chupa chiquito
  (−14→0), **consultados en el almacén**: son negativos que viven en Tienda y que el almacén estaba
  reportando como suyos. Devolver 0 es lo correcto, y el punto 5 prueba que **siguen entrando al
  conteo de Tienda**, que es donde les toca.
- **Efecto declarado:** un traspaso o una merma de esos 54 productos desde el almacén **pasará a
  rechazarse**. Es el comportamiento correcto — hoy dejan sacar de un almacén vacío — pero el dueño
  tiene que saberlo antes.

### F2 — El conteo físico no puede ver lo negativo — ✅ **HECHO en la rama (15-09-2026)**

> **Por qué hace falta, si los candados deberían impedir los negativos.** Porque hay **dos vías que
> no son un fallo y no se pueden cerrar**:
>
> 1. **El descubierto autorizado** (`allowShortProduction`). El propio diseño ya dice que la
>    existencia *«queda en negativo hasta que una entrada, un traspaso **o el conteo** la neteen»*
>    (`CLAUDE.md:638`). Ese camino **estaba roto**: el conteo no listaba negativos.
> 2. **La carrera offline.** Dos vendedores sin internet consultan cada uno **su** copia del libro
>    mayor, los dos ven la última unidad, los dos venden, y al fusionar el libro suma **−1**. Los dos
>    candados funcionaron. Y el stock derivado del libro **no se recorta a cero en ninguna parte**
>    (comprobado: ni un `Math.max(0, …)` sobre stock): el negativo es posible **por construcción** en
>    offline-first. Aquí no es teórico — venden **tres personas** (413, 217 y 83 ventas) en la misma
>    área y en al menos dos aparatos.
>
> Las vías que **sí** son fallo se cierran aparte: F1 (hecho) y F4 (pendiente).
>
> **Acta.** Las tres compuertas cambiadas, y además el **aviso al dueño**, porque hasta ahora un
> negativo era **mudo**: cero avisos en toda la app y el catálogo lo esconde con su filtro `> 0`.
> Tipo nuevo `NEGATIVE_STOCK_STATE` en la categoría **`inventario`** (no `elaboracion`: el
> descubierto autorizado es solo una de las causas, y donde se cuadra un negativo es en el conteo).
> Deriva del **estado** y no de un evento —al revés que el aviso que ya existía— porque la venta
> doble entre dos teléfonos no deja ningún registro: el negativo aparece **al fusionar**. El id lleva
> producto+ubicación+**día**, así que se repite una vez al día mientras siga sin cuadrar y
> **desaparece solo** al netearlo. Corre **una vez por día local** para no anular el early-out del
> barrido de 60 s, y **se salta lo inactivo** (el conteo tampoco lo ofrece).
>
> | | antes | después |
> |---|---|---|
> | Conteo de **Tienda** | 150 productos | **154** (+4: los cuatro negativos) |
> | Conteo del **almacén** | 2 | 2 (sin cambio) |
> | Avisos al dueño con los datos reales | 0 | **4**, uno por negativo |
>
> TDD con el ciclo observado (`negativeLocations` falla primero por no estar exportada). **28/28** en
> la suite; validada contra los dos respaldos: encuentra los 4 conocidos y **ni uno de más**. Build
> **exit 0**, **14 suites / 802 aserciones**. **Nadie lo ha ejecutado en un dispositivo.**

- **Dónde:** **tres** compuertas, no una:
  1. `repositories/countsRepo.js:81` — `p.active && stockAtLocation(p, location) > 0`
  2. `features/inventory/CountScreen.jsx:265` (`isVisible`) — `sysOf(it) > 0 || tiene físico`
  3. `features/inventory/CountScreen.jsx:162` (`hasItems`) — gatea el botón *Iniciar conteo*
- **Consecuencia:** un producto en negativo **no aparece nunca**. Y como `countsRepo.approve:166`
  es el **único** sitio de toda la app que llama a `stockRepo.adjust` (verificado: 1 coincidencia
  en todo `src/`), **los cuatro negativos son hoy imposibles de corregir desde la aplicación**.
- **Arreglo:** `> 0` → `!== 0` en las tres. Cambiar solo la primera **no resuelve nada**: la
  pantalla lo seguiría escondiendo.
- **Por qué no rompe:** los **ceros se comportan exactamente igual que hoy** (`!== 0` los sigue
  excluyendo); solo cambian los negativos. Y una fila negativa **sin contar** es inerte: `submit`
  la marca `counted:false` y `approve` la salta (`if (!it.counted) continue`).
- **Efecto medido con F1 aplicado:**

```
             HOY   solo F2   F1+F2
__almacen     56      59        2     <- desaparecen 57 fantasmas
Tienda       150     154      154     <- IDENTICO: el trabajo diario del vendedor no cambia
```

- **Aviso para el cliente:** un negativo corregido saldrá en **🔴 rojo** con ~100 %
  (`evalSemaphore` usa `Math.abs(expected)`; no rompe ni divide por cero). Es normal, no es alarma.

### F3 — El conteo cuadra contra la CACHÉ, no contra el libro mayor — ✅ **HECHO en la rama (15-09-2026)**

> **Acta.** `submit` y `approve` derivan ahora del **libro mayor** (índice `[productId+location]`, la
> misma consulta que `salesRepo` hace inline). El comentario de `submit` **dejó de mentir**.
>
> **Incidente histórico reproducido con los datos reales:**
>
> ```
> conteo bf07fcac | Tienda | enviado 2026-09-10T01:36 | aprobado
> Galletas de soda:  systemStock registrado = 48,  físico = 7,  diff = -41
> El LIBRO MAYOR en ese instante decía -3  (12 movimientos)
>
>    ANTES (caché):  delta = 7 - 48   = -41   <- asiento clavado, append-only
>    CON F3 (libro): delta = 7 - (-3) = +10   <- deja el producto en 7, lo contado
> ```
>
> El asiento de −41 está en el libro, fechado a esa misma hora. **41 de las 44 unidades negativas de
> ese producto las puso este cálculo, no las ventas.**
>
> **Y no era un caso aislado:** de las **73 líneas** contadas y aprobadas del historial, **19 (26 %)**
> tenían la caché distinta del libro. **Cautela sobre esa cifra:** el libro «de ese instante» se
> reconstruye filtrando `createdAt < submittedAt`, y un movimiento creado offline en otro teléfono
> puede haber llegado después con fecha anterior. Esa reconstrucción **no distingue** «la caché estaba
> mal» de «el movimiento llegó tarde». Las dos posibilidades apuntan al mismo sitio —el libro es a lo
> que todo converge—, pero **el 26 % no debe leerse como 19 errores de caché demostrados**.
>
> `startDraft` **sigue leyendo la caché a propósito** (es una foto para armar la lista y no escribe
> nada; derivar 400+ productos costaría una consulta por producto sin ganar nada). **Coste real:** una
> consulta por índice por producto **contado**, no por producto del catálogo.
>
> **Lo que NO se tocó, a propósito:** la atomicidad de `approve` (sigue haciendo N transacciones) y la
> recomposición de la caché —que habría exigido editar `features/sync/`—. Si el asiento sale correcto,
> la caché se autorrepara en la siguiente bajada, como hoy.
>
> TDD con el ciclo observado (`ledgerQty` falla primero por no estar exportada). **40/40**; cubre el
> residuo de punto flotante y que una cantidad no numérica no envenene la suma con `NaN`. Build
> **exit 0**, **14 suites / 814 aserciones**. **Nadie lo ha ejecutado en un dispositivo.**

- **Dónde:** `countsRepo.js` — `submit:142` y `approve:164`.
- **El comentario miente:** `submit:121-126` afirma *"el stock del sistema se relee AHORA desde el
  libro mayor"*. **Lee la caché.**
- **Consecuencia probada:** el conteo `bf07fcac`, enviado el 10-09 01:36, registró
  `systemStock: 48` para Galletas de soda cuando el libro daba **−3**. `approve` calculó `7 − 48` y
  clavó un **−41 append-only**. **41 de las 44 unidades negativas de ese producto las puso el
  conteo, no las ventas.**
- **Arreglo:** una función `stockFromLedger(productId, location)` dentro del propio `countsRepo.js`
  —la **misma consulta e índice** que `salesRepo.js:165` ya usa inline
  (`[productId+location]`, existe desde v5)— usada por `submit` y `approve`.
- **Por qué no rompe:** cuando la caché y el libro coinciden, devuelve el **mismo número**, luego el
  **mismo delta**, luego **las mismas escrituras**. Es un **no-op exacto** en el camino sano. Con F1
  ya aplicado, el camino sano son los 414 productos.
- **Qué NO hay que hacer:** el plan anterior proponía recomponer la caché reusando `recomputeStock`
  de `pullEngine.js`. **Queda descartado: exige editar `src/features/sync/`.** No hace falta — si el
  asiento sale correcto, la caché se autorrepara en la siguiente bajada, igual que hoy.
- **`startDraft` y `CountScreen.stockAt`** no necesitan el libro: con F1 su lectura ya coincide.
- **Atomicidad:** hoy `approve` hace **N transacciones** (una por `stockRepo.adjust`). Envolverlo en
  una sola es un cambio mayor y de más riesgo del que quita. **No tocarlo**, dejarlo anotado.
- **Coste:** una consulta por índice por producto contado (142 en el conteo más grande de esta base).

### F4 — La deuda interna no tiene candado de existencia — ✅ **HECHO en la rama (16-09-2026, `4eb3cb6`)**

> **Validado con datos reales (§7.5):** **2 de las 10** deudas internas del aparato sacaron
> producto con existencia **0**, y una de ellas es la causa **completa** del `−5` de Refresco
> Limón. No era un riesgo teórico.

- **Dónde:** `repositories/debtsRepo.js:11-60` (`create`) y `features/cash/CashScreen.jsx:176-178`.
- **Qué pasa hoy:** `create` escribe el `INTERNAL_DEBT_OUT` **sin comprobar nada**. Es el único repo
  que rebaja inventario sin comprobación alguna.
- **Arreglo:** replicar el candado de `salesRepo.js:163-169` **dentro de la transacción que ya
  existe** (`debtsRepo.js:21` ya incluye `db.stockMovements`: no hay que ampliar el alcance).
  **Un solo llamador** en toda la app: `CashScreen.jsx:191`.
- **Validado contra las 10 deudas reales del respaldo**, con el saldo del libro justo antes de cada
  una:

```
Hamburguesa        pide 12   saldo 0   <<< RECHAZADA
Refresco Limón     pide  5   saldo 0   <<< RECHAZADA
(las otras 8 pasan sin cambio)
```

  Las dos que el candado habría frenado son exactamente las que fabricaron negativos: **Refresco
  Limón es el −5 de la tabla del §1**, y Hamburguesa creó un −12 que una entrada posterior tapó.

- **Decisión: validar TODAS las ubicaciones, contra el LIBRO.** Resuelta con datos:
  - Las **10 deudas ocurrieron en Tienda**, y ahí caché y libro rechazan **exactamente lo mismo**
    (232 de 382 productos activos). La elección de fuente **solo** cambia algo en el almacén
    (326 vs 380), y **con F1 esa diferencia desaparece**.
  - Coste: **una** consulta por índice por deuda (no N, como en el conteo).
  - El argumento decisivo: esos 232 productos **ya no se pueden vender hoy** desde Tienda
    (`salesRepo` valida Tienda contra el libro). El candado **no añade una restricción nueva: quita
    la incoherencia de que se pueda regalar como deuda lo que no se puede vender.**
- **Fraccionarios:** comparar **los dos lados con `cleanQty`**. Redondea a 3 decimales justamente
  porque sumar pesos deja residuos; si no, una libra de `2.4999999996` rechazaría una deuda de 2.5
  sin motivo. (`salesRepo` limpia `avail` pero no `qty`: no copiar esa asimetría.)
- **Bug de la pantalla, aparte:** `CashScreen.stockAt:176-178` devuelve `p.stock` —el total en
  **todas** las ubicaciones— cuando no está el módulo mayorista, pero la rebaja sale de
  `sourceLocation || shift.area || WAREHOUSE`. **El arreglo tiene que replicar esa resolución
  exacta**, no el `sourceLoc` de la pantalla: con un mando **con turno pero sin área**, el repo
  rebaja del almacén y la pantalla enseña el total.
- **Efecto declarado:** a partir del arreglo **se rechazarán deudas que hoy pasan**. **232 de 382
  productos activos** no admitirían una deuda de 1 unidad en Tienda, y los **226 sin ningún
  movimiento** darán error siempre. Es el comportamiento correcto, pero el dueño tiene que saberlo.

### Orden, y cómo validarlo

**F1** ✅ → **F2** ✅ → **F3** ✅ → **F4** ✅ (candado de la deuda interna).
**Los cuatro están hechos en la rama**, más el hallazgo **H5** del §6. F4 es el que cambia la
operación diaria (rechaza sacar lo que no hay), así que **el dueño tiene que saberlo antes de
desplegar**, no después.

**F4 no puede desplegarse antes que F2.** Si el candado rechaza una deuda porque la existencia está
en 0 o en negativo, el único remedio es el conteo — que sin F2 no lista negativos. Al revés, el
cliente queda atrapado.

`npm run build` limpio y las **14 suites node** antes de cada commit. Medido el 16-09-2026 en el
commit de hoy: **834 aserciones, 0 fallos** (`stockLocation.test.mjs` aporta 60).

**Ninguna de las 13 suites cubre esto, ni puede:** `countsRepo`, `transfersRepo` y `debtsRepo`
necesitan base de datos. **El build y las pruebas actuales no detectarían un error en F1–F4.**
Se propone instalar **`fake-indexeddb` como `devDependency`** —aditivo, fuera del bundle, con
precedente en `docs/FICHA-COSTO.md` §9.17— para poder probarlos de verdad: sembrar un producto del
caso del §2, aprobar el conteo del almacén y comprobar que el libro **no se mueve**.

### Lo que estos arreglos NO cubren

- **No explican las tres ventas en negativo.** Con el código de hoy, `salesRepo.js:163-169` las
  habría rechazado. Es atribuible al build anterior al 20-08, que ya fue sobrescrito.
- **La venta desde el almacén central sigue sin candado de libro** (`salesRepo.js:163`, que exime
  `WAREHOUSE`). Con `mayorista` apagado no es alcanzable en este negocio.
- **`mermasRepo`, `conversionsRepo`, `partnersRepo` y `transfersRepo` siguen validando contra la
  caché** aun con F1 aplicado. F1 les quita el respaldo mentiroso (que era el problema real), pero
  no les pone el candado contra el libro. Queda anotado.

---

## 4. Paso a paso para el cliente

Sigue el orden. **Los pasos 1 y 2 son obligatorios antes de tocar nada.**

### 1. Respaldo, antes que nada

En **los dos teléfonos**: `Respaldo` → guardar el archivo **fuera del teléfono** (correo, WhatsApp
a sí misma, memoria). Sin esto no hay marcha atrás.

> El esquema de la base es **de ida**: un respaldo hecho con la versión nueva **no se puede
> restaurar** en una versión vieja (`backupService.js:86`).

### 2. Los dos teléfonos iguales y sincronizados

- Cerrar la app **del todo** en ambos y volver a abrirla **con internet**.
- **Fecha y hora en AUTOMÁTICO** en los dos. Los relojes van desfasados ~21 s y eso ya provocó
  pérdidas de estado; es lo único que el código no puede arreglar.
- Comprobar que el indicador de nube está en ☁️ y que un producto cualquiera muestra la misma
  existencia en los dos aparatos.

### 3. 🛑 NO CONTAR EL ALMACÉN CENTRAL, y no traspasar desde él

**Hasta que F1 esté desplegado:**

- **No hacer un conteo físico del *Almacén central*.** Aprobarlo hoy clavaría **−1.482 unidades
  negativas** (§2). Multiplicaría el problema por treinta.
- **No hacer salidas del almacén** de los 54 productos afectados: el sistema cree tener existencia
  que no tiene y dejaría sacarla, dejando el almacén en negativo.
- **El conteo de *Tienda* sí es seguro** (0 divergencias). Se puede hacer desde ya.

*(Esta advertencia corrige una instrucción de la versión anterior de este documento, que mandaba
contar las dos ubicaciones.)*

### 4. Limpiar el catálogo duplicado (antes de contar)

El catálogo se dio de alta **dos veces** (15-08 00:14 y 15-08 21:23) y quedaron **110 nombres
duplicados activos**. Si se cuenta sin limpiar, la existencia se reparte entre gemelos y el conteo
no cuadrará nunca. Detalle por grupo en `docs/duplicados-2026-09-12.txt`.

- **96 grupos son seguros**: solo uno de los gemelos tiene historial. Dar de baja el otro
  (`Catálogo` → eliminar; es baja lógica, no se borra nada).
- **14 grupos son delicados** porque los dos gemelos tienen movimientos. Conservar el de más
  historial y **pasar la existencia del otro al que se conserva** antes de darlo de baja:
  `garbanzo, lomo natural, refresco de polvito golden, intima, arroz, servilletas, chicharo,
  bombon de coco, saltinas, chupa chupa, pollo, harina, azucar, jaba naylon`.

**Regla de oro: conservar siempre el que tiene ventas y entradas.** Nunca el vacío.

### 5. Poner las existencias al día (conteo físico de Tienda)

1. `Conteo físico` → elegir **Tienda** → contar **categoría por categoría**.
2. Teclear lo que **hay de verdad** en el estante. No copiar lo que dice la app.
3. Enviar a aprobación y que la dueña apruebe.

Al aprobar, la app genera los ajustes y la existencia queda igual a lo contado. **Nada se borra**:
el ajuste queda registrado con su fecha y su autor.

### 6. Los cuatro negativos

Los cuatro están en **Tienda**. Con **F1 + F2 desplegados salen solos** en el conteo del paso 5 y no
hay que hacer nada más (comprobado: 4 de 4 entran a la lista).

**Sin F2 no aparecen**, y el único rodeo es registrar una **Entrada** que los devuelva a positivo y
después contarlos. Con dos avisos:

- La entrada **sobrescribe el costo del producto** con el que se teclee (`purchasesRepo.js`): poner
  el **costo real**, no un número cualquiera.
- La entrada **aparece en el reporte de Entradas** como una compra que no existió.

Por eso **lo recomendable es esperar a F2**.

### 7. Cómo evitar que vuelva a pasar

- **La mercancía entra por `Entradas`.** Nunca tecleando la cantidad al crear el producto.
- El campo **"Existencia mínima"** es el aviso de reposición, **no la cantidad que hay**. Están mal
  puestos en: `Paleticas (104)`, `Chicle de menta (70)`, `Piquinini (26)`, `Yogurt (24)`,
  `Rollito (24)`, `Chupa chiquito (89)`, `Coditos por libra (20)`.
- **Hasta que F4 esté aplicado**, la *deuda interna* **no comprueba si hay existencia**: deja sacar
  producto que no está. Usarla con cuidado.
- Un producto nuevo nace en **cero**. Para que tenga existencia hay que registrarle su entrada.

---

## 5. Lo que NO se puede garantizar

- **Nadie ha ejecutado la app.** Todo lo de arriba es **lectura de código + aritmética sobre los dos
  respaldos + build + las 13 suites node**. Ni un conteo aprobado, ni una deuda rechazada, ni una
  fusión entre dos aparatos.
- **Los respaldos son del 12-09-2026.** Los teléfonos pueden haberse movido desde entonces; los
  números son ciertos a esa fecha.
- **No se sabe por qué se vendieron unidades en negativo.** El build que corría entonces fue
  sobrescrito y no se puede inspeccionar. *(El §7.3 atribuye ya cada uno de los cuatro negativos
  a su causa: dos son de esas ventas sin entrada registrada, uno del conteo y uno de la deuda
  interna.)*
- ~~**F1–F4 no están programados.** Este documento es el plan, no el acta.~~ **Vencido el
  16-09-2026:** los cuatro están programados y commiteados, y el §7 los valida contra los
  respaldos reales. El documento es ya plan **y** acta.

---

## 6. Acta de la auditoría del 16-09-2026 — H5, el índice que se salta filas

Auditoría de F1–F4 completos, pedida antes de fusionar a `main`. **Un hallazgo**, sobre código
propio de la rama, ya corregido en ella.

### Qué estaba mal

F3 y F4 leían el libro mayor **a través del índice compuesto `[productId+location]`**. En
IndexedDB, un registro al que le **falta un componente** de una clave compuesta **no se indexa**:
un movimiento sin `location` no está en ese índice. No vale otra cosa — **no está**, en silencio.

`recomputeStock` (la caché, en `pullEngine`) **sí los cuenta**, con `m.location || WAREHOUSE`. Las
dos fuentes agrupaban distinto, y el conteo **escribe un asiento append-only que no se deshace**.

### Que esos movimientos pueden existir no es hipótesis

Cada eslabón verificado en el código, no supuesto:

| Hecho | Dónde se comprobó |
|---|---|
| Antes del Bloque 20 los movimientos se escribían **sin campo `location`** | `git show ab7abb2^:src/repositories/stockRepo.js` |
| La **sincronización es anterior** a esa versión | `a0f1d2f` (Fase 4) precede a `ab7abb2` en el historial |
| La bajada escribe el documento **tal cual** | `pullEngine.mergeIncoming` → `bulkPut(toPut)`, sin normalizar |
| El JSON de un turno también | `handoffService.js:195` → `bulkPut(snap.stockMovements)` |
| La migración v5 solo arregla lo que **ya estaba** en el dispositivo | `db.js`, `version(5).upgrade` |

Ningún escritor puede crear uno hoy (los 15 ponen `|| WAREHOUSE` o una constante), pero **nada
impide que llegue uno**. El invariante no lo sostenía nadie.

### El daño, medido

Reproducido con Dexie 4.4.4 sobre IndexedDB, no razonado:

```
Movimientos:  10 @ SIN ubicacion     -3 @ __almacen
Cache: __almacen = 7        Indice: -3

El vendedor cuenta 7:
  antes de F3 (cache) -> ajuste 0     (correcto)
  con F3 (indice)     -> ajuste +10   (append-only)  ->  el producto queda en 17
```

Es **la misma avería que F3 viene a arreglar**, con el signo cambiado y otra causa.

### Evidencia EN CONTRA, que también se registra

El respaldo real disponible (`respaldo_mypicuadre_2026-09-04.json`, esquema 17) tiene **474 de 474
movimientos con `location`**: **cero exposición ahí**. Pero es un aparato **secundario** — 31
ventas, cuando los aparatos del negocio tienen 413, 217 y 83 — y la exposición vive justo en la
historia larga, que **no se ha podido examinar**.

Se corrigió igual: la escritura es irreversible, el fallo es mudo, `main` hoy **no** tiene esa
exposición en el conteo (lee la caché, que sí los cuenta), y el arreglo no cuesta nada.

### El arreglo

`lib/stockLocation.js` gana **`ledgerQtyAt(movimientos, ubicación)`**, que agrupa **exactamente
como `recomputeStock`**. `countsRepo.stockFromLedger` y el candado de `debtsRepo` consultan ahora
por `productId` y agrupan con ella. **Las dos fuentes ya no pueden discrepar: es la misma regla.**

**Coste medido sobre el respaldo real: cero filas de más.** Ningún producto tiene movimientos en
más de una ubicación (352 productos, máximo 9 movimientos, mediana 1).

### Validación

- **9.000 comparaciones** entre el cálculo del conteo y el **bucle real de `recomputeStock`
  extraído de `pullEngine.js`** (no una copia), sobre 3.000 libros aleatorios, 2.610 de ellos con
  algún movimiento sin ubicación: **0 divergencias**.
- **Control negativo**: la versión anterior divergía **2.610 veces** en el mismo barrido.
- **No regresión**: con todos los movimientos ubicados —el caso del respaldo real— **6.000 de
  6.000 idénticos** a lo que hacía la rama.
- El escenario que producía el +10, con el **cuerpo real de `stockFromLedger` extraído del
  fichero** y un IndexedDB de verdad: **ajuste 0**. Y `15 == 15` con todo ubicado.
- Build limpio, **14 suites / 834 aserciones**, 0 identificadores sin definir, 0 imports huérfanos.

### Lo que NO se tocó, y por qué

`salesRepo`, `kitchenRepo`, `ordersRepo` y `stockRepo.stockAt` usan el mismo índice y están en
`main`. Allí sirve para **rechazar**, así que falla del lado seguro (como mucho bloquea una venta
legítima); aquí servía para **calcular un asiento**. Tocarlos ampliaría el alcance de la fusión sin
necesidad. Queda anotado para decidirlo aparte. *(`stockRepo.stockAt` además no lo llama nadie.)*

### Sigue sin poder garantizarse

**Nadie ha ejecutado la app.** Ni un conteo aprobado, ni una deuda rechazada, ni una fusión entre
dos aparatos.

---

## 7. Acta de la validación del 16-09-2026 — los respaldos reales, cargados y calculados

Validación de **F1–F4 y H5 contra los dos respaldos del negocio** (`12-09-2026`, esquema 19),
pedida por el dueño. **Ejecutada, no citada**: los ficheros se cargaron y se calcularon, y las
funciones que se probaron son las **reales del repo** —`src/lib/stockLocation.js` importado como
módulo, no copiado—. La versión "vieja" con la que se compara se **extrajo de `origin/main`**
(`git show`), no se reconstruyó de memoria.

### 7.1 H5: cero exposición, y por una razón estructural

La duda que quedaba abierta era que el único respaldo disponible (04-09) fuese un aparato
secundario y que **la exposición viviera en la historia larga, sin examinar**. Ya está examinada,
en los **dos** aparatos del negocio:

| Aparato | Movimientos | Sin `location` | Rango |
|---|---|---|---|
| Vendedor (exportado 16:40) | **1.621** | **0** | 13-08 → 12-09-2026 |
| Dueño (exportado 16:20) | **1.613** | **0** | 13-08 → 12-09-2026 |

Ubicaciones en juego: solo `Tienda` (1.370 / 1.364) y `__almacen` (251 / 249).

**Y no es casualidad: es estructural.** El negocio abrió el **13-08-2026** y el Bloque 20 —el que
empezó a escribir `location`— es de **`ab7abb2`, 30-06-2026**. Ninguna escritura de este negocio es
anterior al campo, así que **no puede tener un solo movimiento sin él**.

**H5 se mantiene igual**, y conviene decir por qué sin adornarlo: en **este** negocio no arreglaba
nada. Es defensa de un camino que sigue abierto —la bajada de sync y el JSON de turno escriben el
documento tal cual, y la migración v5 solo tocó lo que ya estaba en el dispositivo— y cuesta cero.
Lo que la validación cambia es la **honestidad del expediente**: antes no se sabía; ahora se sabe.

### 7.2 F1: las cifras del §2, reproducidas al dígito

Sobre `respaldo_mypicuadre_2026-09-12vendedor.json`, 414 productos × 2 ubicaciones = 828 pares:

- **58 divergencias** entre la caché leída *a la vieja* y el libro mayor. Con `stockAtLocation` de
  la rama: **0**.
- Con el criterio **exacto** de `countsRepo.js:104` (`p.active && existencia > 0`), un conteo del
  **Almacén central** listaría **56 productos**, de ellos **54 con existencia fantasma**, y
  aprobarlo a cero clavaría **−1.482 unidades**. **Es exactamente la cifra del §2.**
- En el aparato del **dueño** la misma cuenta da **58 listados, 54 fantasmas, −1.486 unidades**
  (variante que no estaba registrada: el §2 midió sobre el del vendedor).
- **Con F1 la lista del almacén pasa de 56 productos a 2** (4 en el del dueño): los que de verdad
  tienen existencia allí.
- **La caché está sana**: 305 claves de `stockByLocation` en el vendedor (304 en el dueño),
  **0 divergentes** contra el libro. Se confirma el diagnóstico del §2 — el dato nunca estuvo mal;
  mentía la línea que lo leía.
- **226 productos sin mapa** (los que nunca tuvieron un movimiento), y **todos con `stock` 0**: la
  rama pre-v5 que `stockAtLocation` conserva no introduce **ni un** fantasma en este negocio.

### 7.3 F2: los cuatro negativos, y de dónde salió cada uno

Caché y libro mayor coinciden **exactamente** en los cuatro. Con el filtro viejo (`> 0`) la lista de
Tienda tiene **150** productos; con el `!== 0` de F2, **154**: entran los cuatro, como decía el §4.6.

| Producto | Tienda | Causa, derivada del libro mayor | Lo evita |
|---|---|---|---|
| Galletas de soda | **−30** | el ajuste del conteo del 10-09 puso **−41** de las −44 originales | **F3** |
| Chupa chiquito | **−14** | 15 unidades vendidas con **1 sola entrada** registrada | el conteo |
| Refresco Limón | **−5** | **la deuda interna** del 09-09 sacó 5 con existencia **0** | **F4** |
| Chicle de menta | **−1** | 1 vendida **sin ninguna entrada** registrada | el conteo |

### 7.4 F3: era peor de lo documentado — diecinueve líneas, no una

Los **10 conteos** del aparato son de **Tienda**; **ninguno del almacén**, así que el aviso operativo
del §4.3 **no se ha violado** todavía.

De las **73 líneas contadas y aprobadas**, **19 (el 26 %) no dejaron la existencia en lo que el
vendedor contó**, con **113 unidades** de desviación acumulada, repartidas en **6 de los 7 conteos
aprobados**. El §2 solo citaba Galletas de soda:

```
Galletas de soda      conto 7,  escribio -41 sobre libro  -3  -> quedo -44   (desvio -51)
Peter cowtales        conto 18, escribio  -1 sobre libro   0  -> quedo  -1   (desvio -19)
Malta Guajira grande  conto 8,  escribio  -5 sobre libro   1  -> quedo  -4   (desvio -12)
Burger                conto 44, escribio  -9 sobre libro  61  -> quedo  52   (desvio  +8)
Toallitas humedas 20u conto 7,  escribio   2 sobre libro   0  -> quedo   2   (desvio  -5)
```

Parte de la desviación es de **una o dos unidades** y tiene una causa inocente: el `systemStock` se
congela al **crear** el conteo y el mando aprueba **después**, así que las ventas del intervalo ya
no estaban en la foto. Da igual el tamaño — **el conteo no dejaba la existencia en lo contado**, que
es justo lo único que se le pide.

**F3 lo cierra por construcción**, verificado en el código y no supuesto: `countsRepo.approve`
calcula `delta = físico − stockFromLedger(producto, ubicación)` en el momento de aprobar, con lo que
la existencia resultante **es** el físico contado. `submit` usa la misma fuente, así que el número
que el mando revisa es el mismo contra el que se calcula el asiento.

### 7.5 F4: dos de las diez deudas internas sacaron lo que no había

| Fecha | Producto | Sacó | Había |
|---|---|---|---|
| 09-09 22:27 | Refresco Limón | 5 | **0** |
| 09-09 02:17 | Hamburguesa | 12 | **0** |

La primera **es la causa completa** del `−5` que el producto arrastra hoy: su único movimiento en
Tienda es esa deuda. La segunda quedó tapada por 326 unidades que entraron después (hoy está en
+240), pero el negativo existió. Las otras ocho tenían existencia de sobra.

**No era un riesgo teórico: pasó dos veces de diez.** F4 (`4eb3cb6`) lo rechaza.

### 7.6 Los dos aparatos no están averiados: van con latencia

El respaldo del vendedor es un **superconjunto estricto** del del dueño: 8 movimientos, 3 ventas,
2 traspasos y 1 turno que el dueño no tiene, **todos entre las 15:59 y las 16:37** del 12-09 — y el
respaldo del dueño se exportó a las **16:20**, veinte minutos antes que el otro. **Cero registros
exclusivos del dueño.** No hay pérdida de datos entre aparatos: hay retraso de sincronización, que
es lo esperado.

### 7.7 Estado técnico de la rama, verificado hoy

- `npm run build` → **exit 0**.
- **14 suites node / 834 aserciones, 0 fallos** (`stockLocation.test.mjs`: 60).
- **F1, F2, F3 y F4 están los cuatro hechos y commiteados** en `claude/awesome-dirac-484azm`
  (`add6000`, `e2c805d`, `848db06`, `743e66d`, `4eb3cb6`), más `0c55964` de H5.
- **Ninguna copia del respaldo obsoleto queda en `src/`**: los 12 ficheros que lo tenían importan
  hoy `stockAtLocation`, y las lecturas restantes de `stockByLocation` son todas de la forma segura
  `?.[loc] || 0`.
- **Corrección de una imprecisión propia:** el comentario de `lib/stockLocation.js` decía "doce
  sitios, once con respaldo". Recontado contra `origin/main` fichero por fichero, son **trece
  sitios y doce con respaldo** — la tabla del §2 siempre estuvo bien. Ya está corregido en el
  código.

### 7.8 Lo que esta validación NO dice

- **Nadie ha ejecutado la app.** Ni un conteo aprobado, ni una deuda rechazada, ni una fusión entre
  dos aparatos. Sigue siendo lectura de código + aritmética sobre los respaldos + build + suites.
- **Las cifras son del 12-09-2026.** Los teléfonos han seguido operando: negativos, conteos y deudas
  pueden haber cambiado desde entonces.
- **No valida la migración ni la sincronización**: un respaldo es una foto de las tablas, no el
  comportamiento de IndexedDB ni de Firestore en el teléfono.
- **Sigue sin explicarse** por qué se vendieron unidades en negativo (Chicle de menta, Chupa
  chiquito): con el código de hoy `salesRepo` las habría rechazado, y el build que corría entonces
  fue sobrescrito.

---

## 8. Lo que F3 NO cubre — el ajuste del conteo es un DELTA (22-09-2026)

**F3 está bien y no se toca.** Esta sección no lo corrige: acota **hasta dónde llega**, porque el
22-09-2026 apareció un negativo nuevo en un negocio real (*Burger Premium*) que **F3 no podía
evitar**, y conviene que quede escrito antes de que alguien dé por cerrado el asunto de los negativos.

**Qué hace F3.** `countsRepo.approve` deriva el sistema del **libro mayor** en vez de la caché:

```js
const sysNow = await stockFromLedger(it.productId, loc)
const delta  = round2(Number(it.physicalQty) - sysNow)
```

Eso arregla el caso del §7.4 —la caché mentía y el conteo clavaba un ajuste equivocado— **dentro de un
aparato**. El problema es la segunda línea: **lo que se escribe en el libro es un `delta`, no un
objetivo**, y un delta solo es correcto en el dispositivo que lo calculó.

**El caso medido.** Dos instancias del mismo negocio cuyos libros diferían en 1 unidad de
`Batido de maní B` en el área *Salones*, porque a una nunca le llegaron los 7 movimientos de una
producción (fallo de transporte; ver `docs/AUDITORIA-BURGER-PREMIUM-21-09-2026.md` §9.5 y §9.6). El
conteo se aprobó en la instancia **completa**:

| | libro antes | ajuste escrito | libro después |
|---|---|---|---|
| Instancia que contó | **3** | **−3** | **0** ✅ |
| La otra | **2** | **−3** (el mismo asiento, por sync) | **−1** ❌ |

Comprobado con control negativo por partida doble: reinyectando solo el `+1` que falta, el saldo cuadra
en 0; y si el asiento hubiera sido un **objetivo absoluto**, las **dos** instancias habrían quedado en
0. La batería está en `docs/auditoria/bateria-burger-premium.mjs` (H4, aserciones 29–37).

**La consecuencia que hay que tener presente:** el conteo físico —que es **la herramienta de corrección
de existencias**, la que recomienda el §4 de este documento— **propaga el error de una instancia a la
otra** cuando los libros no son iguales. Y el remedio intuitivo empeora las cosas:

> **🛑 Contar otra vez el producto en el aparato que muestra el negativo escribiría un delta en sentido
> contrario que viajaría al otro y lo rompería a él.** El error **cambia de aparato**, no desaparece.
> Primero hay que **igualar los libros**; contar después.

**Qué NO se va a hacer, y por qué.** Convertir los ajustes en objetivos absolutos arreglaría esto de
raíz, pero cambiaría **cómo se deriva el stock del libro mayor**, que es el invariante del que cuelga
toda la app (ventas, traspasos, cocina, reportes, `recomputeStock`). **No es proporcional.** Esto no es
un defecto propio del conteo: es un **síntoma del transporte**, y se cierra arreglando aquél. El plan
aprobado está en el **§10** del acta de Burger Premium.

**Mientras tanto, regla operativa:** **contar siempre desde el mismo aparato**, y comprobar antes que
los aparatos están al día. El aviso *«Existencia en negativo»* del centro de notificaciones **ya existe
y funcionó** (saltó el 22-09 a las 19:48): es la señal de que esto ha vuelto a pasar.
