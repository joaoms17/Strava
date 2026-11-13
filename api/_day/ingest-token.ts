import type { VercelRequest, VercelResponse } from '@vercel/node'
import { HttpError, adminClient, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { missingColumn, personalToken } from '../_lib/ingest-token.js'

// Definições › Atalho do iPhone: o endereço e o token de quem tem a sessão,
// para o Atalho dessa pessoa mandar os passos e o sono para a conta dela.
// GET mostra o token atual e a data em que foi gerado (null: o de origem);
// POST gera um novo (G4), que invalida o anterior.
export default async function ingestToken(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
    const { user } = await requireUser(req)
    const secret = process.env.HEALTH_INGEST_TOKEN
    if (!secret) throw new HttpError(503, 'Falta HEALTH_INGEST_TOKEN no Vercel.')
    const admin = adminClient()
    const url = `https://${req.headers.host}/api/health/daily`

    if (req.method === 'POST') {
      const createdAt = new Date().toISOString()
      const { data, error } = await admin
        .from('profile')
        .update({ ingest_token_at: createdAt })
        .eq('user_id', user.id)
        .select('ingest_token_at')
        .maybeSingle()
      if (error && missingColumn(error)) {
        throw new HttpError(503, 'Para gerar outro token falta a migração 20261113000061 (Definições › Avançado).')
      }
      if (error) throw new HttpError(500, error.message)
      if (!data) throw new HttpError(404, 'Perfil não encontrado.')
      // A data como a base de dados a devolve (é a que o Atalho vai confirmar).
      const saved = (data.ingest_token_at as string | null) ?? createdAt
      res.status(200).json({ url, token: personalToken(secret, user.id, saved), created_at: saved, can_rotate: true })
      return
    }

    const { data, error } = await admin.from('profile').select('ingest_token_at').eq('user_id', user.id).maybeSingle()
    // Sem a migração: o token de origem, sem poder gerar outro.
    if (error && !missingColumn(error)) throw new HttpError(500, error.message)
    const createdAt = error ? null : ((data?.ingest_token_at as string | null | undefined) ?? null)
    res.status(200).json({ url, token: personalToken(secret, user.id, createdAt), created_at: createdAt, can_rotate: !error })
  } catch (err) {
    respondError(res, err)
  }
}
