import { useEffect } from 'react'

// Cierra un modal con la tecla Escape (accesibilidad de dialogos). Si el modal
// no esta abierto, el cierre es un no-op (React no re-renderiza al repetir el
// mismo estado), asi que se puede llamar sin condicionar el hook.
export function useEscapeClose(onClose) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
}
