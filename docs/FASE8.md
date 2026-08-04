# Fase 8 — Mejoras visuales y de gestión

Plan acordado con el dueño. Reglas: **todo en la rama** `claude/awesome-dirac-484azm`,
**nada a `main`** sin autorización, cada bloque con **auditoría** y **default =
comportamiento actual**. Las imágenes van **gateadas** por un módulo de licencia nuevo.

## Decisiones fijadas
- **Roles:** solo el **dueño** reasigna roles de *otros* (vendedor↔admin↔elaborador).
  El **rol de dueño es intocable** (no se cambia ni se transfiere) — protege la identidad
  del negocio (`uid` = `businessId`), la licencia y el código de recuperación.
- **Imágenes:** **miniaturas sincronizadas** (≤256 px, JPEG, <40 KB) en **colección aparte**
  de Firestore (nunca dentro de `products`/`users`), con topes estrictos → se mantiene en el
  **plan gratis** (Spark). NO se usa Firebase Storage (requeriría Blaze).
- **Gating:** las imágenes (productos + carta de mesas + avatares) van en un **módulo de
  licencia nuevo** (`imagenes`). El **tema** y el **cambio de rol** son **base**.
- **Orden:** empezamos por el **tema claro/oscuro (B1)**.

## Bloques

### B1 — Tema claro/oscuro (base · riesgo bajo) — EN CURSO
- Paleta clara sobreescribiendo variables bajo `:root[data-theme="light"]`; el oscuro sigue
  siendo `:root` (default, intacto). Preferencia en **localStorage** (`mc_theme`, por
  dispositivo, no sincroniza), aplicada en `main.jsx` **antes de pintar** (sin parpadeo).
- Toggle en Ajustes. El **ticket térmico** queda siempre negro-sobre-blanco (impresión).
- Auditar colores *hardcoded* que asumen fondo oscuro → pasarlos a variables.

### B2 — Cambio de rol dinámico (base · riesgo alto → salvaguardas)
- En `UsersAdmin` (solo dueño): acción "Cambiar rol". Destinos: vendedor / admin / elaborador
  (este último solo con su módulo). **Nunca** OWNER; **no** se toca a quien sea OWNER.
- `usersRepo.setRole` + registro en `auditEvents`. Sincroniza. El `AuthProvider` relee el rol
  real de la BD al iniciar sesión (aviso: un usuario conectado toma el nuevo rol al recargar).

### B3 — Infraestructura de imágenes (módulo `imagenes` · riesgo medio)
- Captura **cámara/galería** (`<input type="file" accept="image/*" capture>`), **redimensión +
  compresión en el cliente** (canvas → ≤256 px, JPEG, <40 KB).
- Nueva tabla Dexie **v12 `images`** `{ id, refType, refId, dataUrl, updatedAt }` (una por
  producto/usuario). Se añade a `SYNC_COLLECTIONS`. Los docs de `products`/`users` NO engordan.
- Reglas Firestore ya cubren la colección (wildcard). Sin el módulo → cero imágenes, cero costo.

### B4 — Fotos de productos (módulo `imagenes`)
- En Catálogo/ProductForm: agregar/reemplazar/quitar foto. Miniatura en listas y búsqueda.
- Sin módulo o sin foto → el ícono actual (idéntico a hoy).

### B5 — Carta de menú con fotos en Mesas (módulo `mesas` + `imagenes`)
- Fotos en el "Agregar consumo" y, opcional, vista *carta* para clientes.
- Sin fotos → los mosaicos de texto actuales.

### B6 — Avatares de usuario (módulo `imagenes`)
- El Home muestra la foto en vez de la inicial. Sin módulo → la inicial actual.

## Invariantes (cross-cutting)
- Todo lo de imágenes tras `hasModule('imagenes')` → sin el módulo, la app queda **idéntica a
  hoy** (cero storage/sync de fotos).
- Migración v12 aditiva; `firestore.rules` no cambia (wildcard); el motor de sync toma `images`
  solo (itera `SYNC_COLLECTIONS`).
- Cada bloque: build limpio + auditoría + en la rama. Nada a `main` sin autorización.

## Honestidad / límites conocidos
- Las imágenes son **miniaturas** (no alta resolución); fotos grandes romperían el plan gratis.
- El **modo claro** es "best-effort": la paleta base se cubre por variables, pero el ajuste
  fino de contraste en pantallas concretas necesita prueba visual del dueño.
- Validación por revisión de código + build; no hay tests automatizados ni ejecución runtime aquí.
