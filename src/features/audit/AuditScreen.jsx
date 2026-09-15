import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { shiftsRepo } from '../../repositories/shiftsRepo'
import { salesRepo } from '../../repositories/salesRepo'
import { cashRepo } from '../../repositories/cashRepo'
import { stockRepo } from '../../repositories/stockRepo'
import { productsRepo } from '../../repositories/productsRepo'
import { usersRepo } from '../../repositories/usersRepo'
import { kitchenRepo } from '../../repositories/kitchenRepo'
import { transfersRepo } from '../../repositories/transfersRepo'
import { deliveriesRepo } from '../../repositories/deliveriesRepo'
import { settlementsRepo } from '../../repositories/settlementsRepo'
import { costSheetsRepo } from '../../repositories/costSheetsRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { formatMoney } from '../../lib/currency'
import { formatDateTime, localDay, dayLabel } from '../../lib/dates'
import { Accordion, AccordionSection as Section } from '../../components/Accordion'
import { cleanQty } from '../../lib/qty'
import { SEMAPHORE_EMOJI } from '../../lib/semaphore'
import { SHIFT_STATUS, locationLabel, areaLabel, COCINA, DELIVERY_RESULT, FICHA_AUDIT_LABELS, RECIPE_KINDS, recipeKind } from '../../db/constants'

const MOVE_LABEL = {
  purchase_in: 'Entrada (almacén)',
  sale_out: 'Venta',
  internal_debt_out: 'Deuda interna',
  adjustment: 'Ajuste',
  transfer_out: 'Salida a área',
  transfer_in: 'Entrada a área',
  partner_out: 'Entrega a tercero',
  // CONVERSION_* lo comparten cocina (elaboración) y mayorista (fraccionamiento):
  // etiqueta NEUTRAL para no mal-nombrar ninguno. El detalle de cocina va en su pestaña.
  conversion_out: 'Consumo (conversión)',
  conversion_in: 'Producción (conversión)',
  merma_out: 'Merma',
  // Modulo 'remesas': movimientos del area "Entregas" hacia/desde el mensajero.
  delivery_out: 'Carga a mensajero',
  delivery_in: 'Devolución de mensajero'
}

const MAX = 200

function inRange(iso, from, to) {
  const d = (iso || '').slice(0, 10)
  if (from && d < from) return false
  if (to && d > to) return false
  return true
}

// Agrupacion por DIA de una lista de Auditoria. Las siete pestañas planas (ventas,
// inventario, precios, bajas, elaboracion, entregas y fichas) son LA MISMA forma -una
// lista de registros con su fecha-, asi que se resuelve UNA vez y no siete.
//
// Es PRESENTACION y nada mas: recibe las filas YA filtradas y YA recortadas por la
// pantalla. Aqui no se filtra, no se reordena, no se recorta y no se lee nada. Las
// siete consultas devuelven de la mas nueva a la mas vieja (comprobado repo a repo) y
// un Map conserva ese orden de insercion, asi que los dias salen del mas reciente al
// mas antiguo sin volver a ordenar, y cada fila se pinta con el MISMO JSX de antes.
//
// El dia es el del NEGOCIO (`localDay`), no el UTC: un registro de las 8:51 p.m.
// pertenece al dia en que ocurrio. OJO -y es preexistente-: el filtro Desde/Hasta de
// arriba (`inRange`) SI compara el dia UTC, asi que en Cuba un registro de la noche
// cae fuera de un rango que termine ese mismo dia. Ese desajuste ya existia sin
// agrupacion; NO se toca aqui, que es logica.
//
// El contador de la cabecera va en GRIS (`muted`): en un historial inmutable no hay
// nada "pendiente", asi que la cabecera informa, no avisa. El rojo se reserva para lo
// que reclama trabajo (el dia con entregas por cobrar, el descubierto del tablero).
function DayGroups({ rows, empty, children }) {
  const days = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      const day = localDay(r.createdAt)
      if (!map.has(day)) map.set(day, [])
      map.get(day).push(r)
    }
    return [...map.entries()].map(([day, items]) => ({ day, items }))
  }, [rows])

  if (rows.length === 0) return <div className="list"><p className="muted">{empty}</p></div>

  // El dia mas reciente arranca ABIERTO. SIN `storageKey`: recordar un dia concreto no
  // sirve, porque mañana ese dia ya no es el de arriba.
  return (
    <Accordion defaultOpenId={days[0]?.day}>
      {days.map((g) => (
        <Section key={g.day} id={g.day} label={dayLabel(g.day)} badge={g.items.length} badgeTone="muted" layout="list">
          {g.items.map(children)}
        </Section>
      ))}
    </Accordion>
  )
}

// Icono de cada fila de la pestaña de elaboración (plato, trago o abastecimiento).
const ROW_ICON = { elaborado: '🍽️ ', trago: '🍹 ', abasto: '📦 ' }

export function AuditScreen() {
  const { isManager } = useAuth()
  const { baseCurrency } = useCurrency()
  const { hasModule } = useLicense()
  const canKitchen = hasModule(LICENSE_MODULES.KITCHEN)
  const canCocktails = hasModule(LICENSE_MODULES.COCKTAILS)
  // La pestaña de elaboración sirve a los dos módulos: con cualquiera de ellos existe.
  const canBoards = canKitchen || canCocktails
  const canRemesas = hasModule(LICENSE_MODULES.REMESAS)
  const canFichas = hasModule(LICENSE_MODULES.COSTSHEETS)
  const [tab, setTab] = useState('shifts')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const users = useLiveQuery(() => usersRepo.list(), [], [])
  const products = useLiveQuery(() => productsRepo.list(), [], [])
  const shifts = useLiveQuery(() => shiftsRepo.list(), [], [])
  const sales = useLiveQuery(() => salesRepo.listAll(), [], [])
  const cashMoves = useLiveQuery(() => cashRepo.listAll(), [], [])
  const movements = useLiveQuery(() => stockRepo.listAll(), [], [])
  const prices = useLiveQuery(() => productsRepo.allPriceChanges(), [], [])
  const deletions = useLiveQuery(() => productsRepo.listDeletions(), [], [])
  // Modulos 'cocina'/'cocteleria' (gateados EN LA CONSULTA): producciones (elaborados y
  // tragos) y abastecimientos a la cocina. Las producciones se leen con cualquiera de
  // los dos modulos y se FILTRAN por tipo mas abajo, para que no se cuele lo del modulo
  // que el negocio no tiene. Los abastecimientos son de `__cocina`: solo con 'cocina'.
  const productions = useLiveQuery(() => (canBoards ? kitchenRepo.listAll() : Promise.resolve([])), [canBoards], [])
  const kitchenTransfers = useLiveQuery(() => (canKitchen ? transfersRepo.listAll() : Promise.resolve([])), [canKitchen], [])
  // Modulo 'remesas' (gateado): entregas y liquidaciones para la auditoria.
  const rmDeliveries = useLiveQuery(() => (canRemesas ? deliveriesRepo.listAll() : Promise.resolve([])), [canRemesas], [])
  const rmSettlements = useLiveQuery(() => (canRemesas ? settlementsRepo.list() : Promise.resolve([])), [canRemesas], [])
  // Modulo 'fichas': el ciclo de vida de cada ficha de costo (creada, aprobada,
  // revisada, eliminada). El repo las escribe desde F2 y hasta F10 NADIE las
  // leia: eran dato ciego. Gateado EN LA CONSULTA, no solo en el render.
  const fichaEvents = useLiveQuery(() => (canFichas ? costSheetsRepo.listAudit() : Promise.resolve([])), [canFichas], [])

  const userName = useMemo(() => {
    const m = {}
    for (const u of users) m[u.id] = u.name
    return m
  }, [users])
  const prodName = useMemo(() => {
    const m = {}
    for (const p of products) m[p.id] = p.name
    return m
  }, [products])

  // Actividad de elaboracion (modulos 'cocina'/'cocteleria') para la auditoria:
  // elaboraciones (la de cocina con su salida al area; la de cocteleria se queda EN el
  // area) + abastecimientos a la cocina, en una lista cronologica unica. Cada fila de
  // produccion se filtra por el modulo de SU tipo: sin fugas.
  const cocinaRows = useMemo(() => {
    const elaborados = (productions || [])
      .filter((p) => (recipeKind(p) === RECIPE_KINDS.COCKTAIL ? canCocktails : canKitchen))
      .map((p) => {
        const isCocktail = recipeKind(p) === RECIPE_KINDS.COCKTAIL
        return {
          id: p.id, kind: isCocktail ? 'trago' : 'elaborado', createdAt: p.createdAt, userId: p.byUserId,
          title: p.recipeName || (isCocktail ? 'Trago' : 'Elaborado'),
          // En cocteleria no hay flecha a ninguna parte: se elabora y se queda ahi.
          detail: isCocktail
            ? `${cleanQty(p.units)} en ${areaLabel(p.toArea)}`
            : `${cleanQty(p.units)} → ${areaLabel(p.toArea)}`
        }
      })
    const abastos = (kitchenTransfers || [])
      .filter((t) => t.toArea === COCINA)
      .map((t) => ({
        id: t.id, kind: 'abasto', createdAt: t.createdAt, userId: t.byUserId,
        title: 'Abastecimiento a cocina', detail: `${(t.items || []).length} producto(s)`
      }))
    return [...elaborados, ...abastos].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }, [productions, kitchenTransfers, canKitchen, canCocktails])

  // Actividad de remesas (modulo 'remesas') para la auditoria: entregas
  // (entregada/fallida) y liquidaciones, en una lista cronologica unica.
  const remesaRows = useMemo(() => {
    const entregas = (rmDeliveries || []).map((d) => ({
      id: d.id, kind: 'entrega', createdAt: d.createdAt, userId: d.byUserId || d.courierId,
      title: d.result === DELIVERY_RESULT.DELIVERED ? '✅ Entregada' : '↩️ Devuelta (fallida)',
      detail: `${userName[d.courierId] || 'mensajero'}${d.note ? ` · ${d.note}` : ''}`
    }))
    const liqs = (rmSettlements || []).map((s) => ({
      id: s.id, kind: 'liquidacion', createdAt: s.settledAt || s.createdAt, userId: s.settledBy,
      title: `${SEMAPHORE_EMOJI[s.semaphore] || ''} Liquidación`,
      detail: `${userName[s.courierId] || 'mensajero'}`
    }))
    return [...entregas, ...liqs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }, [rmDeliveries, rmSettlements, userName])

  // Una fila por evento del ciclo de vida de una ficha. La accion se pinta con su
  // etiqueta (`FICHA_AUDIT_LABELS`), no en crudo, y la suite del motor exige que
  // las cuatro la tengan.
  const fichaRows = useMemo(
    () => (fichaEvents || []).map((e) => ({
      id: e.id,
      createdAt: e.createdAt,
      userId: e.userId,
      title: `${e.name || 'Ficha sin nombre'}${e.code ? ` · ${e.code}` : ''}`,
      detail: `${FICHA_AUDIT_LABELS[e.action] || e.action}${e.note ? ` · ${e.note}` : ''}`
    })),
    [fichaEvents]
  )

  if (!isManager) {
    return (
      <div className="screen">
        <h2>Auditoria</h2>
        <p className="muted">Solo el dueño o un administrativo puede ver la auditoria.</p>
        <Link className="btn btn--primary btn--block" to="/">Volver</Link>
      </div>
    )
  }

  const m = (n) => formatMoney(n, baseCurrency)

  const closedShifts = shifts.filter((s) => s.status === SHIFT_STATUS.CLOSED && inRange(s.closedAt, from, to))
  const salesF = sales.filter((s) => inRange(s.createdAt, from, to)).slice(0, MAX)
  const movesF = movements.filter((x) => inRange(x.createdAt, from, to)).slice(0, MAX)
  const pricesF = prices.filter((p) => inRange(p.createdAt, from, to)).slice(0, MAX)
  const deletionsF = deletions.filter((d) => inRange(d.createdAt, from, to)).slice(0, MAX)
  const cocinaF = cocinaRows.filter((x) => inRange(x.createdAt, from, to)).slice(0, MAX)
  const remesaF = remesaRows.filter((x) => inRange(x.createdAt, from, to)).slice(0, MAX)
  const fichaF = fichaRows.filter((x) => inRange(x.createdAt, from, to)).slice(0, MAX)

  return (
    <div className="screen">
      <h2>Auditoria</h2>
      <p className="muted">Historial inmutable: nada se borra. Cada registro guarda quien y cuando.</p>

      <div className="form-row">
        <label className="field"><span>Desde</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field"><span>Hasta</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>

      <div className="tabs tabs--scroll">
        <button className={`tab ${tab === 'shifts' ? 'is-active' : ''}`} onClick={() => setTab('shifts')}>Turnos</button>
        <button className={`tab ${tab === 'sales' ? 'is-active' : ''}`} onClick={() => setTab('sales')}>Ventas</button>
        <button className={`tab ${tab === 'inv' ? 'is-active' : ''}`} onClick={() => setTab('inv')}>Inventario</button>
        <button className={`tab ${tab === 'prices' ? 'is-active' : ''}`} onClick={() => setTab('prices')}>Precios</button>
        <button className={`tab ${tab === 'del' ? 'is-active' : ''}`} onClick={() => setTab('del')}>Bajas</button>
        {canBoards && (
          <button className={`tab ${tab === 'cocina' ? 'is-active' : ''}`} onClick={() => setTab('cocina')}>
            {canKitchen ? 'Cocina' : 'Coctelería'}
          </button>
        )}
        {canRemesas && (
          <button className={`tab ${tab === 'remesas' ? 'is-active' : ''}`} onClick={() => setTab('remesas')}>Entregas</button>
        )}
        {canFichas && (
          <button className={`tab ${tab === 'fichas' ? 'is-active' : ''}`} onClick={() => setTab('fichas')}>Fichas</button>
        )}
      </div>

      {tab === 'del' && (
        <DayGroups rows={deletionsF} empty="Sin bajas de productos en el rango.">
          {(d) => (
            <div key={d.id} className="audit-row">
              <div className="audit-row__head">
                <strong>{d.name}{d.code ? ` · ${d.code}` : ''}</strong>
                <span className="muted">{formatDateTime(d.createdAt)}</span>
              </div>
              <span className="muted">
                Eliminado del catálogo · {userName[d.userId] || 'dueño'}{d.note ? ` · ${d.note}` : ''}
              </span>
            </div>
          )}
        </DayGroups>
      )}

      {tab === 'shifts' && (
        <ShiftsAudit
          shifts={closedShifts}
          sales={sales}
          cashMoves={cashMoves}
          userName={userName}
          baseCurrency={baseCurrency}
        />
      )}

      {tab === 'sales' && (
        <DayGroups rows={salesF} empty="Sin ventas en el rango.">
          {(s) => (
            <div key={s.id} className="audit-row">
              <div className="audit-row__head">
                <strong>{m(s.totalBase)} · {s.paymentMethod === 'mixed' ? 'Mixto' : s.paymentMethod === 'transfer' ? 'Transferencia' : 'Efectivo'}</strong>
                <span className="muted">{formatDateTime(s.createdAt)}</span>
              </div>
              <span className="muted">
                {userName[s.sellerId] || 'vendedor'} · {(s.items || []).length} producto(s)
                {s.paymentMethod === 'transfer' && s.transferReference ? ` · ref ${s.transferReference}` : ''}
              </span>
            </div>
          )}
        </DayGroups>
      )}

      {tab === 'inv' && (
        <DayGroups rows={movesF} empty="Sin movimientos en el rango.">
          {(x) => (
            <div key={x.id} className="audit-row">
              <div className="audit-row__head">
                <strong>{MOVE_LABEL[x.type] || x.type} · {prodName[x.productId] || 'producto'}</strong>
                <span className={x.qty >= 0 ? 'ok-text' : 'warn-text'}>{x.qty > 0 ? '+' : ''}{x.qty}</span>
              </div>
              <span className="muted">
                {formatDateTime(x.createdAt)} · {locationLabel(x.location)} · {userName[x.userId] || '—'}{x.note ? ` · ${x.note}` : ''}
              </span>
            </div>
          )}
        </DayGroups>
      )}

      {tab === 'prices' && (
        <DayGroups rows={pricesF} empty="Sin cambios de precio en el rango.">
          {(p) => (
            <div key={p.id} className="audit-row">
              <div className="audit-row__head">
                <strong>{prodName[p.productId] || 'producto'}</strong>
                <span className="muted">{formatDateTime(p.createdAt)}</span>
              </div>
              <span className="muted">
                {p.kind === 'tiers' ? 'Escalas mayoristas' : `${m(p.oldPrice)} → ${m(p.newPrice)}`}
                {' '}· {userName[p.userId] || '—'}{p.note ? ` · ${p.note}` : ''}
              </span>
            </div>
          )}
        </DayGroups>
      )}

      {tab === 'cocina' && canBoards && (
        <DayGroups rows={cocinaF} empty={`Sin actividad de ${canKitchen ? 'cocina' : 'coctelería'} en el rango.`}>
          {(row) => (
            <div key={row.id} className="audit-row">
              <div className="audit-row__head">
                <strong>{ROW_ICON[row.kind] || '📦 '}{row.title}</strong>
                <span className="muted">{formatDateTime(row.createdAt)}</span>
              </div>
              <span className="muted">{row.detail} · {userName[row.userId] || '—'}</span>
            </div>
          )}
        </DayGroups>
      )}

      {tab === 'remesas' && canRemesas && (
        <DayGroups rows={remesaF} empty="Sin actividad de entregas en el rango.">
          {(row) => (
            <div key={row.id} className="audit-row">
              <div className="audit-row__head">
                <strong>{row.title}</strong>
                <span className="muted">{formatDateTime(row.createdAt)}</span>
              </div>
              <span className="muted">{row.detail} · {userName[row.userId] || '—'}</span>
            </div>
          )}
        </DayGroups>
      )}

      {/* Modulo 'fichas': quien creo, aprobo, reviso o elimino cada ficha de
          costo, y cuando. Una ficha aprobada es el documento con el que se
          sostuvo un precio, asi que su rastro importa tanto como el precio. */}
      {tab === 'fichas' && canFichas && (
        <DayGroups rows={fichaF} empty="Sin actividad de fichas de costo en el rango.">
          {(row) => (
            <div key={row.id} className="audit-row">
              <div className="audit-row__head">
                <strong>{row.title}</strong>
                <span className="muted">{formatDateTime(row.createdAt)}</span>
              </div>
              <span className="muted">{row.detail} · {userName[row.userId] || '—'}</span>
            </div>
          )}
        </DayGroups>
      )}
    </div>
  )
}

// Bloque F - Turnos agrupados e interactivos: el dueño agrupa los turnos
// cerrados por VENDEDOR o por FECHA, filtra por vendedor y expande cada turno
// para ver su detalle (cuadre, ventas y extracciones) sin salir de Auditoria.
function ShiftsAudit({ shifts, sales, cashMoves, userName, baseCurrency }) {
  const [groupBy, setGroupBy] = useState('seller') // 'seller' | 'date'
  const [seller, setSeller] = useState('')
  const [open, setOpen] = useState(null) // id del turno expandido

  const m = (n) => formatMoney(n, baseCurrency)

  // Ventas y extracciones por turno (para el resumen y el detalle).
  const salesByShift = useMemo(() => {
    const map = {}
    for (const s of sales) {
      if (s.voided) continue
      const e = map[s.shiftId] || (map[s.shiftId] = { count: 0, total: 0 })
      e.count++
      e.total += Number(s.totalBase || 0)
    }
    return map
  }, [sales])
  const withdrawalsByShift = useMemo(() => {
    const map = {}
    for (const c of cashMoves) {
      if (c.type !== 'withdrawal') continue
      const e = map[c.shiftId] || (map[c.shiftId] = {})
      e[c.currency] = (e[c.currency] || 0) + Number(c.amount || 0)
    }
    return map
  }, [cashMoves])

  const sellers = useMemo(() => {
    const ids = [...new Set(shifts.map((s) => s.sellerId))]
    return ids
      .map((id) => ({ id, name: userName[id] || 'vendedor' }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [shifts, userName])

  const filtered = seller ? shifts.filter((s) => s.sellerId === seller) : shifts

  // Agrupacion: por vendedor (nombre) o por dia de cierre (mas reciente primero).
  const groups = useMemo(() => {
    const map = new Map()
    for (const s of filtered) {
      const key = groupBy === 'seller'
        ? (userName[s.sellerId] || 'vendedor')
        : (s.closedAt || '').slice(0, 10)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(s)
    }
    const list = [...map.entries()].map(([label, items]) => ({
      label,
      items: items.sort((a, b) => (a.closedAt < b.closedAt ? 1 : -1))
    }))
    return groupBy === 'seller'
      ? list.sort((a, b) => a.label.localeCompare(b.label))
      : list.sort((a, b) => (a.label < b.label ? 1 : -1))
  }, [filtered, groupBy, userName])

  const currenciesOf = (s) => [
    ...new Set([
      ...Object.keys(s.expectedCash || {}),
      ...Object.keys(s.declaredCash || {})
    ])
  ]

  return (
    <>
      <div className="form-row">
        <label className="field">
          <span>Agrupar por</span>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            <option value="seller">Vendedor</option>
            <option value="date">Fecha</option>
          </select>
        </label>
        <label className="field">
          <span>Vendedor</span>
          <select value={seller} onChange={(e) => setSeller(e.target.value)}>
            <option value="">Todos</option>
            {sellers.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Los grupos son los MISMOS de siempre -los arma el useMemo de arriba, que no se
          toca-; lo unico que cambia es que se pliegan uno a uno en vez de salir
          todos abiertos a la vez. La cabecera conserva su etiqueta y su resumen, que es
          justo lo que hay que ver con el grupo cerrado. `key={groupBy}` remonta el
          acordeon al cambiar de Vendedor a Fecha: sin el, las claves viejas ya no
          existirian y quedaria todo cerrado. */}
      <Accordion key={groupBy} defaultOpenId={groups[0]?.label}>
        {groups.map((g) => {
          const totalG = g.items.reduce((a, s) => a + (salesByShift[s.id]?.total || 0), 0)
          return (
            // El resumen se acorta ("11 turnos" en vez de "11 turno(s) · vendido"):
            // medido a 360 px, el texto largo empujaba tanto que un nombre como "Maria
            // de los Angeles" se recortaba a "MAR...". En Auditoria saber DE QUIEN es el
            // grupo pesa mas que el importe, y el importe se sigue viendo entero.
            <Section
              key={g.label}
              id={g.label}
              label={groupBy === 'date' ? `📅 ${g.label}` : `👤 ${g.label}`}
              badge={`${g.items.length} turno${g.items.length === 1 ? '' : 's'} · ${m(totalG)}`}
              badgeTone="muted"
              layout="list"
            >
              {g.items.map((s) => {
                const sl = salesByShift[s.id] || { count: 0, total: 0 }
                const isOpen = open === s.id
                return (
                  <div key={s.id} className="audit-row">
                    <button
                      className="audit-row__toggle"
                      onClick={() => setOpen(isOpen ? null : s.id)}
                    >
                      <div className="audit-row__head">
                        <strong>
                          {SEMAPHORE_EMOJI[s.semaphore] || ''}{' '}
                          {groupBy === 'date' ? (userName[s.sellerId] || 'vendedor') : formatDateTime(s.closedAt)}
                          {s.area ? ` · ${areaLabel(s.area)}` : ''}
                        </strong>
                        <span className="muted">{isOpen ? '▾' : '▸'}</span>
                      </div>
                      <span className="muted">
                        {sl.count} venta(s) · {m(sl.total)} · Dif {m(s.difference?.[baseCurrency] ?? 0)}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="audit-detail">
                        <div className="kv"><span className="muted">Abierto</span><strong>{formatDateTime(s.openedAt)}</strong></div>
                        <div className="kv"><span className="muted">Cerrado</span><strong>{formatDateTime(s.closedAt)}</strong></div>
                        {currenciesOf(s).map((cur) => (
                          <div key={cur} className="kv">
                            <span className="muted">Caja {cur}</span>
                            <strong>
                              esperado {formatMoney(s.expectedCash?.[cur] ?? 0, cur)} ·
                              declarado {formatMoney(s.declaredCash?.[cur] ?? 0, cur)} ·
                              dif {formatMoney(s.difference?.[cur] ?? 0, cur)}
                            </strong>
                          </div>
                        ))}
                        {withdrawalsByShift[s.id] && (
                          <div className="kv">
                            <span className="muted">Extracciones</span>
                            <strong>
                              {Object.entries(withdrawalsByShift[s.id])
                                .map(([cur, amt]) => formatMoney(amt, cur))
                                .join(' · ')}
                            </strong>
                          </div>
                        )}
                        <div className="audit-flags">
                          {s.forced && <span className="flag flag--warn">cerrado por dueño</span>}
                          {s.countSkipped && <span className="flag flag--warn">sin conteo de billetes</span>}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </Section>
          )
        })}
      </Accordion>
      {groups.length === 0 && <p className="muted">Sin turnos cerrados en el rango.</p>}
    </>
  )
}
