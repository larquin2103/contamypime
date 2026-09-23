# Reenvío que compara antes de escribir — diseño (23-09-2026)

**Aprobado por el dueño, sección a sección, el 23-09-2026.** Nace de
`docs/AUDITORIA-LA-PATRONA-22-09-2026.md` §14.5: en La Patrona faltan en el aparato B **36 fichas de
producto** (3 precios, 3 costos, 12 bajas), **3 conteos** y **5 eventos de auditoría** que el aparato
A sí tiene. El reenvío existente (H3-a, `resend.js`) **no los cubre, a propósito**: reenvía con
`batch.set` a ciegas, y en una colección mutable eso puede devolver la nube a una versión vieja.

## 1. Objetivo y criterio de éxito

Reparar las versiones que **un** aparato tiene y la nube no, **sin poder hacer retroceder nada**.
Se lanza desde el aparato con los datos buenos. Por cada documento: si la nube no lo tiene, o lo
local es **estrictamente** más nuevo por `syncTs`, se escribe; si no, no se escribe.

**Éxito:** tras lanzarlo en A, B recibe las 36 fichas, los 3 conteos y los 5 eventos por la bajada
normal, y ningún documento de la nube retrocede. Lanzado desde el aparato equivocado, no escribe
nada que no sea más nuevo.

**Alcance (decisión del dueño):** solo `products`, `counts` y `auditEvents`. Ampliarlo después es
añadir un nombre a una lista, previa revisión del `syncTs` de esa colección.

## 2. Arquitectura — ficheros nuevos, `pushEngine.js` sin tocar

`pushEngine.js` no cambia ni una línea: la subida normal queda idéntica por construcción.

1. **`src/features/sync/compareResend.js`** (puro):
   - `COMPARE_RESENDABLE = ['products', 'counts', 'auditEvents']` e `isCompareResendable(name)`;
   - `candidatesSince(rows, sinceIso)`: filas con `syncTs(r) > sinceIso`, el mismo predicado que
     `countSince`;
   - `decide(local, cloud)`, que devuelve:
     - `'escribir'` si `cloud` es nulo o `syncTs(local) > syncTs(cloud)`;
     - `'igual'` si las dos marcas son iguales;
     - `'nube-mas-nueva'` en otro caso;
   - `MAX_PER_RUN = 1000`;
   - `summarize(results)`: `{ escritos, iguales, nubeMasNueva, errores, pendientes }`.
2. **`src/features/sync/compareResendEngine.js`**, que habla con Firestore:
   - `countCompareResend(name, sinceIso)`: solo local, devuelve cuántos documentos revisaría.
   - `compareResend(name, sinceIso, { onProgress })`, que:
     - exige sync activa, negocio, sesión y red;
     - tiene un cerrojo propio (`comparing`), independiente del `running` de la subida;
     - revisa los candidatos **en serie**.
   - Por cada candidato:
     - relee la fila local con `db[name].get(id)`;
     - dentro de `runTransaction` hace `tx.get(ref)` **del servidor**, calcula `decide` y, si sale
       `'escribir'`, hace `tx.set(ref, toCloud(local))`, con el documento completo y la misma
       conversión que la subida.
   - Transporte inyectable (`deps`) para probarlo en node; por defecto, Firebase con `import()`
     dinámico, como el resto.
   - No usa el cursor, ni la cola de reintentos, ni el cerrojo `running`. Si la subida normal hace
     a la vez un `set` a ciegas del mismo documento, escribe la misma versión local: no hay
     conflicto.
3. **Panel en `/cloud`** (`CloudScreen.jsx`), solo para el dueño y con sesión de nube y sync
   activa, igual que «Reenviar a la nube»:
   - se elige la colección y la fecha «Desde»;
   - **Contar** es local y muestra N documentos, N lecturas y como mucho N escrituras;
   - **Reparar** muestra el progreso y el resultado honesto: escritos, iguales, la nube tenía uno
     más nuevo, errores y pendientes.

## 3. Flujo, errores y límites

- **`'igual'` no escribe**, aunque el contenido difiera: la diferencia solo puede estar en campos
  derivados (la caché del stock) que cada aparato recalcula.
- **Error en un documento:** se cuenta, va a `/errors` (`logSyncEvent('comparar-reenvio', ...)`) y
  se sigue.
- **`unavailable`:** detiene la tanda y el resultado dice cuántos quedaron pendientes.
- **Sin sync, sin sesión o sin red:** no empieza y lo dice.
- **Tope de 1.000 documentos por tanda:** si hay más, se pide acotar la fecha.
- **En el receptor:** la fusión LWW acepta el documento más nuevo y, siendo `products`,
  `recomputeStock` recalcula el stock desde **su propio** libro mayor. La caché de stock que trae la
  ficha de A (inflada por los 8 movimientos que le faltan) no contamina a B. Por eso el orden de
  las dos reparaciones de La Patrona es indiferente.
- **Conteos:** B recibe los 3 rechazados como historial. No mueven stock: los ajustes son
  movimientos aparte, y los dos aparatos ya los tienen.

## 4. Pruebas y verificación

1. **Suite pura `compareResend.test.mjs`:** todos los casos de `decide` (incluido
   «nube más nueva → no escribe»), `candidatesSince`, la lista exacta de colecciones (`config`,
   `sales` y `stockMovements` no entran) y el tope. Controles negativos: `>=` en vez de `>`, y
   quitar la rama «nube más nueva».
2. **Suite del motor** con Firestore simulada y `fake-indexeddb`:
   - con la nube más vieja escribe, y con la nube más nueva no;
   - un reintento de la transacción con una versión nueva decide sobre la nueva;
   - un `unavailable` detiene;
   - los errores se cuentan;
   - el cerrojo impide dos tandas a la vez;
   - el tope se respeta.
3. **Control con los datos reales**, sin tocar la nube:
   - con A como local y B como «nube», se esperan 36 + 3 + 5 escrituras y 0 «nube más nueva»;
   - al revés, 0 escrituras.
   - La nube real no es B: esto valida la lógica, no la nube.
4. **Invariantes:**
   - `pushEngine.js`, `db/`, `collections.js`, `pullEngine.js` y las reglas con diff vacío contra
     `main`;
   - build exit 0 y peso medido;
   - 0 identificadores sin definir;
   - revisión independiente antes de fusionar.

## 5. Lo que no se podrá garantizar

- Que funcione contra la Firestore **real**: no se ejecuta aquí.
- Cuánto tarda en un teléfono.
- Si Firestore notifica a los demás aparatos ante una escritura (sí la habrá, porque la versión es
  nueva), su coste en lecturas: 1 por aparato conectado y documento escrito.
- Que repare lo que **ningún** aparato tiene.
