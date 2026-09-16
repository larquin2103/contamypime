// ---------------------------------------------------------------------------
// CIERRE DE UN MODAL POR SU FONDO. Regla PURA y sin React: por eso tiene su
// suite propia (`modalClose.test.mjs`), como `orderTotals` o `stockLocation`.
// El hook que la usa vive en `useBackdropClose.js`.
//
// EL FALLO QUE CORRIGE, reportado por el dueño: estaba seleccionando con el
// raton el valor de un campo (la cantidad) y al soltar, el formulario se cerro y
// se perdio todo lo escrito.
//
// POR QUE PASABA. Los treinta modales de la app se montan igual: un fondo con
// `onClick` que cierra y, dentro, el recuadro con `stopPropagation`. Esa parada
// protege el clic normal de dentro, pero NO el gesto que empieza dentro y
// termina fuera: el navegador dispara el `click` sobre el ANCESTRO COMUN de
// donde se apreto el boton y donde se solto, y ese ancestro es el propio fondo.
// El evento no viene de dentro -nace en el fondo-, asi que no hay nada que
// detener. Seleccionar texto arrastrando un poco mas alla del borde equivalia a
// pulsar "cerrar".
//
// LAS DOS REGLAS, y por que son dos:
//  1. `startedOnBackdrop` — cerrar solo si el gesto EMPEZO en el fondo. Esto
//     mata el caso del arrastre sin preguntar nada al usuario: seleccionar texto
//     nunca fue una intencion de cerrar, y avisarlo con un cartel seria tratar
//     como error algo que el usuario hizo bien.
//  2. `closeOnBackdrop` — los modales CON CAMPOS no se cierran por el fondo en
//     absoluto (decision del dueño, 16-09-2026). Se sale por Cancelar, por la X
//     o con Escape. Se descarto detectar "hay cambios sin guardar" para
//     preguntar: sin tocar la logica de cada formulario solo se puede adivinar
//     desde fuera, y en esta app hay datos que se introducen SIN escribir en un
//     campo -el PIN es un teclado de botones, los insumos de una receta se
//     marcan, las escalas de precio se añaden con un boton-, asi que la
//     adivinanza tendria huecos y prometeria una proteccion que no da. Los
//     modales de aviso conservan el cierre por el fondo: ahi no hay nada que
//     perder y quitarlo solo estorbaria.
//
// `targetIsBackdrop` es la tercera condicion y es defensa en profundidad: el
// clic tiene que haber caido en el fondo y no en el recuadro. Hoy eso ya lo
// garantiza el `stopPropagation` de cada modal, pero esta regla no depende de
// que los treinta lo tengan.
//
// Ante datos incompletos NO cierra: el lado seguro es dejar el modal abierto
// -el usuario cierra con el boton- y nunca tirar lo que estaba escribiendo.
export function shouldCloseOnBackdrop(gesture) {
  if (!gesture) return false
  const { closeOnBackdrop = true, startedOnBackdrop, targetIsBackdrop } = gesture
  if (!closeOnBackdrop) return false
  if (!targetIsBackdrop) return false
  if (!startedOnBackdrop) return false
  return true
}

// Los dos manejadores que se enchufan al FONDO de un modal. NO es un hook: la
// marca del gesto vive en el propio nodo del fondo (`dataset`), que es donde
// ocurre el gesto. Por eso se puede llamar en cualquier sitio -dentro de un
// `&&`, de un `map`, de un componente anidado- sin las reglas de los hooks, el
// cambio en cada pantalla es de UNA linea, y el comportamiento completo se
// puede probar con node sin React (ver la tanda 8 de la suite).
//
//   <div className="modal-backdrop" {...backdropProps(onClose)}>              // aviso
//   <div className="modal-backdrop" {...backdropProps(onClose, { form: true })}>  // formulario
//
// Sin `form` el modal se porta como siempre: el fondo cierra. Un modal que no
// diga nada no cambia de conducta.
//
// `onMouseDown` va en el fondo y no en `document`: el evento burbujea desde
// donde se apreto el boton, asi que comparar el objetivo con el propio fondo ya
// dice si el gesto empezo en el fondo o dentro del recuadro.
//
// La marca se BORRA al terminar el clic, cierre o no: si se quedara puesta, el
// gesto siguiente heredaria el veredicto del anterior y el modal se quedaria
// pegado (o cerraria cuando no debia). Hay dos pruebas dedicadas a eso.
const MARCA = 'backdropGestureStart'

export function backdropProps(onClose, { form = false } = {}) {
  return {
    onMouseDown: (e) => {
      e.currentTarget.dataset[MARCA] = String(e.target === e.currentTarget)
    },
    onClick: (e) => {
      const cerrar = shouldCloseOnBackdrop({
        closeOnBackdrop: !form,
        startedOnBackdrop: e.currentTarget.dataset[MARCA] === 'true',
        targetIsBackdrop: e.target === e.currentTarget
      })
      delete e.currentTarget.dataset[MARCA]
      if (cerrar && onClose) onClose()
    }
  }
}
