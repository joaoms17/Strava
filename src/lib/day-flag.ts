import { supabase } from './supabase'
import { emitDataChanged } from './events'
import { recomputeFrom } from './recompute'
import type { ToastAction } from './toast'
import {
  answerFlags,
  answerToast,
  clearMissingFlags,
  completeFromFlags,
  dayName,
  type DayAnswer,
} from '../../api/_lib/rules/dia-resposta'

export type { DayAnswer }

type ShowToast = (text: string, actions?: ToastAction[]) => void

// O que o dia tinha antes de uma resposta (para Anular voltar a isso, tal e qual).
export interface DaySnapshot {
  flags: string[]
  is_complete: boolean | null
}

async function readDay(date: string): Promise<DaySnapshot> {
  const { data: day } = await supabase.from('days').select('flags,is_complete').eq('date', date).maybeSingle()
  return {
    flags: Array.isArray(day?.flags) ? (day.flags as string[]) : [],
    is_complete: typeof day?.is_complete === 'boolean' ? day.is_complete : null,
  }
}

// Grava as marcas (e, quando as marcas o decidem, se o dia conta: o ecrã muda
// logo), põe o dia por recalcular e recalcula esse dia e os seguintes.
async function writeFlags(userId: string, date: string, flags: string[], today: string, isComplete: boolean | null): Promise<boolean> {
  const { error } = await supabase
    .from('days')
    .upsert(
      { user_id: userId, date, flags, dirty: true, ...(isComplete != null ? { is_complete: isComplete } : {}) },
      { onConflict: 'user_id,date' },
    )
  if (error) return false
  emitDataChanged()
  recomputeFrom(date, today)
  return true
}

async function userId(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user?.id ?? null
}

async function changeDay(date: string, today: string, next: (flags: string[]) => string[]): Promise<DaySnapshot | null> {
  const id = await userId()
  if (!id) return null
  const before = await readDay(date)
  const flags = next(before.flags)
  return (await writeFlags(id, date, flags, today, completeFromFlags(flags))) ? before : null
}

// «Sim, foi tudo» (dia_fechado) ou «Não, faltou algo» (faltou_algo) num dia:
// tira a outra marca, grava, e recalcula esse dia e os seguintes. Devolve o
// dia de antes (para Anular) ou null se não gravou.
export function markDay(date: string, flag: DayAnswer, today: string): Promise<DaySnapshot | null> {
  return changeDay(date, today, (flags) => answerFlags(flags, flag))
}

// Anular a resposta: volta às marcas (e ao completo) que o dia tinha.
export async function restoreDayFlags(date: string, before: DaySnapshot, today: string): Promise<boolean> {
  const id = await userId()
  if (!id) return false
  return writeFlags(id, date, before.flags, today, before.is_complete)
}

function undoAction(date: string, before: DaySnapshot, today: string, toast: ShowToast): ToastAction {
  return {
    label: 'Anular',
    run: async () => {
      if (!(await restoreDayFlags(date, before, today))) toast('Não consegui anular. Tenta outra vez.')
    },
  }
}

// Responder a «Foi tudo?» em qualquer sítio (Hoje, a análise da IA, a
// Pergunta à app): grava e mostra o aviso com a consequência e Anular.
// Devolve se ficou gravado.
export async function answerDay(date: string, flag: DayAnswer, today: string, toast: ShowToast): Promise<boolean> {
  const before = await markDay(date, flag, today)
  if (!before) {
    toast('Não consegui gravar. Tenta outra vez.')
    return false
  }
  toast(answerToast(date, flag), [undoAction(date, before, today, toast)])
  return true
}

// «Afinal foi tudo»: tira «faltou algo» (e o dia_incompleto que vinha dele)
// e o dia volta a contar, com Anular.
export async function clearMissing(date: string, today: string, toast: ShowToast): Promise<boolean> {
  const before = await changeDay(date, today, clearMissingFlags)
  if (!before) {
    toast('Não consegui gravar. Tenta outra vez.')
    return false
  }
  toast(`Dia ${dayName(date)} volta a contar no balanço`, [undoAction(date, before, today, toast)])
  return true
}
