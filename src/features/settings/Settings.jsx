import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { configRepo } from '../../repositories/configRepo'
import { ratesRepo } from '../../repositories/ratesRepo'
import { usersRepo } from '../../repositories/usersRepo'
import { errorsRepo } from '../../repositories/errorsRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { FOREIGN_CURRENCIES, CASH_CURRENCIES, DEFAULT_SEMAPHORE_CONFIG } from '../../db/constants'
import { formatMoney, baseToForeign } from '../../lib/currency'
import { genRecoveryCode } from '../../lib/pin'
import { cleanCode } from '../../lib/unitsConfig'
import { formatDateTime } from '../../lib/dates'
import { getStorageInfo } from '../../lib/storage'
import { licenseModules, LICENSE_MODULES, LICENSE_MODULE_LABELS } from '../../lib/license'
import { Accordion, AccordionSection as Section } from '../../components/Accordion'
import { TablesSettings } from '../tables/TablesSettings'

export function Settings() {
  const { user, isOwner } = useAuth()
  const { baseCurrency, rates } = useCurrency()

  if (!isOwner) {
    return (
      <div className="screen">
        <h2>Ajustes</h2>
        <p className="muted">Solo el dueño puede modificar la configuracion.</p>
      </div>
    )
  }

  // Las 18 secciones iban una tras otra: unas seis pantallas de telefono para
  // llegar a la ultima. Ahora se agrupan en cinco categorias plegables (mismo
  // acordeon y mismo motion que Inicio y Reportes), ordenadas por FRECUENCIA DE
  // USO y no alfabeticamente: en Ajustes no se busca por nombre, se va a una
  // tarea concreta y casi siempre a la misma (la tasa del dolar se toca a
  // diario; la licencia, dos veces al año).
  //
  // Cada seccion sigue siendo LA MISMA y con sus mismas compuertas: lo unico que
  // cambia es dentro de que caja se pinta. Aqui los gates viven DENTRO de cada
  // componente (devuelven null sin su modulo), asi que el acordeon no puede saber
  // cuales se van a pintar; por eso cada grupo lleva AL MENOS UNA seccion BASE (sin
  // modulo) y ninguno puede quedar como una categoria vacia. Comprobado una a una:
  // Monedas (Rates, Converter), Turno (Semaforo, Denominaciones, WhatsApp), Negocio
  // (Areas, Unidades) y Sistema (Respaldo, Errores, Avisos, Seguridad, Licencia) son
  // base; Permisos depende de UNA sola -SellerPermsSection-, porque Administrativo,
  // Mayorista y Tableros SI estan gateadas. Si algun dia esa se gatea, este grupo se
  // queda vacio: es la unica que no se puede mover de aqui sin mirar.
  return (
    <div className="screen">
      <h2>Ajustes</h2>
      <Accordion storageKey="settings">
        <Section id="monedas" label="Monedas y tasas" layout="acc-stack">
          <RatesSection userId={user.id} baseCurrency={baseCurrency} rates={rates} />
          <ConverterPreview baseCurrency={baseCurrency} rates={rates} />
        </Section>
        <Section id="turno" label="Turno y cuadre" layout="acc-stack">
          <SemaphoreSection />
          <DenominationsSection />
          <WhatsappSection />
        </Section>
        <Section id="negocio" label="Tu negocio" layout="acc-stack">
          <AreasSection />
          <UnitsSection />
          <TablesSettings />
          <ElaborationSection />
        </Section>
        <Section id="permisos" label="Permisos del personal" layout="acc-stack">
          <AdminPermsSection />
          <SellerPermsSection />
          <WholesaleSection />
          <BoardsSection />
        </Section>
        <Section id="sistema" label="Sistema y seguridad" layout="acc-stack">
          <BackupLinkSection />
          <ErrorLogLinkSection />
          <NotificationsLinkSection />
          <SecuritySection userId={user.id} />
          <LicenseSection />
        </Section>
      </Accordion>
    </div>
  )
}

// Enlace a la pantalla de configuración de notificaciones (Fase 9). El centro y su
// campana viven en el mando; aquí el dueño elige qué avisos recibe (config sincroniza).
function NotificationsLinkSection() {
  return (
    <section className="card">
      <h3>Notificaciones</h3>
      <p className="muted">Elige qué avisos recibes en la campana (caja, inventario, ventas…).</p>
      <Link className="btn btn--ghost btn--block" to="/notifications">Configurar notificaciones</Link>
    </section>
  )
}

// Areas de venta del punto (Fase 6 - Bloque 19). El dueño define la lista; cada
// vendedor abre su turno en un area, con caja y cuadre propios. Quitar un area
// de la lista NO borra productos ni ventas (append-only): solo deja de ofrecerse.
function AreasSection() {
  const areas = useLiveQuery(() => configRepo.getAreas(), [], undefined)
  const [draft, setDraft] = useState('')
  const [saved, setSaved] = useState(false)
  if (areas === undefined) return null

  const flash = () => { setSaved(true); setTimeout(() => setSaved(false), 1200) }
  const add = async () => {
    const name = draft.trim()
    if (!name) return
    await configRepo.setAreas([...areas, name])
    setDraft('')
    flash()
  }
  const remove = async (a) => {
    await configRepo.setAreas(areas.filter((x) => x !== a))
    flash()
  }

  return (
    <section className="card">
      <h3>Áreas de venta</h3>
      <p className="muted">
        Divide tu punto en áreas (ej: Víveres, Carnicería). Cada vendedor abre su turno en un área,
        con su propia caja y cuadre. Si no defines ninguna, el negocio opera como un solo punto.
      </p>
      {areas.length === 0
        ? <p className="muted">Aún no hay áreas. Agrega la primera abajo.</p>
        : areas.map((a) => (
            <div key={a} className="kv">
              <strong>{a}</strong>
              <button className="btn btn--ghost btn--sm" onClick={() => remove(a)}>Quitar</button>
            </div>
          ))}
      <label className="field">
        <span>Nueva área</span>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ej: Carnicería" />
      </label>
      <button className="btn btn--primary btn--block" onClick={add}>
        {saved ? 'Guardado ✓' : 'Agregar área'}
      </button>
      <p className="muted">
        Quitar un área no borra sus productos ni sus ventas; solo deja de ofrecerse para nuevos turnos.
      </p>
    </section>
  )
}

// Unidades de medida configurables (U2, peticion del dueño del 13-09-2026). El dueño
// DESACTIVA las que no usa -para no pincharlas por error, como los galones- y añade las
// suyas de gastronomia (trago de 45 ml, copas de vino de 120/150/180, dash, crema de 30
// ml), sin que el proveedor toque el programa. Es funcion BASE, no de modulo, y solo el
// dueño la ve (la pantalla entera ya exige `isOwner`).
//
// Vive en la clave `config.units`, que YA sincroniza: se configura una vez y llega a
// todos los telefonos. CLAVE AUSENTE = las 8 de fabrica, asi que un negocio que no entre
// aqui se comporta EXACTAMENTE como hoy.
//
// DOS REGLAS QUE NO SE NEGOCIAN:
//  - El CODIGO nunca se edita. Se congela como copia en diez tablas (ventas, compras,
//    mermas, conteos, producciones, conversiones, traspasos, lineas de mesa, movimientos
//    de terceros y lineas de ficha); cambiarlo dejaria el historico con el viejo. La
//    ETIQUETA si se puede cambiar cuando se quiera: es lo unico que se lee.
//  - Se DESACTIVA, nunca se borra (regla 6): un producto que ya usa esa unidad tiene que
//    poder seguir editandose. Lo unico que se puede QUITAR es una unidad que se acaba de
//    añadir y todavia NO se ha guardado.
//
// Se edita sobre un BORRADOR local y se guarda de golpe (patron del centro de
// elaboracion), para no escribir en `config` con cada tecla. Mientras hay borrador la
// tarjeta no se refresca desde la base: si otro dispositivo cambia la lista a la vez,
// gana quien guarde el ultimo, igual que con las areas y que con toda clave de `config`.
function UnitsSection() {
  const saved = useLiveQuery(() => configRepo.getUnits(), [], undefined)
  const [draft, setDraft] = useState(null)
  const [newCode, setNewCode] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [msg, setMsg] = useState(null) // { ok, text }
  if (saved === undefined) return null

  const list = draft ?? saved
  const savedCodes = new Set(saved.map((u) => u.code))
  const dirty = JSON.stringify(list) !== JSON.stringify(saved)
  const actives = list.filter((u) => u.active).length

  const edit = (i, patch) => {
    setMsg(null)
    setDraft(list.map((u, k) => (k === i ? { ...u, ...patch } : u)))
  }

  // Apagar la ultima activa dejaria el alta de producto sin una sola opcion: se avisa
  // aqui y ademas lo rechaza `configRepo.setUnits` (el candado de verdad).
  const toggle = (i) => {
    const u = list[i]
    if (u.active && actives <= 1) {
      setMsg({ ok: false, text: 'Debe quedar al menos una unidad activa.' })
      return
    }
    edit(i, { active: !u.active })
  }

  const add = () => {
    const code = cleanCode(newCode)
    if (!code) { setMsg({ ok: false, text: 'Escribe el código de la unidad (ej: trago).' }); return }
    if (list.some((u) => u.code === code)) {
      setMsg({ ok: false, text: `El código "${code}" ya está en la lista.` })
      return
    }
    setDraft([...list, { code, label: newLabel.trim() || code, active: true }])
    setNewCode('')
    setNewLabel('')
    setMsg(null)
  }

  // Solo para lo que aun NO esta guardado: un codigo ya guardado pudo congelarse en una
  // venta, asi que ese se desactiva, no se quita.
  const drop = (i) => {
    setMsg(null)
    setDraft(list.filter((_, k) => k !== i))
  }

  const save = async () => {
    try {
      await configRepo.setUnits(list)
      setDraft(null) // se vuelve a leer de la base, ya normalizada
      setMsg({ ok: true, text: 'Unidades guardadas ✓' })
    } catch (e) {
      setMsg({ ok: false, text: e?.message || 'No se pudo guardar' })
    }
  }

  const discard = () => { setDraft(null); setMsg(null) }

  return (
    <section className="card">
      <h3>Unidades de medida</h3>
      <p className="muted">
        Elige qué unidades se ofrecen al crear productos, recetas y fichas.{' '}
        <strong>Desactiva</strong> las que tu negocio no usa para no pincharlas por error, y{' '}
        <strong>agrega</strong> las tuyas (ej: trago de 45 ml, copa de vino, dash).
      </p>
      {list.map((u, i) => (
        <div key={u.code} className="kv">
          <label className="field" style={{ flex: 1, marginRight: 10 }}>
            <span className="muted">Código: <strong>{u.code}</strong></span>
            <input
              value={u.label}
              onChange={(e) => edit(i, { label: e.target.value })}
              placeholder={u.code}
            />
          </label>
          <span style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
            <button
              className={`btn btn--sm ${u.active ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => toggle(i)}
            >
              {u.active ? 'Activa ✓' : 'Desactivada'}
            </button>
            {!savedCodes.has(u.code) && (
              <button className="btn btn--ghost btn--sm" onClick={() => drop(i)}>Quitar</button>
            )}
          </span>
        </div>
      ))}

      <label className="field">
        <span>Código de la nueva unidad</span>
        <input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="Ej: trago" />
        {/* Aviso con motivo real: muchas pantallas (caja, ficha, existencias) imprimen
            el CODIGO y no el nombre largo, porque no cabe. Un codigo tipo "copa150" se
            lee bien ahi; uno tipo "cv1" no. */}
        <small className="muted">
          Corto y legible: es lo que se ve junto a las cantidades en varias pantallas
          (ej: «5 trago»). Sin espacios y en minúsculas.
        </small>
      </label>
      <label className="field">
        <span>Nombre que se muestra</span>
        <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Ej: Trago (45 ml)" />
      </label>
      <button className="btn btn--ghost btn--block" onClick={add}>Agregar unidad</button>

      {msg && <p className={msg.ok ? 'ok-text' : 'error'}>{msg.text}</p>}
      {dirty && (
        <>
          <button className="btn btn--primary btn--block" onClick={save}>Guardar unidades</button>
          <button className="btn btn--ghost btn--block" onClick={discard}>Descartar cambios</button>
        </>
      )}
      <p className="muted">
        El <strong>código</strong> no se puede cambiar: queda grabado en las ventas, entradas y
        conteos ya hechos. El <strong>nombre</strong> sí, cuando quieras. Desactivar una unidad no
        borra nada: los productos que ya la usan la conservan y se siguen pudiendo editar; solo deja
        de ofrecerse para lo nuevo.
      </p>
      <p className="muted">
        Ojo: poner «trago» como unidad <strong>no</strong> convierte la botella en tragos. Para eso
        está el fraccionamiento (ventas mayoristas) o la receta de coctelería.
      </p>
    </section>
  )
}

// Bloque A (modulo mayorista): permiso general para que el vendedor venda desde
// el almacen central SIN cerrar su turno. Solo aparece si la licencia trae el
// modulo; sin el, la app opera exactamente como la version clasica.
function WholesaleSection() {
  const { hasModule } = useLicense()
  const enabled = useLiveQuery(() => configRepo.get('sellerWarehouseSale', false), [], undefined)
  const selfAuth = useLiveQuery(() => configRepo.get('sellerSelfAuthorize', false), [], undefined)
  if (!hasModule(LICENSE_MODULES.WHOLESALE)) return null
  if (enabled === undefined || selfAuth === undefined) return null

  return (
    <section className="card">
      <h3>Ventas mayoristas</h3>
      <p className="muted">
        Con este permiso, el vendedor puede elegir en la pantalla de venta cobrar productos
        del <strong>almacén central</strong> sin cerrar su turno. El dinero entra a la caja
        de su turno y la venta queda marcada con su origen (visible en los reportes).
      </p>
      <div className="kv">
        <span className="muted">Vender desde el almacén central</span>
        <button
          className={`btn btn--sm ${enabled ? 'btn--primary' : 'btn--ghost'}`}
          onClick={() => configRepo.set('sellerWarehouseSale', !enabled)}
        >
          {enabled ? 'Activado ✓' : 'Desactivado'}
        </button>
      </div>

      <p className="muted" style={{ marginTop: 14 }}>
        Con este permiso, el vendedor puede registrar <strong>extracciones de caja</strong>,
        <strong> deudas internas</strong> y <strong>retirar efectivo al cerrar su turno</strong>
        confirmando con <strong>su propio PIN</strong>, sin necesidad del dueño ni de un
        administrativo. Cada operación queda registrada a su nombre. Desactivado (por defecto),
        estas operaciones siguen exigiendo el PIN de un mando.
      </p>
      <div className="kv">
        <span className="muted">Vendedor se autoriza con su PIN</span>
        <button
          className={`btn btn--sm ${selfAuth ? 'btn--primary' : 'btn--ghost'}`}
          onClick={() => configRepo.set('sellerSelfAuthorize', !selfAuth)}
        >
          {selfAuth ? 'Activado ✓' : 'Desactivado'}
        </button>
      </div>
    </section>
  )
}

// Modulo elaboracion: activa el centro de elaboracion (ubicacion intermedia entre
// el almacen y las areas) y permite nombrarlo. Solo aparece con el modulo; sin el,
// la app opera exactamente como la version clasica.
function ElaborationSection() {
  const { hasModule } = useLicense()
  const cfg = useLiveQuery(() => configRepo.getElaboration(), [], undefined)
  const [name, setName] = useState(null)
  if (!hasModule(LICENSE_MODULES.ELABORATION)) return null
  if (cfg === undefined) return null
  const value = name ?? cfg.name

  return (
    <section className="card">
      <h3>Centro de elaboración</h3>
      <p className="muted">
        Habilita una ubicación intermedia entre el <strong>almacén</strong> y las <strong>áreas de venta</strong>.
        El crudo va del almacén a elaboración, se transforma (con su nuevo código) y luego se envía a un área.
        No es un punto de venta.
      </p>
      <div className="kv">
        <span className="muted">Usar centro de elaboración</span>
        <button
          className={`btn btn--sm ${cfg.enabled ? 'btn--primary' : 'btn--ghost'}`}
          onClick={() => configRepo.set('elaborationEnabled', !cfg.enabled)}
        >
          {cfg.enabled ? 'Activado ✓' : 'Desactivado'}
        </button>
      </div>
      {cfg.enabled && (
        <label className="field">
          <span>Nombre del centro</span>
          <input
            value={value}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { const v = (value || '').trim() || 'Elaboración'; configRepo.set('elaborationName', v); setName(null) }}
            placeholder="Elaboración"
          />
        </label>
      )}
    </section>
  )
}

// Tableros de elaboración en la sesión del VENDEDOR (módulos 'cocina' y 'cocteleria').
// Cada interruptor solo aparece con su módulo; sin ninguno de los dos, la tarjeta no
// se pinta y Ajustes queda exactamente como siempre.
//
// Defaults, y el motivo (regla 2):
//  - `sellerKitchenBoard` nace ACTIVADO. Hoy, con el módulo 'cocina', el vendedor YA
//    ve el tablero de cocina; si naciera apagado, al desplegar perdería algo que
//    tiene. Por eso la lectura es `get('sellerKitchenBoard', true)`: con la clave sin
//    definir —toda base existente— el vendedor sigue viéndolo.
//  - `sellerCocktailBoard` nace APAGADO: es función nueva, la enciende el dueño.
// Al cocinero y al mando no les afecta ninguno de los dos (la cocina es el trabajo
// del cocinero, y el mando supervisa).
function BoardsSection() {
  const { hasModule } = useLicense()
  const canKitchen = hasModule(LICENSE_MODULES.KITCHEN)
  const canCocktails = hasModule(LICENSE_MODULES.COCKTAILS)
  const kitchenBoard = useLiveQuery(() => configRepo.get('sellerKitchenBoard', true), [], undefined)
  const cocktailBoard = useLiveQuery(() => configRepo.get('sellerCocktailBoard', false), [], undefined)
  const allowShort = useLiveQuery(() => configRepo.get('allowShortProduction', false), [], undefined)
  if (!canKitchen && !canCocktails) return null
  if (kitchenBoard === undefined || cocktailBoard === undefined || allowShort === undefined) return null

  return (
    <section className="card">
      <h3>Tableros de elaboración</h3>
      <p className="muted">
        Qué tableros ve el <strong>vendedor</strong> en su inicio. No afectan al cocinero (la cocina
        es su trabajo) ni al dueño/administrativo, que los ven siempre.
      </p>
      {canKitchen && (
        <>
          <div className="kv">
            <span className="muted">Tablero de cocina para el vendedor</span>
            <button
              className={`btn btn--sm ${kitchenBoard ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => configRepo.set('sellerKitchenBoard', !kitchenBoard)}
            >
              {kitchenBoard ? 'Activado ✓' : 'Desactivado'}
            </button>
          </div>
          <p className="muted">
            <small>
              Elabora recetas de cocina y las envía al área que elija. Desactívalo si solo quieres
              que elabore el cocinero.
            </small>
          </p>
        </>
      )}
      {canCocktails && (
        <>
          <div className="kv" style={{ marginTop: canKitchen ? 10 : 0 }}>
            <span className="muted">Tablero de coctelería para el vendedor</span>
            <button
              className={`btn btn--sm ${cocktailBoard ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => configRepo.set('sellerCocktailBoard', !cocktailBoard)}
            >
              {cocktailBoard ? 'Activado ✓' : 'Desactivado'}
            </button>
          </div>
          <p className="muted">
            <small>
              Elabora tragos <strong>en el área de su turno</strong>, consumiendo el stock de esa
              área: el trago queda ahí mismo, listo para venderse. Necesita turno abierto.
            </small>
          </p>
        </>
      )}

      {/* Elaborar con faltante. Afecta a los DOS tableros y a TODOS los que elaboran
          (cocinero, vendedor y mando): es el mismo motor. Apagado por defecto. */}
      <div className="kv" style={{ marginTop: 10 }}>
        <span className="muted">Elaborar aunque falte algún insumo</span>
        <button
          className={`btn btn--sm ${allowShort ? 'btn--primary' : 'btn--ghost'}`}
          onClick={() => configRepo.set('allowShortProduction', !allowShort)}
        >
          {allowShort ? 'Activado ✓' : 'Desactivado'}
        </button>
      </div>
      <p className="muted">
        <small>
          Para cuando la mercancía <strong>está físicamente</strong> pero falta registrar su entrada.
          Con esto, quien elabora puede seguir adelante y la existencia de ese insumo queda en
          <strong> negativo</strong> hasta que la entrada o el traspaso la cubran. Se avisa antes de
          confirmar, queda constancia de con cuánto se elaboró en descubierto, y afecta a los dos
          tableros. Desactivado (por defecto), falta un insumo y no se elabora, como siempre.
        </small>
      </p>
      {allowShort && (
        <p className="warn-text">
          <small>
            Ojo: un negativo solo se cura dando la <strong>entrada</strong> en esa misma ubicación,
            haciendo un <strong>traspaso</strong> hacia ella, o con el <strong>conteo físico</strong>.
            Una entrada al almacén central NO cura un negativo de un área.
          </small>
        </p>
      )}
    </section>
  )
}

// Permisos del administrativo (Bloque 20.6+). Todo permitido por DEFECTO: el
// admin conserva sus facultades de hoy. El dueño puede QUITAR puntualmente
// algunas (asignacion temporal: quita, opera, vuelve a poner). No afecta al
// dueño ni al vendedor. Cada facultad solo se muestra si su modulo esta activo.
const ADMIN_CAPS = [
  { key: 'entries', label: 'Dar entrada de productos', module: null },
  { key: 'conversion', label: 'Crear conversión de códigos', module: LICENSE_MODULES.WHOLESALE },
  { key: 'accounts', label: 'Modificar cuentas (crear / ajustar)', module: LICENSE_MODULES.ACCOUNTS },
  { key: 'partners', label: 'Crear proveedores y terceros', module: LICENSE_MODULES.ACCOUNTS }
]
function AdminPermsSection() {
  const { hasModule } = useLicense()
  const perms = useLiveQuery(() => configRepo.get('adminPermissions', {}), [], undefined)
  if (perms === undefined) return null
  const allowed = (k) => perms?.[k] !== false
  const setCap = (k, value) => configRepo.set('adminPermissions', { ...(perms || {}), [k]: value })
  const caps = ADMIN_CAPS.filter((c) => !c.module || hasModule(c.module))

  return (
    <section className="card">
      <h3>Permisos del administrativo</h3>
      <p className="muted">
        Todo está permitido por defecto. Desactiva lo que <strong>no</strong> quieras autorizar al
        administrativo; puedes volver a activarlo cuando lo necesite. No afecta al vendedor ni a las
        demás facultades del administrativo. El dueño no se ve afectado.
      </p>
      {caps.map((c) => (
        <div key={c.key} className="kv">
          <span className="muted">{c.label}</span>
          <button
            className={`btn btn--sm ${allowed(c.key) ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => setCap(c.key, !allowed(c.key))}
          >
            {allowed(c.key) ? 'Permitido ✓' : 'Bloqueado'}
          </button>
        </div>
      ))}
    </section>
  )
}

// Permisos del VENDEDOR independientes de cualquier módulo (Ajustes). Hoy:
// registrar entradas de mercancía. Apagados por defecto; el dueño los activa
// cuando el vendedor los necesite y los desactiva después. No afectan al dueño
// ni al administrativo. Las entradas del vendedor ingresan al almacén central.
function SellerPermsSection() {
  const entries = useLiveQuery(() => configRepo.get('sellerEntries', false), [], undefined)
  if (entries === undefined) return null
  return (
    <section className="card">
      <h3>Permisos del vendedor</h3>
      <p className="muted">
        Facultades que el dueño puede conceder al <strong>vendedor</strong>, independientes de
        cualquier módulo. Apagadas por defecto; actívalas cuando las necesite y desactívalas
        después. No afectan al dueño ni al administrativo.
      </p>
      <div className="kv">
        <span className="muted">Registrar entradas de mercancía</span>
        <button
          className={`btn btn--sm ${entries ? 'btn--primary' : 'btn--ghost'}`}
          onClick={() => configRepo.set('sellerEntries', !entries)}
        >
          {entries ? 'Activado ✓' : 'Desactivado'}
        </button>
      </div>
    </section>
  )
}

// Estado de la licencia + renovacion (pegar un codigo nuevo). El dueño ve aqui
// negocio, plan, vencimiento y dias restantes; cuando vence o esta por vencer,
// pega la licencia que le entregue el proveedor para renovar al instante.
const LICENSE_STATUS = {
  active: { label: 'Activa', cls: 'ok-text' },
  expiring: { label: 'Por vencer', cls: 'warn-text' },
  grace: { label: 'Caducada (en gracia)', cls: 'warn-text' },
  expired: { label: 'Caducada', cls: 'error' },
  invalid: { label: 'No válida', cls: 'error' },
  none: { label: 'Sin licencia', cls: 'muted' }
}

function LicenseSection() {
  const lic = useLicense()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { ok, text }

  const p = lic.payload
  const st = LICENSE_STATUS[lic.status] || LICENSE_STATUS.none

  const renew = async () => {
    setBusy(true)
    setMsg(null)
    const res = await lic.activate(code)
    if (res.ok) {
      setCode('')
      setMsg({ ok: true, text: 'Licencia aplicada ✓' })
    } else if (res.status === 'expired') {
      setMsg({ ok: false, text: 'Esa licencia ya caducó. Pide una nueva al proveedor.' })
    } else if (res.status === 'mismatch') {
      setMsg({ ok: false, text: `Error: ${res.detail}. Pide una licencia para el negocio correcto.` })
    } else {
      setMsg({ ok: false, text: 'El código no es válido. Cópialo completo.' })
    }
    setBusy(false)
  }

  return (
    <section className="card">
      <h3>Licencia de activación</h3>
      {p ? (
        <>
          <div className="kv"><span className="muted">Negocio</span><strong>{p.negocio}</strong></div>
          <div className="kv"><span className="muted">Plan</span><strong>{p.plan}</strong></div>
          <div className="kv"><span className="muted">Estado</span><strong className={st.cls}>{st.label}</strong></div>
          <div className="kv"><span className="muted">Vence</span><strong>{p.expira || 'sin caducidad'}</strong></div>
          {licenseModules(p).length > 0 && (
            <div className="kv">
              <span className="muted">Módulos</span>
              <strong>{licenseModules(p).map((m) => LICENSE_MODULE_LABELS[m] || m).join(', ')}</strong>
            </div>
          )}
          {Number.isFinite(lic.daysLeft) && (
            <div className="kv">
              <span className="muted">Días restantes</span>
              <strong>{lic.daysLeft >= 0 ? lic.daysLeft : `vencida hace ${-lic.daysLeft}`}</strong>
            </div>
          )}
          {lic.status === 'grace' && (
            <p className="warn-text">Periodo de gracia: quedan {lic.graceLeft} día(s) antes del bloqueo.</p>
          )}
          {lic.clockBack && (
            <p className="warn-text">⏰ La fecha del dispositivo parece atrasada; ajústala.</p>
          )}
        </>
      ) : (
        <p className="muted">No hay una licencia válida instalada en este dispositivo.</p>
      )}

      <label className="field">
        <span>Renovar o cambiar licencia</span>
        <textarea
          rows={3}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="MYPI1...."
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <button className="btn btn--primary btn--block" disabled={!code.trim() || busy} onClick={renew}>
        {busy ? 'Verificando…' : 'Aplicar licencia'}
      </button>
      {msg && <p className={msg.ok ? 'ok-text' : 'error'}>{msg.text}</p>}
      <p className="muted">La licencia es local de este dispositivo y se verifica sin internet.</p>
    </section>
  )
}

function WhatsappSection() {
  const current = useLiveQuery(() => configRepo.get('ownerWhatsapp', ''), [], undefined)
  const [draft, setDraft] = useState(null)
  const [saved, setSaved] = useState(false)
  const value = draft ?? current ?? ''

  const save = async () => {
    await configRepo.set('ownerWhatsapp', value.trim())
    setDraft(null)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <section className="card">
      <h3>WhatsApp del dueño</h3>
      <p className="muted">
        Para recibir el reporte de cierre de cada turno. Incluye el código de país (ej. 53 para Cuba).
      </p>
      <label className="field">
        <span>Número (con código de país)</span>
        <input
          inputMode="tel"
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ej: 535XXXXXXX"
        />
      </label>
      <button className="btn btn--primary btn--block" onClick={save}>
        {saved ? 'Guardado ✓' : 'Guardar número'}
      </button>
    </section>
  )
}

function DenominationsSection() {
  const denoms = useLiveQuery(() => configRepo.getDenominations(), [], null)
  const [draft, setDraft] = useState(null)
  const [saved, setSaved] = useState(false)

  const value = draft ?? denoms
  if (!value) return null

  const setCur = (cur, text) => {
    setDraft({ ...value, [cur]: text })
  }

  const save = async () => {
    const parsed = {}
    for (const cur of CASH_CURRENCIES) {
      const list = String(value[cur] ?? '')
        .toString()
      const arr = (Array.isArray(value[cur]) ? value[cur].join(',') : list)
        .split(',')
        .map((s) => Number(String(s).trim()))
        .filter((n) => n > 0)
        .sort((a, b) => b - a)
      parsed[cur] = arr
    }
    await configRepo.set('denominations', parsed)
    setDraft(null)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <section className="card">
      <h3>Denominaciones de billetes</h3>
      <p className="muted">Para contar la caja al cierre. Separa los valores con comas.</p>
      {CASH_CURRENCIES.map((cur) => (
        <label key={cur} className="field">
          <span>{cur}</span>
          <input
            value={Array.isArray(value[cur]) ? value[cur].join(', ') : value[cur] ?? ''}
            onChange={(e) => setCur(cur, e.target.value)}
          />
        </label>
      ))}
      <button className="btn btn--primary btn--block" onClick={save}>
        {saved ? 'Guardado ✓' : 'Guardar denominaciones'}
      </button>
    </section>
  )
}

// Bloque 32 - Acceso al respaldo y estado de la proteccion del almacenamiento.
// La gestion completa (hacer/restaurar respaldo) vive en su propia pantalla.
function BackupLinkSection() {
  const lastBackupAt = useLiveQuery(() => configRepo.get('lastBackupAt', null), [], undefined)
  const [persisted, setPersisted] = useState(null)
  useEffect(() => { getStorageInfo().then((i) => setPersisted(i.persisted)) }, [])

  return (
    <section className="card">
      <h3>Respaldo de datos</h3>
      <div className="kv">
        <span className="muted">Almacenamiento protegido</span>
        <strong className={persisted ? 'ok-text' : persisted === false ? 'warn-text' : 'muted'}>
          {persisted ? '✅ Sí' : persisted === false ? '⚠️ No' : '—'}
        </strong>
      </div>
      <div className="kv">
        <span className="muted">Último respaldo</span>
        <strong>{lastBackupAt ? formatDateTime(lastBackupAt) : 'Nunca'}</strong>
      </div>
      <Link className="btn btn--primary btn--block" to="/backup">Hacer o restaurar respaldo</Link>
    </section>
  )
}

// Bloque 33 - Acceso al registro local de errores (diagnostico).
function ErrorLogLinkSection() {
  const count = useLiveQuery(() => errorsRepo.count(), [], 0)
  return (
    <section className="card">
      <h3>Registro de errores</h3>
      <div className="kv">
        <span className="muted">Errores registrados</span>
        <strong className={count > 0 ? 'warn-text' : 'ok-text'}>{count}</strong>
      </div>
      <Link className="btn btn--block" to="/errors">Ver registro</Link>
    </section>
  )
}

function SecuritySection({ userId }) {
  const [code, setCode] = useState(null)
  const [busy, setBusy] = useState(false)

  const regenerate = async () => {
    setBusy(true)
    const newCode = genRecoveryCode()
    await usersRepo.setRecoveryCode(userId, newCode)
    setCode(newCode)
    setBusy(false)
  }

  return (
    <section className="card">
      <h3>Código de recuperación</h3>
      <p className="muted">
        Sirve para recuperar tu PIN si lo olvidas. Al regenerarlo, el código anterior deja de
        funcionar. Guárdalo en un lugar seguro.
      </p>
      {code && <div className="recovery-code">{code}</div>}
      <button className="btn btn--block" disabled={busy} onClick={regenerate}>
        {busy ? 'Generando…' : code ? 'Regenerar otro' : 'Regenerar código'}
      </button>
    </section>
  )
}

function RatesSection({ userId, baseCurrency, rates }) {
  const [drafts, setDrafts] = useState({})
  const [saved, setSaved] = useState('')

  const save = async (currency) => {
    const val = Number(drafts[currency])
    if (!val || val <= 0) return
    await ratesRepo.addRate(currency, val, userId)
    setDrafts((d) => ({ ...d, [currency]: '' }))
    setSaved(currency)
    setTimeout(() => setSaved(''), 1500)
  }

  return (
    <section className="card">
      <h3>Tasas de cambio</h3>
      <p className="muted">
        Cuanta {baseCurrency} vale 1 unidad de cada moneda. Editable sin internet.
      </p>
      {FOREIGN_CURRENCIES.map((c) => {
        const current = rates?.[c.code]
        return (
          <div key={c.code} className="rate-row">
            <div className="rate-row__info">
              <strong>{c.name}</strong>
              {current ? (
                <span className="muted">
                  Actual: 1 {c.code} = {current.rate} {baseCurrency}
                  <br />
                  <small>desde {formatDateTime(current.effectiveFrom)}</small>
                </span>
              ) : (
                <span className="muted">Sin tasa definida</span>
              )}
            </div>
            <div className="rate-row__edit">
              <input
                type="number"
                inputMode="decimal"
                placeholder={current ? String(current.rate) : '0'}
                value={drafts[c.code] ?? ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [c.code]: e.target.value }))}
              />
              <button className="btn btn--primary" onClick={() => save(c.code)}>
                {saved === c.code ? '✓' : 'Guardar'}
              </button>
            </div>
          </div>
        )
      })}
    </section>
  )
}

function ConverterPreview({ baseCurrency, rates }) {
  const [amount, setAmount] = useState('')
  const n = Number(amount) || 0

  return (
    <section className="card">
      <h3>Conversor rapido</h3>
      <label className="field">
        <span>Monto en {baseCurrency}</span>
        <input
          type="number"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
        />
      </label>
      <div className="convert-grid">
        {FOREIGN_CURRENCIES.map((c) => {
          const rate = Number(rates?.[c.code]?.rate || 0)
          return (
            <div key={c.code} className="convert-cell">
              <span className="muted">{c.code}</span>
              <strong>{rate ? formatMoney(baseToForeign(n, rate), c.code) : '— sin tasa'}</strong>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function SemaphoreSection() {
  const config = useLiveQuery(() => configRepo.getSemaphoreConfig(), [], DEFAULT_SEMAPHORE_CONFIG)
  const [green, setGreen] = useState('')
  const [yellow, setYellow] = useState('')
  const [saved, setSaved] = useState(false)

  const greenVal = green !== '' ? green : config?.greenMaxPct ?? ''
  const yellowVal = yellow !== '' ? yellow : config?.yellowMaxPct ?? ''

  const save = async () => {
    await configRepo.set('semaphore', {
      greenMaxPct: Number(greenVal),
      yellowMaxPct: Number(yellowVal)
    })
    setGreen('')
    setYellow('')
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <section className="card">
      <h3>Semáforo del cuadre</h3>
      <p className="muted">Margen de diferencia tolerado al cerrar turno (% del esperado).</p>
      <label className="field">
        <span>🟢 Cuadra si la diferencia es menor o igual a (%)</span>
        <input
          type="number"
          inputMode="decimal"
          value={greenVal}
          onChange={(e) => setGreen(e.target.value)}
        />
      </label>
      <label className="field">
        <span>🟡 Diferencia menor hasta (%) — por encima es 🔴 critica</span>
        <input
          type="number"
          inputMode="decimal"
          value={yellowVal}
          onChange={(e) => setYellow(e.target.value)}
        />
      </label>
      <button className="btn btn--primary btn--block" onClick={save}>
        {saved ? 'Guardado ✓' : 'Guardar umbrales'}
      </button>
    </section>
  )
}
