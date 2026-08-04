// Redimension + compresion de imagenes EN EL CLIENTE (Fase 8 - B3, modulo
// 'imagenes'). Convierte un File (camara o galeria) en una MINIATURA JPEG cuyo
// lado mayor es <= maxPx y que pesa <= maxBytes, devuelta como dataUrl base64.
//
// Objetivo: fotos ligeras que caben en un documento de Firestore y sincronizan
// sin costo apreciable (plan gratis). TODO ocurre en el dispositivo: no se sube
// nada a ningun servidor ni se usa Firebase Storage.

// Bytes aproximados del contenido base64 de un dataUrl (sin la cabecera).
function dataUrlBytes(dataUrl) {
  const i = dataUrl.indexOf(',')
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl
  return Math.floor((b64.length * 3) / 4)
}

// Carga el File como algo dibujable en canvas. Preferimos createImageBitmap
// (rapido y respeta orientacion EXIF en navegadores modernos); si no existe,
// caemos a un <img> con objectURL.
async function loadDrawable(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      /* algunos navegadores no aceptan las opciones: reintentar sin ellas */
      try { return await createImageBitmap(file) } catch { /* cae al <img> */ }
    }
  }
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')) }
    img.src = url
  })
}

export async function fileToThumbnail(file, { maxPx = 256, maxBytes = 40 * 1024 } = {}) {
  if (!file) throw new Error('No hay archivo')
  const src = await loadDrawable(file)
  const iw = src.naturalWidth || src.width
  const ih = src.naturalHeight || src.height
  if (!iw || !ih) throw new Error('Imagen inválida')

  // Escala manteniendo la proporcion: el lado mayor queda en maxPx (nunca amplia).
  const scale = Math.min(1, maxPx / Math.max(iw, ih))
  const w = Math.max(1, Math.round(iw * scale))
  const h = Math.max(1, Math.round(ih * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  // Fondo blanco: los PNG/transparentes no quedan negros al pasar a JPEG.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(src, 0, 0, w, h)
  if (typeof src.close === 'function') src.close() // liberar el ImageBitmap

  // Baja la calidad hasta caber en maxBytes (o hasta un minimo razonable).
  let q = 0.82
  let dataUrl = canvas.toDataURL('image/jpeg', q)
  while (dataUrlBytes(dataUrl) > maxBytes && q > 0.3) {
    q -= 0.12
    dataUrl = canvas.toDataURL('image/jpeg', q)
  }
  return dataUrl
}
