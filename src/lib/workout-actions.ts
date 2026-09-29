import { postApi } from './api'
import { supabase } from './supabase'
import { emitDataChanged } from './events'
import { fmtKcal } from './format'
import { prepareShot, sha256Hex } from './image'
import type { ToastAction } from './toast'
import type { Workout, WorkoutImport } from './types'

type ShowToast = (text: string, actions?: ToastAction[]) => void

export const WORKOUT_LABEL: Record<Workout['type'], string> = {
  bike: 'Bicicleta',
  strength: 'Ginásio',
  other: 'Treino',
}

export const SPORT_LABEL: Record<string, string> = {
  caminhada: 'Caminhada',
  eliptica: 'Elíptica',
  natacao: 'Natação',
  outro: 'Outro',
}

export function workoutTitle(w: Pick<Workout, 'type' | 'sport' | 'raw'>): string {
  if (w.type !== 'other') return WORKOUT_LABEL[w.type]
  const sport = w.sport ?? w.raw?.sport ?? 'outro'
  return SPORT_LABEL[sport] ?? 'Treino'
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Não consegui gravar. Tenta outra vez.'
}

export interface SaveWorkoutBody {
  type: Workout['type']
  sport?: string | null
  minutes: number
  started_at?: string | null
  watts?: number | null
  watts_source?: Workout['watts_source']
  avg_hr?: number | null
  max_hr?: number | null
  cadence?: number | null
  kcal_device?: number | null
  pain_during?: number | null
  favorite_id?: string | null
  import_id?: string | null
  merge_into?: string | null
  note?: string | null
}

// Guarda o treino e mostra «Bicicleta registada · +380 no plano · Anular».
export async function saveWorkout(body: SaveWorkoutBody, toast: ShowToast): Promise<Workout | null> {
  try {
    const result = await postApi<{ workout: Workout; merged?: boolean }>('/api/workout/save', {
      client_id: crypto.randomUUID(),
      ...body,
    })
    emitDataChanged()
    const w = result.workout
    if (result.merged) {
      toast(`Juntei o print à ${workoutTitle(w).toLowerCase()} das ${timeOfStart(w)}.`)
    } else {
      const kcal = w.kcal_est ?? 0
      toast(`${workoutTitle(w)} registad${w.type === 'strength' || w.type === 'other' ? 'o' : 'a'}${kcal > 0 ? ` · +${fmtKcal(kcal)} no plano` : ''}`, [
        { label: 'Anular', run: () => undoWorkout(w.id, toast) },
      ])
    }
    return w
  } catch (err) {
    toast(errorText(err))
    return null
  }
}

function timeOfStart(w: Workout): string {
  const at = w.started_at ?? w.created_at
  return new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit' }).format(
    new Date(at),
  )
}

async function undoWorkout(id: string, toast: ShowToast) {
  try {
    await postApi('/api/workout/delete', { workout_id: id })
    emitDataChanged()
    toast('Anulado.')
  } catch (err) {
    toast(errorText(err))
  }
}

export async function deleteWorkout(w: Workout, toast: ShowToast): Promise<void> {
  try {
    await postApi('/api/workout/delete', { workout_id: w.id })
    emitDataChanged()
    toast(`${workoutTitle(w)} apagad${w.type === 'bike' ? 'a' : 'o'}`, [
      {
        label: 'Anular',
        run: async () => {
          try {
            await postApi('/api/workout/restore', { workout_id: w.id })
            emitDataChanged()
          } catch (err) {
            toast(errorText(err))
          }
        },
      },
    ])
  } catch (err) {
    toast(errorText(err))
  }
}

// Prints do relógio: sobem para workout-shots/{uid}/{client_id}/ e o
// servidor lê-os em segundo plano. O mesmo print outra vez devolve o treino
// que já existe.
export async function sendShots(
  files: File[],
): Promise<{ import?: WorkoutImport; workout?: Workout; duplicate?: boolean }> {
  if (!navigator.onLine) throw new Error('Sem rede. Junta o print quando tiveres rede.')
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Sessão expirada. Volta a entrar.')
  const clientId = crypto.randomUUID()
  const source_paths: string[] = []
  const thumb_paths: string[] = []
  const image_hashes: string[] = []
  for (let i = 0; i < Math.min(files.length, 4); i++) {
    const original = files[i]!
    const hash = await sha256Hex(original)
    const { full, thumb } = await prepareShot(original)
    const base = `${user.id}/${clientId}/${i}`
    for (const [path, blob] of [
      [`${base}.jpg`, full],
      [`${base}_t.jpg`, thumb],
    ] as const) {
      const { error } = await supabase.storage
        .from('workout-shots')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
      if (error) throw new Error('Não consegui enviar o print. Tenta outra vez.')
    }
    source_paths.push(`${base}.jpg`)
    thumb_paths.push(`${base}_t.jpg`)
    image_hashes.push(hash)
  }
  return postApi('/api/workout/shot', { client_id: clientId, source_paths, thumb_paths, image_hashes })
}
