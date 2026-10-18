import { describe, expect, it } from 'vitest'
import {
  NO_PUSH,
  TEST_NOTICE,
  anyPush,
  base64UrlToBytes,
  cleanPrefs,
  deadSubscription,
  dinnerNotice,
  envVapidKeys,
  isMonday,
  mealAnalysedNotice,
  needsDinnerReminder,
  pushEndpointAllowed,
  sameServerKey,
  vapidSubject,
  wantsPush,
  weekNotice,
} from '../api/_lib/rules/notificacoes'

describe('escolhas das notificações', () => {
  it('só as três escolhas, a verdadeiro só quando ligadas', () => {
    expect(cleanPrefs({ refeicao: true, jantar: 'sim', outra: true })).toEqual({ refeicao: true, jantar: false, semana: false })
    expect(cleanPrefs(null)).toEqual(NO_PUSH)
    expect(anyPush(NO_PUSH)).toBe(false)
    expect(anyPush({ ...NO_PUSH, semana: true })).toBe(true)
  })

  it('cada tipo só vai para quem o ligou; a de teste vai sempre', () => {
    expect(wantsPush({ refeicao: true }, 'refeicao')).toBe(true)
    expect(wantsPush({ refeicao: true }, 'jantar')).toBe(false)
    expect(wantsPush({}, 'teste')).toBe(true)
  })
})

describe('o que dizem (neutro no ecrã bloqueado)', () => {
  it('refeição analisada abre esse dia com a refeição', () => {
    const n = mealAnalysedNotice({ id: 'm1', date: '2026-10-18', slot: 'almoco', kcal: 639.6, status: 'ok' })
    expect(n.title).toBe('Almoço analisado · 640 kcal')
    expect(n.url).toBe('/hoje/2026-10-18?folha=refeicao&id=m1')
    expect(n.tag).toBe('refeicao-m1')
    expect(mealAnalysedNotice({ id: 'm2', date: '2026-10-18', slot: 'ceia', kcal: 210, status: 'por_rever' })).toMatchObject({
      title: 'Ceia analisada · 210 kcal',
      body: 'Vê se as porções estão certas.',
    })
    expect(mealAnalysedNotice({ id: 'm3', date: '2026-10-18', slot: null, kcal: null, status: 'ok' }).title).toBe(
      'Refeição analisada · 0 kcal',
    )
  })

  it('nenhuma fala de peso nem de gordura', () => {
    const all = [
      mealAnalysedNotice({ id: 'm', date: '2026-10-18', slot: 'jantar', kcal: 800, status: 'ok' }),
      dinnerNotice('2026-10-18'),
      weekNotice('2026-10-12'),
      TEST_NOTICE,
    ]
    for (const n of all) expect(`${n.title} ${n.body}`).not.toMatch(/kg|peso|gordura|%/i)
    expect(weekNotice('2026-10-12').url).toBe('/balanco?semana=2026-10-12')
  })
})

describe('lembrete do jantar', () => {
  it('dia incompleto e sem jantar: lembra', () => {
    expect(needsDinnerReminder([{ slot: 'almoco', kcal: 700 }], [])).toBe(true)
    expect(needsDinnerReminder([], [])).toBe(true)
  })

  it('com jantar registado, dia completo ou já respondido: não lembra', () => {
    expect(needsDinnerReminder([{ slot: 'jantar', kcal: 0 }], [])).toBe(false)
    expect(
      needsDinnerReminder(
        [
          { slot: 'pequeno_almoco', kcal: 400 },
          { slot: 'almoco', kcal: 700 },
        ],
        [],
      ),
    ).toBe(false)
    expect(needsDinnerReminder([], ['dia_fechado'])).toBe(false)
    expect(needsDinnerReminder([{ slot: 'almoco', kcal: 700 }], ['faltou_algo'])).toBe(false)
  })

  it('um jantar ainda a analisar ou sem análise já está registado; só as analisadas contam para a regra 5', () => {
    expect(needsDinnerReminder([{ slot: 'jantar', kcal: null, status: 'a_analisar' }], [])).toBe(false)
    expect(needsDinnerReminder([{ slot: 'jantar', kcal: null, status: 'sem_analise' }], [])).toBe(false)
    expect(
      needsDinnerReminder(
        [
          { slot: 'pequeno_almoco', kcal: 400, status: 'ok' },
          { slot: 'almoco', kcal: 700, status: 'erro' },
        ],
        [],
      ),
    ).toBe(true)
  })

  it('duas refeições com menos de 800 kcal ainda não chegam (regra 5)', () => {
    expect(
      needsDinnerReminder(
        [
          { slot: 'pequeno_almoco', kcal: 300 },
          { slot: 'lanche', kcal: 200 },
        ],
        [],
      ),
    ).toBe(true)
  })
})

describe('cron dos lembretes', () => {
  it('segunda-feira', () => {
    expect(isMonday('2026-10-19')).toBe(true)
    expect(isMonday('2026-10-18')).toBe(false)
  })
})

describe('envio', () => {
  it('apaga a subscrição só quando o serviço diz que já não existe', () => {
    expect(deadSubscription(404)).toBe(true)
    expect(deadSubscription(410)).toBe(true)
    for (const status of [400, 403, 413, 429, 500, undefined]) expect(deadSubscription(status)).toBe(false)
  })

  it('só para os serviços de notificações conhecidos', () => {
    expect(pushEndpointAllowed('https://web.push.apple.com/QGx…')).toBe(true)
    expect(pushEndpointAllowed('https://fcm.googleapis.com/fcm/send/abc')).toBe(true)
    expect(pushEndpointAllowed('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true)
    expect(pushEndpointAllowed('http://web.push.apple.com/x')).toBe(false)
    expect(pushEndpointAllowed('https://web.push.apple.com.evil.pt/x')).toBe(false)
    expect(pushEndpointAllowed('https://169.254.169.254/latest')).toBe(false)
    expect(pushEndpointAllowed('não é um endereço')).toBe(false)
  })
})

describe('chaves VAPID', () => {
  it('das env vars só com as duas', () => {
    expect(envVapidKeys({ VAPID_PUBLIC_KEY: ' pub ', VAPID_PRIVATE_KEY: 'priv' })).toEqual({ publicKey: 'pub', privateKey: 'priv' })
    expect(envVapidKeys({ VAPID_PUBLIC_KEY: 'pub' })).toBeNull()
  })

  it('contacto: VAPID_SUBJECT, senão o endereço da app', () => {
    expect(vapidSubject({ VAPID_SUBJECT: 'mailto:eu@exemplo.pt' })).toBe('mailto:eu@exemplo.pt')
    expect(vapidSubject({ VAPID_SUBJECT: 'eu@exemplo.pt' })).toBe('mailto:eu@exemplo.pt')
    expect(vapidSubject({ VERCEL_PROJECT_PRODUCTION_URL: 'daily-track.vercel.app' })).toBe('https://daily-track.vercel.app')
    expect(vapidSubject({})).toMatch(/^mailto:/)
  })

  it('a subscrição feita com outra chave deixa de servir', () => {
    const key = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
    const bytes = base64UrlToBytes(key)
    expect(bytes.length).toBe(65)
    expect(sameServerKey(bytes.slice().buffer, key)).toBe(true)
    const other = bytes.slice()
    other[10] = other[10]! ^ 1
    expect(sameServerKey(other.buffer, key)).toBe(false)
    // Sem a chave da subscrição não se sabe: fica.
    expect(sameServerKey(null, key)).toBe(true)
  })
})
