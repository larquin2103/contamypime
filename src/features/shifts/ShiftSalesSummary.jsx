import { useLiveQuery } from 'dexie-react-hooks'
import { salesRepo } from '../../repositories/salesRepo'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { formatMoney } from '../../lib/currency'
import { formatDateTime } from '../../lib/dates'

// Resumen de las ventas del turno para el vendedor: por cada venta, sus
// articulos (descripcion / unidad / cantidad / importe) y el importe cobrado y
// el vuelto generado. Se nutre de salesRepo.byShift (datos ya guardados).
export function ShiftSalesSummary({ shiftId }) {
  const sales = useLiveQuery(() => salesRepo.byShift(shiftId), [shiftId], undefined)
  const { baseCurrency } = useCurrency()

  if (sales === undefined) return <p className="muted">Cargando…</p>
  const active = sales.filter((s) => !s.voided)
  if (!active.length) return <p className="muted">Aún no hay ventas en este turno.</p>

  const total = active.reduce((a, s) => a + Number(s.totalBase || 0), 0)

  return (
    <div className="sale-summary">
      <p className="muted">{active.length} venta(s) · total {formatMoney(total, baseCurrency)}</p>
      {active.map((s) => {
        const isCash = s.paymentMethod !== 'transfer'
        const cur = isCash ? s.cashCurrency || baseCurrency : s.transferCurrency || 'MN'
        const cobrado = isCash ? Number(s.amountPaid || 0) : Number(s.transferAmount || 0)
        const vuelto = isCash ? Number(s.change || 0) : 0
        return (
          <div key={s.id} className="sale-card">
            <div className="sale-card__head">
              <span className="muted">{formatDateTime(s.createdAt)}</span>
              <span className="badge badge--muted">{isCash ? 'Efectivo' : 'Transferencia'}</span>
            </div>
            <table className="sale-items">
              <thead>
                <tr>
                  <th>Descripción</th>
                  <th>U/M</th>
                  <th className="num">Cant.</th>
                  <th className="num">Importe</th>
                </tr>
              </thead>
              <tbody>
                {(s.items || []).map((it, i) => (
                  <tr key={i}>
                    <td>{it.name}</td>
                    <td>{it.unit}</td>
                    <td className="num">{it.qty}</td>
                    <td className="num">{formatMoney(it.lineTotal ?? it.unitPrice * it.qty, baseCurrency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="sale-card__foot">
              <span>Cobrado <strong>{formatMoney(cobrado, cur)}</strong></span>
              {isCash && <span>Vuelto <strong>{formatMoney(vuelto, cur)}</strong></span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
