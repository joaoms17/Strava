import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { adminClient, HttpError, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { MODELS, REQUEST_TEXT, structuredCall } from '../_lib/anthropic.js'
import { PROMPT_RECIPE, readPrompt } from '../_lib/prompts.js'
import { aiLimitReached, foodLibrary } from '../_lib/meal-analysis.js'
import { fetchPublicPage } from '../_lib/safe-fetch.js'
import { AnalysedItemSchema, Confidence } from '../_lib/schemas.js'
import { toMealItems } from '../_lib/rules/analise.js'
import { extractRecipe, pageTitle, parseServings, visibleText } from '../_lib/rules/receita.js'

// Favoritas › Nova favorita › «Receita»: um link (Pingo Doce, Continente,
// Teleculinária, blogs…) ou o texto colado viram a lista de ingredientes com
// gramas e as contas da receita toda, pelo mesmo caminho das refeições (a
// biblioteca pessoal e as guardas dos números). Não grava: a app divide
// pelas doses e guarda a favorita por dose.

const Body = z.object({
  url: z.string().trim().max(2000).optional(),
  text: z.string().trim().max(15_000).optional(),
})

const RecipeSchema = z.object({
  title: z.string(),
  doses: z.number().nullable(),
  items: z.array(AnalysedItemSchema),
  meal_confidence: Confidence,
})

// Uma receita inteira pode levar mais de 1,5 kg de um ingrediente.
const MAX_RECIPE_ITEM_GRAMS = 5000

export default async function recipe(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
    const { user } = await requireUser(req)
    const body = Body.safeParse(req.body ?? {})
    if (!body.success) throw new HttpError(400, 'Cola o link ou o texto da receita.')
    const { url, text } = body.data
    if (!url && !text) throw new HttpError(400, 'Cola o link ou o texto da receita.')

    const admin = adminClient()
    if (await aiLimitReached(admin, user.id, false)) {
      throw new HttpError(429, 'Chegaste ao limite da IA (Definições › Avançado).')
    }

    // Do link: primeiro o schema.org Recipe; sem ele, o texto que se vê.
    let source: 'receita' | 'pagina' | 'texto' = 'texto'
    let payload: Record<string, unknown>
    if (url) {
      const page = await fetchPublicPage(url)
      const found = extractRecipe(page.html)
      if (found) {
        source = 'receita'
        payload = {
          nome: found.name,
          ingredientes: found.ingredients,
          texto: null,
          doses_da_receita: found.servings,
          nutricao_do_site: found.nutrition,
        }
      } else {
        source = 'pagina'
        const visible = visibleText(page.html)
        if (visible.length < 80) throw new HttpError(422, 'Não encontrei a receita nessa página. Copia o texto e cola-o aqui.')
        payload = { nome: pageTitle(page.html), ingredientes: null, texto: visible, doses_da_receita: null, nutricao_do_site: null }
      }
    } else {
      payload = { nome: null, ingredientes: null, texto: text, doses_da_receita: null, nutricao_do_site: null }
    }

    const { refs, forPrompt } = await foodLibrary(admin, user.id)
    const { output } = await structuredCall(
      admin,
      { userId: user.id, kind: 'recipe', request: REQUEST_TEXT },
      {
        model: MODELS.text,
        max_tokens: 6000,
        temperature: 0,
        system: readPrompt(PROMPT_RECIPE),
        messages: [{ role: 'user', content: JSON.stringify({ ...payload, alimentos: forPrompt }) }],
      },
      RecipeSchema,
    )
    const items = toMealItems(output.items, refs, MAX_RECIPE_ITEM_GRAMS)
    if (items.length === 0) {
      throw new HttpError(422, 'Não encontrei os ingredientes. Cola o texto da receita com as quantidades.')
    }
    const pageDoses = typeof payload.doses_da_receita === 'number' ? payload.doses_da_receita : null
    res.status(200).json({
      title: output.title.trim().slice(0, 60) || (typeof payload.nome === 'string' ? payload.nome.slice(0, 60) : ''),
      doses: pageDoses ?? parseServings(output.doses) ?? null,
      items,
      confidence: output.meal_confidence,
      source,
    })
  } catch (err) {
    respondError(res, err)
  }
}
