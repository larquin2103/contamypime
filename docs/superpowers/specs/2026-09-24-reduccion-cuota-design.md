# Reducción de la cuota de Firestore — diseño validado con medición

**Fecha:** 24-09-2026 · **Rama:** `claude/awesome-dirac-484azm` · **Estado: DISEÑO APROBADO POR EL
DUEÑO. CERO CÓDIGO ESCRITO.** El siguiente paso es el plan de implementación.

Sustituye como documento operativo a `docs/SYNC-LECTURAS.md` (09-09-2026), que sigue siendo válido
en su mecánica y **queda corregido aquí en tres puntos medidos**. Todo lo que dice "medido" se
obtuvo ejecutando un arnés sobre **tres respaldos reales** y sobre el **código real importado de
`src/`**; todo lo que es deducción se llama deducción.

---

## 1. La evidencia

### 1.1 Consola de Firebase (capturas del dueño, 24-09-2026)

| Métrica | 24-sep | 30 días (25-ago a 24-sep) | Tope Spark/día | % |
|---|---|---|---|---|
| Lecturas | **263 k** | 3,4 M → **113 k/día** | 50 k | **227 % de media, 526 % el día 24** |
| Escrituras | **20 k** | 237 k → 7,9 k/día | 20 k | 40 % de media, **100 % clavado el día 24** |
| Eliminaciones | 0 | 4,2 K | 20 k | ~0 % |

Aviso literal de la consola: *"Tu proyecto excedió los límites sin costo."*

**Negocios con la nube activa: ≥ 15** (dato del dueño, 24-09-2026). El acta del 09-09 **dedujo 7**.

**Un solo proyecto Firebase (`mypicuadre`) compilado en el cliente** (`firebaseConfig.js`,
`.firebaserc`): los 33 negocios con licencia comparten **una sola cuota**.

### 1.2 Lo medido sobre tres respaldos reales

Arnés desechable, fuera del repositorio, que **importa `SYNC_COLLECTIONS`, `LOCAL_CONFIG_KEYS` y
`syncTs` de `src/features/sync/collections.js`** — no los reimplementa. La única lógica replicada es
el bucle de selección de `doPush`, con una **guarda de fidelidad** que verifica letra por letra que
`pushEngine.js` no ha cambiado (6 aserciones, y 4 mutaciones del fuente que la guarda caza).

**Calibración contra un hecho real:** el arnés reproduce **exactamente las 6.622 filas** que el
registro de `/errors` capturó el 24-09, y **explica fila a fila** las 8 de diferencia con el total
real de 6.630 (7 de `config`, cuya marca cae fuera del rango que imprimió el log, y 1 turno abierto
después del envío).

| Negocio | D (documentos) | Historia | Escrituras/día | `stockMovements` | 2 mayores |
|---|---|---|---|---|---|
| Yurqueidy (*De todo un tin*) | 6.630 | 41 d | 209 | **54,3 %** | **76,6 %** |
| Lisett | 4.644 | 51 d | 108 | 36,8 % | 62,6 % |
| Abar (**con `mesas`**) | 4.272 | 22 d | 199 | **69,7 %** | **82,7 %** |
| **Media** | **5.182** | — | **172** | — | — |

- **D crece 128 documentos/día y negocio.** Nada se borra (regla 6 del proyecto).
- Lecturas observadas ÷ D = **21,9 lecturas completas de base al día** en todo el proyecto.

### 1.3 Las tres correcciones al acta del 09-09

1. **`D ≈ 1.476` era una infravaloración de 3,8×.** Medido: 5.182 de media. Aquel número salía de
   sumar promedios de una tabla con nombres de colección truncados; estos salen de contar filas.
2. **«La mayor no llega al 20 % de D» es FALSO.** Medido: `stockMovements` es el **54,3 %, 36,8 % y
   69,7 %** en los tres negocios. Sobre esa frase el acta descartó sacar colecciones del tiempo
   real, que es justamente la medida que este diseño adopta.
3. **«≈ 7 negocios activos» era una deducción de la concurrencia pico.** Son **≥ 15**.

---

## 2. El criterio de decisión: qué significa "permanente"

Las lecturas de un reenganche en frío son proporcionales a **D**, y **D solo crece**. Por tanto:

> **Una medida es permanente si, y solo si, desacopla las lecturas de D. Cualquier otra aplaza.**

Proyección medida, manteniendo los 21,9 reenganches calibrados y dejando crecer D a su ritmo:

| Medida | hoy | +6 m | +12 m | vuelve a cruzar el tope |
|---|---|---|---|---|
| **No hacer nada** | 113 k | 618 k | **1.137 k** | ya cruzado |
| Repartir en 5 proyectos gratis (tope 250 k) | 113 k | 618 k | 1.137 k | **1,6 meses** |
| Sacar las 2 mayores del oyente + sondeo 15 min (F2) | 34 k | 160 k | 290 k | **0,8 meses** |
| **Filtrar el OYENTE por marca de llegada (F5)** | **3 k** | **3 k** | **3 k** | **nunca** |

Y el coste de dar de alta un negocio, que es el otro reloj corriendo:

| Alta de un negocio | escrituras | % del tope diario del proyecto |
|---|---|---|
| hoy | 5.182 | 26 % |
| +90 días | 16.718 | 84 % |
| **+180 días** | 28.253 | **141 % — ya no cabe en un día** |

**Con 33 licencias y 15 activas, en seis meses no se puede dar de alta un negocio ni dedicándole el
día entero.**

### 2.1 Por qué esto decide también lo de Blaze

| Sin arreglar nada | lecturas facturables/mes |
|---|---|
| hoy | 3,4 M |
| +6 meses | 18,5 M |
| +12 meses | **34,1 M — ×10,0** |

**Ese ×10 ocurre sin vender un peso más: crece con la historia, no con el negocio.** Contratar
Blaze con este defecto dentro es contratar una factura que se multiplica sola.

Con el filtro: **0,1 M/mes, ×1,0 en doce meses**, y pasa a depender de la actividad.

**La conclusión no es «filtro o Blaze». Es que el filtro es lo que hace que Blaze sea seguro de
contratar.** Si el dueño decide pagar Blaze igualmente, este diseño no se descarta: pasa de
emergencia a control de gasto.

---

## 3. Qué se descarta, con su número

| Medida | Veredicto |
|---|---|
| **Repartir en varios proyectos gratis** | **Compra 1,6 meses con 5 proyectos.** No toca el crecimiento y multiplica por 5 el soporte, las reglas y los despliegues. Sirve de segundo paso para crecer, nunca de primero. |
| **No reescribir la ficha de producto en cada venta** | **650 escrituras/día en todo el proyecto = 3 % del tope. Irrelevante para la cuota.** *(Sí corrige un fallo real, ver §8.2: es corrección, no ahorro, y va por su cuenta.)* |
| **Subir `PULL_INTERVAL_MS`** | **Cero ahorro.** El pull se engancha al oyente vivo y hoy no cuesta (verificado en el acta del 09-09 por dos caminos independientes). |
| **Recortar lo que vive en la nube a una ventana móvil** | Ataca D de raíz y sería lo más simple, pero **`recomputeStock` deriva la existencia del libro COMPLETO**: un aparato que bajara un libro truncado calcularía mal el stock, de forma permanente. Descartado. |
| **«Arreglar» el cursor al vincular** | **No hay nada que arreglar.** Se midió: la nube de ese negocio estaba vacía, así que las 6.630 escrituras eran el coste legítimo de dar de alta un negocio con 46 días de historia. Poner el cursor en «ahora» haría que el historial **nunca** subiera y se perdería. *(Esto corrige un hallazgo del informe del 24-09 de esta misma auditoría.)* |

---

## 4. El diseño

**La medida: sellar cada documento con la hora en que LLEGÓ a la nube y filtrar la bajada por ese
sello, empezando por las dos colecciones que son el 63–83 % del volumen.**

### 4.1 Por qué empezar por `stockMovements` y `sales`, y sin oyente

El acta del 09-09 identificó **R1 como su riesgo crítico y lo dejó sin validar**: si una consulta
*con filtro* no comparte forma canónica con la del oyente, el pull de 45 s deja de ser gratis y pasa
a **34 × 1.920 × 30 aparatos ≈ 1,9 M lecturas/día** — mucho peor que hoy y sin aviso.

**Este diseño esquiva R1 por construcción en su primera fase: si no hay oyente, no hay vista en
caché que preservar.** Las dos colecciones salen del tiempo real y se bajan por consulta propia.

Y son el caso más seguro que existe para estrenar el mecanismo:
- **Inmutables y append-only** (verificado en el acta del 09-09: cero `update`/`put`/`modify` en
  `src/` para las 16 inmutables, `stockMovements` y `sales` entre ellas).
- No se fusionan por campos: una fila que llega, llega entera y no pisa nada.
- Son el **63–83 % de D** medido.

### 4.2 Las piezas

**P1 — Sello `_up`.** `toCloud(rec)` (`pushEngine.js:58`) añade `_up: now()`, la marca ISO del
momento de la subida. `toCloud` es el **único** serializador hacia Firestore de los documentos
sincronizados (verificado: sus tres llamantes están todos en `pushEngine.js`). **Coste en cuota de
escritura: cero** — es un campo más en una escritura que ya se hacía.

**P2 — Borrar `_up` al fusionar.** `mergeIncoming` lo elimina antes del `bulkPut`: no entra en
Dexie, no viaja en respaldos, no se resube. El registro local queda **idéntico a hoy**. El máximo
`_up` se calcula en el llamador (`syncEngine.js`) **antes** de llamar a `mergeIncoming`, para no
tocar su firma ni sus dos consumidores.

**P3 — Cursor de bajada `pull:<colección>`** en `syncState`, paralelo a los `push:*` que ya existen.
`syncState` **no** está en `SYNC_COLLECTIONS` (verificado), así que es local y no viaja a la nube.
Avanza **solo si la respuesta vino del servidor**, y al **máximo `_up` visto menos 5 minutos**: un
solapamiento deliberado que cubre el desfase de reloj (~21 s documentado) y que Firestore no
garantiza entregar en orden de `_up`.

**P4 — Las dos colecciones salen de `startRealtime`.** Un conjunto `SIN_TIEMPO_REAL` en
`collections.js`; `syncEngine.startRealtime` no se suscribe a las que estén en él.

**P5 — `initialPull` deja de leerlas sin filtro.** **Ésta es la pieza crítica**: si el pull de 45 s
siguiera haciendo `getDocs` sin filtro sobre colecciones que ya no tienen oyente, cada ciclo sería
una consulta real y el remedio sería peor que la enfermedad. `initialPull` las salta.

**P6 — Bajada propia en ciclo lento + por evento.** Un `pullDiferido()` que hace
`getDocs(query(col, where('_up','>',cursor)))` para las dos colecciones:
- **cada 15 minutos** en segundo plano — a 30 aparatos (15 negocios x 2) son `2 × 96 × 30 = 5.760` lecturas/día de
  mínimo por consulta (12 % del tope), frente a las 17.280 (35 %) que costaría a 5 minutos;
- **y de inmediato** al abrir el salón, la pantalla de venta o el conteo físico, y antes de cobrar.
  Convergencia cuando importa, sin pagar sondeo.

**P7 — Reconciliación inicial obligatoria, una vez por aparato.** Antes de encender el filtro:
una lectura completa, marcada como hecha **solo si `fromServer === true`**. Motivo: los aparatos
pueden tener **huecos en lo viejo** precisamente por los cortes de cuota de estos meses, y en
`stockMovements` un hueco significa que `recomputeStock` sumaría un libro incompleto y el stock de
ese teléfono quedaría mal **de forma permanente**. Cuesta lo mismo que un día normal de hoy, pagado
una sola vez.

**P8 — Bandera local en `config`, apagada por defecto.** Se enciende negocio a negocio. En
`LOCAL_CONFIG_KEYS` (no viaja a la nube) y en `DEVICE_ONLY_KEYS` (no viaja en respaldos), el mismo
patrón que `syncEnabled`.

**P9 — Respaldos.** Excluir las claves `pull:*` y la bandera en `buildBackup` **y** en
`applyBackup`. **Verificado en un respaldo real** (`respaldo_mypicuadre_2026-09-22.json`): hoy
`syncState` se respalda entero, con sus 16 cursores `push:*`. Restaurar un respaldo viejo le diría
al aparato «ya bajé hasta aquí» cuando es mentira → hueco permanente. **Los `push:*` y `retry:*` se
dejan exactamente como hoy**: excluirlos también sería seguro (el re-push es idempotente por id)
pero provocaría una resubida completa innecesaria.

### 4.3 Lo que NO se toca

- `TS_FIELDS`, `syncTs`, `tsAfter` y todas las fechas de negocio. **`_up` no entra en `syncTs`**: el
  LWW se sigue decidiendo con los mismos seis campos de hoy.
- Los cursores de subida `push:<col>` y la cola `retry:<col>`.
- `pushEngine.doPush`, salvo la línea de `toCloud`.
- `recomputeStock`: sigue derivando el stock del libro **local completo** (en Dexie no se borra
  nada; el filtro solo cambia lo que se **baja**).
- Los ids deterministas y toda la idempotencia.
- **`PUSH_INTERVAL_MS`, `PULL_INTERVAL_MS`, `NUDGE_DEBOUNCE_MS`, `FOREGROUND_PULL_MIN_MS` y
  `RECOVER_MIN_MS`** quedan intactos.
- **Ninguna versión nueva de esquema Dexie.** No hay v20.
- **`firestore.rules`: no se toca y no hay que redesplegar.** Añadir un campo es un `update`
  permitido y el comodín `{document=**}` ya cubre todo el árbol.
- **Índices: ninguno que desplegar.** Firestore indexa cada campo automáticamente, así que el rango
  sobre `_up` funciona sin configuración.

---

## 5. Fases

| Fase | Qué | Criterio de aceptación | Reversión |
|---|---|---|---|
| **F0** | Instrumentar el **reenganche**: registrar en `/errors` cuántas veces y tras cuánto hueco se reabre el tiempo real | Aparecen entradas con el hueco real. Hoy **21,9 reenganches/día es un cociente, no una observación** | Aditivo, nada que revertir |
| **F1** | P1 + P2 (el sello). **La bajada sigue completa.** | `npm run build` limpio; las lecturas **no cambian**; los documentos nuevos en la nube llevan `_up` | Quitar el campo; los documentos con `_up` siguen siendo válidos |
| *espera* | Varios días, hasta que todos los aparatos hayan subido al menos una vez | — | — |
| **F2** | P3 a P9 sobre `stockMovements` y `sales`. Bandera apagada | Con la bandera apagada, el comportamiento es **idéntico** al de hoy | La bandera ya está apagada |
| **F3** | Reconciliar y **encender en UN negocio** | 48 h de consola: las lecturas del proyecto **bajan**, y el pull de las 32 restantes **sigue costando cero** | Apagar la bandera (escritura en `config`) |
| **F4** | Abrir negocio a negocio | Las lecturas se mantienen por debajo del tope | Apagar por negocio |
| **F5** | Extender el filtro **al oyente** de las 32 restantes. **Aquí se afronta R1**, ya con el sello y el cursor probados en producción | Las lecturas bajan otra vez y el pull sigue gratis | Volver al alcance de F2 |

**F1–F4 llevan las lecturas de 113 k a ~34 k/día y compran MENOS DE UN MES (0,8).** No son la
solución: son el experimento barato que valida el sello y el cursor **sin tocar R1**, y de paso dan
aire para hacer F5 sin prisa. **La solución es F5, que las deja en ~3 k constantes.** Decirlo al
revés sería vender F1–F4 como algo que no son.

**Antes de cada commit: `npm run build` limpio.** Las 30 suites `.test.mjs` **no cubren el motor de
sync** (`retryQueue.test.mjs` cubre solo la cola de reintentos, que esto no toca): se corren para
comprobar que no se rompió nada, **no como prueba de este cambio**.

---

## 6. Riesgos

**R1 — El enganche de la consulta filtrada · CRÍTICO, y aplazado a F5 a propósito.** F1–F4 no lo
tocan porque las dos colecciones se quedan sin oyente. En F5 vuelve entero: la mitigación es el
**cursor fijo por sesión** (la consulta del oyente y la del pull, idénticas carácter a carácter).
**No verificado empíricamente, y no se puede verificar en node.**

**R2 — Mínimo por consulta del ciclo lento.** Una consulta vacía cuesta 1 lectura. A 15 minutos y 30
aparatos son 5.760/día (12 % del tope). **A 5 minutos serían 17.280 (35 %) y a 1 minuto, 86.400
(173 %) — peor que hoy.** La cadencia de P6 no es un detalle de ajuste: es parte del diseño.

**R3 — Hueco por orden de entrega.** Firestore no garantiza entregar en orden de `_up`. El margen de
5 minutos lo hace improbable, **no imposible**. Endurecimiento opcional: `serverTimestamp()` y
avanzar el cursor por el `readTime` del snapshot. **No verificado el comportamiento de
`serverTimestamp()` con escrituras offline en este código**; por eso queda fuera.

**R4 — Desfase de reloj (~21 s, documentado)** · cubierto por el mismo margen.

**R5 — Documentos sin `_up`** (los que ya están en la nube) · cubierto por P7.

**R6 — Huecos preexistentes por los cortes de cuota de estos meses** · misma mitigación que P7, y es
la razón de que P7 sea obligatoria y no recomendada.

**R7 — IndexedDB desalojado por el navegador** · bypass: tabla local vacía → consulta sin filtro.

**R8 — Respaldos que arrastran el cursor** · cubierto por P9, verificado sobre un respaldo real.

**R9 — Multipestaña** (`persistentMultipleTabManager`) · las dos pestañas comparten la misma Dexie;
el margen de 5 minutos absorbe la carrera. Impacto: unas pocas lecturas repetidas.

**R10 — Almacenamiento** · un campo ISO (~24 B) más su entrada de índice por documento. Con 33
negocios y ~5.200 documentos cada uno: decenas de MB, muy por debajo del 1 GiB gratis.

---

## 7. El coste que hay que aceptar, dicho antes de programar

**`stockMovements` deja de llegar en vivo.** La existencia entre aparatos converge en **minutos**
(ciclo de 15 min, o al instante en los eventos de P6), no en segundos.

Qué NO cambia: el candado de existencia de `salesRepo.create` revalida contra el **libro local**, y
siempre fue así. La sobreventa entre dos aparatos de la misma área ya era posible y lo sigue siendo,
ni más ni menos.

Qué sí cambia, y es lo que el dueño tiene que aceptar: con **`mesas`**, `orders` y `orderItems`
**siguen en vivo** (la cuenta de la mesa llega al instante, que es lo que hace falta para cobrar),
pero el **stock** que mueve cada toque baja con retraso. En un negocio con camarero y caja sobre la
misma área, el inventario que ve la caja puede ir hasta 15 minutos por detrás.

---

## 8. Hallazgos colaterales — NO entran en este diseño

### 8.1 El coste de dar de alta un negocio

No es un defecto (ver §3), pero es un reloj corriendo: **a los 180 días un alta ya no cabe en el
tope diario**. Este diseño no lo resuelve. Las salidas son escalonar la subida inicial en varios
días, o hacerla con el proyecto en Blaze durante unas horas. **Decisión aparte del dueño.**

### 8.2 La venta pisa por LWW un cambio de precio concurrente

`salesRepo.js:191` sella `products.updatedAt` en cada línea de venta, y `doPush` sube la ficha
entera con `batch.set` **sin comparar marcas**. Si el aparato A vende mientras el aparato B cambia
un precio, la subida de A escribe en la nube **su copia con el precio viejo** y B, al bajarla por
LWW, **pierde su propio cambio**. Es un fallo de corrección, medido en 650 escrituras/día que además
son redundantes (el receptor deriva el stock del libro igual). **Corrección independiente, con su
propia autorización: toca lógica de producción (regla 2).**

### 8.3 Bucle de recuperación

Con el servidor sin responder, cada pull dispara `recoverSession`, que rearma los 34 oyentes y lanza
**otro pull completo**. Se gasta más cuota precisamente cuando ya no hay. **No cuantificado**: hace
falta F0.

---

## 9. Lo que NO se puede garantizar

1. **Nadie ha ejecutado nada de esto.** El diseño se validó con **medición sobre respaldos reales +
   lectura de código**, nunca con runtime.
2. **Que el enganche sobreviva al filtro (R1).** Es el riesgo principal de F5 y solo se resuelve
   midiéndolo con la consola delante. **Por eso F5 va al final y no al principio.**
3. **Los 21,9 reenganches/día son un cociente calibrado, no una observación.** Las proyecciones
   suponen que ese número se mantiene. Si los aparatos se reenganchan más (o menos), las cifras se
   mueven; la **pendiente**, que es lo que decide la permanencia, no.
4. **El modelo de escrituras es COTA INFERIOR y deja el 67 % sin explicar**, incluso con el negocio
   de `mesas` dentro. Un respaldo guarda el estado final, así que no puede contar cuántas veces se
   reescribió una cabecera mutable. **No afecta a la recomendación** (las escrituras van al 40 % del
   tope y las lecturas al 227 %), pero **no se debe citar ese número como medido**.
5. **Tres negocios no representan a quince.** D, el ritmo y el reparto por colección salen de
   Yurqueidy, Lisett y Abar.
6. **El comportamiento de `serverTimestamp()`** con escrituras offline y con la fusión LWW en este
   código: sin verificar. Por eso R3 se mitiga con margen y no con él.
7. **El arnés de medición es DESECHABLE y no está en el repositorio.** No protege contra regresiones
   futuras. Su guarda de fidelidad contra `pushEngine.js` solo vale mientras se vuelva a correr.
