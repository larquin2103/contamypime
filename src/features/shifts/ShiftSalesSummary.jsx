import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { salesRepo } from '../../repositories/salesRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { formatMoney } from '../../lib/currency'
import { formatDateTime } from '../../lib/dates'

// Resumen de las ventas del turno para el vendedor: por cada venta, sus
// articulos (descripcion / unidad / cantidad / importe) y el importe cobrado y
// el vuelto generado. Se nutre de salesRepo.byShift (datos ya guardados).
// El vendedor puede exportarlas a PDF.
export function ShiftSalesSummary({ shiftId }) {
  const sales = useLiveQuery(() => salesRepo.byShift(shiftId), [shiftId], undefined)
  const { baseCurrency } = useCurrency()
  const { user } = useAuth()
  const { hasModule } = useLicense()
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('all') // Bloque 3: filtro por metodo de pago

  if (sales === undefined) return <p className="muted">Cargando…</p>
  const active = sales.filter((s) => !s.voided)
  if (!active.length) return <p className="muted">Aún no hay ventas en este turno.</p>

  const total = active.reduce((a, s) => a + Number(s.totalBase || 0), 0)

  // Bloque 3: agrupar por metodo de pago. La clasificacion es IDENTICA a la de
  // cada tarjeta (mixto / efectivo / transferencia). Se calculan subtotales por
  // metodo y el filtro solo aparece cuando hay MAS de un metodo (si no, la vista
  // queda identica al clasico: sin chips ni desglose).
  const methodOf = (s) => (s.paymentMethod === 'mixed' ? 'mixed' : s.paymentMethod === 'transfer' ? 'transfer' : 'cash')
  const groups = { cash: { n: 0, sum: 0 }, transfer: { n: 0, sum: 0 }, mixed: { n: 0, sum: 0 } }
  for (const s of active) {
    const g = groups[methodOf(s)]
    g.n += 1
    g.sum += Number(s.totalBase || 0)
  }
  const METHODS = [['cash', 'Efectivo'], ['transfer', 'Transferencia'], ['mixed', 'Mixto']]
  const present = METHODS.filter(([k]) => groups[k].n > 0)
  const showFilter = present.length > 1
  // Si el filtro elegido ya no tiene ventas (p.ej. se anularon), vuelve a "Todos".
  const activeFilter = present.some(([k]) => k === filter) ? filter : 'all'
  const shown = showFilter && activeFilter !== 'all' ? active.filter((s) => methodOf(s) === activeFilter) : active

  const exportPdf = async () => {
    setBusy(true)
    try {
      const { buildShiftSalesReport, exportPdf: toPdf } = await import('../reports/reportsService')
      const report = await buildShiftSalesReport(shiftId, user?.name || '', hasModule(LICENSE_MODULES.MULTICURRENCY))
      await toPdf(report)
    } catch (e) {
      alert('No se pudo exportar el PDF: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sale-summary">
      <div className="sale-summary__top">
        <p className="muted">{active.length} venta(s) · total {formatMoney(total, baseCurrency)}</p>
        <button className="btn btn--ghost btn--sm" disabled={busy} onClick={exportPdf}>
          {busy ? '...' : '⬇ PDF'}
        </button>
      </div>
      {showFilter && (
        <>
          <p className="muted">
            {present.map(([k, label]) => `${label}: ${formatMoney(groups[k].sum, baseCurrency)}`).join(' · ')}
          </p>
          <div className="period-row">
            <button
              className={`btn btn--sm ${activeFilter === 'all' ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => setFilter('all')}
            >
              Todos ({active.length})
            </button>
            {present.map(([k, label]) => (
              <button
                key={k}
                className={`btn btn--sm ${activeFilter === k ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => setFilter(k)}
              >
                {label} ({groups[k].n})
              </button>
            ))}
          </div>
        </>
      )}
      {shown.map((s) => {
        const isMixed = s.paymentMethod === 'mixed'
        const isCash = !isMixed && s.paymentMethod !== 'transfer'
        const cur = isMixed ? baseCurrency : isCash ? s.cashCurrency || baseCurrency : s.transferCurrency || 'MN'
        // En pago mixto se cobra el total exacto (los detalles, por partes).
        const cobrado = isMixed
          ? Number(s.totalBase || 0)
          : isCash ? Number(s.amountPaid || 0) : Number(s.transferAmount || 0)
        // Vuelto: efectivo (cambio) y mixto (sobrepago). En transferencia no hay.
        const vuelto = s.paymentMethod === 'transfer' ? 0 : Number(s.change || 0)
        // El vuelto puede haberse entregado en otra moneda distinta a la del cobro.
        const vueltoCur = s.changeCurrency || cur
        return (
          <div key={s.id} className="sale-card">
            <div className="sale-card__head">
              <span className="muted">{formatDateTime(s.createdAt)}</span>
              <span className="badge badge--muted">{isMixed ? 'Mixto' : isCash ? 'Efectivo' : 'Transferencia'}</span>
            </div>
            <div className="sale-items__scroll">
            <table className="sale-items">
              <thead>
                <tr>
                  <th>Descripción</th>
                  <th>U/M</th>
                  <th className="num">Cant.</th>
                  <th className="num">Precio</th>
                  <th className="num">Importe</th>
                </tr>
              </thead>
              <tbody>
                {(s.items || []).map((it, i) => (
                  <tr key={i}>
                    <td>{it.name}</td>
                    <td>{it.unit}</td>
                    <td className="num">{it.qty}</td>
                    <td className="num">{formatMoney(it.unitPrice ?? (it.lineTotal / (it.qty || 1)), baseCurrency)}</td>
                    <td className="num">{formatMoney(it.lineTotal ?? it.unitPrice * it.qty, baseCurrency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <div className="sale-card__foot">
              <span>Cobrado <strong>{formatMoney(cobrado, cur)}</strong></span>
              {vuelto > 0 && <span>Vuelto <strong>{formatMoney(vuelto, vueltoCur)}</strong></span>}
            </div>
            {isMixed && (
              <p className="muted">
                {(s.payments || [])
                  .map((p) => `${p.method === 'transfer' ? 'Transf.' : 'Efectivo'} ${formatMoney(Number(p.amount) || 0, p.currency)}`)
                  .join(' + ')}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
