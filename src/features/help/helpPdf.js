import { HELP_ARTICLES, HELP_SECTIONS } from './helpContent'

// Fase E - Guía rápida en PDF. Genera un documento imprimible/compartible por
// WhatsApp con los temas de ayuda. Usa jspdf por import dinámico (code-split),
// igual que los reportes. Sin emojis en el PDF (algunas fuentes base no los
// dibujan); se usan viñetas de texto.

// Quita emojis/símbolos que la fuente base de jspdf no representa bien.
function clean(text) {
  return String(text || '')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}←-⇿⬀-⯿️]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function downloadHelpPdf({ isManager = true } = {}) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 14
  const maxW = pageW - margin * 2
  let y = margin

  const ensure = (h) => {
    if (y + h > pageH - margin) { doc.addPage(); y = margin }
  }
  const write = (text, { size = 10, style = 'normal', color = 0, gap = 4, indent = 0 } = {}) => {
    doc.setFontSize(size)
    doc.setFont('helvetica', style)
    doc.setTextColor(color)
    const lines = doc.splitTextToSize(clean(text), maxW - indent)
    for (const ln of lines) {
      ensure(size * 0.5)
      doc.text(ln, margin + indent, y)
      y += size * 0.5
    }
    y += gap
  }

  // Portada / encabezado.
  write('MypiCuadre', { size: 20, style: 'bold', gap: 2 })
  write('Guia rapida de uso', { size: 13, style: 'bold', color: 90, gap: 2 })
  write('Sistema de ventas y cuadre de caja. Funciona sin internet.', { size: 10, color: 120, gap: 8 })

  const articles = HELP_ARTICLES.filter((a) => (isManager ? true : a.audience === 'seller'))
  const sections = HELP_SECTIONS.filter((label) => articles.some((a) => a.section === label))

  for (const section of sections) {
    ensure(10)
    write(section.toUpperCase(), { size: 12, style: 'bold', color: 20, gap: 3 })
    const items = articles.filter((a) => a.section === section)
    for (const a of items) {
      ensure(12)
      write(a.title, { size: 11, style: 'bold', gap: 2 })
      for (const block of a.body) {
        if (block.p) write(block.p, { size: 10, color: 40, gap: 3 })
        else if (block.steps) {
          block.steps.forEach((s, i) => write(`${i + 1}. ${s}`, { size: 10, color: 40, gap: 1.5, indent: 4 }))
          y += 1.5
        } else if (block.tip) write(`Consejo: ${block.tip}`, { size: 9.5, style: 'italic', color: 30, gap: 3 })
        else if (block.warn) write(`Importante: ${block.warn}`, { size: 9.5, style: 'italic', color: 30, gap: 3 })
      }
      y += 2
    }
  }

  // Pie en cada página.
  const pages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFontSize(8)
    doc.setTextColor(150)
    doc.text(`MypiCuadre - Guia rapida - pagina ${p} de ${pages}`, margin, pageH - 8)
  }

  doc.save('guia_mypicuadre.pdf')
}
