// ---------------------------------------------------------------------------
// Celdas "a lo ancho" de un reporte (Control de Ventas Diarias). PURO.
//
// jspdf-autotable admite de forma nativa una celda { content, colSpan } que ocupa
// varias columnas: asi una linea de texto (el separador de un dia, un control) no
// ensancha la primera columna de la tabla. SheetJS, en cambio, guarda ese objeto
// como una celda cruda SIN valor y el texto se pierde. exportExcel pasa las filas por
// aqui: una celda a lo ancho se convierte en su texto; TODO lo demas se devuelve tal
// cual (la misma fila, el mismo valor), asi que los reportes que ya existen -que no
// usan estas celdas- producen exactamente el mismo Excel que antes.
// ---------------------------------------------------------------------------
export const isSpanCell = (c) =>
  !!c && typeof c === 'object' && !(c instanceof Date) && typeof c.content === 'string' && 'colSpan' in c

export function plainRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) =>
    Array.isArray(r) && r.some(isSpanCell) ? r.map((c) => (isSpanCell(c) ? c.content : c)) : r)
}
