# /api — funções serverless (Vercel)

7 funções (o Hobby aceita 12; `tests/guardas.test.ts` falha acima de 10). Os routers `meal`, `workout` e `day` despacham por `?action=`, e os caminhos públicos mantêm-se por rewrites no `vercel.json`. As funções correm como ES modules: imports relativos com `.js`. O export CSV gera-se no cliente (Definições). A integração por API do Strava está em `/archive/strava` (exige subscrição paga).

| Endpoint | Método | Descrição |
| --- | --- | --- |
| `/api/meal/capture` | POST | Captura sem espera (foto e/ou texto, nota, marcas, hora conhecida ou dia e momento): cria a refeição em `a_analisar`, responde 202 e analisa em segundo plano (`waitUntil`). Idempotente pelo `client_id`; a mesma foto (SHA-256) devolve a que já existe. Acima dos limites da IA fica `sem_analise`. |
| `/api/meal/analyse` | POST | Outra tentativa com lease (`claim_meal_analysis`); `reset` para «Tentar de novo» e «Reanalisar foto», `force` para analisar acima do limite. |
| `/api/meal/correct` | POST | «Corrigir por texto»: Haiku sobre os itens atuais, sem foto; devolve os itens anteriores para Anular. |
| `/api/meal/update` | POST | Itens (passos de 10 g), dia e momento, nota (corrige se a análise já acabou), marcas, confirmar e anular a confirmação. |
| `/api/meal/quick` | POST | Só números, com item sintético «Registo rápido». |
| `/api/meal/parse-text` | POST | (Fluxo antigo, só para esvaziar a fila da Fase 1.) Haiku, temperatura 0. Texto shorthand + top 100 foods pessoais por `use_count`. Devolve `{items[], confidence, questions[]}`. |
| `/api/meal/parse-photo` | POST | (Fluxo antigo.) Sonnet, sem thinking. Foto (Supabase Storage) + texto opcional. Mesmo JSON + `assumed_portions`. |
| `/api/meal/save` | POST | Grava a refeição confirmada: valida com Zod, calcula dia nutricional (regra 1) e totais no servidor. |
| `/api/meal/log-favorite` | POST | Favorito com 1 toque, sem IA: itens × porção, dia nutricional e totais no servidor; num dia passado usa a hora habitual do momento. |
| `/api/meal/repeat` | POST | «Igual a ontem», «Repetir hoje» e «Copiar para outro dia». |
| `/api/meal/portion` | POST | Muda a porção (½ · 1 · 1½ · 2) de uma refeição já registada. |
| `/api/meal/delete` · `/api/meal/restore` | POST | Apagar reversível (`deleted_at`); a refeição sai das contas e pode voltar. |
| `/api/food/barcode/:ean` | GET | Proxy ao Open Food Facts (User-Agent identificado), guarda em `foods` com source `off`. Vive na função `meal`. |
| `/api/workout/manual` | POST | Sessão manual; `kcal_est` calculado ao gravar (regra 2, com METs líquidos para caminhada, elíptica, natação e outro). |
| `/api/workout/checkin` | POST | Semáforo de dor (durante / dia seguinte) e dados da consola. |
| `/api/workout/session` | POST | Séries da sessão de força. |
| `/api/plan/generate` | POST | Sonnet, sem thinking. Bloco de 4 semanas, semana 4 é deload. |
| `/api/day/recompute` | POST | Recalcula os dias desde `from` até ontem, por ordem, em blocos de 30 (`next` diz onde continuar). |
| `/api/day/health` | GET | Estado do deploy (`?token=CRON_SECRET`): env vars presentes (nunca valores), prompts, Supabase, migração 1 e acesso aos modelos da Anthropic. |
| `/api/health/daily` | POST | Bearer `HEALTH_INGEST_TOKEN`. Passos, sono, FC em repouso (Atalho iOS). |
| `/api/calendar` | GET | Feed .ics das `planned_sessions` (`?token=ICS_TOKEN`). |
| `/api/cron/daily` | — | 04:30 UTC: marca análises presas como erro; recalcula por ordem os dias marcados pelo trigger `mark_day_dirty` e sempre os últimos 3 (no máximo 21 por noite), com `_lib/close-day.ts`: refeições contadas, fotos por contar, `kcal_est` guardado, macros, pausa da dieta, dia completo, peso médio e gasto medido. À segunda, o review semanal; ao domingo, limpa refeições apagadas há mais de 7 dias e fotos sem dono. |

Regras: Anthropic SDK só aqui; JSON estrito validado com Zod; sem repetições automáticas do SDK (`maxRetries: 0`) e uma segunda tentativa só se ainda houver tempo dentro dos 60 s; respostas cortadas ou recusadas não contam; tudo registado em `api_calls`. As regras de negócio da secção 5 vivem em `/api/_lib/rules` como funções puras, testadas em `/tests`.
