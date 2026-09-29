import { postApi } from './api'

// Um registo num dia passado (pesagem, refeição que mudou de dia) atualiza
// os dias seguintes no servidor, em blocos de 30, sem esperar pela cron.
export function recomputeFrom(date: string, today: string): void {
  if (date >= today) return
  void (async () => {
    let from: string | null = date
    for (let i = 0; i < 15 && from; i++) {
      try {
        const result: { next: string | null } = await postApi('/api/day/recompute', { from })
        from = result.next
      } catch {
        return // a cron da noite acaba o trabalho
      }
    }
  })()
}
