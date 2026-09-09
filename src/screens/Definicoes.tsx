import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { supabase } from '../lib/supabase'
import { toCsv, downloadCsv } from '../lib/csv'
import { toJpeg } from '../lib/image'
import { clearPin } from '../lib/pin'
import type { CatalogExercise, Chapter, Profile } from '../lib/types'

const PROFILE_FIELDS: { key: keyof Profile & string; label: string }[] = [
  { key: 'base_kcal', label: 'base kcal' },
  { key: 'protein_g', label: 'proteína g/dia' },
  { key: 'protein_per_meal_g', label: 'proteína g/refeição' },
  { key: 'kcal_floor_week', label: 'chão semanal kcal' },
  { key: 'expected_tdee', label: 'gasto previsto' },
  { key: 'target_weight_kg', label: 'peso alvo kg' },
  { key: 'bike_hr_avg_cap', label: 'cap FC média' },
  { key: 'bike_hr_max_cap', label: 'cap FC máx' },
  { key: 'bike_min_cadence', label: 'cadência mín' },
]

const EXPORT_TABLES = [
  'meals',
  'days',
  'weights',
  'workouts',
  'exercise_log',
  'foods',
  'health_daily',
  'api_calls',
]

export default function Definicoes() {
  const [profile, setProfile] = useState<(Profile & { id: string }) | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [timeline, setTimeline] = useState<{ label: string; when: string }[]>([])
  const [catalog, setCatalog] = useState<CatalogExercise[]>([])
  const [dirtyCatalog, setDirtyCatalog] = useState<Set<string>>(new Set())
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [credits, setCredits] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [{ data: profileRow }, { data: catalogRows }, { data: chapterRows }] = await Promise.all([
      supabase.from('profile').select('*').single(),
      supabase.from('exercise_catalog').select('*').order('knee_safe', { ascending: false }).order('name'),
      supabase.from('chapters').select('*').order('order_index'),
    ])
    if (profileRow) {
      setProfile(profileRow as Profile & { id: string })
      const initial: Record<string, string> = {}
      for (const field of PROFILE_FIELDS) {
        initial[field.key] = String((profileRow as Record<string, unknown>)[field.key] ?? '')
      }
      setFields(initial)
      setTimeline((profileRow.timeline ?? []) as { label: string; when: string }[])
    }
    setCatalog((catalogRows ?? []) as CatalogExercise[])
    const chapterList = (chapterRows ?? []) as Chapter[]
    setChapters(chapterList)
    setCredits(Object.fromEntries(chapterList.map((c) => [c.id, c.photo_credit ?? ''])))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function flash(text: string) {
    setMessage(text)
    setTimeout(() => setMessage(null), 3000)
  }

  async function saveProfile() {
    if (!profile) return
    setBusy(true)
    const patch: Record<string, number> = {}
    for (const field of PROFILE_FIELDS) {
      const value = Number(String(fields[field.key]).replace(',', '.'))
      if (Number.isFinite(value) && value > 0) patch[field.key] = value
    }
    const { error } = await supabase.from('profile').update(patch).eq('id', profile.id)
    setBusy(false)
    flash(error ? 'Erro a guardar o perfil.' : 'Perfil guardado.')
  }

  async function saveTimeline() {
    if (!profile) return
    setBusy(true)
    const cleaned = timeline.filter((t) => t.label.trim() && t.when.trim())
    const { error } = await supabase
      .from('profile')
      .update({ timeline: cleaned })
      .eq('id', profile.id)
    setBusy(false)
    flash(error ? 'Erro a guardar a linha do tempo.' : 'Linha do tempo guardada.')
  }

  function updateExercise(id: string, patch: Partial<CatalogExercise>) {
    setCatalog((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
    setDirtyCatalog((prev) => new Set(prev).add(id))
  }

  async function saveCatalog() {
    setBusy(true)
    let failed = false
    for (const exercise of catalog.filter((e) => dirtyCatalog.has(e.id))) {
      const { error } = await supabase
        .from('exercise_catalog')
        .update({
          knee_safe: exercise.knee_safe,
          rep_min: exercise.rep_min,
          rep_max: exercise.rep_max,
        })
        .eq('id', exercise.id)
      if (error) failed = true
    }
    setDirtyCatalog(new Set())
    setBusy(false)
    flash(failed ? 'Erro a guardar o catálogo.' : 'Catálogo guardado.')
  }

  async function uploadChapterPhoto(chapter: Chapter, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const blob = await toJpeg(file, 1600, 0.85)
      const path = `cap-${chapter.order_index}.jpg`
      const { error: uploadError } = await supabase.storage
        .from('chapter-photos')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
      if (uploadError) throw uploadError
      const { error } = await supabase
        .from('chapters')
        .update({ photo_path: path, photo_credit: credits[chapter.id]?.trim() || null })
        .eq('id', chapter.id)
      if (error) throw error
      await load()
      flash('Foto guardada — não te esqueças do crédito CC.')
    } catch {
      flash('Erro no upload da foto.')
    } finally {
      setBusy(false)
    }
  }

  async function saveCredit(chapter: Chapter) {
    const { error } = await supabase
      .from('chapters')
      .update({ photo_credit: credits[chapter.id]?.trim() || null })
      .eq('id', chapter.id)
    flash(error ? 'Erro a guardar o crédito.' : 'Crédito guardado.')
  }

  async function exportTable(table: string) {
    setBusy(true)
    const { data, error } = await supabase.from(table).select('*').limit(10_000)
    setBusy(false)
    if (error || !data) {
      flash(`Erro a exportar ${table}.`)
      return
    }
    downloadCsv(`${table}.csv`, toCsv(data as Record<string, unknown>[]))
  }

  const input =
    'w-full rounded-lg border border-edge bg-bg px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none'

  if (!profile) return <p className="pt-8 text-center text-sm text-dim">A carregar…</p>

  return (
    <div className="mx-auto max-w-md space-y-6 pt-2">
      {message && (
        <p className="rounded-xl border border-accent/40 bg-card px-4 py-2 text-center text-sm">
          {message}
        </p>
      )}

      <section className="space-y-3 rounded-2xl border border-edge bg-card p-4">
        <h2 className="text-sm font-semibold text-dim">Perfil</h2>
        <div className="grid grid-cols-2 gap-2">
          {PROFILE_FIELDS.map((field) => (
            <label key={field.key} className="space-y-0.5 text-xs text-dim">
              <span className="block">{field.label}</span>
              <input
                inputMode="decimal"
                value={fields[field.key] ?? ''}
                onChange={(e) => setFields((prev) => ({ ...prev, [field.key]: e.target.value }))}
                className={input}
              />
            </label>
          ))}
        </div>
        <button
          disabled={busy}
          onClick={() => void saveProfile()}
          className="w-full rounded-xl bg-accent py-2.5 text-sm font-semibold text-bg disabled:opacity-50"
        >
          Guardar perfil
        </button>
      </section>

      <section className="space-y-3 rounded-2xl border border-edge bg-card p-4">
        <h2 className="text-sm font-semibold text-dim">Linha do tempo</h2>
        {timeline.map((entry, i) => (
          <div key={i} className="flex gap-2">
            <input
              placeholder="quando"
              value={entry.when}
              onChange={(e) =>
                setTimeline((prev) => prev.map((t, j) => (j === i ? { ...t, when: e.target.value } : t)))
              }
              className={`${input} w-28 shrink-0`}
            />
            <input
              placeholder="o que aconteceu"
              value={entry.label}
              onChange={(e) =>
                setTimeline((prev) => prev.map((t, j) => (j === i ? { ...t, label: e.target.value } : t)))
              }
              className={input}
            />
            <button
              className="shrink-0 px-1 text-dim"
              onClick={() => setTimeline((prev) => prev.filter((_, j) => j !== i))}
              aria-label="Remover"
            >
              ✕
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <button
            onClick={() => setTimeline((prev) => [...prev, { label: '', when: '' }])}
            className="rounded-xl border border-edge px-3 py-2 text-sm text-dim"
          >
            + marco
          </button>
          <button
            disabled={busy}
            onClick={() => void saveTimeline()}
            className="flex-1 rounded-xl bg-accent py-2 text-sm font-semibold text-bg disabled:opacity-50"
          >
            Guardar linha do tempo
          </button>
        </div>
      </section>

      <section className="space-y-2 rounded-2xl border border-edge bg-card p-4">
        <h2 className="text-sm font-semibold text-dim">Catálogo de exercícios</h2>
        <p className="text-xs text-dim">
          knee_safe define o que o Claude pode usar nos planos. Valida com fisio quando puderes.
        </p>
        {catalog.map((exercise) => (
          <div key={exercise.id} className="flex items-center gap-2 border-t border-edge py-2 first:border-t-0">
            <input
              type="checkbox"
              checked={exercise.knee_safe}
              onChange={(e) => updateExercise(exercise.id, { knee_safe: e.target.checked })}
              className="h-4 w-4 shrink-0 accent-amber-500"
            />
            <span className={`min-w-0 flex-1 truncate text-sm ${exercise.knee_safe ? '' : 'text-dim line-through'}`}>
              {exercise.name}
            </span>
            <input
              inputMode="numeric"
              value={exercise.rep_min ?? ''}
              onChange={(e) =>
                updateExercise(exercise.id, { rep_min: e.target.value ? Number(e.target.value) : null })
              }
              className={`${input} w-12 shrink-0 text-center`}
            />
            <span className="text-xs text-dim">–</span>
            <input
              inputMode="numeric"
              value={exercise.rep_max ?? ''}
              onChange={(e) =>
                updateExercise(exercise.id, { rep_max: e.target.value ? Number(e.target.value) : null })
              }
              className={`${input} w-12 shrink-0 text-center`}
            />
          </div>
        ))}
        <button
          disabled={busy || dirtyCatalog.size === 0}
          onClick={() => void saveCatalog()}
          className="w-full rounded-xl bg-accent py-2.5 text-sm font-semibold text-bg disabled:opacity-50"
        >
          Guardar catálogo ({dirtyCatalog.size})
        </button>
      </section>

      <section className="space-y-3 rounded-2xl border border-edge bg-card p-4">
        <h2 className="text-sm font-semibold text-dim">Fotos dos capítulos (CC, com crédito)</h2>
        {chapters.map((chapter) => (
          <div key={chapter.id} className="space-y-1.5 border-t border-edge py-2 first:border-t-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm">
                {chapter.order_index}. {chapter.patron}
                {chapter.photo_path && <span className="ml-2 text-xs text-ok">foto ✓</span>}
              </p>
              <label className="shrink-0 cursor-pointer rounded-lg border border-edge px-2.5 py-1.5 text-xs text-accent">
                {chapter.photo_path ? 'Trocar' : 'Carregar'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void uploadChapterPhoto(chapter, e)}
                />
              </label>
            </div>
            <div className="flex gap-2">
              <input
                placeholder="crédito (autor, licença CC, fonte)"
                value={credits[chapter.id] ?? ''}
                onChange={(e) => setCredits((prev) => ({ ...prev, [chapter.id]: e.target.value }))}
                className={input}
              />
              <button
                onClick={() => void saveCredit(chapter)}
                className="shrink-0 rounded-lg border border-edge px-2.5 text-xs text-dim"
              >
                OK
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-2 rounded-2xl border border-edge bg-card p-4">
        <h2 className="text-sm font-semibold text-dim">Export CSV</h2>
        <div className="grid grid-cols-2 gap-2">
          {EXPORT_TABLES.map((table) => (
            <button
              key={table}
              disabled={busy}
              onClick={() => void exportTable(table)}
              className="rounded-xl border border-edge py-2 text-sm text-ink disabled:opacity-50"
            >
              {table}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2 rounded-2xl border border-edge bg-card p-4">
        <h2 className="text-sm font-semibold text-dim">Calendário e sessão</h2>
        <p className="break-all text-xs text-dim">
          Feed .ics para o Google Calendar: {window.location.origin}/api/calendar?token=ICS_TOKEN (o
          token que definiste no Vercel).
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => {
              clearPin()
              window.location.reload()
            }}
            className="flex-1 rounded-xl border border-edge py-2.5 text-sm text-dim"
          >
            Trocar PIN
          </button>
          <button
            onClick={() => void supabase.auth.signOut()}
            className="flex-1 rounded-xl border border-warn/40 py-2.5 text-sm text-warn"
          >
            Sair
          </button>
        </div>
      </section>
    </div>
  )
}
