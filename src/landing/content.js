// Contenido centralizado para la landing page de MypiCuadre

export const LANDING_CONTENT = {
  // Hero
  hero: {
    heading: "Gestión de caja en la palma de tu mano. Sin internet. Sin complicaciones.",
    subheading: "MypiCuadre: la app diseñada para pequeños negocios cubanos. Controla ventas, inventario y caja desde cualquier lugar, incluso sin conexión.",
    cta_primary: "Descargar gratis",
    cta_secondary: "Ver demo",
  },

  // Problem Section
  problem: {
    heading: "Los comerciantes cubanos enfrentan retos únicos",
    items: [
      {
        icon: "signal-slash",
        title: "Conexión inestable",
        description: "Internet nulo o intermitente en el punto de venta",
      },
      {
        icon: "chart-no-axes-combined",
        title: "Dificultad para controlar",
        description: "Caja, ventas y rotación en tiempo real",
      },
      {
        icon: "hard-drive",
        title: "Pérdida de datos",
        description: "Si el teléfono falla, todo se va",
      },
      {
        icon: "coins",
        title: "Multi-moneda compleja",
        description: "MN, USD, MLC en las mismas transacciones",
      },
      {
        icon: "users",
        title: "Coordinación sin sincronización",
        description: "Vendedores trabajando sin conexión real",
      },
      {
        icon: "clock",
        title: "Cierre manual lento",
        description: "Propenso a errores y demoras",
      },
    ],
  },

  // Solution Section
  solution: {
    heading: "MypiCuadre: La solución pensada para ti",
    items: [
      "100% offline: funciona sin internet. Sincroniza automáticamente cuando hay conexión.",
      "Datos seguros en tu celular: IndexedDB local, encriptación de licencias",
      "Multi-moneda: MN, USD, MLC en la misma transacción",
      "Gestión completa: ventas, caja, inventario, turnos, usuarios con roles",
      "Reportes y análisis: PDF y Excel para auditoría y decisiones",
      "Sincronización en la nube: opcional, segura con Firebase",
    ],
  },

  // Features
  features: {
    heading: "Características principales",
    items: [
      {
        icon: "shopping-cart",
        title: "Punto de venta rápido",
        description: "Captura ventas en segundos, incluso sin conexión",
      },
      {
        icon: "wallet",
        title: "Gestión de caja",
        description: "Cuadre automatizado con semáforo 🟢/🟡/🔴",
      },
      {
        icon: "box",
        title: "Control de inventario",
        description: "Conteo físico, entradas, auditoría de stock",
      },
      {
        icon: "users-cog",
        title: "Múltiples usuarios",
        description: "Vendedores con PIN, roles y turnos diferenciados",
      },
      {
        icon: "cloud-sync",
        title: "Sincronización",
        description: "Conecta varios dispositivos, sincroniza al reconectar",
      },
      {
        icon: "file-chart-column",
        title: "Reportes y análisis",
        description: "Exporta PDF/Excel, dashboards de ganancias y rotación",
      },
    ],
  },

  // Demo
  demo: {
    heading: "Mira cómo funciona MypiCuadre",
    subheading: "En pocos segundos, entenderás por qué miles de comerciantes confían en nosotros",
    screenshots: [
      { id: 1, title: "Login por PIN", description: "Acceso seguro en segundos" },
      { id: 2, title: "Punto de venta", description: "Vende rápido y sin errores" },
      { id: 3, title: "Apertura de turno", description: "Comienza con tu capital" },
      { id: 4, title: "Cuadre de caja", description: "Cierra en minutos" },
      { id: 5, title: "Dashboard", description: "Ve tus ganancias en tiempo real" },
    ],
  },

  // Testimonials
  testimonials: {
    heading: "Lo que dicen nuestros usuarios",
    items: [
      {
        name: "Luis González",
        business: "Bodega Habana Vieja",
        text: "Ahora sé exactamente cuánto vendí en el día. MypiCuadre cambió mi negocio.",
        emoji: "🛒",
      },
      {
        name: "Ana Martínez",
        business: "Tienda Centro",
        text: "Sin internet sigue funcionando. Eso es lo que me enamoró de la app.",
        emoji: "💚",
      },
      {
        name: "Carlos Rodríguez",
        business: "Comercio Vedado",
        text: "Los reportes en PDF me ayudan a entender mi negocio mejor cada día.",
        emoji: "📊",
      },
    ],
  },

  // Pricing
  pricing: {
    heading: "Elige tu plan",
    items: [
      {
        name: "Demo",
        period: "14 días gratis",
        price: null,
        features: [
          "Acceso completo",
          "1 dispositivo",
          "Datos de prueba",
        ],
        cta: "Empezar demo",
      },
      {
        name: "Mensual",
        period: "Renovación automática",
        price: "9.99",
        currency: "USD",
        features: [
          "Acceso completo",
          "Datos reales",
          "Hasta 2 dispositivos",
          "Soporte por email",
        ],
        cta: "Contratar ahora",
        highlighted: true,
      },
      {
        name: "Perpetua",
        period: "Pago único",
        price: "99.99",
        currency: "USD",
        features: [
          "Acceso de por vida",
          "Dispositivos ilimitados",
          "Soporte prioritario",
          "Actualizaciones futuras",
        ],
        cta: "Comprar ahora",
      },
    ],
  },

  // FAQ
  faq: {
    heading: "Preguntas frecuentes",
    items: [
      {
        q: "¿Necesito internet para usar MypiCuadre?",
        a: "No. MypiCuadre funciona 100% sin conexión a internet. Los datos se guardan en tu teléfono y se sincronizan automáticamente cuando hay conexión.",
      },
      {
        q: "¿Qué pasa si pierdo mi teléfono?",
        a: "Puedes activar el plan Mensual o Perpetua con sincronización en la nube (Firebase). Tus datos estará seguros en múltiples dispositivos.",
      },
      {
        q: "¿Cómo comparto datos entre vendedores?",
        a: "Cada vendedor accede con su PIN. La sincronización en la nube permite que todos vean datos actualizados sin necesidad de internet.",
      },
      {
        q: "¿Qué monedas soporta?",
        a: "MypiCuadre soporta MN (Moneda Nacional), USD (Dólares) y MLC (Moneda Libremente Convertible). Puedes cambiar tasas según necesites.",
      },
      {
        q: "¿Puedo exportar mis datos?",
        a: "Sí. Exporta ventas, inventario y reportes en PDF o Excel en cualquier momento.",
      },
      {
        q: "¿Hay aplicación de escritorio?",
        a: "Por ahora solo disponible para Android. Es una PWA instalable que funciona como app nativa.",
      },
    ],
  },

  // CTA Final
  cta_final: {
    heading: "¿Listo para mejorar tu negocio?",
    subheading: "Miles de comerciantes cubanos ya confían en MypiCuadre. ¿Será el tuyo el próximo?",
    cta: "Activar MypiCuadre ahora",
  },

  // Footer
  footer: {
    tagline: "Gestión de caja moderna para pequeños negocios cubanos.",
    links: {
      legal: [
        { label: "Política de privacidad", href: "#" },
        { label: "Términos de uso", href: "#" },
      ],
      social: [
        { label: "Facebook", href: "https://facebook.com", icon: "facebook" },
        { label: "Instagram", href: "https://instagram.com", icon: "instagram" },
        { label: "WhatsApp", href: "https://whatsapp.com", icon: "message-circle" },
      ],
    },
    contact: "contacto@mypicuadre.com",
  },
};
