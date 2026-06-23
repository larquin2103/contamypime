import { formatMoney } from './currency'
import { SEMAPHORE_EMOJI } from './semaphore'

// Abre WhatsApp con un texto prellenado (wa.me). Funciona online (es para
// avisar al dueño; el resto de la app sigue siendo offline).
export function openWhatsapp(number, text) {
  const num = String(number || '').replace(/[^0-9]/g, '')
  const base = num ? `https://wa.me/${num}` : 'https://wa.me/'
  window.open(`${base}?text=${encodeURIComponent(text)}`, '_blank')
}

// Comparte un archivo por el menu nativo (Web Share API). Devuelve true si se
// pudo compartir; false si el dispositivo no lo soporta (hay que descargar).
export async function shareFile(blob, filename, text) {
  try {
    const file = new File([blob], filename, { type: blob.type || 'application/json' })
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Turno MypiCuadre', text })
      return true
    }
  } catch {
    /* cancelado o no soportado */
  }
  return false
}

// Reporte de cierre para enviar al dueño.
export function buildCloseReport(result, fromName) {
  const { shift, base, expectedCash, declared, difference, semaphore, salesCount, transfersByCur, internalDebtTotal } =
    result
  const emoji = SEMAPHORE_EMOJI[semaphore.color]
  const lines = [
    `${emoji} Cierre de turno — MypiCuadre`,
    `Vendedor: ${fromName}`,
    `Punto: ${shift.point}`,
    '',
    `Esperado: ${formatMoney(expectedCash[base], base)}`,
    `Declarado: ${formatMoney(declared[base], base)}`,
    `Diferencia: ${formatMoney(difference[base], base)} (${semaphore.pct}%)`,
    `Ventas: ${salesCount}`
  ]
  const transfers = Object.entries(transfersByCur || {})
  if (transfers.length) {
    lines.push(`Transferencias: ${transfers.map(([c, v]) => formatMoney(v, c)).join(' · ')}`)
  }
  if (internalDebtTotal > 0) lines.push(`Deuda interna: ${formatMoney(internalDebtTotal)}`)
  return lines.join('\n')
}
