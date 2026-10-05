import { supabase } from './supabase'
import { postApi } from './api'
import { prepareImage, sha256Hex } from './image'
import type { Slot } from './types'

export const MAX_MEAL_PHOTOS = 4

// Fotografar: a foto não segue logo — abre o Registar com ela, para juntar
// uma nota (e outra foto) antes de enviar. Passa sem ir pela URL.
let pendingCamera: File[] | null = null

export function setPendingCamera(files: File[]): void {
  pendingCamera = files
}

// Lê sem apagar (o React pode montar a folha duas vezes); apaga-se depois.
export function peekPendingCamera(): File[] | null {
  return pendingCamera
}

export function clearPendingCamera(): void {
  pendingCamera = null
}

// Galeria: as fotos escolhidas passam para a folha «Fotos da galeria» sem
// passar pela URL (os ficheiros não cabem lá). O dia e a refeição servem
// para as fotos sem hora.
interface PendingGallery {
  files: File[]
  date: string | null
  slot: Slot | null
}

let pendingGallery: PendingGallery | null = null

export function setPendingGallery(files: File[], date: string | null, slot: Slot | null = null): void {
  pendingGallery = { files, date, slot }
}

// Lê sem apagar (o React pode montar a folha duas vezes); apaga-se ao analisar.
export function peekPendingGallery(): PendingGallery | null {
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
