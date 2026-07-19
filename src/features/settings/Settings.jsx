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
import { formatDateTime } from '../../lib/dates'
import { getStorageInfo } from '../../lib/storage'
import { licenseModules, LICENSE_MODULES, LICENSE_MODULE_LABELS } from '../../lib/license'

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

  return (
    <div className="screen">
      <h2>Ajustes</h2>
      <RatesSection userId={user.id} baseCurrency={baseCurrency} rates={rates} />
      <ConverterPreview baseCurrency={baseCurrency} rates={rates} />
      <AreasSection />
      <WholesaleSection />
      <SemaphoreSection />
      <DenominationsSection />
      <WhatsappSection />
      <BackupLinkSection />
      <ErrorLogLinkSection />
      <SecuritySection userId={user.id} />
      <LicenseSection />
    </div>
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

// Bloque A (modulo mayorista): permiso general para que el vendedor venda desde
// el almacen central SIN cerrar su turno. Solo aparece si la licencia trae el
// modulo; sin el, la app opera exactamente como la version clasica.
function WholesaleSection() {
  const { hasModule } = useLicense()
  const enabled = useLiveQuery(() => configRepo.get('sellerWarehouseSale', false), [], undefined)
  if (!hasModule(LICENSE_MODULES.WHOLESALE)) return null
  if (enabled === undefined) return null

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
