import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'

// Entregas (modulo 'remesas') — bitacora APPEND-ONLY: una fila por intento/
// resultado de entrega (patron `orderItems`: las adiciones de dos dispositivos se
// FUSIONAN por id en vez de pisarse). El movimiento de efectivo lo lleva el libro
// de custodia (custodyMovements); aqui solo queda la constancia de la entrega
// (resultado, comprobante opcional, nota). Nada se borra.
export const deliveriesRepo = {
  // Fila cruda. SIN transaccion propia: pensada para llamarse DENTRO de una
  // transaccion (igual que custodyRepo.addMovementRaw). El id puede pasarse
  // DETERMINISTA (delivery:<remesa>) para que dos dispositivos generen el MISMO
  // doc y la sync no duplique.
  async addRaw({
    id = null,
    remittanceId,
    courierId = null,
    result,
    proofDataUrl = '',
    note = '',
    byUserId = null,
    createdAt = null
  }) {
    if (!remittanceId) throw new Error('Entrega sin remesa')
    const rowId = id || newId()
    await db.deliveries.add({
      id: rowId,
      remittanceId,
      courierId,
      result,
      proofDataUrl: proofDataUrl || '',
      note: String(note || '').trim(),
      voided: false,
      byUserId,
      createdAt: createdAt || now()
    })
    return rowId
  },

  async forRemittance(remittanceId) {
    const rows = await db.deliveries.where('remittanceId').equals(remittanceId).toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  async listAll() {
    const rows = await db.deliveries.toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }
}
