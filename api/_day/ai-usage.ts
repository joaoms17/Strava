import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, HttpError, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { aiProvider } from '../_lib/anthropic.js'
import { VISION_KINDS, aiLimitsFor } from '../_lib/rules/custos.js'
import { lisbonClock, lisbonInstant } from '../_lib/rules/momentos.js'

// Definições › Avançado: quantos pedidos à IA a casa e a pessoa fizeram hoje
// (com o Gemini a chave e a quota gratuita são as mesmas para todos) e que IA
// está em uso. Cada pessoa só lê as suas api_calls; a casa conta-se aqui.
export default async function aiUsage(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') throw new HttpError(405, 'Método não suportado.')
    const { user } = await requireUser(req)
    const admin = adminClient()
    const provider = aiProvider()
    const dayStart = lisbonInstant(lisbonClock(new Date()).date, '00:00').toISOString()
    const count = async (mine: boolean, photos: boolean) => {
      let query = admin.from('api_calls').select('id', { count: 'exact', head: true }).gte('created_at', dayStart)
      if (mine) query = query.eq('user_id', user.id)
      if (photos) query = query.in('kind', VISION_KINDS)
      const { count: n, error } = await query
      if (error) throw new Error(error.message)
      return n ?? 0
    }
    const [house, mine, housePhotos, minePhotos] = await Promise.all([
      count(false, false),
      count(true, false),
      count(false, true),
      count(true, true),
    ])
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ provider, ...aiLimitsFor(provider), today: { house, mine, housePhotos, minePhotos } })
  } catch (err) {
    respondError(res, err)
  }
}
