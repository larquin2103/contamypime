# Seguridad de licencias y cuenta de nube

Estado y plan del control de licencias contra Firebase. Todo lo de aquí está
**verificado contra el código** (fichero:línea), contra la consola (captura) o contra
la documentación oficial; lo que no se pudo verificar está marcado como tal.

Última revisión: **30-08-2026**.

> **ESTADO REAL A ESTA FECHA: NO SE HA EJECUTADO NINGUNA ACCIÓN.** La brecha sigue
> abierta. No se ha tocado ni una línea de código. Una versión anterior de este
> documento daba por hecho el cierre del alta: **era falso** (la captura de la consola
> del 30-08-2026 muestra la casilla todavía marcada y «Guardar» en gris, es decir,
> sin cambios pendientes ni guardados).

---

## 1. El problema

Una misma licencia puede abrir **negocios ilimitados** en la nube, y —peor— el alta
de cuentas está **abierta a internet**: `firebaseConfig` viaja en el bundle público
(`dist/assets/index-*.js`), así que cualquiera puede llamar a `accounts:signUp` contra
el proyecto `mypicuadre` y quedarse con un árbol entero de Firestore dentro de la
cuota Spark compartida.

**El abuso de licencia es un caso particular de eso.** El control no está en la
licencia (que es offline por diseño), sino en **quién puede crear cuentas de Auth**.

### Hechos verificados en el código

| Hecho | Evidencia |
|---|---|
| La verificación es offline y sin atadura a negocio | `src/lib/license.js:82` (`verifyLicense`) — solo firma ECDSA P-256 + `expira`. Ningún `businessId`. |
| El token es LOCAL, no viaja a la nube | `src/features/sync/collections.js` → `licenseToken`/`licenseLastSeen` en `LOCAL_CONFIG_KEYS`. |
| Primera instalación acepta cualquier licencia válida | `src/app/providers/LicenseProvider.jsx:88` — `if (installed && ...)`. Sin `installed`, no valida nada. |
| `licenseId` se emite pero la app **nunca lo usa** | `tools/gen-license.mjs:107` lo genera; `grep licenseId src` = **0 resultados**. |
| Las reglas dan árbol propio a **cualquier** uid autenticado | `firestore.rules` → `isOwner()` = `auth.uid == businessId`. Nada más. |
| `maxDispositivos` lo escribe y lo lee el propio cliente | `syncService.js:78` escribe, `deviceRegistry.js:53` lee. Editable desde el aparato → **no es control**. |
| Cero App Check, cero Cloud Functions | `grep -rn "appCheck\|functions"` en `src/` y `firebase.json` = vacío. |
| Solo se usa email/contraseña | `grep` de `signInAnonymously\|GoogleAuthProvider\|signInWithPopup\|signInWithCustomToken\|sendSignInLink\|deleteUser` → **0 resultados**. No hay segunda puerta de alta. |
| `createUserWithEmailAndPassword` tiene **un solo llamador** | `syncService.js:70`, desde `CloudScreen.jsx:74`. Sin caminos ocultos. |
| `config/licenseBusiness` **sí** sincroniza | No está en `LOCAL_CONFIG_KEYS`. Es el **único proxy de licencia** que hoy llega al servidor. |

### Lo que NO se puede impedir

**El uso 100 % offline con una licencia copiada.** La licencia se verifica sin red por
diseño y el token es texto plano copiable por WhatsApp. Lo único que se le puede negar
al clon es **el árbol en la nube**. Quien quiera dos negocios sin sync, los tendrá.

---

## 2. Las tres acciones SIN CÓDIGO

Las tres cierran la brecha en lo que se puede cerrar, con **riesgo cero para un cliente
activo** y **sin tocar la app**. Ninguna está ejecutada aún.

### Acción 1 (preventiva) — Cerrar el alta de cuentas

**Dónde:** `console.firebase.google.com` → proyecto **MypiCuadre** → **Authentication**
→ pestaña **Configuración** → **Acciones del usuario**.

**Qué hacer:** desmarcar **«Habilitar la creación (registro)»** → **Guardar**.

**Qué NO tocar:**
- **«Habilitar la eliminación»** — dejarla como está. La app nunca llama a `deleteUser`
  (verificado por `grep`), y cambiarla no aporta nada frente a este problema.
- **«Protección de enumeración de correo electrónico»** — ya está activada. Dejarla.

La propia pantalla lo confirma: *«Permite o prohíbe que los usuarios realicen las
siguientes acciones en sus propias cuentas. **Siempre puedes realizarlas con el SDK de
Admin**.»* Se le prohíbe **al usuario**, no al dueño.

**Este interruptor es reversible**: si algo va mal, se vuelve a marcar.

**⚠️ Punto de decisión:** esa pantalla (con «Funciones de bloqueo», «Registro de
actividad del usuario», «Cuota de registros») es la de **Identity Platform**. Si al
guardar aparece un aviso de subida de plan, **pararse y valorar antes de aceptar**: la
subida trae un tope nuevo de **3.000 usuarios activos diarios** en Spark y
**Google no documenta que sea reversible**. Es la única vía por la que, en teoría, un
cliente legítimo podría recibir un rechazo que hoy no existe (harían falta ~3.000
negocios activos el mismo día: no es riesgo práctico, pero hay que saberlo).

#### Verificación previa (5 min, antes de guardar)

1. Anotar cuántas cuentas hay hoy en `Authentication → Usuarios` y sus correos. Es la
   foto del "antes".
2. **Probar `Usuarios → Agregar usuario` con un correo de prueba ANTES de cerrar el
   grifo**, no después. Ese será el procedimiento de venta a partir de ahora.
3. Tener a mano un teléfono ya vinculado para comprobar, justo después de guardar, que
   su «Sincronizar ahora» sigue en verde.

#### Qué se rompe al guardar: NADA de lo que hoy funciona

- **Sign-in intacto.** `linkDevice` (`syncService.js:89`) usa
  `signInWithEmailAndPassword`. El interruptor solo gobierna `accounts:signUp`.
- **La sync de todos los clientes sigue igual.** No cambia ninguna regla ni ningún
  token. `pushEngine`, `pullEngine` y `SyncProvider` no se enteran.
- **Vincular aparatos nuevos a negocios existentes sigue funcionando.**
  `ensureBusinessDoc` (`:52`) ve `snap.exists()` y no escribe nada.
- **Ningún dispositivo ya registrado puede ser expulsado jamás.**
  `deviceRegistry.js:44-50` → `allowed = already || !limit || count <= limit`
  cortocircuita en `already`. Y `touchThisDevice` llama con `enforce: false`, así que ni
  siquiera evalúa el límite. **El límite solo puede rechazar un alta nueva.**
- **El onboarding del vendedor no se toca.** El botón «Crear cuenta» de
  `Onboarding.jsx:142` crea el dueño local con PIN, no la cuenta de Firebase. Lo único
  que toca la nube ahí es `CloudLinkInline` → `linkDevice` → sign-in.

#### Dos efectos colaterales, ambos manejables sin código

1. **`maxDispositivos` dejará de aplicarse en los negocios dados de alta a partir de
   ahí.** Ver §3. **No afecta a ningún cliente actual.**
2. **El botón «Crear cuenta del negocio» (`CloudScreen.jsx:157`) quedará muerto** y
   mostrará el error de Firebase en inglés (`authErrorMessage`, `syncService.js:143-160`,
   no tiene `case` para `auth/admin-restricted-operation` → cae al `default`).
   Cosmético, no toca datos. Para un negocio ya existente ese botón **ya fallaba antes**
   (`auth/email-already-in-use`): solo cambia el texto.

### Acción 2 (correctiva) — Sellar a mano el límite y el nombre en cada alta nueva

Tras la Acción 1, el primer aparato de un cliente nuevo entra por `linkDevice`, que
llama `ensureBusinessDoc(db, uid, 'Mi negocio')` **sin `extra`** (`syncService.js:90`),
mientras que el camino viejo sí sellaba el límite (`:73`). Cadena verificada:
`readBusinessMax` lee `undefined || 0` = **0** → `evaluateSlot` con `limit = 0` hace
`!limit` = `true` → **permite siempre**.

**Arreglo sin código:** en el alta de cada cliente nuevo, tras vincular su primer
aparato, entrar en Firestore (consola) → `businesses/{uid}` y añadir a mano:
- `maxDispositivos: <número de la licencia>`
- `name: "<nombre real del negocio>"` (si no, todos se llamarán «Mi negocio»)

**Es estable, verificado:** `businesses` **no está en `SYNC_COLLECTIONS`** (los datos
cuelgan de `businesses/{id}/{colección}`; el doc padre no sincroniza) y
`ensureBusinessDoc` nunca reescribe un doc existente. El campo se queda y
`registerThisDevice` lo lee en la siguiente vinculación.

### Acción 3 (reactiva) — Revocar a un abusador concreto

`Authentication → Usuarios → <el usuario> → **Inhabilitar cuenta**`.

Ese negocio deja de sincronizar. Es quirúrgico: **solo afecta a quien se señale a dedo**,
así que un cliente legítimo no puede verse alcanzado por accidente. Cero código, cero
reglas, disponible hoy.

**Salvedad honesta:** no se pudo determinar si Firestore devuelve `unauthenticated`
(transitorio, se auto-recupera) o `permission-denied` (permanente, sin salida) cuando el
token de una cuenta inhabilitada muere. En el aparato del abusador da igual; pero es la
razón por la que **exponer `resumeAll` sigue siendo deseable** antes de usar esto de
forma habitual (ver §4).

---

## 3. Estado de cada pieza

| Pieza | Estado |
|---|---|
| Acción 1 — cerrar el alta | **NO ejecutada.** Casilla localizada y todavía marcada. |
| Acción 2 — sellar a mano | **No aplica aún** (depende de la 1). |
| Acción 3 — inhabilitar cuenta | Disponible; sin uso. |
| App Check | **No aplicado.** Sin SDK en el bundle, sin enforcement. Tras la Acción 1 aporta poco: sin alta de cuentas, el atacante anónimo no tiene dónde escribir. |
| Inventario `tools/list-businesses.mjs` | **No existe.** En `tools/` solo hay `gen-license.mjs`, `read-license.mjs` y las dos claves (ignoradas por git). |
| Código de la app | **Intacto.** 96/96 aserciones en verde, `npm run build` exit 0, bundle con hash idéntico (`index-C0lGbTIP.js`). |

---

## 4. Veredicto sobre F1 (los cambios que SÍ requieren código)

**F1.1 y F1.3 son aditivos. F1.2 NO lo es, y se recomienda descartarlo.**

### F1.1 — Sellar `licenseId` en `businesses/{uid}` → ADITIVO, seguro

Añadir un campo a un documento de Firestore y una clave nueva en `config` no rompe
nada: los lectores actuales lo ignoran, `syncTs` no cambia, el LWW no cambia. Pero
tiene **dos defectos de diseño** que hay que resolver ANTES de programarlo:

1. **No sellaría a los negocios que ya existen.** `ensureBusinessDoc`
   (`syncService.js:52-67`) solo escribe `if (!snap.exists())`. Hace falta un
   `setDoc(..., { merge: true })` aparte.
2. **`licenseId` cambia en cada renovación.** `tools/gen-license.mjs:107` hace
   `crypto.randomUUID()` en **cada emisión** → una renovación legítima parecería un
   clon. **Arreglo:** un `--cliente <id-estable>` en el generador (herramienta, no app).
   Mientras tanto, el campo estable de verdad es `licenseBusiness` (el nombre del
   negocio), que `activate()` ya obliga a mantener (`LicenseProvider.jsx:88`).

### F1.2 — Custom claim + reglas → NO ES ADITIVO. **Recomendación: descartarlo.**

Incumple la regla 2 de desarrollo y **no puede cumplir la condición de «ningún usuario
activo recibe un bloqueo»**: una regla `token.act == true` es **fail-closed**, así que
cualquier cuenta que se escape del aprovisionamiento queda muerta.

**Y no aporta nada que no dé ya la Acción 3** (inhabilitar la cuenta en consola), que es
revocación real, quirúrgica y sin riesgo.

#### La mina, por si algún día se reconsidera

1. `retryQueue.js:20` → `permission-denied` está en `PERMANENT`.
2. `pushEngine.js:189` (`onBatchError`) → permanente → aísla el lote → `onPermanent`.
3. `retryQueue.js:79` → el registro queda en `state: 'paused'`.
4. `retryQueue.js:87` (`autoResume`) → **excluye los permanentes**. No se reactiva nunca.
5. `retryQueue.js:99` (`resumeAll`) es la única salida — y **no tiene ni un llamador en
   `src/`** (`grep -rn resumeAll src` → solo `retryQueue.test.mjs`).

No hay pérdida de datos (todo sigue en Dexie y en la cola por id), pero sí **parálisis
silenciosa** de la subida de ese aparato.

Asimetría útil: **la bajada sí se auto-repara.** `initialPull` lanza → `runPull` lo
captura (`SyncProvider.jsx:169`) → `recoverSession()` → `refreshSession()` hace
`getIdToken(true)`.

**Variante fail-open descartada por ahora:** denegar solo a quien se marque `blocked`
(sin claim = igual que hoy) sería aditiva en comportamiento. Pero **no se pudo confirmar
en la documentación oficial qué hace una regla al leer un claim inexistente** — las
páginas de referencia de `rules.Map` no devolvieron el detalle, y podría denegar por
error de evaluación, justo lo contrario de lo buscado. No se propone sin comprobarlo en
el **Rules Playground**.

### F1.3 — Dejar de vender `perpetua` → ADITIVO (solo la herramienta)

Verificado: `gen-license.mjs:105` → `perpetua` da `expira: null`; `license.js:110`
(`daysUntil`) devuelve `Infinity` → nunca caduca → **sin revocación offline posible**.
Emitir `--dias 400` da el mismo valor percibido y un punto de contacto anual.

---

## 5. Cola de trabajo con código (nada autorizado aún)

Todo esto va sobre `claude/awesome-dirac-484azm`. **Ojo: el repo está actualmente
posicionado en `main`** (`main` = `claude/awesome-dirac-484azm` = `origin/main` =
`aaeb306`, divergencia 0/0). Cambiar de rama antes de cualquier commit.

| # | Tarea | Aditivo | Toca app |
|---|---|---|---|
| A | `case 'auth/admin-restricted-operation'` en `authErrorMessage` + ocultar el botón muerto | Sí | Sí |
| B | `tools/list-businesses.mjs` (inventario, solo lectura, clave de servicio) | Sí | No |
| C | Exponer `resumeAll` en la UI — red de seguridad que hoy falta para **cualquier** causa | Sí | Sí |
| D | `--cliente` estable en `gen-license.mjs` + dejar de emitir perpetuas | Sí | No |
| E | Sellar `licenseId`/`licenseBusiness` con `merge:true` (automatiza la Acción 2) | Sí | Sí |
| F | ~~Claims + reglas~~ | **NO** | **Descartado** |

---

## 6. Lo que NO está garantizado

1. **Nada se ha probado en runtime.** Es análisis de código + consola + documentación.
2. **Uso offline con licencia copiada:** imposible de impedir. Problema de modelo de
   negocio, no de código.
3. **El cierre del alta no es retroactivo.** Lo que ya esté creado arriba sigue ahí y
   sigue escribiendo. Sin el inventario (tarea B), no se sabe cuántas cuentas hay.
4. **Cuota Spark compartida:** 50.000 lecturas / 20.000 escrituras / 1 GiB al día para
   **todos** los negocios juntos. La Acción 1 corta el abuso externo; no evita que los
   clientes legítimos la agoten al crecer.
5. **Reversibilidad de Identity Platform:** Google no lo documenta. Asumir que no.
6. **Comportamiento de las reglas ante un claim inexistente:** sin confirmar. Solo se
   resuelve en el Rules Playground.

---

## 7. Fuentes

- [Identity Platform — gestión de usuarios (casilla «Enable create (sign-up)»)](https://cloud.google.com/identity-platform/docs/concepts-manage-users)
- [Identity Platform vs Firebase Authentication](https://cloud.google.com/identity-platform/docs/product-comparison)
- [Blocking functions (beforeCreate / beforeSignIn)](https://cloud.google.com/identity-platform/docs/blocking-functions)
- [Firebase App Check](https://firebase.google.com/docs/app-check)
- [Activar enforcement de App Check](https://firebase.google.com/docs/app-check/enable-enforcement)
- [Cuotas y límites de Cloud Firestore](https://firebase.google.com/docs/firestore/quotas)
- [Custom claims con el Admin SDK](https://firebase.google.com/docs/auth/admin/custom-claims)
- [Reglas de seguridad y autenticación](https://firebase.google.com/docs/rules/rules-and-auth)
