# Auditoria de novembro de 2026 — estado

Estado de cada achado de [`auditoria-2026-11.md`](auditoria-2026-11.md) depois dos Lotes A, B e C e da limpeza final. Fonte: as mensagens dos commits (cada uma cita os códigos). Estados: **feito**, **em parte**, **decisão do dono**, **não feito**.

## Corpo e energia

| Código | Estado | Nota |
| --- | --- | --- |
| K1 | feito | gasto medido só com pesagens reais suficientes; estado «a aprender» à vista |
| K2 | feito | Conta da gordura compara com o previsto para os dias de calendário |
| K3 | feito | base com o treino da mesma janela |
| K4 | feito | teto de ±400 kcal mantido (decisão 175); só o texto e a marca visível mudaram |
| K5 | feito | semana de pausa sem gasto medido usa fórmula + treino médio |
| K6 | feito | projeção com a média sobre todas as pesagens |
| K7 | feito | Balanço lido uma vez |
| K8 | feito | chip «sem comer as kcal do treino» |
| K9 | feito | dia passado usa o `kcal_out_est` guardado pelo fecho |
| K10 | feito | Corpo, Projeção e «O teu mês» no dia do Balanço |
| K11–K15 | feito | alvo 0 de fora, «com hoje», EWMA, gordura negativa, texto |
| K16 | feito | «Podes comer» = Plano − Comido com números arredondados |

## Comida

| Código | Estado | Nota |
| --- | --- | --- |
| M1–M19 | feito | Lote A (comida); M17 e M18 completados no Lote B |
| M20 | em parte | as correções verificam o teto do mês; **chamadas que falham a contar e verificar e contar de forma atómica ficam por decidir** |

## Treino

| Código | Estado | Nota |
| --- | --- | --- |
| T1–T4, T7–T9, T19, T24 | feito | junção por sobreposição, «Juntar os dois», progressões |
| T5, T6, T10–T15, T18, T20, T21, T23 | feito | Lote B (ecrãs do treino) |
| T17 | em parte | modo «Juntar» sem campos ignorados e «Descartar» com Anular; **dividir o `ConfirmWorkoutSheet` em três folhas fica por fazer** |
| D1 | feito | SQL de uma vez em `supabase/oneoff/20261113_bicicletas_kcal_relogio.sql` (**ainda por correr**) |

## Servidor e segurança

| Código | Estado | Nota |
| --- | --- | --- |
| S1–S9 | feito | crons sem paragem num erro, `cron_runs`, retenção, health com prompts vivos |
| G1 | em parte | `requireUser` exige perfil ou `HOUSE_EMAILS`; **confirmar no painel do Supabase que o registo de contas está desligado e o «Max rows»** |
| G2, G3, G5 | feito | fotos só da pasta do dono, push só pelo servidor, limites nos buckets |
| G4 | em parte | segredos em tempo constante; **o token do Atalho não expira nem se revoga por pessoa (decisão do dono)** |
| G6 | decisão do dono | no painel: ligar a proteção contra palavras-passe expostas; `(select auth.uid())` nas políticas é opcional |

## Hoje, registo de comida e casca

| Código | Estado | Nota |
| --- | --- | --- |
| H1–H10, H12–H15, H17 | feito | Lotes B e C |
| H11 | em parte | ★ abre a favorita, Apagar fora do rodapé; **as cinco maneiras de mexer na quantidade continuam (decisão do dono)** |
| H16 | em parte | toques de 44 px e base da letra em rem; **o texto em px fixos contra o Dynamic Type do iPhone fica por decidir** |

## Balanço e Corpo

| Código | Estado | Nota |
| --- | --- | --- |
| B1–B16, B18 | feito | Lote B; B9 no Lote C (a cron revê as semanas cujos dias mudaram) |
| B17 | em parte | Ciclo recolhido e Evolução na barra; **passos, sono e projeção ainda aparecem em mais de um sítio** |

## Partes antigas

| Código | Estado | Nota |
| --- | --- | --- |
| L1 | feito | README com a lista completa das migrações |
| L2 | feito | Arquivo fica, corrigido e só para quem tem capítulos (decisão do dono) |
| L3, L4 | feito | definições sem efeito e Avançado limpos |
| L5, L6 | feito | plano semanal com IA, Strava e ações sem chamador em `archive/` |
| L7 | feito | dor aceite e ignorada nos esquemas |
| L8, L9 | feito | fila antiga, folha `escrever` e `?refeicao=` do código de barras saíram |
| L10 | feito | regras só de testes apagadas; `proteinMealOk` ligada à folha da refeição |
| L11 | em parte | migração `20261113000050_limpeza.sql` escrita, **não aplicada** |
| L12 | em parte | o código já não lê as colunas; o `drop` está na mesma migração, **não aplicada** |
| L13 | feito | marcadores em colunas vivas; com `schema_version` a app deixa de depender de colunas |
| L14 | feito | `meals_counted` recriada com as colunas atuais |
| L15 | não feito | 273 dias antigos sem comida: inofensivos, ficam |
| L16 | feito | prompts sem chamada em `archive/prompts/`; os prompts só vão nas funções que chamam a IA |
| L17 | feito | `playwright-core`, `ICS_TOKEN`, `eslint-disable` e exports sem uso saíram |
| L18 | feito | JSON do redesenho e o oneoff dos ginásios (já corrido) em `archive/` |
| L19 | feito | nome do package e User-Agent atuais; as chaves `regresso.*` ficam |
| L20 | feito | contas comuns num módulo; últimos watts com a janela de 30 dias também no cliente; relatório com o laranja novo |

## Performance

| Código | Estado | Nota |
| --- | --- | --- |
| P1 | em parte | o Hoje guarda os dias vistos; **o pedido único do dia fica por fazer** |
| P1b | feito | Balanço lido uma vez, semana em memória |
| P2 | em parte | ZXing, Zod da Pergunta e ícones fora do precache, folhas raras em `lazy()`; **o Recharts continua no precache** |
| P3, P4 | feito | fecho com contas puras e menos idas; `trend7` linear |
| P5 | não feito | o Treino ainda faz `select('*')` de 12 semanas |
| P6 | em parte | rascunho e fila corrigidos, `loading="lazy"`; **miniaturas das favoritas e URLs assinados estáveis ficam por fazer** |
| P7, P8 | feito | `import()` por ação, sessão verificada localmente, pesagens do Atalho em lote |

## Ideias «que o utilizador não vê»

| Ideia | Estado | Nota |
| --- | --- | --- |
| 1 cache e pedido único | em parte | ver P1 |
| 1b itens na base 1 | não feito | decidido não fazer |
| 1c recalcular no servidor | feito | M8 |
| 3 fecho atómico | em parte | `cron_runs` e aviso em Avançado; o fecho numa função SQL fica |
| 4 simulação do fecho | feito | `tests/simulacao-fecho.test.ts` |
| 5 guardas | feito | `noUnusedLocals`/`noUnusedParameters`, knip no `npm test`, guardas de ações e prompts |
| 6 versão do schema | feito | `schema_version` no health e no telemóvel (sem a tabela, os marcadores de antes) |
| 10 retenção | em parte | limpeza mensal feita; as tabelas `*_bak` saem com a migração de limpeza |

## Pendente do dono

- **Aplicar** `supabase/oneoff/20261113_bicicletas_kcal_relogio.sql` (D1) e, uns dias depois de publicar o código novo e com cópia de segurança, `supabase/migrations/20261113000050_limpeza.sql` (L11, L12; irreversível).
- **Painel do Supabase:** registo de contas desligado e «Max rows» (G1); proteção contra palavras-passe expostas (G6).
- **Decisões:** M20 atómico; token do Atalho sem expirar nem revogar (G4); texto em px contra o Dynamic Type (H16); as cinco maneiras de mexer na quantidade (H11); pedido único do Hoje (P1); miniaturas das favoritas e URLs assinados (P6); Recharts no precache (P2); dividir o `ConfirmWorkoutSheet` (T17); passos, sono e projeção repetidos (B17).
