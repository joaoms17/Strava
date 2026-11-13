# Daily Track

App pessoal para registar o dia: comida, treino, peso e sono. Para uma casa: cada pessoa (até 4) tem a sua conta e os seus registos, e troca-se no separador do topo. PWA mobile-first, interface em PT-PT.

- **Hoje** — quanto ainda podes comer, o que já comeste e treinaste, o próximo passo.
- **＋** — registar comida por foto, texto, galeria, código de barras, favorita, repetir ou menu de restaurante; a IA analisa em segundo plano.
- **Balanço** — comer contra gasto, semana a semana e mês a mês.
- **Treino** — o que o relógio manda sozinho (intervals.icu), prints, treino dito ou escrito, ginásio com séries e o plano de treino.
- **Corpo** — peso, medidas com fita, gordura estimada, projeção, evolução e recuperação.

Como chegou aqui: [docs/historia.md](docs/historia.md). Porque é que cada coisa é como é: [docs/decisions.md](docs/decisions.md). O que a auditoria de novembro de 2026 encontrou: [docs/auditoria-2026-11.md](docs/auditoria-2026-11.md).

## Stack

React + Vite + TypeScript, Tailwind, Recharts, vite-plugin-pwa (service worker com `public/push-sw.js` para as notificações). Supabase (Postgres, Auth, Storage, RLS). Vercel Hobby (frontend, 6 funções em `/api` e 2 crons). IA só em `/api`: o Gemini (plano gratuito) com `GEMINI_API_KEY`, senão o Claude; Zod valida todo o JSON. Notificações por Web Push (`web-push`, chaves VAPID). Timezone Europe/Lisbon em tudo; o dia nutricional vai das 04:00 às 04:00.

## Estrutura de pastas

```
/api                      Funções serverless (Vercel) — ver api/README.md
  /_lib                   Clientes partilhados (supabase admin, IA, notificações, intervals.icu)
    /rules                Regras de negócio, funções puras — testadas em /tests e usadas também pelo cliente
  meal.ts + /_meal        refeições: captura, análise, correções, favoritos, código de barras, partilha, sobras
  workout.ts + /_workout  treinos: guardar, séries, prints do relógio, treino dito, intervals.icu
  day.ts + /_day          estado do deploy, recálculo, evolução, pessoas, «Pergunta à app», notificações
  /health                 daily.ts (Atalho do iPhone)
  /cron                   daily.ts (fecho do dia, resumo da semana, limpeza), lembretes.ts (notificações)
/archive                  código arquivado, fora do deploy (Strava por API, planos gerados pela IA, prompts antigos)
/docs                     história, decisões, auditoria, plano do redesenho
/prompts                  prompts versionados: <funcao>.v<N>.md (só as versões em uso)
/src                      App React (PWA) — ver src/README.md
  /screens                Hoje, Balanço, Treino, Ginásio, Plano de treino, Corpo, Favoritas, Definições (+ Avançado, Arquivo)
  /components             folhas (sheets), gráficos (charts, corpo, balanco), ui
  /lib                    cliente supabase, perfil, fila offline, dados lidos uma vez por ecrã — sem regras de negócio
/supabase
  /migrations             SQL com RLS em todas as tabelas, para correr por ordem
  /seed                   dados iniciais da primeira conta (perfil, capítulos, catálogo de exercícios)
  /oneoff                 correções de uma vez, corridas à mão no SQL Editor (não são migrações)
/tests                    testes das regras e guardas do deploy (Vitest)
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

A fonte de verdade é o conjunto das migrações em [`supabase/migrations/`](supabase/migrations/), por ordem. RLS ativa em todas as tabelas; os dados são filtrados por `user_id = auth.uid()`; `integrations`, `app_secrets` e `off_searches` não têm acesso nenhum do cliente.

## Setup

1. Criar projeto no Supabase e a primeira conta em Auth (email + password). **Desligar o registo livre:** Authentication › Sign In / Providers › «Allow new users to sign up» desligado — a «casa» é quem tem conta neste projeto. Confirmar sempre que se cria um projeto novo: vem ligado por omissão e, ligado, qualquer pessoa com a chave pública da app cria uma conta. As outras pessoas criam-se depois na app, em Definições › Pessoas. Para fechar também no servidor, definir `HOUSE_EMAILS` no Vercel (passo 3).
2. Aplicar **todas** as migrações de `supabase/migrations/`, por ordem do nome (`supabase db push`, ou no SQL Editor: New query → colar o ficheiro inteiro → Run). Podem correr-se mais de uma vez; as do redesenho acabam com uma tabela que tem de vir vazia. Com a tabela `schema_version` (migração `20261113000042`), Avançado lista as que faltam; sem ela, a app só avisa («A app precisa de uma atualização») da falta das mais antigas: confere pela lista. Depois, os seeds de `supabase/seed/` por ordem, para a primeira conta.

   | Migração | O que traz |
   | --- | --- |
   | `20260908000000_initial_schema.sql` | tabelas de base e RLS |
   | `20260908120000_storage_meal_photos.sql` | bucket privado das fotos das refeições |
   | `20260910000000_storage_chapter_photos.sql` | bucket das fotos dos capítulos (Arquivo) |
   | `20260928000000_fase1.sql` | casca nova: favoritos, marca «precisa de recálculo», vistas `meals_counted` e `workouts_active` |
   | `20260929000000_fase2.sql` | fotos analisadas em segundo plano, limites da IA |
   | `20260929120000_fase2_permissoes.sql` | tira à app o acesso à função de limpeza do Storage |
   | `20260930000000_fase3.sql` | treino: prints do relógio, Bicicleta habitual |
   | `20261001000000_fase4.sql` | medidas |
   | `20261002000000_fase5.sql` | favoritos de ginásio |
   | `20261003000000_fase6.sql` | gasto e resumo da semana |
   | `20261004000000_fase7.sql` | intervals.icu |
   | `20261005000000_sono.sql` | pontuação do sono, HRV |
   | `20261006000000_dietas.sql` | dietas feitas com as favoritas (sem ela só o separador Dieta pede a migração) |
   | `20261007000000_evolucao.sql` | guardar a análise da evolução |
   | `20261015000000_agua.sql` | água do dia (a app já não a usa, decisão 286; a coluna sai na limpeza) |
   | `20261018110000_pesagens_apagadas.sql` | uma pesagem apagada não volta |
   | `20261018110001_forma_intervals.sql` | forma e VO2máx do intervals.icu |
   | `20261018130000_alimentos_marca.sql` | produtos de marca (fibra, açúcares, sal, Nutri-Score) e cache da pesquisa no Open Food Facts |
   | `20261018140000_dias_certos.sql` | o plano base de cada dia (`days.base_kcal`) e o gasto só pelo peso (`days.tdee_raw`) |
   | `20261018150000_notificacoes.sql` | notificações (sem ela só Definições › Notificações pede a migração) |
   | `20261018150001_fotos_capitulos.sql` | cada pessoa só escreve na sua pasta das fotos dos capítulos |
   | `20261018150002_ia_reserva.sql` | aviso de foto lida pelo modelo de reserva |
   | `20261018160000_partilhar_ao_registar.sql` | «Também para …» no ＋ |
   | `20261018200000_sobras.sql` | foto do que sobrou |
   | `20261018210000_divisao_partilha.sql` | dividir ao partilhar no ＋ |
   | `20261018220000_pedidos_entrega.sql` | a dica «Pedido para 2» num pedido de entrega |
   | `20261113000020_etiquetas_analise.sql` | etiquetas já aplicadas pela análise (`meals.analysis_tags`) |
   | `20261113000021_meals_counted_colunas.sql` | recria a vista `meals_counted` com as colunas atuais (correr depois da anterior) |
   | `20261113000022_custo_ia_mes.sql` | custo mensal da IA somado na base de dados (`ai_cost_since`) |
   | `20261113000030_cron_runs.sql` | registo de cada noite da cron (aviso em Avançado) |
   | `20261113000031_push_so_servidor.sql` | subscrições das notificações só criadas pelo servidor |
   | `20261113000040_nome_no_perfil.sql` | nome de cada pessoa guardado no perfil (`profile.display_name`) |
   | `20261113000041_limites_buckets.sql` | limites de tamanho e tipo nos buckets das fotos |
   | `20261113000042_schema_version.sql` | versão do schema (`schema_version`); correr depois da 40 e da 41 |
   | `20261113000050_limpeza.sql` | **irreversível**: apaga as tabelas órfãs (`strava_tokens`, as cópias `*_bak` de setembro) e as colunas que o código já não lê. Só uns dias depois de publicar o código novo (o telemóvel guarda o perfil em cache) e com cópia de segurança; numa instalação nova pode correr-se logo |

3. Importar o repo no Vercel. Env vars do projeto: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (só server), a chave da IA — `GEMINI_API_KEY` (Gemini, plano gratuito: criar em aistudio.google.com › Get API key) **ou** `ANTHROPIC_API_KEY` (Claude, pago) —, `CRON_SECRET` (protege as crons; sem ela não correm), `HEALTH_INGEST_TOKEN` (o Atalho do iPhone, passo 6), e para o cliente `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Opcionais: `HOUSE_EMAILS` (emails da casa separados por vírgulas: com ela, o servidor só aceita contas que estejam na lista ou já tenham perfil; sem ela, aceita qualquer conta do projeto, por isso o registo livre tem de estar desligado), `AI_PROVIDER`, `GEMINI_MODEL_VISION`/`GEMINI_MODEL_TEXT`, `VAPID_SUBJECT` (contacto `mailto:` das notificações; sem ela, o endereço da app) e `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` (sem elas, o servidor cria as chaves das notificações na primeira vez e guarda-as no Supabase; não as troques depois, senão cada telemóvel tem de ligar as notificações outra vez). Em dev local: copiar `.env.example` para `.env`.
3b. **Recuperar a palavra-passe:** no Supabase, Authentication → URL Configuration → Site URL = `https://a-tua-app.vercel.app` e, em Redirect URLs, `https://a-tua-app.vercel.app/**`. Sem isto, o link do email «Esqueci-me da palavra-passe» abre `localhost`. O email sai pelo serviço do Supabase (poucos por hora; vê no lixo/spam).
4. Abrir o domínio do Vercel no telemóvel e "Adicionar ao ecrã principal" — a PWA instala com o ícone e abre em standalone. No primeiro arranque: login (o iPhone preenche o email e a password); a sessão fica iniciada, sem PIN.
5. Verificar o deploy: `curl -H "Authorization: Bearer <CRON_SECRET>" https://a-tua-app.vercel.app/api/day/health` (ou, no browser, `…/api/day/health?token=<CRON_SECRET>`, que fica no histórico) — diz que variáveis faltam (nunca mostra valores), se os prompts foram incluídos, se o Supabase responde e se a chave da IA em uso chega aos dois modelos. Na app, Definições › Avançado › «Verificar a IA» faz uma chamada mínima a cada modelo e diz o que está mal. Da linha de comandos: `CRON_SECRET=... node scripts/smoke.mjs https://a-tua-app.vercel.app`.
6. Saúde (Atalho iOS, todas as noites): POST para `https://a-tua-app.vercel.app/api/health/daily` com header `Authorization: Bearer <token>` e corpo JSON `{"steps": 8500, "sleep_minutes": 430, "resting_hr": 52}` (a data por omissão é o próprio dia). O token pessoal de cada pessoa está em Definições › Ligações · Atalho do iPhone (grava na conta dela); `HEALTH_INGEST_TOKEN` grava na primeira conta. A balança pode mandar também `"body": [{"date": "2026-10-18", "weight_kg": 82.4, "body_fat_pct": 21.5}]` (só entra em dias sem pesagem nem pesagem apagada).
7. Notificações: em cada iPhone (iOS 16.4 ou mais recente), com a app aberta pelo ícone do ecrã principal, Definições › Notificações e ligar as que se quer (o iPhone pede autorização). «Mandar uma de teste» confirma que chegam. Nada a configurar no Vercel além da migração `20261018150000_notificacoes.sql`.
