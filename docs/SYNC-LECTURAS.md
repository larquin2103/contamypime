# Reducción de lecturas de Firestore — plan y auditoría

**Fecha:** 09-09-2026 · **Rama:** `claude/awesome-dirac-484azm` · **Estado: PROPUESTO. NADA
EJECUTADO. Espera la aprobación del dueño.**

Este documento es el plan completo y la auditoría previa de un cambio en el motor de
sincronización. No hay una sola línea de código escrita. Todo lo que dice "verificado" se
comprobó leyendo el código de este repo, el código del SDK de Firestore instalado
(`@firebase/firestore` 4.16.0) o la documentación de Google, y se indica cuál. Todo lo que es
deducción se llama deducción.

---

## 1. Por qué — la evidencia medida

Datos de la consola de Firebase del dueño, período 10-ago a 09-sept-2026, proyecto
`mypicuadre`, **plan Spark**:

| Métrica | Total 30 días | Promedio/día | Tope Spark/día | % del tope |
|---|---|---|---|---|
| Lecturas de documentos | 1,8 M | **60.000** | 50.000 | **120 %** |
| Escrituras | 175 k | 5.833 | 20.000 | 29 % |
| Eliminaciones | 8 K | 267 | 20.000 | 1 % |
| Escuchas de instantáneas | — | 289 (máximo) | — | — |
| Conexiones activas | — | 9 (máximo) | — | — |

La gráfica de lecturas va de valles de ~15 k a picos de ~100 k, y el último día del período
cierra en máximo histórico.

**Síntoma reportado por el dueño, y es la evidencia más directa de todas:** al superar el tope
diario **no puede entrar a la consola** a ver los datos del negocio. La consola de Firebase lee
Firestore y esas lecturas salen de la misma cuota — el panel lo dice literal: *"Incluye el uso de
Firebase console"*. Si la consola se bloquea, **la cuota está agotada**.

**Por qué los dispositivos no reportan fallos** (y por qué el problema es invisible):

- Las escrituras siguen funcionando (29 % del tope): las ventas se suben igual.
- `getDocs` **no lanza** cuando el servidor rechaza: resuelve desde la caché persistente con
  `fromCache = true` (verificado en el SDK).
- `resource-exhausted` es **transitorio** para Firestore — `isPermanentError(RESOURCE_EXHAUSTED)`
  devuelve `false` (verificado en el SDK, `common-456515ba.esm.js:5773`) — así que el SDK
  reintenta el stream por su cuenta y **el callback de error de `onSnapshot` ni se ejecuta**.
- Cada dispositivo tiene la base entera en IndexedDB. La app se ve perfecta.

Lo único que se detiene es la **convergencia entre dispositivos**: desde el corte, un equipo deja
de recibir los cambios del otro hasta el reset (medianoche del Pacífico ≈ 03:00 en Cuba).

**Alcance real del daño hoy, dicho sin exagerar:** un negocio con un solo dispositivo
sincronizando no pierde nada (no hay nada que converger). Los casos que sí duelen son concretos y
requieren dos dispositivos activos a la vez: mesas (camarero → caja), stock entre áreas, entrega
de turno. Y el daño seguro y diario es el del dueño: la consola.

**Cartera:** 33 negocios con licencia. Del volumen de lecturas y de la concurrencia pico
(289 escuchas ÷ 34 colecciones ≈ 8,5 dispositivos simultáneos) se **deduce** que solo unos
**7 negocios** tienen la nube activada. **Pendiente de confirmar** por el dueño en
Authentication (cuentas con inicio de sesión reciente). Si se activaran los 33 sin cambiar nada:
≈ 292.000 lecturas/día = **5,84× el tope**.

---

## 2. Diagnóstico — dónde se van las lecturas

### 2.1 El pull de 45 segundos NO es el problema

`SyncProvider.jsx:14` fija `PULL_INTERVAL_MS = 45000`, y `runPull` llama a `initialPull()`, que
hace `getDocs` de **las 34 colecciones completas, sin filtro ni cursor**. Leído en frío parece
que relee toda la base cada 45 segundos. **No es así, y está verificado por dos caminos
independientes:**

**Camino 1 — el código del SDK.** `getDocs` con origen por defecto no es una consulta directa:
se implementa como un **listener temporal**
(`firestoreClientGetDocumentsViaSnapshotListener`, `common-456515ba.esm.js:26605`). Y
`eventManagerListen` (`:24118`) busca la consulta en su mapa `queries`; si ya existe un listener
sobre **esa misma consulta** —y existe, porque `startRealtime()` deja un `onSnapshot` permanente
sobre la misma colección— marca `NoActionRequired` y resuelve con la **vista ya cacheada**
(`s.Eu.push(t)` + `t.Iu(s.lu)`), **sin ir al servidor**. Cero lecturas facturadas.

**Camino 2 — la aritmética sobre los datos reales.** Si ese pull cobrara: 8 horas de app abierta
= 640 pulls/día × 8,5 dispositivos × ~1.476 documentos ≈ **10,9 millones de lecturas/día**. Se
observan 60.000. Son **180 veces menos**. El enganche funciona.

### 2.2 El coste está en el ENGANCHE del listener en frío

La documentación de facturación de Firestore: un listener desconectado **más de 30 minutos** se
cobra *"as if you had issued a brand-new query"*. Un teléfono con la PWA cerrada o congelada por
el sistema pasa de 30 minutos sin esfuerzo. Y como la consulta del listener **no tiene filtro**,
ese enganche lee **la colección entera**.

> **lecturas/día ≈ (documentos del negocio) × (arranques en frío/día) × (dispositivos)**, sumado
> sobre todos los negocios del proyecto.

Verificado también que con caché IndexedDB el token de reanudación **se conserva** al soltar los
listeners: `removeTarget` del delegado LRU solo actualiza el número de secuencia
(`common-456515ba.esm.js:19155`), no borra el target. Así que `restartRealtime()` (que usa el
botón *Sincronizar ahora* y `recoverSession`) reengancha barato mientras el hueco sea < 30 min.

### 2.3 El modelo cierra con dos caminos independientes

De la tabla de Estadísticas de consultas de Google Cloud, sumando los documentos por colección:
**D ≈ 1.476 documentos por negocio** (deducción: es suma de promedios de una tabla con nombres de
colección truncados).

- 60.000 ÷ 1.476 = **41 lecturas completas de base al día**.
- Si cada negocio activo hace 6 (2 dispositivos × 3 arranques en frío) → **≈ 7 negocios activos**.
- Contraste independiente: 289 escuchas ÷ 34 = **8,5 dispositivos** en concurrencia pico.

Dos caminos distintos dan el mismo número.

### 2.4 Dos vías descartadas con datos, no con criterio

- **Subir `PULL_INTERVAL_MS`:** no ahorra **ni una** lectura (el pull se engancha al listener
  vivo). Es lo primero que cualquiera tocaría y sería inútil.
- **Sacar colecciones del tiempo real:** la mayor de las 34 no llega al **20 % de D** (la más
  grande ronda 298 documentos; `stockMovements` 195; las que empiezan por "a" —entre ellas
  `auditEvents`— entre 13 y 103). No hay colección monstruo que cortar. Y el cambio tendría coste
  visible (la auditoría dejaría de llegar en vivo) a cambio de casi nada.
- **Otra estructura de proyectos:** 5,84× el tope para 33 negocios = 6 proyectos hoy, 12 cuando D
  se duplique, contra un límite de creación de 5-10 por cuenta (FAQ de Firebase). Sirve de
  segundo paso para crecer, nunca de primero.

### 2.5 Evidencia adicional de la tabla de consultas

La razón *documentos analizados / resultados devueltos* es **1,00** en casi todas las filas: cero
desperdicio de escaneo. No hay una consulta mal hecha que optimizar. **Se pide todo y se devuelve
todo.** La única palanca es pedir menos.

(Nota: esa tabla suma ~36.000 operaciones de lectura contra 1,8 M de la consola de facturación —
el **2 %**. O Estadísticas de consultas muestrea, o no captura el canal Listen. No se pudo
distinguir cuál. En ambos casos refuerza que el coste está en los enganches, no en consultas
discretas.)

---

## 3. La medida, en una frase

**Sellar en cada documento la hora en que LLEGÓ a la nube, y filtrar la bajada por ese sello, de
modo que un arranque en frío lea solo lo que llegó desde la última vez en lugar de toda la
historia.**

---

## 4. Diseño

### 4.1 El sello `_up`

`toCloud(rec)` (`pushEngine.js:58`) añade un campo `_up` con la marca ISO del momento de la
subida.

**Verificado: `toCloud` es el único serializador hacia Firestore de los documentos
sincronizados.** Sus tres llamantes son los tres caminos de subida y están todos en
`pushEngine.js`: el lote (`:163`), el reintento individual (`:178`) y el aislamiento tras rechazo
permanente (`:209`). Los otros `setDoc` de `src/` (`deviceRegistry.js:82` y `:116`,
`syncService.js:54`) escriben documentos que **no están en `SYNC_COLLECTIONS`** (el documento del
negocio y los de dispositivos), así que no entran en este mecanismo ni les afecta.

**Verificado: `now()` (`lib/dates.js`) devuelve ISO-8601 UTC y el propio comentario dice que es
"ordenable lexicográficamente y portable a Firestore".** Un rango de cadenas en Firestore
funciona directo, sin conversión.

**Coste en cuota de escritura: cero.** Es un campo más en una escritura que ya se iba a hacer.

### 4.2 No hace falta resubir nada

Los documentos que ya están en la nube **no llevan `_up`** y por tanto **nunca coincidirán con el
filtro**: no se vuelven a bajar. Y eso es precisamente lo que se quiere, porque ya están en local.

*(Esto corrige una afirmación anterior del asesor, que decía que este cambio exigía una resubida
única escalonada de ~79.000 escrituras contra un tope de 20.000/día. Era falso y era el mayor
obstáculo aparente del plan.)*

### 4.3 Por qué `_up` (hora de llegada) y no `createdAt` (hora de creación)

| | `createdAt` | `_up` |
|---|---|---|
| Margen necesario | **Días.** Un teléfono 3 días offline sube ventas selladas con fecha vieja: caen fuera de la ventana y no se bajan nunca | **Minutos** (solo desfase de reloj) |
| Colecciones que cubre | Solo las **16 inmutables** | **Las 34.** Una mutación provoca resubida, que re-sella `_up` |
| Ahorro con 15 días de margen | ~0 % hoy (la historia del negocio cabe dentro de la ventana) | **~88 %** |

Para el registro, la clasificación por mutabilidad **sí se verificó** (cero `.update()`,
`.put()` ni `.modify()` en todo `src/`) y queda documentada por si algún día hace falta:

- **Inmutables (16), todas con `createdAt` confirmado:** `stockMovements`, `sales`,
  `auditEvents`, `purchases`, `transfers`, `mermas`, `priceChanges`, `cashMovements`,
  `conversions`, `partnerMovements`, `accountMovements`, `productions`, `custodyMovements`,
  `settlements`, `collections`, `productCustody`. Dato notable: **`sales.voided` se escribe
  `false` al crear y nunca se pone a `true`** — no existe camino de anulación de ventas en el
  código.
- **Mutables:** `products` (21 mutaciones), `remittances` (9), `orders` (6), `counts` (5),
  `shifts` (2), `internalDebts` (1), `orderItems` (1), `costSheetLines` (1) y `deliveries` (su
  repo documenta la anulación con `updatedAt`; el grep no la detectó, se clasifica aquí por
  precaución).
- **Pequeñas y acotadas, no hace falta filtrarlas por tamaño pero sí las cubre `_up`:** `config`,
  `users`, `categories`, `exchangeRates`, `accounts`, `partners`, `recipes`, `images`,
  `costSheets`.

### 4.4 El cursor FIJO POR SESIÓN — la clave que preserva el enganche

Este es el punto que hace viable todo lo demás.

Al arrancar la sesión de sincronización se lee **una sola vez** el cursor persistido de cada
colección y se guarda en memoria (`cursorSesion[col]`). **Ese mismo valor** se usa para:

1. la consulta del `onSnapshot` permanente, y
2. **todas** las llamadas a `initialPull` de esa sesión.

Al ser la consulta idéntica carácter a carácter, su **forma canónica coincide**, y
`eventManagerListen` debe devolver `NoActionRequired` igual que hoy → **el pull de 45 segundos
sigue costando cero y la cadencia no se toca**.

El cursor persistido avanza por separado, para la **siguiente** sesión. La consulta del listener
con un cursor fijo sigue entregando todo lo nuevo (cualquier documento con `_up` mayor coincide),
así que la latencia del tiempo real **no cambia**.

### 4.5 El margen de 5 minutos al avanzar el cursor

El cursor persistido no avanza al máximo `_up` visto, sino a **ese máximo menos 5 minutos**. Un
solapamiento deliberado que cubre dos problemas con un solo mecanismo:

- **Desfase de reloj.** Los teléfonos del dueño van ~21 s desfasados (documentado en `CLAUDE.md`).
  `_up` lo pone el reloj del emisor; un equipo atrasado podría sellar por debajo del cursor del
  otro. 5 minutos son 14× el desfase observado.
- **Orden de entrega.** Firestore no garantiza que la entrega respete el orden de `_up`. Un
  documento con sello menor entregado después del avance del cursor se perdería.

Coste del solapamiento: unos pocos documentos por enganche. Despreciable.

### 4.6 La reconciliación inicial (obligatoria)

Antes de encender el filtro en un dispositivo hay que hacer **una lectura completa, una sola
vez**, y marcarla como hecha **solo si la respuesta vino del servidor** (`fromServer === true`).

Motivo: los dispositivos pueden tener **huecos en lo viejo**, precisamente por los cortes de
cuota de estos meses. Si se enciende el filtro sin reconciliar, esos huecos quedan congelados
para siempre — y en `stockMovements` eso significa que `recomputeStock` sumaría un libro
incompleto y el stock de ese teléfono quedaría mal de forma permanente.

Cuesta lo mismo que un día normal de hoy, pagado una vez por dispositivo.

---

## 5. Auditoría detallada de los cambios

Ocho cambios, en cinco ficheros existentes. **Ningún cambio en pantallas, repositorios de
negocio, licencias ni esquema Dexie.**

### C1 — `src/features/sync/pushEngine.js` · `toCloud`

Añadir `_up: now()` al objeto serializado. Importar `now` de `../../lib/dates`.

- **Superficie:** 1 función, 3 llamantes, todos en este fichero (verificado).
- **No afecta a** los cursores de subida (`syncTs` mira solo `TS_FIELDS`, y `_up` no está ahí),
  ni a `retryQueue`, ni a la idempotencia (los ids deterministas no cambian), ni al tamaño de
  lote (400 / 50 para las de foto).
- **Riesgo:** ninguno identificado. `batch.set()` ya sobrescribe el documento completo.

### C2 — `src/features/sync/pullEngine.js` · `mergeIncoming`

Eliminar `_up` de cada documento entrante **antes** del `bulkPut`, para que no entre nunca en
Dexie.

- **Superficie:** `mergeIncoming` tiene **exactamente dos consumidores**, los dos en
  `syncEngine.js` (`:47` en `initialPull` y `:62` en `handleIncoming`) — verificado.
- **La firma de retorno NO cambia.** El máximo `_up` se calcula en el llamante
  (`syncEngine.js`), sobre `docs`, **antes** de llamar a `mergeIncoming`. Decisión deliberada
  para no tocar la firma ni sus dos consumidores.
- **Por qué eliminarlo:** si `_up` entrara en Dexie, viajaría en los respaldos, se resubiría en
  el siguiente push y ensuciaría los registros locales. Como campo de transporte solo de nube, el
  registro local queda **idéntico a hoy**.
- **Riesgo:** ninguno identificado. `syncTs` no lo mira, así que el LWW no se altera ni antes ni
  después del borrado.

### C3 — `src/features/sync/syncEngine.js` · `startRealtime` e `initialPull`

El cambio de más peso y donde vive el riesgo principal.

- Estado de sesión nuevo: `cursorSesion[col]`, poblado al arrancar y limpiado en `stopRealtime`.
- `startRealtime`: la referencia pasa de `collection(fs, 'businesses', bid, col.name)` a
  `query(collection(...), where('_up', '>', cursorSesion[col.name]))`.
- `initialPull`: **la misma consulta con el mismo valor**.
- **Bypass (comportamiento clásico, byte a byte):** si la bandera está apagada, **o** la tabla
  local está vacía, **o** el dispositivo no está reconciliado → consulta **sin filtro**, como hoy.
- Avance del cursor persistido: solo si la respuesta vino del servidor, y con el margen de 5 min.
- **Riesgo R1 (crítico):** ver §6.
- **Nota:** `restartRealtime()` reusa `cursorSesion` sin recalcularlo, para no romper el enganche
  a media sesión.

### C4 — Cursor de bajada en `syncState`

Claves nuevas `pull:<colección>`, paralelas a las `push:<colección>` que ya existen (verificado:
hoy `syncState` solo tiene `push:*` y `retry:*`). Más una clave de reconciliación por dispositivo.

- **`syncState` NO está en `SYNC_COLLECTIONS`** (verificado: 0 coincidencias) → es local y no
  viaja a la nube. Correcto para un cursor.
- **Pero sí viaja en los respaldos** → ver C5.

### C5 — `src/features/backup/backupService.js`

Excluir las claves `pull:*` de `syncState` en `buildBackup` **y** en `applyBackup`. Añadir la
bandera a `DEVICE_ONLY_KEYS`.

- **Verificado: hoy `buildBackup` recorre `db.tables` y solo excluye `errorLog`**, así que
  `syncState` se respalda y se restaura entero.
- **Por qué importa:** restaurar un respaldo viejo le diría al dispositivo "ya bajé hasta aquí"
  cuando es mentira → hueco permanente.
- **Decisión: filtrar solo `pull:*`**, dejando `push:*` y `retry:*` exactamente como hoy. Excluir
  los cursores de subida también sería seguro (el re-push es idempotente por id) pero
  provocaría una resubida completa innecesaria, y sería un cambio de comportamiento que este plan
  no necesita.

### C6 — Bandera de licencia local

Clave nueva en `config` (p. ej. `pullFiltrado`), **apagada por defecto**.

- Añadir a `LOCAL_CONFIG_KEYS` (`collections.js`) → no viaja a la nube.
- Añadir a `DEVICE_ONLY_KEYS` (`backupService.js`) → no viaja en respaldos.
- Es el mismo patrón que `syncEnabled` y `licenseToken`, ya existentes en esas dos listas.

### C7 — `src/features/sync/collections.js`

**No se toca `TS_FIELDS`.** `_up` **no** debe entrar en `syncTs`: el LWW sigue decidiéndose
exactamente con los mismos seis campos de hoy. Único cambio: añadir la bandera a
`LOCAL_CONFIG_KEYS` (C6) y un comentario que deje escrito por qué `_up` está deliberadamente
fuera.

### C8 — Fase 0: instrumentación (va ANTES de todo lo demás)

- `SyncProvider.runPull`: en el `catch` y en la rama `res.ok && !res.fromServer`, llamar a
  `logError('sync', ...)` con el **código real** de Firestore.
- `syncEngine`: el callback de error de `onSnapshot` también registra.
- El aviso al usuario distingue `resource-exhausted` de un fallo de red (hoy los dos dicen
  *"El servidor no respondió"*).
- **Verificado: hoy `logError` lo llama solo `pushEngine.js:85`. La bajada no registra nada en
  ningún sitio.** El modo de fallo más importante del sistema es el único sin rastro.
- **Riesgo: ninguno.** Escribe solo en `errorLog`, que es local (Dexie v6), no sincroniza, no
  viaja en respaldos y ya se poda a 200 entradas.

### Lo que NO se toca (lista de verificación antes de fusionar)

- `TS_FIELDS`, `syncTs`, `tsAfter` y todas las fechas de negocio.
- Los cursores de subida `push:<col>` y la cola `retry:<col>`.
- `recomputeStock`: sigue derivando el stock del libro **local completo** (en Dexie no se borra
  nada; el filtro solo cambia lo que se **baja**).
- Los ids deterministas y toda la idempotencia.
- El nombre de la base Dexie (`'mypicuadre'`, `db.js:17`) y los `APP_TAG` de respaldo y traspaso.
- **Ninguna versión nueva de esquema Dexie.** No hay v20.
- **Las cadencias: `PUSH_INTERVAL_MS`, `PULL_INTERVAL_MS`, `NUDGE_DEBOUNCE_MS`,
  `FOREGROUND_PULL_MIN_MS` y `RECOVER_MIN_MS` quedan intactas.** La experiencia del usuario no
  cambia: es requisito explícito del dueño.
- **`firestore.rules`: no se toca y no hay que redesplegar.** `allow create, update: if
  isOwner(businessId)` — añadir un campo es un update permitido, y el comodín `{document=**}` ya
  cubre todo el árbol (verificado leyendo el fichero).
- **Índices: no hay que desplegar ninguno.** Firestore indexa cada campo automáticamente, así
  que el rango sobre `_up` funciona sin configuración.

---

## 6. Riesgos

### R1 — El enganche de la consulta filtrada · **CRÍTICO**

Una consulta con filtro tiene otra **forma canónica** que la consulta sin filtro. Si el listener
y el pull no comparten forma exacta, el pull deja de engancharse a la vista en caché y pasa a ser
34 consultas reales por ciclo. A la cadencia actual: **34 × 1.920 = 65.280 lecturas por
dispositivo y día** — mucho peor que hoy y sin aviso.

- **Mitigación de diseño:** el cursor fijo por sesión (§4.4) hace que las dos consultas sean
  idénticas carácter a carácter.
- **No verificado empíricamente.** El mecanismo está leído en el SDK y demostrado por los datos
  del dueño **para la consulta sin filtro**. Con filtro debería comportarse igual (el mapa
  `queries` se indexa por consulta canónica, no por presencia de filtros), pero **hay que
  medirlo**.
- **Criterio de aceptación:** en las 48 h siguientes al encendido, las lecturas del proyecto
  **bajan**.
- **Criterio de reversión:** si suben, apagar la bandera de inmediato y replantear. La reversión
  es una escritura en `config` — no requiere despliegue.

### R2 — Hueco por orden de entrega · misma clase que el hallazgo 3 abierto

Firestore no garantiza que la entrega respete el orden de `_up`. Un documento con sello menor
entregado después del avance del cursor se perdería para siempre.

- **Mitigación:** el margen de 5 minutos (§4.5). Lo hace improbable, **no imposible**.
- **Endurecimiento (fase opcional):** `serverTimestamp()` en lugar del reloj del emisor, y
  avanzar el cursor por el `readTime` del snapshot en lugar del máximo visto. Elimina la clase
  entera. Coste: el cursor pasa a ser un `Timestamp` y no una cadena, con lo que hay que
  manejarlo en `syncState` y en la comparación. **No verificado el comportamiento de
  `serverTimestamp()` con escrituras offline en este código.**

### R3 — Desfase de reloj (~21 s, documentado) · cubierto por el mismo margen de 5 minutos.

### R4 — Documentos sin `_up` · cubierto por la reconciliación obligatoria (§4.6), que se marca
solo tras un pull completo **confirmado por el servidor**. Si falla a medias, la bandera no se
enciende.

### R5 — Huecos preexistentes por los cortes de cuota de estos meses · misma mitigación que R4.

### R6 — IndexedDB desalojado por el navegador · bypass "tabla local vacía → consulta sin
filtro". (`storage.persist()` del Bloque 32 ya reduce la probabilidad.)

### R7 — Respaldos que arrastran el cursor · cubierto por C5.

### R8 — Multipestaña (`persistentMultipleTabManager`) · las dos pestañas comparten la misma
Dexie, así que cuando una avanza el cursor el dato ya está fusionado localmente. El margen de 5
minutos absorbe la carrera. Impacto: unas pocas lecturas repetidas.

### R9 — Almacenamiento e índices · un campo ISO (~24 B) más su entrada de índice automática por
documento. Con 33 negocios y ~20.000 documentos cada uno: decenas de MB, muy por debajo del 1 GiB
gratis. Y la consulta lleva **un solo campo de rango**, lo que según la documentación de
facturación la deja en la excepción que no cobra lecturas de entradas de índice.

### R10 — Reglas de Firestore · no requieren cambio ni redespliegue (§5, última lista).

---

## 7. Fases, criterios de aceptación y reversión

| Fase | Qué | Aceptación | Reversión |
|---|---|---|---|
| **F0** | Instrumentar la bajada (C8) | Aparecen entradas de bajada en `/errors` con el código real de Firestore | Aditivo; no hay nada que revertir |
| **F1** | `_up` en `toCloud` (C1) + borrado en `mergeIncoming` (C2). **La bajada sigue completa.** | `npm run build` limpio; las lecturas **no cambian**; los documentos nuevos en la nube llevan `_up` | Quitar el campo; los documentos con `_up` siguen siendo válidos |
| **espera** | Varios días, hasta que todos los dispositivos hayan subido al menos una vez | — | — |
| **F2** | Cursor (C4), consulta filtrada (C3), bandera apagada (C6, C7), respaldos (C5), reconciliación (§4.6) | `npm run build` limpio; con la bandera apagada el comportamiento es **idéntico** al de hoy | La bandera ya está apagada |
| **F3** | Reconciliar y **encender en UN negocio** | 48 h de consola: las lecturas bajan **y** el pull sigue costando cero | Apagar la bandera (escritura en `config`) |
| **F4** | Abrir negocio a negocio | Las lecturas del proyecto se mantienen por debajo del tope | Apagar por negocio |
| **F5** | *(Opcional)* Endurecer con `serverTimestamp()` | Elimina la clase R2 | Volver al reloj del emisor |

**Antes de cada commit: `npm run build` limpio.** Las 8 suites `.test.mjs` no cubren el motor de
sync (`retryQueue.test.mjs` cubre solo la cola de reintentos, que este plan no toca), así que
**se corren para comprobar que no se rompió nada, no como prueba de este cambio**.

---

## 8. Números esperados

| | Lecturas/día | % del tope Spark |
|---|---|---|
| Hoy, ~7 negocios activos | 60.000 | **120 %** |
| Con el filtro, 7 negocios | ~7.300 | 15 % |
| **Con el filtro, los 33 negocios** | **~34.300** | **69 %** |
| Con el filtro, 45 negocios | ~47.000 | 94 % — el techo |

Cálculo: ~833 documentos cambiados por negocio y día (5.833 escrituras medidas ÷ 7 negocios
activos deducidos), leídos una vez por el dispositivo par, más ~200 de mínimos por consulta.

**Lo que de verdad cambia:** las lecturas dejan de crecer con la **historia** y pasan a crecer
solo con la **actividad**. Hoy el coste de un arranque en frío sube todos los días porque nada se
borra; después del cambio queda acotado por el volumen de ventas real.

**Límite honesto: esto lleva la cartera a 33 negocios y a unos 45. No más.** Spark conserva el
tope duro. Para 60 u 80 negocios haría falta además Blaze o partir en proyectos (y con Blaze el
coste medido sería del orden de unidades de dólares al mes, aunque la tarifa exacta por lectura
no se pudo validar en la página de Google Cloud, que vuelve truncada o redirige en bucle).

---

## 9. Lo que NO se puede garantizar

Honestidad explícita, en los términos de la regla 5 del dueño:

1. **Nadie ha ejecutado nada de esto.** Ni la fase 0. Todo se validó por **código + documentación**,
   nunca por runtime en un dispositivo.
2. **Que el enganche sobreviva al filtro (R1).** Es el riesgo principal y solo se resuelve
   midiéndolo en la fase 3, con la consola delante.
3. **El comportamiento de `serverTimestamp()`** con escrituras offline y con la fusión LWW en
   este código. Sin verificar; por eso F5 es opcional y va al final.
4. **Los números del §8** salen de una deducción sobre otra: ~833 cambios/negocio/día viene de
   dividir 5.833 escrituras medidas entre 7 negocios activos **deducidos** de la concurrencia
   pico. Si los activos son 5 o 10, las cifras se mueven (la pendiente, no).
5. **D ≈ 1.476** es suma de promedios de una tabla con nombres de colección **truncados**. El
   número real se obtiene con consultas de agregación `count()` desde la consola (≈ 1 lectura por
   cada 1.000 entradas de índice, y las agregaciones no entran en el panel de métricas
   facturables).
6. **Cuántos negocios tienen la nube activada.** Pendiente de que el dueño lo confirme en
   Authentication. Todo el §8 depende de ese número.
7. **Que el daño actual sea pequeño.** Es deducción de la concurrencia pico, no de los negocios
   reales. Un negocio con dos dispositivos vendiendo en paralelo después del corte **sí** pierde
   convergencia, y hoy eso no deja rastro (por eso F0 va primero).
8. **`deliveries`** quedó clasificada como mutable por precaución: su repo documenta una
   anulación que el grep no encontró. Irrelevante para este plan (`_up` cubre mutables), pero
   queda anotado.

---

## 10. Decisión pendiente

**Este plan no se ejecuta hasta que el dueño lo apruebe.** Lo que hay que decidir:

1. ¿Se ejecuta, y hasta qué fase?
2. ¿F0 (instrumentación) por separado y ya, dado que es aditiva y sin riesgo, o todo junto?
3. Confirmar el número de negocios con sincronización activa.
4. Si además se contrata Blaze, este plan **no se descarta**: pasa de emergencia a optimización
   de margen, y se hace sin prisa. Pero entonces el orden cambia y conviene revisar las fases.
