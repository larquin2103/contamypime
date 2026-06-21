import { SEMAPHORE } from '../db/constants'

// Evalua el cuadre comparando lo declarado contra lo esperado.
//  green  : cuadra (dentro del margen verde)
//  yellow : diferencia menor
//  red    : diferencia critica
export function evalSemaphore(expected, declared, config) {
  const greenMaxPct = config?.greenMaxPct ?? 1
  const yellowMaxPct = config?.yellowMaxPct ?? 3
  const diff = round(declared - expected)
  const base = Math.abs(expected)
  const pct = base === 0 ? (diff === 0 ? 0 : 100) : (Math.abs(diff) / base) * 100

  let color = SEMAPHORE.RED
  if (pct <= greenMaxPct) color = SEMAPHORE.GREEN
  else if (pct <= yellowMaxPct) color = SEMAPHORE.YELLOW

  return { color, diff, pct: round(pct) }
}

function round(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export const SEMAPHORE_EMOJI = {
  [SEMAPHORE.GREEN]: '🟢',
  [SEMAPHORE.YELLOW]: '🟡',
  [SEMAPHORE.RED]: '🔴'
}
