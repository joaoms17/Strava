import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { useReadyProfile } from '../../lib/profile'
import { nutritionalDay } from '../../lib/day'
import { BusyButton, Spinner, runBusy, useBusyKey } from '../../lib/busy'
import { askApp, loadTurns, runAskAction, saveTurns } from '../../lib/pergunta'
import {
  MAX_QUESTION_CHARS,
  actionLabel,
  keepTurns,
  type ActionState,
  type AskAction,
  type AskTurn,
} from '../../../api/_lib/rules/pergunta-acoes'
import BottomSheet from '../ui/BottomSheet'
import Icon from '../ui/Icon'

const BUSY_TEXT: Record<AskAction['type'], string> = {
  log_favorite: 'A registar…',
  repeat_meal: 'A registar…',
  add_shopping_items: 'A juntar…',
  mark_day: 'A guardar…',
  share_meal: 'A partilhar…',
}

// Perguntas que se fazem mais (um toque pergunta logo).
function suggestions(sex: 'm' | 'f'): string[] {
  return [
    'Quanto me falta hoje?',
    'O que janto para chegar à proteína?',
    sex === 'f' ? 'Como correu esta semana?' : 'Porque é que não desci esta semana?',
    'Estou pior ao fim de semana?',
    'Ontem foi tudo, marca o dia',
  ]
}

function ActionCard({
  action,
  state,
  today,
  onState,
}: {
  action: AskAction
  state: ActionState
  today: string
  onState: (state: ActionState) => void
}) {
  const toast = useToast()
  const [, navigate] = useLocation()
  return (
    <div className="space-y-2.5 rounded-2xl border border-line bg-bg p-3">
      <p className="text-[15px] leading-snug">{actionLabel(action, today)}</p>
      {state === 'por_fazer' ? (
        <div className="flex gap-2">
          <BusyButton
            busy={BUSY_TEXT[action.type]}
            onClick={async () => {
              if (await runAskAction(action, today, toast, navigate)) onState('feito')
            }}
            className="min-h-11 flex-1 rounded-xl bg-cta text-[16px] font-semibold text-on-cta"
          >
            Fazer
          </BusyButton>
          <button onClick={() => onState('nao')} className="min-h-11 rounded-xl bg-surface2 px-5 text-[16px]">
            Não
          </button>
        </div>
      ) : (
        <p className={`flex items-center gap-1.5 text-[14px] ${state === 'feito' ? 'text-ok' : 'text-dim'}`}>
          {state === 'feito' ? (
            <>
              <Icon name="check" size={16} /> Feito
            </>
          ) : (
            'Ficou por fazer'
          )}
        </p>
      )}
    </div>
  )
}

// Hoje e Balanço › «Pergunta à app»: perguntas sobre os teus números e
// pedidos («bebi mais 2 copos»). A resposta vem só dos teus dados; o que a
// app propõe fazer aparece num cartão e só acontece com «Fazer».
export default function PerguntaSheet() {
  const sheet = useSheet()
  const profile = useReadyProfile()
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
  const [turns, setTurns] = useState<AskTurn[]>(() => loadTurns(today))
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sendKey, sending] = useBusyKey()
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => saveTurns(turns), [turns])
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [turns.length, sending])

  async function send(question: string) {
    const q = question.trim().slice(0, MAX_QUESTION_CHARS)
    if (!q) return
    const before = turns
    const mine: AskTurn = { from: 'me', text: q }
    setError(null)
    setText('')
    setTurns([...before, mine])
    try {
      const reply = await askApp(q, before, today)
      setTurns(keepTurns([...before, mine, reply]))
    } catch (err) {
      // A pergunta volta à caixa, para tentar outra vez sem a escrever.
      setTurns(before)
      setText(q)
      setError(err instanceof Error ? err.message : 'Não consegui perguntar. Tenta outra vez.')
    }
  }

  const ask = (question: string) => void runBusy('A pensar…', () => send(question), sendKey)

  function setState(turnIndex: number, actionIndex: number, state: ActionState) {
    setTurns((current) =>
      current.map((turn, i) =>
        i !== turnIndex || !turn.actions
          ? turn
          : { ...turn, actions: turn.actions.map((a, j) => (j === actionIndex ? { ...a, state } : a)) },
      ),
    )
  }

  return (
    <BottomSheet
      title="Pergunta à app"
      onClose={sheet.close}
      footer={
        <form
          onSubmit={(e) => {
            e.preventDefault()
            ask(text)
          }}
          className="space-y-2"
        >
          {error && (
            <p role="alert" className="text-[15px] text-pain">
              {error}
            </p>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  ask(text)
                }
              }}
              rows={text.length > 60 ? 3 : 1}
              maxLength={MAX_QUESTION_CHARS}
              enterKeyHint="send"
              placeholder="Pergunta ou pede…"
              aria-label="A tua pergunta"
              className="min-h-12 flex-1 resize-none rounded-2xl border border-line bg-bg px-3 py-3 text-[17px] leading-snug placeholder:text-dim focus:border-eat focus:outline-none"
            />
            <button
              type="submit"
              disabled={!text.trim() || sending}
              aria-label="Perguntar"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-cta text-on-cta disabled:opacity-40"
            >
              {sending ? <Spinner size={20} /> : <Icon name="send" size={22} />}
            </button>
          </div>
        </form>
      }
    >
      <div className="space-y-4 pb-2" aria-live="polite">
        {turns.length === 0 ? (
          <div className="space-y-4">
            <p className="text-[15px] text-dim">
              Pergunta sobre os teus números ou pede para registar. A resposta vem só dos teus dados, e nada muda sem
              tocares em «Fazer».
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestions(profile.sex).map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="min-h-10 rounded-full border border-line px-3 py-1.5 text-left text-[15px]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="flex justify-end">
              <button
                onClick={() => {
                  setTurns([])
                  setError(null)
                }}
                className="-mr-1 px-1 py-1 text-[14px] text-dim"
              >
                Começar de novo
              </button>
            </div>
            {turns.map((turn, i) =>
              turn.from === 'me' ? (
                <p
                  key={i}
                  className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-surface2 px-3.5 py-2.5 text-[16px] leading-snug whitespace-pre-wrap"
                >
                  {turn.text}
                </p>
              ) : (
                <div key={i} className="max-w-[92%] space-y-2">
                  <p className="text-[16px] leading-relaxed whitespace-pre-wrap">{turn.text}</p>
                  {turn.actions?.map((a, j) => (
                    <ActionCard
                      key={j}
                      action={a.action}
                      state={a.state}
                      today={today}
                      onState={(state) => setState(i, j, state)}
                    />
                  ))}
                </div>
              ),
            )}
            {sending && (
              <p className="flex items-center gap-2 text-[15px] text-dim">
                <Spinner size={16} /> A pensar…
              </p>
            )}
          </>
        )}
        <div ref={end} />
      </div>
    </BottomSheet>
  )
}
