import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { licenseRepo } from '../../repositories/licenseRepo'
import { evaluateLicense, today } from '../../lib/license'

const LicenseContext = createContext(null)

const WARN_DAYS = 7   // avisa "por vencer" con esta antelacion
const GRACE_DAYS = 3  // dias de gracia tras caducar antes del bloqueo total

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
    ;(async () => {
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
    })()
    return () => { alive = false }
  }, [token, lastSeen])

  // Verifica firma + vigencia (con fecha efectiva) ANTES de guardar/renovar.
  const activate = useCallback(async (raw) => {
    const sysToday = today()
    const ls = await licenseRepo.getLastSeen()
    const effective = ls && ls > sysToday ? ls : sysToday
    const ev = await evaluateLicense(raw, { nowDate: effective, warnDays: WARN_DAYS })
    if (ev.status === 'active' || ev.status === 'expiring') {
      await licenseRepo.setToken(raw)
      return { ok: true, payload: ev.payload }
    }
    return { ok: false, status: ev.status, reason: ev.reason }
  }, [])

  const value = {
    ...state,
    unlocked: ['active', 'expiring', 'grace'].includes(state.status),
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
