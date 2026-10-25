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
- `weekly-review.v4.md` — o resumo diz os mesmos números da frase do topo do Balanço: recebe a diferença comer − gasto (`comeu_menos_gasto`), o ritmo do peso (`ritmo_do_peso_kg_semana`, só com uma pesagem recente) e os dias de fora (`dias_de_fora`), em vez do peso médio do início e do fim.
- `meal-photo-add.v1.md` — «Juntar foto» numa refeição que já tem itens: recebe os itens atuais com as fotos e devolve só o que é novo (ou os valores do rótulo de um item que era estimado).
- `label-read.v1.md` — código de barras que o Open Food Facts não tem: lê a tabela nutricional da embalagem, por 100 g, sem estimar o que não se vê.
- `recipe.v1.md` — Favoritas › «Importar receita»: a lista de ingredientes (ou o texto da página) passa a itens com gramas para a receita toda, com as doses quando a receita as diz.
- `meal-leftovers.v1.md` — «Sobrou comida?» (foto do antes e do depois): recebe as fotos do prato cheio, a do que sobrou (em último) e os itens contados, e devolve por item a parte comida (0 a 1) com a confiança; nunca junta itens, e diz quando a foto do depois não é o mesmo prato.
- `ask.v1.md` — «Pergunta à app» (Hoje e Balanço): responde curto, só com os números do contexto da própria pessoa (dias, semanas, peso, gasto, refeições, favoritas, ciclo), explica com as regras da app (dias completos, 7 700 kcal ≈ 1 kg, gasto que muda devagar, fase da água, semana de água do ciclo) e pode propor até 3 ações de uma lista fechada, que a pessoa confirma com «Fazer».
- `meal-photo.v3.md` — a primeira análise das fotos: o mesmo da v2 e, quando uma imagem é a captura do resumo de um pedido de entrega (Glovo, Uber Eats, Bolt Food, Too Good To Go, um talão), um item por prato com a quantidade no nome e as doses de restaurante da quantidade toda, as bebidas, as sobremesas e os molhos com as kcal reais, sem taxas, gorjeta, saco, descontos nem totais, a mesma linha de duas capturas uma vez só. Devolve também `order` (`app`, `restaurant`, `people`: para quantas pessoas é, de forma evidente) num schema só das fotos (`MealPhotoAnalysisSchema`).
- `meal-photo-add.v2.md` — o «Juntar foto» da v1 e outra captura do mesmo pedido: só as linhas que ainda não estão em `itens_atuais` (a parte que se sobrepõe não volta), e a quantidade do pedido num item que estava estimado.
- `ask.v2.md` — a «Pergunta à app» da v1 sem a água: o contexto já não leva a água do dia nem a meta, e sai a ação `add_water` (decisão 286).
- `evolution.v4.md` — a Evolução da v3 sem a média de água por dia em `comida` (decisão 286).
- `weekly-review.v5.md` — o resumo da v4 com os dias completos contra o alvo (`dias_contra_o_alvo`), com os dois «acima» separados: acima do alvo (ainda com défice) e acima do gasto (sem défice; decisão 301).
