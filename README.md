# A Época do Regresso

App pessoal de nutrição, treino e peso. Utilizador único. PWA mobile-first, dark mode, interface em PT-PT. Cada bloco de 4 semanas é um capítulo com um patrono que voltou de uma lesão grave.

**Estado atual: M1–M6 completos e em produção; em curso o redesenho para centro de fitness** ([plano](docs/redesenho-2026-09.md)). Fase 0 feita: deploy estável, 7 funções, estado do deploy em `/api/day/health`. Fase 1 feita: casca nova (Hoje · Balanço · (+) · Treino · Corpo), pesagem em 2 toques, favoritos e «Igual a ontem» sem IA. Fase 2 feita: fotos analisadas em segundo plano (sem esperar), galeria com a hora certa, notas, correções por texto, fila sem rede, e juntar fotos a uma refeição que não carregou. Fase 3 feita: Bicicleta habitual em 3 toques com o joelho, «Já fiz», print do Garmin/Strava/consola lido pela IA e junto à sessão sem duplicar, separador Treino novo. Fase 4 feita: medidas com fita (pescoço e cintura), gordura e massa magra com intervalo, cintura alvo e histórico. Design novo («Dia de jogo» no escuro, cores do «Cartaz» no claro) e entrada sem PIN. Migrações 1, 2 e 3 aplicadas no Supabase; **faltam a 4 e a 5** (passo 2b do Setup). As 12 regras de negócio têm todas testes, mais guardas do deploy em `tests/guardas.test.ts`.

## Stack

React + Vite + TypeScript, Tailwind, Recharts, vite-plugin-pwa. Supabase (Postgres, Auth, Storage, RLS). Vercel (frontend, `/api` serverless, 1 cron diária às 04:30 UTC). Anthropic SDK só em `/api`, com Zod a validar todo o JSON do Claude. Timezone Europe/Lisbon em tudo.

## Estrutura de pastas

```
/api                      Funções serverless (Vercel)
  /_lib                   Clientes partilhados (supabase admin, anthropic, mapeamento Strava)
    /rules                Regras de negócio da secção 5, funções puras — testadas em /tests
  meal.ts + /_meal        parse-text, parse-photo, save, barcode (uma função, rewrites no vercel.json)
  workout.ts + /_workout  manual, checkin, session
  day.ts + /_day          health (estado do deploy)
  /plan                   generate.ts
  /health                 daily.ts (Atalho iOS)
  /cron                   daily.ts (fecho do dia, adaptativo, review à segunda)
  calendar.ts             feed .ics
/archive/strava           integração por API do Strava (exige subscrição paga) — fora do deploy
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
   - 2b. **Migrações do redesenho, por ordem:** no Supabase, SQL Editor → New query → colar `supabase/migrations/20260928000000_fase1.sql` → Run; depois o mesmo com `supabase/migrations/20260929000000_fase2.sql`, com `supabase/migrations/20260929120000_fase2_permissoes.sql` (tira à app o acesso à função de limpeza do Storage) com `supabase/migrations/20260930000000_fase3.sql` (treino: prints do relógio, Bicicleta habitual) e com `supabase/migrations/20261001000000_fase4.sql` (medidas). Podem correr-se mais de uma vez; no fim de cada uma aparece uma tabela que tem de vir vazia. Sem elas a app mostra «Falta um passo no Supabase» com os ficheiros em falta.
3. Importar o repo no Vercel. Env vars do projeto: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (só server), `ANTHROPIC_API_KEY`, `CRON_SECRET` (protege a cron das 04:30), e para o cliente `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Em dev local: copiar `.env.example` para `.env`.
4. Abrir o domínio do Vercel no telemóvel e "Adicionar ao ecrã principal" — a PWA instala com o ícone e abre em standalone. No primeiro arranque: login (o iPhone preenche o email e a password); a sessão fica iniciada, sem PIN.
5. Verificar o deploy: abrir `https://a-tua-app.vercel.app/api/day/health?token=<CRON_SECRET>` — diz que variáveis faltam (nunca mostra valores), se os prompts foram incluídos, se o Supabase responde e se a chave da Anthropic chega aos dois modelos. Da linha de comandos: `CRON_SECRET=... node scripts/smoke.mjs https://a-tua-app.vercel.app`.
6. Calendário: no Google Calendar, "Adicionar por URL" com `https://a-tua-app.vercel.app/api/calendar?token=<ICS_TOKEN>` — as sessões planeadas aparecem como eventos de dia inteiro.
7. Saúde (Atalho iOS, todas as noites): POST para `https://a-tua-app.vercel.app/api/health/daily` com header `Authorization: Bearer <HEALTH_INGEST_TOKEN>` e corpo JSON `{"steps": 8500, "sleep_minutes": 430, "resting_hr": 52}` (a data por omissão é o próprio dia).

## Marcos

- **M1** — repo, migrations + RLS + seeds, auth + PIN, PWA shell, Registar (texto e foto → Claude → guardar), Hoje com os dois números, Prólogo (cartaz do Baggio + timeline). Fica a usar-se já.
- **M2** — barcode, foods pessoais com aprendizagem de porções, fila offline, fecho do dia, peso + gráfico.
- **M3** — Strava OAuth + webhook + reconciliação, workouts, check-in de dor, sessão manual.
- **M4** — catálogo, profile de limitações, geração de bloco com capítulo, execução e progressão, abertura e fecho de capítulo, gráficos de treino com anotações.
- **M5** — adaptativo, review semanal em voz de narrador, semana de manutenção, Linha do tempo.
- **M6** — .ics, /api/health/daily, export, páginas de história com fotos CC.
