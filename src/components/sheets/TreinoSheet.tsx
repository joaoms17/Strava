import { useSheet } from '../../lib/sheet'
import { fmtDayShort } from '../../lib/format'
import BottomSheet from '../ui/BottomSheet'
import WorkoutLogOptions from '../WorkoutLogOptions'

// Folha Treino (do ＋): as mesmas entradas do separador Treino — print, dizer
// ou escrever, à mão — e os teus treinos por baixo (T12).
export default function TreinoSheet() {
  const sheet = useSheet()
  const date = sheet.params.get('data')

  return (
    <BottomSheet title="Treino" onClose={sheet.close}>
      <div className="space-y-4 pb-2">
        {date && <p className="text-[0.9375rem] text-dim">A registar em {fmtDayShort(date)}</p>}
        <WorkoutLogOptions date={date} inSheet />
        <p className="text-[0.875rem] text-dim">
          Print: abre o treino na app do relógio ou noutra app (Strava, a app do ginásio…) e tira 1 a 4 capturas. Os
          treinos do relógio também chegam sozinhos pelo intervals.icu.
        </p>
      </div>
    </BottomSheet>
  )
}
