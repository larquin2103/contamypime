import { Component } from 'react'
import { logError } from '../../lib/errorLog'

// ---------------------------------------------------------------------------
// R3 - Aísla la campana de notificaciones. La campana es ACCESORIA: si algo falla
// al pintarla, NO debe tumbar la app del mando (a diferencia del ErrorBoundary
// GLOBAL, que muestra la pantalla de error y ofrece reiniciar).
//
// Si falla:
//  - se OCULTA la campana (render null),
//  - se REGISTRA el error en el log local (visible en Ajustes → Registro de errores),
//  - la aplicación SIGUE funcionando con normalidad.
// ---------------------------------------------------------------------------
export class NotificationBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error, info) {
    logError('notif-ui', error, { stack: `${error?.stack || ''}\n${info?.componentStack || ''}` })
  }

  render() {
    // Oculta la campana ante un fallo; la app continúa sin interrupción.
    if (this.state.failed) return null
    return this.props.children
  }
}
