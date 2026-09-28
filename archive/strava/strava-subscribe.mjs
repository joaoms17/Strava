// Cria a subscrição do webhook do Strava (só existe uma por app).
// Correr UMA VEZ depois do deploy, com as env vars do Strava definidas:
//
//   STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=... STRAVA_VERIFY_TOKEN=... \
//     node scripts/strava-subscribe.mjs create https://a-tua-app.vercel.app
//
//   node scripts/strava-subscribe.mjs list
//   node scripts/strava-subscribe.mjs delete <id>

const API = 'https://www.strava.com/api/v3/push_subscriptions'

const clientId = process.env.STRAVA_CLIENT_ID
const clientSecret = process.env.STRAVA_CLIENT_SECRET
const verifyToken = process.env.STRAVA_VERIFY_TOKEN
if (!clientId || !clientSecret) {
  console.error('Faltam STRAVA_CLIENT_ID e/ou STRAVA_CLIENT_SECRET no ambiente.')
  process.exit(1)
}

const [command = 'create', arg] = process.argv.slice(2)

async function main() {
  if (command === 'list') {
    const res = await fetch(`${API}?client_id=${clientId}&client_secret=${clientSecret}`)
    console.log(res.status, await res.json())
    return
  }

  if (command === 'delete') {
    if (!arg) throw new Error('Uso: delete <id>')
    const res = await fetch(`${API}/${arg}?client_id=${clientId}&client_secret=${clientSecret}`, {
      method: 'DELETE',
    })
    console.log(res.status, res.status === 204 ? 'apagada' : await res.text())
    return
  }

  if (!arg) throw new Error('Uso: create <origem>, ex.: create https://a-tua-app.vercel.app')
  if (!verifyToken) throw new Error('Falta STRAVA_VERIFY_TOKEN no ambiente.')
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    callback_url: `${arg.replace(/\/$/, '')}/api/strava/webhook`,
    verify_token: verifyToken,
  })
  const res = await fetch(API, { method: 'POST', body })
  const json = await res.json()
  console.log(res.status, json)
  if (!res.ok) {
    console.error('Se já existir uma subscrição, usa "list" e "delete <id>" primeiro.')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
