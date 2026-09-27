# Subida sin eco — diseño

**Fecha:** 27-09-2026 · **Rama:** `claude/awesome-dirac-484azm` · **Estado: DISEÑO VALIDADO CON EL
DUEÑO SECCIÓN A SECCIÓN (27-09-2026). CERO CÓDIGO ESCRITO.** Falta que el dueño revise este fichero;
después, el plan con `superpowers:writing-plans`.

Nace de la auditoría previa a `main` del 27-09 (acta en `CLAUDE.md`, «Auditoría previa a `main`»
dentro de la sección de la reducción de cuota). **Decisión del dueño: la reducción de cuota F1+F2 NO
se fusiona hasta que esto esté hecho.** Precedente y contexto: el eco está descrito en
`docs/superpowers/specs/2026-09-24-reduccion-cuota-design.md` §10.4, que lo dejó fuera «con su propia
autorización y su propia medición». Esta es esa autorización.

---

## 1. El problema, verificado en el código

**Cada aparato vuelve a subir lo que baja de los otros.**

- `doPush` elige qué subir por **marca de agua**: toda fila con `syncTs(r) > push:<col>`
  (`pushEngine.js:155-157`), sin distinguir quién la escribió.
- La bajada **no mueve** ese cursor: `push:<col>` solo lo escriben `pushEngine.js:62` (en
  `setCursorForward`) y `:311` (`forceResend`).
- Por tanto, una fila que llega de otro aparato con marca por encima del cursor propio se reenvía en
  el siguiente ciclo de subida (cada 20 s). Con N aparatos, cada documento se escribe hasta **N
  veces**.

**Lo que cuesta hoy, en `main`:** esas re-subidas llevan el **mismo contenido** que ya hay en la
nube. Según el contrato de la API de Firestore (`WriteResult.update_time`: «si la escritura no cambió
el documento, será el `update_time` anterior»), una escritura sin efecto **se cobra como escritura**
pero no cambia el documento y **no despierta a ningún oyente**. Coste: escrituras, que llegaron al
100 % del tope el 24-09.

**Lo que costaría con F1:** cada eco de `stockMovements`/`sales` lleva un `_up = serverTimestamp()`
nuevo, así que el documento **sí cambia** y cada aparato en vivo paga una lectura. En esas dos
colecciones las lecturas por cambio suelto pasan de (N−1) a N(N−1). Estimado —no medido— en +1 % a
+5 % de las lecturas de hoy, desde el primer día y sin bandera.

**Coherencia con los datos:** en los tres respaldos reales de la máquina
(`Downloads/respaldo_mypicuadre_2026-09-12dueña.json`, `…vendedor.json`, `…2026-09-22.json`), el
cursor de subida de `stockMovements` y de `sales` es **exactamente** la marca más alta de la tabla, y
esa fila es de **otro** usuario. No es prueba absoluta (un usuario puede entrar en el aparato de
otro); la prueba es el código.

## 2. Decisiones del dueño (27-09-2026)

| # | Pregunta | Decisión |
|---|---|---|
| E1 | ¿Arreglar el eco antes de fusionar F1+F2? | **Sí, primero el eco.** |
| E2 | ¿Cómo se activa? | **Bandera del negocio, apagada por defecto** (`config.subidaSinEco`, sincronizada). Regla 2: por defecto la subida es idéntica a la de hoy. |
| E3 | ¿Dónde vive la anotación de lo bajado? | **En memoria de la sesión.** Cero escrituras nuevas a Dexie, nada en respaldos. |
| E4 | Enfoque | **A: libro de ecos por (id, `syncTs`).** Descartados: adelantar el cursor al bajar (tapa filas locales pendientes, el Hallazgo 5), leer la nube antes de escribir (cambia escrituras por lecturas) y marcar filas en Dexie con un campo (cambia el contenido local y los respaldos). |
| E5 | ¿Quién la enciende en los 15 negocios? | **Las dos vías:** el panel de `/cloud` para el dueño de cada negocio y el procedimiento de consola (§6) para encenderla a distancia. |

## 3. El mecanismo

### 3.1 Módulo puro `src/features/sync/echoLedger.js`

Sin Dexie, sin Firebase, sin React; se prueba entero con node (mismo patrón que `deferred.js`). Un
`Map` por colección, en memoria de módulo:

- `record(colName, pk, filas)` — anota `String(fila[pk]) → syncTs(fila)` de cada fila.
- `split(colName, candidatos, enabled)` — recibe los `nuevos` de `doPush` (`{ r, id, ts }`) y
  devuelve `{ subir, saltar }`. Un candidato va a `saltar` **solo si** `enabled` y el anotado para su
  `id` es **idéntico** (`===`) a su `ts`. Con `enabled` falso, `saltar` sale vacío y `subir` es la
  lista entera, en el mismo orden.
- `prune(colName, cursor)` — borra las anotaciones con marca `<=` cursor: ya nunca podrán ser
  candidatas.
- `skippedCount()` — cuántas filas se saltaron en la sesión, para el panel.

**Se anota siempre, se salta solo con la bandera.** Anotar es memoria invisible (no escribe nada) y
evita que las tandas que llegan en el arranque, antes del primer `doPush`, queden sin anotar. Lo que
decide la conducta observable —qué se escribe en Firestore— es `split`, y ese sí depende de la
bandera.

### 3.2 Tres puntos de cableado, y ninguno más

1. **`pullEngine.mergeIncoming`**: tras el `bulkPut` (`pullEngine.js:54`), `record(col.name, col.pk,
   toPut)`. **Solo las filas que ganaron el LWW** (`:50`). Las cuatro entradas de datos de la nube
   pasan por aquí (`syncEngine.js:80`, `:157`, `:242`, `:286`; `/cloud` llega por `initialPull`).
2. **`pushEngine.doPush`**, en la selección (`pushEngine.js:155-201`):
   - se lee la bandera de Dexie una vez por ciclo (`configRepo`, una lectura local cada 20 s);
   - `nuevos` pasa por `split`; los lotes y `queuedCount` se hacen con `subir`;
   - `changedIds` (`:159`) sigue calculándose sobre **todos** los `nuevos`, para que un saltado no
     cambie qué reintentos se eligen;
   - `maxTs` (`:173-174`) sigue calculándose sobre **todos** los `nuevos`, subidos o saltados: el
     cursor queda en el **mismo valor que hoy**, así que la marca de agua no cambia de significado;
   - la salida temprana (`:170`) no cambia: si todos los nuevos se saltan y no hay reintentos, se
     avanza el cursor igual (hoy avanzaría tras subirlos);
   - tras `setCursorForward` (`:201`), `prune(col.name, maxTs)`.
3. **La bandera `config.subidaSinEco`** en `configRepo` (`getSubidaSinEco` / `setSubidaSinEco`, el
   patrón de `getBajadaFiltrada`), con su interruptor en `/cloud` (solo `isOwner`, junto al de la
   bajada filtrada) y el contador de filas no reenviadas de la sesión. Se añade a `DEVICE_ONLY_KEYS`
   de `backupService.js`: es del negocio y vive en la nube, y restaurar un respaldo viejo no debe
   cambiarla.

**Lo que NO se toca:** los reintentos (`due`, `retry:<col>`), `onBatchError`, `forceResend`, el
reenvío que compara, `TS_FIELDS`, `syncTs`, `tsAfter`, los ids deterministas, `recomputeStock`, el
esquema Dexie (sigue en v19), `SYNC_COLLECTIONS`, las reglas y los índices de Firestore,
`ordersRepo`, `salesRepo` y `features/tables`.

**Aplicación:** sin reinicio. A diferencia de `bajadaFiltrada`, no cambia suscripciones; cada
aparato la aplica en su siguiente ciclo de subida.

## 4. Garantías y casos límite

**Garantía central.** Solo se salta una fila si su versión (id + `syncTs`) es exactamente una que
este aparato recibió de la nube, así que la nube ya la tenía (Firestore no borra: `allow delete: if
false`). **Ningún cambio real del aparato se queda sin subir:** verificado con un análisis del árbol
sintáctico de `src/` (27-09-2026) sobre las **89** escrituras a filas existentes de tablas
sincronizadas (`update`/`modify`/`put`/`bulkPut`):

- **62** llevan una marca de `TS_FIELDS` en el objeto literal;
- **9** escriben un `patch` en variable, y los nueve lo sellan (`productsRepo:88`, `partnersRepo:58`,
  `recipesRepo:136` y `:154`, `remittancesRepo:330` y `:652`, `costSheetsRepo:262`/`:310` vía
  `headerPatch`, y `costSheetsRepo:306` vía `fichaLines.js:262/266`);
- **14** son del traspaso de turno offline (`handoffService.js:187-207`), que no pasa por
  `mergeIncoming` y por tanto no se anota;
- **4** cambian datos **sin** marca, a propósito, y sus comentarios dicen que **no deben subir**:
  `recomputeStock` (`pullEngine.js:83`), `reconcileDiscount` (`ordersRepo.js:496`),
  `reconcileClosed` (`:512`) y `reconcileFromDeliveries` (`remittancesRepo.js:184`).

Una fila tocada después de bajarla trae una marca distinta y sube como siempre.

**Casos límite:**

| Caso | Qué pasa |
|---|---|
| Escritura propia pendiente que vuelve por el oyente | Misma marca que Dexie → no gana el LWW → no se anota → sube por su cursor, como hoy. |
| Traspaso de turno offline / restaurar un respaldo | Escriben Dexie sin pasar por `mergeIncoming` → no se anota → suben como hoy. |
| Reintentos, `forceResend`, reenvío que compara | No pasan por `split` → idénticos. |
| Cierre de la app entre bajar y subir | Se pierde el mapa → esas filas hacen eco como hoy (lado seguro). |
| Bandera apagada a media sesión | El siguiente ciclo sube todo, como hoy. |
| Dos pestañas | Cada una tiene su mapa; en el peor caso una hace eco como hoy. |
| Teléfono con el build viejo | Sigue haciendo eco hasta actualizarse. |

**Cambio de conducta (a favor), que el dueño conoce:** hoy el eco sube a veces, por accidente, las
cuatro reparaciones derivadas: el stock recalculado, el descuento vigente, la mesa cobrada reparada a
`closed` y la entrega reparada, cuyos comentarios dicen que no deben subir porque podrían pisar en la
nube la versión real. Con la bandera dejan de colarse, y cada aparato las sigue derivando al abrir el
salón, la mesa o *Entregas*, como está diseñado. Igual con la ficha de producto: el eco podía volver a
subir una copia con un precio viejo encima de un cambio más nuevo de otro aparato. **El §8.2 de la
spec de cuota (la venta que reescribe la ficha) sigue abierto por su cuenta.**

## 5. Relación con F1, F2 y mesas

- **F1:** con la bandera encendida desaparecen los ecos de `stockMovements`/`sales` y, con ellos,
  sus `_up` nuevos: se va el sobrecoste de lecturas de F1. Queda el resto de la tabla del §4.
- **F2:** un eco sellado deja de volver por el timbre. Las dos banderas son independientes. Orden
  recomendado: `subidaSinEco` primero, medir, y después `bajadaFiltrada`.
- **Mesas:** `orders`, `orderItems` y `sales` siguen en vivo y suben todo lo que el aparato cambia.
  El candado del doble cobro lee `db.sales` local, y la venta la sube el aparato que cobra, por su
  cursor, como siempre.

## 6. Operación

**Tras desplegar, en cada negocio donde la bandera siga apagada, F1 cuesta lecturas.** Dos vías para
encenderla:

1. **El dueño del negocio**, en `/cloud`.
2. **A distancia, desde la consola de Firebase:** crear o editar el documento
   `/businesses/{uid}/config/subidaSinEco` con
   `{ key: "subidaSinEco", value: true, updatedAt: "<ISO de ahora, p.ej. 2026-09-28T12:00:00.000Z>" }`
   (`updatedAt` como **cadena ISO**, no como Timestamp: `syncTs` solo mira cadenas). Baja a todos los
   aparatos por la fusión LWW de siempre. Para apagarla, lo mismo con `value: false` y un `updatedAt`
   más nuevo.

Orden: desplegar → encender en **un** negocio → 24 h de consola → abrir negocio a negocio.

## 7. Pruebas y validación

1. **`src/features/sync/echoLedger.test.mjs`** (node directo): `record`/`split`/`prune`/contador;
   con `enabled` falso todo va a `subir` en el mismo orden; solo coincidencia exacta; `prune` por
   cursor. **Control negativo:** mutaciones del módulo (`===` → `>=`, ignorar `enabled`, `prune` con
   `<`, anotar sin `String()`) que la suite tiene que cazar.
2. **`src/features/sync/echoMerge.test.mjs`** (base real, `fake-indexeddb` + esbuild, como
   `pullDeferred`), con el `mergeIncoming` real:
   - solo se anotan las filas que ganan el LWW;
   - una fila igual a la local no se anota;
   - una fila tocada después de bajarla no se salta;
   - tras `recomputeStock`, el producto sigue saltándose.
3. **`src/features/sync/pushEcho.test.mjs`** (base real, nuevo en el proyecto): se empaqueta el
   `pushEngine.js` **real** con esbuild sustituyendo solo `../../lib/firebase` y `firebase/firestore`
   por falsos que registran cada `batch.set`/`setDoc`.
   - **Bandera apagada:** sobre cientos de escenarios aleatorios (filas locales, fusionadas, tocadas,
     derivadas y en reintento), el conjunto de documentos escritos (id + contenido) y el cursor final
     son **idénticos** a los del `pushEngine.js` de `origin/main` empaquetado igual. Se compara
     **quitando el campo `_up`**, porque el de `main` no sella y el de la rama sí (eso es F1, y se
     comprueba aparte: `_up` presente solo en `stockMovements`/`sales`). **Control negativo:** una
     mutación que salte una fila tiene que dar diferencias.
   - **Bandera encendida:** los ecos no se escriben, los cambios locales sí, los reintentos igual, y
     el cursor queda en el mismo valor que con la bandera apagada.
4. **Lo de siempre:** `npm run build` limpio; las suites existentes byte a byte iguales a `main`, con
   control negativo; 0 identificadores libres en los ficheros tocados, con control negativo; peso
   medido en los dos árboles con el mismo compresor; revisión independiente antes de `main`.

**Criterio de aceptación en producción** (F3 de este arreglo): con la bandera encendida en **un**
negocio, 24 h de consola antes y después: **las escrituras bajan y las lecturas no suben**. El
contador de `/cloud` dice cuántas filas no se reenviaron.

## 8. Lo que no se puede garantizar

1. **El ahorro real en la consola.** Lo decide la facturación del servidor, y en particular que una
   escritura sin efecto no despierte oyentes: documentado en la API de Firestore, no observado aquí.
2. **Cero runtime:** sin emulador (sin Java), sin Firestore real y sin un teléfono.
3. **La magnitud del eco** se deduce del código y es coherente con los respaldos, pero no se ha
   medido: depende de cuántos aparatos escuchan en cada negocio.
4. **Los teléfonos sin actualizar** siguen haciendo eco (y, con F1 desplegado, su eco de filas
   selladas sube el `_up` como mapa: el I4 de la spec de cuota, corregido en el acta del 27-09).
