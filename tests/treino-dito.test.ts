import { describe, expect, it } from 'vitest'
import { cleanSaid, favoriteExercises, saidSummary, strengthSets } from '../api/_lib/rules/treino-dito'
import { geminiRequest } from '../api/_lib/rules/gemini'
import { encodeWav } from '../src/lib/audio'

// «Dizer o treino»: o que a IA percebeu, arrumado para gravar.
describe('dizer o treino', () => {
  it('ginásio: exercícios e séries, números com vírgula, nada fora do razoável', () => {
    const w = cleanSaid(
      {
        tipo: 'strength',
        desporto: 'corrida',
        titulo: ' Peito e tríceps ',
        data: '2026-10-04',
        minutos: 50,
        watts: 200,
        exercicios: [
          { nome: 'Supino com barra', series: [{ reps: 10, carga_kg: '60' }, { reps: 8, carga_kg: '62,5' }] },
          { nome: 'Prancha', series: [{ reps: null, carga_kg: null }] },
          { nome: '', series: [] },
          { nome: 'Agachamento', series: [{ reps: 500, carga_kg: 9999 }] },
        ],
      },
      '2026-10-05',
    )
    expect(w).toMatchObject({ type: 'strength', sport: null, title: 'Peito e tríceps', date: '2026-10-04', minutes: 50, watts: null })
    expect(w.exercises.map((e) => e.name)).toEqual(['Supino com barra', 'Prancha', 'Agachamento'])
    expect(w.exercises[0]!.sets).toEqual([
      { reps: 10, load_kg: 60 },
      { reps: 8, load_kg: 62.5 },
    ])
    expect(w.exercises[2]!.sets).toEqual([{ reps: null, load_kg: null }])
    expect(strengthSets(w.exercises)).toHaveLength(4)
    expect(strengthSets(w.exercises)[1]).toEqual({ exercise: 'Supino com barra', set_index: 2, reps: 8, load_kg: 62.5, rpe: null })
    expect(favoriteExercises(w.exercises)[0]).toEqual({ name: 'Supino com barra', sets: 2, rep_min: 8, rep_max: 10, load_kg: 62.5 })
    expect(favoriteExercises(w.exercises)[1]).toEqual({ name: 'Prancha', sets: 1, rep_min: 8, rep_max: 12, load_kg: null })
  })

  it('outros desportos e bicicleta; data no futuro ou antiga não serve', () => {
    const padel = cleanSaid({ tipo: 'other', desporto: 'padel', titulo: 'Padel', minutos: 90, data: '2026-10-09' }, '2026-10-05')
    expect(padel).toMatchObject({ type: 'other', sport: 'padel', minutes: 90, date: null, exercises: [] })
    const bike = cleanSaid({ tipo: 'bike', minutos: 45, watts: 140, fc_media: 128, data: '2026-09-01' }, '2026-10-05')
    expect(bike).toMatchObject({ type: 'bike', sport: null, watts: 140, avg_hr: 128, date: null })
    expect(saidSummary(bike, (s) => s)).toBe('Bicicleta · 45 min · 140 W · FC 128')
    expect(cleanSaid({ tipo: 'nada' }, '2026-10-05')).toMatchObject({ type: 'other', sport: 'outro', title: '' })
  })

  it('o áudio vai para o Gemini como inlineData', () => {
    const body = geminiRequest(
      {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '{}' },
              { type: 'audio', source: { type: 'base64', media_type: 'audio/wav', data: 'UklGRg==' } },
            ],
          },
        ],
      },
      { type: 'object', properties: {} },
    ) as { contents: { parts: unknown[] }[] }
    expect(body.contents[0]!.parts[1]).toEqual({ inlineData: { mimeType: 'audio/wav', data: 'UklGRg==' } })
  })

  it('WAV: cabeçalho certo e amostras em 16 bits', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), 16000)
    const view = new DataView(wav.buffer)
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe('WAVE')
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint32(40, true)).toBe(8)
    expect([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 16383])
  })
})
