import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { licenseRepo } from '../../repositories/licenseRepo'
import { evaluateLicense } from '../../lib/license'

const LicenseContext = createContext(null)

// ---------------------------------------------------------------------------
// Fase 5 - Bloque 28: estado de la licencia de activacion a nivel de app.
//
//  - Lee el token guardado en `config` (reactivo via useLiveQuery).
//  - Lo evalua sin conexion (firma + vigencia) y expone el estado.
//  - `activate` verifica un codigo nuevo y, si es valido, lo guarda.
//
// La COMPUERTA que decide si dejar pasar a la app vive en el router; aqui solo
// se calcula el estado. status: 'none' | 'invalid' | 'expired' | 'expiring' | 'active'
// ---------------------------------------------------------------------------
export function LicenseProvider({ children }) {
  // El token vive en config; si cambia (al activar/renovar) se re-evalua solo.
  const token = useLiveQuery(() => licenseRepo.getToken(), [], undefined)
  const [state, setState] = useState({ ready: false, status: 'none', payload: null, daysLeft: null })

  useEffect(() => {
    if (token === undefined) return // aun cargando desde Dexie
    let alive = true
    evaluateLicense(token).then((ev) => {
      if (!alive) return
      setState({ ready: true, status: ev.status, payload: ev.payload, daysLeft: ev.daysLeft })
    })
    return () => { alive = false }
  }, [token])

  // Verifica firma + vigencia ANTES de guardar. Devuelve {ok} o {ok:false, ...}
  // con el motivo para mostrarlo en la pantalla de activacion.
  const activate = useCallback(async (raw) => {
    const ev = await evaluateLicense(raw)
    if (ev.status === 'active' || ev.status === 'expiring') {
      await licenseRepo.setToken(raw)
      return { ok: true, payload: ev.payload }
    }
    return { ok: false, status: ev.status, reason: ev.reason }
  }, [])

  const value = {
    ...state,
    // ¿Esta la app desbloqueada? (firma valida y no caducada)
    unlocked: state.status === 'active' || state.status === 'expiring',
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
