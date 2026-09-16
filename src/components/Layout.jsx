import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Home, Package, ScrollText, DollarSign, Settings, Users, LogOut, Moon, Sun,
  LayoutDashboard, UtensilsCrossed, ArrowLeftRight, Wallet, PackagePlus, PackageMinus,
  Send, Split, Factory, ClipboardList, ChefHat, CookingPot, Martini, FileText,
  BookOpen, ShieldCheck, Handshake, Calculator, RefreshCw, Save, HelpCircle, Banknote
} from 'lucide-react'
import { useAuth } from '../app/providers/AuthProvider'
import { useShift } from '../app/providers/ShiftProvider'
import { useSync } from '../app/providers/SyncProvider'
import { useLicense } from '../app/providers/LicenseProvider'
import { NotificationBell } from '../features/notifications/NotificationBell'
import { NotificationBoundary } from '../features/notifications/NotificationBoundary'
import { getTheme, setTheme } from '../lib/theme'
import { configRepo } from '../repositories/configRepo'
import { remittancesRepo } from '../repositories/remittancesRepo'
import { isPendingCollection } from '../lib/remesas'
import { LICENSE_MODULES } from '../lib/license'
import { buildNavSections } from '../lib/navSections'

// Conmutador de tema (Fase 8 - B1): en la cabecera, a la IZQUIERDA de la nube de
// sync y accesible a TODOS los roles (la preferencia es local del dispositivo, no
// sincroniza; por eso vive aquí y no en Ajustes, que es solo del dueño). Muestra
// SOLO el icono del tema ACTUAL —luna si oscuro, sol si claro— y al tocarlo alterna.
function ThemeToggle() {
  const [theme, setThemeState] = useState(getTheme())
  const isLight = theme === 'light'
  const toggle = () => setThemeState(setTheme(isLight ? 'dark' : 'light'))
  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      aria-label={isLight ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro'}
      title={isLight ? 'Tema claro — tocar para oscuro' : 'Tema oscuro — tocar para claro'}
    >
      {isLight ? <Sun size={18} strokeWidth={2} /> : <Moon size={18} strokeWidth={2} />}
    </button>
  )
}

// El verde solo es "de verdad" si hubo una bajada confirmada por el servidor
// hace menos de esto. Con el pull de respaldo cada 45s, 120s deja margen para
// dos ciclos antes de dudar (evita parpadeo pero avisa pronto si se cae la red).
const SYNC_FRESH_MS = 120000

// Indicador de sincronizacion en la cabecera (solo si la sync esta activada).
// FASE 1: refleja SALUD REAL, no solo navigator.onLine. Al tocarlo abre un panel
// con la ultima sincronizacion confirmada y un boton para forzarla con resultado.
function SyncBadge() {
  const { enabled, cloudUser, online, syncing, lastPullOkAt, pullError, manualSync } = useSync()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // { ok, error } del ultimo intento manual
  // El estado "fresco" depende del PASO DEL TIEMPO y, ante fallos repetidos, el
  // error puede reasignarse al mismo texto (React no re-renderiza). Este "tick"
  // fuerza re-evaluar el badge cada pocos segundos, para que el ☁️/⚠️ cambie
  // solo, sin tener que recargar la pestaña. (Solo redibuja este badge pequeño.)
  const [, setTick] = useState(0)
  useEffect(() => {
    // Gateado: solo corre cuando la sync está activa (el badge se muestra). Para
    // clientes sin sync no se arma ningún temporizador -> app idéntica.
    if (!enabled || !cloudUser) return
    const id = setInterval(() => setTick((n) => n + 1), 5000)
    return () => clearInterval(id)
  }, [enabled, cloudUser])
  if (!enabled || !cloudUser) return null

  const ageMs = lastPullOkAt ? Date.now() - new Date(lastPullOkAt).getTime() : Infinity
  // Verde exige bajada reciente CONFIRMADA y sin error pendiente. Incluir
  // pullError hace que un fallo pase a amarillo de inmediato (no espera los 120s).
  const fresh = ageMs < SYNC_FRESH_MS && !pullError

  // Verde SOLO si hubo ida y vuelta reciente confirmada. Si el SO dice "en red"
  // pero no hay bajada confirmada, es AMARILLO ("sin confirmar"): ese era el
  // falso verde que enganaba.
  let icon = '⚠️', label = 'Sin confirmar', cls = 'sync-badge--warn'
  if (!online) { icon = '📴'; label = 'Sin conexión'; cls = 'sync-badge--off' }
  else if (syncing) { icon = '🔄'; label = 'Sincronizando'; cls = 'sync-badge--busy' }
  else if (fresh) { icon = '☁️'; label = 'Sincronizada'; cls = 'sync-badge--ok' }

  const since = () => {
    if (!lastPullOkAt) return 'aún no confirmada en esta sesión'
    const s = Math.max(0, Math.round(ageMs / 1000))
    if (s < 60) return `hace ${s} s`
    const m = Math.round(s / 60)
    if (m < 60) return `hace ${m} min`
    return `hace ${Math.round(m / 60)} h`
  }

  const doSync = async () => {
    setBusy(true)
    setResult(null)
    const r = await manualSync()
    setResult(r)
    setBusy(false)
  }

  return (
    <div className="sync-wrap">
      <button
        className={`sync-badge ${cls}`}
        title={label}
        aria-label={`Sincronización: ${label}`}
        onClick={() => { setOpen((v) => !v); setResult(null) }}
      >
        {icon}
      </button>
      {open && (
        <>
          <div className="sync-pop__backdrop" onClick={() => setOpen(false)} />
          <div className="sync-pop" role="dialog" aria-label="Estado de sincronización">
            <p className="sync-pop__state">{icon} {label}</p>
            <p className="sync-pop__line">Última sincronización real: <strong>{since()}</strong></p>
            {!fresh && online && !syncing && (
              <p className="sync-pop__warn">
                La nube aparece activa pero no se confirma una bajada reciente. Pulsa
                “Sincronizar ahora” para verificar la conexión real con el servidor.
              </p>
            )}
            {pullError && <p className="sync-pop__err">Último error: {pullError}</p>}
            {result && (result.ok
              ? <p className="sync-pop__ok">✅ Sincronización confirmada.</p>
              : <p className="sync-pop__err">❌ {result.error}</p>
            )}
            <button className="btn btn--primary btn--sm" disabled={busy} onClick={doSync}>
              {busy ? 'Sincronizando…' : 'Sincronizar ahora'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// Aviso de licencia por vencer / en gracia / reloj atrasado. El dueño la renueva
// desde Ajustes; el aviso lo ven todos para que no los agarre por sorpresa.
function LicenseBanner() {
  const { status, daysLeft, graceLeft, clockBack } = useLicense()
  const plural = (n) => (Math.abs(n) === 1 ? '' : 's')
  if (clockBack) {
    return (
      <div className="license-bar license-bar--warn">
        ⏰ La fecha del dispositivo parece atrasada. Ajústala para evitar problemas con la licencia.
      </div>
    )
  }
  if (status === 'grace') {
    return (
      <div className="license-bar license-bar--danger">
        ⛔ Tu licencia caducó. Te queda{plural(graceLeft)} {graceLeft} día{plural(graceLeft)} de gracia — renuévala ya en Ajustes.
      </div>
    )
  }
  if (status === 'expiring') {
    return (
      <div className="license-bar license-bar--warn">
        ⚠️ Tu licencia vence en {daysLeft} día{plural(daysLeft)}. Renuévala pronto en Ajustes.
      </div>
    )
  }
  return null
}

// Mapa clave -> icono. Vive aqui, no en `lib/navSections.js`: asi el inventario
// de la barra es un modulo PURO que se prueba con node sin arrastrar lucide.
const NAV_ICONS = {
  home: Home, dashboard: LayoutDashboard, package: Package, shift: ScrollText,
  money: DollarSign, tables: UtensilsCrossed, swap: ArrowLeftRight, wallet: Wallet,
  in: PackagePlus, out: PackageMinus, send: Send, split: Split, factory: Factory,
  clipboard: ClipboardList, chef: ChefHat, pot: CookingPot, cocktail: Martini,
  file: FileText, book: BookOpen, shield: ShieldCheck, handshake: Handshake,
  calc: Calculator, sync: RefreshCw, save: Save, users: Users, settings: Settings,
  help: HelpCircle, remesas: Banknote
}

// Barra lateral de ESCRITORIO (>=1024px). Se monta siempre y el CSS la oculta por
// debajo de ese ancho con `display:none`, que ademas la saca del orden de
// tabulacion y del arbol de accesibilidad: en el telefono no existe ni para un
// lector de pantalla. Se hizo asi a proposito, en vez de preguntar el ancho desde
// JavaScript, porque HOY NINGUN COMPONENTE DE LA APP MIDE LA VENTANA (cero
// innerWidth, matchMedia y ResizeObserver en todo `src/`) y esa propiedad es la
// que permite afirmar que el movil no puede cambiar de comportamiento.
//
// Que entradas lleva lo decide `buildNavSections`, que es puro y tiene suite
// propia (`navSections.test.mjs`): las puertas de licencia y de rol no se
// escriben aqui a mano.
function SideNav({ sections }) {
  return (
    <nav className="app-side" aria-label="Secciones">
      <div className="app-side__inner">
        {sections.map((g) => (
          <div className="app-side__group" key={g.id}>
            {g.label && <p className="app-side__label">{g.label}</p>}
            {g.items.map((it) => {
              const Icon = NAV_ICONS[it.icon] || Home
              return (
                <NavLink
                  key={it.to + it.label}
                  to={it.to}
                  end={it.end}
                  className="side-item"
                  title={it.label}
                >
                  <Icon className="side-item__icon" size={17} strokeWidth={1.9} />
                  <span className="side-item__label">{it.label}</span>
                  {it.badge > 0 && (
                    <span className="side-item__badge" aria-label={`${it.badge} por cobrar`}>
                      {it.badge}
                    </span>
                  )}
                </NavLink>
              )
            })}
          </div>
        ))}
      </div>
    </nav>
  )
}

// Valor de partida de la consulta de configuracion, mientras resuelve. Es una
// constante de MODULO, no un objeto nuevo en cada render: lo que esta apagado no
// se pinta, que es el lado seguro (oculta, no cuela).
const NAV_DEFAULTS = {
  areas: [],
  elaboration: { enabled: false, name: 'Elaboración' },
  sellerEntries: false,
  sellerKitchenBoard: false,
  sellerCocktailBoard: false
}

// Shell de la app autenticada: cabecera fina + contenido + navegacion inferior.
// En escritorio (>=1024px) el mismo armazon se reordena por CSS en una rejilla
// con la navegacion a la izquierda; el JSX no pregunta por el ancho.
// La identidad rica (avatar, saludo, rol) vive en el Home; aqui solo la marca.
export function Layout({ children }) {
  const { logout, isOwner, isManager, isSeller, isElaborator, isCook, isCourier } = useAuth()
  const { canSell } = useShift()
  const { hasModule, modules } = useLicense()

  // Contexto de la barra lateral. Es UNA sola consulta viva (no cinco) para que
  // el coste de montarla en TODAS las pantallas sea el de una lectura de `config`,
  // que es la tabla mas pequena de la base. Solo LEE: la barra no escribe nada.
  const canKitchen = hasModule(LICENSE_MODULES.KITCHEN)
  const canCocktails = hasModule(LICENSE_MODULES.COCKTAILS)
  const navCfg = useLiveQuery(async () => ({
    areas: await configRepo.getAreas(),
    elaboration: await configRepo.getElaboration(),
    sellerEntries: await configRepo.get('sellerEntries', false),
    // Cada permiso se lee SOLO con su modulo: sin el no hay entrada que gatear, y
    // asi un negocio sin la licencia no paga ni la consulta.
    sellerKitchenBoard: canKitchen ? await configRepo.get('sellerKitchenBoard', true) : false,
    sellerCocktailBoard: canCocktails ? await configRepo.get('sellerCocktailBoard', false) : false
  }), [canKitchen, canCocktails], NAV_DEFAULTS)

  // Contador de entregas "por cobrar", el mismo que ya muestra el Inicio. Gateado
  // EN LA CONSULTA (no solo en el render): sin el modulo no se toca `remittances`.
  const canRemesas = isManager && hasModule(LICENSE_MODULES.REMESAS)
  const remittances = useLiveQuery(
    () => (canRemesas ? remittancesRepo.list() : Promise.resolve([])),
    [canRemesas],
    []
  )

  const sections = buildNavSections({
    isOwner, isManager, isSeller, isElaborator, isCook, isCourier, canSell,
    modules,
    ...navCfg,
    pendingCollection: remittances.filter(isPendingCollection).length
  })

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="brand brand--sm">MypiCuadre</span>
        <div className="app-header__right">
          <ThemeToggle />
          <SyncBadge />
          {isOwner && (
            <NotificationBoundary>
              <NotificationBell />
            </NotificationBoundary>
          )}
          {/* La "Ayuda" del encabezado se retiró para ganar espacio: sigue accesible
              desde la tarjeta "Ayuda" del Inicio (todos los roles) y la ruta /help. */}
          <button className="btn btn--ghost btn--sm app-header__exit" onClick={logout}>
            <LogOut size={16} strokeWidth={2} /> Salir
          </button>
        </div>
      </header>

      <LicenseBanner />

      <SideNav sections={sections} />

      <main className="app-main">{children}</main>

      <nav className="app-nav" aria-label="Navegación principal">
        <NavLink to="/" end className="nav-item">
          <Home size={21} strokeWidth={1.9} /><span>Inicio</span>
        </NavLink>
        {/* El mensajero (rol acotado de remesas) no maneja catalogo. */}
        {!isCourier && (
          <NavLink to="/catalog" className="nav-item">
            <Package size={21} strokeWidth={1.9} /><span>Catálogo</span>
          </NavLink>
        )}
        {/* El cocinero y el mensajero no manejan turno ni caja: sin pestaña Turno. */}
        {!isCook && !isCourier && (
          <NavLink to="/shift" className="nav-item">
            <ScrollText size={21} strokeWidth={1.9} /><span>Turno</span>
          </NavLink>
        )}
        {canSell && (
          <NavLink to="/sell" className="nav-item">
            <DollarSign size={21} strokeWidth={1.9} /><span>Vender</span>
          </NavLink>
        )}
        {isOwner && (
          <>
            <NavLink to="/settings" className="nav-item">
              <Settings size={21} strokeWidth={1.9} /><span>Ajustes</span>
            </NavLink>
            <NavLink to="/users" className="nav-item">
              <Users size={21} strokeWidth={1.9} /><span>Usuarios</span>
            </NavLink>
          </>
        )}
      </nav>
    </div>
  )
}
