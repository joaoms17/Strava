import { describe, expect, it } from 'vitest'
import { groupPhotos, photoInstant } from '../api/_lib/rules/captura'
import { readExifDateTime } from '../src/lib/exif'

// JPEG mínimo com um bloco EXIF: IFD0 → ExifIFD → DateTimeOriginal.
function jpegWithExif(stamp: string, little = true): ArrayBuffer {
  const tiff: number[] = []
  const u16 = (n: number) => (little ? [n & 0xff, n >> 8] : [n >> 8, n & 0xff])
  const u32 = (n: number) =>
    little
      ? [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24]
      : [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
  tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8))
  // IFD0 em 8: 1 entrada (ponteiro para o ExifIFD em 26)
  tiff.push(...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(26), ...u32(0))
  // ExifIFD em 26: 1 entrada, DateTimeOriginal ASCII de 20 bytes em 44
  tiff.push(...u16(1), ...u16(0x9003), ...u16(2), ...u32(20), ...u32(44), ...u32(0))
  tiff.push(...[...stamp].map((c) => c.charCodeAt(0)), 0)
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  const bytes = [0xff, 0xd8, 0xff, 0xe1, ...u16be(app1.length + 2), ...app1, 0xff, 0xda, 0, 2]
  return new Uint8Array(bytes).buffer
}
function u16be(n: number) {
  return [n >> 8, n & 0xff]
}

describe('EXIF', () => {
  it('lê DateTimeOriginal (little e big endian)', () => {
    expect(readExifDateTime(jpegWithExif('2026:09:27 13:05:42'))).toEqual({ date: '2026-09-27', time: '13:05' })
    expect(readExifDateTime(jpegWithExif('2026:09:27 08:12:00', false))).toEqual({ date: '2026-09-27', time: '08:12' })
  })

  it('sem EXIF ou sem JPEG devolve null', () => {
    expect(readExifDateTime(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]).buffer)).toBeNull()
    expect(readExifDateTime(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toBeNull()
    expect(readExifDateTime(jpegWithExif('0000:00:00 00:00:00'))).toBeNull()
  })
})

describe('hora da foto', () => {
  const now = new Date('2026-09-28T12:00:00Z') // 13:00 em Lisboa

  it('EXIF em hora de Lisboa', () => {
    expect(photoInstant({ exif: { date: '2026-09-27', time: '20:40' }, lastModified: null, now })?.toISOString()).toBe(
      '2026-09-27T19:40:00.000Z',
    )
  })

  it('sem EXIF: a hora do ficheiro só serve se for de há mais de 2 min', () => {
    const old = now.getTime() - 3 * 3600_000
    expect(photoInstant({ exif: null, lastModified: old, now })?.getTime()).toBe(old)
    expect(photoInstant({ exif: null, lastModified: now.getTime() - 30_000, now })).toBeNull()
    expect(photoInstant({ exif: null, lastModified: null, now })).toBeNull()
  })

  it('um relógio adiantado nunca põe a refeição no futuro', () => {
    expect(photoInstant({ exif: { date: '2026-09-28', time: '13:03' }, lastModified: null, now })).toEqual(now)
    expect(photoInstant({ exif: { date: '2026-12-01', time: '13:00' }, lastModified: null, now })).toBeNull()
  })
})

describe('agrupar fotos da galeria', () => {
  const at = (iso: string | null) => ({ id: iso ?? 'sem', at: iso ? new Date(iso) : null })

  it('prato e rótulo a 15 min juntam-se; refeições diferentes separam-se', () => {
    const groups = groupPhotos([
      at('2026-09-27T12:05:00Z'),
      at('2026-09-27T07:12:00Z'),
      at('2026-09-27T12:15:00Z'),
      at('2026-09-27T19:40:00Z'),
    ])
    expect(groups.map((g) => g.length)).toEqual([1, 2, 1])
    expect(groups[1]!.map((p) => p.id)).toEqual(['2026-09-27T12:05:00Z', '2026-09-27T12:15:00Z'])
  })

  it('uma foto sem hora fica sempre sozinha', () => {
    const groups = groupPhotos([at(null), at('2026-09-27T12:05:00Z'), at(null)])
    expect(groups.map((g) => g.length)).toEqual([1, 1, 1])
    expect(groups[0]![0]!.at).not.toBeNull()
  })
})
