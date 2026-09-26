# Reducción de la cuota de Firestore — plan de implementación (F1 + F2)

> **Para agentes:** SUB-SKILL OBLIGATORIA: usar `superpowers:subagent-driven-development`
> (recomendada) o `superpowers:executing-plans` para ejecutar este plan tarea a tarea. Los pasos
> llevan casilla (`- [ ]`) para ir marcándolos.

**Objetivo:** sellar cada documento con la hora en que LLEGÓ a la nube y bajar por ese sello las dos
colecciones más pesadas (`stockMovements` siempre, `sales` solo sin `mesas`), para que las lecturas
del proyecto dejen de ser proporcionales a la historia del negocio.

**Arquitectura:** todas las DECISIONES viven en un módulo **puro** nuevo,
`src/features/sync/deferred.js` (sin Dexie, sin Firestore, sin React), con su suite de node. Los
seis ficheros existentes que se tocan quedan como cableado fino: leen el estado, preguntan al módulo
puro y actúan. Es el patrón que ya funciona en este repo con `compareResend.js` (puro) +
`compareResendEngine.js` (todo inyectado) + `compareResendFirebase.js` (lo conecta a lo real).

**Stack:** React 18 · Dexie 4 · `firebase` 12.15.0 / `@firebase/firestore` 4.16.0 · pruebas con
`node fichero.test.mjs` (no hay `npm test` ni linter).

**Spec:** `docs/superpowers/specs/2026-09-24-reduccion-cuota-design.md`.
**Precedencia: §10.5 manda sobre §10, y §10 sobre §1–§9.** Quien ejecute este plan lee las dos.

---

## Antes de empezar: tres cosas que no son negociables

1. **Esto TOCA la lógica de producción de la sincronización, que es la regla 2 del proyecto.** El
   grueso (F2) queda detrás de una bandera **apagada por defecto**, así que el comportamiento por
   defecto es idéntico al de hoy. Pero **F1 (el sello) NO tiene bandera**: en cuanto se despliegue,
   todos los aparatos de todos los negocios añaden un campo a lo que suben. **Hace falta
   autorización explícita del dueño para F1**, y está declarada en el spec (§10, decisiones D1–D4,
   25-09-2026).
2. **Las fases F1 y F2 del spec §5 se FUSIONAN en un solo build.** La «espera de varios días» que
   había entre ellas la sustituye la **guarda automática** de D2: un aparato no filtra hasta que
   *todos* los aparatos activos publican que sellan. Escribir F2 en un build posterior no compraría
   nada y duplicaría el despliegue.
3. **F5 (extender el filtro al OYENTE) NO entra en este plan.** Es donde vive R1, y el spec lo pone
   al final a propósito: se afronta con el sello y el cursor ya probados en producción. Tendrá su
   propio plan cuando F3/F4 den datos de consola.

## Restricciones globales

- **Idioma español** en UI, comentarios y mensajes de commit. Imitar el estilo del código vecino.
- **`npm run build` limpio (exit 0) antes de cada commit.** Es la única puerta estática: no hay linter.
- **Cero esquema Dexie nuevo.** No hay v20. `syncState` ya existe (v3) y no está en
  `SYNC_COLLECTIONS`, así que los cursores nuevos son locales y no viajan a la nube.
- **Cero colecciones de sync nuevas.** `SYNC_COLLECTIONS` sigue en **34**.
- **`firestore.rules` no se toca y no hay que redesplegar.** Añadir un campo es un `update`
  permitido y el comodín `{document=**}` ya cubre el árbol.
- **Índices: ninguno que desplegar.** Firestore indexa cada campo automáticamente y la consulta
  lleva **un solo campo de rango**.
- **No se tocan** `TS_FIELDS`, `syncTs`, `tsAfter`, los cursores `push:*`, la cola `retry:*`,
  `recomputeStock`, los ids deterministas, ni `PUSH_INTERVAL_MS` / `PULL_INTERVAL_MS` /
  `NUDGE_DEBOUNCE_MS` / `FOREGROUND_PULL_MIN_MS` / `RECOVER_MIN_MS`.
- **`_up` NO entra en `syncTs`:** el LWW se sigue decidiendo con los mismos seis campos de hoy.
- **Colecciones con sello: exactamente dos** (`stockMovements`, `sales`). Ampliar la lista exige
  medir antes, por el eco del §10.4.

## Foco de revisión

Cinco entradas que el diseño implica, que ninguna prueba del repo ejercita hoy y que son las que más
probablemente muerdan a quien use esto. Cada una tiene su prueba en la tarea que posee ese código.

1. **El cursor guardado se pasa en crudo al filtro.** `syncTs` y los cursores `push:*` son cadenas
   ISO; `_up` en la nube es un `Timestamp`. Firestore ordena primero por tipo (`Timestamp`=3,
   `String`=5), así que `where('_up','>', <cadena>)` devuelve **cero documentos, sin error**. → Tarea 1.
2. **`_up` llega en cuatro formas distintas:** `Timestamp` del SDK, `{seconds,nanoseconds}` plano
   (caché/serialización), `Date`, o **ausente** (documento subido por un build viejo). Si la
   conversión da `NaN`, el cursor queda envenenado para siempre. → Tarea 1.
3. **Dos documentos con el MISMO `_up`, o el cursor que no debe retroceder nunca.** El límite es
   estricto (`>`), así que sin margen se pierde el que empate al milisegundo. → Tarea 1.
4. **`/devices` vacío, ilegible o con un aparato que lleva meses sin abrirse.** La guarda tiene que
   decir **NO** en los tres casos (lado seguro: no filtrar), nunca «sí» por omisión. → Tarea 4.
5. **La respuesta vino de la caché, no del servidor.** El cursor solo puede avanzar con
   `fromServer === true` **de esa colección**, no del O global de `initialPull`. Avanzarlo con una
   respuesta de caché deja un hueco permanente en el libro. → Tarea 6.

---

## Estructura de ficheros

**Nuevos**

| Fichero | Responsabilidad |
|---|---|
| `src/features/sync/deferred.js` | **PURO.** Todas las decisiones: qué se sella, cómo se sella, el tipo y la aritmética del cursor, la guarda de aparatos, qué se difiere y cuándo suena el timbre. Sin Dexie, sin Firestore, sin React. |
| `src/features/sync/deferred.test.mjs` | Suite de node del módulo puro. Se corre con `node src/features/sync/deferred.test.mjs`. |

**Modificados**

| Fichero | Qué cambia |
|---|---|
| `src/features/sync/pushEngine.js` | Sella tras `toCloud` en los tres sitios que suben (`:65` y sus llamantes). |
| `src/features/sync/pullEngine.js` | `mergeIncoming` quita `_up` antes del `bulkPut` y devuelve el máximo visto. |
| `src/features/sync/syncEngine.js` | `startRealtime` e `initialPull` saltan las diferidas; nace `pullDiferido` y `reconciliarDiferidas`. |
| `src/features/sync/deviceRegistry.js` | Publica `caps`, `sealSeenAt` y `legacyAt` dentro del `setDoc` que ya se hacía; expone `readDevices`. |
| `src/app/providers/SyncProvider.jsx` | El timbre, su antirrebote, su tope y la red de seguridad de 60 min. |
| `src/features/backup/backupService.js` | Excluye `pull:*` del respaldo y de la restauración. |
| `src/features/sync/CloudScreen.jsx` | Interruptor del negocio y el panel que dice **por qué** no está filtrando. |
| `src/repositories/configRepo.js` | Lectura/escritura de la bandera `bajadaFiltrada`. |

---

## Tarea 1: el módulo puro — el sello y el TIPO del cursor

Es la tarea que cierra el hallazgo **H-A** del spec §10.5, que es el crítico. Todo lo demás depende
de que aquí los tipos estén bien.

**Ficheros:**
- Crear: `src/features/sync/deferred.js`
- Crear (prueba): `src/features/sync/deferred.test.mjs`

**Interfaces:**
- Consume: nada (es la base).
- Produce: `SEALED`, `isSealed(name)`, `seal(name, plain, sentinel)`, `upToMillis(v)`,
  `stripUp(docs)`, `cursorKey(businessId, name)`, `parseCursor(stored)`, `formatCursor(ms)`,
  `CURSOR_MARGIN_MS`, `nextCursor({ prevMs, maxUpMs, fromServer })`.

- [ ] **Paso 1: escribir la prueba que falla**

Crear `src/features/sync/deferred.test.mjs`:

```js
// Suite del modulo PURO de la bajada diferida (spec 2026-09-24-reduccion-cuota,
// §10 y §10.5). Se corre con:  node src/features/sync/deferred.test.mjs
import assert from 'node:assert/strict'
import {
  SEALED, isSealed, seal, upToMillis, stripUp,
  cursorKey, parseCursor, formatCursor, CURSOR_MARGIN_MS, nextCursor
} from './deferred.js'

let n = 0
const ok = (cond, msg) => { assert.ok(cond, msg); n++ }
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++ }

// --- 1) Que se sella, y que NO -----------------------------------------------
eq(SEALED, ['stockMovements', 'sales'], 'exactamente dos colecciones llevan sello')
ok(isSealed('stockMovements') && isSealed('sales'), 'las dos selladas')
ok(!isSealed('products') && !isSealed('orders') && !isSealed('counts'),
  'NINGUNA otra lleva sello (el eco del §10.4 lo haria caro)')

// --- 2) El sello va DESPUES de serializar ------------------------------------
const centinela = () => ({ __centinela: true })
const sellado = seal('stockMovements', { id: 'm1', qty: 5 }, centinela)
eq(sellado.id, 'm1', 'conserva el documento')
eq(sellado._up, { __centinela: true }, 'el centinela llega VIVO, no aplanado')

const pisado = seal('stockMovements', { id: 'm1', _up: '2026-01-01T00:00:00.000Z' }, centinela)
eq(pisado._up, { __centinela: true }, 'pisa un _up viejo que un build viejo dejara en Dexie')

const intacto = seal('products', { id: 'p1' }, centinela)
eq(intacto, { id: 'p1' }, 'una coleccion sin sello sale IDENTICA (objeto sin _up)')
ok(!('_up' in intacto), 'y sin la clave siquiera')

// --- 3) FOCO 2: _up llega en cuatro formas ------------------------------------
const ms = Date.UTC(2026, 8, 25, 12, 0, 0)
eq(upToMillis({ toMillis: () => ms }), ms, 'Timestamp del SDK')
eq(upToMillis({ seconds: ms / 1000, nanoseconds: 0 }), ms, 'Timestamp plano (cache/serializado)')
eq(upToMillis(new Date(ms)), ms, 'Date')
eq(upToMillis('2026-09-25T12:00:00.000Z'), ms, 'cadena ISO (tolerada al leer, nunca al filtrar)')
eq(upToMillis(undefined), null, 'ausente -> null, NUNCA NaN')
eq(upToMillis(null), null, 'null -> null')
eq(upToMillis({}), null, 'objeto raro -> null')
eq(upToMillis('no es fecha'), null, 'basura -> null')
ok(!Number.isNaN(upToMillis({})), 'jamas devuelve NaN (envenenaria el cursor)')

// --- 4) stripUp: P2, no entra en Dexie ---------------------------------------
const tanda = [
  { id: 'a', qty: 1, _up: { toMillis: () => 100 } },
  { id: 'b', qty: 2, _up: { toMillis: () => 300 } },
  { id: 'c', qty: 3 } // build viejo: sin sello
]
const r = stripUp(tanda)
eq(r.maxUpMs, 300, 'devuelve el maximo visto')
ok(r.docs.every((d) => !('_up' in d)), '_up NO entra en Dexie (ni en respaldos, ni se resube)')
eq(r.docs.map((d) => d.id), ['a', 'b', 'c'], 'no pierde ni reordena documentos')
eq(r.docs[0].qty, 1, 'no toca el resto del documento')
eq(stripUp([]).maxUpMs, null, 'tanda vacia -> sin maximo')
eq(stripUp([{ id: 'x' }]).maxUpMs, null, 'tanda sin ningun sello -> sin maximo')

// --- 5) FOCO 1: el cursor se GUARDA texto y se USA en milisegundos ------------
eq(cursorKey('neg1', 'stockMovements'), 'pull:neg1:stockMovements',
  'la clave lleva el negocio (unlinkDevice NO limpia syncState)')
ok(cursorKey('neg1', 'sales') !== cursorKey('neg2', 'sales'),
  'dos negocios no comparten cursor')

eq(typeof formatCursor(ms), 'string', 'se guarda como texto (legible en syncState)')
eq(formatCursor(ms), '2026-09-25T12:00:00.000Z', 'y es ISO')
eq(parseCursor('2026-09-25T12:00:00.000Z'), ms, 'se lee de vuelta a milisegundos')
eq(typeof parseCursor('2026-09-25T12:00:00.000Z'), 'number',
  'parseCursor SIEMPRE devuelve NUMERO: un Timestamp nunca se compara con una cadena')
eq(parseCursor(''), null, 'sin cursor -> null (primera bajada: sin filtro)')
eq(parseCursor(null), null, 'sin fila -> null')
eq(parseCursor('basura'), null, 'basura -> null, NUNCA NaN')
ok(!Number.isNaN(parseCursor('basura')), 'jamas NaN')
eq(parseCursor(ms), null, 'un numero suelto NO es un cursor guardado valido')

// --- 6) FOCO 3: margen, empates y que nunca retroceda -------------------------
eq(CURSOR_MARGIN_MS, 120000, 'margen de 120 s (con hora del servidor no hay relojes que cubrir)')

eq(nextCursor({ prevMs: null, maxUpMs: ms, fromServer: true }), ms - CURSOR_MARGIN_MS,
  'primer avance: maximo menos el margen')
eq(nextCursor({ prevMs: ms, maxUpMs: ms - 1000, fromServer: true }), ms,
  'NUNCA retrocede aunque la tanda traiga marcas mas viejas')
eq(nextCursor({ prevMs: 0, maxUpMs: ms, fromServer: false }), 0,
  'FOCO 5: si la respuesta vino de CACHE, el cursor no se mueve')
eq(nextCursor({ prevMs: 10, maxUpMs: null, fromServer: true }), 10,
  'tanda sin sellos: no mueve el cursor')
const dos = nextCursor({ prevMs: null, maxUpMs: ms, fromServer: true })
ok(ms - dos === CURSOR_MARGIN_MS,
  'el solapamiento hace que un empate al milisegundo vuelva a bajar (el limite es >)')

console.log(`deferred (sello y cursor): ${n} aserciones OK`)
```

- [ ] **Paso 2: correrla y comprobar que FALLA**

```bash
node src/features/sync/deferred.test.mjs
```

Esperado: `ERR_MODULE_NOT_FOUND` — `deferred.js` todavía no existe.

- [ ] **Paso 3: escribir la implementación mínima**

Crear `src/features/sync/deferred.js`:

```js
// ---------------------------------------------------------------------------
// Bajada diferida por marca de llegada (spec 2026-09-24-reduccion-cuota).
// MODULO PURO: sin Dexie, sin Firestore, sin React. Todo lo externo se inyecta,
// asi que se prueba entero con node. El cableado vive en pushEngine/pullEngine/
// syncEngine/SyncProvider. Mismo patron que compareResend.js.
// ---------------------------------------------------------------------------

// Colecciones que llevan el sello `_up`. SON SOLO ESTAS DOS, y ampliarlas exige
// medir antes: mientras el eco del §10.4 siga ahi, cada resubida de una fila
// sellada lleva un _up nuevo y cuesta una lectura en los demas aparatos.
export const SEALED = ['stockMovements', 'sales']
export const isSealed = (name) => SEALED.includes(name)

// El sello va DESPUES de serializar. JSON.stringify(serverTimestamp()) da
// {"_methodName":"serverTimestamp"} (ejecutado, §10.2): puesto antes, en la nube
// quedaria un MAPA inerte, y un mapa no entra en ningun filtro de rango. Ademas
// asi pisa cualquier _up que un build viejo hubiera guardado en Dexie.
export function seal(name, plain, sentinel) {
  if (!isSealed(name)) return plain
  return { ...plain, _up: sentinel() }
}

// `_up` puede llegar de cuatro formas: Timestamp del SDK, Timestamp plano
// ({seconds,nanoseconds}) cuando viene serializado, Date, o AUSENTE (documento
// que subio un build viejo). Devuelve milisegundos o null. NUNCA NaN: un NaN en
// el cursor lo envenena para siempre y la coleccion deja de bajar en silencio.
export function upToMillis(v) {
  if (v == null) return null
  if (typeof v.toMillis === 'function') {
    const ms = v.toMillis()
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof v.seconds === 'number') {
    const ms = v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6)
    return Number.isFinite(ms) ? ms : null
  }
  if (v instanceof Date) {
    const ms = v.getTime()
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof v === 'string') {
    const ms = Date.parse(v)
    return Number.isFinite(ms) ? ms : null
  }
  return null
}

// P2: quita `_up` antes de que la tanda entre en Dexie (no viaja en respaldos ni
// se resube) y devuelve el maximo visto, que es lo unico que se conserva de el.
export function stripUp(docs) {
  let maxUpMs = null
  const out = docs.map((d) => {
    const ms = upToMillis(d?._up)
    if (ms != null && (maxUpMs == null || ms > maxUpMs)) maxUpMs = ms
    if (d && '_up' in d) {
      const copia = { ...d }
      delete copia._up
      return copia
    }
    return d
  })
  return { docs: out, maxUpMs }
}

// El cursor va atado al NEGOCIO: unlinkDevice no limpia syncState (solo apaga el
// flag), asi que un cursor de otro negocio dejaria huecos permanentes en este.
export const cursorKey = (businessId, name) => `pull:${businessId}:${name}`

// EL TIPO DEL CURSOR (hallazgo H-A del §10.5, el critico). Se GUARDA como texto
// ISO —la convencion de la casa, legible en syncState— y se USA en milisegundos.
// parseCursor devuelve SIEMPRE un numero o null, para que sea imposible pasarle
// una cadena al `where`: Firestore ordena primero por TIPO (Timestamp=3,
// String=5), asi que comparar un Timestamp contra una cadena devuelve CERO
// documentos, sin error y para siempre.
export function parseCursor(stored) {
  if (typeof stored !== 'string' || !stored) return null
  const ms = Date.parse(stored)
  return Number.isFinite(ms) ? ms : null
}

export function formatCursor(ms) {
  return new Date(ms).toISOString()
}

// Solapamiento deliberado: Firestore no garantiza entregar en orden de `_up`, y
// el limite de la consulta es ESTRICTO (>), asi que sin margen se perderia el
// documento que empate al milisegundo. Con la hora del SERVIDOR ya no hay relojes
// de telefono que cubrir: basta con superar el plazo de un commit (60 s).
export const CURSOR_MARGIN_MS = 120000

// El cursor avanza SOLO si la respuesta vino del servidor de ESA coleccion, y
// NUNCA retrocede.
export function nextCursor({ prevMs, maxUpMs, fromServer }) {
  const base = Number.isFinite(prevMs) ? prevMs : null
  if (!fromServer || maxUpMs == null) return base
  const candidato = maxUpMs - CURSOR_MARGIN_MS
  if (base == null) return candidato
  return candidato > base ? candidato : base
}
```

- [ ] **Paso 4: correr la prueba y comprobar que PASA**

```bash
node src/features/sync/deferred.test.mjs
```

Esperado: la línea `deferred (sello y cursor): N aserciones OK` y **salida cero**. El número exacto
no se fija aquí a propósito —no se ha ejecutado— pero **ninguna aserción puede fallar**: `assert`
corta a la primera. Anotar el N que salga: es la cifra que va al acta de la Tarea 11.

- [ ] **Paso 5: control negativo (sin esto la suite no mide nada)**

Cuatro mutaciones **a mano** en `deferred.js`; cada una tiene que poner la suite en **rojo**. Se
deshacen una a una después de comprobarlo.

| # | Mutación | Aserción que debe cazarla |
|---|---|---|
| M1 | `parseCursor` devuelve `stored` en vez de `ms` | *«parseCursor SIEMPRE devuelve NUMERO»* |
| M2 | quitar `- CURSOR_MARGIN_MS` de `nextCursor` | *«el solapamiento hace que un empate…»* |
| M3 | en `nextCursor`, ignorar `fromServer` | *«si la respuesta vino de CACHE…»* |
| M4 | `upToMillis` devuelve `NaN` en vez de `null` | *«jamas devuelve NaN»* |

```bash
# tras cada mutacion:
node src/features/sync/deferred.test.mjs   # debe SALIR EN ROJO
# deshacerla y volver a verde antes de la siguiente
```

- [ ] **Paso 6: commit**

```bash
npm run build
git add src/features/sync/deferred.js src/features/sync/deferred.test.mjs
git commit -m "Cuota de Firestore (F1/1): modulo puro del sello y del TIPO del cursor"
```

---

## Tarea 2: sellar lo que sube

**Ficheros:**
- Modificar: `src/features/sync/pushEngine.js` (el `import` dinámico de `doPush`, y los **tres**
  sitios que llaman a `toCloud`)

**Interfaces:**
- Consume: `seal`, `isSealed` de la Tarea 1.
- Produce: documentos con `_up` en la nube para `stockMovements` y `sales`. Nada más cambia.

- [ ] **Paso 1: localizar los tres llamantes de `toCloud`, sin suponer**

```bash
grep -n "toCloud(" src/features/sync/pushEngine.js
```

Esperado exactamente esto (verificado el 25-09-2026):

```
65:function toCloud(rec) {
173:      for (const { r, id } of slice) batch.set(ref(col.name, id), toCloud(r))
187:      setDoc(ref(col.name, id), toCloud(r))
220:    slice.map(({ r, id }) => ctx.setDoc(ctx.ref(col.name, id), toCloud(r)))
```

**Si sale cualquier otra cosa, PARAR** y decírselo al dueño: el plan se apoya en que son esos tres.
`:173` y `:187` están dentro de `doPush`; **`:220` está en `onBatchError`**, que no ve las variables
de `doPush` y trabaja con `ctx`.

- [ ] **Paso 2: el ayudante que sella, junto a `toCloud`**

Justo debajo de `toCloud` (`:65`), añadir:

```js
// Sella con la hora en que el documento LLEGA a la nube (spec §10, D1). Va
// DESPUES de toCloud a proposito: el centinela de serverTimestamp() no sobrevive
// a JSON.stringify (quedaria el mapa {"_methodName":"serverTimestamp"}, que no
// entra en ningun filtro de rango). Solo lo llevan las colecciones de SEALED;
// las demas suben con su contenido IDENTICO al de hoy.
const toCloudSellado = (name, rec, sentinel) => seal(name, toCloud(rec), sentinel)
```

y su `import` arriba del fichero:

```js
import { seal } from './deferred'
```

- [ ] **Paso 3: los dos usos de dentro de `doPush`**

Añadir `serverTimestamp` al import dinámico:

```js
  const { doc, writeBatch, setDoc, serverTimestamp } = await import('firebase/firestore')
```

`:173` pasa a:

```js
      for (const { r, id } of slice) batch.set(ref(col.name, id), toCloudSellado(col.name, r, serverTimestamp))
```

`:187` pasa a:

```js
      setDoc(ref(col.name, id), toCloudSellado(col.name, r, serverTimestamp))
```

- [ ] **Paso 4: el uso de `onBatchError`, que va por `ctx`**

`onBatchError` **no ve** `serverTimestamp`: recibe `ctx`, que hoy es `{ fs, setDoc, ref }` más el
`now`. Hay que llevárselo dentro. En `doPush`, donde se arma el contexto:

```js
  const ctx = { fs, setDoc, ref, serverTimestamp }
```

y `:220` pasa a:

```js
    slice.map(({ r, id }) => ctx.setDoc(ctx.ref(col.name, id), toCloudSellado(col.name, r, ctx.serverTimestamp)))
```

**Este es el camino de rescate de los "inocentes" de un lote que falló entero.** Si se deja sin
sellar, esos documentos llegan a la nube **sin `_up`** y no los devuelve ninguna consulta filtrada:
quedarían invisibles para los demás aparatos hasta la siguiente reconciliación. Es el uso más fácil
de olvidar de los tres, por eso va en su propio paso.

- [ ] **Paso 5: comprobar que no queda ningún `toCloud(` suelto en el camino de subida**

```bash
grep -n "toCloud(r)" src/features/sync/pushEngine.js
```

Esperado: **cero coincidencias**. Las únicas apariciones de `toCloud` deben ser su definición (`:65`)
y la del ayudante `toCloudSellado`, que es quien lo llama.

- [ ] **Paso 6: build y las suites**

```bash
npm run build
node src/features/sync/deferred.test.mjs
node src/features/sync/retryQueue.test.mjs
node src/features/sync/commitWatch.test.mjs
node src/features/sync/compareResend.test.mjs
node src/features/sync/compareResendEngine.test.mjs
```

Esperado: build exit 0 y las cinco en verde.

- [ ] **Paso 7: commit**

```bash
git add src/features/sync/pushEngine.js
git commit -m "Cuota de Firestore (F1/2): sello _up con la hora del servidor al subir"
```

---

## Tarea 3: que `_up` no entre en Dexie

**Ficheros:**
- Modificar: `src/features/sync/pullEngine.js` (`mergeIncoming`)
- Modificar: `src/features/sync/syncEngine.js` (`initialPull` y `handleIncoming` recogen el máximo)

**Interfaces:**
- Consume: `stripUp` de la Tarea 1.
- Produce: `mergeIncoming(col, docs)` devuelve **lo mismo que hoy** (un `Set`), y además expone el
  máximo por un segundo valor de retorno **opcional** para no romper a sus dos consumidores.

- [ ] **Paso 1: escribir la prueba que falla**

Añadir al final de `src/features/sync/deferred.test.mjs`:

```js
// --- 7) El registro local queda IDENTICO al de hoy -----------------------------
// mergeIncoming no se puede probar sin base, pero la regla que aplica SI: lo que
// entra en Dexie es exactamente el documento sin `_up`.
const entrante = { id: 'm9', productId: 'p1', qty: -2, createdAt: '2026-09-25T10:00:00.000Z',
                   _up: { toMillis: () => 999 } }
const { docs: [guardado] } = stripUp([entrante])
eq(Object.keys(guardado).sort(), ['createdAt', 'id', 'productId', 'qty'],
  'en Dexie entra el documento SIN _up y sin ningun campo nuevo')
ok(entrante._up != null, 'y no muta el documento original (la copia es nueva)')
```

- [ ] **Paso 2: correrla y comprobar que FALLA**

```bash
node src/features/sync/deferred.test.mjs
```

Esperado: FALLA en *«en Dexie entra el documento SIN _up…»* si `stripUp` mutara el original o dejara
la clave. (Si ya pasa porque la Tarea 1 lo resolvió, **dejar la aserción igual**: es la regresión que
protege este cambio.)

- [ ] **Paso 3: aplicar el cambio en `pullEngine.js`**

En `mergeIncoming`, justo después de filtrar `items` y antes del `bulkGet`:

```js
  // P2: `_up` es el sello de llegada a la nube. NO entra en Dexie (el registro
  // local queda identico al de hoy), no viaja en respaldos y no se resube. Lo
  // unico que se conserva de el es el maximo, que el llamador usa para el cursor.
  const { docs: limpios, maxUpMs } = stripUp(items)
  items = limpios
```

y al final, donde hoy hace `return affected`:

```js
  if (toPut.length) await table.bulkPut(toPut)
  // El Set sigue siendo el valor de retorno (sus dos consumidores no cambian);
  // el maximo viaja colgado de el para no tocar la firma.
  affected.maxUpMs = maxUpMs
  return affected
```

con su `import`:

```js
import { stripUp } from './deferred'
```

- [ ] **Paso 4: correr la suite y el build**

```bash
node src/features/sync/deferred.test.mjs
npm run build
```

- [ ] **Paso 5: comprobar que los consumidores de `mergeIncoming` siguen intactos**

```bash
grep -rn "mergeIncoming" src/ | grep -v "pullEngine.js"
```

Esperado: exactamente dos en `syncEngine.js` (`initialPull` y `handleIncoming`) y los de
`src/repositories/ordersRepo.test.mjs`. **Los tres siguen usando el valor como `Set`**: `affected`
sigue siendo un `Set` y `.forEach`/`.size`/`.add` siguen funcionando. Correr la suite de repos, que
usa el `mergeIncoming` REAL:

```bash
npx esbuild src/repositories/ordersRepo.test.mjs --bundle --platform=node --format=esm \
  --outfile="$TMP/ordersRepo.bundle.mjs" && node "$TMP/ordersRepo.bundle.mjs"
```

Esperado: 65 aserciones en verde, como hoy.

- [ ] **Paso 6: commit**

```bash
git add src/features/sync/pullEngine.js
git commit -m "Cuota de Firestore (F1/3): _up no entra en Dexie y su maximo alimenta el cursor"
```

---

## Tarea 4: la guarda de aparatos (D2 + hallazgo H-C)

Ningún aparato filtra hasta que **todos** los activos publican que sellan. Y «activo» se acota
también por antigüedad, porque hoy solo deja de serlo si el dueño quita el aparato a mano: un
teléfono perdido bloquearía el ahorro **para siempre y sin avisar**.

**Ficheros:**
- Modificar: `src/features/sync/deferred.js` (decisión pura)
- Modificar: `src/features/sync/deferred.test.mjs`
- Modificar: `src/features/sync/deviceRegistry.js` (publicación + lectura)

**Interfaces:**
- Consume: nada nuevo.
- Produce: `STALE_DEVICE_MS`, `guardState({ devices, nowMs, reconciledAtMs })` →
  `{ ok, bloqueantes: [{ id, name, motivo }], motivo }`; y de `deviceRegistry`:
  `readDevices()` → `[{ id, name, active, caps, sealSeenAt, legacyAt, lastSeenAt }]`.

- [ ] **Paso 1: escribir la prueba que falla**

Añadir a `deferred.test.mjs`:

```js
import { STALE_DEVICE_MS, guardState } from './deferred.js'

// --- 8) FOCO 4: la guarda de aparatos ------------------------------------------
const ahora = Date.UTC(2026, 8, 25, 12, 0, 0)
const vivo = (id, extra = {}) => ({
  id, name: id, active: true, caps: { up: 1 },
  sealSeenAt: ahora - 60000, lastSeenAt: ahora - 60000, ...extra
})

ok(guardState({ devices: [vivo('a'), vivo('b')], nowMs: ahora, reconciledAtMs: ahora }).ok,
  'todos sellan y estan recientes -> se puede filtrar')

const sinCaps = guardState({ devices: [vivo('a'), vivo('b', { caps: {} })], nowMs: ahora, reconciledAtMs: ahora })
ok(!sinCaps.ok, 'un aparato con build viejo bloquea')
eq(sinCaps.bloqueantes.map((x) => x.id), ['b'], 'y lo NOMBRA (si no, el dueño no sabe cual es)')

ok(!guardState({ devices: [], nowMs: ahora, reconciledAtMs: ahora }).ok,
  'FOCO 4: lista VACIA -> NO se filtra (lado seguro, nunca "si" por omision)')
ok(!guardState({ devices: null, nowMs: ahora, reconciledAtMs: ahora }).ok,
  'FOCO 4: lista ilegible -> NO se filtra')

// Un aparato dado de baja por el dueño no cuenta.
ok(guardState({ devices: [vivo('a'), { id: 'z', active: false }], nowMs: ahora, reconciledAtMs: ahora }).ok,
  'un aparato retirado (active:false) no bloquea')

// H-C: y uno que lleva meses sin abrirse, TAMPOCO — si no, el ahorro no se
// enciende jamas y nadie se entera.
const olvidado = { id: 'viejo', name: 'viejo', active: true, caps: {},
                   lastSeenAt: ahora - STALE_DEVICE_MS - 1 }
const conOlvidado = guardState({ devices: [vivo('a'), olvidado], nowMs: ahora, reconciledAtMs: ahora })
ok(conOlvidado.ok, 'un aparato sin abrirse desde hace mas de STALE_DEVICE_MS no bloquea')
const casiOlvidado = { ...olvidado, lastSeenAt: ahora - STALE_DEVICE_MS + 1000 }
ok(!guardState({ devices: [vivo('a'), casiOlvidado], nowMs: ahora, reconciledAtMs: ahora }).ok,
  'pero uno visto AYER si bloquea (el umbral no es un coladero)')

// legacyAt: un build viejo corrio DESPUES de que este aparato reconciliara.
const conLegacy = guardState({
  devices: [vivo('a'), vivo('b', { legacyAt: ahora - 1000 })],
  nowMs: ahora, reconciledAtMs: ahora - 5000
})
ok(!conLegacy.ok, 'si un build viejo corrio tras nuestra reconciliacion, se vuelve al tiempo real')
const legacyAntiguo = guardState({
  devices: [vivo('a'), vivo('b', { legacyAt: ahora - 9000 })],
  nowMs: ahora, reconciledAtMs: ahora - 5000
})
ok(legacyAntiguo.ok, 'un legacyAt ANTERIOR a la reconciliacion ya esta cubierto')

ok(typeof guardState({ devices: [], nowMs: ahora, reconciledAtMs: ahora }).motivo === 'string' &&
   guardState({ devices: [], nowMs: ahora, reconciledAtMs: ahora }).motivo.length > 0,
  'siempre da un motivo legible para el panel de /cloud')
```

- [ ] **Paso 2: correrla y comprobar que FALLA**

```bash
node src/features/sync/deferred.test.mjs
```

Esperado: `SyntaxError` / `undefined` — `guardState` no existe todavía.

- [ ] **Paso 3: implementar la decisión pura**

Añadir a `deferred.js`:

```js
// Un aparato que el dueño no ha retirado a mano sigue `active:true` PARA SIEMPRE
// (removeDevice es la unica via). Sin este umbral, un telefono perdido, roto o
// reinstalado bloquearia el filtro eternamente y el ahorro no se encenderia nunca
// —sin ningun error, que es lo peor—. 30 dias: quien no abre la app en un mes no
// va a recibir una bajada que le importe.
export const STALE_DEVICE_MS = 30 * 24 * 60 * 60 * 1000

// ¿Puede este aparato filtrar? Solo si TODOS los aparatos activos y recientes
// publican que sellan (`caps.up`), y si ninguno ejecuto un build viejo DESPUES de
// nuestra ultima reconciliacion. Ante la duda —lista vacia, ilegible— devuelve
// NO: el lado seguro es no filtrar, nunca filtrar por omision.
export function guardState({ devices, nowMs, reconciledAtMs }) {
  if (!Array.isArray(devices) || devices.length === 0) {
    return { ok: false, bloqueantes: [], motivo: 'No se pudo leer la lista de dispositivos.' }
  }
  const bloqueantes = []
  for (const d of devices) {
    if (!d || d.active === false) continue
    const visto = upToMillis(d.lastSeenAt)
    if (visto != null && nowMs - visto > STALE_DEVICE_MS) continue // dormido hace mucho
    if (!(d.caps && d.caps.up)) {
      bloqueantes.push({ id: d.id, name: d.name || d.id, motivo: 'no ha actualizado la app' })
      continue
    }
    const legacy = upToMillis(d.legacyAt)
    if (legacy != null && reconciledAtMs != null && legacy > reconciledAtMs) {
      bloqueantes.push({ id: d.id, name: d.name || d.id, motivo: 'abrió una versión antigua' })
    }
  }
  if (bloqueantes.length) {
    const nombres = bloqueantes.map((b) => `${b.name} (${b.motivo})`).join(', ')
    return { ok: false, bloqueantes, motivo: `Esperando a: ${nombres}.` }
  }
  return { ok: true, bloqueantes: [], motivo: '' }
}
```

- [ ] **Paso 4: correr la suite y comprobar que PASA**

```bash
node src/features/sync/deferred.test.mjs
```

- [ ] **Paso 5: publicar las capacidades en `/devices` (cero lecturas y escrituras extra)**

En `deviceRegistry.js`, dentro del `setDoc` de `registerThisDevice` —que **ya** se hacía y **ya** va
con `{ merge: true }`— añadir tres campos:

```js
      active: true,
      linkedAt: prev?.linkedAt || serverTimestamp(),
      lastSeenAt: serverTimestamp(),
      // Capacidades de ESTE build. `up` dice "yo sello lo que subo": la bajada
      // filtrada no se enciende en NINGUN aparato hasta que todos lo publican
      // (spec §10, D2). Va dentro del setDoc que ya se hacia: no cuesta ni una
      // lectura ni una escritura mas.
      caps: { up: 1 },
      sealSeenAt: serverTimestamp()
```

Y exponer la lista, reutilizando el `getDocs` que `registerThisDevice` **ya hace**:

```js
// Lista cruda de dispositivos (la usa la guarda de la bajada diferida). Devuelve
// [] si no hay sesion: la guarda interpreta la lista vacia como "no filtrar".
export async function readDevices() {
  try {
    const { db: fs, auth } = await getFirebase()
    if (!auth.currentUser) return []
    const { collection, getDocs } = await import('firebase/firestore')
    const snap = await getDocs(collection(fs, 'businesses', auth.currentUser.uid, 'devices'))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (e) {
    logSyncEvent('guarda-dispositivos', null, e)
    return []
  }
}
```

- [ ] **Paso 6: dejar la huella del build viejo (`legacyAt`)**

Un build **viejo** no escribe `caps`, así que su paso se detecta por omisión. Lo que sí hay que
anotar es **cuándo** corrió, para que los aparatos que ya filtraban vuelvan al tiempo real. En
`registerThisDevice`, antes del `setDoc`:

```js
  // Si la fila de este aparato dice que sella (caps.up) pero ESTE build no lo
  // hace, es que corrio una version antigua: se anota la hora del SERVIDOR para
  // que los aparatos que ya filtraban vuelvan al tiempo real y rellenen el hueco.
  const corrioViejo = prev?.caps?.up && !CAPS.up
```

con, arriba del fichero:

```js
// Capacidades de ESTE build. Un build sin la bajada diferida deja `up` en 0.
const CAPS = { up: 1 }
```

y añadiendo al objeto del `setDoc`: `...(corrioViejo ? { legacyAt: serverTimestamp() } : {})`.
*(En este build `CAPS.up` vale 1, así que `corrioViejo` es siempre falso; la rama queda lista para
cuando un aparato baje de versión, que es el caso que describe D2.)*

- [ ] **Paso 7: build, suites y commit**

```bash
npm run build
node src/features/sync/deferred.test.mjs
git add src/features/sync/deferred.js src/features/sync/deferred.test.mjs src/features/sync/deviceRegistry.js
git commit -m "Cuota de Firestore (F2/1): guarda de aparatos con umbral de antiguedad y motivo legible"
```

---

## Tarea 5: qué se difiere, y sacarlo del vivo

**Ficheros:**
- Modificar: `src/features/sync/deferred.js` y su suite
- Modificar: `src/features/sync/syncEngine.js` (`startRealtime`, `initialPull`)

**Interfaces:**
- Consume: `SEALED`, `guardState` (Tareas 1 y 4).
- Produce: `deferredSet({ flagOn, guardOk, sinMesas, ordersVacia })` → `Set<string>`; y
  `syncEngine.setDeferred(set)` / `syncEngine.getDeferred()`.

**El invariante de H-B, que es el que decide si esto ahorra algo:**

> **Un aparato con el filtro activo NO llama a `onSnapshot` sobre las colecciones diferidas, en
> ningún arranque.** La reconciliación de la Tarea 7 se hace en la **transición** (al encender la
> bandera, al pasar la guarda, al volver de un build viejo), **no** en cada arranque. Si se
> reconciliara en cada arranque habría que enganchar el oyente cada vez, que es **exactamente el
> coste que este plan quita** (spec §2.2), y el ahorro sería cero.

- [ ] **Paso 1: escribir la prueba que falla**

```js
import { deferredSet } from './deferred.js'

// --- 9) Que se difiere -----------------------------------------------------------
const todo = { flagOn: true, guardOk: true, sinMesas: true, ordersVacia: true }
eq([...deferredSet(todo)].sort(), ['sales', 'stockMovements'], 'sin mesas se difieren las dos')

eq([...deferredSet({ ...todo, sinMesas: false })], ['stockMovements'],
  'con licencia de mesas, `sales` se QUEDA en vivo (§7bis: toca dinero)')
eq([...deferredSet({ ...todo, ordersVacia: false })], ['stockMovements'],
  'y si hay algun pedido, tambien se queda, aunque la licencia diga que no hay mesas')

eq([...deferredSet({ ...todo, flagOn: false })], [],
  'bandera apagada -> NADA se difiere: identico al comportamiento de hoy')
eq([...deferredSet({ ...todo, guardOk: false })], [],
  'guarda no pasada -> NADA se difiere')
eq([...deferredSet({})], [], 'sin datos -> NADA se difiere (lado seguro)')
ok(deferredSet(todo) instanceof Set, 'devuelve un Set')
```

- [ ] **Paso 2: correrla y comprobar que FALLA**

```bash
node src/features/sync/deferred.test.mjs
```

- [ ] **Paso 3: implementar**

En `deferred.js`:

```js
// Que colecciones salen del tiempo real. Por defecto NINGUNA: con la bandera
// apagada o la guarda sin pasar, la app se comporta EXACTAMENTE como hoy.
//
// `sales` solo sale si el negocio no tiene mesas, y hacen falta las DOS pruebas:
// la licencia (que es LOCAL de cada aparato y puede ir desfasada) y que `orders`
// este vacia (que es dato sincronizado). Con mesas, el cobro de una mesa escribe
// `sales` y `orders`, la cabecera se pierde por LWW (H2) y el candado contra el
// doble cobro lee `db.sales` LOCAL: sin `sales` en vivo, el candado no dispara.
// Cuesta poco dejarla: en el negocio con mesas medido es el 1,3 % de D.
export function deferredSet({ flagOn, guardOk, sinMesas, ordersVacia } = {}) {
  if (!flagOn || !guardOk) return new Set()
  const out = new Set(['stockMovements'])
  if (sinMesas && ordersVacia) out.add('sales')
  return out
}
```

- [ ] **Paso 4: sacarlas del vivo y del pull completo**

En `syncEngine.js`, arriba:

```js
// Colecciones que este aparato NO escucha en vivo ahora mismo. Lo decide
// SyncProvider (bandera + guarda + modulos) y lo fija aqui antes de arrancar el
// tiempo real. Vacio = comportamiento clasico.
let deferidas = new Set()
export function setDeferred(set) { deferidas = set instanceof Set ? set : new Set() }
export function getDeferred() { return new Set(deferidas) }
```

En `startRealtime`, dentro del bucle, como **primera** línea:

```js
    for (const col of SYNC_COLLECTIONS) {
      // INVARIANTE (spec §10.5, H-B): un aparato que filtra NO se suscribe a las
      // diferidas en NINGUN arranque. Si se suscribiera "solo para reconciliar",
      // pagaria el enganche en frio cada vez, que es justo el coste que se quita.
      if (deferidas.has(col.name)) continue
```

En `initialPull`, dentro del bucle, como **primera** línea:

```js
  for (const col of SYNC_COLLECTIONS) {
    // P5: sin oyente, este getDocs sin filtro dejaria de ser gratis y seria una
    // consulta real cada 45 s. Las diferidas bajan por `pullDiferido`.
    if (deferidas.has(col.name)) continue
```

- [ ] **Paso 5: comprobar que sin bandera no cambia nada**

```bash
grep -n "deferidas.has" src/features/sync/syncEngine.js
node src/features/sync/deferred.test.mjs
npm run build
```

Esperado: dos coincidencias, suite en verde, build exit 0. Con `deferidas` vacío (el valor inicial),
los dos `continue` **nunca se ejecutan** y `startRealtime`/`initialPull` hacen exactamente lo de hoy.

- [ ] **Paso 6: commit**

```bash
git add src/features/sync/deferred.js src/features/sync/deferred.test.mjs src/features/sync/syncEngine.js
git commit -m "Cuota de Firestore (F2/2): que se difiere, y fuera del vivo y del pull completo"
```

---

## Tarea 6: la bajada filtrada

Aquí es donde el hallazgo **H-A** se convierte en código: el cursor **nunca** se pasa en crudo.

**Ficheros:**
- Modificar: `src/features/sync/syncEngine.js` (`pullDiferido`)

**Interfaces:**
- Consume: `cursorKey`, `parseCursor`, `formatCursor`, `nextCursor`, `getDeferred` (Tareas 1 y 5).
- Produce: `pullDiferido()` → `{ ok, total, porColeccion }`.

- [ ] **Paso 1: escribir `pullDiferido`**

En `syncEngine.js`:

```js
// Bajada de las colecciones DIFERIDAS: una consulta por coleccion, filtrada por
// la marca de llegada. Sin oyente, esto SI es una consulta real y cuesta lo que
// devuelve — que es justo el punto: devuelve lo nuevo, no la historia entera.
export async function pullDiferido() {
  const cols = getDeferred()
  if (!cols.size) return { ok: true, total: 0, porColeccion: {} }
  if (!(await syncConfig.isEnabled())) return { ok: false, reason: 'sync desactivada', total: 0 }
  const businessId = await syncConfig.businessId()
  if (!businessId) return { ok: false, reason: 'sin negocio vinculado', total: 0 }

  const { db: fs, auth } = await getFirebase()
  if (!auth.currentUser) return { ok: false, reason: 'sin sesion de nube', total: 0 }
  const { collection, getDocs, query, where, Timestamp } = await import('firebase/firestore')

  let total = 0
  const porColeccion = {}
  const affected = new Set()

  for (const col of SYNC_COLLECTIONS) {
    if (!cols.has(col.name)) continue
    const clave = cursorKey(businessId, col.name)
    const fila = await db.syncState.get(clave)
    // EL TIPO IMPORTA (spec §10.5, H-A). El cursor se guarda como texto ISO y se
    // reconstruye a Timestamp para la consulta. Pasar la cadena tal cual haria que
    // Firestore comparase tipos distintos (Timestamp=3 < String=5) y devolviera
    // CERO documentos, en silencio y para siempre.
    const desdeMs = parseCursor(fila?.value)
    const ref = collection(fs, 'businesses', businessId, col.name)
    const q = desdeMs == null ? ref : query(ref, where('_up', '>', Timestamp.fromMillis(desdeMs)))

    const snap = await getDocs(q)
    const docs = snap.docs.map((d) => d.data())
    porColeccion[col.name] = { leidos: docs.length, fromCache: snap.metadata.fromCache }

    let maxUpMs = null
    if (docs.length) {
      const aff = await mergeIncoming(col, docs)
      maxUpMs = aff.maxUpMs ?? null
      aff.forEach((x) => affected.add(x))
      total += docs.length
    }
    // El cursor avanza SOLO si la respuesta vino del SERVIDOR de ESTA coleccion
    // (no del O global de initialPull): avanzarlo con una respuesta de cache
    // dejaria un hueco permanente en el libro.
    const siguiente = nextCursor({
      prevMs: desdeMs,
      maxUpMs,
      fromServer: !snap.metadata.fromCache
    })
    if (siguiente != null && siguiente !== desdeMs) {
      await db.syncState.put({ key: clave, value: formatCursor(siguiente) })
    }
  }

  // Igual que en el timbre: primero fusionar, DESPUES derivar el stock; al reves
  // parpadearia unos segundos con el valor viejo (recomputeStock lee el libro local).
  if (affected.size) await recomputeStock(affected)
  return { ok: true, total, porColeccion }
}
```

con sus `import` (añadir a los que ya hay):

```js
import { db } from '../../db/db'
import { cursorKey, parseCursor, formatCursor, nextCursor } from './deferred'
```

- [ ] **Paso 2: comprobar que la consulta NUNCA recibe una cadena**

```bash
grep -n "where('_up'" src/features/sync/syncEngine.js
```

Esperado: **una** línea, y su tercer argumento es `Timestamp.fromMillis(desdeMs)`. **Si alguna vez
aparece `where('_up', '>', <algo que no sea Timestamp>)`, es el fallo H-A y hay que parar.**

- [ ] **Paso 3: build y suites**

```bash
npm run build
node src/features/sync/deferred.test.mjs
```

- [ ] **Paso 4: commit**

```bash
git add src/features/sync/syncEngine.js
git commit -m "Cuota de Firestore (F2/3): bajada filtrada por marca de llegada, con el cursor tipado"
```

---

## Tarea 7: el timbre, su tope y la red de seguridad

**Ficheros:**
- Modificar: `src/features/sync/deferred.js` y su suite
- Modificar: `src/app/providers/SyncProvider.jsx`

**Interfaces:**
- Consume: `pullDiferido` (Tarea 6).
- Produce: `RING_DEBOUNCE_MS`, `RING_WINDOW_MS`, `RING_MAX_PER_WINDOW`, `SAFETY_NET_MS`,
  `ringDecision({ nowMs, recientes })` → `{ suena, recientes }`.

- [ ] **Paso 1: escribir la prueba que falla**

```js
import { RING_DEBOUNCE_MS, RING_WINDOW_MS, RING_MAX_PER_WINDOW, SAFETY_NET_MS, ringDecision } from './deferred.js'

// --- 10) El timbre y su tope (R2) -------------------------------------------------
eq(RING_DEBOUNCE_MS, 5000, 'antirrebote de 5 s (el medido: 38 pulsaciones/dia y aparato)')
eq(SAFETY_NET_MS, 3600000, 'red de seguridad cada 60 min por si el timbre se pierde')

const t0 = 1000000
let est = []
for (let i = 0; i < RING_MAX_PER_WINDOW; i++) {
  const d = ringDecision({ nowMs: t0 + i, recientes: est })
  ok(d.suena, `pulsacion ${i + 1} dentro del tope: suena`)
  est = d.recientes
}
ok(!ringDecision({ nowMs: t0 + 100, recientes: est }).suena,
  'R2: pasado el tope, NO suena (si no, el alta de un negocio serian 86.400 lecturas/dia)')
ok(ringDecision({ nowMs: t0 + RING_WINDOW_MS + 1, recientes: est }).suena,
  'y vuelve a sonar cuando la ventana pasa')
eq(ringDecision({ nowMs: t0 + RING_WINDOW_MS + 1, recientes: est }).recientes.length, 1,
  'la ventana se poda: la lista no crece sin limite')
ok(ringDecision({ nowMs: t0, recientes: undefined }).suena, 'sin historial, suena')
```

- [ ] **Paso 2: correrla y comprobar que FALLA**

```bash
node src/features/sync/deferred.test.mjs
```

- [ ] **Paso 3: implementar la decisión pura**

En `deferred.js`:

```js
// El TIMBRE (P6): la bajada diferida se dispara por EVENTO, no por reloj. El
// sondeo paga el silencio; medido sobre el libro real de tres negocios, el timbre
// con antirrebote de 5 s cuesta 3,8 veces menos que sondear cada 15 minutos Y
// ademas borra el retraso. No es un compromiso: gana en los dos ejes.
export const RING_DEBOUNCE_MS = 5000
// R2 — tormenta de timbre: el alta de un negocio son 6.622 documentos y haria
// sonar el timbre muchas veces. Con tope, el peor caso es la red de seguridad.
export const RING_WINDOW_MS = 10 * 60 * 1000
export const RING_MAX_PER_WINDOW = 6
// R2b — si el timbre no suena (el aparato estaba dormido): el peor caso pasa de
// "nunca" a "una hora".
export const SAFETY_NET_MS = 60 * 60 * 1000

export function ringDecision({ nowMs, recientes }) {
  const previas = Array.isArray(recientes) ? recientes : []
  const enVentana = previas.filter((t) => nowMs - t < RING_WINDOW_MS)
  if (enVentana.length >= RING_MAX_PER_WINDOW) return { suena: false, recientes: enVentana }
  return { suena: true, recientes: [...enVentana, nowMs] }
}
```

- [ ] **Paso 4: cablearlo en `SyncProvider.jsx`**

El timbre lo dispara el **proveedor**, no el motor. Sus `import` nuevos:

```js
import { ringDecision, RING_DEBOUNCE_MS, SAFETY_NET_MS } from '../../features/sync/deferred'
import { setRingHandler, pullDiferido } from '../../features/sync/syncEngine'
```

*(`setRingHandler` y `pullDiferido` se añaden a la línea de `import ... from '.../syncEngine'` que ya
existe, no se crea otra.)* Y en el componente:

```js
  // El TIMBRE: cuando una coleccion que SIGUE EN VIVO entrega un cambio de otro
  // aparato, se baja lo diferido. Antirrebote para agrupar las rachas y tope por
  // ventana (R2). Orden: primero pullDiferido y DESPUES recomputeStock —lo hace
  // pullDiferido por dentro—, porque al reves el stock parpadea con el valor viejo.
  const ringTimerRef = useRef(null)
  const ringRecentRef = useRef([])

  const tocarTimbre = () => {
    if (!enabled || !cloudUser) return
    clearTimeout(ringTimerRef.current)
    ringTimerRef.current = setTimeout(async () => {
      const d = ringDecision({ nowMs: Date.now(), recientes: ringRecentRef.current })
      ringRecentRef.current = d.recientes
      if (!d.suena) return // pasada la tormenta, lo recoge la red de seguridad
      if (!navigator.onLine) return
      try {
        await pullDiferido()
      } catch (e) {
        logSyncEvent('bajada-diferida', null, e)
      }
    }, RING_DEBOUNCE_MS)
  }
```

y la red de seguridad, como un `useEffect` propio:

```js
  // Red de seguridad: si el timbre se pierde (aparato dormido), una bajada lenta
  // cada 60 min. Coste marginal y acota el peor caso.
  useEffect(() => {
    if (!enabled || !cloudUser) return
    const id = setInterval(() => {
      if (navigator.onLine) pullDiferido().catch(() => {})
    }, SAFETY_NET_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cloudUser])
```

En `syncEngine.handleIncoming`, avisar al proveedor por una devolución de llamada que se fija igual
que `setDeferred`:

```js
let onRing = null
export function setRingHandler(fn) { onRing = typeof fn === 'function' ? fn : null }
```

y al final de `handleIncoming`, tras fusionar:

```js
    // El timbre solo lo tocan los cambios de colecciones que SIGUEN en vivo: son
    // las que avisan de que el libro se movio (las 13 transacciones que escriben
    // stockMovements escriben tambien products con updatedAt — verificado).
    if (onRing) onRing(col.name)
```

Y en el `useEffect` de la sesión de nube, antes de `startRealtime()`:

```js
        setRingHandler(tocarTimbre)
```

- [ ] **Paso 5: añadir el tirón al traer la app al frente**

En el `useEffect` de `visibilitychange`, junto a `nudgePush()`:

```js
      pullDiferido().catch(() => {}) // lo diferido, al volver al frente
```

- [ ] **Paso 6: build, suite y commit**

```bash
npm run build
node src/features/sync/deferred.test.mjs
git add src/features/sync/deferred.js src/features/sync/deferred.test.mjs \
        src/features/sync/syncEngine.js src/app/providers/SyncProvider.jsx
git commit -m "Cuota de Firestore (F2/4): el timbre con antirrebote, tope por ventana y red de seguridad"
```

---

## Tarea 8: la reconciliación de la transición (P7)

Una lectura completa **antes** de empezar a filtrar. Los aparatos pueden tener **huecos en lo
viejo** por los cortes de cuota de estos meses, y en `stockMovements` un hueco significa que
`recomputeStock` suma un libro incompleto y el stock de ese teléfono queda mal **de forma
permanente**.

**Ficheros:**
- Modificar: `src/features/sync/syncEngine.js`

**Interfaces:**
- Consume: `cursorKey`, `guardState`.
- Produce: `reconciliarDiferidas(businessId, cols)` → `{ ok, reconciledAtMs }`.

- [ ] **Paso 1: implementar**

```js
// P7 — reconciliacion de la TRANSICION. Se hace MIENTRAS la coleccion sigue en
// vivo: su getDocs SIN filtro comparte forma canonica con la del oyente, asi que
// reutiliza su vista en cache y no cuesta lecturas (verificado en el SDK:
// getDocs es un oyente temporal y el mapa de consultas se indexa por forma
// canonica -> NoActionRequired).
//
// NO se hace en cada arranque (spec §10.5, H-B): solo al ENTRAR en diferido —al
// encender la bandera, al pasar la guarda, al volver de un build viejo—. Un
// aparato que ya filtra no se suscribe y por tanto no tiene nada que reconciliar.
export async function reconciliarDiferidas(businessId, cols) {
  const { db: fs, auth } = await getFirebase()
  if (!auth.currentUser) return { ok: false }
  const { collection, getDocs } = await import('firebase/firestore')

  const affected = new Set()
  for (const col of SYNC_COLLECTIONS) {
    if (!cols.has(col.name)) continue
    const snap = await getDocs(collection(fs, 'businesses', businessId, col.name))
    // Si vino de cache, NO cuenta: reconciliar contra la cache no rellena ningun
    // hueco, y marcarlo como hecho dejaria el hueco cerrado para siempre.
    if (snap.metadata.fromCache) return { ok: false }
    const docs = snap.docs.map((d) => d.data())

    // OJO: el maximo es POR COLECCION, no global. Cada cursor tiene que arrancar
    // en el maximo de SU propia coleccion: si `sales` heredara el maximo de
    // `stockMovements` (que se mueve mucho mas), su primera bajada filtrada se
    // saltaria todo lo que quedo entre medias.
    let maxCol = null
    if (docs.length) {
      const aff = await mergeIncoming(col, docs)
      maxCol = aff.maxUpMs ?? null
      aff.forEach((x) => affected.add(x))
    }
    const propio = nextCursor({ prevMs: null, maxUpMs: maxCol, fromServer: true })
    if (propio != null) {
      await db.syncState.put({ key: cursorKey(businessId, col.name), value: formatCursor(propio) })
    }
    // Si maxCol es null (la coleccion esta vacia, o todo lo que hay lo subio un
    // build viejo y no lleva sello) NO se escribe cursor: se deja sin filtro, y
    // la primera `pullDiferido` bajara la coleccion entera una vez. Es lo
    // correcto: con cursor, esos documentos sin `_up` no los devolveria nunca
    // ninguna consulta filtrada.
  }
  if (affected.size) await recomputeStock(affected)
  const reconciledAtMs = Date.now()
  await db.syncState.put({
    key: reconciledKey(businessId),
    value: formatCursor(reconciledAtMs)
  })
  return { ok: true, reconciledAtMs }
}
```

La clave de la marca se declara **en el módulo puro**, junto a `cursorKey`, para que no haya dos
cadenas escritas a mano en sitios distintos:

```js
// Marca de "este aparato ya reconcilio con el servidor para este negocio".
export const reconciledKey = (businessId) => `pull:${businessId}:reconciliado`
```

y su aserción en `deferred.test.mjs`:

```js
import { reconciledKey } from './deferred.js'
eq(reconciledKey('neg1'), 'pull:neg1:reconciliado', 'la marca tambien va atada al negocio')
ok(reconciledKey('neg1').startsWith('pull:'),
  'empieza por pull: -> la Tarea 10 la excluye del respaldo junto con los cursores')
```

- [ ] **Paso 2: comprobar que el máximo no se arrastra entre colecciones**

```bash
grep -n "maxCol" src/features/sync/syncEngine.js
```

Esperado: **tres** coincidencias, las tres dentro del bucle de `reconciliarDiferidas`
(`let maxCol = null`, la asignación y el uso). Si `maxCol` estuviera declarado **fuera** del bucle,
el cursor de la segunda colección heredaría el máximo de la primera: ése es el fallo que este paso
busca.

- [ ] **Paso 3: build, suite y commit**

```bash
npm run build
node src/features/sync/deferred.test.mjs
git add src/features/sync/deferred.js src/features/sync/deferred.test.mjs src/features/sync/syncEngine.js
git commit -m "Cuota de Firestore (F2/5): reconciliacion de la transicion, con cursor por coleccion"
```

---

## Tarea 9: la bandera del negocio y el panel que dice por qué

**Ficheros:**
- Modificar: `src/repositories/configRepo.js`
- Modificar: `src/features/sync/CloudScreen.jsx`
- Modificar: `src/app/providers/SyncProvider.jsx` (decidir `deferidas` y fijarlo)

**Interfaces:**
- Consume: `deferredSet`, `guardState`, `readDevices`, `reconciliarDiferidas`.
- Produce: `configRepo.getBajadaFiltrada()` / `setBajadaFiltrada(v)`.

- [ ] **Paso 1: la bandera, del NEGOCIO y sincronizada (D3)**

En `configRepo.js`, junto a las demás lecturas de config:

```js
  // Bajada filtrada por marca de llegada (spec 2026-09-24-reduccion-cuota, D3).
  // Es del NEGOCIO y SINCRONIZADA a proposito: el dueño la enciende y la apaga
  // para todos desde su aparato, sin tener que entrar con su PIN en cada
  // telefono. Apagada por defecto = comportamiento clasico.
  async getBajadaFiltrada() {
    return !!(await this.get('bajadaFiltrada', false))
  },

  async setBajadaFiltrada(v) {
    await this.set('bajadaFiltrada', !!v)
  },
```

- [ ] **Paso 2: comprobar que queda FUERA de las dos listas de exclusión**

```bash
grep -n "bajadaFiltrada" src/features/sync/collections.js src/features/backup/backupService.js
```

Esperado: **cero coincidencias en los dos ficheros.** La decisión, escrita entera para que nadie la
«corrija» después:

- **Fuera de `LOCAL_CONFIG_KEYS`** → la bandera **sí viaja a la nube**. Es lo que pide D3: el dueño
  la enciende y la apaga **para todos** desde su aparato, sin entrar con su PIN en cada teléfono.
- **Fuera de `DEVICE_ONLY_KEYS`** → la bandera **sí viaja en el respaldo**. Esto **se aparta de la
  letra de D3**, que decía «no viaja en los respaldos», y hay que decirlo: `DEVICE_ONLY_KEYS` es
  «identidad **local** del dispositivo» (licencia, sesión, `deviceId`), y esta bandera es **estado
  del negocio**, como la caja heredada. Restaurar un respaldo con la bandera encendida es seguro,
  porque **cada aparato vuelve a evaluar la guarda** (Tarea 4) y **rehace su reconciliación**
  (Tarea 8) antes de filtrar nada. Lo que **no puede** viajar en un respaldo son los **cursores**,
  y de eso se encarga la Tarea 10.

Si el dueño prefiere la letra de D3, la vuelta atrás es una línea: añadir `'bajadaFiltrada'` a
`DEVICE_ONLY_KEYS`. **Preguntárselo antes de cerrar la tarea.**

- [ ] **Paso 3: decidir `deferidas` en el proveedor**

En `SyncProvider.jsx`, los `import` que hacen falta (ninguno es dinámico: todo es código propio):

```js
import { db } from '../../db/db'
import { configRepo } from '../../repositories/configRepo'
import { useLicense } from './LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { readDevices } from '../../features/sync/deviceRegistry'
import { guardState, deferredSet, parseCursor, reconciledKey } from '../../features/sync/deferred'
import { setDeferred, reconciliarDiferidas } from '../../features/sync/syncEngine'
```

*(`ringDecision`, `RING_DEBOUNCE_MS`, `SAFETY_NET_MS`, `setRingHandler` y `pullDiferido` ya entraron
en la Tarea 7; aquí solo se añaden los que faltan a esas mismas dos líneas de `import`.)*

y, dentro del componente, el estado que el panel de `/cloud` va a leer:

```js
  // Estado visible de la bajada filtrada: QUE se está difiriendo y, si no se
  // difiere nada, POR QUÉ. Lo consume la tarjeta de /cloud (hallazgo H-C).
  const [filtradas, setFiltradas] = useState(() => new Set())
  const [motivoFiltro, setMotivoFiltro] = useState('')
  const { hasModule } = useLicense()
```

**Comprobar antes de escribirlo** que `SyncProvider` está montado **por dentro** de
`LicenseProvider` en `src/app/providers/`; si no lo estuviera, `useLicense()` lanzaría. Si el orden
no lo permite, la alternativa sin tocar el árbol es leer la licencia por el mismo camino que usa
`LicenseProvider` en vez del hook. **No cambiar el orden de los proveedores para esto.**

Y el efecto que decide, que corre al haber sesión de nube:

```js
  // Decide si este aparato filtra, y lo fija ANTES de arrancar el tiempo real.
  // Orden: bandera -> guarda -> (si es la transicion) reconciliar -> fijar.
  useEffect(() => {
    if (!enabled || !cloudUser) return
    let vivo = true
    ;(async () => {
      try {
        const apagar = (motivo) => { setDeferred(new Set()); setFiltradas(new Set()); setMotivoFiltro(motivo) }

        const flagOn = await configRepo.getBajadaFiltrada()
        if (!flagOn) { apagar('Desactivada por el dueño.'); return }

        const businessId = await syncConfig.businessId()
        const recon = await db.syncState.get(reconciledKey(businessId))
        const reconciledAtMs = parseCursor(recon?.value)
        const guarda = guardState({
          devices: await readDevices(), nowMs: Date.now(), reconciledAtMs
        })
        if (!guarda.ok) { apagar(guarda.motivo); return }

        const cols = deferredSet({
          flagOn: true,
          guardOk: true,
          sinMesas: !hasModule(LICENSE_MODULES.MESAS),
          ordersVacia: (await db.orders.count()) === 0
        })
        // TRANSICION: si este aparato aun no ha reconciliado, se hace AHORA, con
        // las colecciones todavia en vivo (por eso no cuesta lecturas).
        if (reconciledAtMs == null) {
          const r = await reconciliarDiferidas(businessId, cols)
          if (!r.ok) { apagar('Falta reconciliar con el servidor.'); return }
        }
        if (!vivo) return
        setDeferred(cols)
        setFiltradas(cols)
        setMotivoFiltro('')
        await restartRealtime() // reabre el vivo ya SIN las diferidas
      } catch (e) {
        // Ante CUALQUIER duda: comportamiento clasico. Nunca se filtra "por si acaso".
        setDeferred(new Set())
        setFiltradas(new Set())
        setMotivoFiltro('No se pudo comprobar; bajando todo, como siempre.')
        logSyncEvent('bajada-diferida-arranque', null, e)
      }
    })()
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cloudUser])
```

- [ ] **Paso 4: exponer el estado por el contexto**

Al objeto `value` de `SyncProvider`, junto a `manualSync` y `nudgePush`:

```js
    // Bajada filtrada: lo lee la tarjeta de /cloud.
    filtradas,
    motivoFiltro,
```

- [ ] **Paso 5: el panel de `/cloud` (hallazgo H-C)**

En `CloudScreen.jsx`, dentro de la vista del dueño (que ya está tras `if (!isOwner)`, `:50`), una
tarjeta nueva. El estado de la casilla se lee de `config` al montar:

```jsx
  const { filtradas, motivoFiltro } = useSync()
  const [bajadaFiltrada, setBajadaFiltrada] = useState(false)
  useEffect(() => {
    let vivo = true
    configRepo.getBajadaFiltrada().then((v) => { if (vivo) setBajadaFiltrada(v) })
    return () => { vivo = false }
  }, [])
```

```jsx
      {/* Bajada filtrada (spec 2026-09-24-reduccion-cuota). Dice SIEMPRE si esta
          filtrando y, si no, POR QUE: un ahorro que no se enciende y no lo dice
          se da por hecho, que es justo como se pierde (hallazgo H-C del §10.5). */}
      <div className="card">
        <h3>Bajada filtrada</h3>
        <label className="field">
          <input
            type="checkbox"
            checked={bajadaFiltrada}
            onChange={async (e) => {
              const v = e.target.checked
              await configRepo.setBajadaFiltrada(v)
              setBajadaFiltrada(v)
            }}
          />
          <span>Bajar solo lo nuevo (ahorra datos y cuota)</span>
        </label>
        <p className="muted">
          {motivoFiltro
            ? `No está filtrando: ${motivoFiltro}`
            : filtradas?.size
              ? `Filtrando: ${[...filtradas].join(', ')}.`
              : 'Bajando todo, como siempre.'}
        </p>
      </div>
```

**El cambio de la casilla se aplica al recargar la app o al reabrir la sesión de nube**, que es
cuando corre el efecto del Paso 3. Decirlo en la propia tarjeta si no se quiere que el dueño toque
el interruptor y no vea nada: una línea de ayuda del tipo *«se aplica al volver a abrir la app»*.

- [ ] **Paso 6: build y commit**

```bash
npm run build
node src/features/sync/deferred.test.mjs
git add src/repositories/configRepo.js src/features/sync/CloudScreen.jsx src/app/providers/SyncProvider.jsx
git commit -m "Cuota de Firestore (F2/6): bandera del negocio y panel que dice por que no filtra"
```

---

## Tarea 10: que el respaldo no arrastre el cursor (P9)

**Verificado sobre el código, no supuesto:** `buildBackup` recorre `db.tables` y solo salta
`errorLog`, así que **hoy `syncState` se respalda entero**, con sus cursores. Restaurar un respaldo
viejo le diría al aparato «ya bajé hasta aquí» cuando es mentira → **hueco permanente**.

**Ficheros:**
- Modificar: `src/features/backup/backupService.js`

- [ ] **Paso 1: excluir los cursores de bajada al construir**

En `buildBackup`, dentro del bucle:

```js
    if (table.name === 'errorLog') continue // diagnostico local: no viaja
    let rows = await table.toArray()
    if (table.name === 'config') rows = rows.filter((r) => !DEVICE_ONLY_KEYS.has(r.key))
    // Los cursores de BAJADA no viajan: restaurar un respaldo viejo le diria al
    // aparato "ya baje hasta aqui" cuando no es verdad, y el hueco seria
    // permanente. Los `push:*` y `retry:*` SI se dejan como hoy: excluirlos
    // tambien seria seguro (el re-push es idempotente por id) pero provocaria
    // una resubida completa innecesaria.
    if (table.name === 'syncState') rows = rows.filter((r) => !String(r.key).startsWith('pull:'))
```

- [ ] **Paso 2: y al restaurar (por si el respaldo viene de un build anterior a este cambio)**

En `applyBackup`, junto al filtro de `config`:

```js
      if (table.name === 'syncState') {
        rows = (rows || []).filter((r) => r && !String(r.key).startsWith('pull:'))
      }
```

- [ ] **Paso 3: comprobarlo contra un respaldo real**

```bash
ls *.json respaldo*.json 2>/dev/null | head
# con un respaldo a mano:
node -e "
const b = require('./<respaldo>.json');
const ss = b.tables.syncState || [];
console.log('syncState en el respaldo:', ss.length);
console.log('pull:* dentro:', ss.filter(r => String(r.key).startsWith('pull:')).length);
"
```

Esperado (tras el cambio, regenerando el respaldo desde `/backup`): `pull:* dentro: 0`.
**Si no hay ningún respaldo en la máquina, decirlo y no darlo por comprobado.**

- [ ] **Paso 4: build y commit**

```bash
npm run build
git add src/features/backup/backupService.js
git commit -m "Cuota de Firestore (F2/7): los cursores de bajada no viajan en el respaldo"
```

---

## Tarea 11: cierre — build, las 30 suites, peso y el runbook de F3

- [ ] **Paso 1: las 30 suites, ninguna saltada**

```bash
for t in src/lib/custodyMath.test.mjs src/lib/dates.test.mjs \
         src/lib/productCustodyMath.test.mjs src/lib/remesas.test.mjs \
         src/lib/fichaCosto.test.mjs src/lib/fichaLines.test.mjs \
         src/lib/kitchenMath.test.mjs src/lib/orderTotals.test.mjs \
         src/lib/saleRevenue.test.mjs src/lib/unitsConfig.test.mjs \
         src/lib/stockLocation.test.mjs src/lib/modalClose.test.mjs \
         src/lib/navSections.test.mjs \
         src/features/sync/retryQueue.test.mjs \
         src/features/reports/fichaReports.test.mjs \
         src/features/help/helpContent.test.mjs \
         src/lib/orderSale.test.mjs \
         src/features/sync/resend.test.mjs \
         src/lib/atomicity.test.mjs \
         src/lib/convergence.test.mjs \
         src/lib/syncLogPolicy.test.mjs \
         src/features/sync/commitWatch.test.mjs \
         src/features/sync/compareResend.test.mjs \
         src/features/sync/compareResendEngine.test.mjs \
         src/lib/dailySalesControl.test.mjs \
         src/lib/dailySalesControl.fuzz.test.mjs \
         src/lib/reportCells.test.mjs \
         src/features/sync/deferred.test.mjs; do node "$t"; done
```

Y las tres que necesitan base real (`ordersRepo`, `syncLog`, `dailyControlLocations`), con el
esbuild de Vite y `fake-indexeddb`, según el comentario de cabecera de cada fichero.

Esperado: **31 suites** (las 30 de hoy + `deferred`), **0 fallos**.

- [ ] **Paso 2: comparar la salida de las 30 existentes con `main`, byte a byte**

```bash
git worktree add ../base-main origin/main
# correr las 30 en los dos arboles, guardando fichero a fichero, y:
diff -r salidas-rama/ salidas-main/
```

Esperado: **sin diferencias**. **Con control negativo**: inyectar un byte en una salida y comprobar
que `diff` lo detecta — sin eso la comparación no mide nada.

- [ ] **Paso 3: medir el peso construyendo `main` en un worktree aparte**

No comparar contra el número que imprime Vite: construir los dos árboles y comprimir con **el mismo**
comando de gzip. Anotar CSS (hash y bytes) y chunk principal (crudo y gzip).

- [ ] **Paso 4: comprobar lo que NO debe haber cambiado**

```bash
git diff --stat origin/main -- src/db/db.js firestore.rules firestore.indexes.json \
  package.json package-lock.json vite.config.js index.html
node -e "import('./src/features/sync/collections.js').then(m => console.log('SYNC_COLLECTIONS:', m.SYNC_COLLECTIONS.length))"
```

Esperado: `git diff --stat` **vacío**, Dexie en **v19** y `SYNC_COLLECTIONS` en **34**.

- [ ] **Paso 5: runbook de F3 — encender en UN negocio, 48 h**

**Orden, y no otro:**

1. **Desplegar** (`npm run deploy`). La bandera nace apagada: el comportamiento es el de hoy.
2. **Esperar a que todos los teléfonos del negocio abran la app nueva.** No hay que contarlos a
   mano: `/cloud` dice si está filtrando y, si no, **qué aparato falta**.
3. **Encender la bandera** en `/cloud` desde el aparato del dueño.
4. **Mirar la consola de Firebase 48 h.** Criterio de aceptación, **los dos**:
   - **las lecturas del proyecto BAJAN**;
   - **las escrituras NO SUBEN** (hallazgo H-D del §10.5: P1 afirma coste cero y la evidencia lo
     respalda —el transform viaja en el mismo `Write`—, pero las escrituras ya tocaron el 100 % del
     tope el 24-sep, así que se mira).
   - y el pull de las colecciones que **siguen en vivo** sigue costando cero.
5. **Reversión:** apagar la bandera desde `/cloud`. Es una escritura en `config` y llega a todos los
   aparatos por la sync.

- [ ] **Paso 6: escribir el acta en `CLAUDE.md`**

Con las cifras **medidas** (peso, suites, aserciones), lo que se verificó y **lo que no se puede
garantizar**. Como mínimo: nadie ha ejecutado esto en un teléfono, no se probó contra la Firestore
real, y los respaldos de los tres negocios no estaban en la máquina donde se auditó el diseño.

- [ ] **Paso 7: commit**

```bash
git add CLAUDE.md
git commit -m "Acta - reduccion de la cuota de Firestore (F1 + F2), con lo medido y lo que no se garantiza"
```

---

## Lo que este plan NO hace, dicho antes de empezar

1. **No toca F5** (extender el filtro al oyente), que es la medida **permanente** — la que deja las
   lecturas en ~3 k constantes. F1+F2 llevan de 113 k a ~36 k/día y **compran menos de un mes (0,6)**.
   Son el experimento barato que valida el sello y el cursor **sin tocar R1**. Decirlo al revés sería
   vender F1+F2 como algo que no son.
2. **No arregla el eco** (§10.4): cada aparato vuelve a subir lo que baja de los otros, y cada eco de
   una fila sellada lleva un `_up` nuevo que cuesta una lectura en los demás. Acota el ahorro real de
   F2 por un factor del orden del número de aparatos. Arreglarlo cambia qué sube `doPush`, que es
   lógica de producción: **va aparte, con su propia autorización y su propia medición**.
3. **No arregla el §8.2** (la venta pisa por LWW un cambio de precio concurrente) ni el §8.3 (bucle
   de recuperación). Son correcciones independientes.
4. **No resuelve el coste de dar de alta un negocio** (§8.1): a los 180 días un alta ya no cabe en el
   tope diario.
5. **Ninguna prueba de este plan toca Firestore.** El módulo puro se prueba entero con node; el
   cableado, no. Lo que valida de verdad la bajada filtrada es el paso 5 de la Tarea 11, con la
   consola delante.

---

## §12. Validación del plan — 26-09-2026 (ejecutada, no citada)

**PRECEDENCIA: este §12 manda sobre las Tareas 1–11.** Donde un bloque de código de una tarea
contradiga a lo de aquí, vale lo de aquí. Es la misma convención que el spec usa con su §10.5.

El plan se contrastó contra el **código real del árbol** (no contra lo que el plan dice del código) y
contra el **SDK instalado**. Todo lo comprobable sin runtime se **ejecutó**. Salieron **un crítico,
cuatro importantes y seis menores**. Nada de esto está programado todavía: **no hay una sola línea de
código del plan escrita** (`src/features/sync/deferred.js` no existe).

### 12.1 Lo que se comprobó y salió CIERTO

No se da por bueno nada del plan sin mirarlo; esto es lo que aguantó:

| Afirmación del plan | Comprobación |
|---|---|
| `toCloud` en `pushEngine.js:65`, llamado en `:173`, `:187`, `:220` | `grep` exacto: las cuatro líneas, tal cual. `const ctx = { fs, setDoc, ref }` está en `:134` y el `import` dinámico en `:130`. |
| El sello va **después** de serializar | **Ejecutado** con el SDK instalado: `JSON.stringify(serverTimestamp())` da `{"_methodName":"serverTimestamp"}`. Sellar antes dejaría un mapa inerte en la nube. |
| H-A (el TIPO del cursor) es real | Confirmado en el SDK: `where` «enforces that documents must contain the specified field» (`index.d.ts:3217-3219`) y `__PRIVATE_typeOrder` da `TimestampValue = 3` / `StringValue = 5`. Un `where('_up','>',<cadena>)` devuelve **cero documentos, sin error**. La Tarea 1 lo cierra bien. |
| `_up` no entra en el LWW | `TS_FIELDS` son seis y `_up` no está: `syncTs({updatedAt, _up})` devuelve el `updatedAt`. **Ejecutado.** |
| `SYNC_COLLECTIONS` = 34, `syncState: 'key'`, Dexie v19 | Leídos del árbol, importando el módulo real. |
| El respaldo arrastra hoy los cursores | `backupService.js:40-43`: sólo salta `errorLog`, así que `syncState` viaja entero. **La Tarea 10 es necesaria.** |
| `caps` es gratis | `registerThisDevice` ya tiene `prev` (`:82`) y su `setDoc` ya va con `{ merge: true }` (`:93`). |
| `configRepo` acepta el estilo de la Tarea 9 | Es un objeto literal con `this.get`/`this.set` (`configRepo.js:8-15`). |

### 12.2 CRÍTICO — C1: el invariante de H-B se rompe en el cableado, y con él el ahorro

El plan declara el invariante en la Tarea 5 («un aparato que filtra **NO** llama a `onSnapshot` sobre
las diferidas, en ningún arranque») y después **lo incumple en la Tarea 9**.

**La evidencia:** `SyncProvider.jsx:89` llama `startRealtime()` **dentro del callback de
`observeAuth`**, sin `await` y sin esperar a nadie. El efecto decisor de la Tarea 9 es asíncrono y
además hace una **lectura de red** (`readDevices`). Cuando termina, el oyente de `stockMovements`
lleva rato abierto.

**Qué pasa entonces, en cada arranque:**

1. Se engancha `onSnapshot` sobre las **34**, diferidas incluidas → **se paga el enganche en frío de
   `stockMovements`**, que es el 53,6 % de D y **justo el coste que F2 existe para quitar**.
2. El `restartRealtime()` del Paso 3 cierra las 34 y reabre **32** → **un enganche extra por arranque
   que hoy no se paga**.

O sea: tal como está escrito, F2 puede **no ahorrar nada y costar más**. No es un detalle de
implementación: es la métrica del proyecto.

**Enmienda propuesta (la decide el dueño):** que la decisión del arranque salga de **estado local ya
persistido** —la bandera en `config` y el veredicto de la guarda guardado en `syncState`—, que es
rápido y no toca la red, y que `startRealtime` lo consulte **antes** de suscribir. La comprobación de
red (`readDevices`) pasa a correr **después**, y sólo sirve para dos cosas: dejar el veredicto listo
para el **siguiente** arranque, y —si la guarda se rompe— volver al tiempo real ya (eso sí con
`restartRealtime`, que es raro y es el lado seguro).

Con eso la **sesión de transición** (la primera, la que reconcilia) se comporta **exactamente como
hoy**: todo en vivo, la reconciliación comparte la vista del oyente y no cuesta lecturas, y el aparato
empieza a filtrar **desde el arranque siguiente**. `restartRealtime()` sale del camino normal.

### 12.3 IMPORTANTES

**I1 · La puerta de la licencia está invertida, y en silencio.** La Tarea 9 escribe
`hasModule(LICENSE_MODULES.MESAS)`. **Esa constante no existe**: el catálogo la llama `TABLES`
(`lib/license.js`). **Ejecutado:** `LICENSE_MODULES.MESAS` es `undefined`, y
`modules.includes(undefined)` es `false`, así que `sinMesas` sale **`true` en un negocio CON mesas**.
Hoy lo tapa la segunda prueba (`ordersVacia`), que es justo por lo que §10.2 pedía las dos — pero el
fallo quedaría **mudo**, que es el peor modo. **Corrección: `LICENSE_MODULES.TABLES`.** No hay linter
que cace esto, y el build tampoco: es un acceso válido a una propiedad.

**I2 · `useLicense()` dentro de `SyncProvider` LANZA.** `App.jsx:15` monta `<SyncProvider>` **por
fuera** de `<LicenseProvider>` (`:17`). El plan avisa en prosa («comprobar antes de escribirlo»), pero
el bloque de código que da a copiar es el que rompe la app entera. **Corrección: leer la licencia por
el mismo camino que `LicenseProvider`** (`licenseRepo.getToken()` → `evaluateLicense` →
`licenseModules`), dentro del efecto, sin hook y sin tocar el orden de los proveedores.

**I3 · Bloqueo permanente por `legacyAt`.** La Tarea 9 sólo reconcilia `if (reconciledAtMs == null)`,
y `reconciledAtMs` sólo se escribe ahí. Si más tarde aparece un `legacyAt` **posterior** a esa marca,
`guardState` devuelve NO y **ya nunca** vuelve a haber una reconciliación que mueva la marca: la
guarda queda cerrada **para siempre**. Contradice a §10.2 («la reconciliación se repite **cada vez**
que una colección entra en diferido»). Cae del lado seguro —no se pierde un dato— pero apaga el
ahorro sin que nadie se entere: **es el modo de fallo de H-C otra vez, por la puerta de al lado.**
**Corrección: re-reconciliar cuando la guarda vuelva a pasar tras un `legacyAt`.**

**I4 · Las herramientas de reparación del dueño dejan de bajar lo diferido.** La Tarea 5 saca las
diferidas de `initialPull`, y por `initialPull` van **tres** caminos que nadie repasó: `manualSync`
—el botón *Sincronizar ahora*— (`SyncProvider.jsx:210`), la recuperación de sesión (`:189`) y
**«bajar de la nube» de `/cloud`** (`CloudScreen.jsx:102`). El dueño pulsaría el botón, vería el verde
de «confirmado» y `stockMovements` **no habría bajado**. Es precisamente la herramienta que usa cuando
algo va mal. **Corrección: los tres encadenan `pullDiferido()` después de `initialPull()`.**

### 12.4 MENORES

| # | Hallazgo | Corrección |
|---|---|---|
| M1 | **El timbre suena con las escrituras propias.** `startRealtime` no mira `hasPendingWrites`, así que cada venta del propio aparato dispara `pullDiferido` (hasta 6 cada 10 min ≈ 864 consultas al día y aparato, de puro eco). §10.2 pedía «de OTRO aparato». | Filtrar en `docChanges()` por `c.doc.metadata.hasPendingWrites`, o pasarle esa marca al timbre. |
| M2 | **`readDevices()` hace su propio `getDocs`** de `/devices`. El plan dice «reutilizando el `getDocs` que `registerThisDevice` ya hace» (Tarea 4, paso 5) y **no es así**. El coste es ridículo (N filas), pero la frase es falsa. | O devolver la lista desde `registerThisDevice`, o corregir la frase y declarar el coste. |
| M3 | **`pullDiferido` no tiene cerrojo.** `runPull` sí lo tiene (`pullBusyRef`). Timbre + red de 60 min + `visibilitychange` pueden solaparse → lecturas dobles y carrera al escribir el cursor. | Un `busyRef` como el de `runPull`. |
| M4 | **Colisión de nombre:** `cursorKey` ya existe en `pushEngine.js:52` con otro significado (`push:<col>`), y la Tarea 2 edita ese mismo fichero. | Renombrar el del módulo puro a `pullCursorKey`. |
| M5 | `reconciledKey` se usa en `syncEngine.js` (Tarea 8) pero **no se añade** a la línea de `import` que fija la Tarea 6. | Añadirlo. Lo cazaría el build, pero el paso falta. |
| M6 | La prueba del timbre **no fija el valor** de `RING_WINDOW_MS` ni de `RING_MAX_PER_WINDOW`: el bucle se prueba contra la propia constante, así que cambiar 6 por 600 no pondría nada en rojo. | Dos aserciones de valor, como las de `RING_DEBOUNCE_MS`. |

### 12.5 Observaciones — no son defectos, pero hay que saberlas

1. **`sales` no vuelve al vivo a media sesión** si llega un pedido; sólo al arrancar. §10.2 lo pide
   («si llega un pedido, `sales` vuelve al vivo»). Escenario real: un aparato con la licencia de
   `mesas` ya renovada crea pedidos mientras otro, con la licencia vieja, sigue difiriendo `sales` —
   y el candado del doble cobro lee `db.sales` **local**.
2. **Apagar la bandera a distancia tampoco es inmediato:** cada aparato la aplica en su siguiente
   arranque. D3 prometía «la apaga para todos desde su aparato»; es cierto, pero con esa demora.
3. **El primer arranque tras actualizar no filtra**, porque `touchThisDevice()` (`SyncProvider:90`) y
   el efecto decisor salen a la vez y el aparato puede leerse a sí mismo todavía sin `caps`. Lado
   seguro, y se cura solo.
4. `mergeIncoming` tiene **dos salidas tempranas** (`pullEngine.js:20` y `:24`) que devuelven un `Set`
   sin `maxUpMs`. Con `?? null` no rompe; pero si una tanda entera llegara sin clave primaria, el
   cursor no avanzaría y esos documentos se releerían en **cada** timbre.

### 12.6 Cobertura del spec y de la disciplina del plan

- **Foco de revisión:** los cinco puntos tienen prueba en la tarea que posee ese código (1, 1, 1, 4, 1).
  Comprobado uno a uno.
- **Control negativo:** la Tarea 1 lo lleva (cuatro mutaciones). Es lo que hace que la suite mida algo.
- **§10.5:** H-A cerrado (Tareas 1 y 6), H-C cerrado (Tarea 4 + panel), H-D cerrado (Tarea 11, paso 5).
  **H-B está declarado pero incumplido** → C1.
- **§10.2:** dos viñetas sin cubrir — la reconciliación repetida (I3) y el timbre «de otro aparato» (M1).
- **Placeholders:** ninguno en el código. Quedan dos pasos de prosa sin guion exacto (Tarea 11, paso 2,
  y Tarea 10, paso 3), los dos con su salvedad ya escrita.
- **Tipos y nombres entre tareas:** coherentes salvo M4 y M5.

### 12.7 Lo que esta validación NO puede garantizar

1. **Cero runtime.** Sin emulador, sin Firestore real y sin un teléfono. Lo ejecutado es el SDK
   instalado y los módulos puros del repo.
2. **No se midió nada del negocio.** Las cifras de §1–§9 del spec siguen como las dejó su sesión: aquí
   no se tocaron.
3. **Que el cableado de las Tareas 2 a 10 funcione no lo prueba nada**, ni lo va a probar: el módulo
   puro se prueba entero con node; el cableado, no. Eso lo decide la consola en F3.
4. **Los hallazgos son de leer el código y de ejecutar en node, no de ejecutar la app.** Un defecto que
   sólo aparezca con la sesión de nube abierta no lo habría visto esta validación.
