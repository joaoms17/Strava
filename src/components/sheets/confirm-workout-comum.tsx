import { useEffect, useState } from 'react'
import { signedUrls } from '../../lib/photos'
import { OTHER_SPORTS, SPORT_LABEL, type OtherSport } from '../../../api/_lib/rules/targets'

// O que as três folhas do treino (ConfirmWorkoutSheet) partilham (T17).
export type Kind = 'bike' | 'strength' | OtherSport
export const KINDS: [Kind, string][] = [
  ['bike', 'Bicicleta'],
  ['strength', 'Ginásio'],
  ...OTHER_SPORTS.map((s): [Kind, string] => [s, SPORT_LABEL[s]]),
]

export const toInt = (text: string): number | null => {
  const n = Number.parseInt(text, 10)
  return Number.isFinite(n) ? n : null
}
export const str = (n: number | null | undefined) => (n == null ? '' : String(Math.round(n)))

export const SOURCE_LABEL: Record<string, string> = {
  screenshot: 'print do relógio',
  manual: 'à mão',
  strava: 'Strava',
  intervals: 'Relógio (auto)',
}

export function Thumbs({ paths }: { paths: string[] }) {
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    if (!paths.length) return
    void signedUrls(paths, 'workout-shots').then((map) =>
      setUrls(paths.map((p) => map[p]).filter((u): u is string => !!u)),
    )
  }, [paths.join('|')])
  if (!urls.length) return null
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
      {urls.map((url) => (
        <a key={url} href={url} target="_blank" rel="noreferrer" className="shrink-0">
          <img src={url} alt="Print do treino" className="h-28 w-20 rounded-xl border border-line object-cover" />
        </a>
      ))}
    </div>
  )
}
