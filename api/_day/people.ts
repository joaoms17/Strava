import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { adminClient, HttpError, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { lisbonClock } from '../_lib/rules/momentos.js'
import { MAX_PEOPLE, startingTargets } from '../_lib/rules/pessoas.js'

// Várias pessoas na mesma app, cada uma com a sua conta: os dados ficam
// separados pelo RLS de sempre. Criar a conta de outra pessoa precisa de uma
// sessão de quem já usa a app (o registo livre continua fechado no Supabase).

const PersonSchema = z.object({
  name: z.string().trim().min(1).max(30),
  sex: z.enum(['m', 'f']),
  height_cm: z.number().int().min(120).max(230),
  birth_year: z.number().int().min(1920).max(2015).nullable(),
  weight_kg: z.number().min(30).max(300).nullable(),
  target_weight_kg: z.number().min(30).max(300),
})

const AddPersonSchema = PersonSchema.extend({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(72),
})

type Person = z.infer<typeof PersonSchema>

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body)
  if (!result.success) throw new HttpError(400, 'Dados inválidos. Vê o nome, a altura e os pesos.')
  return result.data
}

// Perfil com os alvos de partida e, se veio, a primeira pesagem.
async function insertProfile(admin: SupabaseClient, userId: string, person: Person): Promise<void> {
  const now = new Date()
  const targets = startingTargets(
    {
      sex: person.sex,
      heightCm: person.height_cm,
      birthYear: person.birth_year,
      weightKg: person.weight_kg,
      targetWeightKg: person.target_weight_kg,
    },
    now.getUTCFullYear(),
  )
  const { error } = await admin.from('profile').insert({
    user_id: userId,
    sex: person.sex,
    height_cm: person.height_cm,
    birth_year: person.birth_year,
    target_weight_kg: person.target_weight_kg,
    ...targets,
  })
  if (error) throw new HttpError(500, `Não consegui criar o perfil: ${error.message}`)
  if (person.weight_kg != null) {
    await admin.from('weights').upsert(
      {
        user_id: userId,
        date: lisbonClock(now).date,
        kg: person.weight_kg,
        source: 'manual',
        measured_at: now.toISOString(),
      },
      { onConflict: 'user_id,date' },
    )
  }
}

function post(run: (req: VercelRequest) => Promise<unknown>) {
  return async (req: VercelRequest, res: VercelResponse) => {
    try {
      if (req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
      res.status(200).json(await run(req))
    } catch (err) {
      respondError(res, err)
    }
  }
}

// Criar a conta de outra pessoa (email e palavra-passe já confirmados) com o
// perfil dela. Só com sessão, e no máximo MAX_PEOPLE perfis.
export const addPerson = post(async (req) => {
  await requireUser(req)
  const input = parse(AddPersonSchema, req.body)
  const admin = adminClient()
  const { count } = await admin.from('profile').select('id', { count: 'exact', head: true })
  if ((count ?? 0) >= MAX_PEOPLE) throw new HttpError(409, `A app já tem ${MAX_PEOPLE} pessoas.`)

  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { name: input.name },
  })
  if (error || !data.user) {
    const message = error?.message ?? ''
    if (/already|registered|exists/i.test(message)) {
      throw new HttpError(409, 'Já existe uma conta com esse email. Usa «Já tem conta».')
    }
    if (/password/i.test(message)) throw new HttpError(400, 'A palavra-passe é fraca. Usa pelo menos 8 caracteres.')
    throw new HttpError(500, `Não consegui criar a conta: ${message}`)
  }
  try {
    await insertProfile(admin, data.user.id, input)
  } catch (err) {
    // Sem perfil a conta não serve: não fica meia criada.
    await admin.auth.admin.deleteUser(data.user.id)
    throw err
  }
  return { ok: true, email: input.email }
})

// Primeira vez de uma conta sem perfil (criada no painel do Supabase).
export const createProfile = post(async (req) => {
  const { user } = await requireUser(req)
  const input = parse(PersonSchema, req.body)
  const admin = adminClient()
  const { data: existing } = await admin.from('profile').select('id').eq('user_id', user.id).maybeSingle()
  if (!existing) await insertProfile(admin, user.id, input)
  await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { ...(user.user_metadata ?? {}), name: input.name },
  })
  return { ok: true, existed: Boolean(existing) }
})
