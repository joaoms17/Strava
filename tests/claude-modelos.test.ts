import { describe, expect, it } from 'vitest'
import { MODELS, NO_THINKING, costUsd, forModel } from '../api/_lib/anthropic'

const base = { max_tokens: 1024, messages: [{ role: 'user' as const, content: 'x' }] }

describe('modelos Claude atuais', () => {
  it('texto no Haiku 5.5 e fotos no Sonnet 5.5', () => {
    expect(MODELS).toEqual({ text: 'claude-haiku-5-5', vision: 'claude-sonnet-5-5' })
  })

  it('Sonnet 5.5 não aceita thinking desligado: vai «between_tools»', () => {
    const p = forModel({ ...base, model: MODELS.vision, thinking: NO_THINKING })
    expect(p.thinking).toEqual({ type: 'between_tools' })
  })

  it('Haiku 5.5 pensa por omissão: para extrair JSON vai sem raciocínio', () => {
    expect(forModel({ ...base, model: MODELS.text }).thinking).toEqual({ type: 'disabled' })
  })

  it('os modelos novos recusam temperature/top_p/top_k: saem do pedido', () => {
    const p = forModel({ ...base, model: MODELS.text, temperature: 0, top_p: 0.9, top_k: 5 })
    expect(p).not.toHaveProperty('temperature')
    expect(p).not.toHaveProperty('top_p')
    expect(p).not.toHaveProperty('top_k')
  })

  it('custo pelos preços atuais (USD por milhão de tokens)', () => {
    expect(costUsd('claude-haiku-5-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(0.6)
    expect(costUsd('claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(12)
  })
})
