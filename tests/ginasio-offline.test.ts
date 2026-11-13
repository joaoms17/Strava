import { describe, expect, it } from 'vitest'
import {
  DRAFT_TIMER_MAX_MS,
  cachedPlanFavorite,
  enqueueGym,
  flushGymQueue,
  keptDraft,
  readGymQueue,
  rememberPlanFavorite,
} from '../src/lib/ginasio-offline'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  }
}

const NOW = Date.parse('2026-11-13T08:00:00Z')

describe('rascunho do ginásio (T11)', () => {
  const done = { startedAt: NOW - 14 * 3600_000, exercises: [{ sets: [{ done: true }, { done: false }] }] }
  it('com séries feitas não expira: fica congelado (sem cronómetro)', () => {
    expect(keptDraft(done, NOW)).toEqual({ ...done, frozen: true })
  })
  it('sem séries feitas, passadas 6 h, perde-se', () => {
    expect(keptDraft({ ...done, exercises: [{ sets: [{ done: false }] }] }, NOW)).toBeNull()
  })
  it('dentro das 6 h fica como está', () => {
    const fresh = { ...done, startedAt: NOW - DRAFT_TIMER_MAX_MS + 60_000 }
    expect(keptDraft(fresh, NOW)).toBe(fresh)
  })
  it('lixo no armazenamento não rebenta', () => {
    expect(keptDraft(null, NOW)).toBeNull()
    expect(keptDraft({ startedAt: Number.NaN, exercises: [] }, NOW)).toBeNull()
  })
})

describe('fila do «Terminar» (T11)', () => {
  const entry = (id: string) => ({ client_id: id, body: { client_id: id, minutes: 50 }, label: 'Ginásio', at: '2026-11-13T07:00:00Z' })
  const offline = new TypeError('Sem rede')

  it('o mesmo client_id não entra duas vezes', () => {
    const s = memoryStorage()
    enqueueGym(entry('a'), s)
    enqueueGym(entry('a'), s)
    expect(readGymQueue(s)).toHaveLength(1)
  })
  it('envia por ordem e tira da fila; sem rede pára e fica tudo', async () => {
    const s = memoryStorage()
    enqueueGym(entry('a'), s)
    enqueueGym(entry('b'), s)
    const net = await flushGymQueue(() => Promise.reject(offline), (e) => e instanceof TypeError, s)
    expect(net).toEqual({ sent: 0, failed: 0 })
    expect(readGymQueue(s)).toHaveLength(2)
    const sent: string[] = []
    const ok = await flushGymQueue(async (b) => void sent.push(b.client_id), () => false, s)
    expect(ok.sent).toBe(2)
    expect(sent).toEqual(['a', 'b'])
    expect(readGymQueue(s)).toHaveLength(0)
  })
  it('uma recusa do servidor fica marcada e não bloqueia as outras', async () => {
    const s = memoryStorage()
    enqueueGym(entry('a'), s)
    enqueueGym(entry('b'), s)
    const result = await flushGymQueue(
      async (b) => {
        if (b.client_id === 'a') throw new Error('Dados inválidos.')
      },
      (e) => e instanceof TypeError,
      s,
    )
    expect(result).toEqual({ sent: 1, failed: 1 })
    expect(readGymQueue(s)).toEqual([{ ...entry('a'), error: 'Dados inválidos.' }])
  })
})

describe('«Começar Dia N» sem rede (T11)', () => {
  it('lembra o id do treino do plano', () => {
    const s = memoryStorage()
    expect(cachedPlanFavorite('Fase 1 · Dia 2', s)).toBeNull()
    rememberPlanFavorite('Fase 1 · Dia 2', 'id-2', s)
    rememberPlanFavorite('Fase 1 · Dia 3', 'id-3', s)
    expect(cachedPlanFavorite('Fase 1 · Dia 2', s)).toBe('id-2')
  })
})
