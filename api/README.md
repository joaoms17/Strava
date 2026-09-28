# /api — funções serverless (Vercel)

7 funções (o Hobby aceita 12; `tests/guardas.test.ts` falha acima de 10). Os routers `meal`, `workout` e `day` despacham por `?action=`, e os caminhos públicos mantêm-se por rewrites no `vercel.json`. As funções correm como ES modules: imports relativos com `.js`. O export CSV gera-se no cliente (Definições). A integração por API do Strava está em `/archive/strava` (exige subscrição paga).

| Endpoint | Método | Descrição |
| --- | --- | --- |
| `/api/meal/parse-text` | POST | Haiku, temperatura 0. Texto shorthand + top 100 foods pessoais por `use_count`. Devolve `{items[], confidence, questions[]}`. |
| `/api/meal/parse-photo` | POST | Sonnet, sem thinking. Foto (Supabase Storage) + texto opcional. Mesmo JSON + `assumed_portions`. |
| `/api/meal/save` | POST | Grava a refeição confirmada: valida com Zod, calcula dia nutricional (regra 1) e totais no servidor. |
| `/api/food/barcode/:ean` | GET | Proxy ao Open Food Facts (User-Agent identificado), guarda em `foods` com source `off`. Vive na função `meal`. |
| `/api/workout/manual` | POST | Sessão manual; `kcal_est` calculado ao gravar (regra 2, com METs líquidos para caminhada, elíptica, natação e outro). |
| `/api/workout/checkin` | POST | Semáforo de dor (durante / dia seguinte) e dados da consola. |
| `/api/workout/session` | POST | Séries da sessão de força. |
| `/api/plan/generate` | POST | Sonnet, sem thinking. Bloco de 4 semanas, semana 4 é deload. |
| `/api/day/health` | GET | Estado do deploy (`?token=CRON_SECRET`): env vars presentes (nunca valores), prompts, Supabase, acesso aos modelos da Anthropic. |
| `/api/health/daily` | POST | Bearer `HEALTH_INGEST_TOKEN`. Passos, sono, FC em repouso (Atalho iOS). |
| `/api/calendar` | GET | Feed .ics das `planned_sessions` (`?token=ICS_TOKEN`). |
| `/api/cron/daily` | — | 04:30 UTC: fecha os últimos 3 dias (soma o `kcal_est` guardado de cada treino), calcula o adaptativo e, à segunda, gera o review semanal. |

Regras: Anthropic SDK só aqui; JSON estrito validado com Zod; sem repetições automáticas do SDK (`maxRetries: 0`) e uma segunda tentativa só se ainda houver tempo dentro dos 60 s; respostas cortadas ou recusadas não contam; tudo registado em `api_calls`. As regras de negócio da secção 5 vivem em `/api/_lib/rules` como funções puras, testadas em `/tests`.
