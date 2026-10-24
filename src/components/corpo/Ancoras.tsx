import { useEffect, useRef, useState } from 'react'
import { PERIODS, PERIOD_LABEL, type Period } from '../../../api/_lib/rules/graficos'

export interface Section {
  id: string
  label: string
}

// A altura da barra (para as secções não ficarem por baixo dela ao saltar).
export const BAR_OFFSET = 'calc(env(safe-area-inset-top) + 64px)'

// Corpo › a barra que fica presa em cima ao descer: as secções (um toque
// salta para lá; a que se está a ver fica marcada) e o período de todos os
// gráficos da página (1M / 3M / Tudo). Não tapa nada: está no fluxo da
// página e as secções têm a margem da barra ao saltar.
// `track`: todas as secções da página por ordem (a Evolução não tem botão:
// enquanto se lê, nenhuma fica marcada).
export default function Ancoras({
  sections,
  track,
  period,
  onPeriod,
}: {
  sections: Section[]
  track: string[]
  period: Period
  onPeriod: (p: Period) => void
}) {
  const [active, setActive] = useState<string | null>(null)
  const bar = useRef<HTMLElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const ids = track.join(',')
  const buttons = new Set(sections.map((s) => s.id))

  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const bottom = (bar.current?.getBoundingClientRect().bottom ?? 0) + 24
      let current: string | null = null
      for (const id of ids.split(',')) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= bottom) current = id
      }
      // No fim da página, a última secção (pode ser curta demais para chegar ao topo).
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = ids.split(',').pop() ?? current
      setActive(current != null && buttons.has(current) ? current : null)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [ids])

  // A marcada fica à vista na barra (se as secções não couberem todas).
  useEffect(() => {
    if (!active) return
    const l = list.current
    const el = l?.querySelector<HTMLElement>(`[data-section="${active}"]`)
    if (!l || !el) return
    const left = el.offsetLeft - l.offsetLeft
    if (left < l.scrollLeft) l.scrollLeft = left - 8
    else if (left + el.offsetWidth > l.scrollLeft + l.clientWidth) l.scrollLeft = left + el.offsetWidth - l.clientWidth + 8
  }, [active])

  function go(id: string) {
    const el = document.getElementById(id)
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    setActive(id)
  }

  return (
    <nav
      ref={bar}
      aria-label="Secções do Corpo"
      className="sticky top-[env(safe-area-inset-top)] z-20 -mx-4 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur"
    >
      <div className="flex items-center gap-2">
        <div ref={list} className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              data-section={s.id}
              onClick={(e) => {
                e.preventDefault()
                go(s.id)
              }}
              aria-current={active === s.id ? 'location' : undefined}
              className={`flex min-h-10 shrink-0 items-center rounded-lg px-2 text-[14px] whitespace-nowrap ${
                active === s.id ? 'bg-surface2 font-semibold text-ink' : 'text-dim'
              }`}
            >
              {s.label}
            </a>
          ))}
        </div>
        <label className="relative flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface pr-2.5 pl-3 text-[14px] font-semibold text-ink">
          <span className="sr-only">Período dos gráficos</span>
          <span aria-hidden>{period}</span>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="text-dim">
            <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {/* A escolha nativa (no iPhone, a roda) por cima, transparente: o botão mostra só «3M». */}
          <select
            value={period}
            onChange={(e) => onPeriod(e.target.value as Period)}
            className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {p === 'Tudo' ? 'Tudo (desde o início)' : `${p} · ${PERIOD_LABEL[p]}`}
              </option>
            ))}
          </select>
        </label>
      </div>
    </nav>
  )
}
