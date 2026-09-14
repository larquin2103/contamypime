import { Children, cloneElement, isValidElement, useState } from 'react'
import { ChevronDown } from 'lucide-react'

// ---------------------------------------------------------------------------
// Acordeon reutilizable: una lista de secciones plegables de las que solo hay
// UNA abierta a la vez. Nacio para el menu de Inicio -que con todos los modulos
// comprados llega a siete categorias y dos docenas de tarjetas, y se hacia
// interminable-, pero NO sabe nada de Inicio: recibe secciones y las pliega. La
// idea es reusarlo tal cual donde haga falta agrupar una lista larga (por
// ejemplo, las elaboraciones del tablero agrupadas por fecha).
//
// REGLA DE ALCANCE: con UNA sola seccion no se pliega nada. Un cocinero ve dos
// tarjetas; obligarle a un toque para abrirlas seria empeorarle la pantalla. La
// seccion se pinta entonces igual que siempre, sin cabecera que tocar.
//
// La seccion abierta se recuerda en localStorage (opcional, `storageKey`): es
// preferencia LOCAL del dispositivo, como el tema en `lib/theme.js`. No viaja a
// la nube ni toca ningun dato del negocio, y si el almacenamiento no esta
// disponible se degrada a "todo cerrado" sin romper nada.
// ---------------------------------------------------------------------------

function readOpen(key) {
  if (!key) return null
  try {
    return localStorage.getItem(`mc_acc_${key}`) || null
  } catch {
    return null
  }
}

function writeOpen(key, id) {
  if (!key) return
  try {
    if (id) localStorage.setItem(`mc_acc_${key}`, id)
    else localStorage.removeItem(`mc_acc_${key}`)
  } catch {
    /* almacenamiento no disponible: se pierde el recuerdo, nada mas */
  }
}

export function Accordion({ storageKey = null, children }) {
  // `toArray` descarta null/false/undefined, que es justo lo que devuelven las
  // secciones gateadas por licencia o por rol: aqui solo llegan las que existen.
  const items = Children.toArray(children).filter(isValidElement)
  const [openId, setOpenId] = useState(() => readOpen(storageKey))

  // Una sola seccion (o ninguna): sin plegar, exactamente como antes.
  if (items.length <= 1) return items

  // La recordada puede haber dejado de existir (se quito un modulo, cambio el
  // rol): si no esta entre las de ahora, se arranca con todo cerrado en vez de
  // dejar un estado imposible.
  const valid = items.some((it) => it.props?.id === openId)
  const current = valid ? openId : null

  const toggle = (id) => {
    const next = current === id ? null : id
    setOpenId(next)
    writeOpen(storageKey, next)
  }

  return (
    <div className="acc">
      {items.map((item) =>
        cloneElement(item, {
          collapsible: true,
          open: item.props.id === current,
          onToggle: () => toggle(item.props.id)
        })
      )}
    </div>
  )
}

// Una seccion del acordeon. `collapsible`, `open` y `onToggle` los inyecta el
// Accordion; si se usa suelta (o es la unica), se pinta abierta y sin cabecera.
//
// El panel NO se desmonta ni usa `display:none` al cerrarse: la animacion de
// altura necesita el contenido en el arbol. Para que lo cerrado no quede
// navegable con el teclado ni lo lea un lector de pantalla, el CSS aplica
// `visibility:hidden` al terminar de cerrarse (y `aria-hidden` lo acompaña).
export function AccordionSection({
  id,
  label,
  collapsible = false,
  open = false,
  onToggle = null,
  children
}) {
  if (!collapsible) {
    return (
      <section className="home-section">
        <h3 className="home-section__label">{label}</h3>
        <div className="home-grid">{children}</div>
      </section>
    )
  }

  const panelId = `acc-panel-${id}`
  return (
    <section className={`acc__item ${open ? 'is-open' : ''}`}>
      <h3 className="acc__heading">
        <button
          type="button"
          className="acc__head"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <span className="acc__label">{label}</span>
          <ChevronDown size={18} className="acc__chev" aria-hidden="true" />
        </button>
      </h3>
      <div id={panelId} className="acc__panel" role="region" aria-hidden={!open}>
        <div className="acc__panel-inner">
          <div className="home-grid">{children}</div>
        </div>
      </div>
    </section>
  )
}
