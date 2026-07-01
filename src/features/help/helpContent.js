// Material de ayuda de MypiCuadre (Fase A). Contenido como DATOS editables para
// poder retocar los textos sin tocar la interfaz. Cada artículo:
//   { id, section, audience, icon, title, teaser, body:[bloques] }
// Bloques soportados por HelpScreen: { p } párrafo · { steps:[...] } pasos
//   numerados · { tip } consejo (verde) · { warn } aviso (amarillo).
//
// audience: 'owner'  -> lo ve el dueño/administrativo (recorrido principal)
//           'seller' -> guía corta para el vendedor (el dueño también la ve)
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
    icon: '📱',
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
    icon: '🔑',
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
    icon: '🧑‍💼',
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
    icon: '💱',
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
    icon: '📦',
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
    icon: '📖',
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
    icon: '🛒',
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
    icon: '🧮',
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
    icon: '🚦',
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
    icon: '🏬',
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
    icon: '🚚',
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
    icon: '📋',
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
    icon: '📊',
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
    icon: '🔄',
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
    id: 'roles',
    section: 'Gestión y avanzado',
    audience: 'owner',
    icon: '👥',
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
    icon: '⏳',
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
    icon: '🔓',
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
    icon: '📖',
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
    icon: '🛒',
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
    icon: '🧮',
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
