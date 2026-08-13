import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../app/providers/AuthProvider'
import { useLiveQuery } from 'dexie-react-hooks'
import { configRepo } from '../../repositories/configRepo'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
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
  buildMermasReport,
  buildKitchenProduction,
  buildPostCloseSalesReport,
  buildForcedClosuresReport,
  exportExcel,
  exportPdf
} from './reportsService'

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
      // Modulo 'divisas': las columnas USD de los reportes se gatean por el módulo.
      const divisas = hasModule(LICENSE_MODULES.MULTICURRENCY)
      const report = await builder({ from, to, divisas })
      if (fmt === 'pdf') await exportPdf(report)
      else await exportExcel(report)
    } catch (e) {
      alert('No se pudo generar el reporte: ' + e.message)
    } finally {
      setBusy('')
    }
  }

  const card = (key, title, desc, builder, useRange) => (
    <section className="card">
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

      {card('sales', 'Ventas', 'Detalle de ventas por fecha, vendedor, área y metodo', buildSalesReport, true)}
      {card('seller', 'Ventas por vendedor', 'Productos, cantidades y fechas de lo vendido por cada vendedor', buildSellerSalesReport, true)}
      {card('shifts', 'Cierres de turno', 'Cuadre de cada turno cerrado, por área', buildShiftsReport, true)}
      {card('postclose', 'Ventas después del cierre', 'Ventas que quedaron registradas en un turno YA cerrado (posible descuadre): fecha, vendedor, área, cuándo se cerró el turno e importe MN', buildPostCloseSalesReport, true)}
      {card('forced', 'Cierres forzados', 'Turnos cerrados por el dueño/administrativo (no por el vendedor) y su diferencia de caja — para supervisión', buildForcedClosuresReport, true)}
      {card('entries', 'Entradas al almacén', 'Compras ingresadas al almacén central', buildEntriesReport, true)}
      {areas.length > 0 &&
        card('area', 'Ventas por área', 'Ingreso y ganancia por área y vendedor', buildAreaReport, true)}
      {areas.length > 0 &&
        card('transfers', 'Salidas almacén → área', 'Qué se sacó del almacén a cada área', buildTransfersReport, true)}
      {card('inv', 'Inventario por ubicación', 'Existencias en almacén y en cada área', buildInventoryReport, false)}
      {card('count', 'Conteo físico (submayor)', 'Conciliación por conteo aprobado: existencia inicial, ventas que la rebajan, teórico, físico y diferencia — áreas y almacén central', buildCountReport, true)}
      {card('mermas', 'Mermas', 'Rebajas por deterioro/pérdida (no son ventas): cantidad, precio de venta, costo e importe del costo (afectación al dueño)', buildMermasReport, true)}
      {hasModule(LICENSE_MODULES.ACCOUNTS) &&
        card('accounts', 'Movimientos de cuentas', 'Créditos y débitos de la tesorería, con saldos', buildAccountsReport, true)}
      {hasModule(LICENSE_MODULES.TABLES) &&
        card('tables', 'Ventas por mesa', 'Cuentas cobradas por mesa: consumo, servicio, total y ticket promedio', buildTablesReport, true)}
      {hasModule(LICENSE_MODULES.KITCHEN) &&
        card('kitchen', 'Producción de cocina', 'Elaboraciones de cocina: receta, área, unidades y costo (insumos y unitario del elaborado)', buildKitchenProduction, true)}
    </div>
  )
}
