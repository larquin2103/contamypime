// Pruebas PURAS de la regla de cierre de un modal por su fondo.
// Sin framework: ejecutar con  `node src/lib/modalClose.test.mjs`.
//
// QUE EXISTE ESTA SUITE PARA CAZAR: que un gesto que NO es un intento de cerrar
// cierre el modal y se lleve por delante lo que el usuario estaba escribiendo.
// El caso real que lo destapo: seleccionar con el raton el valor de un campo y
// soltar el boton un poco mas alla del borde del recuadro. El navegador dispara
// el `click` sobre el ANCESTRO COMUN de donde empezo y termino el gesto -o sea,
// el fondo- y el `stopPropagation` del contenido no lo frena, porque el evento
// no viene de dentro: nace en el fondo.
import { shouldCloseOnBackdrop, backdropProps } from './modalClose.js'

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return }
  fail++
  console.error(`FAIL ${label}\n  esperado: ${expected}\n  obtenido: ${actual}`)
}
const ok = (cond, label) => eq(!!cond, true, label)
const no = (cond, label) => eq(!!cond, false, label)

// Atajo legible: el gesto completo, tal y como lo ve el fondo.
const gesto = (empezoEnElFondo, terminoEnElFondo, cierraPorElFondo = true) =>
  shouldCloseOnBackdrop({
    closeOnBackdrop: cierraPorElFondo,
    startedOnBackdrop: empezoEnElFondo,
    targetIsBackdrop: terminoEnElFondo
  })

{
  // 1) EL COMPORTAMIENTO QUE SE CONSERVA: pinchar en el fondo cierra.
  ok(gesto(true, true), '1) clic limpio en el fondo: cierra, como siempre')
}
{
  // 2) EL FALLO QUE SE CORRIGE: el gesto empezo DENTRO del modal.
  no(gesto(false, true), '2) arrastrar desde dentro y soltar fuera NO cierra')
}
{
  // 3) Un clic dentro del modal nunca cierra. Hoy lo impide el `stopPropagation`
  //    del contenido; esta guarda es la segunda linea y no depende de el.
  no(gesto(true, false), '3) el clic termina DENTRO del modal: no cierra')
  no(gesto(false, false), '3) empieza y termina dentro: no cierra')
}
{
  // 4) FORMULARIOS: el fondo no cierra, haga el usuario el gesto que haga. Es la
  //    decision del dueño para los 22 modales con campos: se sale por Cancelar,
  //    por la X o con Escape, nunca por un clic fuera que borre lo tecleado.
  no(gesto(true, true, false), '4) formulario: ni siquiera el clic limpio cierra')
  no(gesto(false, true, false), '4) formulario: el arrastre tampoco')
  no(gesto(true, false, false), '4) formulario: un clic dentro tampoco')
}
{
  // 5) Robustez: se llama en CADA clic de la aplicacion que caiga en un fondo,
  //    asi que no puede reventar ni inventarse un cierre con datos incompletos.
  //    El lado seguro es NO cerrar: como mucho el usuario cierra con el boton.
  no(shouldCloseOnBackdrop(), '5) sin argumentos no cierra y no revienta')
  no(shouldCloseOnBackdrop(null), '5) null no cierra')
  no(shouldCloseOnBackdrop({}), '5) objeto vacio no cierra')
  no(shouldCloseOnBackdrop({ closeOnBackdrop: true }), '5) sin datos del gesto no cierra')
  no(shouldCloseOnBackdrop({ closeOnBackdrop: true, targetIsBackdrop: true }),
    '5) sin saber donde empezo el gesto NO cierra (es justo el caso del arrastre)')
  ok(shouldCloseOnBackdrop({ closeOnBackdrop: true, startedOnBackdrop: true, targetIsBackdrop: true }),
    '5) con los tres datos completos, cierra')
}
{
  // 6) `closeOnBackdrop` ausente = cierra por el fondo, que es el comportamiento
  //    CLASICO: un modal que no diga nada se sigue portando como hasta hoy.
  ok(shouldCloseOnBackdrop({ startedOnBackdrop: true, targetIsBackdrop: true }),
    '6) sin declarar la opcion, el fondo cierra (comportamiento clasico)')
}
{
  // 7) Valores que no son booleanos (llegan de expresiones de la pantalla).
  no(gesto(0, 1), '7) empezo dentro expresado como 0: no cierra')
  ok(gesto(1, 1), '7) valores verdaderos no booleanos: cierra')
  no(shouldCloseOnBackdrop({ closeOnBackdrop: 0, startedOnBackdrop: 1, targetIsBackdrop: 1 }),
    '7) closeOnBackdrop falsy: no cierra')
}

// ---------------------------------------------------------------------------
// 8) LOS MANEJADORES REALES que se enchufan al fondo. Se prueban con eventos
// simulados -no con React- porque `backdropProps` no es un hook: la marca del
// gesto vive en el propio nodo del fondo (`dataset`), que es justo donde ocurre.
// Eso permite probar el comportamiento COMPLETO aqui, y no solo la regla.
{
  // Un fondo de mentira con su recuadro dentro, como el DOM de verdad.
  const nuevoFondo = () => {
    const fondo = { dataset: {} }
    const dentro = { id: 'campo' }
    return { fondo, dentro }
  }
  const ev = (fondo, target) => ({ currentTarget: fondo, target })

  {
    // Aviso (comportamiento clasico): apretar y soltar en el fondo cierra.
    const { fondo } = nuevoFondo()
    let cerrado = 0
    const p = backdropProps(() => { cerrado++ })
    p.onMouseDown(ev(fondo, fondo))
    p.onClick(ev(fondo, fondo))
    eq(cerrado, 1, '8) aviso: clic limpio en el fondo cierra')
  }
  {
    // EL CASO DEL DUEÑO: se aprieta dentro del campo y se suelta fuera.
    const { fondo, dentro } = nuevoFondo()
    let cerrado = 0
    const p = backdropProps(() => { cerrado++ })
    p.onMouseDown(ev(fondo, dentro))   // el mousedown burbujea desde el campo
    p.onClick(ev(fondo, fondo))        // el click nace en el fondo
    eq(cerrado, 0, '8) arrastrar desde un campo y soltar fuera NO cierra')
  }
  {
    // Formulario: ni el clic limpio cierra.
    const { fondo } = nuevoFondo()
    let cerrado = 0
    const p = backdropProps(() => { cerrado++ }, { form: true })
    p.onMouseDown(ev(fondo, fondo))
    p.onClick(ev(fondo, fondo))
    eq(cerrado, 0, '8) formulario: el fondo no cierra ni con un clic limpio')
  }
  {
    // LA MARCA NO SE HEREDA: tras un arrastre que no cerro, el siguiente clic
    // limpio SI tiene que cerrar. Sin limpiar la marca, el modal se quedaria
    // pegado y el usuario creeria que el fondo dejo de funcionar.
    const { fondo, dentro } = nuevoFondo()
    let cerrado = 0
    const p = backdropProps(() => { cerrado++ })
    p.onMouseDown(ev(fondo, dentro))
    p.onClick(ev(fondo, fondo))
    eq(cerrado, 0, '8) primer gesto (arrastre): no cierra')
    p.onMouseDown(ev(fondo, fondo))
    p.onClick(ev(fondo, fondo))
    eq(cerrado, 1, '8) el clic siguiente SI cierra: la marca no se hereda')
  }
  {
    // Y al reves: un clic limpio no deja la marca puesta para un arrastre luego.
    const { fondo, dentro } = nuevoFondo()
    let cerrado = 0
    const p = backdropProps(() => { cerrado++ })
    p.onMouseDown(ev(fondo, fondo)); p.onClick(ev(fondo, fondo))
    p.onMouseDown(ev(fondo, dentro)); p.onClick(ev(fondo, fondo))
    eq(cerrado, 1, '8) tras cerrar, un arrastre posterior no vuelve a cerrar')
  }
  {
    // Un click SIN mousedown previo (gesto raro o sintetico) no cierra: es el
    // lado seguro, porque no se puede saber donde empezo.
    const { fondo } = nuevoFondo()
    let cerrado = 0
    const p = backdropProps(() => { cerrado++ })
    p.onClick(ev(fondo, fondo))
    eq(cerrado, 0, '8) click sin mousedown previo no cierra')
  }
  {
    // El clic cae DENTRO del recuadro (hoy lo para el stopPropagation de cada
    // modal; esta guarda no depende de que los treinta lo tengan).
    const { fondo, dentro } = nuevoFondo()
    let cerrado = 0
    const p = backdropProps(() => { cerrado++ })
    p.onMouseDown(ev(fondo, fondo))
    p.onClick(ev(fondo, dentro))
    eq(cerrado, 0, '8) el clic termina dentro del recuadro: no cierra')
  }
  {
    // La marca se guarda en el nodo y se limpia: no deja basura en el DOM.
    const { fondo } = nuevoFondo()
    const p = backdropProps(() => {})
    p.onMouseDown(ev(fondo, fondo))
    ok(Object.keys(fondo.dataset).length > 0, '8) el mousedown deja la marca en el nodo')
    p.onClick(ev(fondo, fondo))
    eq(Object.keys(fondo.dataset).length, 0, '8) al terminar el clic la marca se borra')
  }
  {
    // Sin funcion de cierre no revienta (un modal que aun no la tenga cableada).
    const { fondo } = nuevoFondo()
    const p = backdropProps(undefined)
    p.onMouseDown(ev(fondo, fondo))
    p.onClick(ev(fondo, fondo))
    ok(true, '8) sin onClose no revienta')
  }
  {
    // DOS modales a la vez (en la app son hermanos, no anidados): cada fondo
    // lleva SU marca, asi que el gesto de uno no puede cerrar el otro.
    const a = nuevoFondo(), b = nuevoFondo()
    let ca = 0, cb = 0
    const pa = backdropProps(() => { ca++ }), pb = backdropProps(() => { cb++ })
    pa.onMouseDown(ev(a.fondo, a.dentro))     // en A empieza dentro
    pb.onMouseDown(ev(b.fondo, b.fondo))      // en B empieza en el fondo
    pa.onClick(ev(a.fondo, a.fondo))
    pb.onClick(ev(b.fondo, b.fondo))
    eq(ca, 0, '8) dos modales a la vez: el arrastre de A no cierra A')
    eq(cb, 1, '8) dos modales a la vez: el clic limpio de B si cierra B')
  }
}

console.log(`${pass} pass, ${fail} fail`)
if (fail) process.exit(1)
