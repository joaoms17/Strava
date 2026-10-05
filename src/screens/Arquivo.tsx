import { useEffect, useState } from 'react'
import { Link, Route, Switch, useLocation } from 'wouter'
import { supabase } from '../lib/supabase'
import type { WeeklyReview } from '../lib/types'
import Capitulo from './Capitulo'
import LinhaDoTempo from './LinhaDoTempo'

function Index() {
  const [reviews, setReviews] = useState<WeeklyReview[] | null>(null)

  useEffect(() => {
    void supabase
      .from('weekly_reviews')
      .select('week_start,text')
      .neq('kind', 'evolucao')
      .order('week_start', { ascending: false })
      .limit(20)
      .then(({ data }) => setReviews((data ?? []) as WeeklyReview[]))
  }, [])

  return (
    <div className="space-y-6 pt-1 pb-4">
      <p className="text-[15px] text-dim">
        A parte narrativa da primeira versão, só para ver: capítulos, patronos e os resumos antigos.
      </p>
      <div className="divide-y divide-line rounded-2xl bg-surface">
        <Link href="/capitulo" className="flex min-h-14 items-center justify-between px-4 text-[15px]">
          Capítulo <span className="text-dim">›</span>
        </Link>
        <Link href="/linha" className="flex min-h-14 items-center justify-between px-4 text-[15px]">
          Linha do tempo <span className="text-dim">›</span>
        </Link>
      </div>
      <section className="space-y-3">
        <h2 className="px-1 text-[13px] font-semibold text-dim">Resumos antigos do narrador</h2>
        {reviews == null && <p className="text-[15px] text-dim">A carregar…</p>}
        {reviews?.length === 0 && <p className="text-[15px] text-dim">Sem resumos arquivados.</p>}
        {reviews?.map((review) => (
          <article key={review.week_start} className="space-y-1 rounded-2xl bg-surface p-4">
            <p className="text-[13px] text-dim">
              Semana de {review.week_start.split('-').reverse().slice(0, 2).join('/')}
            </p>
            <p className="text-[15px] leading-relaxed whitespace-pre-line">{review.text}</p>
          </article>
        ))}
      </section>
    </div>
  )
}

// Arquivo: capítulos, linha do tempo e resumos antigos, só de leitura.
export default function Arquivo() {
  const [, navigate] = useLocation()
  return (
    <Switch>
      <Route path="/" component={Index} />
      <Route path="/capitulo">
        <Capitulo onOpenTimeline={() => navigate('/linha')} />
      </Route>
      <Route path="/linha" component={LinhaDoTempo} />
    </Switch>
  )
}
