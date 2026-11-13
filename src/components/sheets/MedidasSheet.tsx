import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { supabase } from '../../lib/supabase'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { BusyButton } from '../../lib/busy'
import { emitDataChanged } from '../../lib/events'
import { useReadyProfile } from '../../lib/profile'
import { localCalendarDate, shiftDate } from '../../lib/day'
import { oddMeasurement } from '../../lib/medidas-check'
import { checkWeighing } from '../../../api/_lib/rules/weight'
import { fmt1, fmtDayMonth, parseDecimal } from '../../lib/format'
import { isMaintenanceWeek } from '../../../api/_lib/rules/manutencao'
import {
  FLAG_TEXT,
  ZONE_COLUMN,
  ZONE_LABEL,
  averageReadings,
  changeSentence,
  checkNeck,
  checkZone,
  compareCompositions,
  composition,
  confirmationSentence,
  explainMeasurement,
  measureFlags,
  measuredWaistSite,
  needsThirdReading,
  neckChoice,
  neckQuestion,
  neckUses,
  referenceWeight,
  targetBodyFatPct,
  targetWaist,
  usualNeckLabel,
  waistSiteFor,
  type MeasureFlag,
  type NeckChoice,
  type WaistSite,
  type Zone,
} from '../../../api/_lib/rules/composicao'
import type { BodyMeasurement } from '../../lib/types'
import BottomSheet from '../ui/BottomSheet'
import Icon from '../ui/Icon'
import ExplicacaoGordura from '../corpo/ExplicacaoGordura'

const ALL_ZONES: Zone[] = ['neck', 'waist', 'hips', 'chest', 'arm', 'thigh', 'calf']
// Nas mulheres a anca entra na fórmula: passa a essencial.
const essentialZones = (sex: string | null): Zone[] => (sex === 'f' ? ['neck', 'waist', 'hips'] : ['neck', 'waist'])

type Readings = Record<Zone, string[]>

const emptyReadings = (): Readings =>
  Object.fromEntries(ALL_ZONES.map((z) => [z, ['', '', '']])) as Readings

const fmtCm = (n: number) => (Number.isInteger(Math.round(n * 10) / 10) ? String(Math.round(n)) : fmt1(n))

function parse(text: string): number | null {
  if (!text.trim()) return null
  const n = parseDecimal(text)
  return Number.isFinite(n) && n > 0 ? n : null
}

// Folha Medidas: pescoço e cintura (1 minuto), opcionais recolhidos e, no
// fim, a gordura e a massa magra logo ali.
export default function MedidasSheet() {
  const sheet = useSheet()
  const toast = useToast()
  const profile = useReadyProfile()
  const ESSENTIAL = essentialZones(profile.sex)
  const OPTIONAL = ALL_ZONES.filter((z) => !ESSENTIAL.includes(z))
  const [, navigate] = useLocation()
  const editId = sheet.params.get('id')
  const today = localCalendarDate()
  const [date, setDate] = useState(sheet.params.get('data') ?? today)
  const [loaded, setLoaded] = useState(false)
  const [existing, setExisting] = useState<BodyMeasurement | null>(null)
  // As anteriores (da mais recente para a mais antiga): o pescoço habitual
  // é a mediana das 3 últimas, e a anterior conta com o pescoço que contou.
  const [previousRows, setPreviousRows] = useState<BodyMeasurement[]>([])
  const previous = previousRows[0] ?? null
  // «O pescoço mudou 2 cm…»: a pergunta antes de guardar (decisão 303).
  const [neckAsk, setNeckAsk] = useState(false)
  const [weights, setWeights] = useState<{ date: string; kg: number }[]>([])
  const [dinnerOut, setDinnerOut] = useState(false)
  const [readings, setReadings] = useState<Readings>(emptyReadings)
  const [twice, setTwice] = useState(false)
  const [showOptional, setShowOptional] = useState(false)
  const [weightText, setWeightText] = useState('')
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [saved, setSaved] = useState<BodyMeasurement | null>(null)
  // B6: os avisos que pedem um toque antes de gravar.
  const [odd, setOdd] = useState<string[] | null>(null)
  // A última pesagem conhecida (para apanhar 824 em vez de 82,4 no «Peso de hoje»).
  const [lastKg, setLastKg] = useState<number | null>(null)

  useEffect(() => {
    void (async () => {
      setLoaded(false)
      let day = date
      let editing: BodyMeasurement | null = null
      if (editId) {
        const { data } = await supabase.from('body_measurements').select('*').eq('id', editId).maybeSingle()
        editing = (data ?? null) as BodyMeasurement | null
        if (editing) {
          day = editing.date
          setDate(editing.date)
          const r = emptyReadings()
          for (const zone of ALL_ZONES) {
            const raw = editing.readings?.[zone]
            const list = Array.isArray(raw) ? raw : null
            const value = editing[ZONE_COLUMN[zone]] as number | null
            // Com vírgula, como no resto da app («40,7»; o parseDecimal aceita as duas).
            const shown = (v: unknown) => String(v).replace('.', ',')
            r[zone] = list?.length ? [...list.map(shown), '', ''].slice(0, 3) : [value != null ? shown(value) : '', '', '']
            if ((list?.length ?? 0) > 1) setTwice(true)
            if (OPTIONAL.includes(zone) && value != null) setShowOptional(true)
          }
          setReadings(r)
        }
      }
      const [{ data: same }, { data: before }, { data: w }, { data: yMeals }, { data: last }] = await Promise.all([
        supabase.from('body_measurements').select('*').eq('date', day).maybeSingle(),
        supabase
          .from('body_measurements')
          .select('*')
          .lt('date', day)
          .order('date', { ascending: false })
          .limit(6),
        supabase.from('weights').select('date,kg').gte('date', shiftDate(day, -6)).lte('date', day),
        supabase.from('meals').select('tags').eq('date', shiftDate(day, -1)).is('deleted_at', null),
        supabase.from('weights').select('kg').lte('date', day).order('date', { ascending: false }).limit(1),
      ])
      setLastKg(last?.[0]?.kg != null ? Number(last[0].kg) : null)
      setExisting(editing ?? ((same ?? null) as BodyMeasurement | null))
      setPreviousRows((before ?? []) as BodyMeasurement[])
      setWeights(((w ?? []) as { date: string; kg: number }[]).map((x) => ({ date: x.date, kg: Number(x.kg) })))
      setDinnerOut((yMeals ?? []).some((m) => ((m.tags as string[] | null) ?? []).includes('jantar_fora')))
      setLoaded(true)
    })()
    // Ideia 15: numa medição nova, Hoje/Ontem relê o dia escolhido.
  }, [editId, editId ? null : date])

  const height = Number(profile.height_cm ?? 183)
  const reference = existing && editId ? Number(existing.weight_used_kg) : referenceWeight(weights, date)
  const weightUsed = reference ?? parse(weightText)
  const value = (zone: Zone) => averageReadings(readings[zone].map((t) => parse(t) ?? NaN))
  const neck = value('neck')
  const waist = value('waist')
  const hips = value('hips')
  const needsHips = profile.sex === 'f'
  // Onde se mede a cintura: ao corrigir, onde foi essa medição; numa nova, o
  // sítio da fórmula (umbigo nos homens, parte mais estreita nas mulheres).
  const site: WaistSite = editId && existing ? measuredWaistSite(existing.readings) : waistSiteFor(profile.sex)
  const sameSiteBefore = previous != null && measuredWaistSite(previous.readings) === site
  const liveComposition =
    neck != null && waist != null && weightUsed != null
      ? composition(height, { neck_cm: neck, waist_cm: waist, hips_cm: hips, weight_used_kg: weightUsed }, profile.sex)
      : null
  const canSave = neck != null && waist != null && weightUsed != null && (!needsHips || hips != null)
  // O pescoço contra o habitual (as anteriores, da mais antiga para a mais recente).
  const neckCheck =
    neck != null
      ? checkNeck({
          neck,
          previousNecks: [...previousRows].reverse().filter((r) => r.neck_cm != null).map((r) => Number(r.neck_cm)),
          weightKg: weightUsed,
          previousWeightKg: previous ? Number(previous.weight_used_kg) : null,
        })
      : null
  // Ao corrigir, a escolha que já havia fica enquanto o pescoço for o mesmo.
  const keptChoice: NeckChoice | null =
    editId && existing && neck != null && existing.neck_cm != null && Number(existing.neck_cm) === neck ? neckChoice(existing.readings) : null

  function setReading(zone: Zone, index: number, text: string) {
    const next = { ...readings, [zone]: readings[zone].map((t, i) => (i === index ? text.replace(/[^\d,.]/g, '') : t)) }
    setReadings(next)
  }

  const typedKg = reference == null ? parse(weightText) : null
  const typedCheck = typedKg != null ? checkWeighing(typedKg, lastKg) : null

  async function save(replace = false, choice: NeckChoice | null = keptChoice, checked = false) {
    if (!canSave || neck == null || waist == null || weightUsed == null) return
    // B6: fora dos limites, cintura ≤ pescoço, %G fora de 5–45 ou um peso
    // muito longe da última pesagem: um toque de confirmação, como a pesagem.
    if (!checked) {
      const warnings = oddMeasurement({
        zones: Object.fromEntries(ALL_ZONES.map((z) => [z, value(z)])),
        pct: liveComposition?.pct ?? null,
        typedKg,
        lastKg,
      })
      if (warnings.length) {
        setOdd(warnings)
        return
      }
    }
    setOdd(null)
    if (existing && !editId && !replace) {
      setConfirmReplace(true)
      return
    }
    if (neckCheck?.outlier && choice == null) {
      setConfirmReplace(false)
      setNeckAsk(true)
      return
    }
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      toast('Sessão expirada. Volta a entrar.')
      return
    }
    // Sem pesagem nos 7 dias: o peso escrito também fica como pesagem desse dia.
    if (reference == null) {
      await supabase
        .from('weights')
        .upsert({ user_id: user.id, date, kg: weightUsed, source: 'manual' }, { onConflict: 'user_id,date' })
    }
    const maintenance =
      profile.maintenance_enabled !== false && profile.maintenance_anchor != null
        ? isMaintenanceWeek(profile.maintenance_anchor, date)
        : false
    const pct = liveComposition?.pct ?? null
    const flags: MeasureFlag[] = measureFlags({
      pct,
      neck,
      waist,
      previous: previous
        ? { date: previous.date, neck_cm: previous.neck_cm, waist_cm: sameSiteBefore ? previous.waist_cm : null }
        : null,
      date,
      maintenance,
      dinnerOutYesterday: dinnerOut,
      neckOutlier: neckCheck?.outlier === true,
    })
    const row: Record<string, unknown> = {
      user_id: user.id,
      date,
      method: 'tape',
      measured_at: new Date().toISOString(),
      weight_used_kg: weightUsed,
      flags,
      readings: {
        ...Object.fromEntries(
          ALL_ZONES
            .map((z) => [z, readings[z].map(parse).filter((n): n is number => n != null)] as const)
            .filter(([, list]) => list.length > 0),
        ),
        waist_site: site,
        // «Está certo» (true) ou «Usar o pescoço habitual» (false); sem pergunta, nada.
        ...(neckCheck?.outlier && choice != null ? { neck_confirmed: choice === 'confirmado' } : {}),
      },
    }
    for (const zone of ALL_ZONES) row[ZONE_COLUMN[zone]] = value(zone)
    // B6: substituir a medição do dia não apaga as zonas opcionais que ficaram em branco.
    if (existing && !editId) {
      const kept = (existing.readings ?? {}) as Record<string, unknown>
      const readingsRow = row.readings as Record<string, unknown>
      for (const zone of OPTIONAL) {
        if (value(zone) != null) continue
        const old = existing[ZONE_COLUMN[zone]] as number | null
        if (old == null) continue
        row[ZONE_COLUMN[zone]] = old
        if (kept[zone] != null) readingsRow[zone] = kept[zone]
      }
    }
    const { data, error } = await supabase
      .from('body_measurements')
      .upsert(row, { onConflict: 'user_id,date,method' })
      .select()
      .single()
    setConfirmReplace(false)
    setNeckAsk(false)
    if (error) {
      toast('Não consegui gravar a medição. Tenta outra vez.')
      return
    }
    emitDataChanged()
    setSaved(data as BodyMeasurement)
  }

  async function remove() {
    if (!existing) return
    const backup = existing
    const { error } = await supabase.from('body_measurements').delete().eq('id', existing.id)
    if (error) {
      toast('Não consegui apagar.')
      return
    }
    emitDataChanged()
    sheet.close()
    toast('Medição apagada', [
      {
        label: 'Anular',
        run: async () => {
          const { id: _id, ...rest } = backup
          await supabase.from('body_measurements').insert(rest)
          emitDataChanged()
        },
      },
    ])
  }

  if (!loaded) {
    return (
      <BottomSheet onClose={sheet.close}>
        <p className="py-8 text-center text-[0.9375rem] text-dim">A carregar…</p>
      </BottomSheet>
    )
  }

  if (saved) {
    // A anterior e esta com o pescoço que conta (o habitual, se fugiu e não foi aceite).
    const history = [...previousRows].reverse().filter((r) => r.date < saved.date)
    const all = [...history, saved]
    const uses = neckUses(all)
    const neckOf = (i: number, r: BodyMeasurement) => uses[i]?.used ?? (r.neck_cm != null ? Number(r.neck_cm) : null)
    const savedNeck = neckOf(all.length - 1, saved)
    const usualUsed = uses[all.length - 1]?.useUsual ? savedNeck : null
    const c =
      savedNeck != null && saved.waist_cm != null
        ? composition(
            height,
            {
              neck_cm: savedNeck,
              waist_cm: Number(saved.waist_cm),
              hips_cm: saved.hips_cm != null ? Number(saved.hips_cm) : null,
              weight_used_kg: Number(saved.weight_used_kg),
            },
            profile.sex,
          )
        : null
    const prevNeck = previous && history.length ? neckOf(history.length - 1, history[history.length - 1]!) : null
    const before =
      sameSiteBefore && previous && prevNeck != null && previous.waist_cm != null && previous.date < saved.date
        ? composition(
            height,
            {
              neck_cm: prevNeck,
              waist_cm: Number(previous.waist_cm),
              hips_cm: previous.hips_cm != null ? Number(previous.hips_cm) : null,
              weight_used_kg: Number(previous.weight_used_kg),
            },
            profile.sex,
          )
        : null
    const change = c && before ? compareCompositions(before, c) : null
    const why = explainMeasurement(all, all.length - 1, height, profile.sex)
    const savedTarget =
      savedNeck != null && site === waistSiteFor(profile.sex)
        ? targetWaist(
            height,
            savedNeck,
            targetBodyFatPct(profile.sex),
            profile.sex,
            saved.hips_cm != null ? Number(saved.hips_cm) : null,
          )
        : null
    return (
      <BottomSheet
        title="Medição guardada"
        onClose={sheet.close}
        footer={
          <button
            // T5: navegar a substituir a entrada da folha; um sheet.close()
            // (history.back() assíncrono) antes desfazia a navegação.
            onClick={() => navigate('/corpo', { replace: true })}
            className="min-h-14 w-full rounded-2xl bg-cta font-display text-[1.1875rem] font-bold tracking-[0.06em] text-on-cta uppercase"
          >
            Ver no Corpo
          </button>
        }
      >
        <div className="space-y-4 pb-2">
          {c ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="label">Gordura</p>
                  <p className="num text-[2.25rem] leading-none font-extrabold text-body">{fmt1(c.shown.fatKg)} kg</p>
                  <p className="text-[0.875rem] text-dim">cerca de {c.shown.pct} %</p>
                  {usualUsed != null && <p className="text-[0.8125rem] leading-snug text-dim">{usualNeckLabel(usualUsed)}</p>}
                </div>
                <div>
                  <p className="label">Massa magra</p>
                  <p className="num text-[2.25rem] leading-none font-extrabold">{fmt1(c.shown.leanKg)} kg</p>
                  <p className="text-[0.875rem] text-dim">músculo, água, osso, órgãos</p>
                </div>
              </div>
              <p className="text-[0.9375rem]">
                Cintura {fmt1(Number(saved.waist_cm))} cm
                {savedTarget != null && <> · alvo cerca de {Math.round(savedTarget)} cm</>}
              </p>
              {change && previous ? (
                <p className="text-[0.9375rem]">
                  Desde {fmtDayMonth(previous.date)}: {changeSentence(change)} · {confirmationSentence(change)}
                </p>
              ) : previous && !sameSiteBefore ? (
                <p className="text-[0.9375rem] text-dim">
                  A anterior tinha a cintura{' '}
                  {measuredWaistSite(previous.readings) === 'umbigo' ? 'no umbigo' : 'na parte mais estreita'}: mostro o que
                  mudou a partir da próxima medição.
                </p>
              ) : (
                <p className="text-[0.9375rem] text-dim">Na próxima medição mostro o que mudou.</p>
              )}
              {why && (
                <div className="rounded-xl border border-line px-3 py-2.5">
                  <p className="label pb-1">Porque mudou a %G</p>
                  <ExplicacaoGordura explanation={why} offerConfirm={false} />
                </div>
              )}
            </>
          ) : (
            <p className="text-[0.9375rem]">Guardado.</p>
          )}
          {saved.flags.filter((f) => !(f === 'pescoco_mudou' && why)).map((f) => (
            <p key={f} className="rounded-xl bg-attn/15 px-3 py-2 text-[0.875rem] text-attn">
              {FLAG_TEXT[f as MeasureFlag] ?? f}
            </p>
          ))}
        </div>
      </BottomSheet>
    )
  }

  const zoneInput = (zone: Zone, essential: boolean) => {
    // A última cintura noutro sítio não serve de referência.
    const last =
      zone === 'waist' && !sameSiteBefore ? null : (previous?.[ZONE_COLUMN[zone]] as number | null | undefined)
    const first = parse(readings[zone][0] ?? '')
    const second = parse(readings[zone][1] ?? '')
    const count = !twice ? 1 : needsThirdReading(first, second) ? 3 : 2
    const avg = value(zone)
    const warning = avg != null ? checkZone(zone, avg) : null
    return (
      <div key={zone} className="space-y-1">
        <div className="flex items-baseline justify-between">
          <span className="label">
            {ZONE_LABEL[zone]}
            {zone === 'waist'
              ? site === 'natural' ? ' (parte mais estreita)' : ' (umbigo)'
              : zone === 'thigh'
                ? ` (${profile.thigh_landmark_cm ?? 15} cm acima da rótula)`
                : ''}
          </span>
          {last != null && <span className="text-[0.8125rem] text-dim">última: {fmt1(Number(last))}</span>}
        </div>
        <div className="flex gap-2">
          {Array.from({ length: count }, (_, i) => (
            <input
              key={i}
              id={`medida-${zone}-${i}`}
              inputMode="decimal"
              enterKeyHint="next"
              value={readings[zone][i] ?? ''}
              onChange={(e) => setReading(zone, i, e.target.value)}
              placeholder={count > 1 ? `${i + 1}.ª leitura` : essential ? 'cm' : 'cm (opcional)'}
              aria-label={`${ZONE_LABEL[zone]}${count > 1 ? `, ${i + 1}.ª leitura` : ''}`}
              className={`h-12 w-full rounded-xl border bg-bg px-3 text-[1.0625rem] tabular-nums placeholder:text-dim focus:outline-none ${
                warning ? 'border-attn' : 'border-line focus:border-eat'
              }`}
            />
          ))}
        </div>
        {count === 3 && <p className="text-[0.8125rem] text-dim">As duas leituras diferem mais de 1 cm: mede uma 3.ª vez.</p>}
        {warning && <p className="text-[0.8125rem] text-attn">{warning}</p>}
      </div>
    )
  }

  return (
    <BottomSheet
      title={editId ? `Medidas · ${fmtDayMonth(date)}` : 'Medidas'}
      onClose={sheet.close}
      footer={
        neckAsk && neckCheck?.outlier ? (
          <div className="space-y-2" role="group" aria-label="O pescoço mudou">
            <p className="text-[0.9375rem] font-semibold">{neckQuestion(neckCheck)}</p>
            <p className="text-[0.875rem] text-dim">
              O pescoço quase não muda, e na fórmula {fmtCm(Math.abs(neckCheck.change ?? 0))} cm de pescoço pesam tanto como {fmtCm(Math.abs(neckCheck.change ?? 0))} cm de cintura. Mede outra vez, logo abaixo{' '}
              {profile.sex === 'f' ? 'da laringe' : 'da maçã de Adão'}.
            </p>
            <button
              onClick={() => {
                setNeckAsk(false)
                setReadings({ ...readings, neck: ['', '', ''] })
                setTimeout(() => document.getElementById('medida-neck-0')?.focus(), 50)
              }}
              className="min-h-12 w-full rounded-xl bg-cta font-semibold text-on-cta"
            >
              Medir outra vez
            </button>
            <div className="grid grid-cols-2 gap-2">
              <BusyButton busy="A guardar…" onClick={() => save(true, 'confirmado', true)} className="min-h-12 rounded-xl border border-line px-2 text-[0.9375rem]">
                Está certo
              </BusyButton>
              <BusyButton busy="A guardar…" onClick={() => save(true, 'habitual', true)} className="min-h-12 rounded-xl border border-line px-2 text-[0.9375rem] leading-tight">
                Usar o pescoço habitual ({neckCheck.usual != null ? fmtCm(neckCheck.usual) : ''})
              </BusyButton>
            </div>
          </div>
        ) : odd ? (
          <div className="space-y-2" role="group" aria-label="Confirmar a medição">
            {odd.map((w) => (
              <p key={w} className="text-[0.9375rem] text-attn">
                {w}
              </p>
            ))}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setOdd(null)} className="min-h-12 rounded-xl bg-cta font-semibold text-on-cta">
                Corrigir
              </button>
              <BusyButton busy="A guardar…" onClick={() => save(false, keptChoice, true)} className="min-h-12 rounded-xl border border-line px-2 text-[0.9375rem]">
                Está certo, guardar
              </BusyButton>
            </div>
          </div>
        ) : confirmReplace ? (
          <div className="space-y-2">
            <p className="text-[0.9375rem]">Já mediste {date === today ? 'hoje' : 'nesse dia'}. Substituir a medição?</p>
            <div className="grid grid-cols-2 gap-2">
              <BusyButton busy="A guardar…" onClick={() => save(true, keptChoice, true)} className="min-h-12 rounded-xl bg-cta font-semibold text-on-cta">
                Substituir
              </BusyButton>
              <button onClick={() => setConfirmReplace(false)} className="min-h-12 rounded-xl border border-line">
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <BusyButton
            busy="A guardar…"
            disabled={!canSave}
            onClick={() => save()}
            className="min-h-14 w-full rounded-2xl bg-cta font-display text-[1.1875rem] font-bold tracking-[0.06em] text-on-cta uppercase disabled:opacity-40"
          >
            Guardar
          </BusyButton>
        )
      }
    >
      <div className="space-y-5 pb-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[0.875rem] text-dim">
            {previous
              ? 'Essenciais (1 min).'
              : needsHips
                ? 'Chegam a cintura, a anca e o pescoço. A altura já está no perfil.'
                : 'Chegam a cintura e o pescoço. A altura já está no perfil.'}
          </p>
          <button onClick={() => sheet.open('como-medir')} className="flex shrink-0 items-center gap-1 text-[0.875rem] text-dim">
            <Icon name="info" size={18} /> Como medir
          </button>
        </div>
        {/* Ideia 15: o dia da medição, como na pesagem (Hoje/Ontem). */}
        {!editId && (
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Dia da medição">
            {[
              [today, 'Hoje'],
              [shiftDate(today, -1), 'Ontem'],
            ].map(([d, label]) => (
              <button
                key={d}
                aria-pressed={date === d}
                onClick={() => setDate(d!)}
                className={`min-h-11 rounded-xl border text-[0.9375rem] ${date === d ? 'border-ink font-semibold' : 'border-line text-dim'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <label className="flex min-h-11 items-center justify-between gap-3 text-[0.9375rem]">
          Medir 2 vezes (mais rigor)
          <input type="checkbox" checked={twice} onChange={(e) => setTwice(e.target.checked)} className="h-5 w-5 accent-cta" />
        </label>

        {ESSENTIAL.map((z) => zoneInput(z, true))}

        {reference == null && (
          <label className="block space-y-1">
            <span className="label">{date === today ? 'Peso de hoje' : `Peso de ${fmtDayMonth(date)}`}</span>
            <input
              inputMode="decimal"
              value={weightText}
              onChange={(e) => setWeightText(e.target.value.replace(/[^\d,.]/g, ''))}
              placeholder="kg"
              className={`h-12 w-full rounded-xl border bg-bg px-3 text-[1.0625rem] tabular-nums placeholder:text-dim focus:outline-none ${
                typedCheck && typedCheck.kind !== 'ok' ? 'border-attn' : 'border-line focus:border-eat'
              }`}
            />
            {/* B6: o mesmo detetor de erro de dedo da pesagem (824 → 82,4). */}
            {typedCheck?.kind === 'suggest' && (
              <button
                onClick={() => setWeightText(String(typedCheck.value).replace('.', ','))}
                className="min-h-11 rounded-xl border border-attn px-3 text-[0.9375rem] text-attn"
              >
                Queres dizer {fmt1(typedCheck.value)} kg?
              </button>
            )}
            <span className="block text-[0.8125rem] text-dim">Não há pesagem nos últimos 7 dias; fica também como pesagem.</span>
          </label>
        )}
        {reference != null && (
          <p className="text-[0.8125rem] text-dim">Peso usado: {fmt1(reference)} kg (o teu peso médio nesse dia).</p>
        )}

        {liveComposition && (
          <p className="rounded-xl bg-surface2 px-3 py-2 text-[0.9375rem]">
            Gordura {fmt1(liveComposition.shown.fatKg)}&nbsp;kg (cerca de {liveComposition.shown.pct}&nbsp;%) · Massa magra{' '}
            {fmt1(liveComposition.shown.leanKg)}&nbsp;kg
          </p>
        )}

        <button onClick={() => setShowOptional(!showOptional)} className="min-h-11 text-[0.9375rem] text-dim">
          Opcionais: {needsHips ? 'peito, braço, coxa, gémeo' : 'peito, anca, braço, coxa, gémeo'} {showOptional ? '▾' : '›'}
        </button>
        {showOptional && OPTIONAL.map((z) => zoneInput(z, false))}

        {editId && existing && (
          <BusyButton busy="A apagar…" onClick={remove} className="min-h-12 w-full rounded-xl border border-line text-[0.9375rem] text-pain">
            Apagar esta medição
          </BusyButton>
        )}
      </div>
    </BottomSheet>
  )
}

// Os sítios do método da Marinha: nas mulheres a cintura é a parte mais
// estreita e a anca entra na fórmula; nos homens a cintura é no umbigo.
export function ComoMedirSheet() {
  const sheet = useSheet()
  const female = useReadyProfile().sex === 'f'
  return (
    <BottomSheet title="Como medir" onClose={sheet.close}>
      <div className="space-y-4 pb-2 text-[0.9375rem]">
        <p>
          De manhã, em jejum, depois de ires à casa de banho e antes de treinar. De pé, pés juntos, sem t-shirt. Fita
          encostada à pele, sem apertar.
        </p>
        <div>
          <p className="label">Pescoço</p>
          <p>
            Logo abaixo {female ? 'da laringe' : 'da maçã de Adão'}, com a fita a descer ligeiramente para a frente; olha em
            frente.
          </p>
        </div>
        <div>
          <p className="label">Cintura</p>
          <p>
            {female
              ? 'Na horizontal, na parte mais estreita da barriga (costuma ser a meio entre o umbigo e a ponta de baixo do esterno)'
              : 'Na horizontal, à altura do umbigo'}
            ; lê no fim de uma expiração normal, sem encolher a barriga.
          </p>
        </div>
        {female && (
          <div>
            <p className="label">Anca</p>
            <p>No maior volume das nádegas, pés juntos.</p>
          </div>
        )}
        <div>
          <p className="label">Opcionais</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Peito: na linha dos mamilos, no fim da expiração.</li>
            {!female && <li>Anca: no maior volume das nádegas, pés juntos.</li>}
            <li>Braço direito: a meio entre ombro e cotovelo, relaxado.</li>
            <li>Coxa direita: 15 cm acima do topo da rótula, de pé, com o peso nos dois pés.</li>
            <li>Gémeo direito: no maior volume.</li>
          </ul>
        </div>
        <p className="text-dim">Se quiseres mais rigor, liga «Medir 2 vezes».</p>
      </div>
    </BottomSheet>
  )
}
