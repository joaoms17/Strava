# Daily Track

App pessoal para registar o dia: comida, treino, peso e sono. Utilizador único. PWA mobile-first, interface em PT-PT. (Começou como «A Época do Regresso»; os capítulos antigos ficam no Arquivo.)

**Estado atual: M1–M6 completos e em produção; em curso o redesenho para centro de fitness** ([plano](docs/redesenho-2026-09.md)). Fase 0 feita: deploy estável, estado do deploy, estado do deploy em `/api/day/health`. Fase 1 feita: casca nova (Hoje · Balanço · (+) · Treino · Corpo), pesagem em 2 toques, favoritos e «Igual a ontem» sem IA. Fase 2 feita: fotos analisadas em segundo plano (sem esperar), galeria com a hora certa, notas, correções por texto, fila sem rede, e juntar fotos a uma refeição que não carregou. Fase 3 feita: Bicicleta habitual em 3 toques com o joelho, «Já fiz», print do Garmin/Strava/consola lido pela IA e junto à sessão sem duplicar, separador Treino novo. Fase 4 feita: medidas com fita (pescoço e cintura), gordura e massa magra com intervalo, cintura alvo e histórico. Fase 5 feita: ginásio livre (8–12 repetições com as cargas da última vez, favoritos «Pernas A» e «Corpo todo B»); o plano de 4 semanas e o calendário foram arquivados e ficam 5 funções. Fase 6 feita: Balanço completo (comer contra gasto numa frase, «Bate certo», linha do gasto, resumo neutro da semana, gasto medido contra a fórmula, sugestão de plano base) e «Gastas cerca de … hoje» na folha do plano. Fase 7 feita: treinos do Garmin entram sozinhos pelo intervals.icu (Definições › Ligações), juntando-se à Bicicleta habitual ou ao print sem duplicar. Extras: Balanço › Mês com os 10 alimentos mais frequentes, «Juntar outro print» a um rascunho, imagens dos prints apagadas aos 90 dias e o peso da balança pelo Atalho do iPhone. Design novo («Dia de jogo» no escuro, cores do «Cartaz» no claro) e entrada sem PIN. Migrações 1, 2 e 3 aplicadas no Supabase; **faltam da 4 à 8** (passo 2b do Setup). As 12 regras de negócio têm todas testes, mais guardas do deploy em `tests/guardas.test.ts`.

## Stack

React + Vite + TypeScript, Tailwind, Recharts, vite-plugin-pwa. Supabase (Postgres, Auth, Storage, RLS). Vercel (frontend, `/api` serverless, 1 cron diária às 04:30 UTC). Anthropic SDK só em `/api`, com Zod a validar todo o JSON do Claude. Timezone Europe/Lisbon em tudo.

## Estrutura de pastas

```
/api                      Funções serverless (Vercel)
  /_lib                   Clientes partilhados (supabase admin, anthropic, mapeamento Strava)
    /rules                Regras de negócio da secção 5, funções puras — testadas em /tests
  meal.ts + /_meal        captura, análise, correções, favoritos, código de barras (uma função, rewrites no vercel.json)
  workout.ts + /_workout  save, strength, prints do relógio, update, delete, checkin
  day.ts + /_day          health (estado do deploy), recompute
  /health                 daily.ts (Atalho iOS)
  /cron                   daily.ts (fecho do dia, adaptativo, review à segunda)
/archive/strava           integração por API do Strava (exige subscrição paga) — fora do deploy
/archive/plano            plano de 4 semanas gerado pela IA e calendário .ics (saíram na Fase 5)
/docs
  decisions.md            registo de decisões
/prompts                  prompts versionados: <funcao>.v<N>.md
/src                      App React (PWA)
  /screens                Hoje, Balanço, Treino, Corpo, Favoritos, Registar, Definições (+ Avançado, Arquivo)
  /components             folhas (+, peso, refeição), ui (folha inferior, joelho, barras, faixa da semana), gráficos
  /lib                    cliente supabase, perfil, tema, avisos com Anular, fila offline — sem regras de negócio
  /types
/supabase
  /migrations             SQL com RLS em todas as tabelas
  /seed                   01_profile.sql, 02_chapters.sql, 03_exercise_catalog.sql
/tests                    testes das regras de negócio (secção 5)
```

## Comandos

```
npm install        # dependências
npm run dev        # dev server (Vite)
npm run build      # build de produção (inclui PWA/service worker)
npm run test       # testes das regras de negócio (Vitest)
npm run typecheck  # TypeScript
```

## Schema

Fonte de verdade: [`supabase/migrations/20260908000000_initial_schema.sql`](supabase/migrations/20260908000000_initial_schema.sql).

Tabelas: `profile`, `foods`, `meals`, `days`, `weights`, `health_daily`, `workouts`, `exercise_log`, `exercise_catalog`, `chapters`, `plan_blocks`, `planned_sessions`, `strava_tokens`, `weekly_reviews`, `api_calls`. RLS ativa em todas; dados filtrados por `user_id = auth.uid()`; `strava_tokens` sem acesso nenhum do cliente. Desvios em relação ao texto da spec estão justificados em [`docs/decisions.md`](docs/decisions.md).

## Setup

1. Criar projeto no Supabase; criar a conta única em Auth (email + password).
2. Aplicar as migrations de `supabase/migrations/` por ordem (`supabase db push` ou SQL editor) e correr os três seeds de `supabase/seed/` por ordem — falham com mensagem clara se a conta ainda não existir; são idempotentes.
   - 2b. **Migrações do redesenho, por ordem:** no Supabase, SQL Editor → New query → colar `supabase/migrations/20260928000000_fase1.sql` → Run; depois o mesmo com `supabase/migrations/20260929000000_fase2.sql`, com `supabase/migrations/20260929120000_fase2_permissoes.sql` (tira à app o acesso à função de limpeza do Storage) com `supabase/migrations/20260930000000_fase3.sql` (treino: prints do relógio, Bicicleta habitual) e com `supabase/migrations/20261001000000_fase4.sql` (medidas) com `supabase/migrations/20261002000000_fase5.sql` (favoritos de ginásio) com `supabase/migrations/20261003000000_fase6.sql` (gasto e resumo da semana) com `supabase/migrations/20261004000000_fase7.sql` (intervals.icu) e com `supabase/migrations/20261005000000_sono.sql` (pontuação do sono, HRV). Podem correr-se mais de uma vez; no fim de cada uma aparece uma tabela que tem de vir vazia. Sem elas a app mostra «Falta um passo no Supabase» com os ficheiros em falta.
3. Importar o repo no Vercel. Env vars do projeto: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (só server), a chave da IA — `GEMINI_API_KEY` (Gemini, plano gratuito: criar em aistudio.google.com › Get API key) **ou** `ANTHROPIC_API_KEY` (Claude, pago) —, `CRON_SECRET` (protege a cron das 04:30), e para o cliente `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Em dev local: copiar `.env.example` para `.env`.
3b. **Recuperar a palavra-passe:** no Supabase, Authentication → URL Configuration → Site URL = `https://a-tua-app.vercel.app` e, em Redirect URLs, `https://a-tua-app.vercel.app/**`. Sem isto, o link do email «Esqueci-me da palavra-passe» abre `localhost`. O email sai pelo serviço do Supabase (poucos por hora; vê no lixo/spam).
4. Abrir o domínio do Vercel no telemóvel e "Adicionar ao ecrã principal" — a PWA instala com o ícone e abre em standalone. No primeiro arranque: login (o iPhone preenche o email e a password); a sessão fica iniciada, sem PIN.
5. Verificar o deploy: abrir `https://a-tua-app.vercel.app/api/day/health?token=<CRON_SECRET>` — diz que variáveis faltam (nunca mostra valores), se os prompts foram incluídos, se o Supabase responde e se a chave da IA em uso chega aos dois modelos. Na app, Definições › Avançado › «Verificar a IA» faz uma chamada mínima a cada modelo e diz o que está mal. Da linha de comandos: `CRON_SECRET=... node scripts/smoke.mjs https://a-tua-app.vercel.app`.
6. (O calendário .ics saiu na Fase 5, com o plano de 4 semanas.)
7. Saúde (Atalho iOS, todas as noites): POST para `https://a-tua-app.vercel.app/api/health/daily` com header `Authorization: Bearer <HEALTH_INGEST_TOKEN>` e corpo JSON `{"steps": 8500, "sleep_minutes": 430, "resting_hr": 52}` (a data por omissão é o próprio dia).

## Marcos

- **M1** — repo, migrations + RLS + seeds, auth + PIN, PWA shell, Registar (texto e foto → Claude → guardar), Hoje com os dois números, Prólogo (cartaz do Baggio + timeline). Fica a usar-se já.
- **M2** — barcode, foods pessoais com aprendizagem de porções, fila offline, fecho do dia, peso + gráfico.
- **M3** — Strava OAuth + webhook + reconciliação, workouts, check-in de dor, sessão manual.
- **M4** — catálogo, profile de limitações, geração de bloco com capítulo, execução e progressão, abertura e fecho de capítulo, gráficos de treino com anotações.
- **M5** — adaptativo, review semanal em voz de narrador, semana de manutenção, Linha do tempo.
- **M6** — .ics, /api/health/daily, export, páginas de história com fotos CC.
