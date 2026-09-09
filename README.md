# A Época do Regresso

App pessoal de nutrição, treino e peso. Utilizador único. PWA mobile-first, dark mode, interface em PT-PT. Cada bloco de 4 semanas é um capítulo com um patrono que voltou de uma lesão grave.

**Estado atual: M5 implementado e app em produção** — tudo do M1–M4 mais o gasto adaptativo (regra 4) calculado no fecho do dia, a semana de manutenção a cada 6 semanas (regra 7), o review semanal em voz de narrador gerado à segunda-feira, e a página Linha do tempo. Falta o M6: .ics, /api/health/daily, export CSV e as páginas de história com fotos.

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
3. Importar o repo no Vercel. Env vars do projeto: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (só server), `ANTHROPIC_API_KEY`, `CRON_SECRET` (protege a cron das 04:30), e para o cliente `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Em dev local: copiar `.env.example` para `.env`.
4. Abrir o domínio do Vercel no telemóvel e "Adicionar ao ecrã principal" — a PWA instala com o ícone e abre em standalone. No primeiro arranque: login e criação do PIN.
5. Strava (**opcional** — a API do Strava passou a exigir subscrição paga; sem ela, tudo funciona com sessão manual + check-in, que também capta watts, FC média/máxima e cadência). Com subscrição: criar a app em strava.com/settings/api com o callback domain do Vercel, preencher as env vars do Strava, pôr `VITE_STRAVA_ENABLED=true`, tocar em "Ligar ao Strava" no Treino, e criar a subscrição do webhook **uma vez**:
   ```
   STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=... STRAVA_VERIFY_TOKEN=... \
     node scripts/strava-subscribe.mjs create https://a-tua-app.vercel.app
   ```

## Marcos

- **M1** — repo, migrations + RLS + seeds, auth + PIN, PWA shell, Registar (texto e foto → Claude → guardar), Hoje com os dois números, Prólogo (cartaz do Baggio + timeline). Fica a usar-se já.
- **M2** — barcode, foods pessoais com aprendizagem de porções, fila offline, fecho do dia, peso + gráfico.
- **M3** — Strava OAuth + webhook + reconciliação, workouts, check-in de dor, sessão manual.
- **M4** — catálogo, profile de limitações, geração de bloco com capítulo, execução e progressão, abertura e fecho de capítulo, gráficos de treino com anotações.
- **M5** — adaptativo, review semanal em voz de narrador, semana de manutenção, Linha do tempo.
- **M6** — .ics, /api/health/daily, export, páginas de história com fotos CC.
