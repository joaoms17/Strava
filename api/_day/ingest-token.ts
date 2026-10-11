import type { VercelRequest, VercelResponse } from '@vercel/node'
import { HttpError, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { personalToken } from '../_lib/ingest-token.js'

// Definições › Atalho do iPhone: o endereço e o token de quem tem a sessão,
// para o Atalho dessa pessoa mandar os passos e o sono para a conta dela.
export default async function ingestToken(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') throw new HttpError(405, 'Método não suportado.')
    const { user } = await requireUser(req)
    const secret = process.env.HEALTH_INGEST_TOKEN
    if (!secret) throw new HttpError(503, 'Falta HEALTH_INGEST_TOKEN no Vercel.')
    res.status(200).json({
      url: `https://${req.headers.host}/api/health/daily`,
      token: personalToken(secret, user.id),
    })
  } catch (err) {
    respondError(res, err)
  }
}
