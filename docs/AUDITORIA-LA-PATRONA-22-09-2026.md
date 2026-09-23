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

**44/44 aserciones en verde**, con tres controles negativos y un control positivo dentro (un detector que no detecta nada
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
todos accidentales, y **solo uno de los tres deja residuo**: el par de *HERRAJE PALANCA (3000)*
(entrada el 20-08, merma el 21-08) **se netea a cero** en el área. El que queda produjo el **único
negativo del catálogo**:

```
Flotante ½    25-08 19:36:13   +1 purchase_in   loc=Ferretería   (Glenni, vendedor)
Flotante ½    25-08 19:36:24   -1 sale_out      loc=__almacen    (Glenni, 11,43 s después)
```

> **Corrección a la primera versión de este acta:** decía *«27 segundos después»*. Son **11,43 s**,
> medidos sobre las marcas exactas (aserción 43). El hecho no cambia; la cifra sí, y una cifra
> inventada en un acta es exactamente lo que no puede pasar.

El vendedor tiene **`sellerEntries`** (entra mercancía a **su área**) y a la vez
**`sellerWarehouseSale`** (vende del **almacén central**). La entrada fue al área y la venta salió del
almacén: **−1 en el almacén y +1 fantasma en un área que ningún conteo cuenta**. Con 1 unidad viva hoy
es anecdótico; como mecanismo, no lo es.

## 10. Lo que NO se puede garantizar

Esto es lo que esta auditoría **no** puede afirmar, y ninguna de las cinco es menor:

1. **No se sabe si la rotura fue de subida o de bajada.** ~~Con un solo respaldo no se distingue si
   el dispositivo de Claudia nunca los subió o si el de Lisett no los bajó.~~ **Esto se estrechó en
   el §13:** los movimientos **no están perdidos** — existían en el libro contra el que se aprobó el
   conteo. Lo que sigue sin saberse es en qué tramo se quedaron (nunca subieron, o subieron y no
   bajaron). **El respaldo del otro dispositivo sigue haciendo falta**, ahora para elegir desde cuál
   se fuerza la resubida, no para saber si las filas existen.
2. ~~**No se sabe qué build está desplegado.**~~ **RESUELTO en el §13, y la pregunta era otra.** Las
   dos hipótesis **no** explicaban los datos igual de bien: la (a) era falsa de raíz, porque el
   `approve` **pre-F3 tampoco usaba la foto del conteo** — leía la caché en vivo. Ningún build de la
   app calculó nunca el delta contra `it.systemStock`. Con eso, la versión del teléfono deja de
   importar para este caso.
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

---

## 13. Cierre del diagnóstico (segunda sesión, 22-09-2026)

Esta sección se añade **después** de la primera versión del acta y **cierra dos de sus cinco
incógnitas**. Sigue sin tocarse una línea de `src/`. Todo lo de aquí sale de las aserciones **32 a
39** de la batería, que se ejecutan sobre el mismo respaldo (SHA verificado antes de correrlas).

### 13.1 La pregunta: ¿contra qué libro se escribió el ajuste de −3?

El §5 dejó el hecho: el conteo guardó `systemStock = 18` para *Goma de uñas*, el libro de **esta**
base daba **19**, y el ajuste escrito fue **−3** (= 15 − 18). El acta ofrecía dos explicaciones y
decía que las dos encajaban «igual de bien». **No era cierto**, y se vio mirando el código de
entonces en vez de razonar sobre él.

### 13.2 La hipótesis (a) era falsa de raíz

Decía: *el build es anterior a F3 y `approve` calculó el delta contra la foto del conteo*. Se fue a
buscar ese código a la historia (`git show 743e66d~1:src/repositories/countsRepo.js`, el commit
anterior a F3) y lo que hay es:

```js
const delta = round2(Number(it.physicalQty) - stockAtLocation(p, loc))
```

**El `approve` pre-F3 no leía la foto del conteo: leía la caché EN VIVO del aparato que aprueba.**
Ningún build de esta app calculó nunca el delta contra `it.systemStock`. La hipótesis (a) no era
una alternativa peor: **no existía**. Y con ella se cae la pregunta *«¿qué versión corre cada
teléfono?»*, que para este caso resulta ser irrelevante.

*(La aserción 33 estuvo un rato **en verde mirando el fichero equivocado**: en Windows `execSync`
lanza por `cmd.exe`, donde `^` es el carácter de escape, así que `743e66d^` se resolvía al **propio**
commit. Se descubrió porque la aserción **falló**, no por releerla. Va anotado en el código.)*

### 13.3 Quedaba una salida, y la cierra la aritmética

Si el `approve` pre-F3 lee la caché, cabía que **la caché de este aparato valiera 18 aunque su libro
diera 19**. No hace falta suponer: `stockRepo.record` **incrementa** la caché dentro de la misma
transacción (`byLoc[loc] = byLoc[loc] + delta`), **no la recalcula**. Hoy la caché de *Goma de uñas*
vale **16** y el ajuste es **el último movimiento** del producto. Luego, si el ajuste se hubiera
escrito aquí, la caché previa era **16 + 3 = 19**. Y con 19, **los dos builds escriben −4**.

| | libro AQUÍ antes | físico | delta que ESTE aparato habría escrito | delta realmente escrito |
|---|---|---|---|---|
| Goma de uñas | 19 | 15 | **−4** | **−3** ❌ |
| Disco corte chico 125 | 13 | 11 | −2 | −2 ✔ |

El segundo producto es el **control positivo**: es el otro ajuste del mismo conteo, no le falta
ninguna venta, y ahí sí coincide. O sea que no es un desajuste general del método: es **exactamente**
el producto al que le falta la venta.

### 13.4 Y el remache: 127 de 127

Para los **127** productos contados se comprobó que

```
libro_de_ESTA_base  −  unidades_de_las_ventas_ausentes  ==  systemStock_guardado_en_el_conteo
```

casa en **127/127**, sin una sola excepción. **Control negativo:** sin restar las unidades ausentes
casan **121** — los 6 que discrepan son justo los afectados. Sin ese control, «casan 127/127» podría
ser una comparación que siempre da verdadero.

### 13.5 Conclusión

**El conteo se envió y se aprobó contra un libro que SÍ tenía los ocho movimientos, y ese libro no
es el de este respaldo.** De donde:

1. **Los movimientos no están perdidos.** Existen —o existían el 22-09 a las 20:43— en otro
   dispositivo. Esto convierte el punto 2 del plan de Burger Premium (forzar la resubida de
   `stockMovements` poniendo `push:<colección>` hacia atrás) de «probablemente sirva» a **la
   reparación correcta**: hay filas que reenviar.
2. **El aparato que aprobó no es el que exportó este respaldo**, aunque el `approvedBy` diga
   *Lisett*. El usuario identifica a la persona, **no al dispositivo**. Merece la pena preguntarle
   al dueño desde qué teléfono se aprobó ese conteo: la respuesta dice **cuál** es el aparato que
   guarda las filas buenas.
3. **La sincronización entre los dos aparatos funcionaba en esa misma ventana**: las 8 ventas y sus
   8 movimientos de tesorería sí llegaron. Lo que falló fue **una sola colección**. Eso refuerza el
   mecanismo del §4 (cursor por colección) y descarta «se cayó internet».

### 13.6 §6 y §7 tienen UNA sola raíz, no dos

Comprobado en el código (aserciones 40 y 41): `getPending` filtra por `status`, así que
`CountReview` —la pantalla que ofrece *Aprobar* y *Rechazar*— **solo se monta con un conteo cuyo
estado LOCAL es `pending`**. Por tanto el defecto del §6 **no** es «se puede rechazar un conteo ya
aprobado en el mismo aparato»: es que **la copia local va desfasada**. Y el candado que sí tiene
`approve` (`status !== PENDING → return`) mira **esa misma copia local**, así que tampoco impide la
doble aprobación del §7.

**Las dos cosas son el mismo defecto:** la máquina de estados del conteo se valida contra la copia
local y se resuelve por LWW de `updatedAt`, sin transacción ni candado compartido. Añadir el guard
que le falta a `reject` **cierra el caso de un solo aparato y nada más**; el cruzado necesita otra
cosa. Conviene saberlo antes de pedir «la línea que falta», porque esa línea no arregla lo que se
observó en el §6.

### 13.7 Lo que SIGUE sin poder garantizarse

Los puntos **3, 4 y 5** del §10 quedan **intactos**: el `errorLog` no viaja en el respaldo y hay que
mirarlo en `/errors` en cada aparato antes de que se pode; **nadie ha ejecutado la app**; y el
*mecanismo* concreto del §4 (commit colgado, caché desalojada) sigue siendo la explicación que mejor
encaja, no un hecho medido. Se añade una cautela nueva: todo el §13 se apoya en **un solo respaldo**
— lo que se demuestra es que **este** libro no pudo producir ese ajuste, y de ahí se **infiere** el
otro. **El respaldo del segundo dispositivo sigue siendo lo primero que hace falta.**

### 13.8 Validación de esta sesión (ejecutada, no citada)

- `node docs/auditoria/bateria-la-patrona-22-09-2026.mjs <respaldo>` → **44/44**, exit 0.
- SHA256 del respaldo **verificado** antes de correrla: coincide con el del §1.
- `npm run build` → **exit 0**. Peso del artefacto de ESTA corrida, leído de `dist/`: CSS
  **87.657 B (87,66 kB)** y chunk principal **1.002,35 kB** (gzip **291,95**) — idéntico a lo que
  declaraba el acta de la fusión del 19-09, que es lo que debe pasar: no se tocó `src/`.
- Las **16 suites** node → **1.191 aserciones, 0 fallos**.
- `git diff` contra `src/`: **vacío**. Lo único que cambia en el repo es este acta y la batería.

---

## 14. Segundo respaldo (B), 23-09-2026 — lo que confirma y lo que abre

**Material.** `respaldo_mypicuadre_2026-09-22ventas.json` y `…22lise.json` son **el mismo
fichero**: SHA256 `3e1fa72277436187…`, exportado `2026-09-22T23:56:50.709Z` por Lisett, 1.718
movimientos y 15 conteos. **No es** el del §1, que no está en la máquina donde se hizo esta
validación, así que todo lo de «A» sale de lo que dejó escrito esta acta.

### 14.1 Confirmado con dato

- **El §13.5 era cierto.** Las 8 ventas del §4 tienen aquí su movimiento de stock, con la hora
  exacta de la venta (`-1` en `__almacen`). Hay 0 ventas vivas sin movimiento en todo el respaldo.
- **El ajuste de −3 se calculó en B.** Libro de B antes del ajuste = 18 = `systemStock` del conteo
  `c4998016`; físico 15.
- **B es correcto en los 7 productos:** libro = caché = lo contado el 22-09 = la columna «debería»
  del §5. Hay 0 divergencias caché ↔ libro. La *Silicona barra* vendida es `83ec2739`: vale 0 en B
  y valía 1 en A.
- **A = B menos exactamente esos 8 movimientos:** 1.718 − 8 = 1.710.
- **Control positivo del diagnóstico H3-b, pendiente desde el 23-09:** sobre B da 0 roturas; sobre
  una copia en memoria de B sin los 8 movimientos da exactamente los 8 `sale-sin-mov`. Son datos
  derivados de B, no el respaldo A original.
- **Los 8 perdidos tienen la misma forma que sus 9 vecinos**: mismos campos y tipos, misma
  usuaria y mismo turno. El dato no explica la pérdida.

### 14.2 Nuevo: B tampoco está completo, y en colecciones MUTABLES

- **28 fichas de producto** tienen una versión más vieja que su último movimiento. Todas se
  quedaron en versiones anteriores al 15-09 a las 02:37.
- **3 cambios de precio de Lisett (16 y 17-09) no llegaron a la ficha**: LÁMPARA RECARGABLE (3.800
  en vez de 4.600), REGULADOR DE GAS (2.500 en vez de 3.000) y Disco corte 180 (1.000 en vez de
  1.200). Llegaron 39 de 42. `changePrice` escribe el cambio y la ficha en una sola transacción: es
  la firma del H3, pero en `products`.
- **Bajas:** con el criterio exacto del §8, B tiene 25 nombres repetidos (igual que A) pero **15**
  con dos fichas activas, frente a 6 en A.
- **Faltan 3 conteos** que A sí tiene, entre ellos `be3e2cf0` y `08172bc7`. Sus tandas de ajustes
  (07-08 y 12-08) sí están en B.
- **Hay al menos 3 aparatos.** Las ventas de LÁMPARA del 17 y el 19-09 se cobraron a 4.600, que B
  no tenía; no se hicieron en B.

### 14.3 Lo que NO se puede decidir con B

Si esas versiones **se perdieron al subir** en su aparato de origen o **no bajaron** a B.
- La bajada no tiene cursor: `initialPull` hace un `getDocs` completo cada 45 s y al arrancar.
- Pero `docs/SYNC-LECTURAS.md` midió la cuota de lecturas al 120 %: con la cuota agotada, un
  aparato deja de recibir sin ningún error visible.
- Dos defectos de la bajada leídos en el código, **sin probar que sean la causa**: el error de
  `onSnapshot` solo va a `console.warn` (`syncEngine.js:93`), y `handleIncoming` descarta el lote
  entero si falla la fusión (`:60-66`).
- Se decide leyendo Firestore (unos 9 documentos) o con los respaldos de los otros aparatos.

### 14.4 Lo programado a raíz de esto (23-09-2026), fuera de la app

- **`src/lib/convergence.js`** (puro), con su suite (15 aserciones y dos controles negativos).
  Marca `ficha-atrasada` (ficha más vieja que su último movimiento) y `precio-no-recibido` (último
  cambio de precio más nuevo que la ficha, con precio distinto). Se apoya en dos invariantes
  **verificadas en el código**:
  - los doce escritores del libro mayor sellan el producto con el mismo `ts`, y el traspaso de
    turno trae fichas y movimientos juntos;
  - `changePrice` sella la ficha después del cambio.
- **El CLI `diagnostico-atomicidad.mjs`** lo imprime como sección aparte, sin sumarlo a las
  roturas. Resultados:
  - **Sobre B:** 28 fichas atrasadas y 3 precios no recibidos, las mismas cifras medidas a mano.
  - **Sobre los dos aparatos de *De todo un tin* (12-09):** el del vendedor da 21 fichas
    atrasadas, y el del dueño confirma las **21 de 21**. En esas 21, precio, nombre y baja
    coinciden entre los dos, así que **«ficha atrasada» no implica daño visible**; el daño lo
    marca «precio no recibido».
- **La batería de esta acta comprueba el SHA** al empezar. Con otro fichero dice que sus
  aserciones no aplican, remite al diagnóstico y sale con 2. Antes reventaba con un `TypeError`.
  Con el SHA coincidente recorre el camino de siempre; se probó sustituyendo el SHA, porque **el
  respaldo original no estaba disponible para correrla entera**.
- **Ninguna pantalla importa el módulo.** El build sale con el mismo nombre con hash
  (`index-CXNzsm0w.js`, bundle idéntico) y `dist/` no lo menciona. 21 suites / 1.324 aserciones.

**Observación sin tocar:** `handoffService.js:190` hace `bulkPut` de productos sin LWW, como
`applyBackup`. Puede reescribir una ficha nueva con una vieja.

### 14.5 Con los DOS respaldos (A = `68307298…`, B = `3e1fa722…`), 23-09-2026

**La batería de esta acta, sobre su respaldo real: 44/44, exit 0**, ya con la guarda del SHA. Así
queda validado sobre el fichero de verdad que la guarda no altera su rama.

**Comparación id por id** (con `syncTs` de `collections.js`, el mismo criterio que la bajada):

| Colección | Diferencia | Sentido que falló |
|---|---|---|
| `stockMovements` | 8 solo en B | B → A |
| `products` | 36 con versión más nueva en A, 0 al revés | A → B |
| `auditEvents` | 5 solo en A (bajas del 22-09 a las 22:16) | A → B |
| `counts` | 3 solo en A (`be3e2cf0`, `08172bc7`, `6760a5ed`, rechazados) | A → B |
| `config` | `inheritedOpeningCash`, más nueva en B | — |
| todas las demás | **idénticas** (ventas, tesorería, `priceChanges`, compras…) | — |

**La firma es por COLECCIÓN, en los dos sentidos:**
- De cada una de las 8 ventas de B, A recibió la venta, su movimiento de tesorería **y la ficha
  del producto con el `updatedAt` exacto de la venta**; solo le faltó el movimiento de stock.
- De las transacciones de A, B recibió `priceChanges` (`changePrice`), `auditEvents` (las bajas
  del 19-09, que `remove` escribe junto a la ficha) y `purchases`; no recibió la ficha.
- Las 36 fichas de A que no llegaron a B van del 09-09 al 22-09 22:30. Llevan **3 precios y 3
  costos** distintos (LÁMPARA, REGULADOR DE GAS, Disco corte 180, Salida tanque ¾) y **12 bajas**
  que B no tiene. El resto es solo la marca y la caché de stock.

**Inferencia (no medición): la pérdida es de SUBIDA.**
- La bajada no tiene cursor, y el receptor recibía esa misma colección en esos días: A recibió los
  ajustes de B de las 20:43 por `stockMovements`, y B recibió `priceChanges` y `auditEvents`.
- En los dos casos el emisor tiene el cursor por encima de las filas y las colas vacías.
- **Descartado un documento envenenado:** `toCloud` es un `JSON.parse(JSON.stringify())`, ningún
  producto de A tiene undefined, NaN ni arrays anidados, y el mayor pesa 477 bytes.
- El mecanismo exacto sigue sin determinarse. Lo cierra leer en Firestore dos documentos: la ficha
  `8c8b4fe9` y el movimiento `d6f06edc`.

**Reparación que dicta el dato:**
- **B → A:** los 8 movimientos, con el reenvío H3-a desde B (inmutables; programado y sin
  desplegar).
- **A → B:** 36 fichas (mutables), 5 eventos y 3 conteos. **H3-a no lo cubre**, a propósito:
  reenviar una colección mutable a ciegas puede pisar una versión más nueva en la nube.

### 14.6 Registro de la sincronización en `/errors` (23-09-2026, programado a raíz de §14.5)

**Por qué.** Los fallos de la sync solo iban a `console.warn`, que en el teléfono no ve nadie y se
pierde al cerrar. Por eso §13 y §14 tuvieron que **inferir** el mecanismo. Ahora quedan en el
registro local del aparato (`/errors`, origen «Sincronización»), que el dueño puede compartir.

**Qué se registra** (commits `5725278`, `9dc9742` y `699ec2a` más su revisión):
- **Subida:** lote rechazado, reintento fallido (solo el transitorio; el permanente ya lo registraba
  `logSync`) y fallo de la cola de reintentos.
- **Bajada:** oyente `onSnapshot` caído, fusión descartada (`handleIncoming`), bajada periódica
  fallida y **«el servidor no respondió, se leyó de la caché»**, la huella de la cuota agotada.
- **Sesión:** token no renovado, recuperación fallida y registro del aparato fallido.
- **El vigilante de lotes, el único cambio dentro de `doPush`:**
  - `subida-sin-confirmar`: lotes que llevan 120 s sin confirmarse **estando en línea**;
  - `subida-confirmada-tarde`: esos mismos lotes cuando por fin se confirman o fallan.
  - Cada etapa deja **un solo aviso por ronda**, con todas las colecciones atascadas, sus filas y
    el rango de marcas; si no caben, dice «(+N más)».
  - Sin red no avisa, pero **se rearma** (hasta 30 veces, una hora), y tras reconectar da una
    ventana más antes de avisar.

**Límites del presupuesto (decisión del dueño: 30 por sesión, aparte de los 25 de `logError`).**
- Una entrada por etapa + colección + código, con tope de 5 por etapa.
- 2 de las 30 quedan reservadas para el vigilante, para que las demás etapas no se las coman.

**Cómo leerlo, y lo que NO dice:**
- **«Sesión» es la carga de la página.** Una PWA abierta varios días solo registra la **primera**
  vez de cada fallo. Una sola entrada no significa que pasara una sola vez.
- **`subida-sin-confirmar` puede dar falsos positivos:** `navigator.onLine` solo dice que hay
  interfaz de red (un wifi sin salida cuenta como «en línea»), y una cola grande tras horas sin red
  puede tardar más de 120 s de forma legítima. Por eso existe `subida-confirmada-tarde`: **un aviso
  «sin confirmar» sin su «confirmada tarde» es la señal que interesa.**
- **Los temporizadores viven en memoria.** Si la app se cierra antes de que venzan, ese lote no
  deja rastro. Y Android puede retrasarlos con la app en segundo plano.
- **No arregla nada:** solo hace visible. El arreglo es H3-c.

**Garantías verificadas, y cómo:**
- **`doPush`:** frente a `origin/main` difiere solo en `batch.commit()` →
  `watchCommit(col.name, slice, batch.commit())`, verificado con `diff`. `watchCommit` devuelve
  **la misma promesa** (`===`), lleva su ramal aparte con su propio manejo de rechazo y no puede
  lanzar.
- **El resto de la sync:** `pushChanges` tiene el mismo md5. `pullEngine`, `collections`,
  `retryQueue`, `db`, reglas y `package.json` no cambian. `errorLog` es local: no está en
  `SYNC_COLLECTIONS` y el respaldo lo excluye.
- **Tres revisiones independientes:** una por commit y otra de la corrección, todas **sin
  críticos**.
  - La del commit 1 detectó una entrada doble, un `throw` posible y que una etapa podía comerse
    el presupuesto.
  - La del commit 2 detectó que el tope por etapa escondía `stockMovements`, `purchases`,
    `transfers` y `productions`, y que un lote vencido sin red no se volvía a vigilar.
  - Todo corregido, con controles negativos.
- **Una prueba no medía nada y se corrigió.** La de la ventana de gracia miraba antes del volcado
  del agregado; se detectó porque su control negativo **no falló**.
- **Pruebas:** build exit 0; 24 suites / 1.400 aserciones. Chunk 1.008,34 → 1.011,57 kB (gzip
  294,04 → 295,37).
- **Nadie lo ha ejecutado en un dispositivo.**

**Uso operativo.** Tras desplegar, pedir a cada aparato de un negocio con síntomas que comparta
`/errors` **antes** de cualquier reparación. Si aparece `subida-sin-confirmar` sin su «confirmada
tarde» para `stockMovements` o `products`, eso confirma la hipótesis del §14.5 **con dato**, no por
inferencia.

### 14.7 Reenvío que compara antes de escribir (23-09-2026, en la rama, sin fusionar)

Es la reparación de A hacia B que el reenvío H3-a no podía hacer. La especificación y el plan están
en `docs/superpowers/`.

- **La regla:** una `runTransaction` por documento lee del **servidor** y solo escribe si la nube no
  lo tiene o lo local es estrictamente más nuevo por `syncTs`.
- **El alcance:** `products`, `counts` y `auditEvents`.
- **La arquitectura:** ficheros nuevos; `pushEngine.js` sin tocar.

**Validado con los dos respaldos, sin tocar la nube:**
- **A local → B nube:** `products` 36 escritos, 164 iguales y 0 «nube más nueva»; `counts` 3; `auditEvents` 5.
- **B local → A nube:** 0 escritos, y 36 «nube más nueva» en `products`.
- **Con el código real de la bajada** (`mergeIncoming` + `recomputeStock` sobre B en
  `fake-indexeddb`): las 36 fichas llegan con el precio y la baja de A, y su stock queda **igual al
  libro de B** (0 diferencias).
- **La revisión final comparó campo a campo lo que se escribe:** las 36 difieren en marca, 13 en
  baja, 4 en categoría y 3 en precio y costo. Los precios son **cambios del propio A**, según
  `priceChanges`. La caché de stock no difiere en ninguna.

**La revisión final independiente, sin críticos, dejó un hallazgo importante y ya corregido.** El
panel prometía «lanzarlo en el aparato equivocado no estropea nada», y la garantía es **por marca,
no por contenido**. En `products` cada venta sube `updatedAt` y reescribe la ficha entera, así que un
aparato que vendió sin haber recibido un cambio de precio repondría el precio viejo. El panel, el
código y la especificación ahora lo dicen.

**Menores corregidos:**
- «Reparar» se deshabilita con más de 1.000 documentos;
- `deadline-exceeded` corta la tanda, con TDD y control negativo;
- el coste se muestra como mínimo, no como máximo;
- `/errors` guarda solo el primero de cada tipo.

**Uso para La Patrona, cuando se despliegue:**
1. En **B**, «Reenviar a la nube» de `stockMovements` desde el 22-09 a las 13:30, hora de Cuba.
2. En **A**, «Reparar versiones» de `products`, `counts` y `auditEvents` desde una fecha anterior al
   09-09.
3. Comprobar con el diagnóstico sobre respaldos nuevos de los dos aparatos.
4. **Solo después**, contar.

El orden de 1 y 2 es indiferente, porque cada aparato recalcula el stock desde su libro.

**Lo que no se puede garantizar:** no se ha ejecutado contra la Firestore real ni en un teléfono, y
el coste real en lecturas de los aparatos que reciben no está medido.

