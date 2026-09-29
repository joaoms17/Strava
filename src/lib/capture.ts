import { enqueueCapture } from './capture-queue'
import { exifDateTimeOf } from './exif'
import { photoInstant } from '../../api/_lib/rules/captura'
import { slotOf } from '../../api/_lib/rules/momentos'

// Fotografar: a foto entra na fila logo, sem esperar. Num dia passado fica
// nesse dia, à hora habitual do momento atual.
export async function captureCameraPhoto(file: File, pastDate: string | null): Promise<void> {
  const now = new Date()
  const exif = await exifDateTimeOf(file)
  const at = photoInstant({ exif, lastModified: null, now }) ?? now
  await enqueueCapture({
    files: [file],
    text: null,
    note: null,
    tags: [],
    taken_at: pastDate ? null : at.toISOString(),
    date: pastDate,
    slot: pastDate ? slotOf(now) : null,
  })
}

// Galeria: as fotos escolhidas passam para a folha «Fotos da galeria» sem
// passar pela URL (os ficheiros não cabem lá).
let pendingGallery: { files: File[]; date: string | null } | null = null

export function setPendingGallery(files: File[], date: string | null): void {
  pendingGallery = { files, date }
}

// Lê sem apagar (o React pode montar a folha duas vezes); apaga-se ao analisar.
export function peekPendingGallery(): { files: File[]; date: string | null } | null {
  return pendingGallery
}

export function clearPendingGallery(): void {
  pendingGallery = null
}
