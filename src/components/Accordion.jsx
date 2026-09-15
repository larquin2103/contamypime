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

// `defaultOpenId`: seccion que aparece ABIERTA la primera vez. Solo se usa cuando
// no hay nada recordado, asi que no pisa la eleccion del usuario. Pensado para
// listas agrupadas por fecha, donde lo util es lo mas reciente y no tiene sentido
// recordar un dia que mañana ya no existe.
export function Accordion({ storageKey = null, defaultOpenId = null, children }) {
  // `toArray` descarta null/false/undefined, que es justo lo que devuelven las
  // secciones gateadas por licencia o por rol: aqui solo llegan las que existen.
  const items = Children.toArray(children).filter(isValidElement)
  const [openId, setOpenId] = useState(() => readOpen(storageKey) ?? defaultOpenId)

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
// `layout` es la clase del contenedor del contenido. Por defecto `home-grid` (la
// rejilla de dos columnas del menu de Inicio), asi que quien ya lo usaba no cambia.
// Se parametriza porque no todo lo que se pliega son baldosas cuadradas: los
// reportes son fichas anchas con su descripcion y sus dos botones, y en dos
// columnas de ~170 px no se podrian leer.
// `badge`/`badgeTone`: aviso en la CABECERA, para que se vea con la seccion
// cerrada. Nacio para las entregas agrupadas por fecha (marcar el dia que tiene
// algo por cobrar o sin cerrar), pero no sabe de entregas: recibe lo que se le
// quiera mostrar. Se pinta en los DOS modos (plegable y suelta). Sin `badge` la
// cabecera es exactamente la de siempre.
//
// El TONO viaja en la clase (`has-badge--bad`, `has-badge--muted`...) porque el
// rojo de la etiqueta cuelga de el: un aviso de trabajo pendiente se pinta en rojo,
// pero un contador de registros de un historial NO es un aviso y no debe gritar.
// `bad` sigue siendo el default, asi que quien ya usaba `badge` no cambia.
export function AccordionSection({
  id,
  label,
  collapsible = false,
  open = false,
  onToggle = null,
  layout = 'home-grid',
  badge = null,
  badgeTone = 'bad',
  children
}) {
  if (!collapsible) {
    // El aviso tambien aqui: una lista agrupada por fecha puede tener UN SOLO dia
    // (las 8 elaboraciones recientes suelen ser todas de hoy), y ese dia es
    // justamente el que puede traer trabajo pendiente. Sin esto, el unico grupo se
    // quedaba sin marca. Con `badge` nulo -el default, y lo que pasan Inicio,
    // Reportes y Ajustes- el DOM es exactamente el de siempre.
    return (
      <section className="home-section">
        <h3 className="home-section__label">
          {label}
          {badge ? <span className={`badge badge--${badgeTone} acc__badge`}>{badge}</span> : null}
        </h3>
        <div className={layout}>{children}</div>
      </section>
    )
  }

  // El `id` de la seccion viaja al DOM (`id` del panel y `aria-controls` del boton), y
  // ahi NO puede llevar espacios: un `aria-controls` con un espacio se lee como DOS
  // referencias y el lector de pantalla no encuentra ninguna. Los grupos de Turnos en
  // Auditoria se identifican por el nombre del vendedor ("Dueño", "Maria Perez"), asi
  // que se sanea aqui, en el componente, y no en cada llamador. Los ids que ya se
  // usaban -fechas y claves de una palabra- no tienen espacios: salen igual.
  const clave = String(id).replace(/\s+/g, '-')
  const panelId = `acc-panel-${clave}`
  // Un `role="region"` SIN nombre accesible no sirve de nada: el lector de
  // pantalla anuncia "region" a secas y quien navega por regiones no sabe en cual
  // esta. Se le da como nombre su propia cabecera.
  const headId = `acc-head-${clave}`
  return (
    <section className={`acc__item ${open ? 'is-open' : ''} ${badge ? `has-badge has-badge--${badgeTone}` : ''}`}>
      <h3 className="acc__heading">
        <button
          type="button"
          id={headId}
          className="acc__head"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <span className="acc__label">{label}</span>
          {badge ? <span className={`badge badge--${badgeTone} acc__badge`}>{badge}</span> : null}
          <ChevronDown size={18} className="acc__chev" aria-hidden="true" />
        </button>
      </h3>
      <div id={panelId} className="acc__panel" role="region" aria-labelledby={headId} aria-hidden={!open}>
        <div className="acc__panel-inner">
          <div className={layout}>{children}</div>
        </div>
      </div>
    </section>
  )
}
