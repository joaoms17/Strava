import { enqueueCapture } from './capture-queue'
import { supabase } from './supabase'
import { postApi } from './api'
import { prepareImage, sha256Hex } from './image'
import { exifDateTimeOf } from './exif'
import { photoInstant } from '../../api/_lib/rules/captura'
import { slotOf } from '../../api/_lib/rules/momentos'

export const MAX_MEAL_PHOTOS = 4

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

// Juntar fotos a uma refeição que já existe (não carregou, ficou com erro ou
// faltava a foto do rótulo). Precisa de rede: as fotos sobem logo e a
// refeição volta a ser analisada com todas.
export async function attachPhotos(
  meal: { id: string; client_id: string | null; photo_paths: string[] | null },
  files: File[],
): Promise<void> {
  if (!navigator.onLine) throw new Error('Sem rede. Junta a foto quando tiveres rede.')
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Sessão expirada. Volta a entrar.')
  const room = MAX_MEAL_PHOTOS - (meal.photo_paths?.length ?? 0)
  if (room <= 0) throw new Error(`Esta refeição já tem ${MAX_MEAL_PHOTOS} fotos.`)
  const chosen = files.slice(0, room)
  const photo_paths: string[] = []
  const thumb_paths: string[] = []
  const image_hashes: string[] = []
  // Nome único: nunca escreve por cima de uma foto que já lá está.
  const stamp = Date.now().toString(36)
  for (let i = 0; i < chosen.length; i++) {
    const original = chosen[i]!
    const hash = await sha256Hex(original)
    const { full, thumb } = await prepareImage(original)
    const base = `${user.id}/${meal.client_id ?? meal.id}/j${stamp}-${i}`
    for (const [path, blob] of [
      [`${base}.jpg`, full],
      [`${base}_t.jpg`, thumb],
    ] as const) {
      const { error } = await supabase.storage
        .from('meal-photos')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
      if (error) throw new Error('Não consegui enviar a foto. Tenta outra vez.')
    }
    photo_paths.push(`${base}.jpg`)
    thumb_paths.push(`${base}_t.jpg`)
    image_hashes.push(hash)
  }
  await postApi('/api/meal/attach', { meal_id: meal.id, photo_paths, thumb_paths, image_hashes })
}
