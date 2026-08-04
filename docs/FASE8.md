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
- Toggle en la **cabecera**, a la izquierda de la nube de sync: **solo el icono** del tema
  actual (🌙 oscuro / ☀️ claro) y accesible a **todos los roles** (la preferencia es local del
  dispositivo, no del negocio; por eso NO vive en Ajustes, que es del dueño). El **ticket
  térmico** queda siempre negro-sobre-blanco (impresión).
- Auditar colores *hardcoded* que asumen fondo oscuro → pasarlos a variables.

### B2 — Cambio de rol dinámico (base · riesgo alto → salvaguardas) — ✅ HECHO
- En `UsersAdmin` (solo dueño): botón "Rol" por usuario → modal `ChangeRoleForm`. Destinos:
  vendedor / admin / elaboración (este último solo con su módulo, o si el usuario ya lo tiene,
  para poder sacarlo de él). **Nunca** OWNER; el dueño no tiene botón "Rol" y no es un destino.
- **Doble candado OWNER:** la UI lo excluye **y** `usersRepo.setRole` lo rechaza en la capa de
  datos (`ASSIGNABLE_ROLES` = seller/admin/elaboration; lanza error si el objetivo es OWNER).
- **Decisiones (validadas con el dueño):** SIN PIN — solo confirmación (como desactivar/resetear
  PIN); **se BLOQUEA** el cambio si el usuario tiene un **turno abierto** (cerrar/forzar antes;
  chequeo reactivo + autoritativo en `save()`).
- `usersRepo.setRole` transaccional: rol + `updatedAt` + evento inmutable en `auditEvents`
  (`entity:'user'`, `action:'role_change'`, `fromRole`→`toRole`). Sincroniza (`users` y
  `auditEvents` ya en `SYNC_COLLECTIONS`). El `AuthProvider` ya relee el rol real de la BD al
  montar → el afectado toma el rol nuevo al reiniciar sesión/recargar (en su sesión viva, hasta
  recargar, sigue el rol viejo).
- Pendiente opcional: el evento `role_change` se guarda pero aún NO se muestra en la pantalla
  Auditoría (que hoy solo lista bajas de catálogo). Se puede añadir una vista "Cambios de rol".

### B3 — Infraestructura de imágenes (módulo `imagenes` · riesgo medio) — ✅ HECHO
- Módulo de licencia nuevo `imagenes` (`LICENSE_MODULES.IMAGES`) + su etiqueta. Base para B4/B5/B6.
- `lib/image.js` → `fileToThumbnail(file)`: redimensión + compresión **en el cliente** (canvas →
  lado mayor ≤256 px, JPEG, itera calidad hasta <40 KB). Fondo blanco (evita PNG transparentes en
  negro). Todo local; NO usa Firebase Storage.
- Dexie **v12 `images`** (`id, refType, updatedAt`), migración aditiva. Id **determinista**
  `img:<refType>:<refId>` → dos dispositivos no duplican; LWW por `updatedAt`. Los docs de
  `products`/`users` NO engordan (la foto vive aparte).
- `imagesRepo`: `get`/`getDataUrl`/`set`/`clear`/`mapByType`. **Quitar = dataUrl vacío** (no borra;
  el delete está prohibido por las reglas de sync).
- Añadido a `SYNC_COLLECTIONS`. Reglas Firestore ya lo cubren (wildcard). **Sin el módulo → cero
  imágenes, colección vacía, cero costo.** (Infraestructura: sin pantalla propia; lo visible es B4.)

### B4 — Fotos de productos (módulo `imagenes`) — ✅ HECHO
- `ProductForm`: bloque "Foto" (vista previa + Agregar/Cambiar/Quitar) con cámara o galería
  (`<input type="file" accept="image/*">`), compresión vía `lib/image` y guardado en `imagesRepo`
  (`product:<id>`). En alta, la foto se guarda con el id del producto recién creado. Editar sin
  tocar la foto NO la reescribe. Quitar = `dataUrl` vacío (no borra).
- `Catalog`: miniatura por fila (un solo `mapByType('product')`, sin N consultas). Clase
  modificadora `product-row--thumb` → **no** toca `.product-row__main` global (POS y demás
  pantallas intactas). Sin foto → marcador neutro 📦.
- **Todo gateado por `hasModule('imagenes')`**: sin el módulo, ProductForm y Catálogo quedan
  **idénticos a hoy** (DOM sin cambios, cero consultas de imágenes).
- Alcance: Catálogo + formulario. El **POS de ventas NO se tocó** (ruta de producción); pendiente
  como añadido opcional si el dueño lo pide. Las fotos de Mesas van en B5.

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
