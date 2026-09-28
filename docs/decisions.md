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

## 2026-09-09 — M2

25. **Barcode:** `BarcodeDetector` nativo quando o browser o tem; senão ZXing por import dinâmico (chunk separado); e há sempre o campo manual para escrever o EAN. O endpoint devolve primeiro o alimento pessoal (por barcode) antes de ir ao Open Food Facts; o User-Agent identifica a app com o URL do repositório, sem dados pessoais.
26. **Aprendizagem de porções:** ao guardar, itens com `food_id` fazem `use_count + 1` e a porção habitual aproxima-se do usado (EMA α 0,3). Alimentos novos só nascem de registos de **texto não estimados** — a fotografia não cria alimentos (as estimativas poluíam a biblioteca); o barcode entra com source `off` no primeiro scan.
27. **Fila offline (IndexedDB) só para texto.** Guarda o `logged_at` original e o `/api/meal/save` passa a aceitar `logged_at` (nunca no futuro) para a refeição contar para o dia nutricional certo. Sincroniza ao abrir a app e quando a rede volta. Fotos ficam de fora: o upload precisa de rede de qualquer maneira.
28. **Cron protegida com `CRON_SECRET`** (o Vercel envia `Authorization: Bearer` quando a env var existe). Cada corrida fecha os últimos 3 dias nutricionais — idempotente, cobre corridas falhadas.
29. **"Fechar o dia" no cliente só escreve a marca `dia_fechado`** (e o estado imediato); a cron recalcula tudo o resto e preserva a marca. As regras continuam no servidor.
30. **Gráficos é um ecrã lazy** (o recharts fica num chunk próprio). No gráfico de peso, a identidade das camadas vem da forma — pontos (pesagens), linha cheia (média 7 dias), tracejado (projeção) — nunca só da cor.
31. **Open Food Facts não é testável a partir deste ambiente** (a rede do sandbox bloqueia o domínio); o endpoint está defensivo e valida-se no primeiro deploy.

## 2026-09-09 — M3

32. **OAuth Strava:** `/api/strava/auth` é navegação de página inteira (sem header de sessão), com CSRF coberto por um `state` em cookie HttpOnly verificado no callback. Os tokens nunca saem do servidor (`strava_tokens` continua sem políticas RLS) e pertencem ao utilizador único do perfil.
33. **Mapeamento de atividades:** bike usa `moving_time`; força e outros usam `elapsed_time` (na musculação o moving_time do Strava é enganador). `kcal_est` calcula-se sempre pela regra 2 no upsert — nunca as calorias do relógio para bike/força. O upsert é idempotente por `strava_id` e só escreve campos vindos do Strava: um update de atividade nunca toca na dor, no semáforo nem no emparelhamento.
34. **Emparelhamento com `planned_sessions` fica para o M4** — as sessões planeadas só nascem com a geração de blocos, e a data delas deriva de `block.start_date` + semana + dia.
35. **Check-in (regra 9) no Hoje:** dor 0-10 pós-sessão para os treinos de hoje e "manhã seguinte" para os de ontem. Uma sessão de bike sem watts (rolo sem potenciómetro) pede a confirmação dos watts no mesmo cartão; o servidor recalcula o semáforo e as kcal.
36. **Meta de hoje ao vivo:** o Hoje calcula `base_kcal` + regra 2 sobre os workouts do próprio dia (funções partilhadas testadas); a cron continua a ser a fonte para os dias fechados.
37. **Webhook:** responde 200 a atletas desconhecidos e eventos de atleta (para o Strava não reenviar ao infinito) e 500 em falhas transitórias (para haver retry); a reconciliação diária das últimas 48 h na cron apanha o que o webhook perder. A subscrição cria-se uma vez com `scripts/strava-subscribe.mjs`.

## 2026-09-09 — M4

38. **Regra 10, tempo primeiro:** a subida de watts exige as 2 sessões verdes dentro dos caps **e** os 60 min já feitos ao W atual — a spec diz "só quando" (condição necessária), e primeiro construir o tempo é o mais seguro para o joelho e o mais fiel ao tema do bloco 1. Semáforo amarelo/vermelho na última sessão → bike leve (W mais baixo, 30 min).
39. **Geração do bloco (Sonnet 5, JSON estrito):** o servidor valida além do schema — 4 semanas, exercícios só do catálogo `knee_safe`, sessões coerentes e **deload verificado** (séries da semana 4 ≤ 70% da semana 3). Plano rejeitado → segunda tentativa com os erros concretos; ao falhar duas vezes, 422. O alvo de bike enviado ao Claude é o calculado pelas regras da app (a regra 10 não se delega ao modelo).
40. **Capítulo do bloco:** por omissão, o primeiro capítulo ainda sem bloco (o Prólogo é o primeiro); `chapter_id` no corpo permite escolher. `start_date` é a segunda-feira seguinte (ou a própria, se for segunda). Um bloco ativo bloqueia nova geração sem `force` (que cancela o anterior).
41. **Emparelhamento (spec §7):** workout ↔ planned_session do mesmo tipo a ±1 dia, a mais próxima primeiro; nunca falha o registo do treino. A data da sessão deriva de `start_date + (semana-1)×7 + day_index` (0 = segunda). A cron marca blocos com 4 semanas passadas como `completed` e as sessões por fazer como `skipped`.
42. **Sugestões no cliente com as regras partilhadas** (como as decisões 20/36): o "+2 kg" (regra 11) e o próximo alvo de bike calculam-se no ecrã com as funções puras testadas; as escritas continuam todas no servidor.
43. **Página Capítulo substitui a página Prólogo:** mostra o capítulo do bloco atual (cartaz + missão em números do plano + estado), o fecho com os números do bloco ao lado dos factos quando termina, e a linha do tempo. Sem bloco, mostra o capítulo 0.
44. **Interface de Definições (perfil, catálogo, export) fica para o M6**, junto do export CSV — até lá, ajustes ao catálogo fazem-se no Supabase.

## 2026-09-09 — Strava sem subscrição

45. **A API do Strava passou a exigir subscrição paga e o João não é subscritor.** A integração fica no código, intacta e pronta (OAuth, webhook, reconciliação), mas desligada: o botão "Ligar ao Strava" só aparece com `VITE_STRAVA_ENABLED=true`, e as env vars do Strava passam a opcionais. Sem tokens, a reconciliação da cron é um no-op. Se um dia houver subscrição, é ligar a flag e correr o script do webhook.
46. **O check-in pós-sessão de bike passa a captar watts, FC média, FC máxima e cadência** (da consola da bicicleta ou de um relógio), porque sem Strava era impossível alimentar a regra 10 (caps de FC para subir de W). Os campos só aparecem quando faltam e são opcionais — a dor continua a ser o único obrigatório. Alternativa futura (M6+): um Atalho iOS a enviar treinos do Apple Health para um endpoint próprio, na linha do /api/health/daily.

## 2026-09-10 — M5

47. **Regra 4, n_dias:** a média de kcal é sobre os dias completos (até 14), mas o `n_dias` da fórmula é o intervalo de **calendário** entre a primeira e a última tendência da janela — o peso muda em dias de calendário, não só nos dias com registo completo. Sem pelo menos 10 dias completos ou sem duas tendências em datas diferentes, não há estimativa.
48. **EMA do tdee por dia fechado:** cada fecho suaviza sobre a estimativa do dia anterior (α 0,3); como a cron fecha os 3 últimos dias por ordem, a série mantém-se coerente mesmo com corridas falhadas.
49. **Regra 7, âncora:** as semanas contam-se em semanas de calendário (segunda a domingo) desde a semana do **primeiro dia registado** (`min(days.date)`); a 6.ª semana de cada ciclo (índices 5, 11, 17…) é manutenção. Dias de manutenção levam a flag `manutencao` e a meta é o último `tdee_est` (ou 2000); no Hoje a meta fica fixa (sem soma do exercício — o tdee já inclui atividade).
50. **Review semanal:** gerado na cron quando o dia nutricional atual é segunda-feira, para a semana anterior; idempotente por `(user_id, week_start)`; Sonnet com JSON estrito `{text}` e 5 linhas impostas pelo prompt; a matéria-prima da semana fica guardada em `weekly_reviews.data`. Sem dados na semana, não se escreve review. Mostrado no topo dos Gráficos.
51. **Proposta de ajuste do base_kcal** (diferença > 250 kcal entre tdee_est e expected_tdee) aparece no cartão do gasto adaptativo nos Gráficos — a alteração em si é manual até a página de Definições chegar (M6).
52. **Linha do tempo:** página própria (a partir do Capítulo) com a linha do João e, por patrono, a queda (primeiro facto) e o regresso (último facto) — sem inventar nada, só os factos do seed.

## 2026-09-10 — M6

53. **Feed .ics** em `/api/calendar?token=ICS_TOKEN` (token na query — os calendários não mandam headers): eventos de dia inteiro por planned_session, com alvo de bike ou lista de exercícios na descrição e "✓ feita" nas concluídas. Formato testado (CRLF, escaping, DTSTART;VALUE=DATE).
54. **`/api/health/daily`** com Bearer `HEALTH_INGEST_TOKEN`, upsert por (user, date), data por omissão = hoje em Lisboa. Feito para um Atalho iOS correr todas as noites.
55. **Export CSV no cliente:** os dados são do próprio utilizador (RLS), por isso o CSV gera-se no browser (aspas/vírgulas/objetos escapados, BOM para o Excel) — sem endpoint novo nem headers em links.
56. **Fotos dos capítulos** num bucket público `chapter-photos` (imagens CC do Wikimedia, nada sensível), escrita só autenticada; upload nas Definições com redimensionamento no cliente e crédito obrigatório por cortesia (campo próprio, mostrado na página do capítulo). **Migration nova a correr no Supabase.**
57. **Regra 12 extraída para `rules/estimativas.ts`** e usada pelos endpoints — com isto, as 12 regras da secção 5 têm todas função pura + testes. Definições fecha o M6: perfil, linha do tempo, catálogo (knee_safe + ranges), fotos, export, PIN e sessão.

## 2026-09-10 — Lições do primeiro deploy real

58. **Vercel Hobby: máximo 12 funções por deploy** — os endpoints vivem consolidados em 8 funções (meal, workout e strava com dispatch interno + rewrites que preservam os caminhos). **As funções correm como ES modules**, por isso todos os imports relativos em `/api` levam extensão `.js` (o Node exige; o tsc, o Vite e o vitest resolvem `.js` → `.ts` sem problema). `maxDuration: 60` para as chamadas ao Sonnet. E o `SUPABASE_URL` normaliza-se para a origem nos dois lados, porque URLs colados trazem lixo.

## 2026-09-28 — Redesenho: de treinador com história a centro de fitness

59. **Novos requisitos do João:** fotos de comida ao longo do dia com uma nota e refeições favoritas; treino por integração ou por print do Garmin/Strava; peso diário e medidas para gordura e massa magra; a app como centro de fitness que acompanha o que entra e o que sai, com UX/UI muito melhor. O plano completo está em `docs/redesenho-2026-09.md` (e os dados brutos, com a investigação e as 59 críticas, em `docs/redesenho-2026-09.json`); protótipo clicável em https://claude.ai/artifact/5aNFx3deb5ecZ2KWNRsc8N.
60. **Resumo das escolhas do plano:** 4 separadores (Hoje · Balanço · Treino · Corpo) e um botão (+) para registar tudo; fotos analisadas em segundo plano sem bloquear; favoritos sem IA; print do relógio lido pelo Sonnet e fundido com a sessão já registada; intervals.icu para sincronização automática só se houver relógio Garmin (a API do Strava exige subscrição desde junho de 2026 e a da Garmin está fechada a novos pedidos); gordura e massa magra pelo método da Marinha dos EUA sobre o peso médio; capítulos, patronos e plano de 4 semanas vão para um Arquivo só de leitura; funções serverless de 8 para 5. Nada se implementa antes da confirmação do João.

## 2026-09-28 — Respostas do João e Fase 0

61. **"Tudo Garmin" (bike e ginásio gravados no relógio):** a sincronização automática pelo intervals.icu deixa de ser a Fase 7 opcional e passa a ser o caminho principal do treino, antecipada para a Fase 3 — o relógio sincroniza com o Garmin Connect, o intervals.icu importa de lá (grátis, API com chave pessoal) e a app lê as atividades e o wellness. O print do Garmin lido pelo Sonnet fica como alternativa quando a sincronização falhar. Atividades que cheguem ao intervals.icu via Strava vêm vazias pela API, por isso a ligação tem de ser Garmin → intervals.icu direta.
62. **"A consola mostra watts":** o relógio dá FC e duração mas não watts na bicicleta estática; os watts vêm da consola — do favorito "Bicicleta habitual" (watts habituais pré-preenchidos) ou de uma foto da consola — e fundem-se com a atividade do Garmin do mesmo dia. A regra 2 da bike (watts × min × 0,06) mantém-se; sem watts, a bike conta 0 kcal em vez de adivinhar.
63. **Chamadas à Anthropic endurecidas:** thinking desligado no Sonnet 5 (por omissão pensa de forma adaptativa, o que custava tempo e tokens a extrair JSON), sem repetições automáticas do SDK (`maxRetries: 0`, timeouts de 20 s texto / 35 s visão / 50 s plano), segunda tentativa só se ainda couber nos 60 s da função, e respostas `max_tokens`/`refusal` tratadas como falha. Os erros da Anthropic chegam ao ecrã com mensagens claras (504 demorou, 503 ocupada, chave inválida).
64. **Regra 2 revista para "outro":** as kcal do aparelho × 0,7 quando existem; senão METs líquidos (caminhada 2,5, elíptica 4, natação 5, outro 3) × peso médio dos últimos 7 dias × horas. O `kcal_est` calcula-se **ao gravar** e a cron e o Hoje somam o valor guardado (`storedExerciseKcal`), para que a meta do dia não mude se a regra mudar depois.
65. **Strava arquivado:** OAuth, webhook, reconciliação e o script do webhook foram para `/archive/strava` (fora do deploy e dos testes); fica só o mapeamento de atividades em `api/_lib/strava.ts`, reaproveitável para imports. A cron deixou de reconciliar. A tabela `strava_tokens` fica no schema, sem uso.
66. **7 funções:** o código de barras juntou-se à função `meal` (rewrite `/api/food/barcode/:ean`) e nasceu a função `day` com `/api/day/health` — estado do deploy protegido pela `CRON_SECRET`, sem nunca mostrar valores de variáveis. `tests/guardas.test.ts` falha se houver mais de 10 funções, imports relativos sem `.js`, regras com Supabase ou `node:`, chamadas do cliente para caminhos sem função nem rewrite, ou rewrites para funções que não existem. `scripts/smoke.mjs` verifica a produção depois de cada deploy.
