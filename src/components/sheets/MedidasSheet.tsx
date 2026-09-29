import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { supabase } from '../../lib/supabase'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { emitDataChanged } from '../../lib/events'
import { useReadyProfile } from '../../lib/profile'
import { localCalendarDate, shiftDate } from '../../lib/day'
import { fmt1, fmtDayMonth, parseDecimal } from '../../lib/format'
import { isMaintenanceWeek } from '../../../api/_lib/rules/manutencao'
import {
  FLAG_TEXT,
  ZONE_LABEL,
  averageReadings,
  changeSentence,
  checkZone,
  compareCompositions,
  composition,
  confirmationSentence,
  measureFlags,
  needsThirdReading,
  referenceWeight,
  targetWaist,
  type MeasureFlag,
  type Zone,
} from '../../../api/_lib/rules/composicao'
import type { BodyMeasurement } from '../../lib/types'
import BottomSheet from '../ui/BottomSheet'
import Icon from '../ui/Icon'

export const TARGET_BODY_FAT_PCT = 15
const ESSENTIAL: Zone[] = ['neck', 'waist']
const OPTIONAL: Zone[] = ['chest', 'hips', 'arm', 'thigh', 'calf']
const COLUMN: Record<Zone, keyof BodyMeasurement> = {
  neck: 'neck_cm',
  waist: 'waist_cm',
  chest: 'chest_cm',
  hips: 'hips_cm',
  arm: 'arm_cm',
  thigh: 'thigh_cm',
  calf: 'calf_cm',
}

type Readings = Record<Zone, string[]>

const emptyReadings = (): Readings =>
  Object.fromEntries([...ESSENTIAL, ...OPTIONAL].map((z) => [z, ['', '', '']])) as Readings

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
  const [, navigate] = useLocation()
  const editId = sheet.params.get('id')
  const today = localCalendarDate()
  const [date, setDate] = useState(sheet.params.get('data') ?? today)
  const [loaded, setLoaded] = useState(false)
  const [existing, setExisting] = useState<BodyMeasurement | null>(null)
  const [previous, setPrevious] = useState<BodyMeasurement | null>(null)
  const [weights, setWeights] = useState<{ date: string; kg: number }[]>([])
  const [dinnerOut, setDinnerOut] = useState(false)
  const [readings, setReadings] = useState<Readings>(emptyReadings)
  const [twice, setTwice] = useState(false)
  const [showOptional, setShowOptional] = useState(false)
  const [weightText, setWeightText] = useState('')
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<BodyMeasurement | null>(null)

  useEffect(() => {
    void (async () => {
      let day = date
      let editing: BodyMeasurement | null = null
      if (editId) {
        const { data } = await supabase.from('body_measurements').select('*').eq('id', editId).maybeSingle()
        editing = (data ?? null) as BodyMeasurement | null
        if (editing) {
          day = editing.date
          setDate(editing.date)
          const r = emptyReadings()
          for (const zone of [...ESSENTIAL, ...OPTIONAL]) {
            const list = editing.readings?.[zone]
            const value = editing[COLUMN[zone]] as number | null
            r[zone] = list?.length ? [...list.map(String), '', ''].slice(0, 3) : [value != null ? String(value) : '', '', '']
            if ((list?.length ?? 0) > 1) setTwice(true)
            if (OPTIONAL.includes(zone) && value != null) setShowOptional(true)
          }
          setReadings(r)
        }
      }
      const [{ data: same }, { data: before }, { data: w }, { data: yMeals }] = await Promise.all([
        supabase.from('body_measurements').select('*').eq('date', day).maybeSingle(),
        supabase
          .from('body_measurements')
          .select('*')
          .lt('date', day)
          .order('date', { ascending: false })
          .limit(1),
        supabase.from('weights').select('date,kg').gte('date', shiftDate(day, -6)).lte('date', day),
        supabase.from('meals').select('tags').eq('date', shiftDate(day, -1)).is('deleted_at', null),
      ])
      setExisting(editing ?? ((same ?? null) as BodyMeasurement | null))
      setPrevious(((before ?? [])[0] ?? null) as BodyMeasurement | null)
      setWeights(((w ?? []) as { date: string; kg: number }[]).map((x) => ({ date: x.date, kg: Number(x.kg) })))
      setDinnerOut((yMeals ?? []).some((m) => ((m.tags as string[] | null) ?? []).includes('jantar_fora')))
      setLoaded(true)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId])

  const height = Number(profile.height_cm ?? 183)
  const reference = existing && editId ? Number(existing.weight_used_kg) : referenceWeight(weights, date)
  const weightUsed = reference ?? parse(weightText)
  const value = (zone: Zone) => averageReadings(readings[zone].map((t) => parse(t) ?? NaN))
  const neck = value('neck')
  const waist = value('waist')
  const liveComposition =
    neck != null && waist != null && weightUsed != null
      ? composition(height, { neck_cm: neck, waist_cm: waist, weight_used_kg: weightUsed })
      : null
  const canSave = neck != null && waist != null && weightUsed != null

  function setReading(zone: Zone, index: number, text: string) {
    const next = { ...readings, [zone]: readings[zone].map((t, i) => (i === index ? text.replace(/[^\d,.]/g, '') : t)) }
    setReadings(next)
  }

  async function save(replace = false) {
    if (!canSave || neck == null || waist == null || weightUsed == null) return
    if (existing && !editId && !replace) {
      setConfirmReplace(true)
      return
    }
    setBusy(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setBusy(false)
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
      previous: previous ? { date: previous.date, neck_cm: previous.neck_cm, waist_cm: previous.waist_cm } : null,
      date,
      maintenance,
      dinnerOutYesterday: dinnerOut,
    })
    const row: Record<string, unknown> = {
      user_id: user.id,
      date,
      method: 'tape',
      measured_at: new Date().toISOString(),
      weight_used_kg: weightUsed,
      flags,
      readings: Object.fromEntries(
        [...ESSENTIAL, ...OPTIONAL]
          .map((z) => [z, readings[z].map(parse).filter((n): n is number => n != null)] as const)
          .filter(([, list]) => list.length > 0),
      ),
    }
    for (const zone of [...ESSENTIAL, ...OPTIONAL]) row[COLUMN[zone]] = value(zone)
    const { data, error } = await supabase
      .from('body_measurements')
      .upsert(row, { onConflict: 'user_id,date,method' })
      .select()
      .single()
    setBusy(false)
    setConfirmReplace(false)
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
        <p className="py-8 text-center text-[15px] text-dim">A carregar…</p>
      </BottomSheet>
    )
  }

  if (saved) {
    const c =
      saved.neck_cm != null && saved.waist_cm != null
        ? composition(height, {
            neck_cm: Number(saved.neck_cm),
            waist_cm: Number(saved.waist_cm),
            weight_used_kg: Number(saved.weight_used_kg),
          })
        : null
    const before =
      previous?.neck_cm != null && previous.waist_cm != null
        ? composition(height, {
            neck_cm: Number(previous.neck_cm),
            waist_cm: Number(previous.waist_cm),
            weight_used_kg: Number(previous.weight_used_kg),
          })
        : null
    const change = c && before ? compareCompositions(before, c) : null
    return (
      <BottomSheet
        title="Medição guardada"
        onClose={sheet.close}
        footer={
          <button
            onClick={() => {
              sheet.close()
              navigate('/corpo')
            }}
            className="min-h-14 w-full rounded-2xl bg-cta font-display text-[19px] font-bold tracking-[0.06em] text-on-cta uppercase"
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
                  <p className="num text-[36px] leading-none font-extrabold text-body">{fmt1(c.shown.fatKg)} kg</p>
                  <p className="text-[14px] text-dim">cerca de {c.shown.pct} %</p>
                </div>
                <div>
                  <p className="label">Massa magra</p>
                  <p className="num text-[36px] leading-none font-extrabold">{fmt1(c.shown.leanKg)} kg</p>
                  <p className="text-[14px] text-dim">músculo, água, osso, órgãos</p>
                </div>
              </div>
              <p className="text-[15px]">
                Cintura {fmt1(Number(saved.waist_cm))} cm · alvo cerca de{' '}
                {Math.round(targetWaist(height, Number(saved.neck_cm), TARGET_BODY_FAT_PCT))} cm
              </p>
              {change && previous ? (
                <p className="text-[15px]">
                  Desde {fmtDayMonth(previous.date)}: {changeSentence(change)} · {confirmationSentence(change)}
                </p>
              ) : (
                <p className="text-[15px] text-dim">Na próxima medição mostro o que mudou.</p>
              )}
            </>
          ) : (
            <p className="text-[15px]">Guardado.</p>
          )}
          {saved.flags.map((f) => (
            <p key={f} className="rounded-xl bg-attn/15 px-3 py-2 text-[14px] text-attn">
              {FLAG_TEXT[f as MeasureFlag] ?? f}
            </p>
          ))}
        </div>
      </BottomSheet>
    )
  }

  const zoneInput = (zone: Zone, essential: boolean) => {
    const last = previous?.[COLUMN[zone]] as number | null | undefined
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
            {zone === 'waist' ? ' (umbigo)' : zone === 'thigh' ? ` (${profile.thigh_landmark_cm ?? 15} cm acima da rótula)` : ''}
          </span>
          {last != null && <span className="text-[13px] text-dim">última: {fmt1(Number(last))}</span>}
        </div>
        <div className="flex gap-2">
          {Array.from({ length: count }, (_, i) => (
            <input
              key={i}
              inputMode="decimal"
              enterKeyHint="next"
              value={readings[zone][i] ?? ''}
              onChange={(e) => setReading(zone, i, e.target.value)}
              placeholder={count > 1 ? `${i + 1}.ª leitura` : essential ? 'cm' : 'cm (opcional)'}
              aria-label={`${ZONE_LABEL[zone]}${count > 1 ? `, ${i + 1}.ª leitura` : ''}`}
              className={`h-12 w-full rounded-xl border bg-bg px-3 text-[17px] tabular-nums placeholder:text-dim focus:outline-none ${
                warning ? 'border-attn' : 'border-line focus:border-eat'
              }`}
            />
          ))}
        </div>
        {count === 3 && <p className="text-[13px] text-dim">As duas leituras diferem mais de 1 cm: mede uma 3.ª vez.</p>}
        {warning && <p className="text-[13px] text-attn">{warning}</p>}
      </div>
    )
  }

  return (
    <BottomSheet
      title={editId ? `Medidas · ${fmtDayMonth(date)}` : 'Medidas'}
      onClose={sheet.close}
      footer={
        confirmReplace ? (
          <div className="space-y-2">
            <p className="text-[15px]">Já mediste {date === today ? 'hoje' : 'nesse dia'}. Substituir a medição?</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                disabled={busy}
                onClick={() => void save(true)}
                className="min-h-12 rounded-xl bg-cta font-semibold text-on-cta"
              >
                Substituir
              </button>
              <button onClick={() => setConfirmReplace(false)} className="min-h-12 rounded-xl border border-line">
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            disabled={!canSave || busy}
            onClick={() => void save()}
            className="min-h-14 w-full rounded-2xl bg-cta font-display text-[19px] font-bold tracking-[0.06em] text-on-cta uppercase disabled:opacity-40"
          >
            {busy ? 'A guardar…' : 'Guardar'}
          </button>
        )
      }
    >
      <div className="space-y-5 pb-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[14px] text-dim">
            {previous ? 'Essenciais (1 min).' : 'Chegam a cintura e o pescoço. A altura já está no perfil.'}
          </p>
          <button onClick={() => sheet.open('como-medir')} className="flex shrink-0 items-center gap-1 text-[14px] text-dim">
            <Icon name="info" size={18} /> Como medir
          </button>
        </div>
        <label className="flex items-center justify-between gap-3 text-[15px]">
          Medir 2 vezes (mais rigor)
          <input type="checkbox" checked={twice} onChange={(e) => setTwice(e.target.checked)} className="h-5 w-5 accent-current" />
        </label>

        {ESSENTIAL.map((z) => zoneInput(z, true))}

        {reference == null && (
          <label className="block space-y-1">
            <span className="label">Peso de hoje</span>
            <input
              inputMode="decimal"
              value={weightText}
              onChange={(e) => setWeightText(e.target.value.replace(/[^\d,.]/g, ''))}
              placeholder="kg"
              className="h-12 w-full rounded-xl border border-line bg-bg px-3 text-[17px] tabular-nums placeholder:text-dim focus:border-eat focus:outline-none"
            />
            <span className="block text-[13px] text-dim">Não há pesagem nos últimos 7 dias; fica também como pesagem.</span>
          </label>
        )}
        {reference != null && (
          <p className="text-[13px] text-dim">Peso usado: {fmt1(reference)} kg (o teu peso médio nesse dia).</p>
        )}

        {liveComposition && (
          <p className="rounded-xl bg-surface2 px-3 py-2 text-[15px]">
            Gordura {fmt1(liveComposition.shown.fatKg)} kg (cerca de {liveComposition.shown.pct} %) · Massa magra{' '}
            {fmt1(liveComposition.shown.leanKg)} kg
          </p>
        )}

        <button onClick={() => setShowOptional(!showOptional)} className="text-[15px] text-dim">
          Opcionais: peito, anca, braço, coxa, gémeo {showOptional ? '▾' : '›'}
        </button>
        {showOptional && OPTIONAL.map((z) => zoneInput(z, false))}

        {editId && existing && (
          <button onClick={() => void remove()} className="min-h-12 w-full rounded-xl border border-line text-[15px] text-pain">
            Apagar esta medição
          </button>
        )}
      </div>
    </BottomSheet>
  )
}

export function ComoMedirSheet() {
  const sheet = useSheet()
  return (
    <BottomSheet title="Como medir" onClose={sheet.close}>
      <div className="space-y-4 pb-2 text-[15px]">
        <p>
          De manhã, em jejum, depois de ires à casa de banho e antes de treinar. De pé, pés juntos, sem t-shirt. Fita
          encostada à pele, sem apertar.
        </p>
        <div>
          <p className="label">Pescoço</p>
          <p>Logo abaixo da maçã de Adão, com a fita a descer ligeiramente para a frente; olha em frente.</p>
        </div>
        <div>
          <p className="label">Cintura</p>
          <p>Na horizontal, à altura do umbigo; lê no fim de uma expiração normal, sem encolher a barriga.</p>
        </div>
        <div>
          <p className="label">Opcionais</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Peito: na linha dos mamilos, no fim da expiração.</li>
            <li>Anca: no maior volume das nádegas, pés juntos.</li>
            <li>Braço direito: a meio entre ombro e cotovelo, relaxado.</li>
            <li>Coxa direita: 15 cm acima do topo da rótula, peso nos dois pés (os quadríceps protegem o joelho).</li>
            <li>Gémeo direito: no maior volume.</li>
          </ul>
        </div>
        <p className="text-dim">Se quiseres mais rigor, liga «Medir 2 vezes».</p>
      </div>
    </BottomSheet>
  )
}
