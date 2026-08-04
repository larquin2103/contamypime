// Redimension + compresion de imagenes EN EL CLIENTE (Fase 8, modulo 'imagenes').
// Convierte un File (camara o galeria) en una MINIATURA CUADRADA (look tienda
// e-commerce): lienzo cuadrado, imagen centrada, devuelta como dataUrl JPEG que
// pesa <= maxBytes. Es reutilizable para catalogo, carta de mesas y avatares.
//
// Objetivo: fotos ligeras que caben en un documento de Firestore y sincronizan
// sin costo apreciable (plan gratis). TODO ocurre en el dispositivo: no se sube
// nada a ningun servidor ni se usa Firebase Storage.
//
// `fit`:
//   'contain' (default) -> la foto entra COMPLETA sobre el fondo (sin recortar).
//                          Ideal para productos/carta: el dueño no edita nada.
//   'cover'             -> la foto LLENA el cuadrado y se recorta el sobrante.
//                          Ideal para avatares (se ven llenos dentro del circulo).

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

export async function fileToThumbnail(file, {
  size = 256,             // lado del cuadrado resultante (px)
  maxBytes = 40 * 1024,   // tope de peso (para caber en Firestore, plan gratis)
  fit = 'contain',        // 'contain' (foto completa) | 'cover' (llena y recorta)
  background = '#ffffff'  // fondo del cuadrado (blanco = look e-commerce)
} = {}) {
  if (!file) throw new Error('No hay archivo')
  const src = await loadDrawable(file)
  const iw = src.naturalWidth || src.width
  const ih = src.naturalHeight || src.height
  if (!iw || !ih) throw new Error('Imagen inválida')

  // Lienzo CUADRADO. No agrandamos por encima del original (evita fotos borrosas
  // y peso inutil): el lado es como mucho el mayor de la imagen original.
  const S = Math.max(1, Math.min(size, Math.max(iw, ih)))
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, S, S)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // Escala segun el modo y centra dentro del cuadrado.
  const scale = fit === 'cover'
    ? Math.max(S / iw, S / ih)   // llena el cuadrado (recorta lo que sobra)
    : Math.min(S / iw, S / ih)   // cabe entera dentro del cuadrado
  const dw = Math.round(iw * scale)
  const dh = Math.round(ih * scale)
  const dx = Math.round((S - dw) / 2)
  const dy = Math.round((S - dh) / 2)
  ctx.drawImage(src, dx, dy, dw, dh)
  if (typeof src.close === 'function') src.close() // liberar el ImageBitmap

  // Baja la calidad hasta caber en maxBytes (o hasta un minimo razonable).
  let q = 0.85
  let dataUrl = canvas.toDataURL('image/jpeg', q)
  while (dataUrlBytes(dataUrl) > maxBytes && q > 0.3) {
    q -= 0.1
    dataUrl = canvas.toDataURL('image/jpeg', q)
  }
  return dataUrl
}
