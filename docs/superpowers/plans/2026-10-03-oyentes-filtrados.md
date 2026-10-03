# Oyentes filtrados por marca de llegada (F5) — plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: usar superpowers:subagent-driven-development (recomendado) o
> superpowers:executing-plans para ejecutar este plan tarea a tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que cada enganche en frío baje solo lo llegado a la nube desde la última vez, en vez de
releer la historia entera. Que se encienda solo, sin que el usuario configure nada, y sin perder la
cura que hoy da la relectura completa.

**Arquitectura:**
- **Lógica pura** en `src/features/sync/f5.js`: sello, guarda, detector y decisiones de sesión. Se
  prueba con node.
- **Estado de sesión** en `src/features/sync/f5Engine.js`: consultas, cursores, reconciliación y cura.
  Se prueba con `fake-indexeddb`.
- **Cableado mínimo** en `pushEngine`, `syncEngine`, `deviceRegistry`, `SyncProvider`,
  `backupService`, `handoffService` y `CloudScreen`.
- **Control del dueño:** el interruptor es una constante de build, `src/features/sync/f5Config.js`.

**Stack:** React 18 + Vite 6, Dexie 4, Firebase 12.15.0 (Firestore con caché persistente), pruebas
`.test.mjs` con node y esbuild + `fake-indexeddb`.

**Spec:** `docs/superpowers/specs/2026-10-03-oyentes-filtrados-design.md` (v2.1). **Hay que leerla
entera antes de empezar.** La §3 (qué cura hoy la relectura) es la razón de casi todas las tareas.

## Restricciones globales

- Todo en la rama `claude/awesome-dirac-484azm`. **Nada a `main`.** **Sin Pull Requests.**
- Idioma español en el código, los comentarios y los commits. Hay que imitar la densidad y el tono de
  los comentarios vecinos (`deferred.js` y `echoLedger.js` son el modelo).
- `npm run build` limpio antes de **cada** commit. Firebase siempre con `import()` dinámico: ningún
  fichero nuevo importa `firebase/*` de forma estática.
- Nada se borra en los datos del negocio. Los estados locales de `syncState` se **dejan en blanco**
  (`value: ''`) y no se borran: es el patrón de `SyncProvider.jsx:362`.
- **`OYENTES_FILTRADOS` nace en `[]`.** Con eso, el filtro no se enciende en ningún negocio.
- **No se toca** `src/db/db.js`, `firestore.rules`, `firestore.indexes.json`, `package*.json`,
  `vite.config.js`, `collections.js`, `ordersRepo.js`, `salesRepo.js` ni `src/features/tables/`.
- **Margen de cursor: 120 s** (`CURSOR_MARGIN_MS`, que ya existe).
- **Plazos fijos:**
  - olvido: 7 días con `caps.up` y 30 días sin él;
  - reutilizar la consulta de la sesión anterior: 25 min;
  - freno entre renovaciones: 25 min;
  - renovar por tamaño: vista de más de 300 documentos;
  - bloqueo tras disparar el detector: 24 h;
  - reaperturas de un oyente muerto: 5, 10, 20, 40 y luego 60 min.
- **Variable de las órdenes:**
  - `S` es un directorio temporal fuera del repo, por ejemplo
    `S="${TMPDIR:-/tmp}/f5"; mkdir -p "$S"`;
  - `corre_base` se define una vez por consola:
    `corre_base() { npx esbuild "$1" --bundle --platform=node --format=esm --outfile="$S/b.mjs" && node "$S/b.mjs"; }`.
- **Identificadores libres (no hay linter, y el build NO los caza).** `esbuild` tampoco: trata
  cualquier nombre suelto como global. Se usa este script, guardado en `$S/libres.mjs`, con
  `@babel/parser` y `@babel/traverse`, que ya están en `node_modules` (verificado el 03-10-2026):

  ```js
  import { readFileSync } from 'node:fs'
  import { parse } from '@babel/parser'
  import traverseMod from '@babel/traverse'
  const traverse = traverseMod.default || traverseMod
  const G = new Set(('window document navigator console setTimeout clearTimeout setInterval clearInterval ' +
    'Promise Date Math JSON Number String Object Array Set Map Error globalThis BroadcastChannel undefined NaN ' +
    'Infinity isFinite parseInt parseFloat structuredClone Symbol Boolean RegExp URL Blob TextEncoder TextDecoder ' +
    'queueMicrotask fetch localStorage sessionStorage indexedDB crypto performance alert confirm location history ' +
    'Intl Uint8Array ArrayBuffer Reflect WeakMap encodeURIComponent decodeURIComponent atob btoa').split(' '))
  let total = 0
  for (const f of process.argv.slice(2)) {
    const ast = parse(readFileSync(f, 'utf8'), { sourceType: 'module', plugins: ['jsx'] })
    traverse(ast, { ReferencedIdentifier(p) {
      const n = p.node.name
      if (p.scope.hasBinding(n) || G.has(n)) return
      total++; console.log(f, p.node.loc.start.line, n)
    } })
  }
  console.log('TOTAL libres:', total)
  ```

  Se ejecuta con `NODE_PATH="$PWD/node_modules" node "$S/libres.mjs" <ficheros>`. Si el ESM no
  resuelve con `NODE_PATH`, el script se copia dentro del repo **solo para ejecutarlo** y se borra
  después. Lo esperado es `TOTAL libres: 0`. **Control negativo obligatorio:** una copia con
  `noExisteNunca()` inyectado tiene que dar 1.

## Puntos de revisión

1. **Restaurar un respaldo en un aparato que ya filtra:** el usuario espera ver los datos actuales
   tras reabrir. Tarea 9: la restauración deja en blanco el veredicto de F5 y el de F2.
2. **Un pase de bajada en el que la fusión lanza:** el cursor no debe avanzar. Tareas 7 y 8: el
   avance está DESPUÉS de fusionar y de recalcular, solo con respuesta del servidor.
3. **Un teléfono que nunca publicó `caps.up` y lleva 8 días sin abrirse:** debe seguir bloqueando,
   porque el detector en el dato no lo vería. Tarea 2: caso de la guarda.
4. **Los primeros documentos de la sesión filtrada, subidos con `main` justo antes de la
   transición:** no deben bloquear el negocio 24 h. Tarea 1 (corte) y Tarea 7 (corte = el mayor
   `sealAllSeenAt`).
5. **Un teléfono recién vinculado** antes de que `config` baje: no debe escribir
   `subidaSinEco = true` encima de un `false` del dueño. Tarea 10: la escritura cuelga de
   `configDelServidor`.

---

## Mapa de ficheros

| Fichero | Qué | Tarea |
|---|---|---|
| `src/features/sync/f5.js` (nuevo) | Lógica pura | 1, 2 |
| `src/features/sync/f5.test.mjs` (nuevo) | Su suite (node directo) | 1, 2 |
| `src/features/sync/f5Wiring.test.mjs` (nuevo) | Candados sobre el FUENTE del cableado (node directo) | 3, 4, 6, 8, 9 |
| `src/features/sync/deferred.js` | `stripUp` quita también `_f5` | 3 |
| `src/features/sync/pushEngine.js` | Sella con `sealF5` | 3 |
| `src/features/sync/compareResendFirebase.js` | Sella con `sealF5` | 3 |
| `src/repositories/configRepo.js` | `subidaSinEco` por defecto `true`; `oyentesBloqueoHasta` | 4 |
| `src/features/backup/backupService.js` | `oyentesBloqueoHasta` fuera del respaldo; cura | 4, 9 |
| `src/features/sync/echoLedger.js` | Libro de ecos compartido entre pestañas | 5 |
| `src/features/sync/deviceRegistry.js` | `upAll`, `sealAllSeenAt`, `upAllLegacyAt`, publicar estado, vigía | 6 |
| `src/features/sync/f5Engine.js` (nuevo) | Sesión, cursores, reconciliación y cura | 7 |
| `src/features/sync/f5Engine.test.mjs` (nuevo) | Su suite (`corre_base`) | 7 |
| `src/features/sync/syncEngine.js` | Oyentes y pull con la consulta de sesión; oyentes muertos | 8 |
| `src/features/handoff/handoffService.js` | Cura al importar un turno | 9 |
| `src/features/sync/f5Cura.test.mjs` (nuevo) | La restauración y la importación curan (`corre_base`) | 9 |
| `src/features/sync/f5Config.js` (nuevo) | `OYENTES_FILTRADOS = []` | 10 |
| `src/app/providers/SyncProvider.jsx` | Decisión, vigías, renovación y escritura de `subidaSinEco` | 10 |
| `src/features/sync/CloudScreen.jsx` | Tarjeta de estado y reparación | 11 |
| `CLAUDE.md` | Acta y lista de suites | 12 |

---

### Tarea 1: `f5.js` — sello, claves, lista y detector

**Ficheros:**
- Crear: `src/features/sync/f5.js`
- Crear: `src/features/sync/f5.test.mjs`

**Interfaces:**
- Consume: `SYNC_COLLECTIONS` (`./collections.js`); `upToMillis`, `CURSOR_MARGIN_MS` (`./deferred.js`).
- Produce:
  - `MARCA_F5: '_f5'`, `F5_SEALED: string[]`, `isF5Sealed(name): boolean`;
  - `sealF5(name, plain, sentinel): object`;
  - `f5Key(businessId, parte): string`;
  - `esClaveF5(key): boolean`, `esClaveDeCura(key): boolean`;
  - `enListaF5(lista, businessId): boolean`;
  - `sinMarca(docs, corteMs): { n: number, maxMs: number|null }`.

- [ ] **Paso 1: escribir la suite que falla**

`src/features/sync/f5.test.mjs`:

```js
// Suite del modulo PURO de los oyentes filtrados (spec 2026-10-03-oyentes-filtrados
// v2.1). Se corre con:  node src/features/sync/f5.test.mjs
import assert from 'node:assert/strict'
import { SYNC_COLLECTIONS } from './collections.js'
import {
  MARCA_F5, F5_SEALED, isF5Sealed, sealF5, f5Key, esClaveF5, esClaveDeCura,
  enListaF5, sinMarca
} from './f5.js'

let n = 0
const ok = (cond, msg) => { assert.ok(cond, msg); n++ }
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++ }

// --- 1) Que se sella (§5.1) ----------------------------------------------------
eq(MARCA_F5, '_f5', 'la marca de build se llama _f5')
eq(F5_SEALED.length, SYNC_COLLECTIONS.length - 1, 'se sellan todas las colecciones menos una')
ok(!isF5Sealed('config'), 'config NO: la consola escribe sus banderas sin _up')
ok(['stockMovements', 'sales', 'products', 'orders', 'orderItems', 'users'].every(isF5Sealed),
  'las de F1 y todas las demas')
ok(!isF5Sealed('devices') && !isF5Sealed('inventada'), 'nada que no este en SYNC_COLLECTIONS')

// --- 2) El sello ----------------------------------------------------------------
const cent = () => ({ __centinela: true })
eq(sealF5('products', { id: 'p1', price: 5 }, cent),
  { id: 'p1', price: 5, _up: { __centinela: true }, _f5: 1 },
  'sella con el centinela VIVO y la marca de build')
eq(sealF5('products', { id: 'p1', _up: 'viejo', _f5: 0 }, cent)._up, { __centinela: true },
  'pisa un _up viejo que un build viejo dejara en Dexie')
eq(sealF5('products', { id: 'p1', _f5: 0 }, cent)._f5, 1, 'y la marca')
const cfg = sealF5('config', { key: 'areas', value: [] }, cent)
eq(cfg, { key: 'areas', value: [] }, 'config sale IDENTICA')
ok(!('_up' in cfg) && !('_f5' in cfg), 'sin claves de sello')
const entrada = { id: 'x' }
sealF5('sales', entrada, cent)
eq(entrada, { id: 'x' }, 'no muta el objeto de entrada')

// --- 3) Claves (§5.4 y §5.7) ----------------------------------------------------
eq(f5Key('neg1', 'veredicto'), 'pull:neg1:f5:veredicto', 'bajo pull: (no viaja en el respaldo)')
ok(esClaveF5('pull:neg1:f5:sesion') && esClaveF5(f5Key('n', 'corte')), 'reconoce las suyas')
ok(!esClaveF5('pull:neg1:stockMovements') && !esClaveF5('pull:neg1:diferidas'),
  'NO son suyas ni los cursores ni el veredicto de F2')
ok(!esClaveF5('push:sales') && !esClaveF5(null) && !esClaveF5(42), 'ni nada mas')
ok(esClaveDeCura('pull:neg1:f5:veredicto') && esClaveDeCura('pull:neg1:diferidas') &&
  esClaveDeCura('pull:neg1:reconciliado'), 'la cura deja en blanco F5 y el veredicto/reconciliacion de F2')
ok(!esClaveDeCura('pull:neg1:stockMovements') && !esClaveDeCura('pull:neg1:bajadaCompleta'),
  'pero NO los cursores por coleccion ni la marca de bajada completa')
ok(!esClaveDeCura('push:stockMovements') && !esClaveDeCura('retry:sales'), 'ni la subida')

// --- 4) La lista del build (D2) ---------------------------------------------------
ok(!enListaF5([], 'neg1'), 'lista vacia: nadie (paso 1 del despliegue)')
ok(enListaF5(['neg1'], 'neg1') && !enListaF5(['neg1'], 'neg2'), 'piloto por negocio')
ok(enListaF5('todos', 'neg2'), 'todos')
ok(!enListaF5('todos', '') && !enListaF5('todos', null), 'sin negocio vinculado, nunca')
ok(!enListaF5(undefined, 'neg1') && !enListaF5('algunos', 'neg1'),
  'cualquier otro valor: nadie (lado seguro)')

// --- 5) Detector en el dato (§5.3) ------------------------------------------------
const C = 1_000_000
const ts = (ms) => ({ toMillis: () => ms })
eq(sinMarca([{ _up: ts(C + 1) }], C), { n: 1, maxMs: C + 1 },
  'sellado sin _f5 por encima del corte: un build de main subiendo AHORA')
eq(sinMarca([{ _up: ts(C + 1), _f5: 1 }], C), { n: 0, maxMs: null }, 'con marca: es de un build F5')
eq(sinMarca([{ _up: ts(C) }, { _up: ts(C - 5) }], C), { n: 0, maxMs: null },
  'en el corte o por debajo NO cuenta (lo subido con main ANTES de actualizarse)')
eq(sinMarca([{ _up: ts(C + 3) }, { _up: ts(C + 9) }, { _up: ts(C + 2), _f5: 1 }], C), { n: 2, maxMs: C + 9 },
  'cuenta los culpables y da el mayor _up (hora del SERVIDOR, para el bloqueo)')
eq(sinMarca([{ id: 'sin-sello' }], C), { n: 0, maxMs: null }, 'sin _up no se puede juzgar')
eq(sinMarca([{ _up: ts(C + 9) }], null), { n: 0, maxMs: null },
  'sin corte conocido no se cuenta NADA (nunca un falso positivo por omision)')
eq(sinMarca(null, C), { n: 0, maxMs: null }, 'entrada rota')

console.log(`f5 (oyentes filtrados, modulo puro): ${n} aserciones OK`)
```

- [ ] **Paso 2: ejecutarla y ver que falla**

Ejecutar: `node src/features/sync/f5.test.mjs`
Esperado: FALLA con `ERR_MODULE_NOT_FOUND` (no existe `f5.js`).

- [ ] **Paso 3: escribir `f5.js`**

```js
// ---------------------------------------------------------------------------
// Oyentes filtrados por marca de llegada (spec docs/superpowers/specs/
// 2026-10-03-oyentes-filtrados-design.md, v2.1).
// MODULO PURO: sin Dexie, sin Firestore, sin React. Se prueba entero con node.
// El cableado vive en f5Engine.js, syncEngine.js, deviceRegistry.js y en el
// SyncProvider. Mismo patron que deferred.js y echoLedger.js.
//
// Hoy cada relectura completa CURA cualquier divergencia local. Filtrar por la
// marca de llegada quita esa cura: todo lo que quede por debajo del cursor deja
// de curarse PARA SIEMPRE. Por eso este modulo es sobre todo de guardas (§3).
// ---------------------------------------------------------------------------
import { SYNC_COLLECTIONS } from './collections.js'
import { upToMillis, CURSOR_MARGIN_MS } from './deferred.js'

// §5.1 — Se sella TODO menos `config`: es pequeña, y el procedimiento documentado
// para tocar banderas desde la consola escribe SIN `_up`, que una consulta
// filtrada no devolveria nunca. `_f5` marca lo que sello un build F5: un
// documento con `_up` y sin `_f5` solo puede venir de un build de main.
export const MARCA_F5 = '_f5'
export const F5_SEALED = SYNC_COLLECTIONS.map((c) => c.name).filter((n) => n !== 'config')
export const isF5Sealed = (name) => F5_SEALED.includes(name)

// Como `seal` de deferred.js: va DESPUES de serializar (el centinela de
// serverTimestamp() no sobrevive a JSON.stringify) y pisa cualquier `_up`/`_f5`
// que un build viejo hubiera dejado en Dexie. No muta la entrada.
export function sealF5(name, plain, sentinel) {
  if (!isF5Sealed(name)) return plain
  return { ...plain, _up: sentinel(), [MARCA_F5]: 1 }
}

// Claves de estado de F5 en `syncState`. Bajo `pull:` A PROPOSITO: el respaldo
// excluye ese prefijo (backupService.js), y restaurar un estado de filtro viejo
// dejaria un hueco permanente.
export const f5Key = (businessId, parte) => `pull:${businessId}:f5:${parte}`
export const esClaveF5 = (key) =>
  typeof key === 'string' && key.startsWith('pull:') && key.includes(':f5:')

// §5.7 — Lo que se deja en blanco para devolver la cura tras restaurar un
// respaldo o importar un turno: el estado de F5 Y el veredicto/reconciliacion de
// F2 (si no, lo que F2 difiere seguiria sin curarse). Los cursores por coleccion
// NO: nunca retroceden, y tras la relectura completa son correctos.
export const esClaveDeCura = (key) =>
  esClaveF5(key) ||
  (typeof key === 'string' && key.startsWith('pull:') &&
    (key.endsWith(':diferidas') || key.endsWith(':reconciliado')))

// D2 — La constante del build: [] (nadie), lista de uid (piloto) o 'todos'.
// Cualquier otro valor: nadie. Sin negocio vinculado: nunca.
export function enListaF5(lista, businessId) {
  if (!businessId) return false
  if (lista === 'todos') return true
  return Array.isArray(lista) && lista.includes(businessId)
}

// §5.3 — Detector en el dato. Cuenta los documentos con `_up` por ENCIMA del
// corte y sin `_f5`, y devuelve el mayor `_up` de ellos (hora del SERVIDOR: con
// ella se calcula el bloqueo, no con el reloj de un telefono). Sin corte conocido
// no cuenta nada: un falso positivo bloquea el negocio entero 24 h.
export function sinMarca(docs, corteMs) {
  if (!Array.isArray(docs) || !Number.isFinite(corteMs)) return { n: 0, maxMs: null }
  let n = 0
  let maxMs = null
  for (const d of docs) {
    const ms = upToMillis(d?._up)
    if (ms == null || ms <= corteMs || d[MARCA_F5]) continue
    n++
    if (maxMs == null || ms > maxMs) maxMs = ms
  }
  return { n, maxMs }
}

// Para que el import no quede huerfano en la Tarea 1 (lo usa la Tarea 2).
export { CURSOR_MARGIN_MS }
```

- [ ] **Paso 4: ejecutarla y ver que pasa**

Ejecutar: `node src/features/sync/f5.test.mjs`
Esperado: `f5 (oyentes filtrados, modulo puro): 30 aserciones OK`.

- [ ] **Paso 5: control negativo**

En `f5.js`, cambiar temporalmente `.filter((n) => n !== 'config')` por `.filter(() => true)`.
Ejecutar la suite: debe FALLAR («se sellan todas las colecciones menos una»).
Después cambiar `ms <= corteMs` por `ms < corteMs`: debe FALLAR («en el corte o por debajo NO cuenta»).
Revertir las dos con `git checkout -- src/features/sync/f5.js`. Ojo: el fichero es nuevo y sin
commitear, así que se revierte a mano y se vuelve a ejecutar la suite hasta que dé verde.

- [ ] **Paso 6: build y commit**

```bash
npm run build
git add src/features/sync/f5.js src/features/sync/f5.test.mjs
git commit -m "Oyentes filtrados (1/12): modulo puro del sello, las claves y el detector en el dato

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 2: `f5.js` — la guarda y las decisiones de sesión

**Ficheros:**
- Modificar: `src/features/sync/f5.js`, para añadir al final y quitar la reexportación provisional
  de `CURSOR_MARGIN_MS`.
- Modificar: `src/features/sync/f5.test.mjs`, para añadir los casos antes del `console.log` final.

**Interfaces:**
- Consume: lo de la Tarea 1 y `upToMillis` y `CURSOR_MARGIN_MS`.
- Produce:
  - constantes `OLVIDO_CON_UP_MS`, `OLVIDO_SIN_UP_MS`, `REUSO_SESION_MS`, `FRENO_RENOVACION_MS`,
    `OCULTA_RENUEVA_MS`, `VISTA_RENUEVA_DOCS` y `BLOQUEO_MS`;
  - `olvidado(d, ahoraMs): boolean`;
  - `corrioSinSelloCompleto(d): boolean`;
  - `marcaLegacyF5(prev): boolean`;
  - `ahoraServidor(devices, fallbackMs): number`;
  - `guardF5({ enLista, sinEco, bloqueoHastaMs, devices, reconciledMs, nowMs })` →
    `{ ok, ilegible, bloqueantes, motivo, ahoraMs }`;
  - `corteDetector(devices, ahoraMs): number|null`;
  - `decidirCursorSesion({ persistedMs, prev, nowMs }): number|null`;
  - `cursorVacia(maxPrevioMs): number|null`;
  - `debeRenovar({ nowMs, ultimaMs, vistaMax, cursorAvanzo, ocultaMs }): boolean`;
  - `esperaReapertura(intentos): number`.

- [ ] **Paso 1: añadir los casos que fallan** (antes del `console.log` final de `f5.test.mjs`; además
  hay que ampliar el `import` con los nombres nuevos)

```js
// --- 6) Guarda (§5.3) -------------------------------------------------------------
const DIA = 86400000
const AHORA = Date.UTC(2026, 9, 3, 12, 0, 0)
const bien = (id, extra = {}) => ({
  id, active: true, caps: { up: 1, upAll: 1 },
  lastSeenAt: AHORA - 1000, sealAllSeenAt: AHORA - 1000, ...extra
})
const base = { enLista: true, sinEco: true, bloqueoHastaMs: null, reconciledMs: AHORA - 5000, nowMs: AHORA }
const g = (extra) => guardF5({ ...base, ...extra })

ok(g({ devices: [bien('a'), bien('b')] }).ok, 'todos al dia: filtra')
ok(!g({ enLista: false, devices: [bien('a')] }).ok, 'fuera de la lista del build: no')
ok(!g({ sinEco: false, devices: [bien('a')] }).ok, 'subida sin eco apagada: no (su eco costaria lecturas)')
ok(!g({ bloqueoHastaMs: AHORA + DIA, devices: [bien('a')] }).ok, 'bloqueo vigente: no')
ok(g({ bloqueoHastaMs: AHORA - 2000, devices: [bien('a')] }).ok,
  'bloqueo vencido respecto a la hora del SERVIDOR (AHORA-1000): si')
const vacio = g({ devices: [] })
ok(!vacio.ok && vacio.ilegible, 'lista vacia: ILEGIBLE (se conserva el veredicto, no se cae al vivo)')
ok(g({ devices: null }).ilegible, 'lista rota: ilegible')
const sinAll = g({ devices: [bien('a'), bien('b', { caps: { up: 1 } })] })
ok(!sinAll.ok && /no ha actualizado/.test(sinAll.motivo), 'uno sin upAll bloquea y lo dice')
ok(g({ devices: [bien('a'), bien('b', { caps: { up: 1 }, lastSeenAt: AHORA - 8 * DIA })] }).ok,
  'con caps.up y 8 dias sin verse: olvidado (D3, 7 dias)')
ok(!g({ devices: [bien('a'), { id: 'v', active: true, lastSeenAt: AHORA - 8 * DIA }] }).ok,
  'SIN caps.up y 8 dias: SIGUE bloqueando (Punto de revision 3: el detector en el dato no lo ve)')
ok(g({ devices: [bien('a'), { id: 'v', active: true, lastSeenAt: AHORA - 31 * DIA }] }).ok,
  'sin caps.up y 31 dias: olvidado')
ok(g({ devices: [bien('a'), bien('r', { active: false })] }).ok, 'retirado: no cuenta')
ok(!g({ devices: [bien('a'), { id: 'n', active: true }] }).ok,
  'sin lastSeenAt NO se le da por olvidado: sin upAll, bloquea')
const ahoraViejo = g({ devices: [bien('a'), bien('b', { lastSeenAt: AHORA, sealAllSeenAt: AHORA - 60000 })] })
ok(!ahoraViejo.ok && /versión antigua/.test(ahoraViejo.motivo),
  'lastSeenAt > sealAllSeenAt: un build SIN F5 corriendo AHORA (vuelta atras a main) bloquea')
ok(!g({ devices: [bien('a'), bien('b', { upAllLegacyAt: AHORA - 1000 })] }).ok,
  'upAllLegacyAt posterior a la reconciliacion: bloquea')
ok(g({ devices: [bien('a'), bien('b', { upAllLegacyAt: AHORA - 9000 })] }).ok,
  'upAllLegacyAt anterior a la reconciliacion: ya estaba curado')
ok(g({ reconciledMs: null, devices: [bien('a'), bien('b', { upAllLegacyAt: AHORA - 1000 })] }).ok,
  'sin reconciliar todavia: la marca no bloquea (la reconciliacion lo traera todo)')
eq(g({ devices: [bien('a')] }).ahoraMs, AHORA - 1000, '"ahora" es la hora del SERVIDOR (mayor lastSeenAt)')
ok(g({ nowMs: Date.UTC(1970, 0, 2), devices: [bien('a'), bien('b')] }).ok,
  'un telefono con la fecha en 1970 decide igual (no usa su reloj si hay hora del servidor)')

// --- 7) Marca de build viejo (§5.2) ------------------------------------------------
ok(!marcaLegacyF5(null), 'aparato nuevo: nada que marcar')
ok(marcaLegacyF5({ lastSeenAt: AHORA }), 'venia de un build sin F5 (sin sealAllSeenAt): se marca')
ok(!marcaLegacyF5({}), 'ficha sin nada: no hay prueba')
ok(marcaLegacyF5({ lastSeenAt: AHORA, sealAllSeenAt: AHORA - 1 }), 'un build sin F5 lo toco despues de sellar')
ok(!marcaLegacyF5({ lastSeenAt: AHORA, sealAllSeenAt: AHORA }), 'la ultima vez fue F5: nada')

// --- 8) Corte del detector y decisiones de sesion (§5.3, §5.4, §5.5) ---------------
eq(corteDetector([bien('a', { sealAllSeenAt: AHORA - 50 }), bien('b', { sealAllSeenAt: AHORA - 10 })], AHORA),
  AHORA - 10, 'el corte es el MAYOR sealAllSeenAt: lo subido con main antes de actualizarse queda debajo')
eq(corteDetector([bien('a', { sealAllSeenAt: AHORA - 50 }),
  bien('b', { sealAllSeenAt: AHORA + 99, lastSeenAt: AHORA - 40 * DIA })], AHORA), AHORA - 50,
'un olvidado no cuenta para el corte')
eq(corteDetector([], AHORA), null, 'sin aparatos no hay corte (y el detector no cuenta nada)')

eq(decidirCursorSesion({ persistedMs: 500, prev: { cursorMs: 300, lastServerMs: AHORA - 60000 }, nowMs: AHORA }),
  300, 'snapshot del servidor hace menos de 25 min: MISMA consulta (el token sigue valiendo)')
eq(decidirCursorSesion({ persistedMs: 500, prev: { cursorMs: 300, lastServerMs: AHORA - 26 * 60000 }, nowMs: AHORA }),
  500, 'mas de 25 min: el cursor persistido')
eq(decidirCursorSesion({ persistedMs: 500, prev: null, nowMs: AHORA }), 500, 'sin sesion previa: el persistido')
eq(decidirCursorSesion({ persistedMs: null, prev: null, nowMs: AHORA }), null,
  'sin cursor: null (esa coleccion va sin filtro, el lado seguro)')
eq(cursorVacia(10 * 60000), 10 * 60000 - 120000, 'coleccion vacia: el mayor _up previo menos el margen')
eq(cursorVacia(null), null, 'sin nada previo: no hay cursor posible')

ok(!debeRenovar({ nowMs: AHORA, ultimaMs: AHORA - 60000, vistaMax: 9999, cursorAvanzo: true, ocultaMs: 0 }),
  'freno: no se renueva dos veces en 25 min')
ok(debeRenovar({ nowMs: AHORA, ultimaMs: null, vistaMax: 301, cursorAvanzo: true, ocultaMs: 0 }),
  'vista de mas de 300 y el cursor avanzo: renueva')
ok(!debeRenovar({ nowMs: AHORA, ultimaMs: null, vistaMax: 301, cursorAvanzo: false, ocultaMs: 0 }),
  'vista grande pero el cursor NO avanzo: renovar daria la MISMA consulta, no se renueva')
ok(debeRenovar({ nowMs: AHORA, ultimaMs: null, vistaMax: 0, cursorAvanzo: false, ocultaMs: 26 * 60000 }),
  'vuelta al frente tras mas de 25 min oculta: renueva')
ok(!debeRenovar({ nowMs: AHORA, ultimaMs: null, vistaMax: 10, cursorAvanzo: true, ocultaMs: 60000 }),
  'nada de eso: no')
eq([1, 2, 3, 4, 5, 9].map(esperaReapertura).map((ms) => ms / 60000), [5, 10, 20, 40, 60, 60],
  'oyente muerto: 5, 10, 20, 40 y luego cada 60 min')
```

Hay que añadir al `import` del principio: `guardF5, marcaLegacyF5, corteDetector, decidirCursorSesion,
cursorVacia, debeRenovar, esperaReapertura`.

- [ ] **Paso 2: ejecutarla y ver que falla**

Ejecutar: `node src/features/sync/f5.test.mjs`
Esperado: FALLA con `does not provide an export named 'guardF5'`.

- [ ] **Paso 3: implementar.** En `f5.js` hay que BORRAR la línea provisional
`export { CURSOR_MARGIN_MS }` y su comentario, y añadir al final:

```js
const MIN = 60 * 1000
const DIA = 24 * 60 * MIN

// D3 — Olvido. 7 dias para quien ya publico `caps.up` (build de main o
// posterior: si vuelve sin actualizar, sus movimientos sellados sin `_f5` lo
// delatan). 30 para quien no lo publico nunca: un build anterior a F1 no sella
// nada, y ningun detector lo veria.
export const OLVIDO_CON_UP_MS = 7 * DIA
export const OLVIDO_SIN_UP_MS = 30 * DIA
export const REUSO_SESION_MS = 25 * MIN
export const FRENO_RENOVACION_MS = 25 * MIN
export const OCULTA_RENUEVA_MS = 25 * MIN
export const VISTA_RENUEVA_DOCS = 300
export const BLOQUEO_MS = DIA

// Sin `lastSeenAt` NO se le da por olvidado: no se sabe cuando se vio, y darlo
// por muerto seria filtrar por omision.
export function olvidado(d, ahoraMs) {
  const visto = upToMillis(d?.lastSeenAt)
  if (visto == null) return false
  const umbral = d?.caps && d.caps.up ? OLVIDO_CON_UP_MS : OLVIDO_SIN_UP_MS
  return ahoraMs - visto > umbral
}

// Un build SIN F5 toco la ficha despues de la ultima vez que sello todo: el
// build F5 escribe las dos marcas en la MISMA escritura, asi que en marcha
// normal salen iguales. Es el caso de volver atras un despliegue a main: ese
// aparato conserva `caps.upAll` (merge profundo) pero sube sin sello.
export function corrioSinSelloCompleto(d) {
  const visto = upToMillis(d?.lastSeenAt)
  const sellado = upToMillis(d?.sealAllSeenAt)
  if (visto == null || sellado == null) return false
  return visto > sellado
}

// §5.2 — Se mira la ficha ANTERIOR (`prev`), leida antes de escribir: la
// escritura F5 iguala las dos marcas y borraria la evidencia.
export function marcaLegacyF5(prev) {
  if (!prev) return false
  if (upToMillis(prev.sealAllSeenAt) == null) return upToMillis(prev.lastSeenAt) != null
  return corrioSinSelloCompleto(prev)
}

// "Ahora" es la hora del SERVIDOR: el mayor `lastSeenAt` de la lista. Un
// telefono con la fecha mal no puede decidir ni el olvido ni el bloqueo.
export function ahoraServidor(devices, fallbackMs) {
  let max = null
  for (const d of Array.isArray(devices) ? devices : []) {
    const ms = upToMillis(d?.lastSeenAt)
    if (ms != null && (max == null || ms > max)) max = ms
  }
  return max ?? fallbackMs
}

const no = (motivo, extra = {}) => ({ ok: false, ilegible: false, bloqueantes: [], motivo, ahoraMs: null, ...extra })

// §5.3 — ¿Puede filtrar este aparato? Ante cualquier duda, NO. `ilegible`
// distingue "no pude leer la lista" (se conserva el veredicto) de "la lista dice
// que no" (se vuelve al vivo).
export function guardF5({ enLista, sinEco, bloqueoHastaMs, devices, reconciledMs, nowMs }) {
  if (!enLista) return no('La medida aún no está habilitada para este negocio.')
  if (!sinEco) return no('La subida sin eco está apagada en este negocio.')
  if (!Array.isArray(devices) || devices.length === 0) {
    return no('No se pudo leer la lista de dispositivos.', { ilegible: true })
  }
  const ahoraMs = ahoraServidor(devices, nowMs)
  if (Number.isFinite(bloqueoHastaMs) && bloqueoHastaMs > ahoraMs) {
    return no('Se detectó un aparato con una versión antigua; se reintenta más tarde.', { ahoraMs })
  }
  const bloqueantes = []
  for (const d of devices) {
    if (!d || d.active === false || olvidado(d, ahoraMs)) continue
    const name = d.name || d.id
    if (!(d.caps && d.caps.upAll)) {
      bloqueantes.push({ id: d.id, name, motivo: 'no ha actualizado la app' })
    } else if (corrioSinSelloCompleto(d)) {
      bloqueantes.push({ id: d.id, name, motivo: 'está usando una versión antigua' })
    } else {
      const legacy = upToMillis(d.upAllLegacyAt)
      if (legacy != null && reconciledMs != null && legacy > reconciledMs) {
        bloqueantes.push({ id: d.id, name, motivo: 'abrió una versión antigua' })
      }
    }
  }
  if (bloqueantes.length) {
    const nombres = bloqueantes.map((b) => `${b.name} (${b.motivo})`).join(', ')
    return no(`Esperando a: ${nombres}.`, { bloqueantes, ahoraMs })
  }
  return { ok: true, ilegible: false, bloqueantes: [], motivo: '', ahoraMs }
}

// §5.3 — Corte del detector: el MAYOR `sealAllSeenAt` de los aparatos no
// olvidados. Todo lo que un aparato subio legitimamente con main es anterior a
// su propio `sealAllSeenAt`, asi que no hay falsos positivos por la transicion.
export function corteDetector(devices, ahoraMs) {
  let max = null
  for (const d of Array.isArray(devices) ? devices : []) {
    if (!d || d.active === false || olvidado(d, ahoraMs)) continue
    const ms = upToMillis(d.sealAllSeenAt)
    if (ms != null && (max == null || ms > max)) max = ms
  }
  return max
}

// §5.5 — Reutilizar la consulta de la sesion anterior conserva el token de
// reanudacion (misma forma canonica). Pasados 25 min sin snapshot del servidor
// el token ya no ahorra nada y se usa el cursor persistido, mas adelantado.
export function decidirCursorSesion({ persistedMs, prev, nowMs }) {
  if (prev && Number.isFinite(prev.cursorMs) && Number.isFinite(prev.lastServerMs) &&
      nowMs - prev.lastServerMs < REUSO_SESION_MS) return prev.cursorMs
  return Number.isFinite(persistedMs) ? persistedMs : null
}

// §5.4 — Coleccion vacia o sin nada sellado: el mayor `_up` de lo ya leido en la
// misma reconciliacion, menos el margen.
export const cursorVacia = (maxPrevioMs) =>
  (Number.isFinite(maxPrevioMs) ? maxPrevioMs - CURSOR_MARGIN_MS : null)

// §5.5 — Renovar = consultas nuevas con el cursor persistido. Con freno, y por
// tamaño SOLO si el cursor avanzo: si no, la consulta nueva seria la misma.
export function debeRenovar({ nowMs, ultimaMs, vistaMax, cursorAvanzo, ocultaMs }) {
  if (Number.isFinite(ultimaMs) && nowMs - ultimaMs < FRENO_RENOVACION_MS) return false
  if ((Number(ocultaMs) || 0) > OCULTA_RENUEVA_MS) return true
  return (Number(vistaMax) || 0) > VISTA_RENUEVA_DOCS && !!cursorAvanzo
}

// §5.5 — Oyente muerto: se reabre SOLO ese, con espera creciente.
const ESPERAS_MIN = [5, 10, 20, 40]
export function esperaReapertura(intentos) {
  const i = Math.max(1, Number(intentos) || 1) - 1
  return (ESPERAS_MIN[i] ?? 60) * MIN
}
```

- [ ] **Paso 4: ejecutarla y ver que pasa**

Ejecutar: `node src/features/sync/f5.test.mjs`
Esperado: `f5 (oyentes filtrados, modulo puro): 69 aserciones OK`: 30 de la Tarea 1 y 39 de esta.

- [ ] **Paso 5: control negativo (tres mutaciones, una a una, revirtiendo cada una)**

1. En `guardF5`, quitar la rama `else if (corrioSinSelloCompleto(d))` → debe fallar «un build SIN F5
   corriendo AHORA».
2. En `olvidado`, usar siempre `OLVIDO_CON_UP_MS` → debe fallar «SIN caps.up y 8 dias».
3. En `debeRenovar`, quitar `&& !!cursorAvanzo` → debe fallar «el cursor NO avanzo».

- [ ] **Paso 6: build y commit**

```bash
npm run build
git add src/features/sync/f5.js src/features/sync/f5.test.mjs
git commit -m "Oyentes filtrados (2/12): la guarda con hora del servidor y las decisiones de sesion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 3: la subida sella todo (sin cambiar todavía nada de la bajada)

**Ficheros:**
- Modificar: `src/features/sync/deferred.js:54-67` (`stripUp`)
- Modificar: `src/features/sync/pushEngine.js:10` y `:72-77`
- Modificar: `src/features/sync/compareResendFirebase.js:20-31`
- Modificar: `src/features/sync/deferred.test.mjs`, añadiendo casos de `stripUp`
- Modificar: `src/features/sync/pushEcho.test.mjs`: en el caso A, las dos últimas aserciones
- Modificar: `src/features/sync/pushTrace.test.mjs:126`
- Crear: `src/features/sync/f5Wiring.test.mjs`

**Interfaces:**
- Consume: `sealF5` (Tarea 1).
- Produce: todo lo que sube lleva `_up` + `_f5`, salvo `config`. `stripUp` quita los dos.

- [ ] **Paso 1: casos que fallan.** En `deferred.test.mjs`, justo después de los casos que ya
existen de `stripUp`. Se buscan con `grep -n "stripUp(" src/features/sync/deferred.test.mjs`; se
añaden tras el último bloque de `stripUp`:

```js
// Oyentes filtrados (spec 2026-10-03 §5.1): `_f5` tampoco entra en Dexie.
const conMarca = stripUp([{ id: 'a', _up: { toMillis: () => 5 }, _f5: 1 }])
eq(conMarca.docs[0], { id: 'a' }, '_f5 NO entra en Dexie')
eq(conMarca.maxUpMs, 5, 'y el maximo de _up sigue saliendo')
eq(stripUp([{ id: 'b', _f5: 1 }]).docs[0], { id: 'b' }, 'aunque llegue sin _up')
```

Crear `src/features/sync/f5Wiring.test.mjs`:

```js
// Candados sobre el FUENTE del cableado de los oyentes filtrados (spec
// 2026-10-03-oyentes-filtrados v2.1). No hay linter ni pruebas de pantalla, y el
// cableado con Firestore no corre en node: se comprueba donde se decide, en el
// texto, igual que cursorType.test.mjs.
//   node src/features/sync/f5Wiring.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aqui = dirname(fileURLToPath(import.meta.url))
const leer = (rel) => readFileSync(join(aqui, rel), 'utf8')
let n = 0
const ok = (cond, msg) => { assert.ok(cond, msg); n++ }

// --- Tarea 3: la subida sella todo con sealF5 ---------------------------------------
const push = leer('pushEngine.js')
ok(/import \{ sealF5 \} from '\.\/f5'/.test(push), 'pushEngine importa sealF5')
ok(/const toCloudSellado = \(name, rec, sentinel\) => sealF5\(name, toCloud\(rec\), sentinel\)/.test(push),
  'toCloudSellado sella con sealF5 DESPUES de toCloud (el centinela no sobrevive a JSON.stringify)')
ok(!/\bseal\(name/.test(push), 'no queda ningun sello viejo de F1 en la subida')
const cmp = leer('compareResendFirebase.js')
ok(/tx\.set\(ref, sealF5\(name, r\.write, serverTimestamp\)\)/.test(cmp),
  'el reenvio que compara sella: su tx.set reemplaza el documento entero y borraria el _up')

console.log(`f5Wiring (candados del cableado): ${n} aserciones OK`)
```

- [ ] **Paso 2: ejecutar y ver que fallan**

```bash
node src/features/sync/deferred.test.mjs   # FALLA: '_f5 NO entra en Dexie'
node src/features/sync/f5Wiring.test.mjs   # FALLA: 'pushEngine importa sealF5'
```

- [ ] **Paso 3: implementar**

En `deferred.js`, la función `stripUp` pasa a ser:

```js
export function stripUp(docs) {
  let maxUpMs = null
  const out = docs.map((d) => {
    const ms = upToMillis(d?._up)
    if (ms != null && (maxUpMs == null || ms > maxUpMs)) maxUpMs = ms
    // `_f5` (oyentes filtrados, spec 2026-10-03 §5.1) es la marca de build que
    // acompaña al sello: tampoco entra en Dexie.
    if (d && ('_up' in d || '_f5' in d)) {
      const copia = { ...d }
      delete copia._up
      delete copia._f5
      return copia
    }
    return d
  })
  return { docs: out, maxUpMs }
}
```

En `pushEngine.js`, la línea 10 pasa de `import { seal } from './deferred'` a
`import { sealF5 } from './f5'`. Las líneas 72-77 (el comentario y `toCloudSellado`) pasan a ser:

```js
// Sella con la hora en que el documento LLEGA a la nube. Va DESPUES de toCloud a
// proposito: el centinela de serverTimestamp() no sobrevive a JSON.stringify
// (quedaria el mapa {"_methodName":"serverTimestamp"}, que no entra en ningun
// filtro de rango). Desde los oyentes filtrados (spec 2026-10-03 §5.1) se sella
// TODO menos `config`, con la marca de build `_f5`; antes solo
// stockMovements/sales.
const toCloudSellado = (name, rec, sentinel) => sealF5(name, toCloud(rec), sentinel)
```

En `compareResendFirebase.js`, hay que añadir `import { sealF5 } from './f5'` y dejar `runTx` así:

```js
async function runTx(name, id, fn) {
  const { db: fs } = await getFirebase()
  const businessId = await syncConfig.businessId()
  const { doc, runTransaction, serverTimestamp } = await import('firebase/firestore')
  const ref = doc(fs, 'businesses', businessId, name, id)
  return runTransaction(fs, async (tx) => {
    const snap = await tx.get(ref)
    const r = await fn(snap.exists() ? snap.data() : null)
    // Sellado como la subida (spec 2026-10-03 §5.1): `tx.set` REEMPLAZA el
    // documento entero, y sin sello se llevaria el `_up` y la fila desapareceria
    // de los oyentes filtrados de los demas aparatos.
    if (r.write) tx.set(ref, sealF5(name, r.write, serverTimestamp))
    return r.decision
  })
}
```

En `pushEcho.test.mjs`, las dos últimas aserciones del caso A pasan a ser:

```js
ok(escritura('stockMovements', 'mvLoc')?.data?._up?.[SELLO] === true &&
  escritura('stockMovements', 'mvLoc')?.data?._f5 === 1, 'A: el movimiento sube sellado y con la marca F5')
ok(escritura('products', 'loc')?.data?._up?.[SELLO] === true && escritura('products', 'loc')?.data?._f5 === 1,
  'A: y los productos TAMBIEN (oyentes filtrados §5.1)')
```

En `pushTrace.test.mjs:126`, justo después de `delete data._up`, se añade `delete data._f5`, con el
comentario `// la marca de build de F5 es sello, como _up: fuera de la huella`.

- [ ] **Paso 4: ejecutar y ver que pasan**

```bash
node src/features/sync/deferred.test.mjs
node src/features/sync/f5Wiring.test.mjs
corre_base src/features/sync/pullDeferred.test.mjs
corre_base src/features/sync/echoMerge.test.mjs
```

Y las dos de Firebase, con el comando de la cabecera de `pushTrace.test.mjs`, que lleva los tres
`--alias`:

```bash
for t in pushEcho pushTrace; do
  npx esbuild src/features/sync/$t.test.mjs --bundle --platform=node --format=esm \
    --alias:firebase/app=./src/features/sync/testing/fakeFirebaseApp.mjs \
    --alias:firebase/auth=./src/features/sync/testing/fakeFirebaseAuth.mjs \
    --alias:firebase/firestore=./src/features/sync/testing/fakeFirestore.mjs \
    --outfile="$S/$t.mjs" && node "$S/$t.mjs" > "$S/$t.rama.txt"; echo "$t exit $?"
done
```

Esperado: todo exit 0, y `pushTrace` con `0 invariantes rotas`.

- [ ] **Paso 5: `pushTrace` sigue siendo idéntico a `main` byte a byte**

```bash
git worktree add "$S/main" origin/main
cmd //c mklink /J "$(cygpath -w "$S/main/node_modules")" "$(cygpath -w "$PWD/node_modules")"
cp src/features/sync/pushTrace.test.mjs "$S/main/src/features/sync/pushTrace.test.mjs"
( cd "$S/main" && npx esbuild src/features/sync/pushTrace.test.mjs --bundle --platform=node --format=esm \
    --alias:firebase/app=./src/features/sync/testing/fakeFirebaseApp.mjs \
    --alias:firebase/auth=./src/features/sync/testing/fakeFirebaseAuth.mjs \
    --alias:firebase/firestore=./src/features/sync/testing/fakeFirestore.mjs \
    --outfile="$S/pushTrace.main.mjs" && node "$S/pushTrace.main.mjs" > "$S/pushTrace.main.txt" )
cmp "$S/pushTrace.rama.txt" "$S/pushTrace.main.txt" && echo IDENTICOS
```

Esperado: `IDENTICOS`. **Control negativo:** quitar el `delete data._f5` → `cmp` debe dar diferencia.
Hay que revertirlo. El worktree se deja para la Tarea 4 y se quita en la 12.

- [ ] **Paso 6: control negativo de la subida.** En `pushEngine.js`, sustituir temporalmente
`sealF5(name, toCloud(rec), sentinel)` por `toCloud(rec)`. `pushEcho` debe fallar en «y los
productos TAMBIEN», y `f5Wiring` también. Después se revierte.

- [ ] **Paso 7: build y commit**

```bash
npm run build
git add src/features/sync/deferred.js src/features/sync/pushEngine.js src/features/sync/compareResendFirebase.js \
  src/features/sync/deferred.test.mjs src/features/sync/pushEcho.test.mjs src/features/sync/pushTrace.test.mjs \
  src/features/sync/f5Wiring.test.mjs
git commit -m "Oyentes filtrados (3/12): la subida sella todo salvo config con _up y _f5, tambien el reenvio que compara

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 4: subida sin eco por defecto y bloqueo del negocio

**Ficheros:**
- Modificar: `src/repositories/configRepo.js:146-157`
- Modificar: `src/features/backup/backupService.js:20-36` (`DEVICE_ONLY_KEYS`)
- Modificar: `src/features/backup/backupFlags.test.mjs`
- Modificar: `src/features/sync/pushEcho.test.mjs` (caso B)
- Modificar: `src/features/sync/pushTrace.test.mjs`, en la `bulkPut` de `config` de cada escenario
- Modificar: `src/features/sync/f5Wiring.test.mjs`

**Interfaces:**
- Produce:
  - `configRepo.getSubidaSinEco()`: con la fila ausente devuelve `true`;
  - `configRepo.getOyentesBloqueoHasta(): Promise<number|null>`;
  - `configRepo.setOyentesBloqueoHasta(ms: number)`.

- [ ] **Paso 1: casos que fallan.** En `backupFlags.test.mjs`, el caso 1 pasa a ser:

```js
// 1. D1 de los oyentes filtrados (spec 2026-10-03 §5.6): sin fila, ENCENDIDA.
await limpiar()
ok((await configRepo.getSubidaSinEco()) === true, 'sin fila, la bandera esta encendida (D1)')
```

Al final, antes del `console.log`, se añade:

```js
// 6. El bloqueo de los oyentes filtrados: se lee como milisegundos y NO viaja.
await limpiar()
ok((await configRepo.getOyentesBloqueoHasta()) === null, 'sin fila, no hay bloqueo')
await configRepo.setOyentesBloqueoHasta(Date.UTC(2026, 9, 4))
ok((await configRepo.getOyentesBloqueoHasta()) === Date.UTC(2026, 9, 4), 'se guarda y se lee en ms')
const filaB = await db.config.get('oyentesBloqueoHasta')
ok(typeof filaB?.value === 'string' && typeof filaB.updatedAt === 'string', 'texto ISO y sella su marca')
await db.config.put({ key: 'oyentesBloqueoHasta', value: 'basura', updatedAt: '2026-10-03T00:00:00.000Z' })
ok((await configRepo.getOyentesBloqueoHasta()) === null, 'un valor roto no bloquea (no se inventa un plazo)')
const bk2 = await buildBackup({ name: 'dueno' })
ok(!(bk2.tables.config || []).some((r) => r.key === 'oyentesBloqueoHasta'), 'el bloqueo NO viaja en el respaldo')
```

En `f5Wiring.test.mjs`, antes del `console.log`:

```js
// --- Tarea 4: el camino clasico de pushTrace se fija a mano ---------------------------
const traza = leer('pushTrace.test.mjs')
ok(/\{ key: 'subidaSinEco', value: false, updatedAt: iso\(-1000\) \}/.test(traza),
  'pushTrace escribe subidaSinEco=false con fecha FIJA (debajo de push:config: no sube) para comparar con main')
```

- [ ] **Paso 2: ejecutar y ver que fallan**

`corre_base src/features/backup/backupFlags.test.mjs` → FALLA en «encendida (D1)».
`node src/features/sync/f5Wiring.test.mjs` → FALLA en «pushTrace escribe subidaSinEco=false».

- [ ] **Paso 3: implementar.** En `configRepo.js`, el bloque de `getSubidaSinEco`/`setSubidaSinEco`
pasa a ser:

```js
  // Subida sin eco (spec 2026-09-27-subida-sin-eco). Del NEGOCIO y SINCRONIZADA,
  // como `bajadaFiltrada`. Desde los oyentes filtrados (spec 2026-10-03 §5.6, D1)
  // la clave AUSENTE se lee como ENCENDIDA: con todo sellado, cada eco cambia el
  // documento y cuesta una lectura en cada aparato. Si el negocio la apago a mano
  // (fila con false), se respeta.
  async getSubidaSinEco() {
    return !!(await this.get('subidaSinEco', true))
  },

  async setSubidaSinEco(v) {
    await this.set('subidaSinEco', !!v)
  },

  // Bloqueo de los oyentes filtrados (spec 2026-10-03 §5.3): hasta cuando (ISO,
  // hora del SERVIDOR + 24 h) nadie del negocio filtra, porque un aparato detecto
  // un build viejo subiendo. Del negocio y sincronizado. Un valor ilegible no
  // bloquea: no se inventa un plazo.
  async getOyentesBloqueoHasta() {
    const v = await this.get('oyentesBloqueoHasta', null)
    const ms = typeof v === 'string' ? Date.parse(v) : NaN
    return Number.isFinite(ms) ? ms : null
  },

  async setOyentesBloqueoHasta(ms) {
    await this.set('oyentesBloqueoHasta', new Date(ms).toISOString())
  },
```

En `backupService.js`, se añade a `DEVICE_ONLY_KEYS`, detrás de `'subidaSinEco'`:

```js
  'subidaSinEco',
  // Oyentes filtrados (spec 2026-10-03 §5.3): el bloqueo vive en la nube; un
  // respaldo viejo no debe ni ponerlo ni quitarlo.
  'oyentesBloqueoHasta'
```

En `pushEcho.test.mjs`, el caso B (`preparar(undefined)`) pasa a esperar lo mismo que A, porque sin
fila la bandera está encendida:

```js
// --- B) SIN fila de bandera: desde D1 (spec 2026-10-03 §5.6) es lo mismo que encendida
await preparar(undefined)
await pushChanges()
await drenar()
ok(subidos('products').join(',') === 'loc,tocada', 'B: sin fila NO se reenvia el eco (D1)')
ok(subidos('stockMovements').join(',') === 'mvLoc', 'B: movimientos: solo el local')
ok(subidos('sales').length === 0, 'B: ventas: ninguna')
ok((await cursor('products')) === T3 && (await cursor('sales')) === T1, 'B: los cursores quedan en el MISMO valor que en A')
ok(skippedCount() === 4, 'B: el contador dice 4, como en A')
```

En `pushTrace.test.mjs`, la `bulkPut` de `config` de cada escenario pasa a ser:

```js
  await db.config.bulkPut([
    { key: 'syncEnabled', value: true, updatedAt: iso(-1000) },
    { key: 'syncBusinessId', value: NEG, updatedAt: iso(-1000) },
    // Oyentes filtrados (spec 2026-10-03 §10): la suite mide el camino CLASICO
    // contra main. Con fecha FIJA y por debajo de push:config, no sube ni mete
    // la hora de la corrida en la huella; en main es su valor por defecto.
    { key: 'subidaSinEco', value: false, updatedAt: iso(-1000) }
  ])
```

- [ ] **Paso 4: ejecutar y ver que pasan.** Corren `backupFlags`, `pushEcho` y `pushTrace` (con el
paso 5 de la Tarea 3 otra vez: copiar el `pushTrace.test.mjs` nuevo al worktree de `main` y
comparar con `cmp`). Esperado: verde, `0 invariantes rotas` e `IDENTICOS`.

- [ ] **Paso 5: control negativo.** Devolver temporalmente `this.get('subidaSinEco', false)` →
`backupFlags` y el caso B de `pushEcho` deben fallar. Después se revierte.

- [ ] **Paso 6: build y commit**

```bash
npm run build
git add src/repositories/configRepo.js src/features/backup/backupService.js src/features/backup/backupFlags.test.mjs \
  src/features/sync/pushEcho.test.mjs src/features/sync/pushTrace.test.mjs src/features/sync/f5Wiring.test.mjs
git commit -m "Oyentes filtrados (4/12): subida sin eco encendida si la clave falta, y bloqueo del negocio fuera del respaldo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 5: el libro de ecos compartido entre pestañas

**Ficheros:**
- Modificar: `src/features/sync/echoLedger.js`
- Modificar: `src/features/sync/echoLedger.test.mjs`, añadiendo casos antes del `console.log` final

**Interfaces:**
- Produce: `compartirEntrePestanas(Ctor): boolean`. Si no hay `BroadcastChannel`, no hace nada. Además
  `clear()` cierra el canal.

- [ ] **Paso 1: casos que fallan** (y se añade `compartirEntrePestanas` al `import`):

```js
// --- Oyentes filtrados (spec 2026-10-03 §5.6): el libro se comparte entre pestañas
class CanalFalso {
  static todos = []
  constructor(nombre) { this.nombre = nombre; this.enviados = []; this.onmessage = null; CanalFalso.todos.push(this) }
  postMessage(m) { this.enviados.push(m) }
  close() { this.cerrado = true }
}
clear()
eq(compartirEntrePestanas(CanalFalso), true, 'abre el canal')
eq(compartirEntrePestanas(CanalFalso), false, 'y solo uno por pestaña')
const canal = CanalFalso.todos[0]
eq(canal.nombre, 'mypicuadre-eco', 'con un nombre fijo')
record('products', 'id', [{ id: 'p9', updatedAt: '2026-10-03T10:00:00.000Z' }])
eq(canal.enviados, [{ col: 'products', pares: [['p9', '2026-10-03T10:00:00.000Z']] }],
  'lo que anota esta pestaña lo cuenta a las demas')
canal.onmessage({ data: { col: 'sales', pares: [['v7', '2026-10-03T11:00:00.000Z']] } })
const r = split('sales', [{ r: {}, id: 'v7', ts: '2026-10-03T11:00:00.000Z' }], true)
eq(r.saltar.length, 1, 'lo que anoto OTRA pestaña tambien se salta aqui')
eq(canal.enviados.length, 1, 'y lo recibido NO se reenvia (sin eco entre pestañas)')
canal.onmessage({ data: { col: 3, pares: 'x' } })
canal.onmessage({})
ok(true, 'un mensaje roto no rompe nada')
clear()
ok(canal.cerrado === true, 'clear cierra el canal')
eq(compartirEntrePestanas(undefined), false, 'sin BroadcastChannel (navegador viejo): no hace nada')
clear()
```

**Antes de pegar**, hay que comprobar qué ayudantes usa ya `echoLedger.test.mjs` (`eq`/`ok`/`n`). Si
se llaman de otra forma, se adaptan los nombres a los suyos, sin cambiar las aserciones.

- [ ] **Paso 2: ejecutar** `node src/features/sync/echoLedger.test.mjs` → FALLA: no existe la
exportación.

- [ ] **Paso 3: implementar.** En `echoLedger.js`, después de `let saltadas = 0`:

```js
// Oyentes filtrados (spec 2026-10-03 §5.6): el libro se COMPARTE entre pestañas
// del mismo navegador. Cada pestaña tiene su propio oyente y su propio doPush; la
// que no gano el LWW no anota la fila y hacia eco, que con todo sellado cuesta
// una lectura en cada aparato. Si el mensaje llega tarde se pierde la carrera: es
// el lado de siempre (sube como hoy).
let canal = null

export function compartirEntrePestanas(Ctor) {
  if (canal || typeof Ctor !== 'function') return false
  try {
    canal = new Ctor('mypicuadre-eco')
    canal.onmessage = (e) => {
      const d = e && e.data
      if (!d || typeof d.col !== 'string' || !Array.isArray(d.pares)) return
      const m = deColeccion(d.col)
      for (const p of d.pares) if (Array.isArray(p) && p[1]) m.set(String(p[0]), p[1])
    }
    return true
  } catch {
    canal = null
    return false
  }
}
```

`deColeccion` se declara con `const` más abajo. El `onmessage` solo se ejecuta después, así que no
hay problema de orden; si se prefiere, se mueve el bloque debajo de `deColeccion`.

`record` pasa a ser:

```js
export function record(colName, pk, filas) {
  if (!Array.isArray(filas) || !filas.length) return
  const m = deColeccion(colName)
  const pares = []
  for (const f of filas) {
    if (!f || f[pk] == null) continue
    const ts = syncTs(f)
    if (ts) {
      m.set(String(f[pk]), ts)
      pares.push([String(f[pk]), ts])
    }
  }
  if (canal && pares.length) {
    try { canal.postMessage({ col: colName, pares }) } catch { /* sin canal: como hoy */ }
  }
}
```

`clear` pasa a ser:

```js
export function clear() {
  anotado.clear()
  saltadas = 0
  if (canal) {
    try { canal.close() } catch { /* noop */ }
    canal = null
  }
}
```

- [ ] **Paso 4: ejecutar** `echoLedger`, `pushEcho` y `echoMerge` → verde.

- [ ] **Paso 5: control negativo.** En `record`, quitar el `postMessage` → debe fallar «lo cuenta a
las demas». Después se revierte.

- [ ] **Paso 6: build y commit**

```bash
npm run build
git add src/features/sync/echoLedger.js src/features/sync/echoLedger.test.mjs
git commit -m "Oyentes filtrados (5/12): el libro de ecos se comparte entre pestanas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 6: `/devices` — capacidad, marca de build viejo, estado y vigía

**Ficheros:**
- Modificar: `src/features/sync/deviceRegistry.js` (`CAPS`, el `setDoc` de `registerThisDevice` y
  dos funciones nuevas al final)
- Modificar: `src/features/sync/f5Wiring.test.mjs`

**Interfaces:**
- Consume: `marcaLegacyF5` (Tarea 2).
- Produce:
  - `publicarEstadoF5(campos: object): Promise<void>`. Hace un `setDoc` con `merge` y nunca lanza.
  - `vigilarDispositivos(cb: (devices: object[]) => void): Promise<() => void>`. Pasa `[]` cuando la
    respuesta viene de caché.

- [ ] **Paso 1: candados que fallan.** En `f5Wiring.test.mjs`:

```js
// --- Tarea 6: /devices --------------------------------------------------------------
const reg = leer('deviceRegistry.js')
ok(/const CAPS = \{ up: 1, upAll: 1 \}/.test(reg), 'publica up (para la guarda de F2 en main) Y upAll')
ok(/sealSeenAt: serverTimestamp\(\)/.test(reg) && /sealAllSeenAt: serverTimestamp\(\)/.test(reg),
  'escribe las DOS marcas de sellado en la misma escritura')
ok(/marcaLegacyF5\(prev\) \? \{ upAllLegacyAt: serverTimestamp\(\) \}/.test(reg),
  'la marca de build viejo se decide con la ficha ANTERIOR (prev), leida antes de escribir')
ok(/export async function publicarEstadoF5/.test(reg) && /\{ merge: true \}/.test(reg),
  'publica el estado con merge (no pisa la ficha)')
ok(/export async function vigilarDispositivos/.test(reg) && /metadata\.fromCache \? \[\]/.test(reg),
  'el vigia no decide con la cache: pasa una lista vacia (ilegible)')
```

- [ ] **Paso 2: ejecutar** `node src/features/sync/f5Wiring.test.mjs` → FALLA.

- [ ] **Paso 3: implementar.** En `deviceRegistry.js`:

Se añade `import { marcaLegacyF5 } from './f5'` junto al import de `./deferred`.

`CAPS` pasa a ser:

```js
// Capacidades de ESTE build. `up` dice "yo sello stockMovements/sales" (F1, lo
// mira la guarda de F2 de main: hay que seguir publicandolo). `upAll` dice "yo
// sello TODO salvo config" (oyentes filtrados, spec 2026-10-03 §5.2).
const CAPS = { up: 1, upAll: 1 }
```

En el `setDoc` de `registerThisDevice`, tras `sealSeenAt: serverTimestamp(),`, se añade:

```js
      // Oyentes filtrados (spec 2026-10-03 §5.2): las dos marcas van en la MISMA
      // escritura, asi que en marcha normal salen iguales. Si la ficha ANTERIOR
      // muestra que corrio un build sin sello completo, se anota: esta escritura
      // iguala las marcas y borraria la evidencia.
      sealAllSeenAt: serverTimestamp(),
      ...(marcaLegacyF5(prev) ? { upAllLegacyAt: serverTimestamp() } : {}),
```

Al final del fichero:

```js
// Oyentes filtrados (spec 2026-10-03 §5.8): el estado de ESTE aparato, para que
// el dueño lo lea en la consola sin pedir capturas a nadie. Una escritura por
// arranque, con merge. Nunca lanza: es informativo.
export async function publicarEstadoF5(campos) {
  try {
    const { db: fs, auth } = await getFirebase()
    if (!auth.currentUser) return
    const { doc, setDoc, serverTimestamp } = await import('firebase/firestore')
    const deviceId = await getDeviceId()
    await setDoc(
      doc(fs, 'businesses', auth.currentUser.uid, 'devices', deviceId),
      { ...campos, f5EstadoAt: serverTimestamp() },
      { merge: true }
    )
  } catch (e) {
    logSyncEvent('f5-estado', null, e)
  }
}

// Oyentes filtrados (spec 2026-10-03 §5.3): vigia EN VIVO de /devices mientras se
// filtra. Una respuesta de cache no sirve para decidir: se pasa [] (ilegible) y la
// guarda conserva el veredicto. Devuelve la funcion para soltarlo.
export async function vigilarDispositivos(cb) {
  const { db: fs, auth } = await getFirebase()
  if (!auth.currentUser) return () => {}
  const { collection, onSnapshot } = await import('firebase/firestore')
  return onSnapshot(
    collection(fs, 'businesses', auth.currentUser.uid, 'devices'),
    (snap) => cb(snap.metadata.fromCache ? [] : snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (e) => logSyncEvent('f5-vigia-aparatos', null, e)
  )
}
```

- [ ] **Paso 4: ejecutar** `f5Wiring` y `f5` → verde.

- [ ] **Paso 5: control negativo.** Cambiar `marcaLegacyF5(prev)` por `marcaLegacyF5(null)` → debe
fallar el candado. Después se revierte.

- [ ] **Paso 6: build y commit**

```bash
npm run build
git add src/features/sync/deviceRegistry.js src/features/sync/f5Wiring.test.mjs
git commit -m "Oyentes filtrados (6/12): /devices publica upAll, la marca de build viejo, el estado y un vigia en vivo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 7: `f5Engine.js` — sesión, cursores, reconciliación y cura

**Ficheros:**
- Crear: `src/features/sync/f5Engine.js`
- Crear: `src/features/sync/f5Engine.test.mjs`
- Modificar: `src/features/sync/f5Wiring.test.mjs`

**Interfaces:**
- Consume: `f5.js` (Tareas 1 y 2) y, de `deferred.js`, `pullCursorKey`, `parseCursor`,
  `formatCursor`, `nextCursor` y `CURSOR_MARGIN_MS`.
- Produce, para las Tareas 8 a 11. Las firmas son exactas:
  - `f5Activo(): boolean`
  - `consultaF5(nombre): Query|null`
  - `setDetectorHandler(fn|null)`
  - `marcarMuerto(nombre)`, `limpiarMuerto(nombre)`, `oyenteMuerto(nombre): boolean`
  - `leerEstadoF5(businessId): Promise<{ veredicto: boolean, reconciliadoMs: number|null }>`
  - `prepararSesionF5({ businessId, fs, api: { collection, query, where, Timestamp }, nowMs?, renovar? }): Promise<boolean>`
  - `revisarDato(nombre, docs)`
  - `avanzarCursoresF5({ businessId, resultados: [{ nombre, fromServer, maxUpMs, vista }], nowMs? }): Promise<{ avanzaron: string[] }>`
  - `reconciliarF5({ businessId, fs, api: { collection, getDocs }, merge, recompute, diferidasF2: Set, corteMs }): Promise<{ ok, motivo, reconciliadoMs? }>`
  - `volverAlVivoF5(businessId): Promise<void>`
  - `dejarEnBlancoCura(): Promise<void>`
  - `leerMetricasF5(businessId)` / `guardarMetricasF5(businessId, m)`, con `m = { vistaMax, reaperturas }`
  - `ultimoUpServidor(): number|null`

- [ ] **Paso 1: la suite que falla** (`src/features/sync/f5Engine.test.mjs`):

```js
// Prueba CON BASE (fake-indexeddb) del motor de los oyentes filtrados (spec
// 2026-10-03-oyentes-filtrados v2.1, §5.4, §5.5 y §5.7). Firestore se inyecta con
// falsos minimos: este modulo no lo importa nunca (import() dinamico en el cableado).
//   npx esbuild src/features/sync/f5Engine.test.mjs --bundle --platform=node \
//     --format=esm --outfile=<scratch>/f5Engine.bundle.mjs && node <scratch>/f5Engine.bundle.mjs
import 'fake-indexeddb/auto'
import { db } from '../../db/db'
import { mergeIncoming, recomputeStock } from './pullEngine'
import { pullCursorKey, formatCursor, parseCursor } from './deferred'
import { f5Key } from './f5'
import {
  f5Activo, consultaF5, setDetectorHandler, revisarDato, leerEstadoF5, prepararSesionF5,
  avanzarCursoresF5, reconciliarF5, volverAlVivoF5, dejarEnBlancoCura,
  marcarMuerto, limpiarMuerto, oyenteMuerto
} from './f5Engine'

let pass = 0
let fail = 0
const ok = (c, l) => { if (c) pass++; else { fail++; console.error('FAIL', l) } }
const NEG = 'neg-f5'
const AHORA = Date.UTC(2026, 9, 3, 12, 0, 0)
const limpiar = () => Promise.all(db.tables.map((t) => t.clear()))
const ponerCursor = (col, ms) => db.syncState.put({ key: pullCursorKey(NEG, col), value: formatCursor(ms) })
const cursor = async (col) => parseCursor((await db.syncState.get(pullCursorKey(NEG, col)))?.value)

// Remedo del Timestamp del SDK con su forma real (toMillis en el PROTOTIPO), como
// en pullDeferred.test.mjs: con toMillis propio Dexie no podria clonarlo.
class Ts { constructor(ms) { this.seconds = Math.floor(ms / 1000); this.nanoseconds = (ms % 1000) * 1e6 } toMillis() { return this.seconds * 1000 + this.nanoseconds / 1e6 } }
const api = {
  collection: (_fs, ...segs) => segs.join('/'),
  query: (ref, w) => ({ ref, w }),
  where: (f, op, v) => ({ f, op, v }),
  Timestamp: { fromMillis: (ms) => ({ ms }) }
}
const snap = (docs, fromCache = false) => ({ metadata: { fromCache }, docs: docs.map((d) => ({ data: () => d })) })

// --- 1) Sin veredicto no hay sesion F5 -------------------------------------------
await limpiar()
ok((await prepararSesionF5({ businessId: NEG, fs: {}, api, nowMs: AHORA })) === false, 'sin veredicto: no filtra')
ok(!f5Activo() && consultaF5('products') === null, 'y no hay consultas')

// --- 2) Con veredicto: una consulta por coleccion con cursor, config nunca --------
await db.syncState.put({ key: f5Key(NEG, 'veredicto'), value: true })
await ponerCursor('products', AHORA - 60000)
await ponerCursor('stockMovements', AHORA - 90000)
ok(await prepararSesionF5({ businessId: NEG, fs: {}, api, nowMs: AHORA }), 'con veredicto: filtra')
const qp = consultaF5('products')
ok(qp && qp.ref === `businesses/${NEG}/products` && qp.w.f === '_up' && qp.w.op === '>' && qp.w.v.ms === AHORA - 60000,
  'products: _up > Timestamp.fromMillis(cursor)')
ok(consultaF5('config') === null, 'config: SIN filtro')
ok(consultaF5('orders') === null, 'orders sin cursor: SIN filtro (lado seguro)')
ok(consultaF5('products') === qp, 'el MISMO objeto en cada llamada (oyente y pull comparten vista)')
ok((await prepararSesionF5({ businessId: NEG, fs: {}, api, nowMs: AHORA })) && consultaF5('products') === qp,
  'restartRealtime sin renovar: MISMAS consultas (conserva el token)')

// --- 3) Avance del cursor: solo con servidor, nunca atras ---------------------------
let r = await avanzarCursoresF5({ businessId: NEG, resultados: [{ nombre: 'products', fromServer: false, maxUpMs: AHORA, vista: 3 }], nowMs: AHORA })
ok((await cursor('products')) === AHORA - 60000 && r.avanzaron.length === 0, 'desde cache: NO avanza')
r = await avanzarCursoresF5({ businessId: NEG, resultados: [{ nombre: 'products', fromServer: true, maxUpMs: AHORA, vista: 3 }], nowMs: AHORA })
ok((await cursor('products')) === AHORA - 60000 && r.avanzaron.length === 0,
  'del servidor, pero max-margen (AHORA-120s) es MENOR que el previo: NUNCA retrocede')
r = await avanzarCursoresF5({ businessId: NEG, resultados: [{ nombre: 'products', fromServer: true, maxUpMs: AHORA + 600000, vista: 3 }], nowMs: AHORA })
ok((await cursor('products')) === AHORA + 480000 && r.avanzaron.includes('products'), 'avanza y lo dice')
const sesion = (await db.syncState.get(f5Key(NEG, 'sesion')))?.value
ok(sesion?.products?.cursorMs === AHORA - 60000 && sesion.products.lastServerMs === AHORA,
  'la sesion guarda la consulta EN USO (no el cursor nuevo) y su ultimo snapshot del servidor')

// --- 4) Reutilizar la sesion anterior (< 25 min) o renovar --------------------------
await prepararSesionF5({ businessId: NEG, fs: {}, api, nowMs: AHORA + 60000, renovar: true })
ok(consultaF5('products').w.v.ms === AHORA + 480000, 'renovar: el cursor persistido')
await volverAlVivoF5(NEG)
ok(!f5Activo(), 'volver al vivo apaga la sesion')
ok((await leerEstadoF5(NEG)).veredicto === false, 'y el veredicto')

// --- 5) Detector solo mientras se filtra y por encima del corte ---------------------
await limpiar()
await db.syncState.put({ key: f5Key(NEG, 'veredicto'), value: true })
await db.syncState.put({ key: f5Key(NEG, 'corte'), value: formatCursor(AHORA) })
await ponerCursor('sales', AHORA - 1)
let disparos = []
setDetectorHandler((nombre, res) => disparos.push([nombre, res.n, res.maxMs]))
revisarDato('sales', [{ _up: new Ts(AHORA + 5) }])
ok(disparos.length === 0, 'sin sesion F5 activa NO juzga (en el vivo todo F1 tiene _up sin _f5)')
await prepararSesionF5({ businessId: NEG, fs: {}, api, nowMs: AHORA })
revisarDato('sales', [{ _up: new Ts(AHORA - 5) }, { _up: new Ts(AHORA + 5), _f5: 1 }])
ok(disparos.length === 0, 'por debajo del corte o con marca: nada')
revisarDato('sales', [{ _up: new Ts(AHORA + 5) }])
ok(disparos.length === 1 && disparos[0][2] === AHORA + 5, 'build de main subiendo: dispara con la hora del servidor')
setDetectorHandler(null)

// --- 6) Oyentes muertos -----------------------------------------------------------
marcarMuerto('orders')
ok(oyenteMuerto('orders'), 'se anota')
limpiarMuerto('orders')
ok(!oyenteMuerto('orders'), 'y se limpia al resuscribir')

// --- 7) Reconciliacion -------------------------------------------------------------
await limpiar()
await volverAlVivoF5(NEG)
const llamadas = []
const servidor = {
  [`businesses/${NEG}/stockMovements`]: snap([{ id: 'm1', productId: 'p1', qty: 3, location: 'Salon', createdAt: '2026-10-03T11:00:00.000Z', _up: new Ts(AHORA - 30000), _f5: 1 }]),
  [`businesses/${NEG}/products`]: snap([{ id: 'p1', name: 'Pan', updatedAt: '2026-10-03T11:00:00.000Z', _up: new Ts(AHORA - 10000), _f5: 1 }])
}
const apiR = {
  collection: (_fs, ...segs) => segs.join('/'),
  getDocs: async (ref) => { llamadas.push(ref); return servidor[ref] || snap([]) }
}
let res = await reconciliarF5({ businessId: NEG, fs: {}, api: apiR, merge: mergeIncoming, recompute: recomputeStock, diferidasF2: new Set(), corteMs: AHORA - 5000 })
ok(res.ok, 'reconcilia')
ok(llamadas[0] === `businesses/${NEG}/stockMovements`, 'empieza por stockMovements')
ok(!llamadas.includes(`businesses/${NEG}/config`), 'config no se reconcilia (no se filtra)')
ok((await db.products.get('p1'))?.name === 'Pan' && !('_up' in (await db.products.get('p1'))), 'fusiona sin meter _up en Dexie')
ok((await db.products.get('p1'))?.stock === 3, 'y recalcula el stock del libro')
ok((await cursor('stockMovements')) === AHORA - 30000 - 120000, 'cursor = max _up de SU coleccion - margen')
ok((await cursor('products')) === AHORA - 10000 - 120000, 'cada coleccion con el suyo')
ok((await cursor('orders')) === AHORA - 10000 - 120000, 'una vacia: el mayor _up de lo leido ANTES - margen')
ok((await leerEstadoF5(NEG)).veredicto === true, 'deja el veredicto (filtra desde el arranque siguiente)')
ok((await leerEstadoF5(NEG)).reconciliadoMs === AHORA - 10000, 'reconciliado = el mayor _up visto (hora del servidor)')
ok(parseCursor((await db.syncState.get(f5Key(NEG, 'corte')))?.value) === AHORA - 5000, 'guarda el corte del detector')

// F2 ya difiere stockMovements: se reutiliza su cursor y NO se lee entera.
await limpiar()
await ponerCursor('stockMovements', AHORA - 3600000)
llamadas.length = 0
res = await reconciliarF5({ businessId: NEG, fs: {}, api: apiR, merge: mergeIncoming, recompute: recomputeStock, diferidasF2: new Set(['stockMovements']), corteMs: AHORA })
ok(res.ok && !llamadas.includes(`businesses/${NEG}/stockMovements`), 'F2 la difiere: NO se lee entera (seria una lectura real)')
ok((await cursor('stockMovements')) === AHORA - 3600000, 'y conserva su cursor de F2')
ok((await cursor('users')) === AHORA - 3600000,
  'una vacia que va DETRAS de la de F2 toma el _up visto por F2 (sin esto, en Burger abortaria)')
await limpiar()
res = await reconciliarF5({ businessId: NEG, fs: {}, api: apiR, merge: mergeIncoming, recompute: recomputeStock, diferidasF2: new Set(['stockMovements']), corteMs: AHORA })
ok(!res.ok && (await leerEstadoF5(NEG)).veredicto === false, 'F2 la difiere SIN cursor: no reconcilia')

// Respuesta de cache: no reconcilia ni escribe nada.
await limpiar()
const apiCache = { collection: apiR.collection, getDocs: async () => snap([], true) }
res = await reconciliarF5({ businessId: NEG, fs: {}, api: apiCache, merge: mergeIncoming, recompute: recomputeStock, diferidasF2: new Set(), corteMs: AHORA })
ok(!res.ok && (await db.syncState.count()) === 0, 'desde cache: NO reconcilia y no escribe nada')

// Nada sellado en ninguna coleccion: se reintenta luego.
await limpiar()
const apiVacia = { collection: apiR.collection, getDocs: async () => snap([]) }
res = await reconciliarF5({ businessId: NEG, fs: {}, api: apiVacia, merge: mergeIncoming, recompute: recomputeStock, diferidasF2: new Set(), corteMs: AHORA })
ok(!res.ok && (await db.syncState.count()) === 0, 'nada sellado: no reconcilia y no escribe nada')

// Si la fusion lanza: no escribe NADA (Punto de revision 2).
await limpiar()
const lanza = async () => { throw new Error('disco lleno') }
let lanzo = false
try { await reconciliarF5({ businessId: NEG, fs: {}, api: apiR, merge: lanza, recompute: recomputeStock, diferidasF2: new Set(), corteMs: AHORA }) } catch { lanzo = true }
ok(lanzo && (await db.syncState.count()) === 0, 'la fusion lanza: ni cursores ni veredicto')

// --- 8) Cura: deja en blanco F5 y F2, NO los cursores ---------------------------------
await limpiar()
await db.syncState.bulkPut([
  { key: f5Key(NEG, 'veredicto'), value: true },
  { key: f5Key(NEG, 'reconciliado'), value: formatCursor(AHORA) },
  { key: `pull:${NEG}:diferidas`, value: ['stockMovements'] },
  { key: `pull:${NEG}:reconciliado`, value: formatCursor(AHORA) },
  { key: `pull:otro:diferidas`, value: ['stockMovements'] },
  { key: pullCursorKey(NEG, 'stockMovements'), value: formatCursor(AHORA) },
  { key: 'push:sales', value: '2026-10-03T00:00:00.000Z' }
])
await dejarEnBlancoCura()
ok((await db.syncState.get(f5Key(NEG, 'veredicto'))).value === '', 'veredicto F5 en blanco')
ok((await db.syncState.get(`pull:${NEG}:diferidas`)).value === '', 'veredicto F2 en blanco (lo que difiere F2 tambien se cura)')
ok((await db.syncState.get('pull:otro:diferidas')).value === '', 'de CUALQUIER negocio')
ok((await cursor('stockMovements')) === AHORA, 'los cursores por coleccion NO se tocan')
ok((await db.syncState.get('push:sales')).value === '2026-10-03T00:00:00.000Z', 'ni la subida')
ok((await db.syncState.count()) === 7, 'nada se borra: se deja en blanco')

console.log(`f5Engine (sesion, cursores, reconciliacion y cura): ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
```

En `f5Wiring.test.mjs`:

```js
// --- Tarea 7: la consulta filtrada vive en f5Engine, con el tipo bien -----------------
const eng = leer('f5Engine.js')
const filtros = eng.split('\n').filter((l) => l.includes("where('_up'"))
ok(filtros.length === 1 && filtros[0].includes('Timestamp.fromMillis('),
  'UNA consulta filtrada, con Timestamp.fromMillis (H-A: con una cadena devolveria CERO documentos, sin error)')
ok(!/from 'firebase\//.test(eng), 'f5Engine no importa Firebase de forma estatica: se le inyecta')
```

- [ ] **Paso 2: ejecutar** `corre_base src/features/sync/f5Engine.test.mjs` → FALLA (no existe el
módulo).

- [ ] **Paso 3: escribir `f5Engine.js`**

```js
// ---------------------------------------------------------------------------
// Motor de los oyentes filtrados (spec docs/superpowers/specs/
// 2026-10-03-oyentes-filtrados-design.md, v2.1, §5.4-§5.7).
//
// Guarda el estado de la SESION (que consultas usa cada oyente, que oyentes
// murieron, el corte del detector) y el de la TRANSICION (veredicto, cursores,
// reconciliacion). Firestore se le INYECTA: este modulo no importa Firebase y se
// prueba con fake-indexeddb (f5Engine.test.mjs).
//
// La regla de oro (§3): hoy cada relectura completa CURA cualquier divergencia
// local. Aqui el cursor SOLO avanza tras fusionar con exito una respuesta del
// servidor, y todo lo que rompe esa garantia devuelve al vivo, que cura.
// ---------------------------------------------------------------------------
import { db } from '../../db/db'
import { SYNC_COLLECTIONS } from './collections'
import { pullCursorKey, parseCursor, formatCursor, nextCursor, CURSOR_MARGIN_MS } from './deferred'
import {
  F5_SEALED, isF5Sealed, f5Key, esClaveDeCura, sinMarca, decidirCursorSesion, cursorVacia
} from './f5'

let activo = false
let negocio = null
let consultas = new Map() // nombre -> { q, cursorMs }
let corteMs = null
const muertos = new Set()
let onDetector = null

export const f5Activo = () => activo
// El MISMO objeto para el oyente y para el pull de 45 s: es lo que hace que
// compartan vista (forma canonica identica) y que el pull siga sin costar (R1).
export const consultaF5 = (nombre) => (activo ? consultas.get(nombre)?.q || null : null)
export function setDetectorHandler(fn) { onDetector = typeof fn === 'function' ? fn : null }
export function marcarMuerto(nombre) { muertos.add(nombre) }
export function limpiarMuerto(nombre) { muertos.delete(nombre) }
export const oyenteMuerto = (nombre) => muertos.has(nombre)

const leer = async (key) => (await db.syncState.get(key))?.value

export async function leerEstadoF5(businessId) {
  return {
    veredicto: (await leer(f5Key(businessId, 'veredicto'))) === true,
    reconciliadoMs: parseCursor(await leer(f5Key(businessId, 'reconciliado')))
  }
}

// §5.5 — Prepara las consultas de la sesion. Sin `renovar`, una sesion ya
// activa del mismo negocio CONSERVA las suyas: restartRealtime (recuperacion,
// "Sincronizar ahora") reengancha la misma consulta y reanuda con token, como hoy.
export async function prepararSesionF5({ businessId, fs, api, nowMs = Date.now(), renovar = false }) {
  if (activo && negocio === businessId && !renovar) return true
  activo = false
  negocio = businessId
  consultas = new Map()
  corteMs = null
  const { veredicto } = await leerEstadoF5(businessId)
  if (!veredicto) return false
  const sesion = (await leer(f5Key(businessId, 'sesion'))) || {}
  corteMs = parseCursor(await leer(f5Key(businessId, 'corte')))
  const { collection, query, where, Timestamp } = api
  for (const col of SYNC_COLLECTIONS) {
    if (!isF5Sealed(col.name)) continue
    const persistedMs = parseCursor(await leer(pullCursorKey(businessId, col.name)))
    const cursorMs = decidirCursorSesion({ persistedMs, prev: renovar ? null : sesion[col.name], nowMs })
    // Sin cursor esa coleccion va SIN filtro: el lado seguro (cuesta lo que hoy).
    if (cursorMs == null) continue
    const ref = collection(fs, 'businesses', businessId, col.name)
    // EL TIPO IMPORTA (H-A, spec 2026-09-24 §10.5): con una cadena, Firestore
    // compararia tipos distintos y devolveria CERO documentos, sin error.
    consultas.set(col.name, { q: query(ref, where('_up', '>', Timestamp.fromMillis(cursorMs))), cursorMs })
  }
  activo = true
  return true
}

// §5.3 — Detector en el dato. Solo mientras se filtra: en el vivo, todo el
// historico de F1 tiene `_up` sin `_f5`.
export function revisarDato(nombre, docs) {
  if (!activo || !onDetector || corteMs == null) return
  const r = sinMarca(docs, corteMs)
  if (r.n) onDetector(nombre, r)
}

// §5.5 — El cursor avanza AQUI y solo aqui: lo llama el pase de initialPull
// DESPUES de fusionar y recalcular sin excepcion. Solo con respuesta del
// servidor; nunca atras. La sesion guarda la consulta EN USO y la hora de su
// ultimo snapshot del servidor (para reutilizarla al arrancar).
export async function avanzarCursoresF5({ businessId, resultados, nowMs = Date.now() }) {
  if (!activo || businessId !== negocio) return { avanzaron: [] }
  const sesion = (await leer(f5Key(businessId, 'sesion'))) || {}
  const escribir = []
  const avanzaron = []
  for (const r of resultados || []) {
    const c = consultas.get(r.nombre)
    if (!c || !r.fromServer) continue
    const clave = pullCursorKey(businessId, r.nombre)
    const prev = parseCursor(await leer(clave))
    const sig = nextCursor({ prevMs: prev, maxUpMs: r.maxUpMs ?? null, fromServer: true })
    if (sig != null && sig !== prev) escribir.push({ key: clave, value: formatCursor(sig) })
    if (sig != null && sig > c.cursorMs) avanzaron.push(r.nombre)
    sesion[r.nombre] = { cursorMs: c.cursorMs, lastServerMs: nowMs }
  }
  for (const r of resultados || []) {
    if (r.fromServer && Number.isFinite(r.maxUpMs) && (ultimoUpMs == null || r.maxUpMs > ultimoUpMs)) ultimoUpMs = r.maxUpMs
  }
  for (const e of escribir) await db.syncState.put(e)
  await db.syncState.put({ key: f5Key(businessId, 'sesion'), value: sesion })
  return { avanzaron }
}

// La ultima hora del SERVIDOR vista en esta sesion (el mayor `_up` llegado del
// servidor). Con ella se juzga un bloqueo puesto por otro aparato: un telefono
// con la fecha en 1970 no puede darlo por vigente para siempre.
let ultimoUpMs = null
export const ultimoUpServidor = () => ultimoUpMs

// §5.4 — Reconciliacion de la transicion, con las colecciones TODAVIA en vivo:
// su getDocs sin filtro comparte vista con el oyente y no cuesta lecturas. Lo que
// F2 ya difiere no tiene oyente: se reutiliza su cursor (leerla entera seria una
// lectura real). Todo se escribe AL FINAL: a medias no sirve de nada.
export async function reconciliarF5({ businessId, fs, api, merge, recompute, diferidasF2, corteMs: corte }) {
  const { collection, getDocs } = api
  const orden = ['stockMovements', ...F5_SEALED.filter((n) => n !== 'stockMovements')]
  const affected = new Set()
  const cursores = []
  let maxVisto = null
  for (const nombre of orden) {
    const col = SYNC_COLLECTIONS.find((c) => c.name === nombre)
    let maxCol = null
    if (diferidasF2 && diferidasF2.has(nombre)) {
      const f2 = parseCursor(await leer(pullCursorKey(businessId, nombre)))
      if (f2 == null) return { ok: false, motivo: `Falta el cursor de ${nombre}; se reintenta luego.` }
      // Su cursor + margen es un `_up` de servidor YA visto (lo bajo pullDiferido
      // antes que esta reconciliacion): cuenta para las colecciones vacias que
      // vengan despues. Sin esto, en Burger la primera vacia abortaria todo.
      const visto = f2 + CURSOR_MARGIN_MS
      if (maxVisto == null || visto > maxVisto) maxVisto = visto
      cursores.push({ key: pullCursorKey(businessId, nombre), ms: f2 })
      continue
    }
    const snap = await getDocs(collection(fs, 'businesses', businessId, nombre))
    // De cache NO cuenta: reconciliar contra la cache no rellena ningun hueco.
    if (snap.metadata.fromCache) return { ok: false, motivo: 'El servidor no respondió; no se pudo comprobar.' }
    const docs = snap.docs.map((d) => d.data())
    if (docs.length) {
      const aff = await merge(col, docs)
      maxCol = aff.maxUpMs ?? null
      aff.forEach((x) => affected.add(x))
    }
    let base
    if (maxCol != null) {
      base = maxCol
      if (maxVisto == null || maxCol > maxVisto) maxVisto = maxCol
    } else {
      // Vacia o sin nada sellado: lo leido ANTES en esta misma reconciliacion.
      const c = cursorVacia(maxVisto)
      if (c == null) return { ok: false, motivo: 'Todavía no hay nada sellado; se reintenta luego.' }
      cursores.push({ key: pullCursorKey(businessId, nombre), ms: c })
      continue
    }
    const prev = parseCursor(await leer(pullCursorKey(businessId, nombre)))
    cursores.push({ key: pullCursorKey(businessId, nombre), ms: nextCursor({ prevMs: prev, maxUpMs: base, fromServer: true }) })
  }
  if (maxVisto == null) return { ok: false, motivo: 'Todavía no hay nada sellado; se reintenta luego.' }

  if (affected.size) await recompute(affected)
  for (const c of cursores) {
    if (c.ms == null) continue
    const prev = parseCursor(await leer(c.key))
    // Nunca atras, tampoco el de una coleccion vacia.
    if (prev == null || c.ms > prev) await db.syncState.put({ key: c.key, value: formatCursor(c.ms) })
  }
  await db.syncState.put({ key: f5Key(businessId, 'corte'), value: Number.isFinite(corte) ? formatCursor(corte) : '' })
  await db.syncState.put({ key: f5Key(businessId, 'sesion'), value: {} })
  await db.syncState.put({ key: f5Key(businessId, 'reconciliado'), value: formatCursor(maxVisto) })
  await db.syncState.put({ key: f5Key(businessId, 'veredicto'), value: true })
  return { ok: true, motivo: '', reconciliadoMs: maxVisto }
}

// §5.3 — Volver al vivo: el veredicto y la reconciliacion en blanco. Quien llama
// reabre el tiempo real, y esa relectura es la que cura.
export async function volverAlVivoF5(businessId) {
  activo = false
  consultas = new Map()
  await db.syncState.put({ key: f5Key(businessId, 'veredicto'), value: '' })
  await db.syncState.put({ key: f5Key(businessId, 'reconciliado'), value: '' })
}

// §5.7 — La cura tras restaurar un respaldo o importar un turno (o el boton del
// dueño): F5 y el veredicto/reconciliacion de F2 en blanco, de CUALQUIER negocio.
// En el arranque siguiente todo vuelve al vivo, relee y reconcilia. Nada se
// borra: se deja en blanco.
export async function dejarEnBlancoCura() {
  activo = false
  consultas = new Map()
  const filas = await db.syncState.filter((r) => esClaveDeCura(r.key)).toArray()
  for (const f of filas) await db.syncState.put({ key: f.key, value: '' })
}

// §5.8 — Metricas de la sesion, para publicarlas en el arranque siguiente.
export async function leerMetricasF5(businessId) {
  const m = await leer(f5Key(businessId, 'metricas'))
  return m && typeof m === 'object' ? m : { vistaMax: 0, reaperturas: 0 }
}
export async function guardarMetricasF5(businessId, m) {
  await db.syncState.put({ key: f5Key(businessId, 'metricas'), value: m })
}
```

- [ ] **Paso 4: ejecutar** `corre_base src/features/sync/f5Engine.test.mjs` y
`node src/features/sync/f5Wiring.test.mjs` → verde.

- [ ] **Paso 5: control negativo (una a una, revirtiendo)**

1. En `avanzarCursoresF5`, quitar `|| !r.fromServer` → debe fallar «desde cache: NO avanza».
2. En `reconciliarF5`, mover el bucle de escritura de cursores ANTES de `recompute` y hacer que
   `merge` lance → debe fallar «la fusion lanza: ni cursores ni veredicto».
3. En `dejarEnBlancoCura`, usar `esClaveF5` en lugar de `esClaveDeCura` → debe fallar «veredicto F2
   en blanco».
4. En `prepararSesionF5`, quitar el retorno anticipado → debe fallar «MISMAS consultas (conserva el
   token)».

- [ ] **Paso 6: build y commit**

```bash
npm run build
git add src/features/sync/f5Engine.js src/features/sync/f5Engine.test.mjs src/features/sync/f5Wiring.test.mjs
git commit -m "Oyentes filtrados (7/12): motor de sesion, avance del cursor solo tras fusionar, reconciliacion y cura

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 8: `syncEngine.js` — oyentes y pull con la consulta de sesión

**Ficheros:**
- Modificar: `src/features/sync/syncEngine.js`, en `initialPull` (`:53-93`), `startRealtime`
  (`:295-343`), `stopRealtime`/`isRealtimeOn`/`restartRealtime` (`:345-367`) y tres funciones nuevas
- Modificar: `src/features/sync/f5Wiring.test.mjs`

**Interfaces:**
- Consume: `f5Engine` (Tarea 7), `mergeIncoming` y `recomputeStock`.
- Produce, para las Tareas 10 y 11:
  - `initialPull()` → `{ ok, total, fromServer, configDelServidor, muertos: string[], vistaMax: number, avanzaron: string[] }`;
  - `startRealtime(opts?: { renovar?: boolean })`, `restartRealtime(opts?)` y
    `esperarArranque(): Promise<void>`;
  - `reabrirOyente(nombre): Promise<void>`;
  - `reconciliarSesionF5(businessId, corteMs): Promise<{ ok, motivo }>`;
  - `caerAlVivoF5(businessId): Promise<void>`;
  - `volverABajarTodo(): Promise<void>`.

- [ ] **Paso 1: candados que fallan.** En `f5Wiring.test.mjs`:

```js
// --- Tarea 8: syncEngine ----------------------------------------------------------
const se = leer('syncEngine.js')
const pull = se.slice(se.indexOf('export async function initialPull'), se.indexOf('// Cerrojo de la bajada diferida'))
ok(/const consulta = consultaF5\(col\.name\)/.test(pull) && /getDocs\(consulta \|\| collection\(/.test(pull),
  'initialPull consulta con el MISMO objeto que el oyente (R1)')
ok(/if \(consulta && oyenteMuerto\(col\.name\)\)/.test(pull),
  'sobre un oyente muerto NO consulta (crearia su propio target: una consulta real cada 45 s)')
ok(pull.indexOf('await recomputeStock(affected)') > -1 &&
  pull.indexOf('avanzarCursoresF5(') > pull.indexOf('await recomputeStock(affected)'),
  'el cursor avanza DESPUES de fusionar y recalcular (C2)')
ok(/onSnapshot\(\s*consultaF5\(col\.name\) \|\| ref,/.test(se), 'el oyente usa la consulta de sesion')
ok(/marcarMuerto\(col\.name\)/.test(se) && /limpiarMuerto\(col\.name\)/.test(se), 'lleva la cuenta de oyentes muertos')
ok(/revisarDato\(col\.name, docs\)/.test(se), 'el oyente pasa lo que llega por el detector en el dato')
ok(/if \(await prepararSesionF5\([\s\S]{0,200}?\)\) \{\s*diferidasSesion = new Set\(\)/.test(se),
  'con F5 activo, F2 no difiere nada en esta sesion')
ok(/export function startRealtime\(opts = \{\}\) \{\s*arranque = arrancar\(opts\)/.test(se) &&
  /export const esperarArranque/.test(se),
  'el arranque deja su promesa ANTES de cualquier await: la decision del proveedor puede esperarla')
```

- [ ] **Paso 2: ejecutar** `f5Wiring` → FALLA.

- [ ] **Paso 3: implementar.**

Imports nuevos en `syncEngine.js`:

```js
import {
  prepararSesionF5, f5Activo, consultaF5, revisarDato, avanzarCursoresF5,
  marcarMuerto, limpiarMuerto, oyenteMuerto, reconciliarF5, volverAlVivoF5, dejarEnBlancoCura
} from './f5Engine'
```

El bucle de `initialPull` y lo que sigue, desde `let total = 0` hasta el `return`, pasan a ser:

```js
  let total = 0
  let fromServer = false
  let configDelServidor = false
  const affected = new Set()
  // Oyentes filtrados (spec 2026-10-03 §5.5): lo que hace falta para avanzar el
  // cursor DESPUES de fusionar, y para decidir renovaciones y reaperturas.
  const resultadosF5 = []
  const muertos = []
  for (const col of SYNC_COLLECTIONS) {
    if (diferidasSesion.has(col.name)) continue
    // Con F5 activo, la MISMA consulta que el oyente: comparten vista y este pase
    // sigue sin costar (R1). Sin F5, `null` y la coleccion entera, como siempre.
    const consulta = consultaF5(col.name)
    // Sobre un oyente MUERTO no se consulta: crearia su propio target y seria una
    // consulta real cada 45 s. Lo reabre el proveedor, con espera.
    if (consulta && oyenteMuerto(col.name)) { muertos.push(col.name); continue }
    const snap = await getDocs(consulta || collection(fs, 'businesses', businessId, col.name))
    const delServidor = !snap.metadata.fromCache
    if (delServidor) fromServer = true
    if (col.name === 'config' && delServidor) configDelServidor = true
    const docs = snap.docs.map((d) => d.data())
    let maxUpMs = null
    if (docs.length) {
      const aff = await mergeIncoming(col, docs)
      maxUpMs = aff.maxUpMs ?? null
      aff.forEach((x) => affected.add(x))
      total += docs.length
    }
    if (consulta) resultadosF5.push({ nombre: col.name, fromServer: delServidor, maxUpMs, vista: docs.length })
  }
  if (affected.size) await recomputeStock(affected)
  if (fromServer) {
    await db.syncState.put({ key: fullPullKey(businessId), value: formatCursor(Date.now()) })
  }
  // EL CURSOR AVANZA AQUI, Y SOLO AQUI (C2): despues de fusionar y recalcular sin
  // excepcion (si algo lanzo arriba, no se llega), y solo por las colecciones
  // que respondieron desde el servidor.
  const { avanzaron } = resultadosF5.length
    ? await avanzarCursoresF5({ businessId, resultados: resultadosF5 })
    : { avanzaron: [] }
  const vistaMax = resultadosF5.reduce((m, r) => Math.max(m, r.vista), 0)
  return { ok: true, total, fromServer, configDelServidor, muertos, vistaMax, avanzaron }
```

Hay que borrar las declaraciones viejas de `let fromServer = false` y `const affected = new Set()`,
que ahora van arriba, y dejar intacto el comentario largo sobre `fromCache` delante del bucle.

`listeners` pasa a ser un `Map`, y se guarda el contexto para reabrir oyentes uno a uno. Desde
`let listeners = []` hasta el final del fichero queda así (`handleIncoming`, `faltanCursores`,
`reconciliarDiferidas` y el timbre se dejan **como están**, donde están):

```js
let listeners = new Map() // nombre -> unsub
let starting = false
// Para reabrir UN oyente sin tocar los demas (oyentes filtrados §5.5).
let ctxRealtime = null
```

`startRealtime` pasa a ser un envoltorio que deja su promesa **antes de cualquier `await`**.
`observeAuth` lo llama de forma síncrona, así que cuando corre el efecto del proveedor la promesa ya
existe y `decidirF5` puede esperarla. Sin esto podría leer `f5Activo()` a medias.

```js
// Promesa del ultimo arranque del tiempo real (oyentes filtrados, spec 2026-10-03).
let arranque = Promise.resolve()
export const esperarArranque = () => arranque.catch(() => {})

export function startRealtime(opts = {}) {
  arranque = arrancar(opts)
  return arranque
}

async function arrancar(opts) {
  if (listeners.size || starting) return
  if (!(await syncConfig.isEnabled())) return
  const businessId = await syncConfig.businessId()
  if (!businessId) return

  starting = true
  try {
    const { db: fs, auth } = await getFirebase()
    if (!auth.currentUser) return
    const { collection, onSnapshot, query, where, Timestamp } = await import('firebase/firestore')

    // AQUI, y no despues: lo que se lea ahora decide a que se suscribe este
    // arranque. El veredicto lo dejo escrito el arranque anterior (SyncProvider),
    // asi que es una lectura local y rapida, sin red de por medio.
    diferidasSesion = await leerVeredicto(businessId)
    // Oyentes filtrados (spec 2026-10-03): con su veredicto, TODO va por oyente
    // filtrado y F2 no difiere nada en esta sesion.
    if (await prepararSesionF5({ businessId, fs, api: { collection, query, where, Timestamp }, renovar: !!opts.renovar })) {
      diferidasSesion = new Set()
    }

    ctxRealtime = { fs, businessId, collection, onSnapshot }
    for (const col of SYNC_COLLECTIONS) {
      if (diferidasSesion.has(col.name)) continue
      suscribir(col)
    }
  } finally {
    starting = false
  }
}

function suscribir(col) {
  const { fs, businessId, collection, onSnapshot } = ctxRealtime
  const ref = collection(fs, 'businesses', businessId, col.name)
  limpiarMuerto(col.name)
  const unsub = onSnapshot(
    consultaF5(col.name) || ref,
    (snap) => {
      // c es un DocumentChange: el documento (con .data()) esta en c.doc.
      const cambios = snap
        .docChanges()
        .filter((c) => c.type === 'added' || c.type === 'modified')
      if (!cambios.length) return
      const docs = cambios.map((c) => c.doc.data())
      // Detector en el dato (§5.3): un build viejo subiendo AHORA.
      revisarDato(col.name, docs)
      handleIncoming(col, docs)
      // El timbre solo lo tocan los cambios de OTRO aparato: una escritura
      // propia vuelve por aqui al instante con hasPendingWrites, y bajar lo
      // diferido por ella seria pagar una consulta que no trae ninguna novedad.
      if (onRing && hasForeignChange(cambios.map((c) => c.doc.metadata.hasPendingWrites))) {
        onRing(col.name)
      }
    },
    (err) => {
      console.warn('[sync] onSnapshot', col.name, err?.code || err?.message)
      // Firestore da el oyente por MUERTO tras este callback: la coleccion deja
      // de bajar en vivo hasta que algo lo reabra (oyentes filtrados §5.5).
      marcarMuerto(col.name)
      logSyncEvent('bajada-oyente-caido', col.name, err)
    }
  )
  listeners.set(col.name, unsub)
}

// Oyentes filtrados (§5.5): reabre UN oyente muerto con su misma consulta, sin
// tocar los demas (reiniciarlos todos perderia sus tokens).
export async function reabrirOyente(nombre) {
  if (!ctxRealtime) return
  const col = SYNC_COLLECTIONS.find((c) => c.name === nombre)
  if (!col) return
  const unsub = listeners.get(nombre)
  try { if (unsub) unsub() } catch { /* noop */ }
  listeners.delete(nombre)
  suscribir(col)
}

export function stopRealtime() {
  for (const unsub of listeners.values()) {
    try {
      unsub()
    } catch {
      /* noop */
    }
  }
  listeners = new Map()
}

export function isRealtimeOn() {
  return listeners.size > 0
}

// FASE 2: reabre los listeners en vivo (p.ej. tras renovar un token caducado o
// al reconectar). Cierra los actuales y vuelve a suscribir. Seguro: solo afecta
// a las SUSCRIPCIONES de lectura (onSnapshot), nunca a la cola de escrituras del
// SDK (esa la administra Firestore y sobrevive a esto). Con F5, sin `renovar`
// reengancha las MISMAS consultas (token); con `renovar`, las del cursor nuevo.
export async function restartRealtime(opts = {}) {
  stopRealtime()
  await startRealtime(opts)
}

// Oyentes filtrados (§5.4): reconcilia ESTA sesion, con las colecciones en vivo.
export async function reconciliarSesionF5(businessId, corteMs) {
  const { db: fs, auth } = await getFirebase()
  if (!auth.currentUser) return { ok: false, motivo: 'Sin sesión de nube.' }
  const { collection, getDocs } = await import('firebase/firestore')
  return reconciliarF5({
    businessId, fs, api: { collection, getDocs }, merge: mergeIncoming, recompute: recomputeStock,
    diferidasF2: getDeferred(), corteMs
  })
}

// Oyentes filtrados (§5.3): volver al vivo. La relectura de las colecciones que
// se reabren sin filtro es la que cura; lo que F2 difiera, lo sigue gobernando F2.
export async function caerAlVivoF5(businessId) {
  await volverAlVivoF5(businessId)
  await restartRealtime()
}

// Oyentes filtrados (§5.7): el boton del dueño. Todo en blanco y al vivo.
export async function volverABajarTodo() {
  await dejarEnBlancoCura()
  diferidasSesion = new Set()
  await restartRealtime()
}
```

Hay que añadir `f5Activo` al conjunto de reexportaciones, porque lo usa `SyncProvider`:

```js
export { f5Activo }
```

- [ ] **Paso 4: ejecutar** todas las suites de sync: `f5Wiring` y `cursorType` con node directo;
`f5Engine`, `pullDeferred` y `echoMerge` con `corre_base`; `pushEcho` y `pushTrace` con los alias.
Todo en verde. **`cursorType` tiene que seguir pasando tal cual:** `syncEngine.js` conserva **una
sola** `where('_up'` (la de `pullDiferido`), y sus `syncState.put` siguen usando `formatCursor`.

- [ ] **Paso 5: comprobar identificadores libres** con el script de Restricciones globales, sobre
`src/features/sync/syncEngine.js`, `src/features/sync/f5Engine.js`, `src/features/sync/f5.js` y
`src/features/sync/deviceRegistry.js`. Esperado: `TOTAL libres: 0`. **Control negativo:** una copia
de `syncEngine.js` en `$S` con `noExisteNunca()` añadido tiene que dar 1.

- [ ] **Paso 6: build y commit**

```bash
npm run build
git add src/features/sync/syncEngine.js src/features/sync/f5Wiring.test.mjs
git commit -m "Oyentes filtrados (8/12): oyente y pull con la misma consulta de sesion, oyentes muertos y el cursor tras fusionar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 9: restaurar un respaldo e importar un turno devuelven la cura

**Ficheros:**
- Modificar: `src/features/backup/backupService.js`, en `applyBackup`, después de `recomputeStock`
- Modificar: `src/features/handoff/handoffService.js`, en `applySnapshot`, como última línea
- Crear: `src/features/sync/f5Cura.test.mjs`
- Modificar: `src/features/sync/f5Wiring.test.mjs`

**Interfaces:**
- Consume: `dejarEnBlancoCura` (Tarea 7).

- [ ] **Paso 1: la suite que falla** (`src/features/sync/f5Cura.test.mjs`):

```js
// Prueba CON BASE: restaurar un respaldo o importar un turno DEVUELVE la cura
// (spec 2026-10-03 §3 y §5.7, Punto de revision 1). Sin esto, la version vieja
// restaurada quedaria por debajo del cursor y no se curaria nunca.
//   npx esbuild src/features/sync/f5Cura.test.mjs --bundle --platform=node \
//     --format=esm --outfile=<scratch>/f5Cura.bundle.mjs && node <scratch>/f5Cura.bundle.mjs
import 'fake-indexeddb/auto'
import { db } from '../../db/db'
import { applyBackup } from '../backup/backupService'
import { applySnapshot } from '../handoff/handoffService'
import { f5Key } from './f5'

let pass = 0
let fail = 0
const ok = (c, l) => { if (c) pass++; else { fail++; console.error('FAIL', l) } }
const NEG = 'neg-cura'
const sembrar = () => db.syncState.bulkPut([
  { key: f5Key(NEG, 'veredicto'), value: true },
  { key: `pull:${NEG}:diferidas`, value: ['stockMovements'] },
  { key: `pull:${NEG}:stockMovements`, value: '2026-10-03T10:00:00.000Z' }
])

await Promise.all(db.tables.map((t) => t.clear()))
await sembrar()
await applyBackup({
  meta: { app: 'mypicuadre-respaldo', version: 1, schema: db.verno, exportedAt: '2026-09-01T00:00:00.000Z' },
  tables: { products: [{ id: 'p1', name: 'Viejo', price: 100, updatedAt: '2026-09-01T00:00:00.000Z' }] }
})
ok((await db.syncState.get(f5Key(NEG, 'veredicto'))).value === '', 'respaldo: veredicto F5 en blanco')
ok((await db.syncState.get(`pull:${NEG}:diferidas`)).value === '', 'respaldo: veredicto F2 en blanco')
ok((await db.syncState.get(`pull:${NEG}:stockMovements`)).value === '2026-10-03T10:00:00.000Z', 'respaldo: cursores intactos')

await Promise.all(db.tables.map((t) => t.clear()))
await sembrar()
await applySnapshot({ meta: { version: 2 }, products: [{ id: 'p1', name: 'Viejo', updatedAt: '2026-09-01T00:00:00.000Z' }] })
ok((await db.syncState.get(f5Key(NEG, 'veredicto'))).value === '', 'turno: veredicto F5 en blanco')
ok((await db.syncState.get(`pull:${NEG}:diferidas`)).value === '', 'turno: veredicto F2 en blanco')

console.log(`f5Cura (restaurar devuelve la cura): ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
```

En `f5Wiring.test.mjs`:

```js
// --- Tarea 9: la cura ---------------------------------------------------------------
ok(/await dejarEnBlancoCura\(\)/.test(readFileSync(join(aqui, '../backup/backupService.js'), 'utf8')), 'applyBackup devuelve la cura')
ok(/await dejarEnBlancoCura\(\)/.test(readFileSync(join(aqui, '../handoff/handoffService.js'), 'utf8')), 'importar un turno tambien')
```

- [ ] **Paso 2: ejecutar** `corre_base src/features/sync/f5Cura.test.mjs` → FALLA.

- [ ] **Paso 3: implementar.** En `backupService.js`, se añade
`import { dejarEnBlancoCura } from '../sync/f5Engine'` y, en `applyBackup`, justo después de
`await recomputeStock(productIds)`:

```js
  // Oyentes filtrados (spec 2026-10-03 §5.7): lo restaurado pudo VOLVER a una
  // version vieja, y con el filtro quedaria por debajo del cursor sin curarse
  // nunca. Se deja en blanco el estado de F5 y el veredicto de F2: el arranque
  // siguiente vuelve al vivo, relee y cura.
  await dejarEnBlancoCura()
```

En `handoffService.js`, se añade `import { dejarEnBlancoCura } from '../sync/f5Engine'` y, como
última línea de `applySnapshot`:

```js
  // Oyentes filtrados (spec 2026-10-03 §5.7): el `bulkPut` de arriba no es LWW;
  // sin la cura, una version vieja quedaria por debajo del cursor para siempre.
  await dejarEnBlancoCura()
```

- [ ] **Paso 4: ejecutar** `f5Cura`, `backupFlags` y `backupCursors` (`corre_base`) y `f5Wiring` →
verde.

- [ ] **Paso 5: control negativo.** Comentar la llamada en `handoffService.js` → deben fallar las
aserciones «turno:». Después se revierte.

- [ ] **Paso 6: build y commit**

```bash
npm run build
git add src/features/backup/backupService.js src/features/handoff/handoffService.js \
  src/features/sync/f5Cura.test.mjs src/features/sync/f5Wiring.test.mjs
git commit -m "Oyentes filtrados (9/12): restaurar un respaldo o importar un turno devuelve la cura

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 10: `SyncProvider` — decisión, vigías, renovación y `subidaSinEco`

**Ficheros:**
- Crear: `src/features/sync/f5Config.js`
- Modificar: `src/app/providers/SyncProvider.jsx`
- Modificar: `src/features/sync/f5Wiring.test.mjs`

**Interfaces:**
- Consume: las Tareas 2, 4, 5, 6, 7 y 8.
- Produce: el contexto gana `f5Estado: { activo: boolean, motivo: string }`.

- [ ] **Paso 1: candados que fallan.** En `f5Wiring.test.mjs`:

```js
// --- Tarea 10: SyncProvider ----------------------------------------------------------
const cfgF5 = leer('f5Config.js')
ok(/export const OYENTES_FILTRADOS = \[\]/.test(cfgF5), 'nace en [] (paso 1 del despliegue: nadie filtra)')
const sp = readFileSync(join(aqui, '../../app/providers/SyncProvider.jsx'), 'utf8')
ok(/if \(res\.configDelServidor && !sinEcoRevisadaRef\.current\)/.test(sp),
  'subidaSinEco=true solo DESPUES de bajar config del servidor (Punto de revision 5)')
ok(/if \(!\(await db\.config\.get\('subidaSinEco'\)\)\) await configRepo\.setSubidaSinEco\(true\)/.test(sp),
  'y solo si la clave FALTA (respeta un false del dueño)')
ok(/if \(g\.ilegible\)/.test(sp), 'con /devices ilegible se conserva el veredicto')
ok(/await decidirF5\(businessId, \(\) => vivo\)/.test(sp) && /if \(!\(await leerEstadoF5\(businessId\)\)\.veredicto\) await decidirF2/.test(sp),
  'F5 decide primero y F2 solo si F5 no filtra (en serie: sin carreras entre los dos)')
ok(/setOyentesBloqueoHasta\(r\.maxMs \+ BLOQUEO_MS\)/.test(sp), 'el bloqueo se calcula con la hora del SERVIDOR')
ok(/compartirEntrePestanas\(/.test(sp), 'el libro de ecos se comparte entre pestañas')
ok(sp.indexOf('await esperarArranque()') > -1 && sp.indexOf('await esperarArranque()') < sp.indexOf('if (f5Activo()) {\n        // §5.7'),
  'la decision espera al arranque del tiempo real antes de mirar f5Activo()')
```

- [ ] **Paso 2: ejecutar** `f5Wiring` → FALLA.

- [ ] **Paso 3: crear `src/features/sync/f5Config.js`**

```js
// ---------------------------------------------------------------------------
// Interruptor de los oyentes filtrados (spec 2026-10-03-oyentes-filtrados, D2).
// Lo controla SOLO el dueño, desplegando: el usuario del negocio no configura
// nada (D1). Valores:
//   []                 -> nadie filtra (paso 1: sellar, publicar y medir)
//   ['<uid>', ...]     -> piloto por negocio (el uid es el businessId)
//   'todos'            -> todos los negocios cuya guarda lo permita
// Apagar = volver a desplegar con [] (cada aparato vuelve al vivo al reabrir).
// ---------------------------------------------------------------------------
export const OYENTES_FILTRADOS = []
```

- [ ] **Paso 4: cablear `SyncProvider.jsx`.** Se aplican estos cambios, en este orden.

**4a. Imports.** Se amplía el de `syncEngine` y se añaden los nuevos:

```js
import {
  syncNow, startRealtime, stopRealtime, initialPull, restartRealtime,
  setRingHandler, pullDiferido, getDeferred, reconciliarDiferidas, faltanCursores,
  reabrirOyente, reconciliarSesionF5, caerAlVivoF5, f5Activo, esperarArranque
} from '../../features/sync/syncEngine'
import { touchThisDevice, readDevices, publicarEstadoF5, vigilarDispositivos } from '../../features/sync/deviceRegistry'
import { leerEstadoF5, setDetectorHandler, leerMetricasF5, guardarMetricasF5, ultimoUpServidor } from '../../features/sync/f5Engine'
import { enListaF5, guardF5, corteDetector, debeRenovar, esperaReapertura, BLOQUEO_MS } from '../../features/sync/f5'
import { OYENTES_FILTRADOS } from '../../features/sync/f5Config'
import { compartirEntrePestanas } from '../../features/sync/echoLedger'
import { recomputeStock } from '../../features/sync/pullEngine'
```

**4b. Estado y refs.** Junto a los demás, tras `ringRecentRef`:

```js
  // Oyentes filtrados (spec 2026-10-03): que hace ESTE aparato y por que.
  const [f5Estado, setF5Estado] = useState({ activo: false, motivo: '' })
  const sinEcoRevisadaRef = useRef(false)
  const renovadaAtRef = useRef(null)
  const ocultaDesdeRef = useRef(null)
  const reaperturasRef = useRef(1) // el propio arranque cuenta como uno
  const vistaMaxRef = useRef(0)
  const muertosRef = useRef(new Map()) // nombre -> { intentos, proximoMs }
```

**4c. Compartir el libro de ecos.** Dentro del efecto de `observeAuth`, al principio, después de
`if (!enabled) {...}`:

```js
    compartirEntrePestanas(typeof BroadcastChannel === 'undefined' ? undefined : BroadcastChannel)
```

**4d. `runPull`.** Tras el `if (res?.ok && res.fromServer) {...}` y antes del `else if`, se convierte
ese bloque en:

```js
      if (res?.ok && res.fromServer) {
        setLastPullOkAt(new Date().toISOString())
        setPullError('')
        await despuesDelPull(res)
      } else if (res?.ok && !res.fromServer) {
```

Y se añade la función, antes de `runPull`:

```js
  // Oyentes filtrados (spec 2026-10-03): lo que se decide con cada pase.
  const despuesDelPull = async (res) => {
    try {
      // §5.6 — La subida sin eco, encendida para todos (tambien para los de main)
      // SOLO cuando config ya bajo del servidor: en un aparato recien vinculado la
      // clave falta porque no ha llegado, y escribir pisaria un false del dueño.
      if (res.configDelServidor && !sinEcoRevisadaRef.current) {
        sinEcoRevisadaRef.current = true
        if (!(await db.config.get('subidaSinEco'))) await configRepo.setSubidaSinEco(true)
      }
      if (!f5Activo()) return
      const businessId = await syncConfig.businessId()
      if (!businessId) return
      // Un bloqueo puesto por OTRO aparato llega por la config en vivo.
      const bloqueo = await configRepo.getOyentesBloqueoHasta()
      if (bloqueo != null && bloqueo > Math.max(Date.now(), ultimoUpServidor() ?? 0)) {
        await caerAlVivoF5(businessId)
        setF5Estado({ activo: false, motivo: 'Se detectó un aparato con una versión antigua.' })
        return
      }
      vistaMaxRef.current = Math.max(vistaMaxRef.current, res.vistaMax || 0)
      await guardarMetricasF5(businessId, { vistaMax: vistaMaxRef.current, reaperturas: reaperturasRef.current })
      // §5.5 — Oyentes muertos: SOLO ese, con espera creciente.
      const ahora = Date.now()
      for (const nombre of res.muertos || []) {
        const st = muertosRef.current.get(nombre) || { intentos: 0, proximoMs: 0 }
        if (ahora < st.proximoMs) continue
        st.intentos += 1
        st.proximoMs = ahora + esperaReapertura(st.intentos)
        muertosRef.current.set(nombre, st)
        await reabrirOyente(nombre)
      }
      for (const nombre of [...muertosRef.current.keys()]) {
        if (!(res.muertos || []).includes(nombre)) muertosRef.current.delete(nombre)
      }
      // §5.5 — Renovar por tamaño, solo si el cursor avanzo, con freno.
      if (debeRenovar({ nowMs: ahora, ultimaMs: renovadaAtRef.current, vistaMax: res.vistaMax, cursorAvanzo: (res.avanzaron || []).length > 0, ocultaMs: 0 })) {
        renovadaAtRef.current = ahora
        await restartRealtime({ renovar: true })
      }
    } catch (e) {
      logSyncEvent('f5-pase', null, e)
    }
  }
```

**4e. Visibilidad y conexión.** En el efecto de `visibilitychange`, `onVisible` pasa a ser:

```js
    const onVisible = () => {
      if (typeof document === 'undefined') return
      if (document.visibilityState !== 'visible') {
        ocultaDesdeRef.current = Date.now()
        return
      }
      const ocultaMs = ocultaDesdeRef.current ? Date.now() - ocultaDesdeRef.current : 0
      ocultaDesdeRef.current = null
      // Indicador de enganches en frio (§5.8): no es una medida, el SDK no los expone.
      if (ocultaMs > 30 * 60 * 1000) reaperturasRef.current += 1
      if (!navigator.onLine) return
      // §5.5 — De vuelta tras mas de 25 min oculta: consultas nuevas ANTES de que
      // el SDK reenganche las viejas (lo que releeria toda la sesion).
      if (f5Activo() && debeRenovar({ nowMs: Date.now(), ultimaMs: renovadaAtRef.current, vistaMax: 0, cursorAvanzo: false, ocultaMs })) {
        renovadaAtRef.current = Date.now()
        restartRealtime({ renovar: true }).catch(() => {})
      }
      // Las dos bajadas van con el MISMO estrangulador: un telefono de mostrador
      // entra y sale de la app decenas de veces al dia, y cada vuelta serian dos
      // consultas (Firestore cobra un minimo de una lectura por consulta, aunque no
      // devuelva nada). Lo que el estrangulador deje fuera lo recoge el timbre.
      if (Date.now() - lastPullAtRef.current > FOREGROUND_PULL_MIN_MS) {
        runPull()
        pullDiferido().catch(() => {}) // lo diferido, al volver al frente
      }
      nudgePush()
    }
```

En el efecto de conexión, `up` pasa a ser
`const up = () => { setOnline(true); reaperturasRef.current += 1 }`.

**4f. La decisión.** El cuerpo del efecto que decide (desde `useEffect(() => {` con
`const prevCols = ...` hasta su `}, [enabled, cloudUser])`) se **mueve, sin cambiar ni una línea**,
a una función `decidirF2(businessId, sigueVivo)`. Dentro de ella, `vivo` se sustituye por
`sigueVivo()` y se quitan las dos líneas que leen `businessId`, porque llega como parámetro. Después
el efecto pasa a ser:

```js
  // Decide si este aparato FILTRARA. F5 primero y, solo si F5 no filtra, F2 (en
  // SERIE: los dos tocan el tiempo real y en paralelo se pisarian).
  useEffect(() => {
    if (!enabled || !cloudUser) return
    let vivo = true
    ;(async () => {
      const businessId = await syncConfig.businessId()
      if (!businessId) return
      await decidirF5(businessId, () => vivo)
      if (!(await leerEstadoF5(businessId)).veredicto) await decidirF2(businessId, () => vivo)
    })()
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cloudUser])
```

Y se añade `decidirF5`, junto a `decidirF2`:

```js
  // Oyentes filtrados (spec 2026-10-03 §5.3/§5.4). Nunca lanza: ante la duda,
  // el veredicto se queda como estaba.
  const decidirF5 = async (businessId, sigueVivo) => {
    const fijar = (estado) => { if (sigueVivo()) setF5Estado(estado) }
    try {
      const metricas = await leerMetricasF5(businessId)
      const publicar = (texto) => publicarEstadoF5({
        f5Estado: texto, f5VistaMax: metricas.vistaMax || 0, f5Reaperturas: metricas.reaperturas || 0
      })
      await guardarMetricasF5(businessId, { vistaMax: 0, reaperturas: 1 })
      const estado = await leerEstadoF5(businessId)
      const enLista = enListaF5(OYENTES_FILTRADOS, businessId)
      if (!enLista) {
        if (estado.veredicto) await caerAlVivoF5(businessId)
        const motivo = 'La medida aún no está habilitada para este negocio.'
        fijar({ activo: false, motivo })
        await publicar(motivo)
        return
      }
      const devices = await readDevices()
      const g = guardF5({
        enLista, sinEco: await configRepo.getSubidaSinEco(),
        bloqueoHastaMs: await configRepo.getOyentesBloqueoHasta(),
        devices, reconciledMs: estado.reconciliadoMs, nowMs: Date.now()
      })
      if (g.ilegible) {
        // Sin servidor no se decide nada: el veredicto se queda como estaba.
        fijar({ activo: f5Activo(), motivo: f5Activo() ? '' : g.motivo })
        return
      }
      if (!g.ok) {
        if (estado.veredicto) await caerAlVivoF5(businessId)
        fijar({ activo: false, motivo: g.motivo })
        await publicar(g.motivo)
        return
      }
      if (!estado.veredicto) {
        const r = await reconciliarSesionF5(businessId, corteDetector(devices, g.ahoraMs))
        const motivo = r.ok ? 'Se aplicará al volver a abrir la app.' : r.motivo
        fijar({ activo: false, motivo })
        await publicar(motivo)
        return
      }
      // El arranque del tiempo real corre en paralelo (sale de observeAuth): sin
      // esperarlo, f5Activo() se leeria a medias.
      await esperarArranque()
      if (f5Activo()) {
        // §5.7 — Sin la relectura cada 45 s, el stock se recalcula entero aqui (0 lecturas).
        await recomputeStock(await db.products.toCollection().primaryKeys())
        fijar({ activo: true, motivo: '' })
        await publicar('filtrando')
      } else {
        fijar({ activo: false, motivo: 'Se aplicará al volver a abrir la app.' })
      }
    } catch (e) {
      logSyncEvent('f5-decision', null, e)
      fijar({ activo: f5Activo(), motivo: 'No se pudo comprobar; se reintenta al reabrir.' })
    }
  }
```

**4g. Detector y vigía de `/devices`,** en un efecto propio:

```js
  // Oyentes filtrados (§5.3): mientras se filtra, el detector en el dato y el
  // vigia de /devices devuelven al vivo EN EL ACTO.
  useEffect(() => {
    if (!enabled || !cloudUser || !f5Estado.activo) return
    let cancelado = false
    let soltar = () => {}
    const caer = async (motivo) => {
      const businessId = await syncConfig.businessId()
      if (!businessId || !f5Activo()) return
      await caerAlVivoF5(businessId)
      if (!cancelado) setF5Estado({ activo: false, motivo })
    }
    setDetectorHandler(async (nombre, r) => {
      logSyncEvent('f5-build-viejo', nombre, null, `${r.n} doc(s)`)
      try { await configRepo.setOyentesBloqueoHasta(r.maxMs + BLOQUEO_MS) } catch (e) { logSyncEvent('f5-bloqueo', null, e) }
      await caer('Se detectó un aparato con una versión antigua.')
    })
    vigilarDispositivos(async (devices) => {
      if (cancelado || !f5Activo() || !devices.length) return
      const businessId = await syncConfig.businessId()
      const g = guardF5({
        enLista: enListaF5(OYENTES_FILTRADOS, businessId), sinEco: await configRepo.getSubidaSinEco(),
        bloqueoHastaMs: await configRepo.getOyentesBloqueoHasta(), devices,
        reconciledMs: (await leerEstadoF5(businessId)).reconciliadoMs, nowMs: Date.now()
      })
      if (!g.ok && !g.ilegible) {
        logSyncEvent('f5-guarda-rota', null, null, g.motivo)
        await caer(g.motivo)
      }
    }).then((fn) => { if (cancelado) fn(); else soltar = fn }).catch((e) => logSyncEvent('f5-vigia-aparatos', null, e))
    return () => { cancelado = true; setDetectorHandler(null); soltar() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cloudUser, f5Estado.activo])
```

**4h. Contexto.** A `value` se le añade `f5Estado,`.

- [ ] **Paso 5: ejecutar** `f5Wiring` y el resto de suites de sync → verde. Identificadores libres
de `src/app/providers/SyncProvider.jsx` con el script de Restricciones globales: `TOTAL libres: 0`,
con su control negativo sobre una copia.

- [ ] **Paso 6: revisión manual de la equivalencia con `OYENTES_FILTRADOS = []`.** Hay que leer el
diff de `SyncProvider.jsx` y anotar en el commit que, con la lista vacía, **solo** quedan estos
cambios de comportamiento:
  - **(a)** se escribe `subidaSinEco = true` si falta, una vez, tras bajar `config`;
  - **(b)** hay una publicación de estado por arranque;
  - **(c)** se comparte el libro de ecos.

  `decidirF2` es el cuerpo de antes: `git diff -w` sobre ese bloque solo debe mostrar las líneas de
  `businessId` y `vivo`.

- [ ] **Paso 7: build y commit**

```bash
npm run build
git add src/features/sync/f5Config.js src/app/providers/SyncProvider.jsx src/features/sync/f5Wiring.test.mjs
git commit -m "Oyentes filtrados (10/12): decision automatica, vigias, renovacion y subida sin eco para todos, con la lista vacia

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 11: la tarjeta de `/cloud`

**Ficheros:**
- Modificar: `src/features/sync/CloudScreen.jsx`: el import de `syncEngine`, el render (detrás de
  `<BajadaFiltradaPanel />`) y un componente nuevo detrás de `BajadaFiltradaPanel`
- Modificar: `src/features/sync/f5Wiring.test.mjs`

- [ ] **Paso 1: candado que falla**

```js
// --- Tarea 11: /cloud ---------------------------------------------------------------
const cs = leer('CloudScreen.jsx')
ok(/<OyentesFiltradosPanel \/>/.test(cs), 'la tarjeta se pinta')
ok(/isOwner && paso === 0/.test(cs), 'la reparacion es SOLO del dueño')
ok(/await volverABajarTodo\(\)/.test(cs), 'y llama a la cura completa')
```

- [ ] **Paso 2: ejecutar** → FALLA.

- [ ] **Paso 3: implementar.** Se añade `volverABajarTodo` al import de `./syncEngine`. En el render:
`{cloudUser && syncEnabled && <OyentesFiltradosPanel />}` justo debajo de
`<BajadaFiltradaPanel />`. El componente:

```jsx
// Oyentes filtrados (spec 2026-10-03 §5.7/§5.8). Solo LECTURA del estado (D1: el
// usuario no configura nada) y una reparacion opcional del dueño.
function OyentesFiltradosPanel() {
  const { isOwner } = useAuth()
  const { f5Estado } = useSync()
  const [paso, setPaso] = useState(0) // 0 nada, 1 confirmar, 2 hecho
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const bajarTodo = async () => {
    setBusy(true)
    setError('')
    try {
      await volverABajarTodo()
      setPaso(2)
    } catch (e) {
      setError(e?.message || 'No se pudo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h3>Ahorro de lecturas</h3>
      <p className="muted">
        Se activa solo cuando todos los teléfonos del negocio tienen la app al día: entonces cada
        uno baja de la nube únicamente lo nuevo. No hay que configurar nada.
      </p>
      <p className="muted">
        {f5Estado?.activo
          ? <>Activo en este teléfono.</>
          : <>No activo: {f5Estado?.motivo || 'comprobando…'}</>}
      </p>
      {isOwner && paso === 0 && (
        <button className="btn btn--block" onClick={() => setPaso(1)}>
          Volver a bajar todo en este aparato
        </button>
      )}
      {isOwner && paso === 1 && (
        <>
          <p className="muted">
            Vuelve a leer de la nube todos los datos del negocio en este teléfono. Úsalo solo si
            algo no cuadra con los demás teléfonos: consume cuota.
          </p>
          <button className="btn btn--primary btn--block" disabled={busy} onClick={bajarTodo}>
            {busy ? 'Bajando…' : 'Sí, volver a bajar todo'}
          </button>
          <button className="btn btn--block" disabled={busy} onClick={() => setPaso(0)}>
            Cancelar
          </button>
        </>
      )}
      {paso === 2 && <p className="muted"><small>Hecho. Este teléfono está releyendo todo y volverá a ahorrar en la próxima apertura.</small></p>}
      {error && <p className="error">{error}</p>}
    </section>
  )
}
```

**Antes de usarla**, hay que comprobar con `grep -n "className=\"error" src/features/sync/CloudScreen.jsx`
que la clase de error coincide con la que usa la pantalla. Si no, se usa la suya.

- [ ] **Paso 4: ejecutar** `f5Wiring` y el build → verde. Identificadores libres de
`src/features/sync/CloudScreen.jsx` con el script de Restricciones globales: `TOTAL libres: 0`.

- [ ] **Paso 5: build y commit**

```bash
npm run build
git add src/features/sync/CloudScreen.jsx src/features/sync/f5Wiring.test.mjs
git commit -m "Oyentes filtrados (11/12): tarjeta de estado en /cloud y reparacion del dueño

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarea 12: auditoría de cierre, acta y lista de suites

**Ficheros:**
- Modificar: `CLAUDE.md`, con la lista de suites, el bloque de pruebas y una sección de acta
- Quitar: el worktree `$S/main`

- [ ] **Paso 1: todas las suites.**
  - Las de node directo de `CLAUDE.md`, más `f5.test.mjs` y `f5Wiring.test.mjs`.
  - Las de base (`corre_base`): `ordersRepo`, `syncLog`, `dailyControlLocations`, `pullDeferred`,
    `backupCursors`, `backupFlags`, `echoMerge`, `f5Engine` y `f5Cura`.
  - Las de Firebase falso: `pushEcho` y `pushTrace`.

  Se anota el recuento por suite. **Cero fallos.**

- [ ] **Paso 2: salida idéntica a `main` en todo lo que existe en los dos árboles.** Se corren en
el worktree de `origin/main` las suites que existen en los dos (las que no dependen de ficheros
nuevos), y con el `pushTrace.test.mjs` **de la rama** copiado. Se compara fichero a fichero con
`cmp`. Las únicas diferencias admitidas son las suites que esta rama cambió **a propósito**
(`deferred`, `backupFlags`, `pushEcho` y `echoLedger`), y para cada una se escribe en el acta qué
cambió y por qué. **Control negativo:** un byte añadido a una copia tiene que dar diferencia en
`cmp`.

- [ ] **Paso 3: ficheros sensibles sin cambios**

```bash
git diff --stat origin/main HEAD -- src/db/db.js firestore.rules firestore.indexes.json package.json \
  package-lock.json vite.config.js index.html src/features/sync/collections.js \
  src/repositories/ordersRepo.js src/repositories/salesRepo.js src/features/tables
```

Esperado: **vacío**.

- [ ] **Paso 4: líneas borradas y escrituras nuevas.**
  - `git diff origin/main HEAD -- src ':!*.test.mjs' | grep '^-[^-]'`: hay que leer cada una y
    anotar que son sustituciones en el sitio.
  - `grep` de `.put(` / `.bulkPut(` / `.delete(` / `.update(` / `setDoc(` en las líneas añadidas:
    solo `syncState` (estado local), `config` (`subidaSinEco`, `oyentesBloqueoHasta`) y la ficha de
    `/devices`. **Ninguna tabla de negocio.**

- [ ] **Paso 5: peso.** Se construye `origin/main` en el worktree y la rama, y se comprime el chunk
principal con el **mismo** comando (`gzip -9 -c ... | wc -c`) en los dos. Se anotan los bytes
crudos y gzip. El CSS tiene que salir con el **mismo hash**. Además,
`grep -c "__serverTimestamp__" dist/assets/*.js` tiene que dar 0 (los falsos no se cuelan).

- [ ] **Paso 6: el acta en `CLAUDE.md`.** Se añade una sección
**«Estado del trabajo (03-10-2026) — oyentes filtrados (F5)»**, con el estilo de las actas vecinas:
  - qué hace y dónde vive;
  - las decisiones D1–D4;
  - lo medido en los pasos 1–5;
  - las mutaciones cazadas;
  - la lista literal de la §9 de la spec («lo que NO se puede garantizar»);
  - el orden de despliegue de la §6;
  - **«NO fusionado a `main` y NO desplegado»**.

  Además:
  - se corrige la frase de la sección de la subida sin eco que dice «NO fusionado», porque
    `5f09101` **sí** está en `main`, con fecha de comprobación;
  - se añaden las suites nuevas al bloque `for t in ...` y a la lista de base;
  - se actualiza el recuento total de suites y aserciones con la fecha.

- [ ] **Paso 7: limpiar y commit**

```bash
git worktree remove --force "$S/main"
npm run build
git add CLAUDE.md
git commit -m "Acta - oyentes filtrados (F5): lo medido, las mutaciones cazadas y lo que no se garantiza

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Paso 8: revisión independiente de toda la rama**, con superpowers:requesting-code-review,
**antes** de proponer al dueño ningún despliegue. Los hallazgos que se acepten se corrigen con su
prueba en rojo primero.
