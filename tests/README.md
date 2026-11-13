# /tests — regras de negócio (secção 5 da spec)

Cada regra tem testes; as implementações vivem em `/api/_lib/rules` como funções puras. Mapa previsto:

| Regra | Ficheiro |
| --- | --- |
| 1. Dia nutricional 04:00–04:00 (Europe/Lisbon) | `dia-nutricional.test.ts` |
| 2. `kcal_target` e `kcal_exercise` (bike = W×min×0,06; ginásio = calorias do relógio por inteiro ou, sem elas, os minutos ao ritmo da pessoa ou pelo peso; outros = relógio×0,7 ou METs) | `kcal-exercicio.test.ts`, `kcal-ginasio.test.ts` |
| 3. Tendência de peso (média 7d) e ritmo da semana; a projeção vive em `rules/projecao.ts` | `peso-tendencia.test.ts`, `projecao.test.ts` |
| 4. Gasto adaptativo (28 dias completos, EMA α 0,1 e no máximo 30 kcal/dia a partir da fórmula, ≥ 10 dias) | `adaptativo.test.ts` |
| 5. Dia completo (≥ 2 refeições ou "dia fechado"; < 800 kcal sem marca = incompleto) | `dia-completo.test.ts` |
| 7. Semana de manutenção a cada 6 semanas | `manutencao.test.ts` |
| 8. Proteína por dia e por refeição principal | `proteina.test.ts` |
| 10. Progressão de bike (tempo, cadência, caps de FC, validação de 30 min) | `progressao-bike.test.ts` |
| 11. Dupla progressão de força no ginásio livre (+2 kg, +1 kg abaixo de 10 kg) | `progressao-forca.test.ts` |
| 12. Estimativas (`is_estimate` em foto e "jantar fora") | `estimativas.test.ts` |

As regras antigas sem chamador (o aviso do chão semanal, o semáforo da dor, a progressão com deload do plano de 4 semanas, a projeção linear de 21 dias, a % de estimados) saíram com os seus testes (L10, auditoria de novembro). A dor no joelho já não entra nos esquemas, mas um cliente antigo que a mande não falha (`dor-esquemas.test.ts`, L7).

Além das regras, testes do que falha no telemóvel e no deploy (também funções puras, sem browser): `guardas.test.ts` (funções a mais, imports, caminhos), `falhas.test.ts` (rede fraca e erros em português), `fila.test.ts` (fila das fotos sem rede), `pessoas.test.ts` (contas guardadas e trocar de pessoa), `cron-auth.test.ts` (crons fechadas sem `CRON_SECRET`), `notificacoes.test.ts` (o que dizem, quando vão e para onde), `tempo-ia.test.ts` (o tempo de cada chamada à IA dividido com a reserva, dentro dos 60 s; `geminiCall` com um fetch falso) e `analise-tentativas.test.ts` (quando o telemóvel pede outra tentativa da análise e quando aparece «Tentar outra vez»).

A «Pergunta à app» tem os seus em `pergunta.test.ts` (o contexto que vai para a IA: hoje, semanas, fim de semana, dias, gasto, referências curtas) e `pergunta-acoes.test.ts` (a lista fechada das ações: só ids do contexto, dias dos últimos 28, limites, textos dos cartões e a conversa guardada).
