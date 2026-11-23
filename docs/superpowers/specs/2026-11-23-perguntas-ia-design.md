# Perguntas da IA nas fotos de refeições — desenho (2026-11-23)

## Porquê

A foto de uma refeição é analisada de uma vez e, quando a IA tem dúvidas, a
refeição fica «por rever» com «confirma a porção» — mas nunca diz qual é a
dúvida. O João quer que a análise seja o mais certa possível: que use o que
ele costuma comer (batata-doce caseira, hambúrgueres do Mac ou de um
restaurante), e que pergunte quando a foto não chega — só quando é preciso.

## Objetivos

1. **Mais contexto com a imagem** (primeira análise de fotos):
   - `historico`: as refeições do mesmo momento (pequeno-almoço, almoço…) nos
     últimos 30 dias, as 12 mais recentes: título e alimentos com gramas.
   - `respostas_anteriores`: as perguntas já respondidas nos últimos 90 dias
     (pergunta e resposta), até 20 — é assim que a app «aprende».
   - O que já ia: texto, nota, etiquetas, hora, momento, biblioteca (40).
   - No Claude (Sonnet 5.5) a foto vai com raciocínio adaptativo, esforço
     `low`: melhor nas porções, dentro dos 45 s. No Gemini fica como está.
2. **Perguntas só quando é preciso, sobre o que se vê:** a IA devolve 0 a 3
   `perguntas`; cada uma diz os alimentos a que se refere e 2 a 4 opções, cada
   opção com os alimentos já calculados. As análises principais (`items`) são a
   opção mais provável. A app guarda só as perguntas em que as opções diferem
   pelo menos `max(80 kcal, 15 % da refeição)`, no máximo 3.
3. **Responder depois (opção B):** com perguntas, a refeição fica «por
   rever» e as perguntas aparecem na ficha da refeição. No Hoje, o ponto de
   «por confirmar» mantém-se.
4. **Responder:** tocar numa opção troca os alimentos dessa pergunta pelos da
   opção (sem IA, sem custo); «Outro…» escreve-se e vai à correção por texto
   (a mesma IA da «Corrigir»). Todas respondidas → a refeição fica «ok».

## Não-objetivos

- Perguntas nas refeições escritas, no «Juntar foto» e nas correções.
- Uma tabela de «factos aprendidos» à parte (as respostas ficam na refeição).
- Notificações push com as perguntas.

## Anti-objetivos

- Perguntas genéricas («é caseiro?») ou em todas as refeições.
- Perder alterações que a pessoa já fez noutros alimentos ao responder.
- Análise mais lenta ao ponto de esgotar o tempo da função.

## Abordagens

- **Misto (escolhida):** opções pré-calculadas na mesma chamada + «Outro…»
  com a correção por texto. Rápido e sem custo no caso comum.
- Só pré-calculadas: sem saída quando nenhuma opção serve.
- Nova análise a cada resposta: mais lenta e paga por resposta.

## Modelo de dados

- `meals.questions jsonb null` (migração nova). Lista de
  `{ pergunta, itens: string[], opcoes: { rotulo, itens: MealItem[] }[], resposta: string | null }`.
- A primeira análise escreve-a (uma releitura também, de raiz); juntar fotos
  não mexe. Sem a coluna (migração por aplicar), grava sem perguntas.

## Responder (API)

`POST /api/meal/answer { meal_id, question, option? , text? }`:
- opção: os alimentos atuais cujo nome é um dos `itens` da pergunta saem; os
  da opção entram no lugar do primeiro que saiu (os outros alimentos, com as
  alterações da pessoa, ficam);
- texto: `correctItems` com «<pergunta> <texto>»;
- marca `resposta`; sem perguntas por responder, `status: 'ok'` e
  `confirmed_at`; devolve `{ meal, previous }` (para Anular).

## Decisões minhas (corrigíveis)

- Limiar: 80 kcal ou 15 % da refeição; no máximo 3 perguntas.
- Histórico: 30 dias, 12 refeições do mesmo momento; respostas: 90 dias, 20.
- Raciocínio `low` só no Claude e só na primeira análise de fotos.
- Na ficha, cada opção mostra o rótulo e a diferença de kcal («+310 kcal»).
