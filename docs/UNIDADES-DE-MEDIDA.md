# Plan — Unidades de medida configurables por el dueño

Valoración hecha **antes de tocar código** (reglas 4 y 5 del proyecto), a petición del dueño el
**13-09-2026**. Documento de referencia de la función: qué se pide, qué hay hoy **verificado en el
código**, la vía recomendada, los riesgos a auditar y las fases para ejecutarlo.

> Estado: **U1 a U4 HECHAS el 13-09-2026** (el dueño respondió el §8). Acta de ejecución y
> auditoría en el **§11**, al final. **Nada de esto se ha ejecutado en un dispositivo.**
> Rama de desarrollo: `claude/awesome-dirac-484azm`. **Nada a `main`** sin autorización.

---

## 1. Qué pide el cliente

Poder **configurar las unidades de medida desde la cuenta del dueño**, sin depender de que el
proveedor toque el programa. Dos cosas, y las dos importan:

1. **Quitar de la lista lo que no se usa.** Ejemplo suyo: hay varios tipos de galón y no quiere que
   aparezca ninguno, «para no pincharlo por error».
2. **Añadir las que la gastronomía usa y no traen los sistemas normales:**
   - **Trago** de espirituosos: **45 ml**
   - **Copa de vino**: tinto, blanco y espumoso con medidas distintas — **120, 150 y 180 ml**
   - **Dash**: las gotas de tabasco o de ciertos licores
   - **Trago de crema**: **30 ml**

Sus palabras sobre por qué lo quiere configurable y no encargado: *«si nosotros las podemos
configurar creo que es mejor, y es mejor para ustedes mismos»*. Tiene razón: cada cliente tendrá su
vocabulario, y ponerlo en el código obliga a un build por cliente.

---

## 2. Cómo está hoy (verificado, no supuesto)

```js
// src/db/constants.js:40
export const UNITS = ['u', 'lb', 'kg', 'caja', 'oz', 'g', 'ml', 'l']
export const UNIT_LABELS = { u: 'Unidad', lb: 'Libra', kg: 'Kilogramo', caja: 'Caja',
                             oz: 'Onza', g: 'Gramo', ml: 'Mililitro', l: 'Litro' }
```

**Cinco sitios la OFRECEN o la VALIDAN** — son los que habría que tocar:

| Dónde | Qué hace | Módulo |
|---|---|---|
| `ProductForm.jsx:205` | desplegable del alta/edición de producto | base |
| `RecipeForm.jsx:242` | unidad del elaborado | `cocina` / `cocteleria` |
| `ConversionScreen.jsx:380` | unidad del producto nuevo al fraccionar | `mayorista` |
| `CostSheetScreen.jsx:578` | unidad de la ficha de costo | `fichas` |
| `importService.js:93,137` | **valida** la columna Unidad y rechaza la fila | base |

**El resto solo la LEE**, y siempre con `UNIT_LABELS[x] || x` — **tolerante**: una unidad que no esté
en el mapa se muestra con su **código crudo**, sin romper nada.

---

## 3. El hallazgo que hace barata esta función

Se buscó en **todo `src/`** cualquier comparación lógica sobre la unidad (`.unit ===`, `unit ==`,
`unit.toLowerCase`…): **cero coincidencias**. **La unidad no decide nada.** Es una **etiqueta** que
se congela como copia en **diez** tablas: `sales.items`, `purchases.items`, `orderItems`, `mermas`,
`counts.items`, `productions.ingredients`, `conversions`, `transfers.items`, `partnerMovements`,
`costSheetLines`.

> **Por tanto: quitar o añadir unidades NO puede corromper el histórico.** Nada la recalcula, y todos
> los lectores ya degradan al código crudo. Esto es lo que permite resolverlo **sin tocar el esquema**.

---

## 4. Vía recomendada: el patrón de las ÁREAS

El proyecto **ya resolvió este problema**: `config.areas` + `AreasSection` en Ajustes, con la regla
escrita *«quitar un área no borra sus productos ni sus ventas; solo deja de ofrecerse»*. Las unidades
son el mismo problema y deben resolverse igual.

- **Clave `config.units`**: lista de `{ code, label, active }`.
- **Clave ausente = las 8 de hoy.** Sin migración, y un negocio que no la use no nota **nada**.
- `configRepo.getUnits()` (todas) y `getActiveUnits()` (las del desplegable).
- Pantalla en **Ajustes, solo dueño** (como las áreas): activar/desactivar, añadir, editar etiqueta.

**DESACTIVAR, no borrar.** Si se borra `oz` y hay 40 productos en onzas, esos productos siguen
mostrando «oz» (el lector la degrada bien), pero al **editar** uno el desplegable ya no la tendría.
Con *desactivada* deja de ofrecerse para lo nuevo y se sigue viendo donde ya se usa. Es la **regla 6**
del proyecto: nada se borra.

**Coste: CERO esquema Dexie y CERO colecciones de sync.** `config` ya existe, ya sincroniza y no está
en `LOCAL_CONFIG_KEYS` → el dueño lo configura una vez y llega a todos los teléfonos. **El despliegue
sigue siendo reversible.**

---

## 5. Alternativas descartadas, con motivo

| Alternativa | Por qué no |
|---|---|
| Tabla Dexie `units` propia | Dexie **v20** + colección de sync **35** por una lista de quince textos. Se pierde la reversibilidad del despliegue. No compensa. |
| Editar `constants.js` por cliente | Un **build por cliente**. Es exactamente lo que el dueño quiere evitar. |
| Texto libre en el producto, sin lista | Acabas con «ml», «mL» y «Ml» y los reportes sucios. La lista es lo que da coherencia. |

---

## 6. Los riesgos reales a auditar al implementar

1. **El desplegable DEBE incluir la unidad que el registro ya tiene, aunque esté desactivada.** Un
   `<select>` con un valor sin `<option>` se pinta **en blanco**, y el usuario puede guardar creyendo
   que puso otra cosa. **Este fallo ya existe hoy con las áreas** (`ProductForm.jsx:229`): un producto
   cuya área se quitó muestra el selector vacío. No es parte de este encargo, pero queda anotado — y
   el diseño de unidades **no debe repetirlo**.
2. **El mensaje de error del import lleva la lista escrita a mano:**
   `'Unidad invalida (u/lb/kg/caja/oz/g/ml/l)'` (`importService.js:137`). Quedaría **mintiendo**: hay
   que construirlo de la lista real.
3. **El import acepta alias** («kilo», «litros», «cc»). Las unidades nuevas no los tendrán. Propuesta:
   **código exacto** y que la plantilla liste los del negocio. Simple y predecible. → **Pregunta 8.2**.
4. **El código se congela en diez tablas.** Regla: **el código NUNCA se edita; la etiqueta sí.**
   Renombrar el código dejaría el histórico con el viejo.
5. **Unicidad y normalización** (minúsculas, sin espacios, sin duplicados), el mismo tratamiento que
   `setAreas` da a las áreas.
6. **Los cuatro desplegables hay que cambiarlos a la vez.** Dos son de módulos (`mayorista`,
   `fichas`): si se cambia la fuente solo en el producto, quedaría incoherente.

---

## 7. Advertencia importante sobre los tragos

**Poder escribir «trago» en el desplegable NO da la conversión botella → tragos.** El sistema **no
convierte entre unidades**: si se compra la botella de 700 ml y se venden tragos de 45, nadie va a
dividir por 45. Son dos cosas distintas, y las dos herramientas **ya existen**:

- **Trago de ron solo:** el **fraccionamiento** (`ConversionScreen`, módulo `mayorista`) consume 1
  botella y da de alta 15 tragos con su propio código, trasladando el costo por promedio ponderado.
- **Cócteles:** la **receta de coctelería** ya lo resuelve mejor — «0.045 L de ron por trago» y el ron
  baja esa cantidad. **Ahí no hace falta la unidad «trago» en absoluto.**

Donde sí hacen falta unidades nuevas de verdad es en **copas de vino (120/150/180)**, **dash** y
**crema de 30 ml** cuando se venden como producto propio. Y, sobre todo, en **quitar de la lista lo
que no se usa**, que es la mitad del encargo y la parte más fácil.

---

## 8. Preguntas al dueño ANTES de empezar (no se asume ninguna)

1. **¿Se puede BORRAR una unidad que nunca se usó**, o todas se «desactivan»? (Lo simple: solo
   desactivar. Lo cómodo: borrar las que no aparecen en ningún producto.)
2. **¿La importación acepta solo el código exacto**, o el dueño puede definir alias por unidad?
3. **¿Se pueden desactivar TODAS?** (Propuesta: exigir al menos una activa, o el alta de producto se
   quedaría sin opciones.)
4. **¿Se puede cambiar la etiqueta de las ocho de fábrica** (p. ej. «Caja» → «Cajita»)? El código no,
   la etiqueta sí — pero conviene confirmarlo.
5. **¿Solo el dueño, o también el administrativo?** (Propuesta: solo el dueño, como las áreas.)
6. **¿En qué orden salen en el desplegable:** alfabético, o el orden que el dueño defina (para poner
   «trago» arriba)?

---

## 9. Fases propuestas

Cada fase: código → `npm run build` **exit 0** → pruebas node de lo puro → **un commit descriptivo**
en la rama de desarrollo → auditoría escrita. **Sin Pull Requests.**

| Fase | Alcance | Verificación |
|---|---|---|
| **U1** | `configRepo.getUnits/getActiveUnits/setUnits` + la **normalización pura** (código, etiqueta, unicidad, al menos una activa) en `src/lib/` con su **suite node**. **Sin tocar pantallas**: la fase queda inerte y segura. | Build + suite nueva. Comprobar que **sin la clave** `getUnits()` devuelve **exactamente** las 8 de `constants.js`. |
| **U2** | Ajustes → tarjeta **«Unidades de medida»** (solo dueño): activar/desactivar, añadir, editar etiqueta. | Build. Comprobar que la clave nace ausente y que el negocio que no la toque no ve ningún cambio. |
| **U3** | Los **cuatro** desplegables leen de la config, **incluyendo siempre la unidad que el registro ya tiene** aunque esté desactivada (riesgo 6.1). | Build. Revisar los cuatro, y en particular la edición de un producto con una unidad desactivada. |
| **U4** | Importación: validar contra la lista real, **mensaje de error derivado** (riesgo 6.2) y plantilla con las unidades del negocio. Artículo de ayuda. | Build + prueba node del validador con unidades personalizadas y con una desactivada. |

**Coste estimado:** cinco ficheros de escritura + `configRepo` + una tarjeta de Ajustes + la
plantilla. **Sin esquema, sin colecciones de sync.** Comparable a la fase A4 de coctelería.

---

## 10. Lo que no se podrá garantizar

Lo mismo que en todo lo demás: la validación será **código + build + pruebas node**. **Nadie habrá
ejecutado la app** salvo que el dueño la pruebe en un dispositivo real. Y como toda la función vive
en `config`, **viaja por la sincronización**: si dos dispositivos editan la lista de unidades a la
vez, gana el último (LWW de la clave entera), igual que con las áreas.
---

## 11. Acta de ejecución (13-09-2026) — U1 a U4 HECHAS

El dueño respondió las seis preguntas del §8 y se ejecutaron las cuatro fases el mismo día,
un commit por fase en `claude/awesome-dirac-484azm`. **Nada a `main`.**

**Sus respuestas, que son las que manda el código:** solo **desactivar** (nunca borrar) ·
la importación acepta el **código exacto**, sin alias para las nuevas · **siempre** queda al
menos una activa · la **etiqueta** de las de fábrica sí se puede cambiar, el **código** no ·
las gestiona **solo el dueño** · en el desplegable salen en **orden alfabético** por etiqueta.

| Fase | Commit | Qué entró |
|---|---|---|
| **U1** | `b329e86` | `src/lib/unitsConfig.js` (puro) + `configRepo.getUnits/getActiveUnits/setUnits`. Fase **inerte**: ninguna pantalla lo leía. |
| **U2** | `375f948` | Tarjeta **«Unidades de medida»** en Ajustes (solo dueño): activar/desactivar, añadir, editar etiqueta, borrador con *Guardar* / *Descartar*. |
| **U3** | `18039fe` | Los **cuatro** desplegables (producto, receta, fraccionamiento, ficha) leen la lista, con la unidad del registro incluida aunque esté desactivada. |
| **U4** | `3dd1ac6` | La **importación** valida contra la lista real, mensaje de error derivado, hoja *Unidades* en la plantilla y artículo de ayuda. |

### 11.1 Los dos riesgos del §6 que se cerraron, y cómo

- **Riesgo 6.1 (el `<select>` en blanco):** `unitsForSelect(lista, actual)` mete **siempre**
  la unidad que el registro ya tiene —incluso una que no esté en la lista, con su código
  crudo—. Los cuatro desplegables la usan. El fallo gemelo de las **áreas**
  (`ProductForm`, un producto cuya área se quitó pinta el selector vacío) **sigue ahí**: no
  era parte de este encargo y no se tocó.
- **Riesgo 6.2 (el mensaje que miente):** `unitCodesText(lista)` lo deriva de las activas.
  Antes decía `u/lb/kg/caja/oz/g/ml/l` escrito a mano.

Y el otro lado, que no estaba en el plan y hacía falta: **al crear**, si la unidad por
defecto (`u`) está desactivada, se cae a la primera **activa** (producto, receta y
fraccionamiento). El dueño la apagó para no pincharla por error; no tiene sentido que sea
la que llega por defecto a un producto nuevo. **Al editar no se toca nunca.**

### 11.2 Lo que la importación ahora rechaza (y es la mitad del encargo)

Una unidad **desactivada** no entra por el Excel, **ni escrita con su alias de fábrica**
(`onzas` no pasa si la onza está apagada). Sin eso, desactivar el galón no servía de nada:
bastaba un fichero para volver a meterlo. Los alias de las **ocho de fábrica** viajaron
letra por letra a `UNIT_ALIASES`, así que un fichero que hoy importa bien (`kilos`,
`litros`, `cc`) sigue importando igual.

### 11.3 Verificación — ejecutada, no citada

- **`npm run build` exit 0** en las cuatro fases.
- **13 suites node, 766 aserciones, 0 fallos**, medidas el 13-09-2026 (la suite nueva
  `unitsConfig.test.mjs` aporta **68**). *Nota de honestidad: el registro anterior de
  `CLAUDE.md` decía 12 suites / 696; 696 + 68 = 764, no 766, así que esa cifra ya venía con
  dos aserciones de desfase. La de hoy es la medida.*
- **Peso, medido construyendo el commit base `34012ef` en un worktree aparte:** el chunk
  principal pasa de **975.58 kB** (gzip **282.95**) a **983.55 kB** (gzip **285.61**):
  **+7.97 kB, +0.82 %** (gzip +2.66 kB). El **CSS no cambia** (78.05 kB): la tarjeta reutiliza
  `.card`, `.kv` y `.field`, sin una clase nueva. Lo pagan **todos** los negocios, porque es
  función **base** y no de módulo — es lo que pidió el dueño.
- **Sin esquema Dexie y sin colecciones de sync nuevas**, verificado: la clave vive en
  `config`, que ya existe y ya sincroniza, y `units` **no** está en `LOCAL_CONFIG_KEYS`. El
  despliegue sigue siendo tan reversible como antes de esta función (el aviso de v18/v19
  sigue en pie, pero **esto no lo empeora**).
- **Nadie escribe la unidad por fuera de la lista**, verificado con `grep`: los diez sitios
  que la guardan la **copian** del producto (`unit: p.unit`) como *snapshot*. Los únicos que
  la **originan** son los cuatro desplegables y la importación, y los cuatro creadores de
  producto que hay (catálogo, entrada de mercancía, fraccionamiento y receta) pasan por
  `ProductForm` o por los dos que ya se tocaron.

### 11.4 Lo que NO se puede garantizar, y lo que queda abierto

- **NADIE HA EJECUTADO LA APP.** Ni una unidad creada, ni un Excel importado, ni la tarjeta
  abierta en un teléfono. Todo lo de arriba es **código, build y pruebas node**.
- **La lista se fusiona por LWW como una sola clave** (igual que las áreas). Si el dueño
  añade «trago» en un teléfono y en el otro desactiva la onza **en el mismo rato**, gana el
  último que guarde y el otro cambio se pierde. No corrompe nada (la lista no es histórico),
  pero hay que saberlo. La tarjeta avisa de los cambios sin guardar, no de esto.
- **Dos ficheros del módulo `fichas` siguen pintando la etiqueta de fábrica**
  (`InputsBlock.jsx:209,269` y `fichaReports.js:44`): una unidad nueva se lee ahí con su
  **código**, no con su nombre largo. Es el comportamiento tolerante de siempre y no rompe
  nada; se deja anotado.
- **Muchas pantallas imprimen el CÓDIGO a propósito** (caja, existencias, nivel de
  producción de la ficha: «5 trago»), porque el nombre largo no cabe. De ahí el aviso que se
  añadió en la tarjeta: el código debe ser **corto y legible**.
- **El fallo gemelo de las áreas** (riesgo 6.1 en `ProductForm`) sigue abierto. Es una línea,
  pero es **otra** función y se deja a decisión del dueño.
