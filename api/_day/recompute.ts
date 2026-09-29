import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { adminClient, HttpError, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { CLOSE_DAY_PROFILE_COLUMNS, closeDay, type CloseDayProfile } from '../_lib/close-day.js'
import { nutritionalDay, shiftDate } from '../_lib/rules/nutritional-day.js'

// Recalcula os dias a partir de uma data (pesagem num dia passado, refeição
// que mudou de dia), por ordem até ontem, em blocos de 30: o telemóvel repete
// com `next` até acabar. Limpa a marca «a recalcular» de cada dia.
const BLOCK = 30
const BUDGET_MS = 40_000

const Schema = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
    const { user } = await requireUser(req)
    const body = Schema.safeParse(req.body)
    if (!body.success) throw new HttpError(400, 'Pedido inválido.')

    const admin = adminClient()
    const { data: profile } = await admin
      .from('profile')
      .select(CLOSE_DAY_PROFILE_COLUMNS)
      .eq('user_id', user.id)
      .single()
    if (!profile) throw new HttpError(404, 'Perfil não encontrado.')

    const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
    const yesterday = shiftDate(today, -1)
    const oldest = shiftDate(today, -400)
    let date = body.data.from < oldest ? oldest : body.data.from
    const startedAt = Date.now()
    let done = 0
    while (date <= yesterday && done < BLOCK && Date.now() - startedAt < BUDGET_MS) {
      await closeDay(admin, profile as CloseDayProfile, date, profile.maintenance_anchor ?? null)
      date = shiftDate(date, 1)
      done++
    }
    res.status(200).json({ done, next: date <= yesterday ? date : null })
  } catch (err) {
    respondError(res, err)
  }
}
