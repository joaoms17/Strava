import type { ExifDateTime } from '../../api/_lib/rules/captura'

// Lê a hora em que a foto foi tirada (EXIF DateTimeOriginal) de um JPEG,
// antes de qualquer redimensionamento (o canvas apaga o EXIF). Sem EXIF,
// devolve null e a hora fica desconhecida.
const TAG_EXIF_IFD = 0x8769
const TAG_DATETIME_ORIGINAL = 0x9003
const TAG_DATETIME_DIGITIZED = 0x9004
const TAG_DATETIME = 0x0132

function parseStamp(stamp: string): ExifDateTime | null {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/.exec(stamp)
  if (!match || match[1] === '0000') return null
  return { date: `${match[1]}-${match[2]}-${match[3]}`, time: `${match[4]}:${match[5]}` }
}

export function readExifDateTime(buffer: ArrayBuffer): ExifDateTime | null {
  const view = new DataView(buffer)
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null
  let offset = 2
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset)
    if ((marker & 0xff00) !== 0xff00) return null
    const length = view.getUint16(offset + 2)
    if (marker === 0xffe1 && offset + 10 <= view.byteLength) {
      const header = String.fromCharCode(
        ...new Uint8Array(buffer, offset + 4, 6).filter((c) => c !== 0),
      )
      if (header === 'Exif') return readTiff(view, offset + 10)
    }
    if (marker === 0xffda) return null // início da imagem: já não há EXIF
    offset += 2 + length
  }
  return null
}

function readTiff(view: DataView, tiff: number): ExifDateTime | null {
  if (tiff + 8 > view.byteLength) return null
  const order = view.getUint16(tiff)
  const little = order === 0x4949
  if (!little && order !== 0x4d4d) return null
  const u16 = (at: number) => view.getUint16(at, little)
  const u32 = (at: number) => view.getUint32(at, little)

  function entries(ifd: number): Map<number, { type: number; count: number; valueAt: number }> {
    const result = new Map<number, { type: number; count: number; valueAt: number }>()
    if (ifd + 2 > view.byteLength) return result
    const count = u16(ifd)
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12
      if (entry + 12 > view.byteLength) break
      result.set(u16(entry), { type: u16(entry + 2), count: u32(entry + 4), valueAt: entry + 8 })
    }
    return result
  }

  function ascii(entry: { count: number; valueAt: number } | undefined): string | null {
    if (!entry) return null
    const start = entry.count > 4 ? tiff + u32(entry.valueAt) : entry.valueAt
    if (start + entry.count > view.byteLength) return null
    let text = ''
    for (let i = 0; i < entry.count; i++) {
      const c = view.getUint8(start + i)
      if (c === 0) break
      text += String.fromCharCode(c)
    }
    return text
  }

  const ifd0 = entries(tiff + u32(tiff + 4))
  const exifPointer = ifd0.get(TAG_EXIF_IFD)
  const exif = exifPointer ? entries(tiff + u32(exifPointer.valueAt)) : new Map()
  for (const stamp of [
    ascii(exif.get(TAG_DATETIME_ORIGINAL)),
    ascii(exif.get(TAG_DATETIME_DIGITIZED)),
    ascii(ifd0.get(TAG_DATETIME)),
  ]) {
    const parsed = stamp ? parseStamp(stamp) : null
    if (parsed) return parsed
  }
  return null
}

// Só os primeiros 256 KB: o EXIF vem sempre no início do ficheiro.
export async function exifDateTimeOf(file: Blob): Promise<ExifDateTime | null> {
  try {
    return readExifDateTime(await file.slice(0, 256 * 1024).arrayBuffer())
  } catch {
    return null
  }
}
