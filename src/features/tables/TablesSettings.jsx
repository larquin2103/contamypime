import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { configRepo } from '../../repositories/configRepo'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'

// ---------------------------------------------------------------------------
// Ajustes del modulo 'mesas': que mesas tiene cada area y que % de cargo por
// servicio se le suma a la cuenta. Sin el modulo NO se renderiza nada, asi que
// la pantalla de Ajustes queda identica a la version clasica.
//
// Quitar una mesa de la lista NO borra sus pedidos ni sus ventas (append-only):
// solo deja de ofrecerse para nuevas cuentas.
// ---------------------------------------------------------------------------
export function TablesSettings() {
  const { hasModule } = useLicense()
  const areas = useLiveQuery(() => configRepo.getAreas(), [], undefined)
  const tables = useLiveQuery(() => configRepo.getTables(), [], undefined)
  const charges = useLiveQuery(() => configRepo.getServiceCharges(), [], undefined)
  const tHeader = useLiveQuery(() => configRepo.get('ticketHeader', ''), [], undefined)
  const tFooter = useLiveQuery(() => configRepo.get('ticketFooter', ''), [], undefined)
  const [draft, setDraft] = useState({}) // nombre de mesa en curso, por area
  const [saved, setSaved] = useState(false)

  if (!hasModule(LICENSE_MODULES.TABLES)) return null
  if (areas === undefined || tables === undefined || charges === undefined) return null
  if (tHeader === undefined || tFooter === undefined) return null

  const flash = () => { setSaved(true); setTimeout(() => setSaved(false), 1200) }

  const addTable = async (area) => {
    const name = String(draft[area] || '').trim()
    if (!name) return
    const list = Array.isArray(tables[area]) ? tables[area] : []
    await configRepo.setTablesFor(area, [...list, name])
    setDraft((d) => ({ ...d, [area]: '' }))
    flash()
  }

  const removeTable = async (area, t) => {
    const list = Array.isArray(tables[area]) ? tables[area] : []
    await configRepo.setTablesFor(area, list.filter((x) => x !== t))
    flash()
  }

  // Agrega varias mesas de golpe: "Mesa 1 ... Mesa N" (comodidad al montar el salon).
  const addRange = async (area, n) => {
    const list = Array.isArray(tables[area]) ? tables[area] : []
    const extra = []
    for (let i = 1; i <= n; i++) extra.push(`Mesa ${list.length + i}`)
    await configRepo.setTablesFor(area, [...list, ...extra])
    flash()
  }

  const setCharge = async (area, pct) => {
    await configRepo.setServiceChargeFor(area, pct)
    flash()
  }

  return (
    <section className="card">
      <h3>🍽️ Mesas y cuentas</h3>
      <p className="muted">
        Define las mesas de cada área. Cada mesa lleva su cuenta abierta y se cobra
        por separado. El cargo por servicio se suma al total de la cuenta.
      </p>

      {areas.length === 0 && (
        <p className="muted">
          Primero crea al menos un <strong>área de venta</strong> arriba: las mesas
          pertenecen a un área.
        </p>
      )}

      {areas.map((area) => {
        const list = Array.isArray(tables[area]) ? tables[area] : []
        const pct = Number(charges[area]) || 0
        return (
          <div key={area} className="card">
            <div className="kv">
              <strong>{area}</strong>
              <span className="muted">{list.length} mesa(s)</span>
            </div>

            <label className="field">
              <span>Cargo por servicio (% sobre la cuenta)</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                value={pct}
                onChange={(e) => setCharge(area, e.target.value)}
                placeholder="0"
              />
            </label>
            {pct > 0
              ? <p className="muted">Se sumará <strong>{pct}%</strong> al total de cada cuenta de esta área.</p>
              : <p className="muted">Sin cargo por servicio en esta área.</p>}

            {list.length === 0
              ? <p className="muted">Aún no hay mesas en esta área.</p>
              : (
                <div className="chip-list">
                  {list.map((t) => (
                    <span key={t} className="chip">
                      {t}
                      <button
                        className="chip__x"
                        onClick={() => removeTable(area, t)}
                        aria-label={`Quitar ${t}`}
                        title="Quitar (no borra sus cuentas ni ventas)"
                      >×</button>
                    </span>
                  ))}
                </div>
              )}

            <div className="form-row">
              <label className="field">
                <span>Nueva mesa</span>
                <input
                  value={draft[area] || ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [area]: e.target.value }))}
                  placeholder="Ej: Mesa 6 · Terraza 2"
                  onKeyDown={(e) => { if (e.key === 'Enter') addTable(area) }}
                />
              </label>
              <button className="btn btn--ghost btn--sm" onClick={() => addTable(area)}>Agregar</button>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={() => addRange(area, 5)}>
              + Agregar 5 mesas seguidas
            </button>
          </div>
        )
      })}

      {/* Ticket de la impresora térmica (58 mm) */}
      <div className="card">
        <strong>🖨️ Ticket impreso</strong>
        <p className="muted">Encabezado y pie del comprobante que sale por la impresora (58 mm).</p>
        <label className="field">
          <span>Encabezado (nombre del negocio)</span>
          <input
            defaultValue={tHeader}
            placeholder="Ej: Cafetería La Esquina"
            onBlur={(e) => { configRepo.set('ticketHeader', e.target.value.trim()); flash() }}
          />
        </label>
        <label className="field">
          <span>Pie (mensaje final)</span>
          <input
            defaultValue={tFooter}
            placeholder="Ej: ¡Gracias por su visita!"
            onBlur={(e) => { configRepo.set('ticketFooter', e.target.value.trim()); flash() }}
          />
        </label>
      </div>

      {saved && <p className="ok-text">Guardado ✓</p>}
    </section>
  )
}
