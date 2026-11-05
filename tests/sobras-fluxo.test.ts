import { beforeEach, describe, expect, it, vi } from 'vitest'

// O fluxo do «Sobrou comida?» de ponta a ponta, com o Supabase e a IA a
// fingir: o que fica gravado na refeição depois da foto do que sobrou.

type Row = Record<string, unknown>
const state: { rows: Row[]; answer: unknown; writes: Row[] } = { rows: [], answer: null, writes: [] }

// Um construtor de queries mínimo: select/update com eq/in/is, sobre `state.rows`.
function table() {
  let patch: Row | null = null
  const filters: ((r: Row) => boolean)[] = []
  const run = () => {
    const hit = state.rows.filter((r) => filters.every((f) => f(r)))
    if (patch) {
      for (const r of hit) Object.assign(r, structuredClone(patch))
      state.writes.push(structuredClone(patch))
    }
    return { data: structuredClone(hit), error: null }
  }
  const q = {
    select: () => q,
    update: (values: Row) => {
      patch = values
      return q
    },
    eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
    in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), q),
    is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), q),
    maybeSingle: async () => {
      const { data } = run()
      return { data: data[0] ?? null, error: null }
    },
    then: (resolve: (v: unknown) => void) => resolve(run()),
  }
  return q
}
const db = { from: () => table() }

vi.mock('@vercel/functions', () => ({ waitUntil: () => undefined }))
vi.mock('../api/_lib/supabase.js', () => ({
  HttpError: class HttpError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message)
    }
  },
  adminClient: () => db,
  requireUser: async () => ({ user: { id: 'u1' }, db, token: 't' }),
}))
vi.mock('../api/_lib/anthropic.js', () => ({
  MODELS: { vision: 'v', text: 't' },
  NO_THINKING: { type: 'disabled' },
  REQUEST_VISION: { maxRetries: 0, timeout: 1 },
  REQUEST_TEXT: { maxRetries: 0, timeout: 1 },
  aiProvider: () => 'anthropic',
  structuredCall: async () => ({ output: state.answer, cost: 0, model: 'v', reserve: false }),
}))
vi.mock('../api/_lib/meal-analysis.js', () => ({
  aiLimitReached: async () => false,
  photoContent: async (_admin: unknown, paths: string[]) => paths.map(() => ({ type: 'image' })),
}))
vi.mock('../api/_lib/foods.js', () => ({ learnFoods: async () => undefined }))

const { leftovers, leftoversUndo } = await import('../api/_meal/leftovers')

function item(name: string, grams: number, kcal: number, extra: Row = {}) {
  return { name, grams, kcal, protein: kcal / 20, carbs: kcal / 10, fat: kcal / 40, food_id: null, estimated: false, confidence: 'alta', ...extra }
}

function meal(items: Row[]): Row {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    user_id: 'u1',
    client_id: 'c1',
    status: 'ok',
    deleted_at: null,
    input_type: 'photo',
    tags: [],
    raw_text: null,
    note: null,
    photo_paths: ['u1/c1/0.jpg'],
    image_hashes: [],
    items,
    kcal: items.reduce((a, i) => a + (i.kcal as number), 0),
    confirmed_at: null,
    analysis_started_at: null,
    leftover_photo_path: null,
    leftover_thumb_path: null,
    leftover_kcal: null,
    prompt_version: 'meal-photo.v3',
  }
}

async function call(handler: typeof leftovers, body: Row) {
  let status = 0
  let json: Row = {}
  const res = {
    status: (s: number) => ((status = s), res),
    json: (j: Row) => ((json = j), res),
  }
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body } as never, res as never)
  return { status, json }
}

const plate = () => [item('Hambúrguer de feijão', 120, 180), item('Arroz branco cozido', 150, 195), item('Salada', 80, 18.8)]

beforeEach(() => {
  state.rows = [meal(plate())]
  state.writes = []
})

describe('«Sobrou comida?» de ponta a ponta', () => {
  it('sobrou metade do arroz: o arroz desce e o total desce o mesmo que «sobrou»', async () => {
    state.answer = {
      same_plate: true,
      reason: null,
      empty_plate: false,
      items: [
        { index: 0, name: 'Hambúrguer de feijão', eaten: 1, confidence: 'alta' },
        { index: 1, name: 'Arroz branco cozido', eaten: 0.5, confidence: 'alta' },
        { index: 2, name: 'Salada', eaten: 1, confidence: 'alta' },
      ],
    }
    const { status, json } = await call(leftovers, { meal_id: state.rows[0]!.id, photo_path: 'u1/c1/d1.jpg' })
    expect(status).toBe(200)
    expect(json.outcome).toBe('aplicado')
    const row = state.rows[0]!
    const items = row.items as Row[]
    expect(items.map((i) => i.grams)).toEqual([120, 75, 80])
    expect(row.leftover_kcal).toBe(97.5)
    expect(row.kcal).toBe(296.3)
    // A conta fecha: o que comeu + o que sobrou = o prato cheio.
    expect((row.kcal as number) + (row.leftover_kcal as number)).toBeCloseTo(393.8, 1)
  })

  // O caso do João: a IA disse bem o que sobrou (o arroz, pelo nome), mas
  // contou os índices a partir de 1. Antes, o índice mandava: o arroz ficava
  // com os 150 g e «sobrou» saía da salada (e o último item perdia-se).
  it('índices contados a partir de 1: desconta o arroz, não o item ao lado', async () => {
    state.answer = {
      same_plate: true,
      reason: null,
      empty_plate: false,
      items: [
        { index: 1, name: 'Hambúrguer de feijão', eaten: 1, confidence: 'alta' },
        { index: 2, name: 'Arroz branco cozido', eaten: 0.4, confidence: 'alta' },
        { index: 3, name: 'Salada', eaten: 1, confidence: 'alta' },
      ],
    }
    const { status } = await call(leftovers, { meal_id: state.rows[0]!.id, photo_path: 'u1/c1/d1.jpg' })
    expect(status).toBe(200)
    const row = state.rows[0]!
    const items = row.items as Row[]
    expect(items.map((i) => [i.name, i.grams])).toEqual([
      ['Hambúrguer de feijão', 120],
      ['Arroz branco cozido', 60],
      ['Salada', 80],
    ])
    expect(items[1]!.estimated).toBe(true)
    expect(row.leftover_kcal).toBe(117)
    expect(row.kcal).toBe(276.8)
  })

  it('um nome que não é de nenhum item não desconta outro só pelo índice', async () => {
    state.answer = {
      same_plate: true,
      reason: null,
      empty_plate: false,
      items: [{ index: 1, name: 'Batata frita', eaten: 0, confidence: 'alta' }],
    }
    const { json } = await call(leftovers, { meal_id: state.rows[0]!.id, photo_path: 'u1/c1/d1.jpg' })
    expect(json.outcome).toBe('tudo')
    expect((state.rows[0]!.items as Row[]).map((i) => i.grams)).toEqual([120, 150, 80])
    expect(state.rows[0]!.leftover_kcal).toBe(0)
  })

  it('a IA recebe os itens com `index` (o mesmo nome do campo da resposta)', async () => {
    const anthropic = await import('../api/_lib/anthropic.js')
    const spy = vi.spyOn(anthropic, 'structuredCall')
    state.answer = { same_plate: true, reason: null, empty_plate: true, items: [] }
    await call(leftovers, { meal_id: state.rows[0]!.id, photo_path: 'u1/c1/d1.jpg' })
    const params = spy.mock.calls[0]![2] as { messages: { content: { type: string; text?: string }[] }[] }
    const text = params.messages[0]!.content.find((c) => c.type === 'text')!.text!
    const payload = JSON.parse(text) as { itens: Row[] }
    expect(payload.itens.map((i) => i.index)).toEqual([0, 1, 2])
    expect(payload.itens[0]).not.toHaveProperty('indice')
    spy.mockRestore()
  })

  it('Anular repõe o prato cheio e tira a foto do depois', async () => {
    state.answer = {
      same_plate: true,
      reason: null,
      empty_plate: false,
      items: [{ index: 1, name: 'Arroz branco cozido', eaten: 0.5, confidence: 'alta' }],
    }
    const id = state.rows[0]!.id
    const { json } = await call(leftovers, { meal_id: id, photo_path: 'u1/c1/d1.jpg' })
    const previous = json.previous as Row
    const undone = await call(leftoversUndo, { meal_id: id, photo_path: 'u1/c1/d1.jpg', ...previous })
    expect(undone.status).toBe(200)
    const row = state.rows[0]!
    expect((row.items as Row[]).map((i) => i.grams)).toEqual([120, 150, 80])
    expect(row.kcal).toBe(393.8)
    expect(row.leftover_photo_path).toBeNull()
    expect(row.leftover_kcal).toBeNull()
  })
})
