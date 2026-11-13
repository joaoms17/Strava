import { useSheet } from '../../lib/sheet'
import MergedDetail from './ConfirmWorkoutMerged'
import ImportConfirm from './ConfirmWorkoutImport'
import WorkoutDetail from './ConfirmWorkoutDetail'

// Folha Confirmar treino: rever o que a IA leu dos prints, juntá-lo a uma
// sessão já registada ou guardar uma nova. Com ?id=, é o detalhe editável de
// um treino guardado.
export default function ConfirmWorkoutSheet() {
  const sheet = useSheet()
  const workoutId = sheet.params.get('id')
  const importId = sheet.params.get('import')
  // Um treino que o relógio partiu em dois: os totais e as partes.
  const parts = (sheet.params.get('partes') ?? '').split(',').filter(Boolean)
  if (parts.length > 1) return <MergedDetail key={parts.join(',')} ids={parts} />
  if (workoutId) return <WorkoutDetail key={workoutId} id={workoutId} />
  if (importId) return <ImportConfirm key={importId} id={importId} target={sheet.params.get('para')} />
  return null
}
