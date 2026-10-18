// Hora de uma foto e agrupamento das fotos da galeria em refeições.
import { lisbonInstant } from './momentos.js'
import { shiftDate } from './nutritional-day.js'

export interface ExifDateTime {
  date: string // AAAA-MM-DD, hora local do telemóvel (Lisboa)
  time: string // HH:MM
}

// A hora do ficheiro só serve se for claramente anterior a agora: uma foto
// guardada agora do WhatsApp tem a hora de agora, não a da refeição.
export const LAST_MODIFIED_MIN_AGE_MS = 2 * 60 * 1000
// Fotos com hora conhecida a 15 min ou menos umas das outras são a mesma refeição.
export const GROUP_WINDOW_MS = 15 * 60 * 1000

export function photoInstant(input: {
  exif: ExifDateTime | null
  lastModified: number | null
  now: Date
}): Date | null {
  const now = input.now.getTime()
  if (input.exif) {
    const at = lisbonInstant(input.exif.date, input.exif.time)
    // Um relógio mal acertado não pode pôr a refeição no futuro.
    if (Number.isFinite(at.getTime()) && at.getTime() <= now + 5 * 60 * 1000) {
      return at.getTime() > now ? input.now : at
    }
  }
  if (input.lastModified != null && input.lastModified < now - LAST_MODIFIED_MIN_AGE_MS) {
    return new Date(input.lastModified)
  }
  return null
}

// Fotos com hora conhecida, por ordem, juntam-se quando cada uma está a 15 min
// ou menos da anterior; uma foto sem hora fica sempre sozinha.
export function groupPhotos<T extends { at: Date | null }>(photos: T[]): T[][] {
  const known = photos
    .filter((p) => p.at != null)
    .sort((a, b) => a.at!.getTime() - b.at!.getTime())
  const groups: T[][] = []
  for (const photo of known) {
    const current = groups[groups.length - 1]
    const last = current?.[current.length - 1]
    if (current && last && photo.at!.getTime() - last.at!.getTime() <= GROUP_WINDOW_MS) {
      current.push(photo)
    } else {
      groups.push([photo])
    }
  }
  for (const photo of photos) if (photo.at == null) groups.push([photo])
  return groups
}

// A mesma foto (mesmo SHA-256) só conta como repetida perto do dia da
// refeição: enviada outra vez (a fila, a galeria duas vezes) cai no mesmo
// dia; dias depois é o iogurte de sempre, fotografado igual, e regista-se.
export const DUPLICATE_PHOTO_WINDOW_DAYS = 1

export function duplicatePhotoWindow(day: string): { from: string; to: string } {
  return { from: shiftDate(day, -DUPLICATE_PHOTO_WINDOW_DAYS), to: shiftDate(day, DUPLICATE_PHOTO_WINDOW_DAYS) }
}
