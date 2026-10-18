import { supabase } from './supabase'
import { postApi } from './api'
import { prepareImage, sha256Hex } from './image'
import { exifDateTimeOf } from './exif'
import { signedUrls } from './photos'
import { nutritionalDay } from './day'
import { photoInstant } from '../../api/_lib/rules/captura'
import {
  askLeftovers,
  leftoversCandidate,
  mealFolder,
  plateSignature,
  signatureSimilarity,
  type PlateSignature,
} from '../../api/_lib/rules/sobras'
import type { Meal, MealItem } from './types'

// «Foto do antes e do depois»: a foto do que sobrou sobe para a pasta da
// refeição e o servidor compara-a com as do prato cheio (/api/meal/leftovers).

export interface LeftoversPrevious {
  items: MealItem[]
  status: 'ok' | 'por_rever'
  confirmed_at?: string | null
}

export type LeftoversResult =
  | { outcome: 'aplicado' | 'tudo'; meal: Meal; previous: LeftoversPrevious; photo_path: string }
  | { outcome: 'outro_prato' | 'igual'; reason: string | null; meal: Meal; photo_path: string }

// `note`: o que a pessoa escreveu com a foto do depois («deixei o arroz»).
export async function sendLeftovers(
  meal: Pick<Meal, 'id' | 'client_id'>,
  file: File,
  note?: string,
): Promise<LeftoversResult> {
  if (!navigator.onLine) throw new Error('Sem rede. Tira a foto do que sobrou quando tiveres rede.')
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Sessão expirada. Volta a entrar.')
  const image_hash = await sha256Hex(file)
  const { full, thumb } = await prepareImage(file)
  // Na pasta da refeição, com um nome que nunca escreve por cima de outra.
  const base = `${mealFolder({ ...meal, user_id: user.id })}d${Date.now().toString(36)}`
  for (const [path, blob] of [
    [`${base}.jpg`, full],
    [`${base}_t.jpg`, thumb],
  ] as const) {
    const { error } = await supabase.storage.from('meal-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: true })
    if (error) throw new Error('Não consegui enviar a foto. Tenta outra vez.')
  }
  const result = await postApi<Omit<LeftoversResult, 'photo_path'>>('/api/meal/leftovers', {
    meal_id: meal.id,
    photo_path: `${base}.jpg`,
    thumb_path: `${base}_t.jpg`,
    image_hash,
    ...(note?.trim() ? { note: note.trim().slice(0, 500) } : {}),
  })
  return { ...result, photo_path: `${base}.jpg` } as LeftoversResult
}

// Anular: os itens e o estado de antes, sem a foto do depois.
export async function undoLeftovers(mealId: string, photoPath: string, previous: LeftoversPrevious): Promise<Meal> {
  const { meal } = await postApi<{ meal: Meal }>('/api/meal/leftovers-undo', {
    meal_id: mealId,
    photo_path: photoPath,
    ...previous,
  })
  return meal
}

// As cores do prato (rules/sobras.ts) a partir de uma imagem, numa miniatura
// de 48 px: barato e sem IA. null se a imagem não abrir.
async function signatureOf(image: Blob): Promise<PlateSignature | null> {
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' })
    const scale = 48 / Math.max(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    canvas.width = 0
    canvas.height = 0
    return plateSignature(data, width, height)
  } catch {
    return null
  } finally {
    bitmap?.close()
  }
}

async function beforeSignature(path: string): Promise<PlateSignature | null> {
  try {
    const url = (await signedUrls([path]))[path]
    if (!url) return null
    const response = await fetch(url)
    if (!response.ok) return null
    return await signatureOf(await response.blob())
  } catch {
    return null
  }
}

export type LeftoversCandidate = Meal & { user_id: string; leftover_photo_path: string | null }

// No ＋, com uma foto nova: a refeição de há pouco de que ela pode ser o que
// sobrou, se valer a pena perguntar (rules/sobras.ts: do mesmo dia, 5 min a
// 3 h depois, cores do prato parecidas). Sem a migração, sem rede ou com
// qualquer falha, não pergunta: a foto regista-se como refeição nova.
export async function findLeftoversCandidate(file: File, cutoffHour: number): Promise<LeftoversCandidate | null> {
  try {
    const now = new Date()
    const at = photoInstant({ exif: await exifDateTimeOf(file), lastModified: null, now }) ?? now
    const date = nutritionalDay(at, cutoffHour)
    const { data, error } = await supabase
      .from('meals')
      .select('*')
      .eq('date', date)
      .is('deleted_at', null)
      .in('status', ['ok', 'por_rever'])
      .is('leftover_photo_path', null)
      .order('logged_at', { ascending: false })
      .limit(8)
    if (error || !data) return null
    const candidate = leftoversCandidate(data as LeftoversCandidate[], { date, at })
    if (!candidate) return null
    const folder = mealFolder(candidate)
    const thumb = (candidate.thumb_paths ?? []).find((p) => p.startsWith(folder)) ?? (candidate.photo_paths ?? []).find((p) => p.startsWith(folder))
    const [before, after] = await Promise.all([thumb ? beforeSignature(thumb) : null, signatureOf(file)])
    const similarity = before && after ? signatureSimilarity(before, after) : null
    return askLeftovers({ gapMs: at.getTime() - Date.parse(candidate.logged_at), similarity }) ? candidate : null
  } catch {
    return null
  }
}
