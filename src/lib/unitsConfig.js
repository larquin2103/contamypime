import { UNITS, UNIT_LABELS } from '../db/constants.js'

// ---------------------------------------------------------------------------
// U1 - Unidades de medida CONFIGURABLES por el dueño (petición del 13-09-2026).
// Lógica PURA, sin Dexie: se prueba con node (patrón de custodyMath / orderTotals).
//
// OJO, NO CONFUNDIR CON `lib/units.js`, que es otra cosa y ya existía: aquel
// convierte CANTIDADES entre unidades de la misma familia física (1 L -> 1000 ml,
// 1 kg -> 1000 g) como ayuda de captura al fraccionar. Este fichero gestiona QUE
// unidades se ofrecen en los desplegables. Son responsabilidades distintas y no se
// tocan: una unidad nueva del dueño (trago, dash, copa) no tiene familia física, y
// `canConvertUnits` ya devuelve false para lo que no conoce -> la cantidad se teclea
// a mano, que es justo lo correcto.
//
// POR QUE SE PUEDE HACER SIN TOCAR EL ESQUEMA: la unidad NO decide nada en toda la
// app -se busco `.unit ===` en todo src/ y hay CERO coincidencias-. Es una ETIQUETA
// que se congela como copia en diez tablas (ventas, compras, mermas, conteos,
// producciones, conversiones, traspasos, lineas de mesa, movimientos de terceros y
// lineas de ficha), y TODOS los lectores usan `UNIT_LABELS[x] || x`, o sea que
// degradan al codigo crudo. Por eso quitar una unidad no puede corromper historia.
//
// FORMA: { code, label, active }. Vive en `config.units`, que YA sincroniza.
// CLAVE AUSENTE = las 8 de `constants.js`, asi que un negocio que no la toque se
// comporta EXACTAMENTE como hoy y no hay migracion que hacer.
//
// DECISIONES DEL DUEÑO (13-09-2026), y no se asume ninguna otra:
//  - Solo DESACTIVAR, nunca borrar: un producto que ya usa esa unidad tiene que
//    poder seguir editandose (regla 6: nada se borra).
//  - La importacion acepta el CODIGO EXACTO, sin alias para las nuevas.
//  - SIEMPRE queda al menos una activa (si no, el alta de producto se quedaria sin
//    opciones).
//  - Las gestiona SOLO el dueño.
//  - En el desplegable salen en orden ALFABETICO.
// ---------------------------------------------------------------------------

// Las 8 de fabrica, derivadas de `constants.js` para que NO haya dos listas que
// mantener: si algun dia se toca `UNITS`, esto sigue cuadrando solo.
export function defaultUnits() {
  return UNITS.map((code) => ({ code, label: UNIT_LABELS[code] || code, active: true }))
}

// Normaliza el codigo: minusculas, sin espacios alrededor ni dentro. El codigo es lo
// que se CONGELA en diez tablas, asi que tiene que ser estable y sin sorpresas.
export function cleanCode(code) {
  return String(code ?? '').trim().toLowerCase().replace(/\s+/g, '')
}

export function cleanLabel(label, code) {
  const l = String(label ?? '').trim()
  return l || cleanCode(code) // sin etiqueta, se muestra el propio codigo
}

// LIMPIA una lista SIN repararla: codigos validos, en minusculas, sin duplicados
// (gana el primero) y con la etiqueta saneada. Devuelve [] si no queda nada valido.
//
// Va SEPARADA de `normalizeUnits` a proposito, y el motivo es un fallo real que se
// cazo en las pruebas: si el que ESCRIBE usara la version que repara, la comprobacion
// de "debe quedar una activa" nunca se cumpliria -la reparacion la habria hecho
// cierta antes de mirarla- y el dueño veria una unidad reactivarse sola, sin mensaje
// y sin entender por que. El que escribe mira lo que le dieron; el que lee repara.
export function cleanUnits(list) {
  const seen = new Set()
  const out = []
  for (const raw of Array.isArray(list) ? list : []) {
    const code = cleanCode(raw?.code)
    if (!code || seen.has(code)) continue
    seen.add(code)
    out.push({ code, label: cleanLabel(raw?.label, code), active: raw?.active !== false })
  }
  return out
}

// Lo que se usa al LEER: limpia y ademas GARANTIZA el invariante.
//
// La reparacion no es cosmetica: `config` viaja por la sincronizacion y se fusiona
// por LWW, asi que puede llegar una lista sin ninguna activa desde otro dispositivo
// o desde un respaldo viejo. Si eso pasara, el alta de producto se quedaria sin una
// sola opcion. Aqui se repara siempre: se reactiva la primera.
export function normalizeUnits(list) {
  const out = cleanUnits(list)
  if (!out.length) return defaultUnits() // lista vacia o basura -> las de fabrica
  if (!out.some((u) => u.active)) out[0] = { ...out[0], active: true }
  return out
}

// ¿Hay al menos una activa? Lo usan el repo (para rechazar) y la pantalla (para
// deshabilitar el interruptor de la ultima).
export function hasActive(list) {
  return (Array.isArray(list) ? list : []).some((u) => u?.active !== false)
}

// Orden ALFABETICO por la ETIQUETA, que es lo que el usuario lee. `localeCompare`
// para que los acentos y la ñ queden donde una persona los espera. Desempate por
// codigo, para que el orden sea estable (dos etiquetas iguales no deben bailar).
export function sortUnits(list) {
  return [...(Array.isArray(list) ? list : [])].sort(
    (a, b) => (a.label || '').localeCompare(b.label || '') || (a.code || '').localeCompare(b.code || '')
  )
}

// Las que se ofrecen en un desplegable, ya ordenadas.
export function activeUnits(list) {
  return sortUnits(normalizeUnits(list).filter((u) => u.active))
}

// Las que debe mostrar un desplegable CONCRETO: las activas MAS la que el registro
// que se esta editando ya tiene, aunque este desactivada.
//
// Sin esto, editar un producto cuya unidad se desactivo pintaria el `<select>` EN
// BLANCO -el navegador no puede seleccionar un valor que no tiene <option>- y el
// dueño podria guardar creyendo que dejo otra cosa. No es hipotetico: ese fallo YA
// existe hoy con las AREAS en ProductForm (un producto cuya area se quito muestra el
// selector vacio). Aqui no se repite.
export function unitsForSelect(list, current) {
  const all = normalizeUnits(list)
  const actives = all.filter((u) => u.active)
  const code = cleanCode(current)
  if (code && !actives.some((u) => u.code === code)) {
    const known = all.find((u) => u.code === code)
    // Si la unidad ni siquiera esta en la lista (un dato viejo o importado), se
    // ofrece igual con su codigo crudo: mejor eso que perderla al guardar.
    actives.push(known || { code, label: code, active: false })
  }
  return sortUnits(actives)
}

// Etiqueta de un codigo, tolerante: lo que no se conoce se muestra tal cual, que es
// justo lo que hacen hoy todos los lectores con `UNIT_LABELS[x] || x`.
export function unitLabel(list, code) {
  const c = cleanCode(code)
  if (!c) return ''
  const u = normalizeUnits(list).find((x) => x.code === c)
  return u ? u.label : (UNIT_LABELS[c] || c)
}
