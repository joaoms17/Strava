import { useState } from 'react'
import BottomSheet from '../ui/BottomSheet'
import Icon from '../ui/Icon'
import { postApi } from '../../lib/api'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { emitDataChanged } from '../../lib/events'
import { prepareMenuPhoto } from '../../lib/image'
import { fmt1, fmtInt, fmtKcal } from '../../lib/format'
import { dishItem, type Dish, type RankedDish } from '../../../api/_lib/rules/menu'
import type { Meal } from '../../lib/types'

const MAX_PHOTOS = 3

interface MenuResult {
  kcal_left: number
  protein_left: number | null
  ranked: RankedDish[]
  others: Dish[]
  prompt_version: string
  model: string
}

const euros = (n: number) => `${n.toFixed(2).replace('.', ',')} €`

// ＋ › «Escolher pelo menu»: fotografas o menu (até 3 fotos) e a app diz os 3
// pratos que melhor cabem no que te falta hoje — primeiro os que cabem, pela
// proteína por caloria — com as calorias e a proteína de cada um. «Vou comer
// este» regista-o agora (estimativa). Os outros pratos ficam por baixo.
export default function MenuSheet() {
  const sheet = useSheet()
  const toast = useToast()
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([])
  const [note, setNote] = useState('')
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<MenuResult | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  function addPhotos(files: File[]) {
    const room = MAX_PHOTOS - photos.length
    if (room <= 0) return
    setPhotos([...photos, ...files.slice(0, room).map((file) => ({ file, url: URL.createObjectURL(file) }))])
    setError(null)
  }

  function removePhoto(i: number) {
    URL.revokeObjectURL(photos[i]!.url)
    setPhotos(photos.filter((_, j) => j !== i))
  }

  async function read() {
    if (photos.length === 0 || reading) return
    setReading(true)
    setError(null)
    try {
      const encoded = []
      for (const p of photos) encoded.push(await prepareMenuPhoto(p.file))
      const data = await postApi<MenuResult>('/api/meal/menu', {
        photos: encoded,
        ...(note.trim() ? { note: note.trim() } : {}),
      })
      setResult(data)
      setShowAll(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não consegui ler o menu. Tenta outra vez.')
    } finally {
      setReading(false)
    }
  }

  async function eat(dish: Dish) {
    if (!result || busy) return
    setBusy(dish.name)
    try {
      const { meal } = await postApi<{ meal: Meal }>('/api/meal/save', {
        input_type: 'text',
        raw_text: `Do menu: ${dish.name}`,
        items: [dishItem(dish)],
        is_estimate: true,
        prompt_version: result.prompt_version,
        model: result.model,
      })
      emitDataChanged()
      sheet.close()
      toast(`Registado · ${dish.name} · ${fmtKcal(dish.kcal)} kcal`, [
        {
          label: 'Anular',
          run: async () => {
            await postApi('/api/meal/delete', { meal_id: meal.id })
            emitDataChanged()
          },
        },
      ])
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui registar.')
      setBusy(null)
    }
  }

  function restart() {
    for (const p of photos) URL.revokeObjectURL(p.url)
    setPhotos([])
    setResult(null)
    setError(null)
  }

  const primary =
    'flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-eat font-display text-[18px] font-bold tracking-[0.04em] text-bg uppercase disabled:opacity-40'
  const top = result?.ranked.slice(0, 3) ?? []
  const rest = result ? [...result.ranked.slice(3), ...result.others] : []

  return (
    <BottomSheet
      title="Escolher pelo menu"
      onClose={sheet.close}
      footer={
        result ? undefined : (
          <button disabled={photos.length === 0 || reading} onClick={() => void read()} className={primary}>
            {reading ? 'A ler o menu…' : 'Escolher por mim'}
          </button>
        )
      }
    >
      {!result ? (
        <div className="space-y-4 pb-2">
          <p className="text-[15px] text-dim">
            Tira foto ao menu (até {MAX_PHOTOS} páginas). Digo-te os 3 pratos que melhor cabem no que te falta hoje, pelas
            calorias e pela proteína.
          </p>
          {photos.length > 0 && (
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
              {photos.map((p, i) => (
                <div key={p.url} className="relative h-28 w-28 shrink-0 overflow-hidden rounded-2xl">
                  <img src={p.url} alt="" className="h-full w-full object-cover" />
                  {!reading && (
                    <button
                      onClick={() => removePhoto(i)}
                      aria-label={`Tirar a foto ${i + 1}`}
                      className="absolute top-1 right-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white"
                    >
                      <Icon name="close" size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {photos.length < MAX_PHOTOS && !reading && (
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: photos.length ? 'Outra foto' : 'Fotografar', icon: 'camera' as const, camera: true },
                { label: 'Galeria', icon: 'gallery' as const, camera: false },
              ].map((b) => (
                <label
                  key={b.label}
                  className={`flex min-h-[64px] cursor-pointer items-center justify-center gap-2 rounded-2xl font-display text-[17px] font-bold tracking-[0.06em] uppercase ${
                    b.camera && photos.length === 0 ? 'bg-eat text-bg' : 'border border-line bg-surface2'
                  }`}
                >
                  <Icon name={b.icon} size={24} />
                  {b.label}
                  <input
                    type="file"
                    accept="image/*"
                    {...(b.camera ? { capture: 'environment' as const } : { multiple: true })}
                    aria-label={b.camera ? 'Fotografar o menu' : 'Fotos do menu da galeria'}
                    className="hidden"
                    onChange={(e) => {
                      const files = [...(e.target.files ?? [])]
                      e.target.value = ''
                      if (files.length) addPhotos(files)
                    }}
                  />
                </label>
              ))}
            </div>
          )}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={reading}
            placeholder="Preferências (opcional). Ex.: peixe, sem fritos"
            aria-label="Preferências"
            className="h-12 w-full rounded-2xl border border-line bg-bg px-4 text-[16px] placeholder:text-dim focus:border-eat focus:outline-none"
          />
          {reading && <p className="text-center text-[15px] text-dim">A ler os pratos e a fazer as contas (até 30 s)…</p>}
          {error && <p className="text-[15px] text-pain">{error}</p>}
        </div>
      ) : (
        <div className="space-y-4 pb-2">
          <p className="text-[16px]">
            {result.kcal_left > 0 ? (
              <>
                Faltam-te hoje <span className="font-semibold text-eat tabular-nums">{fmtKcal(result.kcal_left)} kcal</span>
                {result.protein_left != null && result.protein_left > 0 && (
                  <>
                    {' '}
                    e <span className="font-semibold text-protein tabular-nums">{fmtInt(result.protein_left)} g de proteína</span>
                  </>
                )}
                .
              </>
            ) : (
              <>
                Já passaste o plano de hoje
                {result.kcal_left < 0 && <> em {fmtKcal(-result.kcal_left)} kcal</>}: primeiro os mais leves.
              </>
            )}
          </p>

          <ol className="space-y-3" aria-label="Os 3 melhores">
            {top.map((d, i) => (
              <li key={d.name} className={`rounded-[18px] border bg-surface p-4 ${i === 0 ? 'border-2 border-eat' : 'border-line'}`}>
                <div className="flex items-start gap-3">
                  <span className="num w-6 shrink-0 text-[26px] leading-none text-dim">{i + 1}</span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-[17px] leading-snug font-semibold">
                      {d.name}
                      {d.price != null && <span className="font-normal text-dim"> · {euros(d.price)}</span>}
                    </p>
                    {d.description && <p className="text-[14px] text-dim">{d.description}</p>}
                    <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 pt-1">
                      <span className="num text-[24px] leading-none">
                        {fmtKcal(d.kcal)} <span className="text-[14px] text-dim">kcal</span>
                      </span>
                      <span className="num text-[24px] leading-none text-protein">
                        {fmtInt(d.protein)} <span className="text-[14px] text-dim">g proteína</span>
                      </span>
                    </p>
                    <p className="text-[14px] text-dim">
                      {fmt1(d.proteinPer100)} g de proteína por 100 kcal
                      {d.kcalAfter != null &&
                        (d.fits ? (
                          <> · ficam {fmtKcal(d.kcalAfter)} kcal</>
                        ) : (
                          <span className="text-attn"> · passa {fmtKcal(-d.kcalAfter)} kcal</span>
                        ))}
                    </p>
                  </div>
                </div>
                <button
                  disabled={busy != null}
                  onClick={() => void eat(d)}
                  className={`mt-3 min-h-12 w-full rounded-xl font-display text-[16px] font-bold tracking-[0.04em] uppercase disabled:opacity-40 ${
                    i === 0 ? 'bg-eat text-bg' : 'border border-line bg-surface2'
                  }`}
                >
                  {busy === d.name ? 'A registar…' : 'Vou comer este'}
                </button>
              </li>
            ))}
          </ol>

          {rest.length > 0 && (
            <div className="space-y-2">
              <button onClick={() => setShowAll(!showAll)} className="min-h-11 w-full text-[15px] text-eat">
                {showAll ? 'Esconder os outros' : `Ver os outros ${rest.length} do menu`}
              </button>
              {showAll && (
                <ul className="divide-y divide-line rounded-2xl border border-line" aria-label="Outros pratos">
                  {rest.map((d) => (
                    <li key={d.name}>
                      <button
                        disabled={busy != null}
                        onClick={() => void eat(d)}
                        aria-label={`Vou comer ${d.name}`}
                        className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left disabled:opacity-40"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px]">{d.name}</span>
                          {d.price != null && <span className="block text-[13px] text-dim">{euros(d.price)}</span>}
                        </span>
                        <span className="shrink-0 text-right text-[14px] tabular-nums">
                          {fmtKcal(d.kcal)} kcal
                          <span className="block text-protein">{fmtInt(d.protein)} g</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <p className="text-[13px] text-dim">Estimativas para a dose habitual de restaurante. Ao registar, podes corrigir depois.</p>
          <button onClick={restart} className="min-h-11 w-full text-[15px] text-dim">
            Outro menu
          </button>
        </div>
      )}
    </BottomSheet>
  )
}
