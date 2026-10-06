// Avisos del conteo fisico: reglas puras. Se corre con node directo.
import { COUNT_STALE_HOURS, hoursSince, isStale, isSelfApproval } from './countWarnings.js'
let pass = 0
let fail = 0
const ok = (c, l) => { if (c) pass++; else { fail++; console.error('FAIL', l) } }
const N = Date.parse('2026-10-02T12:00:00.000Z')
ok(COUNT_STALE_HOURS === 8, 'umbral D2 = 8 h')
ok(hoursSince('2026-10-02T04:00:00.000Z', N) === 8, '8 h exactas')
ok(hoursSince(null, N) === 0 && hoursSince('basura', N) === 0, 'sin fecha o invalida -> 0')
ok(hoursSince('2026-10-03T00:00:00.000Z', N) === 0, 'fecha futura (reloj adelantado) -> 0, nunca negativo')
ok(isStale('2026-10-02T04:00:00.000Z', N) === true, 'en el umbral ya es viejo')
ok(isStale('2026-10-02T04:00:00.001Z', N) === false, 'un ms antes del umbral no')
ok(isStale('2026-10-01T00:00:00.000Z', N, 48) === false, 'umbral explicito')
ok(isSelfApproval({ createdBy: 'a' }, 'a') === true, 'autoaprobacion')
ok(isSelfApproval({ createdBy: 'a' }, 'b') === false, 'otro aprueba')
ok(isSelfApproval(null, 'a') === false && isSelfApproval({ createdBy: null }, null) === false, 'nulos -> false')
console.log(`countWarnings: ${pass} OK / ${fail} fallos`)
if (fail) process.exit(1)
