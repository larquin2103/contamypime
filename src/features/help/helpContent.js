// Import CON extensión a propósito: así este fichero se puede cargar en node y su
// filtro de visibilidad (el que impide una fuga de licencia por la ayuda) tiene una
// suite de pruebas propia. Vite resuelve igual con extensión o sin ella.
import { LICENSE_MODULES } from '../../lib/license.js'

// Material de ayuda de MypiCuadre (Fase A). Contenido como DATOS editables para
// poder retocar los textos sin tocar la interfaz. Cada artículo:
//   { id, section, audience, title, teaser, body:[bloques], module? }
// El icono de cada artículo vive en HelpScreen (ARTICLE_ICONS, lucide por id).
// Bloques soportados por HelpScreen: { p } párrafo · { steps:[...] } pasos
//   numerados · { tip } consejo (verde) · { warn } aviso (amarillo).
//
// audience: 'owner'  -> lo ve el dueño/administrativo (recorrido principal)
//           'seller' -> guía corta para el vendedor (el dueño también la ve)
//
// module (F10, OPCIONAL): si está, el artículo SOLO se ve con ese módulo de
// licencia desbloqueado. Sin el campo, el artículo se ve siempre, igual que antes
// de que existiera. Hace falta porque explicar en la ayuda una función que el
// negocio no tiene comprada es una fuga de licencia como cualquier otra: filtran
// `HelpScreen` y también `helpPdf`, que si no la colaría por el PDF.
//
// modules (OPCIONAL, lista): para un artículo que explica algo COMÚN a varios
// módulos. Basta con tener UNO de ellos. Se puede combinar con `module` (entonces
// se exigen los dos criterios). Sin ninguno de los dos campos, el artículo es base.
//
// El orden del array ES el orden en que se muestran.

export const HELP_SECTIONS = [
  'Primeros pasos',
  'Uso diario',
  'Gestión y avanzado',
  'Guía para el vendedor'
]

export const HELP_ARTICLES = [
  // ---------------------------------------------------------------- Primeros pasos
  {
    id: 'que-es',
    section: 'Primeros pasos',
    audience: 'owner',
    title: 'Qué es MypiCuadre y cómo funciona sin internet',
    teaser: 'La app vive en tu teléfono; no necesita conexión para operar.',
    body: [
      { p: 'MypiCuadre lleva las ventas, el inventario y el cierre de caja (el "cuadre") de tu negocio. Está pensada para funcionar al 100% SIN internet: todos los datos se guardan en tu propio teléfono.' },
      { p: 'Se instala como una app: al abrir la página, tu navegador te ofrece "Agregar a la pantalla de inicio". Una vez instalada, funciona como cualquier aplicación, incluso sin datos móviles.' },
      { tip: 'Como los datos viven en el teléfono, haz de vez en cuando un traspaso o activa la sincronización (opcional) para no perder nada si cambias de equipo.' }
    ]
  },
  {
    id: 'activar-licencia',
    section: 'Primeros pasos',
    audience: 'owner',
    title: 'Activar tu licencia',
    teaser: 'Pega el código que te dieron; se verifica sin internet.',
    body: [
      { p: 'La app necesita una licencia para abrirse. En la pantalla de activación, pega el código que te entregó el proveedor (empieza con "MYPI1...").' },
      { steps: [
        'Abre la app: verás la pantalla "Licencia de activación".',
        'Pega el código completo en el recuadro.',
        'Toca "Activar". Listo, la app se abre.'
      ] },
      { warn: 'Si tu licencia es de prueba (demo), tiene fecha de vencimiento. Cuando falten pocos días verás un aviso arriba; para seguir usándola pega una licencia nueva en Ajustes → Licencia.' }
    ]
  },
  {
    id: 'crear-dueno',
    section: 'Primeros pasos',
    audience: 'owner',
    title: 'Crear tu PIN y guardar el código de recuperación',
    teaser: 'Tu PIN es tu llave. El código de recuperación te salva si lo olvidas.',
    body: [
      { p: 'La primera vez creas tu cuenta de Dueño con un PIN. Con ese PIN entras cada vez y autorizas acciones importantes.' },
      { steps: [
        'Escribe tu nombre y elige un PIN que recuerdes.',
        'La app te muestra un CÓDIGO DE RECUPERACIÓN.',
        'Anótalo en un lugar seguro (papel, no solo en el teléfono).'
      ] },
      { warn: 'Si olvidas el PIN y NO tienes el código de recuperación, no hay forma de recuperar el acceso. Guarda ese código como guardas la llave de tu negocio.' },
      { tip: 'Puedes regenerar el código cuando quieras en Ajustes → Código de recuperación.' }
    ]
  },
  {
    id: 'monedas-tasas',
    section: 'Primeros pasos',
    audience: 'owner',
    title: 'Configurar moneda y tasas de cambio',
    teaser: 'Define cuánta MN vale cada moneda. Se edita sin internet.',
    body: [
      { p: 'La moneda base es el peso cubano (MN). Si cobras en USD o MLC, pon su tasa para que la app convierta sola.' },
      { steps: [
        'Ve a Ajustes → Tasas de cambio.',
        'En cada moneda, escribe cuánta MN vale 1 unidad (ej: 1 USD = 400 MN).',
        'Toca "Guardar". Cada cambio queda registrado con su fecha.'
      ] },
      { tip: 'Actualiza la tasa cuando cambie el mercado; las ventas viejas conservan la tasa que tenían.' }
    ]
  },
  {
    id: 'cargar-productos',
    section: 'Primeros pasos',
    audience: 'owner',
    title: 'Cargar tus productos',
    teaser: 'Agrégalos uno a uno o impórtalos desde Excel.',
    body: [
      { p: 'Para vender necesitas tu catálogo. Tienes dos caminos:' },
      { steps: [
        'Uno a uno: Catálogo → "+ Producto". Pon nombre, precio, costo y existencia inicial.',
        'En bloque: Catálogo → "⬆ Importar" y sube la plantilla de Excel con todos tus productos.'
      ] },
      { tip: 'Empieza con tus productos más vendidos; no hace falta cargar todo el primer día.' }
    ]
  },
  // ------------------------------------------------------------------- Uso diario
  {
    id: 'abrir-turno',
    section: 'Uso diario',
    audience: 'owner',
    title: 'Abrir el turno',
    teaser: 'Regla de oro: solo con el turno abierto se puede vender.',
    body: [
      { p: 'Antes de vender hay que abrir turno. La caja inicial se hereda del último cierre.' },
      { steps: [
        'Ve a Turno.',
        'Si tienes áreas, elige en cuál abres el turno.',
        'Confirma la caja inicial y ábrelo.'
      ] },
      { warn: 'Nadie puede vender sin turno abierto: ni el dueño. Con áreas, cada vendedor abre el suyo.' }
    ]
  },
  {
    id: 'vender',
    section: 'Uso diario',
    audience: 'owner',
    title: 'Vender (efectivo y transferencia)',
    teaser: 'Busca el producto, arma el carrito y cobra.',
    body: [
      { steps: [
        'Ve a Vender y busca el producto (3 letras o su código).',
        'Tócalo para agregarlo; ajusta la cantidad con − y +.',
        'Para quitar algo, usa el ícono de papelera de la línea.',
        'Elige Efectivo o Transferencia y toca "Cobrar".'
      ] },
      { p: 'En transferencia puedes pegar el SMS del banco: la app toma solos el monto y el número de operación.' },
      { tip: 'El precio se congela en cada venta: si mañana subes el precio, las ventas de hoy no cambian.' }
    ]
  },
  {
    id: 'cerrar-cuadre',
    section: 'Uso diario',
    audience: 'owner',
    title: 'Cerrar el turno (el cuadre)',
    teaser: 'Cuenta la caja y la app te dice si cuadra con un semáforo.',
    body: [
      { p: 'Al cerrar, cuentas el dinero real de la caja y la app lo compara con lo que debería haber (apertura + ventas − extracciones).' },
      { steps: [
        'Ve a Turno → "Cerrar turno".',
        'Cuenta los billetes por denominación.',
        'Revisa el semáforo y confirma el cierre.'
      ] },
      { p: 'El efectivo que dejas en caja se hereda como fondo del próximo turno; lo demás cuenta como retirado por el dueño.' }
    ]
  },
  {
    id: 'semaforo',
    section: 'Uso diario',
    audience: 'owner',
    title: 'Entender el semáforo del cuadre',
    teaser: '🟢 cuadra · 🟡 diferencia menor · 🔴 diferencia crítica.',
    body: [
      { p: 'El semáforo mide cuánto se aleja lo contado de lo esperado, en porcentaje:' },
      { steps: [
        '🟢 Verde: la diferencia está dentro de lo tolerado. Todo bien.',
        '🟡 Amarillo: diferencia pequeña. Revisa por si acaso.',
        '🔴 Rojo: diferencia grande. Hay que investigar.'
      ] },
      { tip: 'Ajusta los porcentajes tolerados en Ajustes → Semáforo del cuadre.' }
    ]
  },
  // -------------------------------------------------------- Gestión y avanzado
  {
    id: 'areas',
    section: 'Gestión y avanzado',
    audience: 'owner',
    title: 'Áreas de venta (opcional)',
    teaser: 'Divide el punto en áreas, cada una con su caja y cuadre.',
    body: [
      { p: 'Si tu negocio tiene zonas separadas (ej: Víveres y Carnicería), puedes crear áreas. Cada vendedor abre turno en un área y cobra en su propia caja.' },
      { steps: [
        'Ve a Ajustes → Áreas de venta y agrega cada una.',
        'Reparte el stock del almacén a las áreas (ver "Salida a áreas").',
        'Si no defines ninguna, el negocio opera como un solo punto.'
      ] },
      { tip: 'Quitar un área no borra sus productos ni sus ventas; solo deja de ofrecerse para nuevos turnos.' }
    ]
  },
  {
    id: 'almacen-salida',
    section: 'Gestión y avanzado',
    audience: 'owner',
    title: 'Almacén y salida a las áreas',
    teaser: 'La mercancía entra al almacén y de ahí se reparte a cada área.',
    body: [
      { p: 'Las compras entran al almacén central (Entrada de mercancía). Desde ahí envías lo que cada área va a vender.' },
      { steps: [
        'Ve a Salida a áreas.',
        'Elige el área de destino.',
        'Marca varios productos con el check y pon la cantidad de cada uno.',
        'Envía: se descuenta del almacén y suma al área.'
      ] },
      { warn: 'Un vendedor de un área solo puede vender lo que le enviaste a esa área. Si algo se agotó, hazle una nueva salida.' }
    ]
  },
  {
    id: 'conteo-fisico',
    section: 'Gestión y avanzado',
    audience: 'owner',
    title: 'Conteo físico',
    teaser: 'Cuenta lo que hay de verdad y ajusta las existencias.',
    body: [
      { p: 'El conteo físico compara lo que dice el sistema con lo que cuentas a mano, y ajusta la diferencia dejando registro.' },
      { steps: [
        'Ve a Conteo físico y elige qué ubicación cuentas (almacén o un área).',
        'Anota la cantidad real de cada producto.',
        'Envíalo; al aprobarlo, las existencias se ajustan a lo contado.'
      ] },
      { tip: 'El vendedor puede contar su área; el dueño o administrativo aprueba el conteo.' }
    ]
  },
  {
    id: 'reportes-panel',
    section: 'Gestión y avanzado',
    audience: 'owner',
    title: 'Reportes y panel del dueño',
    teaser: 'Mira ventas, caja y alertas; exporta a PDF o Excel.',
    body: [
      { p: 'El Panel del dueño resume ventas, caja y avisos del negocio. En Reportes generas documentos por período.' },
      { steps: [
        'Panel del dueño: vista rápida del día y del negocio.',
        'Reportes: elige el reporte y el rango de fechas.',
        'Exporta a PDF o Excel para guardar o compartir.'
      ] }
    ]
  },
  {
    id: 'traspaso',
    section: 'Gestión y avanzado',
    audience: 'owner',
    title: 'Traspaso de turno sin internet',
    teaser: 'Pasa el estado del negocio a otro teléfono con un archivo.',
    body: [
      { p: 'El traspaso pasa todo el estado (productos, existencias, caja a heredar, ventas y deudas) a otro vendedor, sin internet.' },
      { steps: [
        'Quien entrega: Traspaso de turno → "Compartir por WhatsApp" o "Descargar archivo".',
        'Quien recibe: en su teléfono, Traspaso de turno → carga el archivo.',
        'Revisa el resumen y confirma "Recibir turno".'
      ] },
      { tip: 'Es una de las mayores ventajas de la app: el negocio sigue aunque no haya conexión.' }
    ]
  },
  {
    id: 'cocteleria',
    section: 'Gestión y avanzado',
    audience: 'owner',
    module: LICENSE_MODULES.COCKTAILS,
    title: 'Coctelería: tragos elaborados en el área',
    teaser: 'El área hace su propio trago con su propio stock.',
    body: [
      { p: 'La coctelería es distinta de la cocina, y la diferencia está en DÓNDE ocurre. La cocina central elabora y ENVÍA el plato a un área. Un trago se elabora DENTRO del área (la terraza, el restaurante) consumiendo el stock de esa misma área, y se queda ahí, listo para venderse o para cargarlo a una mesa.' },
      { steps: [
        'Inicio → Recetas → sección "Recetas de coctelería" → "+ Nueva". Pon el nombre del trago, su precio y los insumos con lo que consume UNA unidad (ej: 0.05 L de ron, 2 hojas de menta).',
        'Manda los insumos del almacén al área con "Salida a áreas", como con cualquier otro producto. La coctelería no se abastece aparte.',
        'Si quieres que el vendedor elabore: Ajustes → "Tableros de elaboración" → activa "Tablero de coctelería para el vendedor".',
        'En el tablero: se elige el área (el vendedor trae la de su turno), se toca la receta, se pone la cantidad y "Elaborar". Los insumos bajan de esa área y el trago aparece en ella.'
      ] },
      { p: '"Puedes elaborar: N" se calcula con lo que hay en ESA área ahora mismo, no en el almacén. Si un insumo está en el almacén y no en el área, el número sale en cero: hay que hacer la salida primero.' },
      { warn: 'El vendedor necesita su TURNO ABIERTO para elaborar coctelería: el trago sale del área de su turno. Sin turno no hay área de la que consumir.' },
      { tip: 'El trago es un producto normal del catálogo: se vende por el POS o se carga a una mesa como cualquier otro. Su costo no se teclea, se deriva de los insumos que consumió.' }
    ]
  },
  {
    id: 'descubierto',
    section: 'Gestión y avanzado',
    audience: 'owner',
    modules: [LICENSE_MODULES.KITCHEN, LICENSE_MODULES.COCKTAILS],
    title: 'Existencias en negativo: por qué pasan y cómo se curan',
    teaser: 'Elaborar con faltante deja un descubierto. Se cura donde ocurrió.',
    body: [
      { p: 'Pasa un caso real: la mercancía llegó y está en la cocina, pero nadie registró la entrada todavía. Sin permiso, quien elabora se queda trabado ("no hay suficiente Harina"). Para eso está el permiso Ajustes → Tableros de elaboración → "Elaborar aunque falte algún insumo".' },
      { p: 'Con ese permiso encendido, el tablero avisa antes de confirmar —te dice qué insumo falta, cuánto hay y en cuánto quedará— y hay que marcar "Sí, elaborar de todos modos". El consumo se registra COMPLETO, así que esa existencia queda en NEGATIVO. Eso no es un error de la app: es la cuenta pendiente de registrar la entrada.' },
      { p: 'Un negativo se cura de tres formas, y las tres dejan su rastro:' },
      { steps: [
        'Dando la ENTRADA de mercancía en la MISMA ubicación donde está el negativo. Es el camino normal: si faltaban 7 y entran 20, quedan 13.',
        'Haciendo un TRASPASO hacia esa ubicación (Salida a áreas), si la mercancía ya estaba en el almacén.',
        'Con el CONTEO FÍSICO de esa ubicación: al poner lo que hay de verdad, el ajuste iguala la existencia a lo contado.'
      ] },
      { warn: 'El error más fácil de cometer: una entrada al ALMACÉN CENTRAL no cura un negativo de un ÁREA ni de la cocina. La entrada suma donde entra. Si el descubierto es de la cocina o de la terraza, hay que entrar ahí o traspasar hasta ahí.' },
      { p: 'Mientras haya un negativo, el tablero muestra "Puedes elaborar: 0" con la marca "Falta algún insumo", y el costo de lo que elabores se calcula con el costo del insumo que falta, no con cero.' },
      { tip: 'Cada elaboración en descubierto te llega como aviso en la campana (categoría Elaboración), con qué insumo, en qué ubicación y quién la hizo. Si no quieres esos avisos, se apagan en Ajustes → Notificaciones; si prefieres que nadie pueda elaborar sin existencia, apaga el permiso y todo vuelve a bloquearse como antes.' }
    ]
  },
  {
    id: 'ficha-que-es',
    section: 'Gestión y avanzado',
    audience: 'owner',
    module: LICENSE_MODULES.COSTSHEETS,
    title: 'Qué es la ficha de costos y gastos',
    teaser: 'El documento con el que sostienes tu precio ante un control.',
    body: [
      { p: 'La ficha de costos y gastos es el documento de la Resolución 148/2023 del Ministerio de Finanzas y Precios. La Resolución la declara de confección obligatoria —también para un actor no estatal y con independencia del método que uses para formar los precios— para la evaluación de precios y tarifas mayoristas.' },
      { warn: 'A quién le aplica lo dice el Artículo 2, y conviene leerlo: el alcance es para los actores económicos que sean PRODUCTORES, prestadores de servicios técnico-productivos, elaboradores de ofertas gastronómicas, y los que presten otros servicios minoristas "que así lo requieran". Si tu negocio solo REVENDE lo que compra, no está claramente dentro de ese alcance. La app no decide eso por ti: te da la ficha para cuando la necesites.' },
      { p: 'La app la arma reutilizando lo que ya tienes: tu catálogo, tus costos y tus existencias. Tú capturas lo que falta (el salario, los gastos indirectos, los tributos) y ella calcula las 16 filas del modelo oficial y te propone el precio.' },
      { warn: 'La ficha NO cambia ningún precio de tu catálogo. Es un documento de análisis: te dice a cuánto deberías vender, y decidir es tuyo. Si quieres aplicar el precio, lo cambias tú en Precios como siempre.' },
      { p: 'La ficha tiene tres controles de la norma, y los tres AVISAN, nunca te bloquean: el límite de gastos indirectos del Art. 9, la tasa máxima de utilidad del Anexo II y el aviso de subsidio si formas el precio por correlación y queda por debajo de tus costos. Un actor no estatal puede ajustar el modelo a sus características (Art. 6), así que la app te dice por cuánto te pasas y tú decides.' },
      { tip: 'Solo el dueño y el administrativo ven las fichas: exponen tus costos y tu ganancia.' }
    ]
  },
  {
    id: 'ficha-llenar',
    section: 'Gestión y avanzado',
    audience: 'owner',
    module: LICENSE_MODULES.COSTSHEETS,
    title: 'Llenar una ficha, aprobarla y presentarla',
    teaser: 'Nueve bloques, y el precio unitario siempre a la vista.',
    body: [
      { p: 'La ficha se llena por bloques, uno abierto a la vez, y el precio unitario vive fijo en la barra de abajo: se mueve mientras escribes.' },
      { steps: [
        'Inicio → Fichas de costo → "+ Nueva ficha". Elige el producto de tu catálogo (o escribe un nombre, si es un servicio), el tipo de actividad y el método. Pon el NIVEL DE PRODUCCIÓN: es cuántas unidades cubre esta ficha.',
        'Bloque 2, gasto material: trae los insumos de tu catálogo (vienen con su costo ya puesto, y lo puedes cambiar) y anota el combustible, la corriente y el agua, que no son productos.',
        'Bloque 3, salario: una tarjeta por operación. Si una misma operación lleva tiempos o grupos escala distintos, usa "Otra norma de tiempo": la norma exige que vayan en filas separadas.',
        'Bloques 4 a 6: los otros gastos directos, los indirectos y los financieros y tributarios.',
        'Bloque 7: ahí ves la base de la utilidad y el precio. Bloque 8: los precios de referencia que respaldan tu número.',
        'Bloque 9: firma, aprueba y descarga el documento.'
      ] },
      { warn: 'Las normas de consumo del bloque 2 son las del NIVEL DE PRODUCCIÓN completo, no las de una unidad. Si tu ficha es de 200 panes, ahí van los 25 kg de harina de los 200 panes. Si cambias el nivel después, hay que revisarlas.' },
      { p: 'Al aprobar, la ficha queda INMUTABLE: es el documento con el que sostuviste ese precio. Para corregirla se crea una revisión nueva, que hereda la anterior como "Costo Base" y conserva la vieja entera. Nada se borra.' },
      { p: 'La exportación está en el bloque 9. Son TRES hojas y cada una se descarga por separado, en PDF o en Excel: la ficha de 16 filas, el anexo de los insumos y el anexo del salario. Cada hoja lleva su encabezado y su pie de firmas, así que se sostiene sola.' },
      { tip: 'La Resolución obliga a MOSTRAR LAS BASES del precio ante un control, una negociación o una concertación: no basta con tenerlo calculado en el teléfono. Descarga las tres hojas y guárdalas.' }
    ]
  },
  {
    id: 'roles',
    section: 'Gestión y avanzado',
    audience: 'owner',
    title: 'Roles: Dueño, Administrativo y Vendedor',
    teaser: 'Cada rol ve y hace solo lo que le corresponde.',
    body: [
      { p: 'Dueño: hace todo, incluida licencia, usuarios y sincronización.' },
      { p: 'Administrativo: opera como un dueño en inventario y supervisión (entradas/salidas, autorizar al vendedor, aprobar conteos, ver reportes y costos), pero NO gestiona usuarios, licencia ni sincronización.' },
      { p: 'Vendedor: solo vende, extrae caja y registra deuda interna (estas dos con autorización). No cambia precios ni ve costos.' },
      { tip: 'Crea y ajusta usuarios en la pantalla Usuarios.' }
    ]
  },
  {
    id: 'licencia-vence',
    section: 'Gestión y avanzado',
    audience: 'owner',
    title: 'Renovar la licencia cuando vence',
    teaser: 'Pega la licencia nueva en Ajustes; sigues sin perder datos.',
    body: [
      { steps: [
        'Cuando falten pocos días verás un aviso arriba.',
        'Pide tu licencia nueva al proveedor.',
        'Ve a Ajustes → Licencia de activación y pega el código.'
      ] },
      { warn: 'Si la fecha de tu teléfono está atrasada, la app te lo avisa: ajústala para que la licencia funcione bien.' }
    ]
  },
  // ------------------------------------------------------ Guía para el vendedor
  {
    id: 'v-entrar',
    section: 'Guía para el vendedor',
    audience: 'seller',
    title: 'Entrar con tu PIN',
    teaser: 'Cada vendedor entra con su propio PIN.',
    body: [
      { steps: [
        'Abre la app y elige tu nombre.',
        'Escribe tu PIN.',
        'Ya estás dentro, listo para tu turno.'
      ] }
    ]
  },
  {
    id: 'v-turno',
    section: 'Guía para el vendedor',
    audience: 'seller',
    title: 'Abrir tu turno',
    teaser: 'Sin turno abierto no puedes vender.',
    body: [
      { steps: [
        'Ve a Turno.',
        'Si hay áreas, elige la tuya.',
        'Confirma la caja inicial y ábrelo.'
      ] }
    ]
  },
  {
    id: 'v-vender',
    section: 'Guía para el vendedor',
    audience: 'seller',
    title: 'Vender',
    teaser: 'Busca, agrega al carrito y cobra.',
    body: [
      { steps: [
        'Ve a Vender y busca el producto.',
        'Tócalo y ajusta la cantidad con − y +.',
        'Para quitar algo, toca la papelera de la línea.',
        'Elige Efectivo o Transferencia y cobra.'
      ] }
    ]
  },
  {
    id: 'v-cerrar',
    section: 'Guía para el vendedor',
    audience: 'seller',
    title: 'Cerrar tu turno',
    teaser: 'Cuenta tu caja al terminar.',
    body: [
      { steps: [
        'Ve a Turno → "Cerrar turno".',
        'Cuenta los billetes por denominación.',
        'Revisa el semáforo y confirma.'
      ] },
      { tip: 'Si necesitas sacar dinero o anotar una deuda, pide autorización al dueño o administrativo.' }
    ]
  }
]

// Filtro de visibilidad de un artículo: rol Y licencia. ES LA UNICA FUENTE, y por eso
// vive aquí: hasta ahora este predicado estaba COPIADO literalmente en `HelpScreen` y
// en `helpPdf`, que es la peor forma de mantener una regla que impide una fuga de
// licencia (basta con actualizar una copia y olvidar la otra para colar por el PDF una
// función que el negocio no compró).
//
//  - rol: el mando ve todo; el vendedor solo lo suyo.
//  - `module`: exige ESE módulo. `modules`: basta con UNO de la lista.
//  - `modules` llega VACIO por defecto a propósito: quien llame sin pasarlo OCULTA la
//    ayuda de los módulos en vez de colarla. Es el lado seguro.
export function isArticleVisible(a, { isManager = true, modules = [] } = {}) {
  if (!a) return false
  if (!isManager && a.audience !== 'seller') return false
  if (a.module && !modules.includes(a.module)) return false
  if (a.modules && !a.modules.some((m) => modules.includes(m))) return false
  return true
}

export function visibleArticles({ isManager = true, modules = [] } = {}) {
  return HELP_ARTICLES.filter((a) => isArticleVisible(a, { isManager, modules }))
}
