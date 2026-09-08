# Registo de decisões

## 2026-09-08 — Proposta de schema e estrutura

1. **`chapters.order` → `order_index`.** `order` é palavra reservada em SQL e obrigaria a aspas em todas as queries.
2. **Exercícios excluídos ficam no catálogo com `knee_safe = false`.** A spec pede "excluídos por defeito" e ao mesmo tempo que o catálogo seja a única fonte para o Claude. Com esta forma, a exclusão fica documentada na base de dados e a geração de planos filtra `knee_safe = true`. Os `rep_min`/`rep_max` semeados são rascunho a validar (idealmente com fisio), como a secção 11 pede.
3. **FK circular `workouts` ↔ `planned_sessions`.** A spec pede referências nas duas direções; `workouts` é criada primeiro sem a FK, que é adicionada por `alter table` depois de `planned_sessions` existir. Mantêm-se as duas colunas por conveniência de leitura; o emparelhamento escreve sempre ambas.
4. **`strava_tokens`: RLS ativa sem nenhuma política.** Mais restrito do que "filtrado por user_id", de propósito: o cliente nunca deve ler tokens; só o servidor (service role, que ignora RLS) toca nesta tabela.
5. **`api_calls`: o dono pode ler (ver custos), só o servidor escreve.**
6. **`meals.date` guarda o dia nutricional já calculado** (04:00–04:00 locais), no servidor — nunca no cliente, porque regras de negócio não vivem no cliente. A fila offline guarda `logged_at`; o servidor deriva `date` no sync.
7. **Cron às 04:30 UTC.** Fica sempre depois das 04:00 locais de Lisboa (04:30 no inverno, 05:30 no verão), por isso o fecho do dia nutricional nunca depende do DST. Vercel Hobby só permite uma cron diária, e as crons do Vercel são definidas em UTC.
8. **Tipos numéricos:** kcal como `integer` nos agregados (`days`), com 1 decimal nas refeições; macros com 1 decimal; peso com 2 decimais; `confidence` 0–1 com 2 decimais; `cost_usd` com 5 decimais.
9. **Seeds assumem a conta de Auth já criada** (utilizador único: usam o primeiro registo de `auth.users` e falham com mensagem clara se não existir). São idempotentes (`on conflict do nothing`).
10. **`plan_blocks.status`:** `draft | active | completed | cancelled`. **`planned_sessions.day_index`:** 0 = segunda-feira. **`planned_sessions.type`** alinhado com `workouts.type` (`bike | strength | other`).
11. **Env vars do cliente com prefixo `VITE_`** (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`): o Vite só expõe ao browser variáveis com esse prefixo, o que também protege contra fugas acidentais das restantes.
12. **Capítulo 0:** `title = "Prólogo"`, com "A lesão no início não decide o fim" em `theme`, para o cartaz poder mostrar título e lema separados.
13. **Modelos Claude:** Haiku 4.5 para texto, Sonnet 5 para foto/plano/review, como na spec. Os IDs exatos confirmam-se em docs.claude.com quando se escrever o código de `/api` (M1), como a própria spec pede; até lá não ficam fixados em lado nenhum.
14. **Validação:** a migration e os seeds foram corridos contra Postgres 16 local com um shim do schema `auth` do Supabase (tabela `auth.users`, função `auth.uid()`, roles `authenticated`/`anon`); re-execução dos seeds confirmada como no-op.

### Em aberto (a confirmar na revisão da proposta)

- ~~Os `rep_min`/`rep_max` e os `pattern` do catálogo de exercícios~~ → confirmado a 2026-09-08, ver abaixo.
- ~~O seed de `profile.equipment`~~ → confirmado a 2026-09-08, ver abaixo.
- Buckets do Storage (`meal-photos`, `chapter-photos`): proposta para migration própria no M1, junto com as políticas de acesso.

## 2026-09-08 — Confirmação da proposta (respostas do João)

15. **Séries de 8–12 em todos os exercícios com repetições** — é o intervalo que o João prefere. Aplicado a todo o catálogo (banda incluída, com tensão a compensar); a validação com fisio continua pendente, como antes.
16. **Equipamento:** em casa, bicicleta **estática** (não rolo), halteres, bandas elásticas e banco; **há ginásio disponível e o João quer ir**. `profile.equipment` passa a `{casa: [...], ginasio: true}`. Exercícios de máquinas de ginásio entram no catálogo no M4, quando a geração de planos chegar — sempre dentro das regras do joelho.
17. **Proposta de schema e estrutura confirmada** — arranca o M1.

## 2026-09-08 — M1

18. **Modelos fixados** depois de confirmar os IDs na referência atual da API: `claude-haiku-4-5` (texto) e `claude-sonnet-5` (foto). O Sonnet 5 já não aceita `temperature`, por isso o parse de foto vai sem ela; o de texto usa `temperature: 0` no Haiku, como a spec pede. Preços por token em `api/_lib/anthropic.ts` para calcular `cost_usd`.
19. **JSON estrito** com structured outputs (`output_config.format` + `zodOutputFormat`), que valida com os schemas Zod de `api/_lib/schemas.ts`; retry 1x quando o parse falha; tudo registado em `api_calls` mesmo quando falha.
20. **Fonte única das regras:** as regras da secção 5 vivem em `api/_lib/rules` como funções puras, testadas em `/tests`. O cliente importa a função do dia nutricional só para saber que dia consultar; quem escreve (`/api/meal/save`) recalcula sempre a data e os totais no servidor.
21. **Fotos:** redimensionadas no cliente para JPEG máx. 1600 px antes do upload (menos tokens, menos dados móveis, formato sempre aceite). Bucket `meal-photos` privado com caminho `<user_id>/...`; o parse valida que o caminho pertence ao utilizador autenticado porque o download usa service role.
22. **Ícones PWA em PNG** gerados a partir dos SVG (o iOS não aceita SVG no `apple-touch-icon`, e o telemóvel alvo é um iPhone). Os SVG ficam como fonte.
23. **PIN no cliente** (SHA-256 com salt em localStorage, rebloqueio ao fim de 5 min em segundo plano) é conveniência de ecrã, não segurança — a segurança é o Supabase Auth + RLS.
24. **Sem fila offline no M1** (é M2): se a rede falhar, o erro fica visível e o texto não se perde do ecrã.
