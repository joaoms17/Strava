# /prompts — prompts versionados

Um ficheiro por função, com a versão no nome: `<funcao>.v<N>.md`. A versão usada fica registada em `prompt_version` nas linhas criadas (`meals`, `plan_blocks`).

Previstos:

- `meal-parse-text.v1.md`
- `meal-parse-photo.v1.md`
- `plan-generate.v1.md`
- `weekly-review.v1.md` — voz de narrador, PT-PT, 5 linhas; sem elogios vazios e sem frases atribuídas ao patrono.

Uma alteração ao prompt é sempre um ficheiro novo (`v2`, `v3`, …), nunca uma edição do antigo.
- `meal-photo.v2.md`, `meal-text.v2.md`, `meal-correct.v1.md` — Fase 2 (análise em segundo plano e correções).
- `workout-shot.v1.md` — Fase 3: prints do Garmin Connect, Strava e foto da consola; copiar só o que está impresso.
- `menu-pick.v1.md` — ＋ › «Escolher pelo menu»: lê os pratos do menu e estima a dose de restaurante de cada um (kcal e macros), com o tipo (prato, entrada, sobremesa…) e o preço.
- `workout-said.v2.md` — Treino › «Dizer ou escrever»: recebe os exercícios que a pessoa já fez e os do catálogo e usa esses nomes, para o histórico de um exercício não se partir em dois.
- `weekly-review.v3.md` — resumo neutro da semana: recebe também as médias do relógio (`bem_estar`) e a semana de água do ciclo (`ciclo`), e não lê essa subida do peso como gordura.
- `meal-photo-add.v1.md` — «Juntar foto» numa refeição que já tem itens: recebe os itens atuais com as fotos e devolve só o que é novo (ou os valores do rótulo de um item que era estimado).
- `label-read.v1.md` — código de barras que o Open Food Facts não tem: lê a tabela nutricional da embalagem, por 100 g, sem estimar o que não se vê.
- `recipe.v1.md` — Favoritas › «Importar receita»: a lista de ingredientes (ou o texto da página) passa a itens com gramas para a receita toda, com as doses quando a receita as diz.
