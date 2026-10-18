import { useState, type ReactNode } from 'react'
import { BusyButton } from '../lib/busy'
import { chip } from './ui/Chips'
import { portionLabel } from '../../api/_lib/rules/favoritos'
import { HALF_SPLIT, OTHER_SPLITS, portionRow, sameFactor, splitLabel } from '../../api/_lib/rules/porcoes'

// A porção de uma refeição já analisada (folha da refeição) e a divisão ao
// partilhar («A meias», «João 60 · Joana 40», «Cada um comeu isto»): na folha
// da refeição, depois de tocar em «Partilhar com …»; no ＋, no «Também para …».

// «Porção ½ · 1 · 1½ · 2» numa linha. Uma porção fora destas (a 0,6 de uma
// divisão) aparece também, escolhida.
export function PortionRow({ value, onPick, label = 'Porção' }: { value: number; onPick: (factor: number) => unknown; label?: string }) {
  const row = portionRow(value)
  return (
    <div className="flex items-center gap-3">
      <span className="shrink-0 text-[15px] text-dim">{label}</span>
      <div role="group" aria-label={label} className={`grid flex-1 gap-2 ${row.length > 4 ? 'grid-cols-5' : 'grid-cols-4'}`}>
        {row.map((f) => {
          const on = sameFactor(f, value)
          return (
            <BusyButton
              key={f}
              compact
              busy="A mudar a porção…"
              aria-pressed={on}
              onClick={() => onPick(f)}
              className={`min-h-11 rounded-xl border text-[17px] font-semibold tabular-nums ${
                on ? 'border-eat bg-eat text-bg' : 'border-line'
              }`}
            >
              {portionLabel(f)}
            </BusyButton>
          )
        })}
      </div>
    </div>
  )
}

// Um interruptor pequeno («Todo o jantar (5)», «Também na de Joana»),
// desligado por omissão. Ligado fica com contorno e ✓: o laranja cheio é o
// da porção escolhida.
export function ScopeToggle({ on, onChange, children }: { on: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <button
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={`${chip(false)} ${on ? 'border-eat! font-semibold text-eat' : ''}`}
    >
      {on ? '✓ ' : ''}
      {children}
    </button>
  )
}

const option = 'min-h-11 rounded-xl border border-line px-2 text-[15px] leading-tight disabled:opacity-40'

// Folha da refeição: como comeram o que se partilha. «A meias» primeiro (o
// prato pedido para os dois); cada escolha partilha logo.
export function ShareChooser({
  me,
  other,
  scope,
  onPick,
  onCancel,
}: {
  me: string
  other: string
  scope?: ReactNode
  onPick: (split: number | null) => unknown
  onCancel: () => void
}) {
  const [more, setMore] = useState(false)
  return (
    <div className="space-y-2 rounded-2xl border border-line p-3">
      <p className="text-[15px]">
        Partilhar com {other} · <span className="text-dim">como comeram?</span>
      </p>
      {scope && <div className="flex flex-wrap gap-2">{scope}</div>}
      <BusyButton
        busy="A partilhar…"
        onClick={() => onPick(HALF_SPLIT)}
        className="min-h-12 w-full rounded-xl bg-eat text-[17px] font-semibold text-bg"
      >
        A meias
      </BusyButton>
      <div className="grid grid-cols-2 gap-2">
        <BusyButton busy="A partilhar…" onClick={() => onPick(null)} className={`${option} text-eat`}>
          Cada um comeu isto
        </BusyButton>
        <button
          aria-expanded={more}
          onClick={() => setMore(!more)}
          className={`${option} ${more ? 'border-eat! text-eat' : 'text-eat'}`}
        >
          Outra divisão
        </button>
      </div>
      {more && (
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Outra divisão">
          {OTHER_SPLITS.map((split) => (
            <BusyButton key={split} busy="A partilhar…" onClick={() => onPick(split)} className={`${option} tabular-nums`}>
              {splitLabel(split, me, other)}
            </BusyButton>
          ))}
        </div>
      )}
      <button onClick={onCancel} className="min-h-11 w-full text-[15px] text-dim">
        Cancelar
      </button>
    </div>
  )
}

// ＋ › «Também para …»: como comeram, guardado com a refeição até a análise
// acabar. Sem escolher, cada um comeu isto tudo (como antes).
export function SplitChips({
  me,
  other,
  value,
  onChange,
}: {
  me: string
  other: string
  value: number | null
  onChange: (split: number | null) => void
}) {
  const half = value != null && sameFactor(value, HALF_SPLIT)
  const [more, setMore] = useState(value != null && !half)
  // Uma linha que desliza, como as marcas por cima (e outra com as divisões).
  const row = '-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&>*]:shrink-0 [&>*]:whitespace-nowrap'
  return (
    <div className="space-y-2" role="group" aria-label={`Como comeram tu e ${other}?`}>
      <div className={row}>
        <button
          aria-pressed={half}
          onClick={() => {
            setMore(false)
            onChange(HALF_SPLIT)
          }}
          className={chip(half)}
        >
          A meias
        </button>
        <button
          aria-pressed={value == null}
          onClick={() => {
            setMore(false)
            onChange(null)
          }}
          className={chip(value == null)}
        >
          Cada um comeu isto
        </button>
        <button
          aria-expanded={more}
          onClick={() => {
            setMore(true)
            if (value == null || half) onChange(0.6)
          }}
          className={`${chip(false)} ${more ? 'border-eat! text-eat' : ''}`}
        >
          Outra divisão
        </button>
      </div>
      {more && (
        <div className={row}>
          {OTHER_SPLITS.map((split) => (
            <button
              key={split}
              aria-pressed={value != null && sameFactor(value, split)}
              onClick={() => onChange(split)}
              className={`${chip(value != null && sameFactor(value, split))} tabular-nums`}
            >
              {splitLabel(split, me, other)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
