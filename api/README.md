# /api — funções serverless (Vercel)

6 funções: `meal`, `workout`, `day`, `health/daily`, `cron/daily` e `cron/lembretes` (o Hobby aceita 12; `tests/guardas.test.ts` falha acima de 10). Os routers `meal`, `workout` e `day` despacham por `?action=`, e os caminhos públicos mantêm-se por rewrites no `vercel.json`. As funções correm como ES modules: imports relativos com `.js`. O export CSV gera-se no cliente (Definições). A integração por API do Strava está em `/archive/strava` (exige subscrição paga) e o plano de 4 semanas com o calendário em `/archive/plano`.

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
| `/api/meal/menu` | POST | «Escolher pelo menu»: 1 a 3 fotos do menu (JPEG já no Storage, em `<user>/menu/`; apagam-se depois de lidas) e preferências opcionais; o modelo das fotos estima cada prato (`prompts/menu-pick.v1.md`), `rules/menu.ts` arruma e ordena pelo que falta comer hoje (calorias e proteína). Não grava: «Vou comer este» usa `/api/meal/save`. Conta para o limite diário de fotos. |
| `/api/meal/attach` | POST | Junta até 4 fotos a uma refeição que já existe e volta a analisá-la com todas. |
| `/api/meal/people` | GET | As outras pessoas da app (nomes do `user_metadata`), para «Partilhar com …». |
| `/api/meal/share` | POST | Copia uma refeição para a conta de outra pessoa no mesmo dia, refeição e hora, com as fotos copiadas para a pasta dela. |
| `/api/workout/save` | POST | Guarda um treino (favorito, «Já fiz» ou rascunho de um print), com a cadeia de watts e as kcal da regra 2 revista; com `merge_into` junta o print a uma sessão existente sem duplicar. |
| `/api/workout/strength` | POST | Sessão de ginásio livre: cria ou corrige a sessão e as séries (`exercise_log`). |
| `/api/workout/shot` · `shot-add` · `parse-shot` · `discard` | POST | Print do relógio: rascunho em `workout_imports`, leitura em segundo plano (Sonnet 5), outra tentativa e descartar. O mesmo print outra vez devolve o treino. |
| `/api/workout/update` · `delete` · `restore` | POST | Editar (recalcula as kcal desse treino), apagar e repor. |
| `/api/workout/checkin` | POST | Dados da consola (watts, batimentos, cadência) de um treino. A dor já não é pedida. |
| `/api/workout/parse-said` | POST | «Dizer o treino»: texto ou áudio (WAV, só com o Gemini) → campos do registo, com os nomes dos exercícios que a pessoa já usa. Não grava. |
| `/api/workout/plan-week` | POST | Plano da semana pela IA com os dados do relógio (desligado na app, o código fica). |
| `/api/workout/connect` · `sync` · `disconnect` | POST | intervals.icu (relógio Garmin): valida e guarda a chave só no servidor (`integrations`, RLS sem políticas), sincroniza atividades e bem-estar (3 dias ao abrir a app, 30 a pedido) e desliga. A cron sincroniza os últimos 3 dias antes de fechar os dias (máx. 8 s). |
| `/api/day/recompute` | POST | Recalcula os dias desde `from` até ontem, por ordem, em blocos de 30 (`next` diz onde continuar). |
| `/api/day/health` | GET | Estado do deploy (`?token=CRON_SECRET`; fechado sem ela): env vars presentes (nunca valores), prompts, Supabase, migrações 1, 2 e 4 e se a chave da IA em uso (Gemini ou Claude) chega aos dois modelos. |
| `/api/day/ai-check` | POST | «Verificar a IA» (Avançado): uma chamada mínima a cada modelo, com o motivo de cada falha. |
| `/api/day/ai-usage` | GET | Pedidos à IA hoje, da casa e da pessoa (com as fotos à parte), e que IA está em uso. Com o Gemini a quota é da casa e não há euros. |
| `/api/day/evolution` | POST | Corpo › Evolução: a IA analisa peso, medidas, comida, treino e relógio; uma análise por dia em `weekly_reviews` (`evolucao`). |
| `/api/day/add-person` · `create-profile` | POST | Criar a conta de outra pessoa com o perfil dela (máx. 4), e o perfil de uma conta criada no painel do Supabase. |
| `/api/day/ingest-token` | GET | O endereço e o token pessoal do Atalho do iPhone de quem tem a sessão. |
| `/api/day/push-key` | GET | A chave pública das notificações (VAPID). Das env vars `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` ou, sem elas, criada na primeira vez e guardada em `app_secrets` (só o servidor lá chega); nunca se troca. |
| `/api/day/push-subscribe` · `push-unsubscribe` | POST | A subscrição deste telemóvel (endpoint da Apple/Google/Mozilla/Microsoft e chaves) com as notificações escolhidas, em `push_subscriptions`. Uma subscrição é de uma pessoa de cada vez; `check` (ao abrir a app) nunca a tira a outra pessoa. |
| `/api/day/push-test` | POST | Uma notificação de teste para este telemóvel. |
| `/api/health/daily` | POST | Bearer `HEALTH_INGEST_TOKEN` (grava na primeira conta) ou o token pessoal de `/api/day/ingest-token` (grava na conta dessa pessoa). Passos, sono, FC em repouso (Atalho iOS) e, com `body: [{date, weight_kg, body_fat_pct}]`, o peso e a % de gordura da balança (só em dias sem pesagem do João). |
| `/api/cron/daily` | — | Bearer `CRON_SECRET` (fechada sem ela, como todas as crons). 04:30 UTC: marca análises presas como erro; recalcula por ordem os dias marcados pelo trigger `mark_day_dirty` e sempre os últimos 3 (no máximo 21 por noite), com `_lib/close-day.ts`: refeições contadas, fotos por contar, `kcal_est` guardado, macros, pausa da dieta, dia completo, peso médio e gasto medido. À segunda, o review semanal; ao domingo, limpa refeições apagadas há mais de 7 dias e fotos sem dono. |
| `/api/cron/lembretes` | — | 20:45 UTC todos os dias e 08:00 UTC à segunda (no Hobby pode atrasar até ~1 h; decide pela hora de Lisboa). À noite, «Já jantaste?» a quem o ligou, se o dia não está completo (regra 5) e não há jantar; à segunda de manhã, «Resumo da semana pronto» se a cron das 04:30 o fez. A «Refeição analisada» sai do fim da análise em segundo plano (`capture`, `attach`). Apaga as subscrições que o serviço diz que acabaram (404/410). |

Regras: a IA (Gemini pela API REST ou o Claude pelo SDK) só aqui; JSON estrito validado com Zod; sem repetições automáticas do SDK (`maxRetries: 0`) e uma segunda tentativa só se ainda houver tempo dentro dos 60 s; respostas cortadas ou recusadas não contam; tudo registado em `api_calls`. As regras de negócio da secção 5 vivem em `/api/_lib/rules` como funções puras, testadas em `/tests`.
