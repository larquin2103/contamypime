import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'
import { MOVEMENT_TYPES, PARTNER_MOVEMENT_TYPES, WAREHOUSE } from '../db/constants'
import { ensureSystemAccount, addAccountMovementRaw } from './accountsRepo'

// Ventas de mostrador. Cada venta congela el precio y el costo de cada linea
// (snapshot), por lo que cambiar el precio mas tarde NO altera ventas previas.
// El descuento de inventario y el movimiento del libro mayor ocurren en la
// misma transaccion que la venta.
export const salesRepo = {
  async create({
    shiftId,
    sellerId,
    area = '', // area del turno donde se cobro la venta
    items,
    totalBase,
    paymentMethod = 'cash',
    // efectivo
    paymentCurrency = null,
    cashAmount = 0,
    amountPaid = 0,
    change = 0,
    // Moneda en que se ENTREGO el vuelto. Puede ser distinta a la del cobro
    // (ej: cobro en USD, vuelto en MN): el cuadre descuenta de esa caja.
    changeCurrency = null,
    changeRate = null,
    rate = null,
    // transferencia
    transferCurrency = null,
    transferAmount = 0,
    transferReference = '',
    transferSms = '',
    transferExpected = 0, // lo que se debia cobrar en la moneda de la transferencia
    // Bloque H (modulo mayorista): pago MIXTO en varias partes. Cada parte:
    // { method: 'cash'|'transfer', currency, amount, rate, amountBase, reference }.
    // Con payments, paymentMethod debe ser 'mixed' y los campos clasicos de
    // efectivo/transferencia quedan en cero (el cuadre suma por las partes).
    payments = null,
    // Bloque A (modulo mayorista): ubicacion de la que sale la mercancia. Vacio
    // = comportamiento clasico (el area del turno, o el almacen sin area).
    sourceLocation = '',
    // Bloque D (modulo cuentas): acreditar las cuentas de tesoreria en tiempo
    // real. Lo decide la pantalla segun la licencia; false = camino clasico.
    creditAccounts = false
  }) {
    const id = newId()
    const ts = now()
    const isCash = paymentMethod === 'cash'
    // Diferencia entre lo recibido por transferencia y lo que debia cobrarse.
    const transferDiff = isCash ? 0 : round2(Number(transferAmount || 0) - Number(transferExpected || 0))
    const shiftArea = String(area || '').trim()
    // Bloque 20: con stock por area, un vendedor solo vende lo asignado a SU
    // area; la "venta cruzada" queda retirada (hasCrossArea solo como dato
    // historico de ventas previas). El area del producto se guarda informativa.
    const hasCrossArea = false
    // La venta rebaja el stock de su ubicacion de ORIGEN: el area del turno por
    // defecto, o el almacen central si la venta es mayorista (Bloque A). El
    // dinero entra siempre a la caja del turno, sea cual sea el origen.
    const loc = String(sourceLocation || '').trim() || shiftArea || WAREHOUSE
    await db.transaction('rw', db.sales, db.stockMovements, db.products, db.partnerMovements, db.accounts, db.accountMovements, async () => {
      await db.sales.add({
        id,
        shiftId,
        sellerId,
        area: shiftArea,
        sourceLocation: loc,
        hasCrossArea,
        createdAt: ts,
        items, // [{ productId, name, unit, qty, unitPrice, unitCost, lineTotal, area }]
        totalBase,
        paymentMethod,
        // Contrato con shiftsRepo.getSummary: solo el efectivo entra a caja.
        // En transferencia, cashCurrency queda null para no afectar el cuadre de caja.
        paymentCurrency: isCash ? paymentCurrency : null,
        cashCurrency: isCash ? paymentCurrency : null,
        cashAmount: isCash ? cashAmount : 0,
        amountPaid: isCash ? amountPaid : 0,
        // El vuelto existe en efectivo y en mixto (por sobrepago); en
        // transferencia siempre es 0. Se guarda con la moneda en que se entrego.
        change: paymentMethod === 'transfer' ? 0 : round2(Number(change) || 0),
        changeCurrency: paymentMethod === 'transfer' ? null : (changeCurrency || paymentCurrency || null),
        changeRate,
        rate,
        // datos de transferencia (Fase 2)
        transferCurrency: isCash ? null : transferCurrency,
        transferAmount: isCash ? 0 : transferAmount,
        transferReference: isCash ? '' : transferReference,
        transferSms: isCash ? '' : transferSms,
        transferExpected: isCash ? 0 : round2(Number(transferExpected || 0)),
        transferDiff,
        // Partes del pago mixto (o null en ventas de un solo metodo).
        payments: Array.isArray(payments) && payments.length ? payments : null,
        voided: false
      })
      let hadConsignment = false // Opcion B: concepto del ingreso de la venta.
      for (const it of items) {
        const qty = Math.abs(Number(it.qty))
        await db.stockMovements.add({
          id: newId(),
          productId: it.productId,
          qty: -qty,
          type: MOVEMENT_TYPES.SALE_OUT,
          refType: 'sale',
          refId: id,
          unitCost: it.unitCost ?? null,
          shiftId,
          userId: sellerId,
          note: '',
          location: loc,
          createdAt: ts
        })
        const p = await db.products.get(it.productId)
        if (p) {
          const byLoc = { ...(p.stockByLocation || {}) }
          byLoc[loc] = Number(byLoc[loc] || 0) - qty
          await db.products.update(it.productId, {
            stock: Number(p.stock || 0) - qty,
            stockByLocation: byLoc,
            updatedAt: ts
          })
          // Consignacion (Bloque C, modulo cuentas): si el producto esta en
          // consignacion, cada venta acumula la deuda con su proveedor
          // (cantidad x costo acordado) en la misma transaccion. Los productos
          // sin la marca (todos, sin el modulo) no ejecutan este camino.
          const consig = p.consignment
          if (consig?.partnerId && Number(consig.unitCost) > 0) {
            hadConsignment = true
            await db.partnerMovements.add({
              id: newId(),
              partnerId: consig.partnerId,
              type: PARTNER_MOVEMENT_TYPES.CONSIGNMENT_DUE,
              amount: round2(qty * Number(consig.unitCost)),
              currency: 'MN',
              refType: 'sale',
              refId: id,
              productId: it.productId,
              qty,
              note: `Venta de ${it.name}`,
              userId: sellerId,
              createdAt: ts
            })
          }
        }
      }

      // Bloque D: acreditar la tesoreria en tiempo real (efectivo a su caja por
      // moneda, transferencias a su cuenta; en pago mixto, cada parte). Se hace
      // tras el bucle para conocer el CONCEPTO del ingreso (Opcion B): si la
      // venta incluyo algun producto consignado -> "consignación", si no
      // "ventas propias".
      if (creditAccounts) {
        const concept = hadConsignment ? 'consignment' : 'own'
        const move = async (method, currency, amount, direction = 'credit') => {
          const amt = Number(amount) || 0
          if (amt <= 0) return
          const accId = await ensureSystemAccount(method, currency || 'MN')
          await addAccountMovementRaw({
            accountId: accId,
            direction,
            amount: amt,
            currency: currency || 'MN',
            refType: 'sale',
            refId: id,
            concept,
            userId: sellerId,
            createdAt: ts
          })
        }
        const chg = round2(Number(change) || 0)
        const chgCur = changeCurrency || paymentCurrency
        if (Array.isArray(payments) && payments.length) {
          for (const p of payments) await move(p.method, p.currency, p.amount, 'credit')
          if (chg > 0) await move('cash', chgCur || 'MN', chg, 'debit') // vuelto por sobrepago
        } else if (isCash) {
          if (!chgCur || chgCur === paymentCurrency) {
            // Vuelto en la misma moneda del cobro: entra el NETO (como antes).
            await move('cash', paymentCurrency, cashAmount, 'credit')
          } else {
            // Vuelto en otra moneda: entra el bruto recibido y sale el vuelto.
            await move('cash', paymentCurrency, amountPaid, 'credit')
            await move('cash', chgCur, chg, 'debit')
          }
        } else {
          await move('transfer', transferCurrency, transferAmount, 'credit')
        }
      }
    })
    return id
  },

  async byShift(shiftId) {
    const rows = await db.sales.where('shiftId').equals(shiftId).toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  async listAll() {
    const rows = await db.sales.toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  async count() {
    return db.sales.count()
  }
}
