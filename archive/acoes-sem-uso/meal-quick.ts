// Arquivado (L6): POST /api/meal/quick («Só números»), sem chamador desde a
// decisão 246. Estava em api/_meal/async.ts; fica só para consulta (fora de
// api/, do tsconfig e do vitest).

const QuickSchema = z.object({
  client_id: z.string().uuid().optional(),
  kcal: z.number().min(0).max(5000),
  protein: z.number().min(0).max(400),
  carbs: z.number().min(0).max(800).optional(),
  fat: z.number().min(0).max(400).optional(),
  name: z.string().trim().max(80).optional(),
  date: DATE.optional(),
  slot: SLOT.optional(),
})

// Só números: um item sintético «Registo rápido», para uma edição futura
// nunca pôr os totais a zero.
export const quick = post(async ({ db, userId, body, res }) => {
  const input = parse(QuickSchema, body)
  if (input.client_id) {
    const { data: existing } = await db.from('meals').select('*').eq('client_id', input.client_id).maybeSingle()
    if (existing) {
      res.status(200).json({ meal: existing })
      return
    }
  }
  const now = new Date()
  const cutoff = await cutoffHour(db)
  // Com uma refeição escolhida, a hora habitual dela (também hoje).
  const today = nutritionalDay(now, cutoff)
  const loggedAt =
    input.slot || (input.date && input.date !== today)
      ? loggedAtFor(input.date ?? today, SLOT_TIME[input.slot ?? slotOf(now)], cutoff, now)
      : now
  const items: MealItem[] = [
    {
      name: input.name || 'Registo rápido',
      grams: 0,
      kcal: round1(input.kcal),
      protein: round1(input.protein),
      carbs: round1(input.carbs ?? 0),
      fat: round1(input.fat ?? 0),
      food_id: null,
      estimated: false,
      confidence: 'alta',
    },
  ]
  const { data, error } = await db
    .from('meals')
    .insert({
      user_id: userId,
      client_id: input.client_id ?? null,
      date: nutritionalDay(loggedAt, cutoff),
      logged_at: loggedAt.toISOString(),
      slot: input.slot ?? slotOf(loggedAt),
      input_type: 'quick',
      raw_text: input.name || null,
      items,
      ...mealTotals(items),
      is_estimate: false,
      status: 'ok',
      confirmed_at: now.toISOString(),
    })
    .select()
    .single()
  if (error) throw new HttpError(500, error.message)
  res.status(200).json({ meal: data })
})
