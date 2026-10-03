# Oyentes filtrados por marca de llegada (F5), sin configuración del usuario — diseño

**Fecha:** 03-10-2026 · **Rama:** `claude/awesome-dirac-484azm` · **Estado: v2.1 — APROBADO PARA PLAN
tras DOS pasadas de revisión adversarial independiente (03-10-2026). CERO CÓDIGO ESCRITO.**

Continúa `2026-09-24-reduccion-cuota-design.md` (su F5) y `2026-09-27-subida-sin-eco-design.md`. Hay
que leer los dos antes que este.

**Historia del fichero:**

- **La v1 tenía tres fallos críticos**, todos con la misma raíz. Hoy cada relectura completa **cura**
  cualquier divergencia local, y la v1 quitaba esa cura sin poner nada en su lugar.
- **La v2** los cerró.
- **La segunda revisión** encontró cinco fallos importantes en la v2. Esta v2.1 los cierra:
  - la guarda no veía un build viejo corriendo **ahora**;
  - el detector daba falsos positivos con el cursor de F2;
  - la restauración no curaba lo que difiere F2;
  - las recuperaciones renovaban de más;
  - el «conjunto conocido» costaba relecturas sin aportar seguridad. Se **elimina**.

---

## 1. El problema, con evidencia

**Síntoma (dueño, 03-10-2026):** las escrituras bajaron, pero las lecturas se comen la cuota Spark
(50 k/día) desde temprano.

**Lo desplegado, comprobado sobre un dato real:**

- `origin/main` = `5f09101` (F1 + F2 + subida sin eco).
- El respaldo de **Burger Premium del 03-10-2026** (`Downloads\respaldo_mypicuadre_2026-10-03.json`,
  exportado a las 14:00 UTC por «Abar») trae `config.bajadaFiltrada = true` desde el
  2026-09-30T15:53Z. Es decir, **F2 está desplegado y encendido en Burger**.
- La base de Burger: **14.100 documentos**, de ellos **10.181 `stockMovements`**.

**Causa, verificada en tres fuentes:**

1. **Facturación de Firestore** (`firebase.google.com/docs/firestore/pricing`, leída el 03-10-2026):
   - *«If offline persistence is enabled and the listener is disconnected for more than 30 minutes …
     you will be charged … as if you had issued a brand-new query.»*
   - La cuota se reinicia *«around midnight Pacific time»*: **las 03:00 en Cuba todo el año**, porque
     los dos países cambian de horario el mismo día.
2. **El código:** `startRealtime` abre un `onSnapshot` **sin filtro** por cada colección viva
   (`syncEngine.js:315`). Con F2 en un negocio con mesas son 33 de 34. Cada enganche en frío relee
   esas colecciones **enteras**.
3. **Los datos:**
   - **En Burger, con F2 encendido, cada enganche en frío de cada aparato relee 3.919 documentos.**
   - En el respaldo del 22-09: 2.747 documentos, 1.907 diferidos y 840 que se releen.
   - Lo que queda vivo es append-only y crece cada día. **F2 nunca iba a bastar**: su propia spec le
     daba 0,6 meses.

**El registro de errores exportado el 03-10** (`errores_mypicuadre_2026-10-03.txt`, un PC con Edge):

- empareja `bajada-sin-servidor` con `recuperacion-sesion token-no-renovado`;
- el token se renueva contra Auth, no contra Firestore, así que **ese registro apunta a cortes de
  conectividad tanto como a la cuota**;
- **no hay ni una entrada `bajada-oyente-caido`**.

---

## 2. Decisiones del dueño (03-10-2026)

| # | Decisión |
|---|---|
| **D1** | **Excepción explícita a la regla 2:** la medida **se enciende sola**, sin ninguna bandera que el usuario del negocio tenga que tocar. Decide la guarda (§5.3). |
| **D2** | **Interruptor de emergencia = constante en el build** (`OYENTES_FILTRADOS` en `src/features/sync/f5Config.js`). Vale `[]` (nadie), una lista de `uid` de negocios (piloto) o `'todos'`. Apagar = desplegar. |
| **D3** | **Aparato olvidado: 7 días** para los que ya publicaron `caps.up` (build de `main` o posterior). **30 días** para los que no lo publicaron nunca (builds anteriores a F1: el detector en el dato no puede verlos). Es una constante; **queda pendiente de que el dueño la reconfirme**. |
| **D4** | **ABIERTA:** los paneles de `/cloud` de subida sin eco y bajada filtrada **no se tocan**. Solo se añade una tarjeta de estado de F5, de solo lectura, con la herramienta de reparación de §5.7. |

---

## 3. El principio que manda: lo que hoy cura la relectura completa

Hoy, cada 45 s, `initialPull` vuelve a fusionar por LWW **la colección entera**, y no cuesta nada
porque comparte la vista del oyente. Además, cada enganche en frío relee todo. Con un filtro, todo lo
que quede por debajo del cursor **deja de curarse para siempre**. Por eso cada camino de divergencia
necesita su sustituto:

| Camino | Hoy | Con F5 | Pieza |
|---|---|---|---|
| Tanda descartada en `handleIncoming` (`syncEngine.js:288-291`), o app muerta antes de fusionar | se cura en ≤45 s | el cursor **solo** avanza tras fusionar con éxito | §5.5 |
| Restaurar un respaldo (`backupService.js:109-134`: `bulkPut` sin LWW, conserva las `pull:`) | se cura en ≤45 s | borra el estado de F5 **y el veredicto de F2** → vuelve al vivo y reconcilia | §5.7 |
| Importar un turno (`handoffService.js:187-207`: `bulkPut` sin LWW) | se cura en ≤45 s | igual que el respaldo | §5.7 |
| `recomputeStock` de todos los productos entrantes cada 45 s (`pullEngine.js:52-53`) | se cura en ≤45 s | `recomputeStock` local de todo al arrancar, con cero lecturas | §5.7 |
| Un aparato que sube sin sello completo (build viejo, o vuelta atrás a `main`) | la relectura lo trae | lo detectan la guarda, el oyente de `/devices`, la marca de build viejo o el detector en el dato, y se vuelve al vivo | §5.3 |
| Un documento editado en la consola fuera de `config` | se ve en ≤45 s | **no se ve nunca** (declarado) | §9 |

---

## 4. Lo verificado en el SDK instalado (firebase 12.15.0, `@firebase/firestore` 4.16.0)

Leído en el código del SDK y comprobado también por la revisión independiente. **No se ha observado
contra el servidor.**

- **La forma canónica de una consulta incluye el VALOR del filtro.** Lo hacen `canonifyTarget`
  (`common-1409c9f9.node.cjs.js:7152`) y `canonifyFilter` (`:6725`). `getDocs` funciona como un
  oyente temporal (`:39179`), y `eventManagerListen` lo agrupa con el oyente que tenga la misma forma
  canónica (`NoActionRequired`, `:35843-35895`).
  - **Consecuencia:** el oyente y el pull comparten vista si y solo si usan el mismo cursor. Por eso
    los dos usan **el mismo objeto de consulta**.
  - **Consecuencia:** reabrir con la misma consulta conserva el token de reanudación; con otra no.
- **Un filtro de rango solo casa con valores del mismo tipo.** Lo comprueba `FieldFilter.matches`
  (`:6614-6625`). En `typeOrder`, `Timestamp` = 3 y `ServerTimestamp` = 4.
  - Una escritura propia pendiente sale de la vista local y vuelve cuando el servidor la confirma, como
    `added` y sin `hasPendingWrites`.
  - Para los datos es inocuo: `mergeIncoming` no la reescribe, porque su marca LWW es igual.
  - **El SDK no la distingue de un cambio ajeno.** Ninguna métrica de este diseño cuenta documentos
    entrantes.
- **`merge:true` es profundo** (`parseSetData`, `:17731`): un `caps.upAll` sobrevive a una escritura
  posterior hecha por el build de `main`.
- **La caché es persistente y multipestaña** (`lib/firebase.js:33`).

---

## 5. Las piezas

### 5.1 Sellar todo salvo `config`, con una marca de build

- **`F5_SEALED` = todas las colecciones de `SYNC_COLLECTIONS` salvo `config`.**
  - Los builds F5 las sellan **con la constante encendida o apagada**.
  - El sello de F1 (`SEALED`, `stockMovements` y `sales`) queda como está, para F2.
- **No hay escrituras de más:** el sello viaja en la escritura de siempre.
- **Todo lo que sella un build F5 lleva además `_f5: 1`.** `stripUp` quita `_up` **y** `_f5` antes de
  Dexie.
  - Un documento con `_up` y **sin** `_f5` solo puede venir de un build de `main`.
  - Lo contrario no es cierto: `main` guarda `_f5` en su Dexie y lo puede volver a subir copiado al
    editar una fila nacida en F5. Son falsos negativos del detector, declarados en §9.
- **`config` se queda sin filtro:** es pequeña, y el procedimiento documentado para tocar banderas
  desde la consola escribe sin `_up`.
- **`compareResend` sella** (`_up` + `_f5`). Su `tx.set` (`compareResendFirebase.js:29`) reemplaza el
  documento entero.

### 5.2 Capacidad y marcas en `/devices`

Los builds F5 añaden lo siguiente en el `setDoc` de siempre (`deviceRegistry.js:95`):

- **`caps = { up: 1, upAll: 1 }` y `sealAllSeenAt`** (hora del servidor).
  - Siguen escribiendo `sealSeenAt`: sin él, un aparato con `main` en un negocio con F2 bloquearía
    su propio filtro.
- **`upAllLegacyAt`** cuando la ficha anterior (`prev`) revela que en ese aparato corrió un build sin
  sello completo desde la última vez. Eso ocurre en dos casos:
  - **`prev` existe sin `sealAllSeenAt`, pero con `lastSeenAt`**: el aparato venía de un build anterior
    a F5;
  - **`prev.lastSeenAt > prev.sealAllSeenAt`**: un build sin F5 lo tocó después de la última vez que
    selló.

  Es necesaria porque la escritura F5 iguala las dos marcas y **borraría la evidencia**. Cierra el C1
  de la revisión: un aparato olvidado que vuelve con el build viejo, sube sin sello y se actualiza en
  la misma apertura.

### 5.3 La guarda (D1) y los detectores

**«Ahora» es la hora del SERVIDOR:** el mayor `lastSeenAt` que devuelve `/devices`. Si no hay ninguno,
se usa `Date.now()`. Se mide así porque un teléfono con la fecha mal no puede decidir ni el olvido ni
el bloqueo.

**Un aparato filtra en este arranque si, y solo si, se cumplen las cinco condiciones:**

1. **Su negocio está en `OYENTES_FILTRADOS`** (D2).
2. **La subida sin eco está activa** (§5.6).
3. **`config.oyentesBloqueoHasta` no está por delante de «ahora».**
4. **Todos los aparatos activos y no olvidados** (D3):
   - (a) publican `caps.upAll`;
   - (b) **no tienen `lastSeenAt > sealAllSeenAt`**: un build sin F5 corriendo **ahora**, por ejemplo
     tras volver atrás a `main`;
   - (c) **no tienen `upAllLegacyAt` posterior** a la reconciliación de este aparato.
5. **Hay una reconciliación vigente** (§5.4).

**Detectores, para que nada se escape entre arranques:**

- **Oyente vivo de `/devices`** (solo mientras se filtra).
  - Re-evalúa la condición 4 con cada cambio. Si no se cumple, **vuelve al vivo en el acto**.
  - Si la respuesta llega de caché, no decide nada.
  - Si el oyente muere, la garantía vuelve a ser la del arranque siguiente (declarado).
- **Detector en el dato** (solo mientras se filtra).
  - Salta con un documento que trae `_up` y no trae `_f5`, y cuyo `_up` supera **el corte del
    detector**.
  - **El corte es el mayor `sealAllSeenAt` entre los aparatos que la guarda dio por buenos en la
    reconciliación.** Todo lo que un aparato subió legítimamente con `main` es anterior a su propio
    `sealAllSeenAt`. Así no hay falsos positivos por la transición, tampoco al reutilizar el cursor de
    F2.
  - Al saltar:
    - se vuelve al vivo;
    - se escribe `config.oyentesBloqueoHasta` = el mayor `_up` de los documentos culpables + 24 h. Es
      hora del servidor, en una sola escritura, y baja a todos los aparatos.
  - Cubre la pestaña de un PC con el build de `main` abierta durante días, que no se vuelve a
    registrar.
- **Si `/devices` llega ilegible al arrancar** (de caché): **se conserva el veredicto anterior**, en
  vez de volver al vivo como hace F2.

**Volver al vivo:**

- se borran el veredicto y la reconciliación de F5;
- se reabre el tiempo real **sin el filtro de F5**, y esa relectura cura;
- lo que F2 tenga diferido **sigue diferido**: F2 gobierna sus colecciones como hoy, con su guarda y
  sus `_up` de F1;
- el coste es una relectura completa de las colecciones vivas de ese aparato.

### 5.4 Reconciliación de la transición

- **Se hace con las colecciones todavía en vivo y sin filtro.** Su `getDocs` comparte la vista del
  oyente y no cuesta lecturas. El filtro entra **en el arranque siguiente**, o en el siguiente
  `restartRealtime`.
- **Las colecciones que F2 ya difería** (`stockMovements` en Burger) no tienen oyente: un `getDocs`
  sin filtro sería una lectura completa real. **Se reutiliza su cursor de F2**, que significa lo mismo.
- **Las colecciones vacías o sin nada sellado** toman como cursor el mayor `_up` visto en las
  colecciones leídas antes en la misma reconciliación, menos el margen. Se empieza por
  `stockMovements`.
  - Es seguro porque todo lo que entre después en una de esas colecciones trae un `_up` mayor que la
    hora de su lectura.
  - Si no hay nada sellado en ninguna colección, se reintenta en el arranque siguiente.
- **Cosas que guarda**, bajo `pull:` para que no viajen en el respaldo:
  - `pull:<negocio>:f5:veredicto`;
  - `…:f5:reconciliado`: hora del servidor, el mayor `_up` visto;
  - `…:f5:corte`: el corte del detector;
  - `…:f5:sesion`: la consulta en uso y su último snapshot del servidor, por colección.
- **Los cursores por colección son los mismos de F2** (`pullCursorKey`). Significan lo mismo, y así un
  retroceso a `main` sigue bajando bien.
- **Con F5 activo, el efecto de F2 no corre.**

### 5.5 El cursor: cuándo avanza, cuándo se reutiliza y cuándo se renueva

- **Solo avanza en el pase de `initialPull` (cada 45 s).** Ese pase es serie, fusiona la vista de
  sesión **completa** y mira `fromCache`. El cursor de una colección avanza a `max _up − 120 s` solo
  si se cumplen las tres:
  - la respuesta vino **del servidor**;
  - `mergeIncoming` y `recomputeStock` terminaron **sin excepción**;
  - se escribe **al final** del pase.

  El oyente fusiona para dar latencia, pero **nunca** mueve el cursor (C2).
- **La consulta de sesión** vive en un mapa del módulo, con un objeto por colección. El oyente y
  `initialPull` usan **ese mismo objeto**.
  - **Al arrancar** se reutiliza la consulta de la sesión anterior (mismo cursor, así que el token
    sigue valiendo) si su último snapshot del servidor tiene menos de 25 min. Si no, se usa el cursor
    persistido.
  - **`restartRealtime` sin más** (recuperación de sesión, *Sincronizar ahora*) **reutiliza la consulta
    en memoria**, igual que hoy.
- **Se renueva con el cursor persistido** (consultas nuevas) solo en dos casos, y siempre con un freno
  de 25 min entre renovaciones:
  1. **cuando la vista de sesión de alguna colección pasa de 300 documentos Y su cursor persistido ya
     avanzó** respecto al de la consulta en uso;
  2. **al volver al frente tras más de 25 min oculta.**
- **Oyente muerto:** se lleva la cuenta de qué oyentes siguen vivos.
  - Sobre uno muerto **no** se hace `getDocs`: crearía su propio target, y eso es una consulta real
    cada 45 s.
  - Se reabre **solo ese oyente**, con espera creciente: 5, 10, 20 y 40 min, y después cada 60 min.

### 5.6 Subida sin eco por defecto, también para `main`

Con todo sellado, cada eco cambia el documento y cuesta lecturas en todos los demás aparatos (I1 e I2
de la revisión). Por eso:

- **`getSubidaSinEco` lee la clave ausente como `true`.**
- **El build F5 escribe `config.subidaSinEco = true` si la clave falta.** Es una escritura por negocio.
  - **Solo después de que `config` haya bajado del servidor en este aparato.** En uno recién vinculado
    la clave «falta» porque todavía no bajó, y escribir antes pisaría por LWW un `false` del dueño.
  - Así **los aparatos con `main` también dejan de hacer eco**. Si siguieran, un eco de `main` le
    quitaría el `_up` a un documento sellado por F5 y despertaría a todos.
- **Si el negocio la apagó a mano, se respeta.** En ese caso F5 no se enciende (condición 2) y el
  estado lo dice.
- **El libro de ecos se comparte entre pestañas por `BroadcastChannel`.** Puede perder una carrera
  (declarado).

### 5.7 Lo que devuelve la cura

- **`applyBackup` y la importación de turno dejan en blanco**, para cualquier negocio:
  - las claves de F5 (`pull:*:f5:*`);
  - el veredicto y la reconciliación de F2 (`pull:*:diferidas`, `pull:*:reconciliado`).

  En el arranque siguiente el aparato vuelve al vivo **de todo**, relee, cura y reconcilia. Los
  cursores por colección se conservan: nunca retroceden, y tras la relectura completa son correctos.
- **`recomputeStock` local de todos los productos al arrancar** con F5 activo. Cero lecturas.
- **Herramienta del dueño en la tarjeta de `/cloud`: «Volver a bajar todo en este aparato»**
  (el I5 de la revisión).
  - Hace lo mismo que la restauración y avisa del coste: una relectura.
  - Es una reparación opcional, **no una configuración necesaria** (D1).

### 5.8 El estado, visible para el dueño

Al **decidir**, cada aparato hace un `setDoc` con `merge` en su ficha de `/devices` (una escritura
más por arranque). Lleva:

- **`f5Estado`**: `'filtrando'` o el motivo por el que no filtra;
- **`f5VistaMax`**: la mayor vista de sesión de la sesión anterior;
- **`f5Reaperturas`**: un **indicador** de enganches en frío de la sesión anterior. No es una medida:
  el SDK no los expone. Cuenta el arranque, las vueltas al frente tras más de 30 min oculta y las
  reconexiones tras estar sin red.

El dueño lo lee en la consola, sin pedírselo a nadie.

---

## 6. Despliegue, sin acción del usuario

| Paso | El dueño despliega | Qué cambia en los aparatos | Criterio para seguir |
|---|---|---|---|
| **1** | `OYENTES_FILTRADOS = []` | Sellan todo con `_f5`, publican `upAll`, la subida sin eco queda activa en todos (incluidos los que siguen con `main`) y publican su estado | 48 h: lecturas y escrituras **no suben**. Los documentos nuevos llevan `_up` y `_f5`, y las fichas de `/devices` muestran `upAll` |
| **2** | `['<uid de Burger>']` | Burger reconcilia en vivo y filtra desde el arranque siguiente | 48 h: las lecturas **bajan** y no crecen de un día a otro. Fichas en `'filtrando'` |
| **3** | `'todos'` | Cada negocio se enciende solo cuando sus aparatos lo permiten | Igual que el paso 2 |
| **Atrás** | La constante anterior | Al reabrirse, cada aparato vuelve al vivo (una relectura completa) | Lecturas como antes |

---

## 7. Lo que cuesta

- **Hoy en Burger:** 3.919 lecturas **por enganche en frío y por aparato**, y la cifra crece cada día.
- **Con F5, por enganche:** lo llegado desde el cursor (la renovación lo acota) más el mínimo de
  Firestore. Cada cambio se sigue leyendo una vez en cada uno de los otros aparatos, igual que hoy.
- **Lecturas nuevas:**
  - el oyente de `/devices`: N por enganche, más unas 2×(N−1) por cada arranque ajeno (el registro y
    el estado);
  - `readDevices`, que ya se hacía con F2.
- **Escrituras nuevas:**
  - una por arranque (el estado);
  - una por negocio, una sola vez (`subidaSinEco`);
  - una por disparo del detector.
- **Estimación, NO medida: 10 k–20 k lecturas/día en todo el proyecto, casi planas.** Depende de si
  Firestore cobra una lectura por oyente al engancharse; eso no está documentado.
- **Volver al vivo** cuesta una relectura completa por aparato.

---

## 8. Aceptación y reversión

- **Paso 1:** lecturas y escrituras **no suben**.
- **Pasos 2 y 3:** las lecturas **bajan** y **dejan de crecer** con la base.
- **Reversión inmediata:** si suben, el pull dejó de compartir vista (R1). Se despliega con la
  constante anterior.

---

## 9. Lo que NO se puede garantizar

1. **R1 en la consola real:** que el pull comparta vista con el oyente. El SDK lo asegura por
   construcción (mismo objeto); no está observado.
2. **Si Firestore cobra una lectura mínima por oyente al engancharse.**
3. **Builds que ningún detector ve:**
   - una pestaña con un build **anterior a F1** abierta más de 30 días sin recargar;
   - builds anteriores al 24-06, que no se registran en `/devices`.
4. **Falsos negativos del detector en el dato:**
   - un aparato con `main` que solo edite fichas, sin crear `stockMovements` ni `sales`;
   - `main` resubiendo un `_f5` que guardó en su Dexie.

   Mientras la guarda no lo vea, esas ediciones no llegan a los aparatos que filtran.
5. **Una ventana corta** desde que un build viejo empieza a subir hasta que lo detectan. Es de segundos
   si el oyente de `/devices` está vivo, y llega hasta el arranque siguiente si murió.
6. **Las ediciones hechas en la consola** fuera de `config` no bajan nunca a quien filtra.
7. **La carrera entre pestañas** del libro de ecos compartido.
8. **El Hallazgo 1 de la subida sin eco** (reloj atrasado) pasa a afectar a todos los negocios.
9. **Vincular sobre un Dexie vacío y recargar en los 20 s siguientes** resube la base. Es un fallo
   preexistente y **no se corrige aquí**.
10. **No se sabe si la cuota agotada mata los oyentes o solo corta el canal.**
11. **Un aparato con F5 que se degrada a un build viejo sin conexión**, si la cola de mutaciones del
    SDK entrega lo viejo antes de que se pueda leer su ficha. Solo puede pasar al volver atrás un
    despliegue.
12. **Cero runtime:** sin emulador, sin Firestore real y sin teléfono.

---

## 10. Pruebas existentes que cambian a propósito

| Suite | Cambio |
|---|---|
| `deferred.test.mjs` | `stripUp` también quita `_f5` (se añaden casos; los existentes no cambian) |
| `backupFlags.test.mjs` | la clave `subidaSinEco` ausente pasa a leerse `true`; `oyentesBloqueoHasta` no viaja en el respaldo |
| `pushEcho.test.mjs` | caso A: los productos ya salen sellados. Caso B: sin fila es lo mismo que encendida |
| `pushTrace.test.mjs` | borra también `_f5` de la huella y escribe `subidaSinEco=false` con fecha fija. Así sigue comparando el camino clásico con `main` **byte a byte** |
| `cursorType.test.mjs` | **no cambia**: la consulta de F5 vive en `f5Engine.js` y tiene su propio candado |

**Cada cambio se hace a propósito y con su motivo**, y con un **control negativo**: una mutación del
código que demuestre que la suite sigue detectando un fallo.

---

## 11. Datos que faltan (los saca el dueño de la consola, sin pedírselos a ningún cliente)

1. Fecha del despliegue de `5f09101`.
2. Qué negocios tienen escritas en su `config` las claves `bajadaFiltrada` y `subidaSinEco`, y con
   qué valor.
3. Lecturas y escrituras por día desde ese despliegue y, si se puede, por hora.
4. Cuántos negocios tienen la nube activa.
