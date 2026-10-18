import { useSheet } from '../lib/sheet'
import Icon, { type IconName } from './ui/Icon'
import ShotButton from './ui/ShotButton'

// As formas de registar um treino: um print (do relógio, do Strava, da app do
// ginásio, da consola… a IA lê qualquer um) ou dizer/escrever o que fizeste.
// Eram dois botões de print com o mesmo caminho; ficou um (decisão 152).
export default function WorkoutLogOptions({ date }: { date?: string | null }) {
  const sheet = useSheet()
  const box =
    'flex min-h-24 flex-col items-center justify-center gap-1.5 rounded-2xl border border-line bg-surface px-2 text-center font-display text-[15px] leading-tight font-bold tracking-[0.04em] uppercase'
  const icon = (name: IconName) => (
    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface2 text-burn">
      <Icon name={name} size={22} />
    </span>
  )
  const hint = 'block font-sans text-[13px] font-normal tracking-normal text-dim normal-case'
  return (
    <section className="space-y-2" aria-label="Registar treino">
      <p className="label">Registar treino</p>
      <div className="grid grid-cols-2 gap-2">
        <ShotButton className={box}>
          {icon('watch')}
          <span>
            Print
            <span className={hint}>relógio, Strava, consola…</span>
          </span>
        </ShotButton>
        <button onClick={() => sheet.open('dizer-treino', date ? { data: date } : {})} className={box}>
          {icon('mic')}
          <span>
            Dizer ou escrever
            <span className={hint}>ginásio, caminhada, aula…</span>
          </span>
        </button>
      </div>
    </section>
  )
}
