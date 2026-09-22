# Auditoría operativa — *Burger Premium*, día 21-09-2026

**Estado: HALLAZGOS DOCUMENTADOS, CERO CÓDIGO ESCRITO.** Este documento existe para
retomar el trabajo mañana con el **segundo respaldo** en la mano y decidir entonces las
correcciones. Nada de lo que hay aquí está programado. Los tres hallazgos tocan **lógica de
producción**, así que chocan con la **regla 2** de `CLAUDE.md`: son **correcciones de defecto** y
necesitan **autorización explícita del dueño** antes de escribir una sola línea.

---

## 0. Alcance, método y lo que NO se hizo

**Qué se auditó.** Un único fichero de respaldo, fijado aquí para que mañana no haya dudas de
cuál fue:

| | |
|---|---|
| Fichero | `respaldo_mypicuadre_2026-09-22.json` |
| Tamaño | 1 303 782 bytes |
| `SHA256` | `4369af82003ebfb0c13b8896ac3e0df38ae2d2e8568eff2b99ab985921003ba1` |
| `meta.exportedAt` | `2026-09-22T01:53:47.006Z` |
| `meta.schema` | 19 |
| `meta.fromUserName` | `Abar` |
| Negocio | `config.licenseBusiness` = "Burger Premium" |

**Método.** Todo se **recalculó desde el libro mayor** (`stockMovements`), no se leyó de las
cachés, y cada afirmación se contrastó contra el **código real** de los repos del árbol de
trabajo. La re-validación final corre como una batería de **22 aserciones**: todas pasaron. Los
números de este documento salen de esa corrida única.

**Lo que NO se hizo, y hay que decirlo:**

- **No se ejecutó la app.** Ni una pantalla abierta, ni un cobro, ni una sincronización entre dos
  aparatos. Todo es el respaldo + lectura de código.
- **No se tocó ni una línea de código.**
- **No se pudo ver la nube.** No se sabe qué tiene Firestore.
- **Solo hay UN respaldo.** Falta el del otro aparato/instancia, que es exactamente el que
  convierte las hipótesis del §3 en certezas. Ver el **checklist del §7**.

---

## 1. La pregunta de los dispositivos

El dueño asegura haber hecho **todas las operaciones desde el mismo dispositivo**. Se investigó a
fondo. El resultado tiene dos partes que conviene no mezclar.

### 1.1 El respaldo NO puede identificar dispositivos. Comprobado.

- **Ningún registro de ninguna tabla lleva un campo de dispositivo.** Los campos de autoría
  (`userId`, `byUserId`, `createdBy`, `sellerId`, `closedBy`) identifican al **usuario**, no al
  aparato.
- `deviceId` **se elimina del respaldo a propósito** — `backupService.js:24-33`, `DEVICE_ONLY_KEYS`
  (junto a `syncEnabled`, `syncBusinessId`, `syncEmail`, `licenseToken`, `lastBackupAt`,
  `lastRestoreAt`).
- `errorLog` **no viaja en el respaldo en absoluto** (`backupService.js:39`), así que tampoco se
  pueden ver los errores de sincronización que hubiera registrado.

**Conclusión: la pregunta "¿cuántos teléfonos?" es INCONTESTABLE con este fichero.** Cualquier
respuesta numérica sería una suposición.

### 1.2 Lo que SÍ se puede probar: hubo al menos DOS instancias escribiendo a la vez

Esto no depende de ningún campo de dispositivo, sino del reloj. En la ventana **18:50 – 19:50**
del 21-09, dos usuarios distintos escribieron **intercalados**:

```
19:48:30.737  Dependiente   PRODUCCION Batido de chocolate B x3
19:48:46.118  Dependiente   PRODUCCION Batido de maní B x2
19:48:46.969  Abar          TRASPASO __almacen -> __cocina (1136 g Leche en polvo)   <-- 851 ms
19:48:54.661  Dependiente   PRODUCCION Batido de Limón B x1  (+ 9 movimientos)
19:48:59.196  Dependiente   PRODUCCION Batido fresa B x1     (+ 9 movimientos)
```

**Separación mínima medida entre una escritura de `Abar` y una de `Dependiente`: 851 ms.**

Y el solapamiento no es un instante aislado:

| | |
|---|---|
| `Abar` cierra su turno | 18:53:13 |
| `Dependiente` empieza a escribir | 18:56:04 |
| `Abar` **sigue** escribiendo hasta | **19:48:46** (55 min después de cerrar su turno) |
| Escrituras en la ventana 18:50–19:50 | `Abar` 22 · `Dependiente` 419 |

`Abar`, después de cerrar su turno, registró **4 compras** (19:03–19:04), **6 traspasos**
almacén→cocina (19:08–19:48) y **3 cambios de configuración** (`baseCurrency`, `semaphore`,
`licenseBusiness`, a las 19:18), mientras `Dependiente` atendía mesas sin parar.

**Por qué 851 ms descarta una sola instancia de la app:** la sesión vive en `sessionStorage` y hay
**un solo usuario a la vez**; cambiar de usuario exige salir y teclear un PIN. Eso no se hace en
851 ms, y menos volviendo a `Dependiente` 8 segundos después. En un mismo aparato y una misma
instancia, el reloj es **uno**, así que el intercalado sería real — y es imposible.

### 1.3 Cómo se concilia esto con lo que dice el dueño

**Las dos cosas pueden ser verdad a la vez, y probablemente lo son.** El dueño habla de **sus**
operaciones: es perfectamente coherente que él usara siempre el mismo aparato. La segunda
instancia es la que usó el **Dependiente**.

Y hay un matiz que conviene tener presente antes de dar nada por cerrado: **"el mismo dispositivo"
no equivale a "la misma base de datos".** Dos navegadores distintos en el mismo teléfono (Chrome y
Edge, por ejemplo) son **dos IndexedDB independientes** que sincronizan contra la misma nube. Para
quien lo usa es "el mismo teléfono"; para la app son dos instancias. **No se puede distinguir con
este respaldo.**

> **Lo que hay que preguntarle mañana, en estos términos:** no *"¿usaste un teléfono o dos?"*,
> sino *"¿desde qué aparato y qué navegador entró el Dependiente el 21-09 por la noche?"*.

---

## 2. Hechos validados del día (21-09-2026, día local Cuba UTC−4)

| Hecho | Valor |
|---|---|
| Turnos de **Salones** vivos a la vez el 21-09 16:45–18:53 | **2** |
| Turno `8aa167a5` · Dependiente · Salones | **abierto desde el 20-09 18:03, SIGUE ABIERTO** |
| Turno `600f287f` · Abar · Salones | 16:45:29 → 18:53:13 |
| Ventas del día | 13 · efectivo 157 120 · transferencias 4 550 · **total 161 670 MN** |
| Unidades elaboradas por el tablero → Salones | 144 (65 producciones) |
| Unidades traspasadas → Salones | 34 |
| Unidades vendidas netas en Salones | 159 |
| Devoluciones / salidas de mesa (toda la historia) | **208 / 368 = 56,5 %** |
| Divergencias caché `stockByLocation` vs libro mayor (210 claves) | **0** |
| Existencias negativas en el libro | **0** |
| `cashMovements` (extracciones de caja) en **toda** la historia | **0** |

---

## 3. LOS TRES HALLAZGOS

Van ordenados por la **cadena causal**, que es también el orden inverso al riesgo de arreglarlos:
el H1 es el que hizo el daño y el más barato; el H3 es la causa raíz y el más peligroso de tocar.

```
H3 (el transporte parte transacciones atómicas)
  └─> a la 2ª instancia no le llegan "línea anulada" ni "mesa cobrada"
       └─> Mesa 1 aparece OCUPADA 5 h después de haberse cobrado
            └─> alguien la anula (reacción correcta ante lo que ve en pantalla)
                 └─> H1 (voidOrder no comprueba si ya hay venta)
                      └─> devuelve 53 unidades al stock + 4 inventadas
                           └─> LWW borra el vínculo venta <-> mesa
                                └─> 48 u de comida fantasma en Salones

H2 (cobro de la mesa no atómico) --> produce el MISMO síntoma sin necesidad de sync.
                                     NO actuó aquí; es una bomba sin estallar.
```

---

### H1 — `voidOrder` no comprueba si el pedido ya tiene una venta

> **Éste es el que causó el daño material.** Es también el de arreglo más barato y de menor riesgo.

**Dónde:** `src/repositories/ordersRepo.js` — `voidOrder` (≈`:470`) y `voidItem` (≈`:255`).

**El defecto.** El único candado que impide anular una mesa ya cobrada es éste, dentro de
`voidItem`:

```js
if (order.status !== ORDER_STATUS.OPEN) throw new Error('El pedido ya no esta abierto')
```

Se apoya en **`order.status`**, que vive en la **cabecera del pedido**, y la cabecera se fusiona por
**LWW de documento entero**. O sea: el candado depende del único campo que la sincronización puede
perder. Cuando el `markClosed` no llegó, `status` seguía valiendo `open`, el candado no vio nada
raro y dejó pasar la anulación completa.

La evidencia buena **sí estaba en la base**: la venta `6367f8fe` lleva
`orderId = 143f3098…` y **está en este mismo respaldo**. Las ventas son **append-only con id
propio**: no se pisan, no se pierden, no se sobreescriben.

Es exactamente la lección que el proyecto ya aprendió con el descuento de mesa y que está escrita
en `CLAUDE.md`: **«LA VERDAD VIVE EN LOS EVENTOS, no en la cabecera.»** Aquí la verdad vive en la
**venta**, no en `order.status`.

**Evidencia — pedido `143f3098-d7a6-437c-b822-a559b47d905a`, Mesa 1** (todo verificado):

| | |
|---|---|
| Abierto | 21-09 19:39:25 · turno `8aa167a5` (Dependiente) |
| Líneas agregadas | 49 (19:39:51 → 19:57:54) |
| **Venta `6367f8fe`** | **19:59:10 · 41 unidades · 27 860 MN efectivo · `voided: false`** |
| Acreditada a tesorería | `acc_cash_mn`, 27 860 MN |
| Estado del pedido en este respaldo | **`voided`, `saleId: null`**, cerrado 00:25:05 |
| Libro mayor del pedido | salidas **−49** · devoluciones **+53** · **neto +4** |
| Unidades devueltas al stock | **53**, por 35 060 MN a precio de venta |
| De ellas, presentes aún en la existencia al cierre | **48** |

**La prueba aritmética de que se perdieron 4 marcas de "anulada"** (es el dato que cierra el caso):

```
líneas del pedido .................................. 49
anuladas durante el servicio, marcadas en este respaldo  4   (Refresco 19:43:41; Sandwich QyJ x3 19:57:2x)
=> "vivas" según este respaldo ..................... 45 u  =  30 210 MN
la VENTA cobró ..................................... 41 u  =  27 860 MN
                                                     ----     --------
diferencia ..........................................  4 u  =   2 350 MN
```

Y esas 4 unidades son **exactamente** las que tienen devolución de stock a las 19:54/19:55 **sin**
su línea marcada:

| Hora de la devolución | Producto | ¿Línea marcada anulada? | Precio |
|---|---|---|---|
| 19:54:05 | Jugos de BOTELLA MANGO | **no** | 550 |
| 19:54:06 | Jugos de BOTELLA MANGO | **no** | 550 |
| 19:54:07 | Jugos de BOTELLA MANGO | **no** | 550 |
| 19:55:46 | Batido de maní B | **no** | 700 |
| | | | **2 350** |

`3 × 550 + 1 × 700 = 2 350`, **cuadra al peso** con la diferencia. Conclusión: la instancia que
**cobró** tenía el estado correcto (cobró bien 41 u; **el cliente no pagó de más**), y la instancia
de la que salió este respaldo **nunca recibió esas 4 marcas** ni el aviso de "mesa cobrada".

**Impacto.** Convirtió un problema de sincronización (molesto: una mesa trabada) en un problema de
**inventario y de costo**: 53 unidades devueltas al stock, **4 inventadas de la nada**, 48 todavía
sentadas en la existencia de Salones, y el vínculo venta↔mesa **borrado** (la escritura de la
anulación es más nueva y el LWW la hace ganar), así que esa venta de 27 860 MN ya no se puede
rastrear a su mesa en ningún reporte.

#### Solución propuesta, de MENOR riesgo

**Candado de solo lectura en `voidOrder`, antes de mover nada:** buscar una venta **no anulada**
cuyo `orderId` sea este pedido y, si existe, **rechazar la anulación** con un mensaje claro
(*"esta mesa ya se cobró"*).

**El detalle que baja el riesgo a casi cero — no hace falta esquema Dexie.** `sales` **NO tiene
índice por `orderId`** (`db.js:27`: `id, shiftId, sellerId, createdAt, voided`), así que un
`where('orderId')` **lanzaría un `SchemaError`**. Tres caminos, de menor a mayor riesgo:

| Camino | Coste | Riesgo | Veredicto |
|---|---|---|---|
| **Consultar por el índice `shiftId`** (que sí existe) y filtrar `orderId` en memoria. `order.shiftId` ya se conoce. | Acota el barrido a las ventas de **un turno** | **Sin esquema, sin sync, sin migración** | **RECOMENDADO** |
| `db.sales.filter(s => s.orderId === id).first()` | Barrido de tabla completa; crece con el histórico | Sin esquema, pero se degrada con los años | Aceptable (anular una mesa es raro) |
| Añadir índice `orderId` a `sales` | Óptimo | **Sube esquema a v20 → despliegue "de ida", exige respaldo previo** | **NO, por ahora** |

**Propiedades de la solución recomendada:**
- **Estrictamente aditiva:** un camino de error nuevo. Con el caso normal (no hay venta) el
  comportamiento es **idéntico al de hoy**.
- **Cero escrituras, cero esquema, cero `SYNC_COLLECTIONS`, cero riesgo de convivencia** entre un
  teléfono actualizado y otro sin actualizar.
- **Degrada al lado seguro:** si la venta no está en la base local (por el H3), el candado no salta
  y el comportamiento es el de hoy. No protege, pero **no rompe nada nuevo**.
- **Borde a validar:** `order.shiftId` puede ser `null` en una mesa que fue *reservada* y nunca
  llegó a ocuparse (`reserve` lo pone a `null`, `occupy` lo rellena). Con `shiftId` nulo, caer al
  barrido por filtro o no aplicar el candado — **nunca lanzar por sorpresa**.

---

### H2 — El cobro de la mesa no es atómico

> **NO actuó en este caso.** Se documenta porque produce el **mismo síntoma** sin necesidad de dos
> instancias, y sigue vivo.

**Dónde:** `src/features/tables/TableScreen.jsx:476-477`.

```js
const saleId = await salesRepo.create(payload)           // transacción 1: nace la venta
await ordersRepo.markClosed({ orderId: order.id, saleId, userId: user.id }) // transacción 2
```

**El defecto.** Son **dos transacciones separadas**. La venta ya existe —con su dinero acreditado a
tesorería— antes de que la mesa quede marcada como cobrada. Si entre las dos líneas la app se
recarga, el teléfono se duerme o se cierra la pestaña, queda **la venta cobrada y la mesa abierta
con `saleId: null`**: una mesa trabada que invita a anularla, y de ahí al H1.

**Por qué se descarta como causa de lo del 21-09.** La venta salió con las **41 unidades
correctas**, lo que demuestra que la instancia que cobró tenía el estado completo y que
`markClosed` casi con seguridad **sí se ejecutó allí**. Lo que falló fue que ese `markClosed`
**nunca llegó a la otra instancia**. Es el H3, no el H2.

> **Corrección al primer informe verbal de esta auditoría**, que atribuyó el caso al H2 diciendo
> *"eso es exactamente lo que muestran los datos"*. Con la aritmética de 41 vs 45 unidades, esa
> lectura **no se sostiene** y queda rectificada aquí.

#### Solución propuesta, de MENOR riesgo

**Descartado (demasiado riesgo): meter las dos escrituras en una sola transacción.**
`salesRepo.create` ya abre su propia transacción (`salesRepo.js:87`) con un alcance de **8 tablas**
que **no incluye `orders`**. Ampliar ese alcance toca la función más central de la aplicación —la
que mueve todo el dinero— y el riesgo de regresión no es proporcional al problema.

**Recomendado: reparar la cabecera al leerla, con el patrón que el proyecto ya usa dos veces.**
Al abrir el salón o la mesa, si un pedido `open` tiene una venta no anulada con su `orderId`,
repararlo a `closed` + `saleId`, **SIN tocar `updatedAt`** (es un valor derivado, igual que
`recomputeStock` y que `reconcileDiscount`).

- Mismo patrón, mismas reglas y mismo precedente que **`ordersRepo.reconcileDiscount`** y
  **`remittancesRepo.reconcileFromDeliveries`**: idempotente, solo escribe si la caché discrepa, y
  **no genera eco de sincronización**.
- **Sin cirugía transaccional, sin esquema, sin sync.**
- **Encaja con el H1:** el H1 bloquea el daño, el H2 evita que la mesa llegue a parecer trabada.
  Juntos cierran el caso por los dos lados.
- **Ojo (a decidir con el dueño):** una reparación que escribe la cabecera **compite con el LWW**.
  Hay que razonar qué pasa si dos instancias reparan a la vez, y por qué no tocar `updatedAt` lo
  hace inocuo. Es la parte que exige más cuidado de esta propuesta.

---

### H3 — El transporte parte transacciones atómicas: hay hechos que llegaron a medias

> **Es la causa raíz.** Es también el **más riesgoso de arreglar** y la recomendación es
> **NO tocar `pushEngine` todavía**, sino medirlo primero.

**Dónde:** `src/features/sync/pushEngine.js:138` y `:186`.

```js
const nuevos = rows
  .map((r) => ({ r, id: String(r[col.pk]), ts: syncTs(r) }))
  .filter((x) => x.ts && x.ts > cursor)      // :138  solo sube lo que supera el cursor
...
await setCursorForward(col.name, maxTs)      // :186  el cursor salta al máximo del lote y NUNCA retrocede
```

**El defecto.** Cada colección tiene su **propio cursor** (marca de agua) y solo se sube lo sellado
**por encima** de él. El cursor salta al máximo del lote y no retrocede nunca. Una fila que nazca
con una marca **por debajo** de un cursor ya avanzado **no se sube jamás**, y no queda rastro: en
este respaldo **todas las colas de reintento están vacías** (`retry:* = []`), así que el motor cree
que no hay nada pendiente. Y como los cursores son **por colección**, y una transacción escribe en
**varias** colecciones a la vez, **media transacción puede quedarse de un lado y media del otro, de
forma permanente**.

Es el **Hallazgo 5** que `CLAUDE.md` tiene abierto desde agosto. Aquí está **observado en datos
reales del negocio**, no en teoría.

**Evidencia — atomicidad rota, en los dos sentidos.** Primero se verificó en el código que el
documento y sus movimientos se escriben **en una sola transacción Dexie**:

| Repo | Línea | Alcance de la transacción |
|---|---|---|
| `kitchenRepo.produce` | `:114` | `productions`, `stockMovements`, `products` |
| `purchasesRepo.create` | `:31` | `purchases`, `stockMovements`, `products` |
| `transfersRepo.create` | `:29` | `transfers`, `stockMovements`, `products` |

Y se descartaron las salidas falsas:

- **Nadie borra nunca.** `grep` sobre todo `src/`: **cero** `delete`/`clear`/`bulkDelete` sobre
  `stockMovements`, `orderItems`, `productions`, `purchases` o `transfers`. Son estrictamente
  append-only.
- **No hay commit prematuro de Dexie.** En `produce`, el único `await` no-Dexie
  (`ratesRepo.currentRates()`) ocurre **fuera** de la transacción; dentro solo se esperan
  operaciones Dexie. La atomicidad se sostiene.
- **La restauración no puede quitar filas.** `applyBackup` hace `bulkPut` (upsert): añade y
  sobreescribe, **nunca elimina**.

**Por lo tanto, en un solo dispositivo esto es imposible. Y aun así está aquí:**

| Anomalía | Detalle |
|---|---|
| **3 producciones con CERO movimientos** | 21-09 **19:48:30** Batido de chocolate B ×3 · **19:48:46** Batido de maní B ×2 · **20:02:30** Batido de maní B ×1 |
| **1 juego de movimientos SIN su producción** | ref `05038036`, **20:02:12** — Batido de maní B ×1 (7 movimientos completos, ningún snapshot) |
| **1 compra sin movimientos** | 05-09 23:57 · Ajo en polvo 900 g · 3 996 MN |
| **3 traspasos sin movimientos** | 03-09 15:58 · 03-09 16:07 · 08-09 16:01 (este último, 38 Cruz campo + 20 Holanda + …) |

**Prueba decisiva sobre las 3 producciones huérfanas:** `kitchenRepo` sella **todos** los
movimientos de una producción con el **mismo `createdAt`** que el snapshot. Se buscó por instante
exacto y en una ventana de ±3 s: **0 movimientos**. Y los ids de las 3 producciones aparecen
**una sola vez en todo el respaldo** (su propia fila). Sus movimientos **no están, con ningún
`refId`**.

Compárese con una producción **sana** de la misma noche: a las `19:48:54.661`, Batido de Limón B
×1 escribió **9 movimientos + el snapshot**, todos en el mismo milisegundo. Las dos huérfanas
(19:48:30 y 19:48:46) están **solas**, y justo entre ellas —**851 ms después**— escribe la otra
instancia (§1.2).

**Impacto en lo de la mesa.** A la instancia de este respaldo no le llegaron ni las **4 marcas de
"línea anulada"** (colección `orderItems`) ni el **"mesa cobrada"** (colección `orders`), pero sí
le llegaron los **movimientos de stock** (`stockMovements`) y la **venta** (`sales`). **Cuatro
colecciones, cuatro cursores, cuatro suertes distintas.** Esa instancia estuvo **5 horas** mirando
una mesa que ya no existía.

**Impacto más amplio.** Cualquier reporte emitido desde esa instancia está **incompleto**, y
**no hay ninguna señal que lo avise**. En concreto, en esta copia: 6 batidos elaborados cuyos
insumos nunca se descontaron de `__cocina` y que nunca entraron a Salones; y 1 batido cuyos insumos
sí se descontaron pero que es **invisible al reporte "Producción de cocina"**.

#### Solución propuesta, de MENOR riesgo

**Paso 1 — AHORA, riesgo prácticamente nulo: hacer visible el fallo.** Un chequeo de
**solo lectura** que liste las roturas de atomicidad (documentos sin sus movimientos y movimientos
sin su documento, en `productions` / `purchases` / `transfers`).

- **Cero escrituras, cero esquema, cero sincronización.** Es aritmética sobre tablas que ya se
  leen.
- Convierte un fallo **silencioso** en un fallo **visible**, y permite **medir la magnitud real**
  antes de tocar el motor. Hoy no sabemos si son 8 casos o 800.
- Puede vivir primero como *script de diagnóstico* fuera de la app (como esta auditoría) y solo
  después, si conviene, como tarjeta en `/auditoria`.

**Paso 2 — DESPUÉS, y solo con los dos respaldos delante: el arreglo real.** El proyecto **ya tiene
la pieza buena**: `retryQueue`, una cola **por id**, independiente del cursor, cuyo propio
comentario dice *«cursor y reintentos son mecanismos separados → ningún pendiente queda oculto bajo
el cursor»*. Lo que falta es que **nada dependa solo del cursor**: que toda fila entre a la cola por
id hasta que el servidor confirme.

> **Advertencia honesta:** eso es **cirugía en `pushEngine`**, la zona más delicada del sistema, y
> puede multiplicar las escrituras contra la cuota de Firestore —que según `docs/SYNC-LECTURAS.md`
> **ya está averiada al 120 % del tope**. **No se toca sin medir primero.**

**Paso 3 — mitigación operativa, sin código, disponible hoy:** los relojes de los dos aparatos en
**fecha y hora automáticas**. El desfase entre relojes es lo que empuja filas por debajo del
cursor. `CLAUDE.md` ya documenta ~21 s de desfase; el par **20:02:12 / 20:02:30** de esta misma
noche (18 s, misma receta, misma cantidad, mitades opuestas) encaja con ese orden de magnitud.
**Es lo único que el código no puede arreglar.**

---

## 4. Hallazgo adicional validado — `applyBackup` sobreescribe datos NUEVOS con datos VIEJOS

No es uno de los tres, pero se encontró investigando la pregunta de los dispositivos, **está
validado**, y es **candidato a causa alternativa** de lo de la mesa. Hay que descartarlo o
confirmarlo mañana.

**Dónde:** `src/features/backup/backupService.js:116` (`applyBackup`).

```js
await table.bulkPut(rows)   // upsert CIEGO: sin comparar marcas de tiempo
```

El comentario de la función lo dice sin rodeos: *«si este dispositivo ya tenia datos, se fusionan
(los ids iguales se sobreescriben con lo del respaldo)»*. A diferencia del `pullEngine`, que aplica
**LWW** de verdad (`pullEngine.js:37`: `if (!local || syncTs(incoming) > syncTs(local))`), la
restauración **no compara nada**: restaurar un respaldo viejo **pisa** lo nuevo.

**Por qué importa aquí.** Restaurar un respaldo tomado **antes de las 19:54** explicaría el caso
completo en **un solo dispositivo**:

| Efecto | ¿Cuadra? |
|---|---|
| Las 4 líneas vuelven **sin** la marca `voided` | ✅ el fichero viejo las tiene sin anular |
| El pedido vuelve con `saleId: null` y `status: open` | ✅ |
| La **venta sobrevive** | ✅ no estaba en el fichero viejo, y `bulkPut` solo escribe lo que trae |
| Las devoluciones de stock de las 19:54 sobreviven | ✅ append-only, no estaban en el fichero viejo |
| La caché de stock queda coherente con el libro | ✅ `applyBackup` llama a `recomputeStock` al final — y de hecho **0 divergencias** en 210 claves |

**Pero no explica las 3 producciones sin movimientos**, porque `bulkPut` **no puede quitar filas**.
Así que, o hubo dos instancias (H3), o hubo restauración **y además** el fichero restaurado ya
venía con esa rotura.

**Qué NO se puede saber con este respaldo:** si hubo una restauración. `lastRestoreAt` es una clave
`DEVICE_ONLY_KEYS` y **se elimina del respaldo**.

> **Segunda pregunta para mañana:** *"¿alguien restauró un respaldo en algún teléfono el 21-09 por
> la noche?"*

**Solución de menor riesgo (a decidir después):** que `applyBackup` aplique **LWW igual que el
`pullEngine`** en lugar de `bulkPut` ciego. Pero **ojo**, es un cambio de comportamiento con una
consecuencia real: hoy la restauración sirve como *"devuélveme el aparato a este estado"*, y con LWW
pasaría a ser *"rellena lo que falte"*. **Eso lo decide el dueño**, no es una corrección obvia.

---

## 5. Hallazgos operativos (no son defectos de código)

Estos no se arreglan programando; se arreglan cambiando cómo se trabaja. Son los que explican el
descuadre de caja del día.

### 5.1 El cuadre del turno `600f287f`: la aritmética de la app es CORRECTA

| | MN |
|---|---|
| Apertura | 4 000 |
| Efectivo de ventas del turno | 95 050 |
| **Esperado** (`apertura + ventas − extracciones`) | **99 050** |
| Declarado (conteo: 90 × 1 000 + 1 × 50) | 90 050 |
| **Diferencia** | **−9 000** (9,09 % → 🔴) |

Se recalculó `shiftsRepo.getSummary` sobre los datos: **99 050 exacto**. **La app no se equivocó.**

**Por qué el descuadre era estructuralmente inevitable:**

1. **Dos turnos abiertos a la vez en Salones, una sola gaveta.** `shiftsRepo.open:55-57` solo
   bloquea al **mismo vendedor**. No se puede contar una gaveta contra uno de dos turnos que la
   comparten. Y el turno del Dependiente **lleva abierto desde el 20-09**: mezcla tres días en un
   cuadre que aún no existe.
2. **La mesa del dueño se usó como planilla de carga masiva.** El pedido `8cad6e1c` (Mesa 1) recibió
   **135 líneas** entre las 16:46 y las 18:47 —**25 en un solo minuto**, el de 16:47— y se cobró de
   golpe como **95 050 MN en efectivo** a las 18:49:36, cerrando el turno **3 min 37 s después**.
3. **Las extracciones de caja NUNCA se registran.** `cashMovements` está **vacía en toda la historia
   del negocio**. Como `expectedCash = apertura + ventas − extracciones`, con extracciones siempre
   en 0, **todo lo que salga de la gaveta aparece como faltante**. No hay otro camino.
4. **Y se arrastra a mañana.** `closingFloat` = 90 050 y `ownerWithdrawal` = 0, así que el próximo
   turno de Salones se **pre-rellena con 90 050 de apertura** (`ShiftScreen.jsx:190-201` →
   `lastClosedCash('Salones')`), mientras el turno del Dependiente sigue abierto sobre la misma
   gaveta con apertura 0.

**Lo que NO se puede determinar con estos datos:** de dónde salieron los 9 000 exactos. Parte del
consumo cobrado por transferencia y registrado como efectivo, consumo a crédito, dinero sacado sin
registrar, o simplemente un conteo corto —nótese que **la casilla de 10 000 se abrió y se dejó en
blanco**: `{"50":"1","1000":"90","10000":""}`—. **Son indistinguibles.** Lo que sí está probado es
que el flujo actual no ofrece ningún camino para registrarlas.

### 5.2 Comida elaborada "en existencia" que no puede existir

**49 unidades** de comida hecha al momento figuran en Salones al cierre, por **36 730 MN** a precio
de venta:

| Producto | u | Producto | u |
|---|---|---|---|
| Hamburguesa Oro Criollo B | 9 | Hamburguesa Oro Clásico B | 3 |
| Hamburguesa Oro Real B | 6 | Hamburguesa Oro Supremo B | 3 |
| Sandwich Queso y Jamón B | 6 | Batidos (caramelo, limón, fresa, maní) | 2 c/u |
| Café expresso B | 6 | Café Cortadito B | 2 |
| Café Capuchino B | 4 | Frapuchino B / Sandwich Queso B | 1 / 1 |

**34 de esas 49 salen directamente de la anulación del H1.** El resto viene de la mecánica del
tablero: elaborar **crea existencia** en el área y la mesa solo la consume cuando el camarero la
toca, así que **toda diferencia entre lo elaborado y lo cobrado se queda en Salones como stock para
siempre**. El 21-09: 144 elaboradas + 34 traspasadas contra 159 vendidas netas.

Y el **56,5 % de las líneas de mesa de toda la historia acabaron devueltas** (208 de 368): cada
toque del "−" escribe una anulación completa. El kardex de cada elaborado es, en su mayoría, ruido.

### 5.3 Los costos están mal por ~1000×, y envenenan todo el reporte de gastos

`Carne de res`: `unit = 'g'`, **`cost = 472`** → **472 MN por GRAMO = 472 000 MN/kg**.

| Panel del dueño, 21-09 | MN |
|---|---|
| Ingresos | 161 670 |
| **Gastos (costo de lo vendido)** | **3 908 513,72** |
| **"Ganancia"** | **−3 746 843,72** |

**94,2 % de ese costo (3 681 600 MN) es la carne**, por 7,8 kg que a 472 MN/kg habrían costado
3 681,60 MN. El inventario de **268,7 kg** de carne está valorado en libros en **126 826 400 MN**,
y la existencia de Salones a costo en **1 172 765,32 MN**. De ahí salen `Hamburguesa Oro Criollo B`
con costo 37 933,86 y precio 700, y `Hamburguesa PREMIUM B` con costo 170 626,27 y precio 2 500.

**Esto ya pasó y se corrigió a medias esa misma noche.** El snapshot del tablero lo delata:

```
21-09 19:48:59  Batido fresa B  ->  Hielo 500   /oz   Sal 750  /g   costoUnit = 5 675,80
21-09 23:01:17  Batido fresa B  ->  Hielo   0,018/oz  Sal   0,49/g  costoUnit =   176,93
```

Entre las 19:49 y las 23:01 alguien arregló el hielo y la sal. **La carne se quedó sin arreglar, y
es la que manda en las hamburguesas.** El patrón es entrar el **precio del paquete** en lugar del
**costo por unidad de medida**.

**No afecta al −9 000** (el cuadre solo compara efectivo), pero destruye el panel del dueño, el
costo de lo vendido, la valoración del inventario y cualquier ficha de costo.

**Solución: NO es código. Es corregir el dato** en el catálogo. Riesgo cero.

### 5.4 97 líneas de mesa congeladas con `unitCost: 0`

**97 de 368** (26 %), **14 de ellas el 21-09 en ventas que quedan en pie** (PREMIUM B ×2, Oro
Supremo B ×2, Oro Criollo B, batidos, Cruz campo ×3…). Como la venta agrupa por
`productId|unitPrice|unitCost` (`TableScreen.jsx:371`), **el mismo producto sale dos veces en la
misma venta**, una con costo y otra con 0 — por eso la venta `81373a20` muestra *"1× Batido de
chocolate B costo 5 636,20"* y *"2× Batido de chocolate B costo 0"*.

**Hoy ningún producto del catálogo tiene costo 0**, así que fueron momentos transitorios. La
explicación más probable es una fila de `products` desactualizada llegando por LWW —consistente con
el H3—, **pero NO se puede probar**: la app solo registra los cambios de *precio* (`priceChanges`),
no los de *costo*. **Queda abierto.**

---

## 6. Resumen para decidir

| # | Hallazgo | ¿Actuó el 21-09? | Daño | Riesgo del arreglo | Esquema/sync |
|---|---|---|---|---|---|
| **H1** | `voidOrder` sin candado de venta | **SÍ** | Inventario + trazabilidad del dinero | **Bajo** | **No** |
| **H2** | Cobro de mesa no atómico | No (latente) | Mismo síntoma, sin sync | Medio | No |
| **H3** | El transporte parte transacciones | **SÍ (causa raíz)** | Reportes incompletos y silenciosos | **Alto** | No, pero sí cuota |
| +  | `applyBackup` sin LWW | **Por confirmar** | Puede revertir datos nuevos | Medio (cambia semántica) | No |
| 5.3 | Costos ~1000× | **SÍ** | Todo el reporte de gastos | **Nulo (es dato)** | No |

**Orden recomendado:** corregir el **dato de los costos** (hoy, riesgo cero) → **H1** (candado,
riesgo bajo) → **H2** (reparación al leer) → **diagnóstico del H3** (solo lectura) → y solo
entonces, con medidas en mano, decidir sobre `pushEngine` y `applyBackup`.

---

## 7. Checklist para mañana, con el segundo respaldo

El segundo respaldo (el de la instancia del **Dependiente**) es lo que convierte las hipótesis en
certezas. Hay que pedirlo **sin borrar ni reinstalar nada antes**, y luego comprobar, en este orden:

**Sobre el H3 (atomicidad / transporte):**

1. ¿Tiene los **movimientos** de las 3 producciones huérfanas (19:48:30, 19:48:46, 20:02:30)?
   **Sí → el H3 queda confirmado** y sabremos qué le falta a cada lado.
2. ¿Tiene el **snapshot** de la producción `05038036` (20:02:12)?
3. ¿Tiene los movimientos de la compra del 05-09 y de los 3 traspasos (03-09 ×2, 08-09)?
4. Comparar los **cursores `syncState`** de los dos ficheros. Un cursor **por delante** de la última
   fila real de su colección es la huella directa del defecto.
5. Repetir en ese fichero el **chequeo de atomicidad** de esta auditoría y contar sus propias
   roturas. Eso da la **magnitud real**, que hoy no se conoce.

**Sobre el H1 (la mesa anulada):**

6. ¿Las 4 líneas del pedido `143f3098` (3 Jugos MANGO, 1 Batido de maní) están con
   **`voided: true`** y `voidedAt` a las **19:54/19:55**? **Sí → confirmado** que la marca se
   escribió y nunca llegó a la otra instancia.
7. ¿Su pedido `143f3098` tiene **`saleId` relleno** y `status: closed`? ¿O también llegó la
   anulación y ganó por LWW?
8. ¿Cuántas líneas vivas tenía ese pedido en esa instancia? Debe dar **41**, que es lo que cobró la
   venta.

**Sobre el hallazgo adicional (`applyBackup`):**

9. Preguntar al dueño: **¿alguien restauró un respaldo el 21-09 por la noche?** No se puede saber
   por el fichero (`lastRestoreAt` se elimina del respaldo).

**Sobre los dispositivos:**

10. Preguntar en estos términos: **¿desde qué aparato y qué navegador entró el Dependiente el 21-09
    por la noche?** Recordar que dos navegadores en el mismo teléfono son **dos bases de datos**.
11. Si se puede, mirar `/errors` en cada aparato (el registro local de errores **no viaja en el
    respaldo**). Ahí estarían los rechazos de sincronización, si los hubo.

**Sobre los costos:**

12. Comparar el `cost` de `Carne de res`, `Hielo` y `Sal` entre los dos ficheros. Si difieren,
    tendremos la ventana en que se corrigieron y si el LWW los movió.

---

## 8. Lo que esta auditoría NO puede afirmar

- **Que la app funcione.** No se ejecutó: ni un cobro, ni una pantalla, ni una sincronización real.
- **Cuántos dispositivos físicos hay.** Solo que hubo **al menos dos instancias** escribiendo con
  851 ms de separación (§1.2).
- **De dónde salieron los 9 000 MN** del descuadre (§5.1).
- **Si hubo una restauración de respaldo** el 21-09 (§4).
- **Por qué 97 líneas se congelaron con costo 0** (§5.4). Es lo más probable que sea el H3, pero no
  hay registro de cambios de costo que lo pruebe.
- **Qué hay en la nube.** No se consultó Firestore.

---

## 9. Validación del 22-09-2026 — con el segundo y el TERCER respaldo

El §7 pedía un segundo respaldo para convertir las hipótesis en certezas. Llegaron **dos**, y con
ellos los tres hallazgos quedan **confirmados**, aparece **uno nuevo (H4)** y hay que **rectificar
tres cosas** del §0 al §8. Todo lo de abajo se vuelve a medir con:

```bash
node docs/auditoria/bateria-burger-premium.mjs <A1> <B> <A2>
```

**37/37 aserciones en verde**, sobre los tres respaldos **y** el árbol de trabajo (la batería lee
`src/` como texto para comprobar las afirmaciones de código; no importa nada de la app, no escribe
y no toca la base). Dos aserciones fallaron en la primera corrida y **eran errores del script**, no
hallazgos: una exigía que hubiera coincidencias donde lo correcto era que no hubiera ninguna, y
otra usaba una ventana de tiempo que colaba una anulación de más. Se corrigieron, no se silenciaron.

### 9.1 Los tres ficheros

| | Exportado | Tamaño | `SHA256` |
|---|---|---|---|
| **A1** | `2026-09-21T20:22:18.640Z` | 1 160 864 | `56d3ab425bc79efc1bddab7692cda19ce2dd5bf4a788c50f06a133452a99aebb` |
| **B** | `2026-09-22T14:34:24.603Z` | 1 369 529 | `6f206d5f50996e65513ca23ab7c06365a53f8f2039090357cfb5b23b84e2ecd2` |
| **A2** | `2026-09-22T19:57:24.021Z` | 1 479 945 | `70e0933e1318697171dfc1b4f2d217951a3e74a3283ed0aacc361bcc807fcb98` |

Los tres llevan `schema 19` y `fromUserName: Abar` — que es **quien exportó**, no el aparato.

> **🛑 EL FICHERO QUE SE AUDITÓ EN EL §0 YA NO EXISTE.** Tenía el mismo nombre y la misma ruta que
> **B** (`respaldo_mypicuadre_2026-09-22.json`, 1 303 782 bytes, `4369af82…`) y **B lo sobrescribió**.
> No está en disco. Lo que salvó el trabajo fue encontrar **A1** en `Downloads`, que se exportó
> **después de las 19:54** y por eso contiene la mitad que faltaba. **Guardar cada respaldo con un
> nombre distinto.**

### 9.2 Hay al menos TRES instancias, y dos de ellas están probadas

**Prueba, no inferencia:** **A2 se exportó 5 h 23 min DESPUÉS que B y le faltan 7 filas de
`stockMovements` que B sí tiene.** Como nadie borra de `stockMovements` en todo `src/` (comprobado
sobre el árbol completo) y `applyBackup` solo hace `bulkPut`, una base **no puede perder filas**. Por
tanto **A y B son bases distintas**. A1 y A2 comparten exactamente el mismo hueco: son el mismo lado.

La **tercera** la aporta el dueño: **ninguno de los tres respaldos es del teléfono de Abar**, desde el
que se abrió el turno que solapó con el del día 20. Encaja con lo que ya decían los datos por otro
camino: las producciones de las **19:48:30 y 19:48:46** tienen su documento en las dos instancias y
sus movimientos **en ninguna**, y como se escriben en una sola transacción, quien las creó **no es ni
A ni B**.

> Esto **responde** lo que el §1.1 declaró incontestable, pero **no** por la vía del reloj: por
> append-only. La pregunta del §1.3 sigue en pie para saber *qué* aparato es cada uno.

### 9.3 H1 — CONFIRMADO

- `ordersRepo.js` **no toca `db.sales` ni una vez** (0 apariciones; la única mención a `salesRepo` está
  en un comentario, línea 459). El único candado sigue siendo `order.status !== OPEN`.
- `sales` está indexada `id, shiftId, sellerId, createdAt, voided` — **sin `orderId`**. Confirma que el
  arreglo del §H1 tiene que entrar por `shiftId` o por `filter`.
- La venta `6367f8fe` (27 860 MN, `voided:false`) **está en la misma base que ejecutó la anulación**:
  la evidencia que necesitaría el candado estaba disponible localmente.
- 49 líneas contra **53** devoluciones → neto **+4**, tal como decía el §H1.
- **Alcance: 1 pedido de 30 en toda la historia.** No es sistémico.

### 9.4 H2 — CONFIRMADO COMO LATENTE; no actuó

En **A1**, el pedido quedó `closed` con su `saleId` **256 ms** después del `createdAt` de la venta: el
`markClosed` **sí se ejecutó** donde se cobró. Y hoy no hay ningún pedido abierto con venta viva. Se
confirma lo que el §H2 ya rectificaba del primer informe verbal.

### 9.5 H3 — CONFIRMADO, con las dos mitades delante

`voidItem` escribe la línea y su movimiento **en una transacción y con el mismo `ts`**. Esa igualdad es
la firma que permite emparejarlos, y se cumple:

| Línea | En A1 | En A2 / B |
|---|---|---|
| `a5f1b7dc` Jugo MANGO | `voidedAt 19:54:05.406` | anulada otra vez a las `00:25:04.599` |
| `ac5a18bb` Jugo MANGO | `voidedAt 19:54:06.053` | `00:25:04.509` |
| `aa12af31` Jugo MANGO | `voidedAt 19:54:07.281` | `00:25:04.408` |
| `f724e5b2` Batido de maní | `voidedAt 19:55:46.948` | `00:25:02.882` |

**4/4 pares exactos al milisegundo** entre `voidedAt` y el `createdAt` de su movimiento. Y **los
movimientos SÍ están en las dos instancias, y son las mismas filas** (`2556cdc5 5a2e8dc8 6e4c3889
834610e8`). Una transacción, dos colecciones, **dos suertes**.

**Segundo caso, independiente:** las 7 filas de la producción `1cc0fd86` (21-09 20:02:30) que A2 no
tiene. **Tercer y cuarto caso:** las dos producciones huérfanas en las dos instancias, y el espejo
(`05038036`: movimientos sin su snapshot).

### 9.6 RECTIFICACIÓN — la prueba del cursor del §7.4 no servía

El §7.4 mandaba buscar *"un cursor por delante de la última fila real de su colección"*. **Esa prueba
es incapaz de detectar nada**, y hay que decirlo: la fila que levantó el cursor sigue siendo local, así
que entra en ese máximo. Aplicada a los tres ficheros da **0 cursores adelantados de 63**, y eso **no
exonera** al mecanismo.

La prueba que sí mide da **positivo**:

- Las 7 filas perdidas están **por debajo** del cursor `push:stockMovements` de la instancia que
  debería subirlas (`2026-09-22T14:30:34.409Z` frente a filas selladas en `2026-09-21T20:02:30.917Z`).
- Y **no están en ninguna cola de reintento** en ninguno de los tres ficheros.

**Dónde mirar, acotado:** el motor de **bajada no tiene cursor** — `pullInitial` hace `getDocs` de la
colección entera y `onSnapshot` escucha toda la colección—, así que una fila que no está en local casi
con seguridad **no está en Firestore**: la pérdida es del lado de **subida**.

Y el código ofrece un mecanismo concreto que el §H3 no tenía: en `pushEngine.js`, `batch.commit()` se
lanza **sin `await`** (con `.then/.catch`) y `setCursorForward` corre **inmediatamente después, sin
esperar la confirmación**. Si el aparato se cierra, se duerme o se mata el proceso entre ambas cosas,
las filas quedan **debajo del cursor y fuera de la cola**, en silencio — y encaja con que las colas
estén vacías: el `.catch` que las habría encolado nunca llegó a correr. **Es la hipótesis que mejor
encaja, no una medición.**

### 9.7 H4 (NUEVO) — el ajuste del conteo físico es un DELTA

`countsRepo.approve` calcula `delta = physicalQty − stockFromLedger(local)` y lo escribe como asiento
append-only. El conteo del 22-09 14:02 registró `systemStock = 3`, físico `0`, y escribió **−3**:

| | libro antes | tras el mismo −3 |
|---|---|---|
| Instancia que contó (B) | **3** | **0** ✅ correcto |
| La otra (A) | **2** | **−1** ← el negativo |

Esa diferencia de 1 es **exactamente** la producción que le falta a A. Control negativo: reinyectando
solo ese `+1`, el saldo cuadra en 0. Segundo control: si el ajuste fuera un **objetivo absoluto**, las
dos instancias habrían quedado en 0.

**El conteo físico —la única herramienta de corrección disponible— exportó el error de una instancia a
la otra.** La corrección **F3** de `docs/CORRECCION-EXISTENCIAS.md`, que **ya está en el código**,
arregla el caso *dentro* de un aparato y **no hace nada** para éste.

> **🛑 TRAMPA OPERATIVA, vigente hasta que los libros se igualen:** volver a contar ese producto en el
> aparato que muestra **−1** escribiría un delta de **+1** que viajaría al otro y lo rompería a él. El
> error **cambiaría de aparato**, no desaparecería.

### 9.8 RECTIFICACIÓN — las horas de este documento son UTC

El §2 dice *"día local Cuba UTC−4"* y a continuación imprime las horas **crudas del ISO**, que son
**UTC**. Las dos cosas no pueden ser ciertas a la vez. **No se puede determinar la zona del dispositivo
desde el respaldo** (se intentó con el día local que los ids de notificación llevan dentro: ninguna cae
entre las 00:00 y las 04:00 UTC, que es la única franja que lo discriminaría). Si los aparatos están en
hora de Cuba, **las horas reales son 4 h antes** de las escritas aquí: la mesa se anuló a las **20:25**
locales, no a las 00:25. **Preguntárselo al dueño antes de contrastar estas horas con lo que recuerda.**

### 9.9 Lo que pasó después, y que el acta no podía saber

- El turno `8aa167a5` del Dependiente (abierto desde el 20-09) lo **cerró Abar a la fuerza** el 22-09
  14:12: esperado = declarado = 62 070, diferencia 0, y retiró todo. Abrió y cerró además un turno
  vacío (14:07–14:09) solo para retirar los 90 050 de arrastre. **Las dos cajas quedan en 0.**
- El conteo del 22-09 dio de baja **103 unidades en Salones (69 450 MN a precio de venta)** y 31 netas
  en cocina. **Hasta 44** de esas unidades coinciden producto por producto con lo que devolvió la
  anulación del H1 — es una atribución por coincidencia, no una causación probada unidad a unidad.
- Del §5.3 se corrigieron **Hielo** (500 → 0,018) y **Sal** (750 → 0,49). **`Carne de res` sigue en
  472 MN/g = 472 000 MN/kg**, y el inventario sigue valorado en **127 778 821 MN**. Sigue abierto.
- `cashMovements` sigue en **0** en toda la historia, pero los dos retiros se registraron como
  `ownerWithdrawal` al cerrar, que es el canal correcto.
- **Quedan ~34 unidades de bebida embotellada** dadas de baja que la anulación no explica (Holanda
  Premium −25 con solo 2 devueltas, importada −11, Maltas −5…). La cerveza no se elabora, así que no es
  "elaborar de más": o es faltante real, o son ventas que nunca llegaron a esa instancia — que sería
  otra vez el H3. **Con estos ficheros no se puede distinguir.**

### 9.10 Lo que esta validación NO afirma

- **Qué aparato físico es cada instancia.** No hay `deviceId`.
- **Si la venta había llegado a la instancia que anuló, a las 00:25.** De eso depende que el candado
  del H1 hubiera evitado **este** caso concreto; **no es determinable**.
- **El mecanismo exacto** por el que se perdieron esas filas (§9.6).
- **La zona horaria** de los aparatos (§9.8).
- **Nadie ha ejecutado la app.** Ni antes ni ahora: respaldos + lectura de código.

---

## 10. Plan de corrección — aprobado el 22-09-2026

El dueño autorizó **empezar por 1, 2 y 3**, y **dejar 4 y 5 para decidirlos con lo que mida el 3**.
**Cuando se escribe esto no hay una sola línea de código tocada en `src/`.**

| # | Qué | Ficheros | Tamaño | Esquema / sync | Riesgo | Estado |
|---|---|---|---|---|---|---|
| **1** | **H1** — candado de venta en `voidItem` | 1 | ~15 líneas | ninguno | Bajo | **AUTORIZADO** |
| **2** | **H3-a** — forzar resubida de una colección | 2 | ~40 líneas | ninguno | Bajo (salvo cuota) | **AUTORIZADO** |
| **3** | **H3-b** — diagnóstico de atomicidad (solo lectura) | 1–2 | ~70 líneas | ninguno | Nulo | **AUTORIZADO** |
| **4** | **H2** — reparar la cabecera al leerla | 3 | ~30 líneas | ninguno | Medio | **EN ESPERA** |
| **5** | **H3-c** — que nada dependa solo del cursor | `pushEngine` | medio | ninguno; sí cuota | Alto | **EN ESPERA** |
| — | **H4** — ajuste como objetivo absoluto | el libro entero | grande | cambia el invariante | Muy alto | **DESCARTADO** |

### 10.1 Antes de programar: cinco cosas que no son código

1. **NO volver a contar el Batido de maní en el aparato que muestra −1** (§9.7).
2. **Corregir el costo de `Carne de res`.** Riesgo cero, es dato, y hoy envenena todo el panel de gastos.
3. **Fecha y hora automáticas** en los tres aparatos.
4. **Respaldo del teléfono de Abar**, la tercera instancia, que no se ha visto nunca.
5. **Contar siempre desde el mismo aparato.**

### 10.2 · 1 — H1: candado de venta

**Dónde:** `src/repositories/ordersRepo.js`, dentro de **`voidItem`** — no en `voidOrder`. `voidItem`
es el cuello real: `voidOrder`, `removeProduct` y el botón «−» pasan todos por ahí, así que hoy también
se pueden quitar líneas **una a una** de una mesa ya cobrada.

**Cómo:** antes de mover nada, buscar una venta **no anulada** cuyo `orderId` sea este pedido, entrando
por el índice **`shiftId`** (que sí existe) y filtrando en memoria. Si existe → **rechazar** con un
mensaje claro.

- **Borde obligatorio:** `order.shiftId` puede ser `null` (mesa *reservada* que nunca se ocupó:
  `reserve` lo pone a null y `occupy` lo rellena). Con `shiftId` nulo, caer a `filter` o no aplicar el
  candado — **nunca lanzar por sorpresa**.
- **Coste:** una consulta indexada por pulsación del «−». Las ventas de un turno son pocas (13 en uno
  de 44 h). Proporcionado.
- **Propiedades:** estrictamente aditivo (un camino de error nuevo); sin venta, el comportamiento es
  **idéntico al de hoy**. Cero escrituras, cero esquema, cero `SYNC_COLLECTIONS`, **cero riesgo de
  convivencia** entre un teléfono actualizado y otro sin actualizar.
- **Limitación declarada:** si la venta no ha llegado a esa base, el candado **no salta**. Degrada al
  lado seguro, pero **no garantiza** haber evitado el caso del 21-09. Eso lo arregla el 5, no el 1.

### 10.3 · 2 — H3-a: forzar la resubida de una colección

**Es lo único de la lista que repara el daño que YA existe**, incluido el −1 de hoy.

**Dónde:** `CloudScreen` (`/cloud`), solo dueño. **Qué hace:** poner `push:<colección>` **hacia atrás**
a una fecha que elija el dueño; la siguiente subida reenvía todo lo que quedó tapado. `setCursorForward`
solo avanza, así que hay que escribir `syncState` directamente.

- **Por qué es seguro con los datos:** reenviar filas idénticas es **idempotente** (`batch.set` por id),
  y `syncState` es **local** (no está en `SYNC_COLLECTIONS`).
- **El riesgo real es la CUOTA de Firestore**, que según `docs/SYNC-LECTURAS.md` ya va al **120 % del
  tope**. Por eso debe pedir **una fecha**, nunca reenviar todo, y **decir cuántas filas va a subir
  antes de hacerlo**.
- **Secuencia para el caso de hoy:** resubir `stockMovements` desde justo antes de
  `2026-09-21T20:02:30` en la instancia que tiene las 7 filas → la otra las recibe → su libro pasa de
  −1 a 0 → **y solo entonces** volver a contar, si hace falta.

### 10.4 · 3 — H3-b: diagnóstico de atomicidad (solo lectura)

Hoy no sabemos si esto son 8 casos o 800, y sin esa cifra el 5 no se puede decidir. Listar las roturas
—documentos sin sus movimientos y movimientos sin su documento, en `productions` / `purchases` /
`transfers`— es **aritmética sobre tablas que ya se leen**: cero escrituras, cero esquema, cero sync.
Puede vivir primero como script (la batería del §9 ya hace justo eso) y solo después como tarjeta en
`/auditoria`.

### 10.5 · 4 y 5 — en espera, y por qué

- **4 (H2).** Mismo patrón que `ordersRepo.reconcileDiscount`, que ya tiene **tres sitios de llamada**
  que copiar, y **sin tocar `updatedAt`** (es derivado: cada aparato se repara a sí mismo y no genera
  eco). Es **medio** riesgo porque escribe la cabecera y compite con el LWW; va **después** del 1, no
  antes. Con el 1 puesto, el 4 pasa de ser seguridad a ser comodidad (desatasca la mesa).
- **5 (H3-c).** La pieza buena **ya existe**: `retryQueue`, cuyo propio comentario dice que *cursor y
  reintentos son mecanismos separados*. Lo que falta es que **toda fila entre a la cola por id hasta
  que el servidor confirme**. Hay una variante de tres líneas —mover `setCursorForward` dentro del
  `.then()`— que es tentadora y **tiene una trampa**: sin internet el cursor no avanzaría nunca y cada
  ciclo reencolaría todo lo pendiente. **No se toca sin el 3 delante.**

### 10.6 H4: por qué se descarta, sin inflarlo

**El H4 no tiene arreglo barato propio, y no lo necesita: es un síntoma del H3.** Arreglado el
transporte, desaparece. Convertir los ajustes en **objetivos absolutos** cambiaría cómo se deriva el
stock del libro mayor —usado en toda la app— y no es proporcional al problema. Mientras tanto bastan la
regla operativa del §10.1.1 y el aviso *«Existencia en negativo»*, que **ya existe y funcionó** (saltó
el 22-09 a las 19:48).

### 10.7 Pruebas

No hay linter ni `npm test`, y **las 16 suites no pueden cubrir nada de esto**: `ordersRepo`,
`countsRepo` y `pushEngine` necesitan base de datos. Se propone **`fake-indexeddb` como
`devDependency`** —no está instalada; es aditiva, queda fuera del bundle, y tiene precedente en
`docs/FICHA-COSTO.md` §9.17— para probar el 1 y el 4 de verdad. Si el dueño prefiere no añadir
dependencias, se valida solo con build y lectura de código, **y se dirá así**.

### 10.8 Lo que este plan no puede prometer

- **Nada de esto se ha ejecutado.** No hay código escrito.
- El **1** y el **4** tocan **lógica de producción**: chocan con la regla 2 de `CLAUDE.md` y son
  correcciones de defecto. El dueño autorizó el 1 el 22-09-2026; el 4 sigue esperando.
- El **2 gasta cuota** en un proyecto que ya está por encima del tope.
- El **5** sigue **sin mecanismo probado** (§9.6).
