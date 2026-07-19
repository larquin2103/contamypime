import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { licenseRepo } from '../../repositories/licenseRepo'
import { evaluateLicense, licenseModules, today } from '../../lib/license'

const LicenseContext = createContext(null)

const WARN_DAYS = 7   // avisa "por vencer" con esta antelacion
const GRACE_DAYS = 3  // dias de gracia tras caducar antes del bloqueo total
const REVALIDATE_INTERVAL = 5 * 60 * 1000  // polling cada 5 minutos para detectar caducidad en vivo

// ---------------------------------------------------------------------------
// Fase 5 - Bloque 28/29: estado de la licencia a nivel de app.
//
//  - Lee el token y la marca de agua de fecha desde `config` (reactivo).
//  - ANTI-TRAMPA DE RELOJ: la "fecha efectiva" nunca es menor que la mayor
//    fecha ya vista (licenseLastSeen). Asi, atrasar el reloj del dispositivo
//    NO revive una licencia caducada. La marca de agua solo avanza.
//  - PERIODO DE GRACIA: tras caducar, sigue abriendo unos dias (GRACE_DAYS)
//    con aviso fuerte, antes del bloqueo total.
//
// status: 'none' | 'invalid' | 'expired' | 'grace' | 'expiring' | 'active'
// La COMPUERTA del router deja pasar si `unlocked` (active/expiring/grace).
// ---------------------------------------------------------------------------
export function LicenseProvider({ children }) {
  const token = useLiveQuery(() => licenseRepo.getToken(), [], undefined)
  const lastSeen = useLiveQuery(() => licenseRepo.getLastSeen(), [], undefined)
  const [state, setState] = useState({
    ready: false, status: 'none', payload: null, daysLeft: null, clockBack: false, graceLeft: null
  })

  useEffect(() => {
    if (token === undefined || lastSeen === undefined) return // aun cargando de Dexie
    let alive = true
    let pollInterval = null

    const evaluate = async () => {
      const sysToday = today()
      // Fecha efectiva: nunca menor que la mayor fecha ya vista (anti atraso).
      const effective = lastSeen && lastSeen > sysToday ? lastSeen : sysToday
      const clockBack = !!(lastSeen && sysToday < lastSeen)

      const ev = await evaluateLicense(token, { nowDate: effective, warnDays: WARN_DAYS })
      let status = ev.status
      let graceLeft = null
      // Recien caducada pero dentro de la gracia -> sigue abriendo, con aviso.
      if (ev.status === 'expired' && ev.daysLeft >= -GRACE_DAYS) {
        status = 'grace'
        graceLeft = GRACE_DAYS + ev.daysLeft // dias de gracia que quedan
      }

      if (!alive) return
      setState({ ready: true, status, payload: ev.payload, daysLeft: ev.daysLeft, clockBack, graceLeft })

      // Avanza la marca de agua (monotona). Solo escribe si crece -> estable.
      if (!lastSeen || sysToday > lastSeen) {
        await licenseRepo.setLastSeen(sysToday)
      }
    }

    ;(async () => {
      await evaluate()
      // Polling periodico: revalida cada REVALIDATE_INTERVAL para detectar caducidad
      // en vivo (caso: app abierta durante >24h, pasa medianoche y caduca).
      // Si el estado baja de unlocked a locked, la compuerta del router reenvia a
      // ActivationScreen en el siguiente render.
      pollInterval = setInterval(evaluate, REVALIDATE_INTERVAL)
    })()

    return () => {
      alive = false
      if (pollInterval) clearInterval(pollInterval)
    }
  }, [token, lastSeen])

  // Verifica firma + vigencia + que el negocio coincida con el instalado.
  // Esto previene que alguien edite Dexie para cambiar el token por uno robado
  // de otro negocio (aunque sea válido, rechazo si payload.negocio != instalado).
  const activate = useCallback(async (raw) => {
    const sysToday = today()
    const ls = await licenseRepo.getLastSeen()
    const effective = ls && ls > sysToday ? ls : sysToday
    const ev = await evaluateLicense(raw, { nowDate: effective, warnDays: WARN_DAYS })
    if (ev.status === 'active' || ev.status === 'expiring') {
      const installed = await licenseRepo.getBusinessName()
      // Primera instalacion: aceptar sin validar.
      // Renovacion: validar que el negocio sea el mismo.
      if (installed && ev.payload?.negocio !== installed) {
        return { ok: false, status: 'mismatch', reason: 'negocio', detail: `Esperaba licencia de "${installed}", recibí "${ev.payload?.negocio}"` }
      }
      await licenseRepo.setToken(raw)
      // Guardar el nombre del negocio si es nueva instalacion.
      if (!installed && ev.payload?.negocio) {
        await licenseRepo.setBusinessName(ev.payload.negocio)
      }
      return { ok: true, payload: ev.payload }
    }
    return { ok: false, status: ev.status, reason: ev.reason }
  }, [])

  const unlocked = ['active', 'expiring', 'grace'].includes(state.status)
  // Modulos opcionales firmados en la licencia (mayorista, cuentas, ...).
  // Solo cuentan con la licencia desbloqueada; sin el campo -> ninguno.
  const modules = unlocked ? licenseModules(state.payload) : []

  const value = {
    ...state,
    unlocked,
    modules,
    hasModule: (m) => modules.includes(m),
    warnDays: WARN_DAYS,
    graceDays: GRACE_DAYS,
    activate,
    deactivate: () => licenseRepo.clear()
  }

  return <LicenseContext.Provider value={value}>{children}</LicenseContext.Provider>
}

export function useLicense() {
  const ctx = useContext(LicenseContext)
  if (!ctx) throw new Error('useLicense debe usarse dentro de <LicenseProvider>')
  return ctx
}
