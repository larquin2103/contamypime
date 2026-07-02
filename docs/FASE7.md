# Fase 7 — Robustez y calidad profesional

Plan derivado de la auditoría técnica del proyecto (jul 2026). Objetivo: cerrar las
brechas entre "funciona bien" y "producto profesional". Ordenada por riesgo: primero
lo que protege datos y dinero del cliente, después seguridad, después pulido.

La numeración continúa desde el Bloque 31 (último de la Fase 5).

## Bloque 32 — Protección del dato local 🔴 crítico (~1–2 días)

El activo del cliente es IndexedDB; hoy puede desaparecer sin aviso.

- **32.1** Llamar `navigator.storage.persist()` en el arranque. Guardar el resultado y
  mostrarlo en Ajustes ("Almacenamiento protegido: ✅/⚠️"). Si fue denegado, avisar al
  dueño con recomendación (instalar la PWA aumenta la probabilidad de concesión).
- **32.2** Respaldo completo: exportar TODA la base Dexie a un archivo JSON (todas las
  colecciones, con versión de esquema incluida), compartible por WhatsApp como ya se
  hace con el traspaso de turno.
- **32.3** Restauración: importar ese JSON en un dispositivo (fusión por upsert, nada se
  borra; valida versión de esquema). Confirmación con PIN del dueño.
- **32.4** Recordatorio de respaldo: si no hay sync activa y el último respaldo tiene más
  de N días, aviso suave en el Home del dueño.

## Bloque 33 — Resiliencia ante errores 🔴 crítico (~1 día)

- **33.1** `ErrorBoundary` global en `router.jsx`: pantalla en español "Ocurrió un error"
  con botón de reinicio, en vez de pantalla en blanco a mitad de turno.
- **33.2** Tabla Dexie `errorLog` (append-only, coherente con la arquitectura): capturar
  `window.onerror`, `unhandledrejection` y los errores del boundary, con marca de
  tiempo, versión de la app y ruta activa.
- **33.3** Pantalla en Ajustes (solo dueño/admin) para ver el registro y compartirlo por
  WhatsApp → convierte "se me trabó" en un reporte diagnóstico real.

## Bloque 34 — Pruebas del núcleo de dinero 🟠 alto (~2–3 días)

Vitest solo sobre lógica pura; sin tocar UI.

- **34.1** Instalar Vitest + `fake-indexeddb` (para probar repos contra Dexie real en
  memoria). Script `npm test`.
- **34.2** Tests de `lib/currency.js`: conversiones MN/USD/MLC, redondeos, tasas
  append-only.
- **34.3** Tests del cuadre: esperado vs contado, semáforo con umbrales, conteo por
  denominación.
- **34.4** Tests de stock: recálculo desde `stockMovements`, `stockByLocation` (entradas,
  transfers, ventas por área), atomicidad de `transfersRepo.create`.
- **34.5** Tests de sync: fusión LWW por `syncTs` en `pullEngine`, recálculo de stock tras
  fusión, cursores de `pushEngine`.

## Bloque 35 — Dependencias seguras 🟠 alto (~0.5–1 día)

- **35.1** `xlsx` 0.18.5 → distribución oficial de SheetJS (≥0.20.2, desde
  cdn.sheetjs.com) o migrar a `exceljs`. Cierra CVE-2023-30533 y CVE-2024-22363 —
  relevante porque se importan Excel de terceros.
- **35.2** `jspdf` 2.x → 3.x (+ `jspdf-autotable` compatible). Verificar todas las
  exportaciones PDF/Excel existentes (reportes, cierre de turno, plantillas).

## Bloque 36 — Carga y actualización 🟡 medio (~1 día)

- **36.1** `React.lazy` + `Suspense` por feature en el router: reportes, auditoría,
  dashboard, ayuda, sync, import — todo lo que el vendedor no usa en el día a día.
  Meta: bajar el chunk inicial de ~508 KB a la mitad.
- **36.2** Cambiar el SW de `autoUpdate` a patrón `prompt`: banner "Hay una versión
  nueva — Actualizar", que además evita actualizar a mitad de un turno abierto.
- **36.3** Versionado visible: subir `package.json` a 1.0.0, inyectar la versión con
  `define` de Vite y mostrarla en Ajustes y Ayuda. Semver en cada deploy + CHANGELOG.md.

## Bloque 37 — Calidad de código y CI 🟡 medio (~1–2 días)

- **37.1** ESLint (con `react-hooks/exhaustive-deps`) + Prettier, y pasada de corrección
  sobre lo que aflore.
- **37.2** GitHub Action: lint + tests + build en cada push a `main` y a la rama de
  desarrollo.
- **37.3** JSDoc + `// @ts-check` en la capa de dinero: `lib/currency.js`,
  `repositories/`, motores de sync. Cero cambio de build; detección de `undefined`
  donde cuesta dinero.

## Bloque 38 — Endurecimiento de la nube 🟡 medio (~1–2 días)

- **38.1** Firebase App Check + restringir la API key por dominio (pendiente que ya
  señala el comentario de `firebaseConfig.js`).
- **38.2** Validación de esquema en `firestore.rules`: campos requeridos, tipos y tamaño
  máximo por colección (protege contra corrupción desde un cliente comprometido).
- **38.3** Documentar en CLAUDE.md/DEPLOY.md el riesgo asumido del modelo actual (cada
  dispositivo lleva la sesión del negocio) y la ruta futura si se sale del plan Spark
  (custom claims / Cloud Functions).

## Bloque 39 — Pulido de UI 🟢 bajo (~1 día)

- **39.1** Sustituir los `alert()/confirm()` nativos restantes por el modal propio del
  tema.
- **39.2** Estados vacíos consistentes (ilustración + texto guía) en listas sin datos.
- **39.3** Pasada de accesibilidad táctil: targets ≥44 px, foco visible, `aria-*`
  sistemático.

---

**Orden sugerido:** 32 → 33 → 34 → 35 → 36 → 37 → 38 → 39. Los bloques 32+33 son la
red de seguridad del cliente; 34+35 protegen la corrección; del 36 en adelante cada
bloque es independiente y se puede intercalar con otras prioridades.

**Estimación total:** ~9–13 días de trabajo efectivo.

## Estado

- Bloque 32: ✅ COMPLETA (persistencia de almacenamiento, respaldo/restauración completa
  en `/backup`, recordatorio en el Home del dueño).
- Bloque 33: ✅ COMPLETA (ErrorBoundary global, tabla `errorLog` Dexie v6 con captura de
  `window.onerror`/`unhandledrejection`/errores de render, pantalla `/errors` con
  compartir por WhatsApp; enlace y contador en Ajustes).
- Bloques 34–39: pendientes.
