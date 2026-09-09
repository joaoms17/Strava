# /api — funções serverless (Vercel)

Implementados (M1–M2): `meal/parse-text`, `meal/parse-photo`, `meal/save` (dia nutricional, totais e aprendizagem de porções no servidor), `food/barcode/[ean]` e `cron/daily` (fecho do dia). Os restantes chegam nos marcos respetivos.

| Endpoint | Método | Descrição |
| --- | --- | --- |
| `/api/meal/parse-text` | POST | Haiku, temperatura 0. Texto shorthand + top 100 foods pessoais por `use_count`. Devolve `{items[], confidence, questions[]}`. |
| `/api/meal/parse-photo` | POST | Sonnet. Foto (Supabase Storage) + texto opcional. Mesmo JSON + `assumed_portions`. |
| `/api/meal/save` | POST | Grava a refeição confirmada: valida com Zod, calcula dia nutricional (regra 1) e totais no servidor. |
| `/api/plan/generate` | POST | Sonnet. Profile + constraints + exercise_catalog (`knee_safe = true`) + capítulo + histórico de 8 semanas. Bloco de 4 semanas, semana 4 é deload. |
| `/api/strava/auth` | GET | OAuth, scope `activity:read_all`. |
| `/api/strava/callback` | GET | Guarda tokens; refresh automático quando `expires_at < now + 5 min`. |
| `/api/strava/webhook` | GET/POST | GET: validação (`hub.challenge` + `STRAVA_VERIFY_TOKEN`). POST: eventos create/update/delete → GET `/activities/{id}` → upsert em `workouts`, idempotente por `strava_id`. |
| `/api/food/barcode/[ean]` | GET | Proxy ao Open Food Facts (User-Agent identificado), guarda em `foods` com source `off`. |
| `/api/health/daily` | POST | Bearer `HEALTH_INGEST_TOKEN`. Passos, sono, FC em repouso (Atalho iOS). |
| `/api/calendar` | GET | Feed .ics das `planned_sessions` (`?token=ICS_TOKEN`). |
| `/api/cron/daily` | — | 04:30 UTC: fecha o dia, calcula adaptativo, reconcilia Strava (48 h) e, à segunda, gera o review semanal. |

Regras: Anthropic SDK só aqui; JSON estrito validado com Zod; retry 1x; tudo registado em `api_calls`. As regras de negócio da secção 5 vivem em `/api/_lib/rules` como funções puras, testadas em `/tests`.
