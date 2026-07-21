import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { salesRepo } from '../../repositories/salesRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
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
  const [busy, setBusy] = useState(false)

  if (sales === undefined) return <p className="muted">Cargando…</p>
  const active = sales.filter((s) => !s.voided)
  if (!active.length) return <p className="muted">Aún no hay ventas en este turno.</p>

  const total = active.reduce((a, s) => a + Number(s.totalBase || 0), 0)

  const exportPdf = async () => {
    setBusy(true)
    try {
      const { buildShiftSalesReport, exportPdf: toPdf } = await import('../reports/reportsService')
      const report = await buildShiftSalesReport(shiftId, user?.name || '')
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
      {active.map((s) => {
        const isMixed = s.paymentMethod === 'mixed'
        const isCash = !isMixed && s.paymentMethod !== 'transfer'
        const cur = isMixed ? baseCurrency : isCash ? s.cashCurrency || baseCurrency : s.transferCurrency || 'MN'
        // En pago mixto se cobra el total exacto (los detalles, por partes).
        const cobrado = isMixed
          ? Number(s.totalBase || 0)
          : isCash ? Number(s.amountPaid || 0) : Number(s.transferAmount || 0)
        const vuelto = isCash ? Number(s.change || 0) : 0
        // El vuelto puede haberse entregado en otra moneda distinta a la del cobro.
        const vueltoCur = s.changeCurrency || cur
        return (
          <div key={s.id} className="sale-card">
            <div className="sale-card__head">
              <span className="muted">{formatDateTime(s.createdAt)}</span>
              <span className="badge badge--muted">{isMixed ? 'Mixto' : isCash ? 'Efectivo' : 'Transferencia'}</span>
            </div>
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
            <div className="sale-card__foot">
              <span>Cobrado <strong>{formatMoney(cobrado, cur)}</strong></span>
              {isCash && <span>Vuelto <strong>{formatMoney(vuelto, vueltoCur)}</strong></span>}
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
