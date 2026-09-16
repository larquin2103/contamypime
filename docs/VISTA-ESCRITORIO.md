# Vista de escritorio — plan validado (16-09-2026)

**Estado: PLAN. Cero código de la aplicación tocado.** Este documento es el traspaso completo para
decidir si se ejecuta y cómo. Lo que aquí se afirma está **medido o capturado**, y lo que no se pudo
comprobar está dicho en el §9.

---

## 1. El problema, en una frase

En la computadora la aplicación se ve **igual que en el teléfono**: una columna estrecha centrada,
sea cual sea el monitor. El resto de la pantalla se desperdicia.

![Como se ve hoy en un monitor de 1440 px](img/escritorio-hoy.png)

*Captura real del armazón de la app con su CSS de hoy, a 1440 px. Las tarjetas se apilan de una en
una y sobran ~950 px a los lados.*

## 2. De dónde sale, medido

El corsé son **dos líneas** de `src/styles/global.css`:

| Dónde | Qué hace |
|---|---|
| `#root { max-width: 480px }` (**:147**) | limita TODA la aplicación al ancho de un móvil |
| `.app-nav { max-width: 480px }` (**:228**) | ancla la barra de navegación a ese mismo ancho |

Y el estado general del CSS:

- **3.462 líneas**, con solo **5 `@media`**: dos de `max-width: 380px`, una de impresión y una de
  `prefers-reduced-motion`. **La aplicación no tiene diseño adaptable**: es móvil fijo.
- **38 pantallas** usan la clase `.screen` (tope de 560 px, que hoy nunca se alcanza).
- Otros topes: `.modal` 560 px, `.auth-card` 380 px (el login: **no debe ensancharse**).
- **18 rejillas**: 5 con columnas fijas pensadas para 480 px (`.pinpad__keys`, `.convert-grid`,
  `.denom__grid`, `.kpi-grid`, `.salon-summary`) y 5 que ya se adaptan solas (`auto-fill`).
- **5 elementos `position: fixed`**: la barra de navegación, los fondos de los modales, los dos
  desplegables (sincronización y avisos) y la **barra de cobro** (`.pay-bar`).

## 3. Lo que decidió el dueño

1. **Menú lateral + contenido ancho** (aspecto de aplicación de escritorio).
2. **Tope cómodo de ~1.400 px**, centrado, para que nada quede estirado.
3. **Se usa toda la aplicación en la computadora**, no un subconjunto.

## 4. La estrategia, y por qué es segura

**Todo el cambio cabe en CSS.** Lo verifiqué: **ningún componente mide la ventana** — cero
`innerWidth`, cero `matchMedia`, cero `ResizeObserver` en todo `src/`. El armazón que hay que
reorganizar (`app-shell > header + aviso de licencia + main + nav`) se convierte en una rejilla con
áreas nombradas, y eso **no necesita tocar el JSX**.

Y todo va dentro de:

```css
@media screen and (min-width: 1024px) { … }
```

- **`min-width`** → por debajo de 1024 px **no existe ni una regla nueva**. El teléfono no ve un CSS
  distinto: ve **el mismo**.
- **`screen`** → nunca aplica al imprimir, así que el **ticket térmico de 58 mm** queda intacto por
  construcción, no por suerte.
- El cambio es **puramente aditivo**: no se modifica ninguna regla existente, se añaden reglas que
  solo viven dentro del media query.

## 5. Lo validado, con evidencia

### 5.1 El teléfono no cambia — **píxel a píxel**

Monté el armazón real con el `global.css` real y las reglas propuestas, y lo capturé con Chrome a
**390 px** (ancho de teléfono, dentro de un iframe: `--window-size` **miente** en Windows) **con** y
**sin** el CSS nuevo:

```
telefono 390px, con el CSS nuevo vs sin el   ->  PIXEL A PIXEL IDENTICAS
control negativo (breakpoint bajado a 320px) ->  DIFIEREN en 14,37 % de los pixeles
```

El **control negativo** es lo que hace válida la prueba: sin él, una comparación que no mide nada
también saldría "idéntica".

**Cautela metodológica que costó descubrir:** las dos primeras capturas del control **diferían entre
sí un 5,2 %** — la misma página capturada dos veces. La captura no era determinista hasta añadir
`--virtual-time-budget=4000` y `--force-device-scale-factor=1`. Sin eso, cualquier conclusión de
"se ve igual" habría sido ruido.

### 5.2 Soltar el ancho NO basta — y esto es el hallazgo principal

Primera versión, solo quitando el corsé y poniendo el lateral:

![Solo soltando el ancho](img/escritorio-solo-ancho.png)

Sale exactamente lo que el dueño teme: **campos de 540 px para escribir «420»**, indicadores
separados por medio monitor y tarjetas de 1.130 px con dos datos dentro. **Ensanchar sin recomponer
produce una pantalla peor que la de hoy.**

### 5.3 Con composición, el resultado es defendible

![Propuesta con composicion](img/escritorio-propuesta.png)

Tercera iteración: tarjetas de acción en cuatro columnas dentro de su acordeón, indicadores en
cuatro columnas, campos acotados, tarjeta de tasas ajustada a su contenido. **Esta captura es la
referencia visual a aprobar**, no el final: es una maqueta del Inicio, y quedan 37 pantallas.

## 6. Qué hay que tocar, en concreto

| Grupo | Elementos | Trabajo |
|---|---|---|
| **Armazón** | `#root`, `.app-shell`, `.app-header`, `.app-main`, `.app-nav`, `.nav-item` | rejilla de dos columnas y navegación vertical |
| **Anchos** | `.screen` (38 pantallas), `.modal` | tope de 1.400 px; los modales **caso por caso** |
| **No se tocan** | `.auth-card` (login), `.pinpad__keys` (teclado), `.thermal` (ticket) | ensancharlos los **empeora** |
| **Rejillas fijas** | `.kpi-grid`, `.rates-grid`, `.denom__grid`, `.convert-grid`, `.salon-summary` | número de columnas según el ancho |
| **Rejillas ya adaptables** | `.salon-grid`, `.menu-grid`, `.kitchen-grid` | revisar el tamaño mínimo de celda |
| **Fijos** | `.pay-bar` (barra de cobro), fondos de modales y desplegables | deben respetar la columna lateral |
| **Campos** | `.field input/select/textarea` | tope de ancho: un número no necesita 1.100 px |

## 7. Fases propuestas

Cada fase es **independiente y desplegable por sí sola**. Si una no convence, se revierte sin tocar
las demás.

- **F1 — Armazón.** El media query, la rejilla, la navegación lateral y el tope de `.screen`.
  Es el cambio estructural; **una sola vez y sirve a las 38 pantallas**.
- **F2 — Composición base.** Las rejillas compartidas, el tope de los campos y el panel del
  acordeón. Es lo que separa el §5.2 del §5.3, y también es transversal.
- **F3 en adelante — Pantalla por pantalla, por orden de uso en la computadora.** Propuesto:
  (a) Inicio y panel del dueño · (b) Reportes y auditoría · (c) Catálogo, productos y recetas ·
  (d) Inventario: entradas, traspasos, conteo, mermas · (e) Ventas y mesas · (f) Ajustes, usuarios,
  entregas y fichas.
- **F4 — Tabletas (768–1023 px), opcional.** Un paso intermedio: contenido más ancho con la
  navegación todavía abajo. **No se ha validado** y puede decidirse después.

**Cada fase se valida igual:** captura a 390 px comparada píxel a píxel contra la anterior (debe ser
**idéntica**) + captura a 1440 px para revisión visual + `npm run build` + las 15 suites.

## 8. Lo que este plan NO propone

- **No toca ni una línea de lógica**, ni repositorios, ni esquema Dexie, ni sincronización.
- **No cambia el JSX** en F1 y F2. Si más adelante se quisieran **más entradas en el menú lateral**
  (hoy tendría las mismas 6 que la barra inferior), eso **sí** tocaría `Layout.jsx` y sería una
  decisión aparte.
- **No toca el móvil.** Ni un píxel, y está demostrado en el §5.1.
- **No rediseña** colores, tipografía ni componentes: es una cuestión de **espacio y composición**.

## 9. Lo que no se puede garantizar

- **Nadie ha visto la aplicación real en escritorio.** Todo lo capturado es una **maqueta**: el CSS
  es el real y las clases son las reales, pero el contenido es representativo y **el render viene de
  un HTML escrito a mano, no de React**. La app no se puede abrir aquí para verla (`router.jsx`
  exige licencia firmada, usuarios en IndexedDB y sesión).
- **Solo se validó el Inicio.** Quedan 37 pantallas, y algunas —reportes con tablas anchas, el punto
  de venta con su barra de cobro fija, el salón de mesas— tienen composiciones propias que pueden
  pedir decisiones que aquí no están tomadas.
- **El breakpoint de 1024 px es una propuesta**, no una medición: sale de que el lateral (248 px)
  más un contenido cómodo (~700 px) necesitan aproximadamente eso. Una tableta en horizontal caería
  del lado de escritorio; si eso no gusta, se sube el umbral.
- **Dos defectos de accesibilidad preexistentes** siguen ahí y este plan no los toca:
  `.btn--sm` mide ~34 px (por debajo de los 44 recomendados) y `.badge--bad` da 3,72:1 de contraste.
  Están en `main` desde antes.

## 10. Coste y reversibilidad

- **Peso:** solo CSS. La estimación es de **2 a 4 kB** sobre el fichero de estilos (hoy 81,5 kB);
  se medirá en cada fase.
- **Reversible:** quitar el bloque `@media` devuelve la aplicación exactamente a como está hoy. No
  hay migración, ni dato nuevo, ni nada que deshacer en la base.
- **Convivencia:** no aplica. No cambia ningún dato ni formato, así que un teléfono sin actualizar y
  otro actualizado se entienden exactamente igual que hoy.

---

**Siguiente paso: aprobación del dueño.** Con el visto bueno se ejecuta **F1**, se captura, se
revisa, y solo entonces se pasa a F2.
