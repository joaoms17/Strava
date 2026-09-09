import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Chapter, Profile } from '../lib/types'

// Linha do tempo: a linha do João lado a lado com as dos patronos —
// cada um caiu, cada um voltou.
export default function LinhaDoTempo() {
  const [timeline, setTimeline] = useState<Profile['timeline']>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    async function load() {
      const [{ data: profile }, { data: chapterRows }] = await Promise.all([
        supabase.from('profile').select('timeline').single(),
        supabase.from('chapters').select('*').order('order_index'),
      ])
      setTimeline((profile?.timeline ?? []) as Profile['timeline'])
      setChapters((chapterRows ?? []) as Chapter[])
      setLoaded(true)
    }
    void load()
  }, [])

  if (!loaded) return <p className="pt-8 text-center text-sm text-dim">A carregar…</p>

  return (
    <div className="mx-auto max-w-md space-y-6 pt-2">
      <section className="space-y-2">
        <h2 className="font-display text-lg">A tua linha</h2>
        <ol className="space-y-0">
          {timeline.map((entry, i) => (
            <li key={i} className="relative border-l border-edge pb-4 pl-4 last:pb-0">
              <span className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full bg-accent" />
              <p className="text-xs text-accent">{entry.when}</p>
              <p className="text-sm">{entry.label}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg">As linhas deles</h2>
        {chapters.map((chapter) => {
          const fall = chapter.facts[0]
          const comeback = chapter.facts[chapter.facts.length - 1]
          return (
            <div key={chapter.id} className="space-y-2 rounded-2xl border border-edge bg-card p-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold">{chapter.patron}</p>
                <p className="shrink-0 text-xs text-dim">
                  {chapter.order_index === 0 ? 'Prólogo' : `Cap. ${chapter.order_index}`} ·{' '}
                  {chapter.sport}
                </p>
              </div>
              <ol>
                {fall && (
                  <li className="relative border-l border-edge pb-3 pl-4">
                    <span className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full bg-warn" />
                    <p className="text-xs text-dim">a queda</p>
                    <p className="text-sm">{fall}</p>
                  </li>
                )}
                {comeback && comeback !== fall && (
                  <li className="relative border-l border-edge pl-4">
                    <span className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full bg-ok" />
                    <p className="text-xs text-dim">o regresso</p>
                    <p className="text-sm">{comeback}</p>
                  </li>
                )}
              </ol>
              {chapter.theme && <p className="text-xs italic text-dim">{chapter.theme}</p>}
            </div>
          )
        })}
      </section>
    </div>
  )
}
