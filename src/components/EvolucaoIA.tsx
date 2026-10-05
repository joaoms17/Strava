import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { postApi } from '../lib/api'
import { shiftDate } from '../lib/day'
import { AREA_LABEL, cleanAnalysis } from '../../api/_lib/rules/evolucao'

type Review = { week_start: string; text: string | null; data: { analise?: unknown } | null; created_at: string }

const ESTADO = {
  melhor: { label: 'a melhorar', className: 'text-ok' },
  igual: { label: 'estável', className: 'text-dim' },
  pior: { label: 'a piorar', className: 'text-attn' },
} as const

// Corpo › Evolução: a IA olha para tudo (peso, medidas, comida, treino, sono,
// FC em repouso e passos) quando se pede, e a análise fica guardada (uma por
// dia) até se pedir outra.
export default function EvolucaoIA({ today }: { today: string }) {
  const [review, setReview] = useState<Review | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void supabase
      .from('weekly_reviews')
      .select('week_start,text,data,created_at')
      .eq('kind', 'evolucao')
      .order('week_start', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (alive) setReview(((data ?? [])[0] ?? null) as Review | null)
      })
    return () => {
      alive = false
    }
  }, [])

  async function analyse() {
    setBusy(true)
    setError(null)
    try {
      const { review: fresh } = await postApi<{ review: Review }>('/api/day/evolution', { refazer: true })
      setReview(fresh)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não consegui analisar agora.')
    } finally {
      setBusy(false)
    }
  }

  const analysis = review ? cleanAnalysis(review.data?.analise) : null
  const when = review
    ? review.week_start === today
      ? 'de hoje'
      : review.week_start === shiftDate(today, -1)
        ? 'de ontem'
        : `de ${review.week_start.slice(8, 10)}/${review.week_start.slice(5, 7)}`
    : null
  const primary =
    'min-h-12 w-full rounded-xl bg-cta font-display text-[17px] font-bold tracking-[0.04em] text-on-cta uppercase disabled:opacity-50'

  return (
    <div className="space-y-3 rounded-[18px] border border-line bg-surface p-4" aria-label="Análise da IA" role="region">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-display text-[12px] font-bold tracking-[0.16em] text-burn uppercase">Análise da IA</p>
        {analysis && when && <span className="text-[13px] text-dim">{when}</span>}
      </div>

      {review === undefined ? (
        <p className="text-[15px] text-dim">A carregar…</p>
      ) : !analysis || (!analysis.resumo && analysis.areas.length === 0) ? (
        <>
          <p className="text-[15px] text-dim">
            A IA olha para tudo — peso, medidas, comida, treino, sono, FC em repouso e passos — e diz como estás a
            evoluir e no que te deves focar.
          </p>
          <button disabled={busy} onClick={() => void analyse()} className={primary}>
            {busy ? 'A analisar…' : 'Analisar a minha evolução'}
          </button>
        </>
      ) : (
        <>
          {analysis.titulo && <p className="text-[19px] leading-snug font-semibold">{analysis.titulo}</p>}
          {analysis.resumo && <p className="text-[15px]">{analysis.resumo}</p>}
          {analysis.areas.length > 0 && (
            <ul className="divide-y divide-line/60">
              {analysis.areas.map((a) => (
                <li key={a.area} className="space-y-0.5 py-2.5">
                  <p className="flex items-baseline justify-between gap-2">
                    <span className="text-[15px] font-semibold">{AREA_LABEL[a.area]}</span>
                    <span className={`shrink-0 text-[13px] font-semibold ${ESTADO[a.estado].className}`}>
                      {ESTADO[a.estado].label}
                    </span>
                  </p>
                  <p className="text-[14px] text-dim">{a.texto}</p>
                </li>
              ))}
            </ul>
          )}
          {analysis.foco.length > 0 && (
            <div className="space-y-1.5">
              <p className="label">No que te focares</p>
              <ol className="list-decimal space-y-1 pl-5 text-[15px]">
                {analysis.foco.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ol>
            </div>
          )}
          {review!.week_start === today ? (
            <button disabled={busy} onClick={() => void analyse()} className="min-h-10 text-[14px] text-eat">
              {busy ? 'A analisar…' : 'Analisar outra vez'}
            </button>
          ) : (
            <button disabled={busy} onClick={() => void analyse()} className={primary}>
              {busy ? 'A analisar…' : 'Atualizar a análise'}
            </button>
          )}
        </>
      )}
      {error && <p className="text-[14px] text-pain">{error}</p>}
    </div>
  )
}
