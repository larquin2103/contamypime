import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { costSheetsRepo } from '../../repositories/costSheetsRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { matchesQuery } from '../../lib/search'
import { formatMoney } from '../../lib/currency'
import { FICHA_STATUS, priceRows, indirectCheck } from '../../lib/fichaCosto'
import { FICHA_STATUS_LABELS, FICHA_ACTIVITY_LABELS } from '../../db/constants'

// Modulo 'fichas' (F4) - Lista de fichas de costo (Res. 148/2023 MFP).
//
// La ficha es un documento de ANALISIS: lee el catalogo y propone un precio,
// pero NUNCA escribe en `products` ni cambia precios (decision del dueño).
// Solo el MANDO entra aqui: la ficha expone costos y ganancia.
//
// El precio unitario va en grande porque es lo que se viene a buscar, y el punto
// de color no es decoracion: es el control de gastos indirectos del Art. 9,
// visible sin abrir la ficha.

// Estado -> clase de la etiqueta. El borrador va NEUTRO a proposito: no es un
// problema (ambar), es el estado normal mientras se teclea.
const STATUS_CLASS = {
  [FICHA_STATUS.BORRADOR]: 'badge',
  [FICHA_STATUS.APROBADA]: 'badge badge--ok',
  [FICHA_STATUS.SUSTITUIDA]: 'badge badge--muted'
}

// Punto del control de indirectos (Art. 9). OJO con los nombres de las clases:
// son las del salon (`.dot--busy` = verde primario, `.dot--long` = ambar,
// `.dot--free` = borde punteado). Se reusan por el COLOR, que es el correcto, y
// no se crean clases nuevas para no tocar global.css.
// Sin salario directo el control NO OPINA: el motor devuelve `applies: false` y
// aqui se pinta el punto vacio, nunca un verde de "perfecto".
function IndirectDot({ sheet }) {
  const chk = indirectCheck(sheet)
  if (!chk.applies) {
    return (
      <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
        <span className="dot dot--free" /> sin salario directo
      </span>
    )
  }
  return (
    <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      <span className={`dot ${chk.ok ? 'dot--busy' : 'dot--long'}`} />
      {chk.ok ? 'en regla' : 'indirectos'}
    </span>
  )
}

export function CostSheetsScreen() {
  const { isManager } = useAuth()
  const { baseCurrency } = useCurrency()
  const { hasModule } = useLicense()
  const navigate = useNavigate()

  // Compuerta EN LA CONSULTA, no solo en el render: sin la licencia (o sin ser
  // mando) la pantalla no lee ni una ficha de la base.
  const canFichas = isManager && hasModule(LICENSE_MODULES.COSTSHEETS)
  const sheets = useLiveQuery(
    () => (canFichas ? costSheetsRepo.list() : Promise.resolve([])),
    [canFichas],
    []
  )

  const [tab, setTab] = useState(FICHA_STATUS.BORRADOR)
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const byTab = tab === 'todas' ? sheets : sheets.filter((s) => s.status === tab)
    const byQuery = query.trim() ? byTab.filter((s) => matchesQuery(s, query)) : byTab
    // Lo ultimo tocado primero: es lo que se estaba escribiendo.
    return [...byQuery].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  }, [sheets, tab, query])

  // Compuerta del modulo: sin la licencia 'fichas', la pantalla no ofrece nada.
  if (!hasModule(LICENSE_MODULES.COSTSHEETS)) {
    return (
      <div className="screen">
        <h2>Fichas de costo</h2>
        <section className="card">
          <p>El módulo <strong>Fichas de costo</strong> no está activo en esta licencia.</p>
          <Link className="btn btn--primary btn--block" to="/">Volver al inicio</Link>
        </section>
      </div>
    )
  }
  // La ficha expone costos y ganancia: solo el mando.
  if (!isManager) {
    return (
      <div className="screen">
        <h2>Fichas de costo</h2>
        <section className="card">
          <p>Solo el <strong>dueño o un administrativo</strong> trabaja las fichas de costo.</p>
          <Link className="btn btn--primary btn--block" to="/">Volver al inicio</Link>
        </section>
      </div>
    )
  }

  return (
    <div className="screen">
      <h2>Fichas de costo</h2>
      <p className="muted">
        Ficha de costos y gastos de la <strong>Res. 148/2023</strong> del Ministerio de Finanzas
        y Precios. La ficha <strong>solo lee</strong> el catálogo: propone el precio, no lo aplica.
      </p>

      <button className="btn btn--primary btn--block" onClick={() => navigate('/ficha/nueva')}>
        + Nueva ficha
      </button>

      <div className="seg">
        <button
          className={`seg__btn ${tab === FICHA_STATUS.BORRADOR ? 'seg__btn--on' : ''}`}
          onClick={() => setTab(FICHA_STATUS.BORRADOR)}
        >
          Borradores
        </button>
        <button
          className={`seg__btn ${tab === FICHA_STATUS.APROBADA ? 'seg__btn--on' : ''}`}
          onClick={() => setTab(FICHA_STATUS.APROBADA)}
        >
          Aprobadas
        </button>
        <button
          className={`seg__btn ${tab === 'todas' ? 'seg__btn--on' : ''}`}
          onClick={() => setTab('todas')}
        >
          Todas
        </button>
      </div>

      <input
        className="search-input"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar ficha o producto…"
      />

      <div className="product-list">
        {visible.map((s) => {
          const { r15 } = priceRows(s)
          const nivel = Number(s.productionLevel) || 0
          return (
            <button key={s.id} className="product-row" onClick={() => navigate(`/ficha/${s.id}`)}>
              <div className="product-row__main">
                <strong>{s.name || 'Ficha sin nombre'}</strong>
                <span className="muted">
                  {nivel > 0 ? `${nivel} ${s.unit || 'u'}` : `${s.unit || 'u'}`}
                  {' · '}
                  {FICHA_ACTIVITY_LABELS[s.activity] || 'actividad sin definir'}
                  {!s.productId && ' · texto libre'}
                  {Number(s.version) > 1 && ` · v${s.version}`}
                </span>
                <IndirectDot sheet={s} />
              </div>
              <div className="product-row__meta">
                <span className={STATUS_CLASS[s.status] || 'badge'}>
                  {FICHA_STATUS_LABELS[s.status] || s.status}
                </span>
                <span className="stock">PRECIO UNITARIO</span>
                <span className="price">{formatMoney(r15, baseCurrency)}</span>
              </div>
            </button>
          )
        })}

        {visible.length === 0 && (
          <div className="empty-state">
            {sheets.length === 0 ? (
              <p className="muted">
                Todavía no hay fichas. La ficha de costos y gastos es de{' '}
                <strong>confección obligatoria</strong> también para un actor no estatal
                (Art. 3), y es el documento con el que se sostiene un precio ante un control,
                una negociación o una concertación.
              </p>
            ) : query.trim() ? (
              <p className="muted">Sin resultados para “{query}”.</p>
            ) : (
              <p className="muted">No hay fichas en este estado.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
