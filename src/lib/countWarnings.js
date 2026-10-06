// Avisos del conteo fisico (auditoria de Rikisimo, 06-10-2026): borradores abiertos 26-98 h
// mientras se vendia y aprobaciones dias despues del envio. Puras: no escriben nada; la
// pantalla solo AVISA, nunca bloquea.
export const COUNT_STALE_HOURS = 8

// Horas transcurridas desde `iso`. Sin fecha, invalida o en el futuro (reloj del otro
// telefono adelantado) da 0: un aviso nunca puede nacer de una fecha rota.
export function hoursSince(iso, nowMs) {
  const t = Date.parse(iso || '')
  if (!Number.isFinite(t)) return 0
  return Math.max(0, (nowMs - t) / 36e5)
}

export function isStale(iso, nowMs, limit = COUNT_STALE_HOURS) {
  return hoursSince(iso, nowMs) >= limit
}

export function isSelfApproval(count, approverId) {
  return !!count && !!approverId && count.createdBy === approverId
}
