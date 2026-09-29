import { useState } from 'react'
import { postApi } from '../lib/api'
import Icon from './ui/Icon'

interface ModelCheck {
  model: string
  label: string
  ok: boolean
  ms: number
  message: string
  detail: string | null
}

interface AiCheckResult {
  ok: boolean
  key: boolean
  provider?: string
  key_shape?: string
  resumo: string
  models: ModelCheck[]
}

// «Verificar a IA»: uma chamada mínima a cada modelo, no servidor, com a
// chave que está no Vercel. Diz o que está mal em linguagem simples.
export default function AiCheck({ compact = false }: { compact?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AiCheckResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      setResult(await postApi<AiCheckResult>('/api/day/ai-check', {}))
    } catch (err) {
      setResult(null)
      setError(err instanceof Error ? err.message : 'Não consegui verificar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <button
        disabled={busy}
        onClick={() => void run()}
        className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line px-4 text-[15px] disabled:opacity-60 ${
          compact ? 'w-full' : ''
        }`}
      >
        <Icon name="check" size={18} />
        {busy ? 'A verificar…' : 'Verificar a IA'}
      </button>
      {error && <p className="text-[14px] text-eat">{error}</p>}
      {result && (
        <div className="space-y-1.5 rounded-xl bg-surface2 p-3 text-[14px]">
          <p className={`font-semibold ${result.ok ? 'text-burn' : 'text-eat'}`}>{result.resumo}</p>
          {result.provider && <p className="text-[13px] text-dim">IA em uso: {result.provider}</p>}
          {result.models.map((m) => (
            <div key={m.model}>
              <p className="flex justify-between gap-2">
                <span>
                  {m.ok ? '✓' : '✗'} {m.label} <span className="text-dim">({m.model})</span>
                </span>
                <span className="text-dim tabular-nums">{(m.ms / 1000).toFixed(1).replace('.', ',')} s</span>
              </p>
              {!m.ok && (
                <>
                  <p className="text-eat">{m.message}</p>
                  {m.detail && <p className="font-mono text-[12px] break-words text-dim select-text">{m.detail}</p>}
                </>
              )}
            </div>
          ))}
          {result.key && result.key_shape && !result.ok && (
            <p className="text-[13px] text-dim">Chave no Vercel: {result.key_shape}</p>
          )}
        </div>
      )}
    </div>
  )
}
