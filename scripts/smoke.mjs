// Verificação rápida da produção depois de um deploy:
//
//   CRON_SECRET=... node scripts/smoke.mjs https://zlatan-strava-suarez.vercel.app
//
// Cada função tem de responder sem 500 (sem sessão, 401/404/405 são normais:
// provam que a função arrancou e carregou os módulos). /api/day/health tem de
// dar 200 com o token.

const base = (process.argv[2] ?? '').replace(/\/$/, '')
const token = process.env.CRON_SECRET
if (!base || !token) {
  console.error('Uso: CRON_SECRET=... node scripts/smoke.mjs <url da app>')
  process.exit(1)
}

const probes = [
  ['POST', '/api/meal/parse-text'],
  ['POST', '/api/meal/save'],
  ['POST', '/api/meal/log-favorite'],
  ['POST', '/api/meal/capture'],
  ['POST', '/api/day/recompute'],
  ['GET', '/api/food/barcode/5601234567890'],
  ['POST', '/api/workout/manual'],
  ['POST', '/api/plan/generate'],
  ['GET', '/api/calendar'],
  ['POST', '/api/health/daily'],
  ['GET', '/api/cron/daily'],
]

let failed = 0
for (const [method, path] of probes) {
  const res = await fetch(base + path, { method })
  const bad = res.status >= 500
  if (bad) failed++
  console.log(`${bad ? '✗' : '✓'} ${method} ${path} → ${res.status}`)
}

const health = await fetch(`${base}/api/day/health?token=${encodeURIComponent(token)}`)
const body = await health.json().catch(() => ({}))
if (health.status !== 200) failed++
console.log(`${health.status === 200 ? '✓' : '✗'} GET /api/day/health → ${health.status}: ${body.resumo ?? ''}`)
if (health.status !== 200) console.log(JSON.stringify(body, null, 2))

process.exit(failed ? 1 : 0)
