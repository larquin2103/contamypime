# Usar MypiCuadre en el teléfono

Hay dos caminos. El **A** la deja instalada como app en tu Android (recomendado).
El **B** es solo para una prueba rápida en la misma red WiFi.

---

## A) Publicarla en internet (Firebase Hosting, gratis) — instalable

Esto le da una dirección `https://...` y permite **instalarla** en el teléfono.

### 1. Crear el proyecto en Firebase (una sola vez)
1. Entra a https://firebase.google.com con tu cuenta de Google.
2. **Crear un proyecto** → ponle un nombre (ej. `mypicuadre`) → continuar (puedes desactivar Analytics).

### 2. Instalar las herramientas en tu PC (una sola vez)
En la terminal de VS Code, dentro de la carpeta del proyecto:

```bash
npm install -g firebase-tools
firebase login
```
`firebase login` abre el navegador para que entres con la misma cuenta de Google.

### 3. Enlazar la carpeta con tu proyecto (una sola vez)
```bash
firebase use --add
```
Elige el proyecto que creaste y, cuando pida un alias, escribe `default`.

> Ya dejé listo el archivo `firebase.json` (configuración de hosting, rutas y caché),
> así que **no** necesitas correr `firebase init`.

### 4. Publicar (cada vez que quieras subir cambios)
```bash
npm run deploy
```
Esto construye la app y la sube. Al terminar te muestra la **Hosting URL**
(algo como `https://mypicuadre.web.app`).

### 4b. Sincronización (Fase 4) — habilitar Firestore una sola vez
Para que los teléfonos se sincronicen entre sí necesitas activar la base de
datos en la nube y subir sus reglas de seguridad:

1. En la consola de Firebase → **Build → Firestore Database → Crear base de datos**
   (modo *producción*, la región más cercana).
2. En **Authentication → Sign-in method**, activa **Correo electrónico/Contraseña**.
3. Sube las reglas de seguridad (van en `firestore.rules`):
   ```bash
   firebase deploy --only firestore:rules
   ```
4. En la app (teléfono del dueño): **☁️ Sincronización → Crear cuenta del negocio**
   (nombre + correo + contraseña). En cada otro teléfono: **Vincular dispositivo**
   con el **mismo correo y contraseña**.

> Solo hace falta internet para vincular la primera vez. Después la app sigue
> funcionando sin conexión y se sincroniza sola cuando vuelve internet.

### 5. Instalar en el Android
1. Abre esa URL en **Chrome** del teléfono.
2. Menú **⋮** → **Agregar a la pantalla de inicio** / **Instalar app**.
3. Queda como una app más, abre a pantalla completa y **funciona sin internet**.

---

## B) Prueba rápida en la misma WiFi (sin publicar)

Útil para ver algo en el teléfono al instante. **No** se instala como app.

1. En la PC (conectada a la misma WiFi que el teléfono):
   ```bash
   npm run host
   ```
2. Verás una línea **Network:** `http://192.168.x.x:5173/`.
3. Escribe esa dirección en el navegador del teléfono.

> Por ser `http` (no `https`), Chrome no ofrece instalarla; pero puedes usarla
> normalmente en el navegador.

---

## Notas
- Los datos viven en el teléfono (IndexedDB) y, si activas la sincronización
  (paso 4b), se replican en Firestore para compartirlos entre dispositivos.
  Sin activarla, cada teléfono tiene los suyos y el traspaso es por archivo JSON.
- Firebase **Hosting** y **Firestore** (plan Spark) son gratis y suficientes
  para una tienda pequeña.
