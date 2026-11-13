import { useSheet } from '../../lib/sheet'
import { usePlanoTreino } from '../../lib/plano-treino'
import BottomSheet from '../ui/BottomSheet'
import Icon from '../ui/Icon'
import { ExerciseList, dayTone, kicker } from '../plano/PlanoViews'
import { dayLabel } from '../../../api/_lib/rules/plano-treino'

// «Ver plano» durante a sessão do Ginásio (?folha=plano&dia=2; decisão 305):
// o dia do plano com as séries e as notas do treinador, e os cuidados (a
// zona vem do plano) em cima. Sem rede também (vem do perfil guardado).
export default function PlanoSheet() {
  const sheet = useSheet()
  const plan = usePlanoTreino()
  const n = Number(sheet.params.get('dia'))
  const day = plan?.dias.find((d) => d.n === n) ?? plan?.dias[0]
  const c = plan?.cuidados
  return (
    <BottomSheet title={day ? dayLabel(day, true) : 'Plano de treino'} onClose={sheet.close}>
      {!plan || !day ? (
        <p className="py-6 text-center text-[0.9375rem] text-dim">Ainda não tens um plano de treino.</p>
      ) : (
        <div className="space-y-4 pb-2">
          <p className="text-[1.1875rem] leading-tight font-semibold">
            <span className={`${kicker} block ${dayTone(day.n).text}`}>Plano · Fase {plan.fase}</span>
            {dayLabel(day)}
            {day.subtitulo ? ` · ${day.subtitulo}` : ''}
          </p>
          {c && (
            <section className="rounded-[18px] border border-attn/50 bg-attn/8 p-3" aria-label={`Cuidados: ${c.zona}`}>
              <p className={`${kicker} flex items-center gap-2 text-attn`}>
                <Icon name="alert" size={16} /> {c.zona}
              </p>
              <p className="mt-1 text-[1rem] font-semibold">{c.titulo}</p>
              {c.evitar.length > 0 && (
                <ul className="mt-2 space-y-1 text-[0.9375rem]">
                  {c.evitar.map((t) => (
                    <li key={t} className="flex gap-2">
                      <span className="text-pain" aria-label="Evitar">
                        ✕
                      </span>
                      {t}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          <ExerciseList day={day} />
        </div>
      )}
    </BottomSheet>
  )
}
