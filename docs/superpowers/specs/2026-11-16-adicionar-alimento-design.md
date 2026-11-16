# Adicionar alimento — desenho (2026-11-16)

## Porquê

Uma refeição é um agregador de alimentos. Hoje, juntar mais um alimento a uma
refeição já registada só é possível por ＋ → Código de barras → «Juntar a uma
refeição já registada»; dentro da ficha da refeição não há forma de juntar
nada. Muitas vezes o João sabe a quantidade exata (gramas, ou as kcal do
rótulo) e os − / + de 10 g não servem. Os rótulos que a foto não consegue ler
têm de se poder escrever à mão. E os alimentos que usa sempre (whey, farinha
de arroz, claras…) deviam estar à mão, por ordem do que costuma comer naquela
refeição.

## Objetivos

1. Botão **＋ Alimento** dentro da ficha de cada refeição (MealSheet), que abre
   o ecrã de adicionar alimentos ligado a essa refeição; o que se escolhe junta-se
   a ela (sem passar pelo «Juntar a qual?»).
2. O ecrã do código de barras (BarcodeSheet) passa a **«Adicionar alimento»**,
   com, além do que já tem (ler código, procurar pelo nome, foto do rótulo,
   gramas escritas, cesto de vários produtos, guardar como refeição nova ou
   juntar a uma registada):
   - **Mais usados**: os alimentos da pessoa (`foods`), ordenados pelas vezes
     que aparecem nas refeições **do mesmo momento** (pequeno-almoço, ceia…)
     nos últimos 90 dias; depois os restantes por `use_count`. Cada um mostra a
     quantidade habitual **nesse momento** (a mediana das gramas usadas lá; sem
     histórico no momento, `default_portion_g`; sem nada, 100 g).
   - **Escolher vários**: tocar num alimento da lista abre-o com as gramas
     sugeridas (escrevíveis); «Juntar ao cesto» e continua-se a escolher. O
     botão final diz quantos são.
   - **Escrever do rótulo**: nome, kcal e proteína por 100 g (hidratos e
     gordura opcionais, 0 se vazios), gramas comidas. Grava em `foods`
     (`source 'user'`) e o item vai para o cesto com o `food_id` novo; da
     próxima vez está nos mais usados.
3. **Quantidades escritas** em cada alimento de uma refeição (ItemList):
   tocar no alimento mostra dois campos, **gramas** e **kcal**; escrever kcal
   ajusta as gramas na mesma proporção (e os macros). A afordância deixa de ser
   o sublinhado a pontinhos: os valores aparecem como caixa tocável. Os − / +
   de 10 g ficam.
4. **Favoritas no ＋**: de 4 para 8 (`QUICK_FAVORITES`).

## Não-objetivos

- Editar os alimentos dentro de uma refeição favorita (fica para depois).
- «Favoritar» alimentos à mão: os mais usados são automáticos.
- Itens só com kcal (sem gramas). Os «Registo rápido» com `grams = 0`
  continuam não editáveis.
- Mudar o modelo de dados das refeições: os itens continuam absolutos
  (`MealItem`), a API `/api/meal/update` continua a receber a lista inteira.

## Anti-objetivos

- Perder o cesto ou duplicar registos (a idempotência por `client_id` e o
  cesto em localStorage mantêm-se).
- Tornar o fluxo rápido mais lento: ler um código continua a ser um toque a
  partir do ＋.
- Chamadas de IA novas: nada disto usa IA.

## Restrições

- `foods` tem RLS `owner_all` (user_id = auth.uid()): o cliente pode inserir
  diretamente com `source 'user'` (é o que Favoritos já faz para editar/apagar).
- Os itens vindos de foto/texto têm muitas vezes `food_id` nulo: a contagem por
  momento liga item → alimento por `food_id` e, sem ele, pelo nome normalizado
  (minúsculas, sem acentos, espaços colapsados) igual ao `foods.name`.
- Max rows do Supabase = 1 000: 90 dias de refeições de uma pessoa cabem
  (≈ 4–6 por dia); pedir só `slot,logged_at,items` e filtrar `deleted_at is null`.
- O momento de uma refeição: `slot` se existir, senão `slotOf(logged_at)` (como
  `mealSlot` em lib/repetir).
- Código partilhado cliente/servidor vive em `api/_lib/rules/`; lógica pura com
  testes em `tests/` (vitest).

## Abordagens consideradas

- **A. Alargar o BarcodeSheet para «Adicionar alimento»** (escolhida). Já tem
  cesto, gramas escritas, pesquisa, rótulo e juntar a refeição; só se juntam a
  lista dos mais usados, a entrada manual e o modo «ligado a uma refeição».
- B. Ecrã novo de raiz com o código de barras como uma das fontes. Mais
  arrumado, mas duplica o que o BarcodeSheet já faz e testado; o dobro do
  trabalho.
- C. Mínimo: botão na refeição que abre o BarcodeSheet tal como está, kcal
  escrevíveis, 8 favoritas. Rápido, mas deixa de fora os mais usados e o
  rótulo, que eram o principal.

## Decisões de como (do João)

- Abordagem A.
- Ordem dos mais usados pelo que mais vezes come **naquela refeição**.
- Poder escolher vários de uma vez.
- Quantidade sugerida = a habitual naquela refeição; escreve-se por cima.
- Kcal do rótulo escrevem-se por 100 g (rótulos ilegíveis à foto).

## Deixado ao construtor (decisões minhas, corrigíveis)

- O ecrã abre na lista (mais usados + pesquisa nos meus alimentos + botões
  Código / Rótulo / Escrever), não na câmara; a partir do ＋, o ícone «Código
  de barras» continua a abrir direto na câmara (parâmetro `ler=1`).
- A pesquisa por nome procura primeiro nos alimentos da pessoa (filtro local da
  lista carregada), e só ao carregar em «Procurar» vai ao Open Food Facts.
- Ligado a uma refeição (`sheet.open('barras', { refeicao: id })`): o rodapé
  diz «Juntar N · X kcal» e junta diretamente (mesmo `addTo` com Anular);
  depois volta à ficha da refeição. Sem refeição, comportamento atual.
- `setItemKcal(item, kcal)` em lib/meal-diff: gramas = origem.gramas ×
  kcal / origem.kcal (origem com kcal > 0), arredondado a 0,1 g, máx. 5 000 g.
- Lista dos mais usados: até 30 alimentos.
- Fora de uma refeição, a ordem dos mais usados segue o momento escolhido no
  «Quando» do Registar; sem ele, o momento atual.
- **Cesto ligado a uma refeição**: começa vazio e guarda-se numa chave própria
  (`BASKET_KEY` + id da refeição); o cesto geral fica onde está, para não ir
  parar à refeição errada. Fechar com produtos no cesto ligado avisa e o
  «Abrir» volta a esse modo.
- **Rótulo escrito depois de um código não encontrado**: o alimento fica ligado
  a esse código, como na foto do rótulo. Por isso a gravação passa pelo
  servidor (`/api/meal/label` aceita valores escritos em vez de foto, reusa
  `saveFood` com `source 'user'` e lida com o índice único `(user_id,
  barcode)`). Sem código (escrito a partir da lista), insere-se do cliente
  (RLS `owner_all`).
- Os campos de gramas/kcal valem em todo o lado onde aparece o ItemList (ficha
  da refeição e nova favorita).
