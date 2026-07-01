import { useMemo, useState } from 'react'
import { ChevronLeft, Download } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../app/providers/AuthProvider'
import { HELP_ARTICLES, HELP_SECTIONS } from './helpContent'
import { downloadHelpPdf } from './helpPdf'

// Pantalla de Ayuda (Fase B). Índice de temas + lectura de cada artículo, todo
// offline. El dueño/administrativo ve el recorrido completo (incluida la guía del
// vendedor, para poder enseñarla); el vendedor ve solo su guía corta.
export function HelpScreen() {
  const { isManager } = useAuth()
  const navigate = useNavigate()
  const [openId, setOpenId] = useState(null)
  const [pdfBusy, setPdfBusy] = useState(false)

  const downloadPdf = async () => {
    setPdfBusy(true)
    try {
      await downloadHelpPdf({ isManager })
    } finally {
      setPdfBusy(false)
    }
  }

  // Artículos visibles según el rol.
  const visible = useMemo(
    () => HELP_ARTICLES.filter((a) => (isManager ? true : a.audience === 'seller')),
    [isManager]
  )

  const article = openId ? visible.find((a) => a.id === openId) : null

  // Vista de un artículo.
  if (article) {
    return (
      <div className="screen">
        <button className="pos-nav__back help-back" onClick={() => setOpenId(null)} aria-label="Volver al índice">
          <ChevronLeft size={20} strokeWidth={2} /> Temas
        </button>
        <h2 className="help-article__title"><span className="help-emoji">{article.icon}</span> {article.title}</h2>
        <section className="card help-article">
          {article.body.map((block, i) => <HelpBlock key={i} block={block} />)}
        </section>
      </div>
    )
  }

  // Índice agrupado por sección.
  const sections = HELP_SECTIONS
    .map((label) => ({ label, items: visible.filter((a) => a.section === label) }))
    .filter((s) => s.items.length > 0)

  return (
    <div className="screen">
      <div className="pos-nav">
        <button className="pos-nav__back" onClick={() => navigate(-1)} aria-label="Volver">
          <ChevronLeft size={20} strokeWidth={2} />
        </button>
        <h2 className="pos-nav__title">Ayuda</h2>
        <span className="pos-nav__action" />
      </div>
      <p className="muted">
        {isManager
          ? 'Guía paso a paso para poner tu negocio a andar. Toca un tema para leerlo.'
          : 'Guía rápida para vender y cerrar tu turno. Toca un tema para leerlo.'}
      </p>

      <button className="btn btn--ghost btn--block" disabled={pdfBusy} onClick={downloadPdf}>
        <Download size={16} strokeWidth={2} /> {pdfBusy ? 'Generando…' : 'Descargar guía (PDF)'}
      </button>

      {sections.map((s) => (
        <section key={s.label} className="help-section">
          <h3 className="home-section__label">{s.label}</h3>
          <div className="list">
            {s.items.map((a) => (
              <button key={a.id} className="list-item help-item" onClick={() => setOpenId(a.id)}>
                <span className="help-item__emoji">{a.icon}</span>
                <span className="help-item__text">
                  <strong>{a.title}</strong>
                  <span className="muted">{a.teaser}</span>
                </span>
                <span className="help-item__chev">›</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

// Renderiza un bloque del cuerpo del artículo.
function HelpBlock({ block }) {
  if (block.p) return <p className="help-p">{block.p}</p>
  if (block.steps) {
    return (
      <ol className="help-steps">
        {block.steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
    )
  }
  if (block.tip) return <p className="help-callout help-callout--tip">💡 {block.tip}</p>
  if (block.warn) return <p className="help-callout help-callout--warn">⚠️ {block.warn}</p>
  return null
}
