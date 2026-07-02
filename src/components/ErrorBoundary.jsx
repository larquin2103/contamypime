import { Component } from 'react'
import { logError } from '../lib/errorLog'

// Bloque 33 - Barrera global de errores de render. Sin esto, cualquier
// excepcion al pintar deja la pantalla EN BLANCO a mitad de un turno. Aqui se
// muestra un aviso en español, se registra el error en el log local y se
// ofrece reiniciar (los datos estan a salvo en IndexedDB).
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    logError('react', error, { stack: `${error?.stack || ''}\n${info?.componentStack || ''}` })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="screen screen--centered">
        <div className="card" style={{ maxWidth: '420px', textAlign: 'center' }}>
          <h2>⚠️ Ocurrió un error</h2>
          <p className="muted">
            La app tuvo un problema inesperado. Tus datos están a salvo en este dispositivo.
            El detalle quedó guardado en Ajustes → Registro de errores.
          </p>
          <p className="error" style={{ fontSize: '0.85em', wordBreak: 'break-word' }}>
            {String(this.state.error?.message || this.state.error)}
          </p>
          <button className="btn btn--primary btn--block" onClick={() => window.location.reload()}>
            Reiniciar la app
          </button>
        </div>
      </div>
    )
  }
}
