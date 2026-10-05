import { useSheet } from '../lib/sheet'
import Icon, { type IconName } from './ui/Icon'
import ShotButton from './ui/ShotButton'

// As três formas de registar um treino: o print do relógio, o print da app
// (Strava, app do ginásio, consola…) ou dizer/escrever o que fizeste. Os dois
// prints seguem o mesmo caminho (a IA lê qualquer um).
export default function WorkoutLogOptions({ date }: { date?: string | null }) {
  const sheet = useSheet()
  const box =
    'flex min-h-24 flex-col items-center justify-center gap-1.5 rounded-2xl border border-line bg-surface px-2 text-center font-display text-[15px] leading-tight font-bold tracking-[0.04em] uppercase'
  const icon = (name: IconName) => (
    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface2 text-burn">
      <Icon name={name} size={22} />
    </span>
  )
  return (
    <section className="space-y-2" aria-label="Registar treino">
      <p className="label">Registar treino</p>
      <div className="grid grid-cols-3 gap-2">
        <ShotButton className={box}>
          {icon('watch')}
          Print do relógio
        </ShotButton>
        <ShotButton className={box}>
          {icon('phone')}
          Print da app
        </ShotButton>
        <button onClick={() => sheet.open('dizer-treino', date ? { data: date } : {})} className={box}>
          {icon('mic')}
          Dizer ou escrever
        </button>
      </div>
    </section>
  )
}
