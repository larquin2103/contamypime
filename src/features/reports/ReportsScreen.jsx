import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../app/providers/AuthProvider'
import { useLiveQuery } from 'dexie-react-hooks'
import { configRepo } from '../../repositories/configRepo'
import {
  buildSalesReport,
  buildInventoryReport,
  buildShiftsReport,
  buildAreaReport,
  exportExcel,
  exportPdf
} from './reportsService'

export function ReportsScreen() {
  const { isOwner } = useAuth()
  const areas = useLiveQuery(() => configRepo.getAreas(), [], [])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState('')

  if (!isOwner) {
    return (
      <div className="screen">
        <h2>Reportes</h2>
        <p className="muted">Solo el dueño puede exportar reportes.</p>
        <Link className="btn btn--primary btn--block" to="/">Volver</Link>
      </div>
    )
  }

  const run = async (key, builder, fmt) => {
    setBusy(`${key}-${fmt}`)
    try {
      const report = await builder({ from, to })
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
      {card('shifts', 'Cierres de turno', 'Cuadre de cada turno cerrado, por área', buildShiftsReport, true)}
      {areas.length > 0 &&
        card('area', 'Ventas por área', 'Ingreso y ganancia por área + ventas cruzadas', buildAreaReport, true)}
      {card('inv', 'Inventario actual', 'Existencias, costo, precio y valor del inventario', buildInventoryReport, false)}
    </div>
  )
}
