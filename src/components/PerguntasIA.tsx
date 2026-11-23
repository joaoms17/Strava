import { useState } from 'react'
import { BusyButton } from '../lib/busy'
import { pendingQuestions, type MealQuestion } from '../../api/_lib/rules/perguntas'

// As perguntas que a IA fez sobre a foto (só quando não conseguiu estimar bem
// logo). Toca numa sugestão ou escreve; «Responder» manda as respostas ao
// modelo, que volta a ler a foto com elas e faz a estimativa final.
export default function PerguntasIA({
  questions,
  onAnswer,
}: {
  questions: MealQuestion[]
  onAnswer: (answers: (string | null)[]) => Promise<unknown>
}) {
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ''))
  if (!pendingQuestions(questions).length) return null
  const set = (i: number, value: string) => setAnswers(answers.map((a, j) => (j === i ? value : a)))
  const ready = answers.some((a, i) => questions[i]!.resposta == null && a.trim())

  return (
    <section className="space-y-3 rounded-2xl border border-attn/40 bg-surface2 p-3" aria-label="Perguntas da IA">
      <p className="text-[0.9375rem] font-semibold">A IA tem dúvidas sobre esta foto</p>
      {questions.map((q, i) =>
        q.resposta != null ? null : (
          <div key={i} className="space-y-2">
            <p className="text-[0.9375rem]">{q.pergunta}</p>
            {q.sugestoes.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {q.sugestoes.map((s) => (
                  <button
                    key={s}
                    onClick={() => set(i, answers[i] === s ? '' : s)}
                    aria-pressed={answers[i] === s}
                    className={`min-h-11 rounded-full border px-3 text-[0.875rem] ${answers[i] === s ? 'border-eat bg-eat text-bg' : 'border-line'}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            <input
              value={q.sugestoes.includes(answers[i]!) ? '' : answers[i]}
              onChange={(e) => set(i, e.target.value)}
              maxLength={200}
              placeholder="Ou escreve a resposta"
              aria-label={`Resposta: ${q.pergunta}`}
              className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-[0.9375rem] placeholder:text-dim focus:border-eat focus:outline-none"
            />
          </div>
        ),
      )}
      <BusyButton
        busy="A estimar outra vez…"
        disabled={!ready}
        onClick={() => onAnswer(answers.map((a, i) => (questions[i]!.resposta == null && a.trim() ? a.trim() : null)))}
        className="min-h-12 w-full rounded-xl bg-eat font-semibold text-bg disabled:opacity-40"
      >
        Responder e estimar
      </BusyButton>
    </section>
  )
}
