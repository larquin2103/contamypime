import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../app/providers/AuthProvider'
import { useLiveQuery } from 'dexie-react-hooks'
import { configRepo } from '../../repositories/configRepo'
import { remittancesRepo } from '../../repositories/remittancesRepo'
import { logError } from '../../lib/errorLog'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { RECIPE_KINDS } from '../../db/constants'
import { Accordion, AccordionSection as Section } from '../../components/Accordion'
import {
  buildSalesReport,
  buildSellerSalesReport,
  buildInventoryReport,
  buildShiftsReport,
  buildAreaReport,
  buildEntriesReport,
  buildTransfersReport,
  buildAccountsReport,
  buildCountReport,
  buildTablesReport,
  buildDiscountReconReport,
  buildMermasReport,
  buildKitchenProduction,
  buildPostCloseSalesReport,
  buildForcedClosuresReport,
  buildTransferReconReport,
  buildTransferDuplicatesReport,
  buildShiftPaymentReport,
  exportExcel,
  exportPdf
} from './reportsService'
import {
  buildRemittancesReport,
  buildDeliveriesReport,
  buildSettlementsReport,
  buildCollectionsReport,
  buildProductDeliveriesReport
} from './remesasReports'

export function ReportsScreen() {
  const { isManager } = useAuth()
  const { hasModule } = useLicense()
  const areas = useLiveQuery(() => configRepo.getAreas(), [], [])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState('')

  if (!isManager) {
    return (
      <div className="screen">
        <h2>Reportes</h2>
        <p className="muted">Solo el dueño o un administrativo puede exportar reportes.</p>
        <Link className="btn btn--primary btn--block" to="/">Volver</Link>
      </div>
    )
  }

  const run = async (key, builder, fmt) => {
    setBusy(`${key}-${fmt}`)
    try {
      // Módulo 'remesas': antes de LEER, repara el estado de las entregas en curso
      // a partir de la constancia del mensajero (ver
      // remittancesRepo.reconcileFromDeliveries) — una transición sellada con un
      // reloj atrasado puede perderse en la fusión y el reporte imprimiría
      // "Asignada" una entrega que ya se entregó. Va AQUÍ y no dentro de los
      // builders para que `remesasReports.js` siga siendo de SOLO LECTURA, como
      // todos los reportes. Idempotente y gateado por la licencia.
      // La reparacion es BEST-EFFORT: si falla, el reporte se genera igual (con el
      // estado de hoy) y el fallo queda en el registro local de errores. Una capa
      // nueva no puede tumbar un camino que ya funcionaba.
      if (key.startsWith('remesas') && hasModule(LICENSE_MODULES.REMESAS)) {
        try {
          await remittancesRepo.reconcileFromDeliveries()
        } catch (e) {
          logError('remesas', e)
        }
      }
      // Modulo 'divisas': las columnas USD de los reportes se gatean por el módulo.
      const divisas = hasModule(LICENSE_MODULES.MULTICURRENCY)
      // Módulos 'cocina'/'cocteleria': qué TIPOS de elaboración puede ver este
      // negocio. Lo usa el reporte de producción; el resto de builders lo ignora
      // (igual que `divisas`, que también se pasa a todos). Si el negocio no tiene
      // ninguno de los dos, la tarjeta no existe y este reporte no se genera.
      const kinds = [
        hasModule(LICENSE_MODULES.KITCHEN) && RECIPE_KINDS.KITCHEN,
        hasModule(LICENSE_MODULES.COCKTAILS) && RECIPE_KINDS.COCKTAIL
      ].filter(Boolean)
      const report = await builder({ from, to, divisas, kinds })
      if (fmt === 'pdf') await exportPdf(report)
      else await exportExcel(report)
    } catch (e) {
      alert('No se pudo generar el reporte: ' + e.message)
    } finally {
      setBusy('')
    }
  }

  // Título de la tarjeta de producción según los módulos: con solo 'cocina' dice
  // exactamente lo de siempre.
  const productionCardTitle = hasModule(LICENSE_MODULES.KITCHEN)
    ? (hasModule(LICENSE_MODULES.COCKTAILS) ? 'Producción de cocina y coctelería' : 'Producción de cocina')
    : 'Producción de coctelería'

  const card = (key, title, desc, builder, useRange) => (
    <section className="card" key={key}>
      <h3>{title}</h3>
      <p className="muted">{desc}{useRange ? ' (usa el rango de fechas).' : '.'}</p>
      <div className="report-actions">
        <button className="btn" disabled={!!busy} onClick={() => run(key, builder, 'excel')}>
          {busy === `${key}-excel` ? '...' : '⬇ Excel'}
        </button>
        <button className="btn" disabled={!!busy} onClick={() => run(key, builder, 'pdf')}>
          {busy === `${key}-pdf` ? '...' : '⬇ PDF'}
        </button>
      </div>
    </section>
  )

  // --- Catalogo de reportes, agrupado en CATEGORIAS ---------------------------
  // Eran 23 fichas seguidas: mas de siete pantallas de telefono de scroll, y el
  // problema crecia solo (el modulo de entregas aporta cinco). Se agrupan para
  // poder encontrarlas; el acordeon deja UNA categoria abierta a la vez.
  //
  // Esto es una reorganizacion VISUAL. Cada reporte conserva su `key`, su builder,
  // su descripcion y su compuerta de licencia EXACTAS: lo unico que cambia es en
  // que caja se pinta y en que orden. `show` va por reporte -no por categoria-
  // porque hay gates distintos dentro de un mismo grupo (por ejemplo, Inventario
  // mezcla reportes base con los de areas y los de cocina).
  const cats = [
    { id: 'cuentas', label: 'Cuentas', show: hasModule(LICENSE_MODULES.ACCOUNTS), items: [
      { key: 'accounts', title: 'Movimientos de cuentas', desc: 'Créditos y débitos de la tesorería, con saldos', builder: buildAccountsReport, range: true }
    ] },
    { id: 'entregas', label: 'Entregas', show: hasModule(LICENSE_MODULES.REMESAS), items: [
      { key: 'remesas', title: 'Entregas', desc: 'Órdenes de entrega: remitente, beneficiario, monto, estado y mensajero asignado', builder: buildRemittancesReport, range: true },
      { key: 'remesas-ent', title: 'Entregas realizadas', desc: 'Cada intento de entrega (entregada/fallida) con su mensajero, beneficiario y monto', builder: buildDeliveriesReport, range: true },
      { key: 'remesas-liq', title: 'Liquidaciones de mensajeros', desc: 'Cuadre del efectivo en custodia: teórico, contado, diferencia y resultado', builder: buildSettlementsReport, range: true },
      { key: 'remesas-cob', title: 'Cobros de entregas', desc: 'Todo el dinero cobrado al remitente (anticipado y contra entrega): beneficiario, quién pagó, cuenta y monto', builder: buildCollectionsReport, range: true },
      { key: 'remesas-prod', title: 'Entregas de producto', desc: 'Entregas de tipo producto: beneficiario, artículos, estado y mensajero', builder: buildProductDeliveriesReport, range: true }
    ] },
    { id: 'inventario', label: 'Inventario', items: [
      { key: 'entries', title: 'Entradas al almacén', desc: 'Compras ingresadas al almacén central', builder: buildEntriesReport, range: true },
      { key: 'transfers', title: 'Salidas almacén → área', desc: 'Qué se sacó del almacén a cada área', builder: buildTransfersReport, range: true, show: areas.length > 0 },
      { key: 'inv', title: 'Inventario por ubicación', desc: 'Existencias en almacén y en cada área', builder: buildInventoryReport, range: false },
      { key: 'count', title: 'Conteo físico (submayor)', desc: 'Conciliación por conteo aprobado: existencia inicial, ventas que la rebajan, teórico, físico y diferencia — áreas y almacén central', builder: buildCountReport, range: true },
      { key: 'mermas', title: 'Mermas', desc: 'Rebajas por deterioro/pérdida (no son ventas): cantidad, precio de venta, costo e importe del costo (afectación al dueño)', builder: buildMermasReport, range: true },
      // Una sola ficha para 'cocina' y 'cocteleria'; el builder filtra por los tipos
      // que la licencia permite, asi que no se cuela lo que no se compro.
      { key: 'kitchen', title: productionCardTitle, desc: 'Elaboraciones: receta, área, unidades y costo (insumos y unitario del elaborado)', builder: buildKitchenProduction, range: true, show: hasModule(LICENSE_MODULES.KITCHEN) || hasModule(LICENSE_MODULES.COCKTAILS) }
    ] },
    { id: 'transferencias', label: 'Transferencias', items: [
      { key: 'transrecon', title: 'Transferencias: esperado vs contabilizado', desc: 'Cuadre de transferencias por moneda y las ventas con diferencia (lo que se debía cobrar vs lo recibido por SMS)', builder: buildTransferReconReport, range: true },
      { key: 'transdup', title: 'Transferencias duplicadas', desc: 'Mismo Nº de Transacción del banco reusado en 2+ ventas (el dinero entró una sola vez). Barre todo el historial', builder: buildTransferDuplicatesReport, range: false }
    ] },
    { id: 'turnos', label: 'Turnos y caja', items: [
      { key: 'shifts', title: 'Cierres de turno', desc: 'Cuadre de cada turno cerrado, por área', builder: buildShiftsReport, range: true },
      { key: 'postclose', title: 'Ventas después del cierre', desc: 'Ventas que quedaron registradas en un turno YA cerrado (posible descuadre): fecha, vendedor, área, cuándo se cerró el turno e importe MN', builder: buildPostCloseSalesReport, range: true },
      { key: 'forced', title: 'Cierres forzados', desc: 'Turnos cerrados por el dueño/administrativo (no por el vendedor) y su diferencia de caja — para supervisión', builder: buildForcedClosuresReport, range: true },
      { key: 'shiftpay', title: 'Ventas del turno por método', desc: 'Por cada turno: subtotales Efectivo / Transferencia / Mixto y total (según el método de pago)', builder: buildShiftPaymentReport, range: true }
    ] },
    { id: 'ventas', label: 'Ventas', items: [
      { key: 'sales', title: 'Ventas', desc: 'Detalle de ventas por fecha, vendedor, área y metodo', builder: buildSalesReport, range: true },
      { key: 'seller', title: 'Ventas por vendedor', desc: 'Productos, cantidades y fechas de lo vendido por cada vendedor', builder: buildSellerSalesReport, range: true },
      { key: 'area', title: 'Ventas por área', desc: 'Ingreso y ganancia por área y vendedor', builder: buildAreaReport, range: true, show: areas.length > 0 },
      { key: 'tables', title: 'Ventas por mesa', desc: 'Cuentas cobradas por mesa: consumo, servicio, total y ticket promedio', builder: buildTablesReport, range: true, show: hasModule(LICENSE_MODULES.TABLES) },
      // Red de seguridad del descuento (C5): mesas cobradas completas pese a haber
      // un descuento autorizado en los eventos, que son append-only y no se pierden.
      { key: 'discrecon', title: 'Descuentos autorizados no aplicados', desc: 'Mesas cobradas completas aunque un mando había autorizado un descuento: quién lo autorizó, cuándo, y el importe que no se descontó', builder: buildDiscountReconReport, range: true, show: hasModule(LICENSE_MODULES.TABLES) }
    ] }
  ]

  // Orden ALFABETICO en los DOS niveles (categorias y reportes), que es lo que se
  // busca aqui: encontrar un reporte por su nombre. `localeCompare('es')` para que
  // los acentos y la ñ queden donde una persona los espera. Se ordena en el render
  // y no escribiendo la lista a mano porque el titulo de produccion CAMBIA segun
  // los modulos ("Producción de cocina" / "...y coctelería" / "...de coctelería").
  const byName = (a, b) => (a.label || a.title).localeCompare(b.label || b.title, 'es')
  const visibles = cats
    .filter((c) => c.show !== false)
    .map((c) => ({ ...c, items: c.items.filter((i) => i.show !== false).sort(byName) }))
    // Salvaguarda: una categoria cuyos reportes esten todos gateados no se pinta.
    // Hoy no puede pasar (las cuatro comunes tienen reportes base), pero si mañana
    // se mueve uno de sitio, no aparecera una categoria vacia.
    .filter((c) => c.items.length > 0)
    .sort(byName)

  return (
    <div className="screen">
      <h2>Reportes</h2>
      <p className="muted">Descarga reportes en Excel o PDF para compartir o archivar.</p>

      <section className="card">
        <h3>Rango de fechas</h3>
        <div className="form-row">
          <label className="field"><span>Desde</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="field"><span>Hasta</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <p className="muted">Vacio = todo el historial.</p>
      </section>

      {/* Una categoria abierta a la vez (mismo acordeon y mismo motion que el menu
          de Inicio). El RANGO DE FECHAS se queda fuera, fijo arriba: lo usan casi
          todos los reportes y no puede costar un toque mas. */}
      <Accordion storageKey="reports">
        {visibles.map((c) => (
          <Section key={c.id} id={c.id} label={c.label} layout="acc-stack">
            {c.items.map((i) => card(i.key, i.title, i.desc, i.builder, i.range))}
          </Section>
        ))}
      </Accordion>

    </div>
  )
}
