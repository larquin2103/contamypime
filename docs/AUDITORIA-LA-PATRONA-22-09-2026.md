# Auditoría — «La Patrona» (ferretería), respaldo del 22-09-2026

Encargo del dueño: *«este es el respaldo de otro negocio reportando incoherencias en el conteo
físico; valida si en este hay las mismas causas o alguna nueva. No asumas nada.»*

**Cero código tocado en `src/`.** Lo único que se añade al repositorio es la batería de validación
`docs/auditoria/bateria-la-patrona-22-09-2026.mjs`, que **no entra en el build** (lee `src/` como
texto, no escribe nada, no abre la base de datos).

## 1. Material y método

| | |
|---|---|
| Fichero | `respaldo_mypicuadre_2026-09-22.json` |
| SHA256 | `683072985d0176507b8604b43f30cca167f5c428a293ee9f6c46c9986526abf5` |
| Exportado | `2026-09-22T22:39:15.566Z` (**UTC**, no hora local) por **Lisett** (dueña) |
| Esquema | Dexie **19** |
| Volumen | 1.710 movimientos de stock · 1.196 ventas · 336 compras · 200 productos · 18 conteos · 101 turnos · 5 usuarios |
| Módulos | `areas: ["Ferretería"]`, `sellerEntries`, `sellerSelfAuthorize`, `sellerWarehouseSale` activos. **Sin** `mesas`, `cocina`, `remesas`, `cuentas` de terceros, `fichas` |

Todo se **derivó del libro mayor**, nunca de la caché. Reproducible:

```bash
node docs/auditoria/bateria-la-patrona-22-09-2026.mjs <respaldo.json>
```

**31/31 aserciones en verde**, con dos controles negativos dentro (un detector que no detecta nada
pasaría en silencio; sin ellos la batería no mediría nada).

**Un solo respaldo.** La auditoría de Burger Premium tuvo tres y pudo comparar instancias. Aquí no:
todo lo que se diga sobre «el otro dispositivo» es **inferencia a partir de la foto que el conteo
dejó guardada**, no medición. Está marcado como tal en cada sitio.

## 2. Veredicto

**La causa principal es la MISMA que la de Burger Premium (H3), y aquí la evidencia es más limpia
que allí.** No es la causa de *De todo un tin* (F1): esa se descartó midiendo.

Y aparecen **cuatro cosas nuevas**, una de ellas un defecto de código que sigue vivo.

## 3. Mapa contra los hallazgos conocidos

| Hallazgo | ¿Está aquí? | Prueba |
|---|---|---|
| **H1** — `voidOrder` sin candado de venta | **NO aplica** | 0 `orders` / 0 `orderItems`: el negocio no tiene `mesas` |
| **H2** — el cobro de mesa no es atómico | **NO aplica** | ídem |
| **H3** — el transporte parte transacciones atómicas | **SÍ, confirmado** | §4 |
| **H4** — el ajuste del conteo es un delta | **SÍ, como consecuencia de H3** | §5 |
| **F1** — el respaldo v5 de `stockAtLocation` | **NO está** | Un solo producto sin `stockByLocation`: `CODO ¾ 150`, **inactivo, en 0 y sin ningún movimiento**. `startDraft` filtra por `p.active`, así que ni entra al conteo |
| Caché mentirosa | **NO** | **0 divergencias** caché ↔ libro mayor en los 200 productos, con control negativo |

## 4. H3 — ocho ventas llegaron sin su movimiento de stock

**El hecho.** El 22-09, en el turno de Claudia (14:06–20:03), **8 ventas no anuladas están en la base
sin un solo movimiento en el libro mayor**. Son 8 unidades de 7 productos, por 4.950 MN.

```
17:36:36  e1945127   SI   3xBridas
17:36:51  2fb56c08   NO   1xGoma de uñas      <<<
18:02:01  91613308   NO   1xPLASTILOKA        <<<
18:02:15  692b117e   NO   1xCUCHILLA HOJA     <<<
18:15:26  a66735a7   NO   1xUnion 1           <<<
18:15:36  b9acc241   NO   1xCODO 1            <<<
18:28:34  46cbb653   NO   1xTeipe             <<<
18:47:31  fa7b8445   NO   1xTeipe             <<<
18:47:40  e8daf23e   NO   1xSilicona barra    <<<
19:13:02  ddb1dfb2   SI   1xLLAVE PASO ½ METAL
```

**Por qué no puede ser otra cosa.** Se descartaron una a una las explicaciones alternativas, por
código y por dato — no por razonamiento:

1. **No nacieron separadas.** `salesRepo.create` escribe la venta y su movimiento en **una sola
   transacción Dexie** (`db.transaction('rw', db.sales, db.stockMovements, db.products, …)`), y en
   todo el repo hay **una única** `db.stockMovements.add(`, dentro de `if (!skipStock)`.
2. **No son ventas de mesa.** `skipStock` solo lo usa el módulo `mesas`: hay **0 `orders`** y las 8
   llevan `orderId: null`.
3. **Nadie las borró.** Cero `.delete/.clear/.bulkDelete` sobre `stockMovements` o `sales` en todo
   `src/`. `applyBackup` solo hace `bulkPut`.
4. **No las recortó el respaldo.** `buildBackup` vuelca `table.toArray()` de cada tabla sin límite ni
   paginación: **ausente en el JSON = ausente en el dispositivo**.
5. **No vinieron de un JSON de turno.** El traspaso v2 lleva `sales` **y** `stockMovements` juntas
   (las dos con `toArray()`): no puede traer una sin la otra.
6. **No son de otro build.** Las 8 tienen **exactamente los mismos 35 campos** que las 1.188
   normales, y sus líneas los mismos 8.

**Y lo que hace este caso más nítido que el de Burger Premium:** `salesRepo.create` escribe en esa
misma transacción también el `accountMovement` del cobro. **Las 8 ventas SÍ tienen su movimiento de
tesorería.** O sea: de una misma transacción llegaron dos colecciones y **faltó la tercera, entera,
en una ventana contigua de 71 minutos**, con ventas normales antes (17:36:36) y después (19:13:02).

La rotura es **por colección**, no por registro suelto. Eso apunta al cursor de subida por colección
(`push:<colección>`), que es el **Hallazgo 5** ya documentado desde el 28-08.

**Lo que el código dice del mecanismo** (`pushEngine.js`): el lote se lanza con
`batch.commit().then(...).catch(...)` **sin `await`**, y acto seguido se ejecuta
`await setCursorForward(col.name, maxTs)`. El cursor avanza **antes** de que el servidor confirme. Las
dos redes de seguridad previstas no cubren un caso: si el `commit()` **ni se resuelve ni se rechaza**
(queda pendiente en la caché de Firestore) y esa caché se pierde —desinstalación, limpieza de datos
del navegador, desalojo de almacenamiento—, entonces **nunca hay `catch`**, la fila **no entra en la
cola de reintentos**, y queda **por debajo del cursor para siempre**.

Los datos son **compatibles** con ese mecanismo y lo respaldan, pero **no lo demuestran**:

- las **34 colas `retry:*` están vacías**: el motor no cree tener nada pendiente;
- `push:stockMovements` = `2026-09-22T20:43:29.169Z` = **exactamente el máximo local**: este
  dispositivo cree haber subido todo;
- hay **0 movimientos de venta sin su venta**: la pérdida va en **un solo sentido**.

## 5. H4 — así es como eso se convierte en «el conteo no cuadra»

Esto es lo que el dueño está viendo. El conteo `c4998016` (Claudia contó a las 20:32, Lisett aprobó a
las 20:43) tocó **6 de los 7 productos afectados**:

| Producto | faltan | sys. del conteo | libro AQUÍ | físico | diff | ajuste | queda | debería |
|---|---|---|---|---|---|---|---|---|
| Goma de uñas | 1 | 18 | **19** | 15 | −3 | −3 | **16** | 15 |
| Teipe | 2 | 3 | **5** | 3 | **0** | — | **5** | 3 |
| CUCHILLA HOJA | 1 | 9 | **10** | 9 | **0** | — | **10** | 9 |
| PLASTILOKA | 1 | 3 | **4** | 3 | **0** | — | **4** | 3 |
| Union 1 | 1 | 2 | **3** | 2 | **0** | — | **3** | 2 |
| CODO 1 | 1 | 4 | **5** | 4 | **0** | — | **5** | 4 |
| Silicona barra | 1 | *no entró en la lista* | 1 | — | — | — | 1 | — |

Dos cosas, y la segunda es la peor:

1. **En «Goma de uñas» el ajuste cuadró en el otro dispositivo y descuadró en este.** El delta escrito
   fue −3 (= 15 − 18), pero el libro de esta base daba **19**, así que el saldo quedó en **16** cuando
   se contaron **15**. Es H4 exacto: el ajuste es un **delta**, no un objetivo absoluto, y por eso
   **propaga la diferencia entre instancias en vez de corregirla**.
2. **En los otros 5 el conteo dio `diff = 0` y no escribió nada.** El vendedor contó contra un libro
   que **sí** tenía sus ventas, le cuadró, y el error **pasó completamente inadvertido**. El conteo
   físico —que es justo la herramienta para detectar esto— **no lo detectó**, y encima dejó al dueño
   la impresión de que el inventario estaba bien.

**Control negativo:** reinyectando las 8 unidades ausentes, los 6 productos cuadran **exactamente**
con lo contado. No hay ninguna otra causa de descuadre en juego.

**Saldo:** el inventario de esta base está **inflado en 7 unidades sobre 6 productos** (la séptima es
Silicona barra, que no entró en la lista del conteo). **El dinero está bien**: las 8 ventas están
registradas y sus movimientos de tesorería también; lo que no cuadra es la mercancía.

## 6. NUEVO — dos conteos que se APROBARON figuran hoy como RECHAZADOS

Hay **dos tandas de ajustes por conteo físico que ningún conteo aprobado reclama**: 3 ajustes el
07-08 a las 21:20 y 5 el 12-08 a las 21:14. Los **8 casan producto Y cantidad** con las diferencias de
los conteos `be3e2cf0` y `08172bc7`, que hoy están marcados **`rejected`** con el motivo
*«Mala actualización»*, firmados el **01-09 a las 19:51–19:52**, semanas después.

O sea: **el stock se ajustó de verdad y de forma irreversible (append-only), y el historial dice que
el conteo se rechazó.** Quien audite hoy ese libro no puede explicar esos 8 asientos.

**La explicación encaja con un defecto ya corregido.** El commit `b7ad5ce` (**18-08-2026**) fue
precisamente *«Conteo físico: actualizar `updatedAt` en submit/approve/reject (fix de sync)»*. Los dos
conteos son del **07-08 y 12-08**, o sea **anteriores al fix**: en esas fechas `approve` escribía los
ajustes pero **no avanzaba `updatedAt`**, así que la aprobación **nunca se subía** (el cursor de push
lee `syncTs`, que no cambiaba) y en los demás dispositivos el conteo seguía **pendiente para siempre**.
El 01-09 se resolvieron los tres de golpe desde una base que aún los veía pendientes; ese rechazo sí
llevaba marca nueva, ganó el LWW y se propagó.

**Pero queda un defecto VIVO**, y este no es histórico: `countsRepo.approve` exige
`c.status !== COUNT_STATUS.PENDING → return`, y **`countsRepo.reject` NO comprueba el estado**. Un
conteo ya aprobado se puede rechazar. Es una línea.

## 7. NUEVO (riesgo, no observado) — nada impide aprobar el mismo conteo dos veces

Derivado de lo anterior y **verificado en el código, no observado en los datos**: `approve` solo
comprueba el estado **local**. Dos dispositivos que tengan el conteo en `pending` —porque uno estaba
sin internet— pueden aprobarlo **los dos**, y cada uno escribe su tanda de ajustes contra **su** libro.
Al fusionar se aplican **las dos**: doble descuento del inventario, append-only, irreversible.

**En este respaldo NO ha pasado**: las 10 tandas de ajustes corresponden a 10 conteos distintos, sin
repeticiones. Es un riesgo estructural, no un hecho. Se declara porque es la misma familia que lo de
§6 y porque el negocio tiene al menos dos dispositivos operando a la vez.

## 8. NUEVO — el catálogo está duplicado, y eso solo puede romper el conteo

**25 nombres repetidos** en el catálogo (ignorando tildes y mayúsculas, respetando ½ y ¾ como
productos distintos), y **6 de ellos con dos fichas ACTIVAS a la vez**:

| Nombre | Fichas activas y su existencia |
|---|---|
| Cuchilla hoja | `1ea6da64` = 59 · `9fefc038` = 10 |
| Bridas | `35f49305` = 97 · `fbafe092` = 13 |
| Silicona barra | `83ec2739` = 1 · `fa7fe388` = 6 |
| Caja breke 3 | `51034f51` = 1 · `f2d570a0` = 1 |
| Llave ángulo sencilla | `8348a778` = 1 · `d1d3dbda` = 1 |
| T ¾ | `e0438876` = 1 · `ece02218` = 5 |

El patrón es de **re-creación manual**: se da de baja la ficha vieja y se crea otra (cambia la
grafía — `GOMA DE UÑAS` → `Goma de uñas`), con semanas de diferencia. **No es un duplicado de
sincronización** (esos nacerían con el mismo nombre y a la misma hora).

**No es un fallo de código, pero el código no ayuda:** `ProductForm` valida que no se repita el
**código** (`El código "X" ya existe`) y **no dice nada del nombre**. Contando físicamente, el mismo
artículo aparece dos veces en la lista y las unidades se reparten a ojo entre las dos fichas: es una
fuente de incoherencia permanente, independiente de todo lo anterior.

## 9. NUEVO — mercancía en un área que ningún conteo mira

El negocio tiene `areas: ["Ferretería"]` pero **0 traspasos**: en la práctica todo vive en
`__almacen`, y **los 18 conteos son del almacén**. Aun así hay **3 movimientos en «Ferretería»**,
todos accidentales, y uno produjo el **único negativo del catálogo**:

```
Flotante ½    25-08 19:36   +1 purchase_in   loc=Ferretería   (Glenni, vendedor)
Flotante ½    25-08 19:36   -1 sale_out      loc=__almacen    (Glenni, 27 segundos después)
```

El vendedor tiene **`sellerEntries`** (entra mercancía a **su área**) y a la vez
**`sellerWarehouseSale`** (vende del **almacén central**). La entrada fue al área y la venta salió del
almacén: **−1 en el almacén y +1 fantasma en un área que ningún conteo cuenta**. Con 1 unidad viva hoy
es anecdótico; como mecanismo, no lo es.

## 10. Lo que NO se puede garantizar

Esto es lo que esta auditoría **no** puede afirmar, y ninguna de las cinco es menor:

1. **No se sabe de qué lado se perdieron los movimientos.** Con un solo respaldo no se distingue si
   el dispositivo de Claudia nunca los subió o si el de Lisett no los bajó. **Hace falta el respaldo
   del otro dispositivo**, y hace falta pronto.
2. **No se sabe qué build está desplegado.** Dos hipótesis explican los datos **igual de bien**: (a)
   el build es anterior a F3 y `approve` calculó el delta contra la foto del conteo; (b) el build
   tiene F3 y `approve` se ejecutó en el **otro** dispositivo, contra **su** libro. Para *Goma de
   uñas* y para *Teipe* las dos dan exactamente los números observados. **No se puede decidir sin
   saber qué versión corre cada teléfono.**
3. **El registro de errores no viaja en el respaldo.** `buildBackup` excluye `errorLog` a propósito, y
   es justo donde `pushEngine` deja constancia de los rechazos de subida. **Hay que mirarlo en
   `/errors` en cada dispositivo**: si hubo rechazo, ahí está; si no hay nada, refuerza la hipótesis
   del commit que quedó colgado.
4. **Nadie ha ejecutado la app.** Todo esto es lectura de datos y de código. Ni una pantalla abierta,
   ni un conteo hecho, ni una sincronización observada entre dos aparatos.
5. **El mecanismo exacto del §4 es hipótesis.** Lo demostrado es *qué* falta y que nació junto a lo
   que sí está. El *porqué* concreto (commit colgado, caché desalojada) es la explicación que mejor
   encaja con el código y con la forma del daño, no un hecho medido.

## 11. Qué haría falta para cerrar esto

Nada de esto se ha programado — la regla 4 manda preguntar antes:

1. **El respaldo del teléfono de Claudia**, cuanto antes. Es lo único que convierte el §4 de
   «compatible con» en «demostrado», y lo único que permite saber qué instancia tiene la verdad.
2. **Mirar `/errors` en los dos dispositivos** antes de que se poden (se guardan solo las 200 más
   recientes).
3. El punto **2 del plan de Burger Premium** (`push:<colección>` hacia atrás desde `/cloud`) **es
   exactamente lo que repara esto**: forzar la resubida de `stockMovements` del dispositivo que tiene
   las filas. Sigue **autorizado y sin programar**.
4. El punto **3** (diagnóstico de solo lectura) debería incluir **este chequeo**: venta con su
   movimiento de tesorería presente y su movimiento de stock ausente. Es barato y delata el caso
   entero.
5. Los dos defectos de esta acta (`reject` sin candado de estado, §6; `approve` sin idempotencia
   entre dispositivos, §7) tocan **lógica de producción** y necesitan **autorización explícita**.

## 12. Aviso operativo

**No volver a contar los 6 productos del §5 en el teléfono del dueño hasta igualar los libros.** El
ajuste del conteo es un **delta**: contar 15 donde el libro dice 16 escribiría un −1 que, al
sincronizarse, dejaría al otro dispositivo en **14**. Es el mismo mecanismo que ya rompió el otro
negocio. **Primero se igualan los libros, después se cuenta.**

Los seis: **Goma de uñas, Teipe, CUCHILLA HOJA, PLASTILOKA, Union 1, CODO 1.**
