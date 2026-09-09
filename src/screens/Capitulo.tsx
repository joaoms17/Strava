import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { sessionDate } from '../../api/_lib/rules/plan-dates'
import { shiftDate } from '../lib/day'
import type { Chapter, PlanBlock, PlannedSession, Profile, Workout } from '../lib/types'
import Cartaz from '../components/Cartaz'

interface CapituloData {
  chapter: Chapter
  block: PlanBlock | null
  sessions: PlannedSession[]
  blockWorkouts: Workout[]
  timeline: Profile['timeline']
}

export default function Capitulo({ onOpenTimeline }: { onOpenTimeline?: () => void }) {
  const [data, setData] = useState<CapituloData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const [{ data: blocks }, { data: profile }] = await Promise.all([
        supabase
          .from('plan_blocks')
          .select('*')
          .in('status', ['active', 'completed'])
          .order('created_at', { ascending: false })
          .limit(1),
        supabase.from('profile').select('timeline').single(),
      ])
      const block = (blocks?.[0] ?? null) as PlanBlock | null

      let chapter: Chapter | null = null
      let sessions: PlannedSession[] = []
      let blockWorkouts: Workout[] = []
      if (block?.chapter_id) {
        const blockEnd = shiftDate(block.start_date, 27)
        const [{ data: chapterRow }, { data: sessionRows }, { data: workoutRows }] =
          await Promise.all([
            supabase.from('chapters').select('*').eq('id', block.chapter_id).maybeSingle(),
            supabase.from('planned_sessions').select('*').eq('block_id', block.id),
            supabase
              .from('workouts')
              .select('*')
              .gte('date', block.start_date)
              .lte('date', blockEnd),
          ])
        chapter = (chapterRow ?? null) as Chapter | null
        sessions = (sessionRows ?? []) as PlannedSession[]
        blockWorkouts = (workoutRows ?? []) as Workout[]
      }
      if (!chapter) {
        const { data: prologue } = await supabase
          .from('chapters')
          .select('*')
          .eq('order_index', 0)
          .maybeSingle()
        chapter = (prologue ?? null) as Chapter | null
      }
      if (!chapter) {
        setError('Capítulo não encontrado — corre os seeds no Supabase.')
        return
      }
      setData({
        chapter,
        block,
        sessions,
        blockWorkouts,
        timeline: (profile?.timeline ?? []) as Profile['timeline'],
      })
    }
    void load()
  }, [])

  if (error) return <p className="pt-8 text-center text-sm text-warn">{error}</p>
  if (!data) return <p className="pt-8 text-center text-sm text-dim">A carregar…</p>

  const { chapter, block, sessions, blockWorkouts, timeline } = data
  const numero =
    chapter.jersey_number != null ? String(chapter.jersey_number) : (chapter.poster_stat ?? '')
  const mission = block?.plan?.mission ?? null
  const done = sessions.filter((s) => s.status === 'done').length
  const totalMinutes = blockWorkouts.reduce((acc, w) => acc + (w.minutes ?? 0), 0)
  const maxWatts = blockWorkouts.reduce<number | null>(
    (acc, w) => (w.watts != null && (acc == null || w.watts > acc) ? w.watts : acc),
    null,
  )
  const greens = blockWorkouts.filter((w) => w.status === 'green').length

  const nextPlanned = block
    ? sessions
        .filter((s) => s.status === 'planned')
        .map((s) => sessionDate(block.start_date, s.week, s.day_index))
        .sort()[0]
    : undefined

  return (
    <div className="mx-auto max-w-md space-y-6 pt-2">
      <Cartaz
        numero={numero}
        titulo={chapter.title}
        patrono={chapter.patron}
        dado={chapter.theme ?? ''}
      />

      {mission && (
        <section className="space-y-2 rounded-2xl border border-accent/40 bg-card p-4">
          <h2 className="text-sm font-semibold">{mission.title}</h2>
          <ul className="space-y-1">
            {mission.numbers.map((line, i) => (
              <li key={i} className="text-sm text-dim">
                → <span className="text-ink">{line}</span>
              </li>
            ))}
          </ul>
          {block?.status === 'active' && (
            <p className="text-xs text-dim">
              {done} de {sessions.length} sessões feitas
              {nextPlanned && ` · próxima a ${nextPlanned.split('-').reverse().slice(0, 2).join('/')}`}
            </p>
          )}
        </section>
      )}

      {block?.status === 'completed' && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-dim">O fecho do capítulo</h2>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-edge bg-card p-3">
              <p className="text-xl font-bold">
                {done}/{sessions.length}
              </p>
              <p className="text-xs text-dim">sessões</p>
            </div>
            <div className="rounded-xl border border-edge bg-card p-3">
              <p className="text-xl font-bold">{totalMinutes}</p>
              <p className="text-xs text-dim">minutos</p>
            </div>
            <div className="rounded-xl border border-edge bg-card p-3">
              <p className="text-xl font-bold">{maxWatts ?? '—'}</p>
              <p className="text-xs text-dim">W máx</p>
            </div>
          </div>
          <p className="text-xs text-dim">{greens} sessões verdes no semáforo.</p>
        </section>
      )}

      {chapter.photo_path && (
        <figure className="space-y-1">
          <img
            src={supabase.storage.from('chapter-photos').getPublicUrl(chapter.photo_path).data.publicUrl}
            alt={chapter.patron}
            className="w-full rounded-2xl border border-edge"
          />
          {chapter.photo_credit && (
            <figcaption className="px-1 text-xs text-dim">{chapter.photo_credit}</figcaption>
          )}
        </figure>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-dim">Os factos</h2>
        <ul className="space-y-2">
          {chapter.facts.map((fact, i) => (
            <li key={i} className="rounded-xl border border-edge bg-card px-4 py-3 text-sm">
              {fact}
            </li>
          ))}
        </ul>
        {chapter.honest_note && <p className="px-1 text-xs italic text-dim">{chapter.honest_note}</p>}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-dim">A tua linha</h2>
        <ul className="space-y-2">
          {timeline.map((entry, i) => (
            <li
              key={i}
              className="flex items-baseline gap-3 rounded-xl border border-edge bg-card px-4 py-3 text-sm"
            >
              <span className="shrink-0 text-xs text-accent">{entry.when}</span>
              <span>{entry.label}</span>
            </li>
          ))}
        </ul>
        <p className="px-1 text-xs text-dim">
          O {chapter.patron} também começou com o corpo desfeito. A lesão no início não decide o
          fim.
        </p>
        {onOpenTimeline && (
          <button onClick={onOpenTimeline} className="w-full py-2 text-center text-sm text-accent">
            Linha do tempo completa →
          </button>
        )}
      </section>
    </div>
  )
}
