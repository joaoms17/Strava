import { describe, expect, it } from 'vitest'
import { readImageSize } from '../src/lib/exif'
import { SCREENSHOT_MIN_ASPECT, screenshotLike } from '../src/lib/image'

// Cabeçalhos mínimos: um PNG (assinatura + IHDR) e um JPEG (SOI, APP0, SOF0).
function png(width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes.buffer
}

function jpeg(width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array(2 + 18 + 19)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, 0xffd8)
  view.setUint16(2, 0xffe0) // APP0 (JFIF), 16 bytes
  view.setUint16(4, 16)
  view.setUint16(20, 0xffc0) // SOF0
  view.setUint16(22, 17)
  view.setUint8(24, 8)
  view.setUint16(25, height)
  view.setUint16(27, width)
  return bytes.buffer
}

describe('tamanho pelo cabeçalho', () => {
  it('PNG e JPEG sem descodificar', () => {
    expect(readImageSize(png(1179, 2556))).toEqual({ width: 1179, height: 2556 })
    expect(readImageSize(jpeg(4032, 3024))).toEqual({ width: 4032, height: 3024 })
  })
  it('outro formato ou ficheiro curto: não se sabe', () => {
    expect(readImageSize(new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]).buffer)).toBeNull()
    expect(readImageSize(new ArrayBuffer(2))).toBeNull()
  })
})

// As capturas de ecrã (o resumo de um pedido) vão a 2048 px; as fotos da comida ficam como estavam.
describe('capturas de ecrã', () => {
  it('uma captura do iPhone (PNG ao alto) ou uma imagem muito alta', () => {
    expect(screenshotLike(1179, 2556, 'image/png')).toBe(true)
    expect(screenshotLike(1179, 2556, 'image/jpeg')).toBe(true) // reenviada pelo WhatsApp
    expect(screenshotLike(1179, 1400, 'image/png')).toBe(true) // recortada, continua PNG
    expect(2556 / 1179).toBeGreaterThan(SCREENSHOT_MIN_ASPECT)
  })
  it('as fotos da câmara não (4 : 3 ao alto ou ao largo, 16 : 9)', () => {
    expect(screenshotLike(3024, 4032, 'image/jpeg')).toBe(false)
    expect(screenshotLike(4032, 3024, 'image/jpeg')).toBe(false)
    expect(screenshotLike(1080, 1920, 'image/jpeg')).toBe(false)
    expect(screenshotLike(0, 0, 'image/png')).toBe(false)
  })
})
