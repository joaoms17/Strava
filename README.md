# A Época do Regresso

App pessoal de nutrição, treino e peso. Utilizador único. PWA mobile-first, dark mode, interface em PT-PT. Cada bloco de 4 semanas é um capítulo com um patrono que voltou de uma lesão grave.

**Estado atual: proposta de schema e estrutura (secção 14 da spec), à espera de confirmação.** As migrations e os seeds já são reais e testados contra Postgres 16; depois de confirmares, seguem-se os marcos M1 a M6.

## Stack

React + Vite + TypeScript, Tailwind, Recharts, vite-plugin-pwa. Supabase (Postgres, Auth, Storage, RLS). Vercel (frontend, `/api` serverless, 1 cron diária às 04:30 UTC). Anthropic SDK só em `/api`, com Zod a validar todo o JSON do Claude. Timezone Europe/Lisbon em tudo.

## Estrutura de pastas

```
/api                      Funções serverless (Vercel)
  /_lib                   Clientes partilhados (supabase admin, anthropic, strava)
    /rules                Regras de negócio da secção 5, funções puras — testadas em /tests
  /meal                   parse-text.ts, parse-photo.ts
  /plan                   generate.ts
  /strava                 auth.ts, callback.ts, webhook.ts
  /food                   barcode/[ean].ts
  /health                 daily.ts
  /cron                   daily.ts (fecho do dia, adaptativo, reconciliação Strava, review à segunda)
  calendar.ts             feed .ics
/docs
  decisions.md            registo de decisões
/prompts                  prompts versionados: <funcao>.v<N>.md
/src                      App React (PWA)
  /screens                Registar, Hoje, Treino, Graficos + páginas (Capítulo, História, Linha do tempo, Definições)
  /components             cartaz SVG, cartões, gráficos
  /lib                    cliente supabase, fila offline (IndexedDB), formatação — sem regras de negócio
  /types
/supabase
  /migrations             SQL com RLS em todas as tabelas
  /seed                   01_profile.sql, 02_chapters.sql, 03_exercise_catalog.sql
/tests                    testes das regras de negócio (secção 5)
```

As pastas `/api` e `/src` só têm READMEs por agora — o código chega com o M1, depois da confirmação do schema.

## Schema

Fonte de verdade: [`supabase/migrations/20260908000000_initial_schema.sql`](supabase/migrations/20260908000000_initial_schema.sql).

Tabelas: `profile`, `foods`, `meals`, `days`, `weights`, `health_daily`, `workouts`, `exercise_log`, `exercise_catalog`, `chapters`, `plan_blocks`, `planned_sessions`, `strava_tokens`, `weekly_reviews`, `api_calls`. RLS ativa em todas; dados filtrados por `user_id = auth.uid()`; `strava_tokens` sem acesso nenhum do cliente. Desvios em relação ao texto da spec estão justificados em [`docs/decisions.md`](docs/decisions.md).

## Setup

1. Criar projeto no Supabase; criar a conta única em Auth (email + password).
2. Aplicar a migration (`supabase db push` ou SQL editor) e correr os três seeds de `supabase/seed/` por ordem — falham com mensagem clara se a conta ainda não existir; são idempotentes.
3. Copiar `.env.example` para `.env` e preencher. `SUPABASE_SERVICE_ROLE_KEY` só nas env vars do Vercel, nunca no cliente; o cliente usa apenas `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
4. (M3) App Strava já criada em strava.com/settings/api; callback domain: localhost em dev, domínio Vercel em produção. A subscrição do webhook cria-se por script uma vez, depois do deploy.

## Marcos

- **M1** — repo, migrations + RLS + seeds, auth + PIN, PWA shell, Registar (texto e foto → Claude → guardar), Hoje com os dois números, Prólogo (cartaz do Baggio + timeline). Fica a usar-se já.
- **M2** — barcode, foods pessoais com aprendizagem de porções, fila offline, fecho do dia, peso + gráfico.
- **M3** — Strava OAuth + webhook + reconciliação, workouts, check-in de dor, sessão manual.
- **M4** — catálogo, profile de limitações, geração de bloco com capítulo, execução e progressão, abertura e fecho de capítulo, gráficos de treino com anotações.
- **M5** — adaptativo, review semanal em voz de narrador, semana de manutenção, Linha do tempo.
- **M6** — .ics, /api/health/daily, export, páginas de história com fotos CC.
