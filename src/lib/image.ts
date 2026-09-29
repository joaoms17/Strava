// Fotos: redimensionar no telemóvel antes de enviar (menos tokens, menos
// dados móveis e um formato que o Claude aceita sempre).

async function toJpegBlob(bitmap: ImageBitmap, maxDim: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Não consegui preparar a foto.')
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  // Liberta a memória do canvas já (o iOS fecha a app se acumular).
  canvas.width = 0
  canvas.height = 0
  if (!blob) throw new Error('Não consegui preparar a foto.')
  return blob
}

// Foto de 1024 px (JPEG q0,75, ~150 KB) e miniatura de 256 px, a partir do
// ficheiro original; o bitmap fecha-se logo a seguir.
export async function prepareImage(file: Blob): Promise<{ full: Blob; thumb: Blob }> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('Este formato de foto não é suportado. Tenta outra foto.')
  }
  try {
    const full = await toJpegBlob(bitmap, 1024, 0.75)
    const thumb = await toJpegBlob(bitmap, 256, 0.7)
    return { full, thumb }
  } finally {
    bitmap.close()
  }
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Usado pela foto dos capítulos (Arquivo) e por imagens avulsas.
export async function toJpeg(file: File, maxDim = 1600, quality = 0.85): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    try {
      return await toJpegBlob(bitmap, maxDim, quality)
    } finally {
      bitmap.close()
    }
  } catch {
    return file
  }
}

// Prints do relógio: no tamanho nativo até 2576 px no lado maior (JPEG
// q0,9) para os números pequenos se lerem, e miniatura de 256 px.
export async function prepareShot(file: Blob): Promise<{ full: Blob; thumb: Blob }> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('Este formato de imagem não é suportado. Tenta outra.')
  }
  try {
    const full = await toJpegBlob(bitmap, 2576, 0.9)
    const thumb = await toJpegBlob(bitmap, 256, 0.7)
    return { full, thumb }
  } finally {
    bitmap.close()
  }
}
