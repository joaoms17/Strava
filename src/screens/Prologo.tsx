import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Chapter, Profile } from '../lib/types'
import Cartaz from '../components/Cartaz'

export default function Prologo() {
  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [timeline, setTimeline] = useState<Profile['timeline']>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const [{ data: chapterRow, error: chapterError }, { data: profile }] = await Promise.all([
        supabase.from('chapters').select('*').eq('order_index', 0).maybeSingle(),
        supabase.from('profile').select('timeline').single(),
      ])
      if (chapterError || !chapterRow) {
        setError('Capítulo não encontrado — corre os seeds no Supabase.')
        return
      }
      setChapter(chapterRow as Chapter)
      setTimeline((profile?.timeline ?? []) as Profile['timeline'])
    }
    void load()
  }, [])

  if (error) return <p className="pt-8 text-center text-sm text-warn">{error}</p>
  if (!chapter) return <p className="pt-8 text-center text-sm text-dim">A carregar…</p>

  const numero = chapter.jersey_number != null ? String(chapter.jersey_number) : (chapter.poster_stat ?? '')

  return (
    <div className="mx-auto max-w-md space-y-6 pt-2">
      <Cartaz
        numero={numero}
        titulo={chapter.title}
        patrono={chapter.patron}
        dado={chapter.theme ?? ''}
      />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-dim">Os factos</h2>
        <ul className="space-y-2">
          {chapter.facts.map((fact, i) => (
            <li key={i} className="rounded-xl border border-edge bg-card px-4 py-3 text-sm">
              {fact}
            </li>
          ))}
        </ul>
        {chapter.honest_note && (
          <p className="px-1 text-xs italic text-dim">{chapter.honest_note}</p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-dim">A tua linha</h2>
        <ul className="space-y-2">
          {timeline.map((entry, i) => (
            <li key={i} className="flex items-baseline gap-3 rounded-xl border border-edge bg-card px-4 py-3 text-sm">
              <span className="shrink-0 text-xs text-accent">{entry.when}</span>
              <span>{entry.label}</span>
            </li>
          ))}
        </ul>
        <p className="px-1 text-xs text-dim">
          O {chapter.patron} também começou com o joelho desfeito. A lesão no início não decide o
          fim.
        </p>
      </section>
    </div>
  )
}
