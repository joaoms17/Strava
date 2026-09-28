# Redesenho: Regresso — O teu centro de fitness: o que comes, o que gastas e o que muda no corpo.

> Plano gerado a 28 set 2026 por 3 propostas concorrentes, 3 júris (utilizador, requisitos, engenharia) e 3 revisores críticos (59 problemas encontrados e corrigidos). Protótipo clicável: https://claude.ai/artifact/5aNFx3deb5ecZ2KWNRsc8N

## Visão

A app muda de natureza. Hoje é um treinador com uma história: capítulos, patrono, cartaz e um plano de 4 semanas gerado pela IA. Passa a ser o centro de fitness pessoal do João: o sítio onde a informação entra em segundos e onde o que entra (comida) e o que sai (treino e gasto) se comparam sozinhos, em português simples.

Tudo se regista a partir de um único botão (+), sempre com o mesmo desenho:
- foto da comida, tirada na hora ou escolhida da galeria, com uma nota curta («comi metade»);
- favorito com 1 toque (refeições e treinos), sem IA e sem custo;
- pesagem com o teclado já aberto;
- medidas com fita métrica;
- treino: a bicicleta habitual em 3 toques, «Já fiz», ginásio, ou o print do Garmin ou do Strava e a foto da consola.

A app responde a três perguntas, sempre com as mesmas duas palavras, Comer e Gasto:
- «Quanto ainda posso comer hoje?» (Hoje)
- «Estou a comer menos do que gasto, e o peso confirma?» (Balanço)
- «O meu corpo está a mudar?» (Corpo: peso médio, gordura, massa magra e cintura)

A IA trabalha em segundo plano e o João nunca espera por ela. Nada se perde se o iPhone fechar a app. Nada fica vermelho por comer demais, e não há pontuações, sequências nem percentagens de cumprimento. O joelho com artrose tem sempre prioridade: a pergunta sobre o joelho nunca fica escondida atrás de outro cartão.

O que esta versão final corrige em relação ao rascunho:
- As fases seguem a frequência de uso: casca nova, pesagem e favoritos primeiro; depois fotos sem espera; depois treino; depois medidas.
- «Comer» e «Gasto» deixam de se contradizer, e o Balanço já não compara o peso com um gasto que foi calculado a partir do próprio peso.
- Os rascunhos (prints por confirmar, fotos por analisar) nunca entram nos totais.
- As chamadas à IA correm sem pensamento alargado e sem repetições escondidas: mais baratas, mais rápidas e dentro dos 60 s.
- No fim há 5 funções serverless (limite 12), com testes que impedem voltar a passar o limite em silêncio.

## Princípios

- **Registar primeiro, analisar depois** — Nenhum registo espera pela IA nem pela rede. Uma foto vira logo um cartão «A analisar…» na linha do dia e os números chegam sozinhos 5 a 20 s depois. Enquanto isso, o número principal fica esbatido com «ainda a contar 1 foto», para o João não decidir o jantar com um valor incompleto.
- **Nada se perde** — Cada foto, nota, pesagem ou print fica primeiro no telemóvel (IndexedDB) e só sai da fila quando o servidor confirma. O servidor aceita repetições sem duplicar (client_id). Apagar é reversível durante 7 dias. Se o iOS fechar a PWA a meio, a app continua na próxima abertura.
- **Um toque para o que se repete** — Favoritos de refeições e de treinos, «Igual a ontem», «Repetir hoje» e a Bicicleta habitual. Registar um favorito não chama a IA, por isso custa 0 €.
- **Uma resposta por ecrã** — Hoje: «Podes comer mais 820». Balanço: uma frase sobre a semana. Corpo: «Peso médio 84,9 kg». Cada linha do dia mostra um só número. O resto fica a um toque, e o peso de cada dia nunca é manchete.
- **Mostrar a conta, sem falsa precisão** — Cada total abre a sua conta e os seus itens («Plano: 1 500 + 380 do treino = 1 880»; «O relógio diz 520 kcal; contamos 380 pela potência»). Nas frases usa-se «cerca de»; o «≈» fica só nas linhas compactas. Intervalos e nomes de métodos ficam atrás de ⓘ.
- **Anular em vez de perguntar, sem culpa nem pontuações** — Cada escrita de 1 toque mostra durante 10 s um aviso com Anular, acima da barra. Não há sequências, pontos por dia registado, percentagens de cumprimento nem ecrãs de «missão cumprida». O vermelho fica só para dor no joelho ≥ 6 e para erros. Lembretes ignorados 2 vezes param 3 dias.
- **O joelho primeiro** — A pergunta sobre o joelho nunca compete com outros cartões: aparece dentro do registo do treino, na confirmação da pesagem da manhã seguinte e numa linha fixa até haver resposta (ou 48 h). Sem resposta sobre o joelho, a app não sugere subir carga e diz porquê.
- **Português de casa (PT-PT)** — Glossário fixo: «peso médio» (não tendência), «a descer 0,4 kg por semana» (não ritmo nem sinais), «batimentos» (não FC), «comes 600 menos do que gastas» (não défice), «Gasto (a aprender)» (não estimativa inicial), «Semana de pausa da dieta» (não manutenção), «Plano» (não orçamento base). Nas manchetes usam-se palavras, não sinais de menos. Nunca aparecem TDEE, RPE, base_kcal, knee_safe, ICS_TOKEN nem $.

## Navegação

- **Hoje** — Ecrã inicial e centro do dia: quanto ainda pode comer, a barra da proteína, as linhas do joelho quando falta resposta, no máximo 1 cartão Próximo passo e a linha do dia por ordem da hora. A faixa da semana leva a dias anteriores, e tudo o que se regista a partir daí fica nesse dia.
- **Balanço** — Comer contra Gasto na semana: uma frase, um gráfico e o Resumo da semana. O resto (proteína média, treino, gasto medido contra a fórmula, sugestão de plano base) fica em «Ver detalhes».
- **Treino** — A saída: Bicicleta habitual e «Já fiz» como ações principais, «Juntar print do relógio», Ginásio (a partir da Fase 5), Sugestão seguinte, Histórico, Progressão e Joelho.
- **Corpo** — O resultado em 3 cartões: Peso (peso médio e gráfico), Gordura e massa magra, Cintura. O histórico de medidas abre em /corpo/medidas.

**Ação principal:** Botão central (+) de 64 px, elevado 8 px acima da barra, que abre a folha Registar. A barra fica: Hoje · Balanço · (+) · Treino · Corpo. As Definições abrem pelo avatar «J» no cabeçalho.

A navegação usa URLs reais: /hoje, /hoje/2026-09-27, /balanco, /treino, /treino/ginasio, /treino/:id (bicicleta e outros abrem Confirmar treino em modo de edição; ginásio abre Sessão de ginásio em modo de edição), /corpo, /corpo/medidas, /favoritos, /definicoes, /definicoes/ligacoes, /definicoes/avancado, /definicoes/arquivo. As folhas abrem com ?folha=registar|peso|medidas|refeicao|treino|joelho&id=…, por isso recarregar mantém o ecrã e um lembrete pode abrir o sítio certo.

Regras de navegação:
- No máximo uma folha aberta de cada vez; o que antes abria uma folha por cima de outra expande dentro da mesma (por exemplo, Corrigir dentro de Rever).
- Favoritos e Arquivo são páginas com «‹ Voltar», não folhas.
- Cada ecrã que não é separador tem «‹ Voltar», porque a PWA em ecrã inteiro no iOS não garante o gesto de voltar.
- Não há deslizar para mudar de dia.
- Quando o Hoje mostra um dia passado, a folha (+) abre com «A registar em sáb 27 set · mudar» e tudo o que se registar vai para esse dia.

**Folha (+):**
- Linha 1 (72 px): 📷 Fotografar (abre a câmara) · 🖼 Galeria (várias fotos tiradas antes)
- Linha 2: ✎ Escrever ou ditar (pelo microfone do teclado, com «📷 Juntar foto»; lá dentro, ligações pequenas para «Código de barras» e «Só números»)
- Linha 3: Favoritos em grelha fixa de 2 × 3 (os 6 mais prováveis para a hora do dia), mais «Igual a ontem · almoço» quando existe e «Todos ›»
- Linha 4: ⚖ Peso · 🚲 Treino · 📏 Medidas (a partir da Fase 4). Um ponto marca o que é relevante agora (Peso antes das 11:00 sem pesagem; Treino com um print por confirmar); os botões nunca mudam de lugar
- 🚲 Treino abre a folha Treino: Bicicleta habitual e outros treinos favoritos · Já fiz · Ginásio (Fase 5) · Juntar print do relógio

## Ecrãs e folhas


### Hoje (hoje)

_Mostrar em 2 segundos quanto ainda pode comer e deixar registar a partir do que falta, sem ruído nem culpa._

- Cabeçalho: à esquerda «seg 29 set»; à direita o chip «2 à espera de rede» (só com fila) e o avatar «J», que abre as Definições.
- Faixa da semana S T Q Q S S D só com as datas: hoje em destaque, sem pontos nem contadores. Tocar num dia abre-o; ‹ › mudam de semana. Num dia passado aparece «A ver sáb 27 · Voltar a hoje».
- Cartão principal: «Podes comer mais 820» (56 px) e, por baixo, «de 1 880 do plano de hoje».
- Barra de energia na cor Comer e barra «Proteína 82 de 140 g» na cor Proteína. Hidratos e gordura ficam na folha O plano de hoje.
- Com uma foto em análise, o número fica esbatido: «Podes comer mais cerca de 820 · ainda a contar 1 foto». Quando os números chegam, anima até ao valor final.
- Acima do plano mas abaixo do gasto: texto âmbar e barra com padrão tracejado (não só cor): «Passaste 150 do plano, mas continuas a comer menos do que gastas.» Acima do gasto: «Passaste 150 do plano. A semana conta mais do que o dia.»
- Chip «Semana de pausa da dieta» quando se aplica. Tocar no cartão abre a folha O plano de hoje. Quando entra um treino, o número anima «+380 do treino».
- Linhas do joelho, fixas no topo da linha do dia e fora da fila do Próximo passo: «Joelho depois da bicicleta de ontem?» [Bem] [Algum incómodo] [Doeu]. Ficam até haver resposta ou passarem 48 h. O mesmo para um treino sincronizado sem resposta «durante» (Fase 7).
- Cartão Próximo passo (0 ou 1, regras fixas, sem IA). Aparece o primeiro que se aplicar:
-   1. Refeição com erro: «Não consegui ler a foto das 13:05» [Tentar de novo] [Escrever o que era]
-   2. Limite da IA: «Chegaste ao limite que definiste (10 €). A foto das 13:05 está guardada.» [Analisar esta mesmo assim] [Subir limite] [Escrever em vez disso]
-   3. Print por confirmar: «Bicicleta 45 min · falta confirmar» [Confirmar]
-   4. Antes das 11:00 sem pesagem: «Bom dia. Pesa-te?» [Pesar]
-   5. Dia anterior com 1 ou 2 refeições e sem resposta: «Ontem registaste 2 refeições. Foi tudo?» [Sim, foi tudo] [Não, faltou algo]
-   6. Depois das 20:00 com refeições por confirmar: «2 refeições por confirmar» [Rever]
-   7. Depois das 20:00 com menos de 1 200 kcal: «Hoje comeste pouco. Um lanche com proteína ajuda o músculo e o joelho.» com chips de favoritos ricos em proteína
-   8. Depois das 19:00 com menos de 60 % da proteína: «Ainda tens espaço para proteína» (Batido 30 g) (Frango habitual 45 g); 1 toque regista, com Anular
-   9. Medições há 14 dias ou mais (a partir da Fase 4): «Medições: há 15 dias · 2 minutos» [Medir]
- Regras dos lembretes (4 a 9): cada um tem «Agora não»; ignorado 2 vezes, pausa 3 dias; os de comida (7 e 8) aparecem no máximo 1 vez por dia.
- Linha do dia, por ordem da hora, com um só número por linha:
-   «07:10 ⚖ 84,6 kg»
-   «08:30 [foto] Pequeno-almoço · 420 kcal ☆»
-   «13:05 [foto] A analisar… · ＋ Nota»
-   «16:00 [foto] Lanche · ≈ 250 kcal · ● por confirmar» (ponto âmbar)
-   «18:40 🚲 Bicicleta · 45 min» (ponto do joelho só se for amarelo ou vermelho)
- Linha de lacuna: no máximo 1 por dia e só se existir um favorito habitual para esse momento: «Ainda sem almoço · (Almoço habitual) · 📷 · Não mostrar isto».
- Tocar num item abre a sua folha, onde «Apagar» está sempre visível. Deslizar para a esquerda é só um atalho para apagar, com «Apagado · Anular» durante 10 s.
- Um item acabado de registar mostra durante 60 s «acabado de registar · Anular» na própria linha, para apanhar toques sem querer.
- Menu ⋯ do dia: «Apagados (últimos 7 dias)» para repor o que foi apagado.

**Ações:** (+) Registar · Tocar no cartão principal: folha O plano de hoje · Joelho: Bem · Algum incómodo · Doeu · Botões do Próximo passo e «Agora não» · Lacuna: 📷 ou favorito com 1 toque · Tocar num item: abre a folha do item · Deslizar num item: apagar, com Anular · Faixa da semana: ir a outro dia · ＋ Nota num cartão «A analisar…»

**Estado vazio:** Cartão principal «Podes comer 1 500 hoje» e, na linha do dia: «O teu dia começa aqui. Toca em + e tira uma foto ao que comes. Eu faço as contas.» Botão grande [Fotografar] e, em segundo plano, [Ou pesa-te primeiro].

### Folha Registar (+) (registar)

_Uma só porta de entrada, sempre com o mesmo desenho: o que se faz 4 vezes por dia é grande, o que se faz uma vez por mês é pequeno._

- Pega de arrastar em cima; fecha a deslizar para baixo.
- Num dia passado, cabeçalho «A registar em sáb 27 set · mudar». Tudo o que se registar fica nesse dia, à hora habitual de cada momento (a hora EXIF de uma foto ganha, e o aviso diz o dia).
- Linha 1: [📷 Fotografar] e [🖼 Galeria], botões de 72 px em 2 colunas.
- Linha 2: [✎ Escrever ou ditar].
- Linha 3: «Favoritos» em grelha fixa de 2 × 3 (os 6 mais prováveis para a hora; de manhã, pequenos-almoços), mais «Igual a ontem · almoço» quando existe e «Todos ›». Sem scroll lateral; um movimento de mais de 8 px conta como scroll e não regista.
- Toque num favorito: regista logo e mostra «Registado · Porção ½ · 1½ · 2 · Anular» durante 10 s (tocar numa porção corrige a porção).
- Linha 4: [⚖ Peso] [🚲 Treino] [📏 Medidas]. Um ponto discreto marca o que é relevante agora; nada muda de lugar.
- [🚲 Treino] abre a folha Treino.

**Ações:** Fotografar: <input type=file accept=image/* capture=environment> · Galeria: <input type=file accept=image/* multiple>, sem capture · Escrever ou ditar · Favorito: 1 toque (porção ajustável no aviso) · Igual a ontem · Peso · Treino · Medidas · Mudar o dia (num dia passado)

**Estado vazio:** Sem favoritos, a grelha mostra: «Toca na ☆ de uma refeição ou treino para o guardares aqui. Depois registas com 1 toque.»

### Folha Treino (folha-treino)

_Escolher como registar um treino, com um só nome para cada ação._

- Treinos favoritos no topo, em botões grandes: «Bicicleta habitual · 45 min · 140 W» e, a partir da Fase 5, «Pernas A».
- [Já fiz] · [Ginásio] (Fase 5) · [Juntar print do relógio].
- Um favorito de bicicleta abre a folha Joelho e só depois guarda. Um favorito de ginásio abre a Sessão de ginásio já preenchida.
- Num dia passado mantém o cabeçalho «A registar em sáb 27 set · mudar».

**Ações:** Favorito de treino · Já fiz · Ginásio · Juntar print do relógio

**Estado vazio:** Antes de haver favoritos: «Bicicleta habitual» já vem criada a partir das tuas últimas sessões (ou 30 min a 130 W, se ainda não houver nenhuma).

### Folha Joelho (joelho)

_Registar a dor do joelho em 1 toque sempre que um treino é guardado sem passar por outro formulário._

- Pergunta: «Como esteve o joelho durante a bicicleta?» (ou «depois da sessão de ontem?» para o dia seguinte).
- [Bem] [Algum incómodo] [Doeu], botões de 56 px, que valem 1, 4 e 7 na escala do semáforo.
- «mais detalhe 0–10», recolhido.
- Depois de responder: «Bicicleta registada · +380 do treino · Anular».

**Ações:** Bem · Algum incómodo · Doeu · Mais detalhe 0–10

**Estado vazio:** Não se aplica.

### Folha Data e hora (data-hora)

_Um só seletor de dia e hora para todos os registos (Mudar hora, Copiar para outro dia, Já fiz, Pesagem, Galeria)._

- Dia em chips: Hoje · Ontem · Anteontem · 📅 (calendário).
- Momento em chips com a hora habitual: Pequeno-almoço 08:00 · Almoço 13:00 · Lanche 16:30 · Jantar 20:00 · Ceia 22:30.
- «Hora exata» recolhida (roda de horas e minutos).
- A pesagem só usa o dia.

**Ações:** Escolher dia · Escolher momento ou hora exata · Confirmar

**Estado vazio:** Não se aplica.

### Folha Fotos da galeria (galeria)

_Pôr fotos tiradas mais cedo na refeição, hora e dia certos, e juntar uma nota, sem esperar pela análise._

- Título, por exemplo «3 fotos → 3 refeições».
- As fotos são processadas uma de cada vez (o ficheiro original vai primeiro para a fila local), para o iOS não fechar a app por falta de memória.
- Um grupo por refeição, cada um com miniaturas, a hora lida do EXIF da foto original («08:12 · ontem ▾») e o momento deduzido («Pequeno-almoço ▾»).
- Só fotos com hora conhecida e com 15 min ou menos de diferença se juntam numa refeição (prato e rótulo, por exemplo). [Separar] divide um grupo; cada miniatura tem [Mover para…].
- Foto sem hora (guardada do WhatsApp, captura de ecrã): fica sempre sozinha, com «Quando foi?» e chips obrigatórios Hoje/Ontem × Pequeno-almoço/Almoço/Lanche/Jantar. A data do ficheiro só se usa se for mais de 2 minutos antes de agora.
- Em cada grupo: chips de nota (Comi metade · Com azeite · Sem molho · Porção grande · Jantar fora) e o campo «Nota» com o microfone do teclado.
- Uma foto já registada (mesmo SHA-256) mostra «Esta foto já está no dia 27 · Abrir» e não é enviada outra vez.
- Botão fixo em baixo: [Analisar (3)], só ativo quando todas as fotos sem hora têm dia e momento. A folha fecha e aparecem 3 cartões «A analisar…» nos dias certos.

**Ações:** Editar hora e momento · Separar ou Mover para… · Chips de nota e ditado · Analisar

**Estado vazio:** Não se aplica: esta folha só abre depois de escolher fotos.

### Folha Nota (nota)

_Acrescentar «uma ou outra coisa escrita» a uma foto já enviada, sem pressa._

- Miniatura da refeição e hora.
- Chips: Comi metade · Com azeite · Sem molho · Porção grande · Jantar fora (guardados em meals.tags, além do texto).
- Campo «Nota» («Ex.: comi metade, com azeite») com o microfone do teclado.
- [Guardar], fixo no fundo.
- Texto pequeno: com a análise a correr, «Junto a nota à análise»; já terminada, «Vou corrigir a refeição com esta nota». Nos dois casos a nota é aplicada (ver o controlo de concorrência no R1).

**Ações:** Chip · Escrever ou ditar · Guardar

**Estado vazio:** Não se aplica.

### Folha Escrever ou ditar (escrever)

_Registar por texto ou voz, ou descrever a refeição e juntar uma foto na mesma análise._

- Área de texto grande («Ex.: 2 ovos mexidos, 1 torrada, café com leite»), enterkeyhint=done, microfone do teclado do iOS.
- [📷 Juntar foto]: opcional; texto e foto seguem numa só chamada ao Sonnet.
- Chips de momento e dia («Agora ▾», abre a folha Data e hora) e «Jantar fora».
- Ligações pequenas: «Código de barras» · «Só números».
- [Enviar], fixo no fundo. A folha fecha, aparece o cartão «A analisar…» (Haiku, cerca de 2 s) e a refeição conta quando os números chegam.

**Ações:** Escrever ou ditar · Juntar foto · Mudar dia ou hora · Código de barras · Só números · Enviar

**Estado vazio:** Não se aplica.

### Folha Refeição (refeicao)

_Ver, confirmar, corrigir, repetir, guardar como favorito ou apagar uma refeição, com os itens sempre visíveis._

- Carrossel de fotos (miniatura de 256 px, foto de 1024 px por URL assinado); tocar amplia.
- Chips «Almoço ▾» e «13:05 ▾» (folha Data e hora). Mudar a hora pode passar a refeição para outro dia nutricional; o servidor recalcula os dois dias.
- Nota e chips de nota, editáveis.
- Totais: «≈ 640 kcal · Proteína 42 g · Hidratos 60 g · Gordura 22 g» (≈ só se for estimada; kcal arredondadas a 10).
- Itens, um por linha: «Arroz branco · 180 g · 230 kcal» com [−] e [+] de 10 g; kcal e macros escalam em proporção. Itens incertos com a etiqueta âmbar «confirma a porção». «+ Adicionar item» pesquisa nos teus alimentos ou lê um código de barras.
- «Corrigir por texto» («Ex.: o arroz era metade, sem queijo»): Haiku sem reenviar a foto; mostra a diferença «Arroz 180 → 90 g · menos 115 kcal · Anular».
- Rodapé fixo, sempre visível: [Está certo] (só se estiver por confirmar) · [☆ Favorito] · [Repetir hoje] · [Apagar]. No ⋯: Copiar para outro dia · Reanalisar foto.
- Depois de uma correção: «Aprendido: a tua taça de aveia ≈ 60 g».
- Depois da 3.ª refeição parecida, uma única vez: «Registas isto muitas vezes. Guardar como favorito?» [Guardar] [Não voltar a perguntar].

**Ações:** Está certo · Stepper de porção · Corrigir por texto · ☆ Favorito · Repetir hoje · Copiar para outro dia · Reanalisar foto · Apagar (com Anular)

**Estado vazio:** Em análise: fotos, nota e «A analisar…», com «＋ Nota». Com erro: «Não consegui ler esta foto.» [Tentar de novo] [Escrever o que era]. Sem análise por limite: [Analisar esta mesmo assim] [Escrever em vez disso].

### Folha Rever refeições (rever)

_Confirmar ao fim do dia as refeições em que a IA teve dúvidas. É opcional: essas refeições já contam, com ≈._

- «1 de 3», sem barra de progresso nem mensagem de conclusão.
- Um cartão por refeição: foto grande, itens e total.
- Só botões, sem gestos: [Está certo] [Corrigir] [Depois]. «Corrigir» expande os itens e o «Corrigir por texto» dentro do mesmo cartão (nunca abre outra folha por cima).
- Cada «Está certo» mostra «Confirmado · Anular».

**Ações:** Está certo · Corrigir (no próprio cartão) · Depois

**Estado vazio:** «Nada por confirmar.»

### Favoritos (favoritos)

_Ver e gerir tudo o que se repete: refeições, treinos e a biblioteca de alimentos (o único sítio onde esta vive)._

- Página em /favoritos com «‹ Voltar» e os segmentos Refeições · Treinos · Alimentos.
- Refeições: grelha de 2 colunas com foto, nome e «420 kcal · 32 g de proteína».
- Treinos: «Bicicleta habitual · 45 min · 140 W»; «Pernas A · 5 exercícios» (Fase 5).
- Alimentos: a biblioteca com as porções aprendidas; editar ou apagar.
- Toque regista agora, com «Registado · Porção ½ · 1½ · 2 · Anular». Cada cartão tem [⋯]: Mudar hora · Editar · Arquivar.
- [+ Novo favorito]: a partir de uma refeição anterior ou de itens; para treino, bicicleta ou ginásio.

**Ações:** Registar · Porção · Editar · Arquivar · Novo favorito

**Estado vazio:** «Toca na ☆ de uma refeição ou treino para o guardares aqui. Depois registas com 1 toque.»

### Folha Editar favorito (favorito-editar)

_Ajustar nome, porções ou rotina de um favorito._

- Nome, pré-preenchido pela IA («Iogurte + aveia + banana»).
- Refeição: momento por omissão, itens com steppers, totais ao vivo e miniatura.
- Bicicleta: minutos e watts.
- Ginásio (Fase 5): exercícios do catálogo seguro para o joelho, séries e «8–12 repetições».
- [Guardar] · [Arquivar]

**Ações:** Guardar · Arquivar

**Estado vazio:** Não se aplica.

### Folha O plano de hoje (orcamento)

_Explicar em linguagem simples a diferença entre o que pode comer (o plano) e o que gasta, sem nunca parecer contraditório._

- A partir da Fase 6: «Gastas cerca de 2 580 hoje.» e «O plano deixa-te comer 1 880 para perderes cerca de 0,6 kg por semana.» Antes de haver 10 dias completos, «Gastas cerca de 2 580 hoje (a aprender)».
- «Plano: 1 500 + 380 do treino = 1 880». A linha do treino é tocável e abre o treino.
- «Comeste 1 060 · Podes comer mais 820».
- «Proteína 82 de 140 g · Hidratos 95 g · Gordura 38 g».
- Acima do plano mas abaixo do gasto: «Passaste 150 do plano, mas continuas a comer menos do que gastas.»
- Depois das 20:00 com menos de 1 200 kcal: «Hoje comeste pouco. Um lanche com proteína ajuda o músculo e o joelho.» (nunca uma projeção do tipo «se não comeres mais»).
- Semana de pausa da dieta: «Esta semana o plano é comer o que gastas (2 200) para o corpo descansar da dieta. ⓘ»
- Treinos do dia com as kcal contadas e a razão: «pela potência (140 W × 45 min)», «150 fixas por ginásio de 30 min ou mais», «70 % das calorias do relógio», «≈ com 140 W da última sessão».
- ⓘ «Como sei quanto gastas?»: «Primeiro por uma fórmula com a tua altura, peso e idade. Depois de 10 dias completos, pelo que comes e pelo que o teu peso faz.»

**Ações:** Tocar num treino · ⓘ Como sei quanto gastas?

**Estado vazio:** Sem treino: «Plano: 1 500. Um treino aumenta o que podes comer.»

### Balanço (balanco)

_Responder numa frase a «estou a comer menos do que gasto, e o peso confirma?», com um só gráfico._

- Cabeçalho «22–28 set ‹ ›».
- Frase principal (regras, sem IA): «Esta semana comeste cerca de 600 kcal por dia menos do que gastaste. O peso médio está a descer 0,4 kg por semana.»
- A partir da 3.ª semana com dados, uma frase de coerência que usa o gasto medido até ao início da semana (sem a semana atual): «Bate certo.» se a diferença entre o previsto e o peso for de 0,25 kg por semana ou menos; senão «As contas e o peso ainda não coincidem esta semana. É normal: água e sal mexem no peso, e a app ajusta o gasto sozinha.»
- Um gráfico: 7 barras do que comeu (cor Comer) e uma linha do gasto (cor Gasto). Dias sem registo simplesmente não aparecem. Tocar numa barra abre esse dia no Hoje.
- Resumo da semana (gerado à segunda-feira ou no primeiro dia em que falte): 4 a 6 frases neutras.
- Aviso âmbar só quando se aplica: «Esta semana comeste menos de 1 400 por dia em média. Come um pouco mais: perder devagar protege o músculo e o joelho.»
- «Ver detalhes ›», recolhido:
-   «Proteína média 128 g por dia» e «Hidratos 180 g · Gordura 60 g por dia (média)»;
-   «Treino: 3 sessões · 135 min · +910 no plano»;
-   «Gasto medido pelo teu peso: cerca de 2 150 por dia. A fórmula dizia 2 450.» Se ficar mais de 300 abaixo em 3 semanas seguidas: «Pode ser porções maiores do que as fotos mostram, ou um gasto mais baixo do que o normal. A app já usa o valor medido, por isso o plano continua certo.»;
-   sugestão de plano base, quando mudar pelo menos 100: «Para perderes cerca de 0,5 kg por semana, o plano base podia ser 1 600.» [Aplicar] (com Anular);
-   passos e sono médios, se o Atalho os enviar.
- Antes de haver 10 dias completos: «Mais 6 dias completos e passo a medir o teu gasto pelo peso. Até lá uso uma fórmula.» Se faltar o ano de nascimento, pergunta ali mesmo: «Em que ano nasceste?» (campo de 4 dígitos, opcional).

**Ações:** ‹ › mudar de semana · Tocar numa barra: abre o dia · Ver detalhes · Aplicar sugestão de plano base (com Anular) · Ano de nascimento (inline)

**Estado vazio:** «Regista alguns dias e aqui aparece a tua semana.»

### Treino (treino)

_Registar o treino em poucos toques e mostrar o que gastou, como progride e como reage o joelho. Não há plano gerado pela IA._

- Cartão «Esta semana» (escondido quando ainda não há sessões): «3 sessões · 135 min · +910 no plano» e «Joelho: tudo bem» ou «1 sessão com incómodo».
- Ações principais, 56 px: [🚲 Bicicleta habitual · 45 min · 140 W] e [Já fiz]. Secundárias: [Juntar print do relógio] e, a partir da Fase 5, [Ginásio]. Com o intervals.icu ligado (Fase 7): [Sincronizar agora] e «Sincronizado há 4 min».
- Sugestão seguinte (regras 10 e 11, só com o joelho verde na última sessão):
-   «Próxima bicicleta: 60 min a 140 W» ou «Próxima vez: 150 W durante 30 min, para testar» (degraus 130 · 140 · 150 das Definições);
-   sem batimentos nas últimas sessões: «Para subir a potência preciso dos batimentos: junta o print do relógio ou escreve os batimentos médios.»;
-   sem resposta do joelho: «Diz como ficou o joelho para eu sugerir o próximo passo.»;
-   sem histórico: «Começa com 30 min a 130 W e diz como ficou o joelho.»;
-   ginásio (Fase 5): «Leg press: fizeste 3×12 a 60 kg → hoje 62 kg».
- Histórico em cartões: ícone e duração; o número-chave (bicicleta «140 W · 88 rpm»; ginásio «6 exercícios · 18 séries»); «+378 no plano»; ponto do joelho; origem («print Garmin», «Garmin (auto)», «à mão», «favorito»). Carrega mais com scroll. Tocar abre /treino/:id; «Apagar» está no detalhe (deslizar é atalho, com Anular).
- Progressão: potência e batimentos por sessão (o gráfico atual, com anotações quando os watts mudam), minutos por semana e, a partir da Fase 5, carga por exercício.
- Joelho: pontos ao longo do tempo com as cores do semáforo e a regra numa linha («verde até 2 · amarelo 3–5 · vermelho 6 ou mais; só sobes carga com verde»). Com 6 ou mais sessões em cada grupo: «Dor de 3 ou mais aparece mais depois de sessões com mais de 45 min».
- Até à Fase 5: secção «Plano de força atual» com a sessão do bloco antigo e o registo de séries atual (sem capítulo nem patrono).
- Treinos favoritos.

**Ações:** Bicicleta habitual · Já fiz · Juntar print do relógio · Ginásio (Fase 5) · Sincronizar agora (Fase 7) · Abrir um treino · Favorito de treino

**Estado vazio:** «Regista o primeiro treino: toca em Bicicleta habitual ou em Já fiz. Se usas relógio, podes juntar o print depois.»

### Folha Confirmar treino (confirmar-treino)

_Rever o que a IA leu dos prints ou da foto da consola, juntá-lo a uma sessão já registada ou guardar uma nova. É também o detalhe editável de um treino de bicicleta ou outro já guardado._

- Enquanto lê: «A ler o print…» (5 a 15 s) com [Fechar, aviso quando estiver pronto]. O rascunho vive em workout_imports e nunca conta até ser guardado; no Hoje aparece como Próximo passo «falta confirmar».
- Se já existe uma sessão parecida (mesmo tipo e dia nutricional, duração dentro de max(3 min, 10 %), início a menos de 30 min): «Juntar à Bicicleta das 07:10 (45 min)?» já escolhido, com [Juntar] [Guardar como novo]. Juntar preenche o que falta (batimentos, rpm, distância) e mantém joelho, watts da consola ou à mão e a ligação ao favorito.
- Miniaturas dos prints; tocar amplia para comparar.
- Tipo em chips: Bicicleta · Ginásio · Caminhada · Outro. Dia e hora (folha Data e hora). Duração.
- Bicicleta: Potência (watts) e rpm. Todos: batimentos médios e máximos.
- Campos incertos a âmbar com «confirma»; vazios com «— adicionar».
- Bicicleta sem watts: «Qual era a potência na bicicleta?» (130) (140) (150) [outro], com os últimos watts confirmados escolhidos (≈), e [📷 Foto da consola]. Se ficar o valor sugerido, fica marcado como suposto e não conta para subir a potência.
- «O relógio diz 520 kcal. Contamos 378 pela potência (140 W × 45 min), porque os relógios exageram na bicicleta.»
- «Joelho durante o treino» (obrigatório na bicicleta e no ginásio): [Bem] [Algum incómodo] [Doeu], com «mais detalhe 0–10». Se faltar a resposta do dia seguinte da sessão anterior: «E depois da última sessão?» com os mesmos 3 botões.
- Prints de treinos diferentes: «Estes prints parecem de treinos diferentes» [Tratar em separado].
- [Juntar outro print]: nunca reescreve o que o João já editou.
- Rodapé: [Guardar] · [Descartar] · [☆ Favorito].
- Treino já guardado: tudo editável, [Juntar print], [Apagar] e «Próxima vez: 150 W durante 30 min» (só com o joelho verde).

**Ações:** Juntar ou guardar como novo · Escolher o tipo · Editar campos · Watts ou foto da consola · Joelho · Guardar · Descartar · Apagar

**Estado vazio:** Leitura falhada: «Não consegui ler este print.» [Tentar de novo] [Preencher à mão].

### Folha Já fiz (ja-fiz)

_Treino à mão em poucos toques, em qualquer dia e hora._

- Tipo em chips: Bicicleta · Ginásio · Caminhada · Outro (já no tipo da última sessão).
- «Agora ▾» (folha Data e hora; permite um dia passado).
- Duração em chips: 30 · 45 · 60 · 90 · outro.
- Bicicleta: watts em chips (130 · 140 · 150), já com o último valor; «Batimentos médios (opcional)» com a explicação «para a app poder subir a potência».
- Outro: «Calorias do relógio (opcional)». Sem elas, a app estima pela duração e pelo peso.
- Joelho: 3 botões.
- [Guardar] → «Bicicleta registada · +378 no plano · Anular».

**Ações:** Guardar

**Estado vazio:** Não se aplica.

### Sessão de ginásio (ginasio)

_Registar séries de 8 a 12 repetições sem plano, com as cargas da última vez já preenchidas (Fase 5). Serve também para corrigir uma sessão antiga._

- Ecrã inteiro em /treino/ginasio (nova) ou /treino/:id (edição). Em cima: cronómetro e «Começar de um favorito ▾» (Pernas A, Corpo todo B).
- [+ Exercício] mostra só os exercícios do catálogo seguro para o joelho.
- Por exercício: séries preenchidas com a última vez («10 × 40 kg»), sugestão «Hoje: 42 kg» (regra 11), [✓ série] com 1 toque, − e + para repetições e kg; «mais» esconde o «Esforço 1–10».
- Primeira vez num exercício: «Primeira vez: escolhe um peso com que faças 12 repetições com folga.»
- [+ série] copia a anterior.
- [Terminar] pede o joelho em 3 botões e guarda. Depois: [☆ Guardar como favorito].

**Ações:** ✓ série · Ajustar repetições e kg · + Exercício · Terminar · Editar sessão antiga

**Estado vazio:** Mostra os favoritos «Pernas A» e «Corpo todo B» e «Ou escolhe o primeiro exercício. Só aparecem os que são seguros para o joelho.»

### Corpo (corpo)

_Mostrar o resultado em 3 cartões: peso médio, gordura e massa magra, cintura._

- Cartão Peso: «Peso médio 84,9 kg» e, com 14 dias e 8 pesagens, «a descer 0,4 kg por semana». Em pequeno e neutro: «Hoje 85,2» (escondido no Modo calmo). [Pesar].
-   Gráfico: pesagens em pontos esbatidos, peso médio em linha forte, meta de 75 kg numa linha tracejada e, em texto, «Meta: cerca de fevereiro–março». Períodos 1M · 3M · Tudo. Legenda: «O peso de cada dia varia ±1 kg com água e sal. Olha para a linha.»
-   O peso médio é calculado no telemóvel a partir de weights (a mesma função pura do servidor), por isso uma pesagem de um dia passado aparece logo.
-   Cor só fora da faixa segura: «Estás a perder depressa (mais de 0,85 kg por semana). Come um pouco mais para proteger o músculo.» ou «Peso estável há 3 semanas. A app ajusta o gasto sozinha.»
- Cartão Gordura e massa magra (Fase 4): barra empilhada magra | gordura; «Gordura 17,5 kg (cerca de 21 %)»; «Massa magra 67,5 kg (músculo, água, osso, órgãos)»; «Medido há 12 dias».
-   Com 2 medições ou mais: «Desde 1 set: cerca de 2 kg de gordura a menos, massa magra estável», seguido de «a fita já confirma esta descida» ou «ainda dentro da margem da fita, confirma na próxima medição».
-   Nas primeiras 3 semanas de dieta: «Nas primeiras semanas perdes água e glicogénio, não músculo.»
-   Com a balança de gordura ligada: linha à parte «Balança: cerca de 23 % (média) · outra forma de medir, não se mistura».
-   [Como é calculado? ⓘ]: método da fita, o intervalo provável (17–25 %), a margem da fita (±0,5 kg entre medições) e o gráfico das medições.
- Cartão Cintura (Fase 4): «94,0 cm · alvo cerca de 86 cm» e um mini-gráfico das medidas tal como foram tiradas. [Medir].
- «Histórico de medidas ›» abre /corpo/medidas.

**Ações:** Pesar · Medir · 1M · 3M · Tudo · Como é calculado? · Histórico de medidas

**Estado vazio:** Sem pesagens: «Pesa-te de manhã. Com 3 pesagens mostro o teu peso médio.» Com 1 ou 2: «Mais 2 pesagens e mostro o teu peso médio.» Sem medidas (Fase 4): «Mede a cintura e o pescoço: 2 minutos com uma fita métrica chegam para estimar a gordura e a massa magra.» [Medir agora] [Como medir]. Com 1 medição: «Na próxima medição mostro o que mudou.»

### Folha Pesagem (pesagem)

_Pesagem diária em 2 toques mais o número, sem gravar sem querer o peso de ontem._

- Campo grande (48 px) já com o teclado numérico aberto (inputmode=decimal, aceita vírgula). O último valor aparece a cinzento como sugestão («ontem 84,6»), não como valor.
- [−0,1] e [+0,1] de 48 px: o primeiro toque parte da sugestão.
- Dia: [Hoje ▾] (folha Data e hora, só o dia).
- Com a balança de gordura ligada nas Definições: campo opcional «% de gordura da balança», guardado na mesma linha de weights.
- Se o valor diferir mais de 3 kg do peso médio: «Queres dizer 85,4?» [Sim, 85,4] [Não, está certo] (ou «Confirma: 58,4 kg?» quando não há troca óbvia).
- Texto pequeno: «De manhã, depois da casa de banho, antes de comer, sem roupa.»
- [Guardar], fixo no fundo. A seguir: «Guardado · peso médio 84,9 · Anular».
- Se falta a resposta do joelho de ontem, a confirmação inclui: «E o joelho depois da bicicleta de ontem?» [Bem] [Algum incómodo] [Doeu].
- Se a pesagem ficar mais de 1 kg acima do peso médio: «Subida de água, normal depois de refeições mais salgadas ou de treino de força. Olha para o peso médio.»
- Tocar na linha do peso no Hoje reabre esta folha com o valor, para corrigir.

**Ações:** Escrever o peso · ±0,1 · Mudar dia · Guardar · Joelho (se pendente)

**Estado vazio:** Primeira pesagem: campo vazio com o teclado aberto, sem sugestão.

### Folha Medidas (medidas)

_Registar as medidas quando quiser e ver logo a gordura e a massa magra (Fase 4)._

- «Essenciais (1 min)»: Pescoço e Cintura (umbigo), cada um com «última: 94,0» e [Como medir? ⓘ]. O «Seguinte» do teclado avança.
- No cabeçalho, o interruptor «Medir 2 vezes (mais rigor)»: com ele ligado, cada zona pede 2 leituras e uma 3.ª só se diferirem mais de 1 cm; a app faz a média.
- Peso usado: o peso médio no dia, calculado no telemóvel e guardado em weight_used_kg (fica fixo para essa medição). Se não houver pesagem nos últimos 7 dias, aparece o campo «Peso de hoje», que também grava em weights.
- «Opcionais», recolhido: peito, anca, braço, coxa (15 cm acima da rótula), gémeo.
- Validação no telemóvel, com a mesma constante de limites de composicao.ts e texto simples: «40 cm na cintura? Parece pouco. Confirma.» Nunca aparece um erro técnico.
- Avisos que não bloqueiam: semana de pausa da dieta, manhã depois de «Jantar fora», pescoço mudou mais de 1,5 cm, cintura mudou mais de 3 cm em 14 dias, gordura fora de 5–45 %. A medição fica marcada com o aviso.
- Se já existe uma medição nesse dia: «Já mediste hoje. Substituir a medição de hoje?» [Substituir] [Cancelar].
- [Guardar]. Resultado na mesma folha: «Gordura 17,5 kg (cerca de 21 %) · Massa magra 67,5 kg · Cintura 94,0 cm · alvo cerca de 86 cm». A partir da 2.ª: «Desde 1 set: cerca de 2 kg de gordura a menos, massa magra estável». [Ver no Corpo].

**Ações:** Escrever leituras · Medir 2 vezes · Abrir opcionais · Guardar · Substituir · Ver no Corpo

**Estado vazio:** Primeira medição: «Chegam a cintura e o pescoço. A altura (183 cm) já está no perfil.»

### Histórico de medidas (medidas-historico)

_Ver, corrigir e apagar medições antigas._

- Página em /corpo/medidas com «‹ Voltar».
- Lista de cartões por data, uma linha por medida com a mudança: «1 set · Cintura 94,0 cm (0,5 a menos) · Pescoço 40,0 cm · Gordura cerca de 17,5 kg».
- Tocar num cartão abre a folha Medidas já preenchida para editar.
- [Apagar] no cartão aberto, com «Apagado · Anular» durante 10 s (o telemóvel guarda a linha para a repor).

**Ações:** Abrir e editar · Apagar (com Anular)

**Estado vazio:** «Ainda não há medições.» [Medir agora]

### Folha Como medir (como-medir)

_Ensinar o protocolo numa frase por zona._

- «Antes de medir: de manhã, em jejum, depois de ires à casa de banho, antes de treinar. De pé, pés juntos, sem t-shirt. Fita encostada à pele, sem apertar.»
- Pescoço: «logo abaixo da maçã de Adão, com a fita a descer ligeiramente para a frente; olha em frente.» Com um desenho pequeno.
- Cintura: «na horizontal, à altura do umbigo; lê no fim de uma expiração normal, sem encolher a barriga.» Com um desenho pequeno.
- Opcionais, uma linha cada: peito (linha dos mamilos), anca (maior volume), braço (a meio, relaxado), coxa (15 cm acima da rótula), gémeo (maior volume).
- «Se quiseres mais rigor, liga Medir 2 vezes.»

**Ações:** Fechar

**Estado vazio:** Não se aplica.

### Folha Código de barras (codigo-barras)

_Registar um produto embalado a partir do Open Food Facts._

- Leitor da câmara (o que já existe).
- Resultado: nome, porção em g com stepper, kcal e macros proporcionais.
- [Guardar]

**Ações:** Ler · Ajustar porção · Guardar

**Estado vazio:** «Não encontrei este código. Tira uma foto ao rótulo.» [Fotografar]

### Folha Só números (so-numeros)

_Registo rápido quando o João já sabe os valores._

- Kcal e Proteína (obrigatórios); Hidratos e Gordura (opcionais); Nome (opcional); momento e dia.
- Guarda-se como um item sintético «Registo rápido», para uma edição posterior nunca pôr os totais a zero.
- [Guardar]

**Ações:** Guardar

**Estado vazio:** Não se aplica.

### Definições (definicoes)

_Perfil, metas, bicicleta, ligações e dados, com etiquetas simples._

- Perfil e metas: Altura (183 cm), Sexo (já preenchido), Ano de nascimento, Peso-meta (75 kg), «Plano base por dia, sem treino» (1 500) com uma linha de explicação, «Proteína por dia» (140 g), «Proteína por refeição principal» (35 g), Hidratos e Gordura só como referência, «Medir a cada» (14 dias, Fase 4), «Semana de pausa da dieta» com explicação e interruptor.
- Bicicleta: «Potências que usas» (130 · 140 · 150), «Batimentos médios máximos» (112), «Batimentos máximos» (125), «Rotações mínimas (rpm)» (85), «A consola mostra os watts?», «Gravas os treinos num relógio Garmin?».
- Balança: «A minha balança mede gordura» (mostra o campo na Pesagem).
- Ligações (só com relógio Garmin, Fase 7): «Treinos automáticos (intervals.icu)»; «Atalho Apple Saúde» (o código fica escondido atrás de [Mostrar]); «Strava: a ligação direta precisa de subscrição paga. Usa o print.»
- Aparência: Tema Sistema / Escuro / Claro · Modo calmo.
- Privacidade: PIN Desligado / Pedir após 12 h / Sempre · Terminar sessão.
- Os meus dados: Exportar CSV (nomes em PT; inclui favoritos, medidas e treinos).
- Avançado ›: custos da IA em €, limite mensal e informações técnicas.
- Arquivo ›: capítulos, linha do tempo, resumos antigos e fotos dos capítulos, só de leitura.
- O gasto previsto antigo (expected_tdee) deixa de ser editável: passa a ser calculado.

**Ações:** Editar campos · Ligações · Exportar · Avançado · Arquivo · Terminar sessão

**Estado vazio:** Não se aplica.

### Definições › Avançado (definicoes-avancado)

_Guardar longe da vista o que é técnico ou pode causar ansiedade (custos)._

- Custos da IA: «Este mês cerca de 2,10 € · 96 fotos · 8 prints» (convertido de dólares com uma taxa fixa, marcado «aprox.») e «Limite mensal: 10 €» editável.
- «Análises de fotos por dia: até 40» (proteção contra repetições em ciclo).
- Calendário antigo (.ics): a partir da Fase 5, «Deixou de funcionar. Para o tirar do iPhone: Definições › Calendário › Contas › Calendários subscritos › apagar.»
- Versão da app e da base de dados (para suporte).

**Ações:** Mudar limite mensal · ‹ Voltar

**Estado vazio:** Não se aplica.

### Arquivo (arquivo)

_Guardar, só para ver, a parte narrativa antiga._

- Página em /definicoes/arquivo com «‹ Voltar».
- Capítulos (cartaz, patrono, missão) e Linha do tempo, sem ligações para ecrãs que já não existem.
- Resumos antigos do narrador (weekly_reviews com kind = 'narrador').
- Fotos dos capítulos.

**Ações:** Abrir capítulo · ‹ Voltar

**Estado vazio:** «Sem capítulos arquivados.»

### Ligações › Treinos automáticos (ligacoes)

_Configurar o intervals.icu uma única vez (Fase 7). Só aparece se o João disser que grava os treinos num relógio Garmin._

- «Em 5 minutos os treinos do teu Garmin passam a entrar sozinhos.»
- 5 passos numerados, com uma captura de ecrã cada.
- Campo «Cola aqui a chave» e [Testar]. O servidor valida a chave e nunca a mostra de volta.
- [Importar últimos 30 dias]. As pesagens do intervals.icu só entram nos dias sem pesagem tua.
- Estado: «Ligado · sincronizado há 4 min» ou o último erro em linguagem simples.
- [Desligar]

**Ações:** Colar · Testar · Importar 30 dias · Desligar

**Estado vazio:** «Não tens relógio Garmin? Não faz mal: a Bicicleta habitual, o Já fiz e o print chegam.»

### Primeira vez (primeira-vez)

_Arrancar sem configuração: os dados do João já estão no perfil._

- Cartão 1: «Pesa-te», que abre a Pesagem.
- Cartão 2: «Fotografa a próxima refeição.»
- Cartão 3 (a partir da Fase 4): «Mede cintura e pescoço (opcional)», que abre as Medidas.
- O sexo já vem do perfil; o ano de nascimento só é pedido dentro do Balanço, quando é útil.
- Cada cartão pode ser saltado e não volta.

**Ações:** Abrir · Saltar

**Estado vazio:** Não se aplica.

### Entrar e PIN (entrar)

_Sessão Supabase, como hoje. O PIN é só uma conveniência para o ecrã (decisão 23)._

- Login igual ao atual.
- PIN com 4 dígitos grandes, pedido por omissão só depois de 12 h com a app em segundo plano (hoje são 5 min).

**Ações:** Entrar · PIN

**Estado vazio:** Não se aplica.

## Fluxos


### Registar uma refeição por foto, agora — 4 toques

1. (+)
2. Fotografar: a câmara abre logo
3. Disparar
4. «Usar foto». A folha fecha e o Hoje mostra «A analisar…» com a miniatura; o número principal fica esbatido com «ainda a contar 1 foto»
5. Nos bastidores: o ficheiro original entra na fila local, lê-se o EXIF, redimensiona para 1024 px mais miniatura de 256 px, calcula o SHA-256
6. Envia para meal-photos/{uid}/{client_id}/ (upsert) e faz POST /api/meal/capture; o servidor cria a linha a_analisar, responde 202 e analisa em waitUntil
7. O telemóvel pergunta o estado de 3 em 3 s enquanto o ecrã está visível; a refeição passa a ok ou por_rever e o número anima até ao valor final

0 s de espera. A partir da lacuna «Ainda sem almoço 📷» são 3 toques. Hoje são 4 toques, mais 10 a 30 s de espera bloqueante e revisão obrigatória. A fila só larga a foto quando recebe o 202.

### Várias fotos tiradas antes (galeria) — 8 toques

1. (+)
2. Galeria
3. «Fototeca» (menu do iOS)
4. Escolher 3 fotos (3 toques)
5. «Adicionar»
6. Folha Fotos da galeria: «3 fotos → 3 refeições · 08:12 · 13:05 · 20:40». Uma foto do WhatsApp sem hora pede «Quando foi?» (+2 toques)
7. «Analisar (3)»

8 toques para 3 refeições com hora EXIF. Cada uma cai no dia nutricional certo, mesmo carregada depois das 04:00 do dia seguinte. Hoje isto é impossível.

### Registar num dia que ficou para trás — 3 toques

1. Hoje: tocar em «sáb» na faixa da semana
2. (+): o cabeçalho diz «A registar em sáb 27 set · mudar»
3. Favorito «Almoço habitual»: «Registado em sábado · Anular»

O mesmo vale para fotos, texto, Só números, pesagem e treinos.

### Rever à noite as refeições com dúvidas — 4 toques

1. Cartão «3 refeições por confirmar» → [Rever]
2. «Está certo» na primeira
3. «Está certo» na segunda
4. «Está certo» na terceira

Opcional: já contam com ≈. Só aparecem as de confiança baixa. «Corrigir» expande no próprio cartão; «Depois» deixa para mais tarde.

### Juntar uma nota a uma foto já enviada — 3 toques

1. No cartão da refeição, «＋ Nota»
2. Chip «Comi metade» (ou ditar)
3. «Guardar»

Com a análise a correr, a escrita final só aceita o resultado se a nota não mudou; se mudou, aplica o Haiku com a nota nova. Já terminada, aplica o Haiku sem reenviar a foto. Na folha da galeria a nota custa 1 toque.

### Descrever primeiro e depois juntar a foto — 6 toques

1. (+)
2. Escrever ou ditar, e escrever ou ditar o texto
3. «📷 Juntar foto»
4. Disparar
5. «Usar foto»
6. «Enviar»

Texto e foto seguem numa só chamada ao Sonnet.

### Corrigir uma refeição por texto — 3 toques

1. Tocar na refeição
2. «Corrigir por texto» e escrever «o arroz era metade»
3. «Enviar»: «Arroz 180 → 90 g · menos 115 kcal · Anular»

Cerca de 0,2 cêntimos (Haiku, sem imagem). Hoje a correção volta a enviar a foto ao Sonnet.

### Guardar uma refeição como favorito — 3 toques

1. Tocar na refeição
2. «☆ Favorito» (nome já preenchido)
3. «Guardar»

Também há a sugestão única depois da 3.ª refeição parecida (1 toque).

### Registar um favorito — 2 toques

1. (+)
2. Favorito «Peq-almoço habitual»: «Registado · Porção ½ · 1½ · 2 · Anular»

0 € de IA: totais calculados no servidor a partir dos itens. Outra porção: +1 toque no próprio aviso. «Igual a ontem · almoço» também são 2 toques.

### Pesagem diária — 2 toques

1. Cartão «Bom dia. Pesa-te?»: a folha abre com o teclado e a sugestão «ontem 84,6»
2. Escrever 84,4 (4 teclas) e «Guardar»

2 toques mais o número. Por outro caminho: (+), Peso, Guardar = 3. Num dia esquecido: + «Ontem» = 4. Se falta o joelho de ontem, a confirmação traz os 3 botões (+1 toque).

### Joelho na manhã seguinte — 1 toques

1. Na confirmação da pesagem, ou na linha fixa do Hoje: «Bem», «Algum incómodo» ou «Doeu»

Guarda pain_next_day com 1, 4 ou 7; o semáforo mantém os limites. A linha fica até haver resposta ou 48 h; se mesmo assim faltar, a pergunta volta no registo do treino seguinte.

### Medidas, gordura e massa magra — 3 toques

1. (+)
2. Medidas
3. Pescoço 40 e, com o «Seguinte» do teclado, Cintura 94
4. «Guardar»: «Gordura 17,5 kg (cerca de 21 %) · Massa magra 67,5 kg»

3 toques mais 2 números (1 a 2 minutos com a fita). O peso usado é o peso médio, preenchido sozinho. «Ver no Corpo» é +1 toque.

### Bicicleta habitual — 3 toques

1. Separador Treino
2. «Bicicleta habitual · 45 min · 140 W»
3. Folha Joelho: «Bem» → «Bicicleta registada · +378 no plano · Anular»

Pelo (+): (+), Treino, Bicicleta habitual, Bem = 4. É a ação principal para a bicicleta em casa.

### Treino à mão (Já fiz) — 4 toques

1. Separador Treino
2. «Já fiz» (tipo, duração e watts da última sessão já escolhidos)
3. Joelho «Bem»
4. «Guardar»

Batimentos médios: +1 toque e o número (ajuda a subir a potência). Mudar tipo, duração ou dia: +1 toque cada.

### Juntar o print do relógio a uma sessão — 7 toques

1. Fora da app, no Garmin Connect: 2 capturas de ecrã (Resumo e Estatísticas)
2. Na app: separador Treino
3. «Juntar print do relógio»
4. «Fototeca» (menu do iOS)
5. Escolher 2 imagens (2 toques)
6. «Adicionar»
7. «A ler o print…» (5 a 15 s; dá para fechar). Abre Confirmar treino com «Juntar à Bicicleta das 07:10?» já escolhido
8. «Guardar»

Junta batimentos e rpm à sessão já registada, sem duplicar e sem voltar a perguntar o joelho. Sem sessão parecida, cria uma nova e pede o joelho (+1). O mesmo print outra vez abre o treino existente sem custo. Custa cerca de 0,03 a 0,04 $.

### Treino favorito de ginásio (Fase 5) — 20 toques

1. Separador Treino
2. «Ginásio»
3. «Começar de um favorito»: Pernas A
4. «✓ série» em cada série (cargas da última vez já preenchidas)
5. «Terminar»
6. Joelho «Bem»

Com 5 exercícios × 3 séries: cerca de 20 toques. Ajustar kg ou repetições: +1 toque. A sugestão «Hoje: 42 kg» vem da regra 11.

### Treino automático (intervals.icu, só com relógio Garmin, Fase 7) — 1 toques

1. Configuração única, cerca de 5 min, em Definições › Ligações
2. No dia a dia, o treino entra sozinho (ao abrir a app com mais de 20 min desde a última vez, com «Sincronizar agora» ou na cron)
3. Linha fixa do Hoje «Bicicleta 45 min · como esteve o joelho durante?»: «Bem»

0 toques para o treino entrar. Junta-se à Bicicleta habitual ou à foto da consola sem duplicar (início ±15 min, duração ±5 %).

### Refeição por texto ou ditado — 3 toques

1. (+)
2. Escrever ou ditar, e ditar
3. «Enviar»

Haiku, cerca de 2 s; conta quando os números chegam.

### Código de barras — 4 toques

1. (+)
2. Escrever ou ditar
3. «Código de barras»
4. Ler e «Guardar»

Sem IA.

### Apagar uma refeição errada — 2 toques

1. Tocar na refeição
2. «Apagar»: «Apagado · Anular» durante 10 s

Deslizar a linha para a esquerda é um atalho (1 gesto). A linha fica apagada 7 dias (menu ⋯ «Apagados»); as fotos só se apagam depois disso. O dia é recalculado.

### Dia anterior com poucas refeições — 1 toques

1. Cartão «Ontem registaste 2 refeições. Foi tudo?»: «Sim, foi tudo» ou «Não, faltou algo»

«Faltou algo» tira esse dia das contas do gasto; «Sim» marca-o completo. Substitui o antigo «Fechar o dia».

### Ver Comer contra Gasto — 1 toques

1. Hoje: o cartão principal já responde para o dia (0 toques)
2. Tocar no cartão: a conta do dia e o gasto
3. Separador Balanço: a frase da semana

0 toques para o dia, 1 para a conta e 1 para a semana.

## Requisitos


### R1: Carregar fotos de comida ao longo do dia (com uma ou outra coisa escrita), contar calorias e macros, e ter refeições favoritas para repetir facilmente

Favoritos e «Igual a ontem» chegam logo na Fase 1, sem IA. As fotos passam a ser analisadas em segundo plano (Fase 2): Fotografar e Galeria (várias fotos, hora EXIF, agrupamento só com hora conhecida), nota no momento ou depois, folha Refeição com 4 macros, itens proporcionais e «Corrigir por texto» pelo Haiku. As refeições em análise não contam, mas o Hoje avisa «ainda a contar 1 foto».

- Captura: POST /api/meal/capture {client_id, photo_paths[], thumb_paths[], image_hashes[], text?, note?, tags[], taken_at | slot+date}. Upsert por client_id, dia nutricional no servidor (decisão 20), resposta 202 e análise em waitUntil (@vercel/functions), dentro dos 60 s.
- Resultado no telemóvel: pergunta o estado de 3 em 3 s enquanto o Hoje está visível e há refeições a_analisar (de 15 em 15 s depois de 2 min), e de novo no visibilitychange e no online.
- Reivindicação atómica claim_meal_analysis(id, reset): só avança se status='a_analisar', lease expirado (90 s) e analysis_attempts < 3; com 3 tentativas e lease expirado devolve a linha já em 'erro'. reset=true (Tentar de novo, Reanalisar foto) repõe as tentativas.
- Escrita final protegida: update … where id=$1 and analysis_started_at=$claimed_at and note is not distinct from $nota_usada. Com 0 linhas: se o lease mudou, desiste (outra tentativa manda); se a nota mudou, aplica o Haiku 'correct' ao resultado e tenta de novo (máximo 2 vezes). Teste unitário com os dois passos intercalados.
- meal/update com nota nova: na mesma instrução devolve status, note e analysis_note; se status <> 'a_analisar' e a nota for diferente de analysis_note, corre a correção.
- Estados: a_analisar, por_rever, ok, erro, sem_analise (limite atingido). Contam só ok e por_rever, através da vista meals_counted (security_invoker), usada por closeDay, contagem de dia completo, regra 8, sugestão de favorito e Balanço. Teste: um dia com 2 refeições 'erro' não fica completo.
- Por rever quando algum item tem confiança 'baixa' ou a refeição não é 'alta'. Nunca se mostra percentagem: «≈» e «confirma a porção».
- Hora da foto: EXIF DateTimeOriginal lido do ficheiro original antes do canvas; sem EXIF, a hora é desconhecida (lastModified só se for mais de 2 min antes de agora) e a foto nunca se agrupa: pede dia e momento.
- Memória no iOS: fotos processadas uma a uma, bitmap fechado a seguir; o ficheiro original entra no IndexedDB antes do redimensionamento e só sai quando a captura recebe o 202.
- Fotos: 1024 px JPEG q0,75 (cerca de 150 KB) e miniatura de 256 px, em meal-photos/{uid}/{client_id}/, upload com upsert: true (um 409 conta como sucesso). O servidor valida o prefixo {uid}/.
- SHA-256 por imagem evita analisar duas vezes a mesma foto.
- Totais sempre a partir dos itens, no servidor. Registos sem itens (Só números, refeições manuais antigas) guardam um item sintético «Registo rápido»; a Migração 2 preenche os antigos, e um teste garante que meal/update nunca põe a zero uma linha antiga.
- Chips de nota guardados em meals.tags (comi_metade, azeite, sem_molho, porcao_grande, jantar_fora), lidos pela pesagem, pelas medidas e pela regra das estimativas.
- Favoritos guardam itens (não só totais), por isso ½, 1½ e 2 escalam certo. Miniatura copiada para meal-photos/{uid}/fav/{id}.jpg. meal/log-favorite e meal/repeat calculam os totais no servidor, sem IA, e aceitam o dia escolhido.
- Sugestão de favorito na 3.ª refeição parecida (mesmo momento, Jaccard ≥ 70 % nos nomes dos itens, 30 dias), uma vez por padrão e dispensável para sempre (profile.dismissed_hints).
- O prompt leva os 40 alimentos mais usados nesse momento do dia com índices curtos (a1…a40) em vez de UUID; o servidor faz a correspondência. As fotos continuam sem criar alimentos (decisão 26).

### R2: Treino: integrar com algo, ou carregar um print do Garmin ou do Strava

Fase 3 inteira, logo a seguir às fotos. Para a bicicleta em casa, as ações principais são a Bicicleta habitual (3 toques) e «Já fiz». O print do Garmin ou do Strava (e a foto da consola) entra por «Juntar print do relógio», lido pelo Sonnet 5 e confirmado num cartão, e junta-se à sessão do dia sem duplicar. O intervals.icu (grátis, sincroniza com o Garmin) fica para a Fase 7 e só se ele gravar num relógio Garmin. A API do Strava fica de fora porque exige subscrição.

- Antes de construir a Fase 3, pergunta-se ao João: grava num relógio Garmin? A consola mostra os watts? As respostas ficam em profile.has_garmin_watch e profile.console_shows_watts e escolhem o texto e a ordem dos botões.
- Zero funções novas: tudo em api/workout.ts (save, parse-shot, update, delete, restore, checkin; strength na Fase 5; connect, sync e status na Fase 7).
- Os rascunhos dos prints vivem numa tabela própria, workout_imports; só [Guardar] escreve em workouts. Assim nenhum leitor antigo (Hoje, gráficos, resumo, progressão, semáforo, CSV) vê rascunhos.
- Bucket privado workout-shots com política por pasta do dono. Os prints enviam-se no tamanho nativo (até 2576 px, JPEG q0,9), porque o texto pequeno perde-se a 1600 px. Imagens apagadas aos 90 dias; os números ficam.
- Duplicados: o mesmo hash abre o treino existente; mesmo tipo e dia nutricional, duração dentro de max(3 min, 10 %) e início a menos de 30 min propõe «Juntar»; na sincronização junta sozinho com duração ±5 % e início ±15 min. Único por (user_id, source, external_id).
- Que origem ganha: nos valores medidos, dispositivo > FIT > print > à mão; joelho, esforço e notas à mão ganham sempre; watts da consola ou à mão ganham quando o dispositivo não mede potência.
- Favoritos de treino guardam-se por workout/save com favorite_id e pain_during (a folha Joelho é obrigatória na bicicleta e no ginásio).
- A data do treino passa a ser o dia nutricional de started_at (regra 04–04).
- Regra 10 revista: sessões com watts_source 'prefill' ou sem batimentos não contam para subir nem reiniciam a contagem; a Sugestão seguinte explica o que falta. Testes novos para históricos com 'prefill' e sem batimentos.
- O registo de força deixa de depender de um plano na Fase 5 (exercise_log com workouts.planned_session_id nulo); a Migração 5 cria os favoritos «Pernas A» e «Corpo todo B».

### R3: Sítio para pôr o peso todos os dias e as medidas quando quiser, para medir massa gorda e massa magra

Pesagem em 2 toques mais o número, com o teclado aberto e o último valor só como sugestão (Fase 1), com dias passados. Medidas quando quiser (Fase 4): pescoço e cintura bastam, com uma leitura por omissão. Gordura pelo método da fita da Marinha dos EUA sobre o peso médio do dia, guardado na medição. Corpo em 3 cartões e histórico editável.

- Sem função nova: weights e body_measurements escrevem-se no Supabase com RLS.
- Valores derivados calculados por funções puras em api/_lib/rules/composicao.ts (sem imports relativos; o cliente importa-as como já faz com adaptativo), com os 18 vetores de teste e uma só constante de limites de plausibilidade.
- O peso usado numa medição é o peso médio calculado no telemóvel nesse dia e fica guardado em weight_used_kg: pesagens tardias ou a troca para Holt não reescrevem medições antigas. Sem pesagem nos 7 dias anteriores, a folha pede o peso.
- Pesagem num dia passado: o gráfico do Corpo muda logo (cálculo no telemóvel); days.weight_trend e o gasto medido atualizam na cron seguinte (Fase 1) ou logo por /api/day/recompute (Fase 2).
- A % de gordura da balança entra na Pesagem (weights.body_fat_pct) quando o interruptor está ligado e aparece como série separada, suavizada, nunca misturada com a fita.

### Visão: centro de fitness com o que entra e o que sai

Duas palavras em todo o lado: Comer (o plano do dia e o que já comeu) e Gasto. O Hoje responde ao dia, a folha O plano de hoje explica a diferença entre plano e gasto numa frase, o Balanço responde à semana e o Corpo fecha o ciclo. Cores fixas: Comer índigo, Gasto teal, Corpo fúcsia.

- Gasto de hoje = base sem treino + kcal dos treinos de hoje. A base sem treino vem do gasto medido pelo peso menos a média das kcal de treino na mesma janela; antes de 10 dias completos vem da fórmula de Mifflin-St Jeor × 1,2 (fator sedentário, porque o treino soma à parte), e aparece como «(a aprender)».
- O Balanço não compara o peso com um gasto calculado a partir do mesmo peso: a frase semanal usa o gasto medido até ao início da semana, e a verificação de 3 semanas compara o gasto medido com a fórmula, que não depende do que se come.
- Os passos nunca somam: já estão dentro do gasto medido.

### UX/UI drasticamente melhor e pensada para um utilizador pouco técnico no iPhone

4 separadores e o (+) central com desenho fixo; folhas inferiores com no máximo uma de cada vez; uma resposta por ecrã e um número por linha; 1 cartão Próximo passo, mais as linhas do joelho; Anular em tudo; glossário PT-PT fixo; tema que segue o sistema; alvos de 44 pt ou mais e botões principais de 56 px na zona do polegar.

- O ecrã inicial passa a ser o Hoje (hoje é o Registar).
- URLs reais para recarregar e para lembretes; «‹ Voltar» fora dos separadores.
- Sem gestos ambíguos: nada de deslizar para mudar de dia; deslizar para apagar é só um atalho; o Rever usa botões.
- Sem mecânicas de sequência: faixa da semana só com datas, sem «5 de 7 dias», sem percentagem de confirmadas, sem barras tracejadas para dias sem registo.
- Estados iniciais definidos para as 2 primeiras semanas, com um só limite («10 dias completos») em todo o lado.
- Refresca no visibilitychange (sai o botão «Atualizar»). visualViewport para o teclado nunca tapar o campo. Retorno visual em vez de vibração.
- PIN só depois de 12 h por omissão.

### Restrições técnicas (12 funções, imports ESM .js, PWA no iOS, RLS, 1 cron por dia, preservar dados)

5 funções no fim: meal, workout, day, health/daily e cron/daily. Código arquivado vai para /archive, fora de api/, do tsconfig e do vitest. Testes de guarda para funções, imports .js, regras puras, rotas do cliente e colunas usadas. Uma migração aditiva por fase, com backup e verificação de RLS.

- Contagem por fase: 8 hoje → 7 na Fase 0 (sai strava, código de barras junta-se ao meal, entra day) → 7 até à Fase 4 → 5 na Fase 5 (saem plan/generate e calendar). O teste falha acima de 10.
- vercel.json por fase. Fase 0: sai /api/strava/:action; entram {"source": "/api/food/barcode/:ean", "destination": "/api/meal?action=barcode&ean=:ean"} e {"source": "/api/day/:action", "destination": "/api/day?action=:action"}; ficam os de meal e workout; entra "regions" com a região da Vercel mais próxima do projeto Supabase. Nenhuma outra fase mexe em rewrites.
- Teste de guarda: cada caminho /api/… chamado em src/ corresponde a uma função ou a um rewrite.
- Teste de guarda de colunas: os nomes usados em .select, .eq, .insert e .update com literais em api/ e src/ existem em supabase/migrations.
- Script de fumo depois de cada deploy: curl a cada função (401 ou 405, nunca 500) e GET /api/day/health com token, que verifica variáveis de ambiente, prompts legíveis, um select ao Supabase e anthropic.models.retrieve('claude-sonnet-5').
- Cada tabela nova tem enable row level security e drop policy if exists + create policy owner_all; integrations tem RLS sem políticas. Cada migração termina com a verificação de tabelas públicas sem RLS, que tem de vir vazia.
- Uma só cron (04:30 UTC) com prazo interno de 45 s; nenhuma chamada ao Sonnet dentro da cron.
- Todos os dados atuais ficam. photo_path copiado para photo_paths; linhas antigas com status 'ok'; tabelas estacionadas não são apagadas.

## Comer e Gasto

**Comer:** Comer(dia) = soma das refeições contadas (vista meals_counted: status 'ok' ou 'por_rever' e deleted_at nulo) no dia nutricional (04:00–04:00, Lisboa). 'a_analisar', 'sem_analise' e 'erro' não contam: o Hoje mostra «ainda a contar N fotos» com o número esbatido, e days.meals_pending guarda quantas faltam. Proteína, hidratos e gordura somam da mesma forma (days.carbs e days.fat, preenchidos a partir das refeições existentes). Os totais saem sempre dos itens, no servidor; registos sem itens guardam um item sintético. Favoritos, «Igual a ontem» e «Repetir» copiam itens × fator, sem IA. As estimativas por foto contam com ≈. Um erro sistemático das fotos fica absorvido pelo gasto medido pelo peso, por isso o plano continua certo; a app não finge que o consegue ver dia a dia. Só a comparação de 3 semanas entre o gasto medido e a fórmula pode apontar uma diferença persistente, sem saber se vem de porções ou de um gasto mais baixo, e diz isso sem culpar.

**Gasto:** Três camadas, com nomes fixos, que a interface nunca mistura.

1. **Plano (o que pode comer).** kcal_target = base_kcal (1 500) + soma de workouts.kcal_est dos treinos guardados no dia nutricional. kcal_est fica congelado ao guardar; closeDay soma o valor guardado e nunca recalcula o passado. Semana de pausa da dieta: plano = último gasto medido, sem somar treino (decisão 49), ancorada em profile.maintenance_anchor (fixada na Migração 1 a partir de min(days.date) e só alterável nas Definições), para uma pesagem antiga não mudar as semanas.

2. **Gasto de hoje (days.kcal_out_est, só para mostrar).**
   - base sem treino (days.daily_base_est): com 10 ou mais dias completos, tdee_est congelado no dia anterior à segunda-feira da semana − média das kcal de treino nos dias completos da mesma janela;
   - antes disso, a fórmula (days.formula_base e profile.expected_tdee, que passa a ser escrito pelo servidor): Mifflin-St Jeor (10 × peso médio + 6,25 × 183 − 5 × idade + 5) × 1,2. Sem ano de nascimento, fica o expected_tdee atual (2 200). Aparece como «Gasto (a aprender)» com «Mais 6 dias completos…»;
   - kcal_out_est(d) = base sem treino + kcal_exercise(d). Exemplo: 2 200 + 378 = 2 578, mostrado «cerca de 2 580».

3. **Gasto medido pelo peso** (tdee_est, regra 4 sem mudanças: 10 a 14 dias completos, EMA 0,3). O dia em curso nunca entra: is_complete e tdee_est só se calculam para dias anteriores.

**Comparações no Balanço:**
- Frase da semana: média de Comer contra média do Gasto dos dias completos da semana, usando o tdee_est congelado antes da semana (a semana atual não entra no gasto que se compara com ela). Ritmo previsto = diferença × 7 / 7700 kg por semana, comparado com o ritmo do peso médio; «Bate certo» se a diferença for de 0,25 kg por semana ou menos, só a partir da 3.ª semana; senão uma frase neutra.
- Gasto medido contra fórmula: diferença = tdee_est − (formula_base + média das kcal de treino na janela). shouldAdjustBase passa a comparar com este total (testes da regra 4 atualizados). Se ficar mais de 300 abaixo em 3 verificações semanais seguidas, aparece a nota neutra em «Ver detalhes».
- Sugestão de plano base: Y = arredondar a 50 (tdee_est − média das kcal de treino − 550), nunca abaixo de 1 500; aparece se |Y − base_kcal| ≥ 100; [Aplicar] com Anular.
- Teste que documenta a circularidade: a formulação antiga (gasto adaptativo contra a mesma tendência) devolve «Bate certo» numa série sintética com 20 % de subregisto; a comparação medido contra fórmula mostra a nota ao fim de 3 semanas.

Os passos nunca somam ao plano nem ao gasto.

**Regras das kcal de exercício:**
- Bicicleta: watts × minutos em movimento × 0,06 (igual à regra atual). 140 W × 45 min = 378 (mostrado «+380» nas linhas compactas); 150 W × 45 min = 405; 130 W × 30 min = 234. Os watts vêm, por ordem, do dispositivo, da consola (foto), do valor à mão, do favorito e, por fim, dos últimos watts confirmados nos 30 dias anteriores (watts_source 'prefill', kcal_estimated = true, «≈ com 140 W da última sessão»). Sem nenhum: 0 kcal e «Sem potência: junta uma foto da consola». As calorias do relógio nunca contam na bicicleta.
- Ginásio: 150 kcal se durar 30 min ou mais, senão 0 (igual). Minutos = tempo total.
- Outro com calorias do dispositivo (caminhada, elíptica, natação…): calorias × 0,7, de qualquer origem (print, intervals, Atalho). Os treinos antigos do Strava continuam a ler raw.calories.
- Outro sem calorias: MET líquidos × peso médio × horas (caminhada 2,5; elíptica 4; natação 5; outro 3), marcado como estimativa. Entra na Fase 0 e corrige o bug atual em que um «Outro» à mão contava 0 (stravaCalories ?? 0 em targets.ts).
- kcal_est é calculado no servidor ao guardar e congelado; a Migração 1 preenche os nulos antigos com a regra antiga, em SQL. Mudar a regra nunca reescreve dias passados.
- workouts.kcal_rule guarda a fórmula usada ('watts', 'watts_prefill', 'strength_flat', 'device_x0.7', 'met', 'legacy_strava').
- Passos (health_daily) nunca somam: já estão no gasto medido.
- Função pura: WorkoutForKcal passa a {type, minutes, watts, deviceCalories, sport?, weightKg?}; stravaCalories fica mapeado para deviceCalories, e os 95 testes atuais continuam a passar.

**Como se mostra:** Hoje: «Podes comer mais 820» e «de 1 880 do plano de hoje», com a barra na cor Comer (índigo) e «+380 do treino» na cor Gasto (teal). A folha O plano de hoje diz «Gastas cerca de 2 580 hoje. O plano deixa-te comer 1 880 para perderes cerca de 0,6 kg por semana.» e «Plano: 1 500 + 380 do treino = 1 880 · Comeste 1 060». Acima do plano mas abaixo do gasto, a mensagem é «Passaste 150 do plano, mas continuas a comer menos do que gastas.», nunca uma contradição. Balanço: «Esta semana comeste cerca de 600 kcal por dia menos do que gastaste. O peso médio está a descer 0,4 kg por semana. Bate certo.» Cada treino explica as suas kcal («O relógio diz 520 kcal; contamos 378 pela potência»). Kcal arredondadas a 10 nas frases e nas linhas; «cerca de» nas frases e «≈» só nas linhas compactas. Nunca vermelho por comer: âmbar com padrão e a frase «A semana conta mais do que o dia.» Nunca se mostra quanto ficaria abaixo «se não comesse mais».

## Composição corporal

Fita métrica, pelo método da Marinha dos EUA (Hodgdon & Beckett), versão métrica para homens. A altura fica fixa no perfil (183 cm), por isso só se mede o pescoço e a cintura ao nível do umbigo (1 leitura por omissão; 2 ou 3 com «Medir 2 vezes»). O peso usado é o peso médio no dia da medição, calculado no telemóvel com a mesma função pura do servidor e guardado em weight_used_kg; nunca a pesagem crua dessa manhã. Gordura e massa magra calculam-se na hora a partir da linha guardada (funções puras em api/_lib/rules/composicao.ts) e nunca se projetam entre medições: os pontos aparecem só nas datas medidas. A balança de bioimpedância é uma série à parte, e o DEXA fica para os extras. No ecrã aparece «Gordura 17,5 kg (cerca de 21 %)»; o intervalo provável e o método ficam em «Como é calculado?».

**Fórmulas:**
- D = 1,0324 − 0,19077 × log10(cintura − pescoço) + 0,15456 × log10(altura), com medidas em cm
- %Gordura = 495 / D − 450. Só vale se cintura > pescoço (senão null). Uma só constante de plausibilidade: fora de 5–45 % aparece «verifica as medidas» (aviso, não bloqueia)
- Versão em polegadas, só como verificação nos testes: %G = 86,010 × log10(abdómen − pescoço) − 70,041 × log10(altura) + 36,76, com diferença menor que 0,2 pp
- gordura_kg = W × %G / 100; massa_magra_kg = W − gordura_kg, com W = weight_used_kg (peso médio da janela de 7 dias no dia da medição; se não houver pesagem nessa janela, a folha pede o peso)
- Intervalo em ⓘ: %G ± 4 pp (erro típico do método). Arredondamentos no ecrã: %G inteiro, kg a 0,5
- As diferenças mostradas calculam-se a partir dos valores já arredondados, para o texto bater certo com os números («17,5 → 15,5» dá «cerca de 2 kg a menos»). Massa magra «estável» se a diferença mostrada for de 0,5 kg ou menos
- «A fita já confirma esta descida» se |Δ%G| ≥ 1,5 pp (mínima mudança detetável com 1 leitura; cerca de 1,1 pp com 2 leituras); senão «ainda dentro da margem da fita, confirma na próxima medição»
- Cintura alvo para uma %G alvo: D_alvo = 495 / (%G_alvo + 450); cintura = pescoço + 10^((1,0324 + 0,15456 × log10(altura) − D_alvo) / 0,19077)
- Leituras por zona: média das leituras feitas
- Peso médio (Fase 6, só se ganhar o teste com os pesos reais do João): Holt com tempo, α 0,15 e β 0,05. Para cada pesagem com intervalo de k dias: L_pred = L + T × k; α_k = 1 − (1 − α)^k; L_novo = L_pred + α_k × (y − L_pred); T = T + β × ((L_novo − L) / k − T); ritmo = 7 × T kg por semana. O ritmo só se mostra com 14 dias ou mais e 8 pesagens ou mais. As medições antigas não mudam, porque guardam weight_used_kg

**Medidas:**
- Pescoço (obrigatório): logo abaixo da maçã de Adão, fita a descer ligeiramente para a frente
- Cintura no umbigo (obrigatória): na horizontal, no fim de uma expiração normal, sem encolher a barriga
- Peito (opcional): na linha dos mamilos, no fim da expiração
- Anca (opcional): no maior volume das nádegas, pés juntos
- Braço direito (opcional): a meio entre ombro e cotovelo, relaxado
- Coxa direita (opcional): 15 cm acima do topo da rótula, peso nos dois pés; são os quadríceps, que protegem o joelho com artrose
- Gémeo direito (opcional): no maior volume
- Balança (opcional, na Pesagem): % de gordura por bioimpedância, série separada
- Peso: diário, de manhã, depois da casa de banho, antes de comer, sem roupa, sempre na mesma balança

**Cadência:** - **Peso:** todos os dias de manhã, sem culpa nos dias em falta e sem sequências.
- **Pescoço e cintura:** a cada 14 dias (profile.measure_interval_days), à segunda-feira de manhã, em jejum. Evitar a semana de pausa da dieta e a manhã a seguir a um «Jantar fora» (lido de meals.tags); se medir, aparece um aviso e a linha fica marcada.
- **Peito, anca, braço, coxa e gémeo:** a cada 4 semanas.
- **Lembrete:** Próximo passo «Medições: há 15 dias · 2 minutos», com «Agora não». Sem notificação push por omissão.

**Exemplo:**
Medição 1: altura 183, pescoço 40, cintura 94, peso médio 85,0 (guardado em weight_used_kg).
- cintura − pescoço = 54; log10(54) = 1,732394; log10(183) = 2,262451
- D = 1,0324 − 0,330489 + 0,349684 = 1,051596
- %G = 495 / 1,051596 − 450 = 20,71 % (versão em polegadas: 20,83 %)
- Gordura = 85,0 × 0,20713 = 17,61 kg; massa magra = 67,39 kg
- Intervalo (ⓘ): 16,7–24,7 % → gordura 14,2–21,0 kg
- No ecrã: «Gordura 17,5 kg (cerca de 21 %) · Massa magra 67,5 kg»

Medição 2, 4 semanas depois: pescoço 40, cintura 91,5, peso médio 83,0.
- cintura − pescoço = 51,5; D = 1,055523; %G = 18,96 % → gordura 15,74 kg, massa magra 67,26 kg
- Valores exatos: Δgordura −1,87 kg, Δmagra −0,13 kg, Δ%G −1,75 pp (≥ 1,5)
- No ecrã, com kg a 0,5: gordura 15,5 kg, massa magra 67,5 kg (cerca de 19 %). Diferenças a partir dos valores mostrados: gordura 17,5 → 15,5 = 2,0 a menos; massa magra 67,5 → 67,5 = estável
- Frase: «Desde 1 set: cerca de 2 kg de gordura a menos, massa magra estável · a fita já confirma esta descida»

Cintura alvo com pescoço 40: 15 % → 86,2 cm («alvo cerca de 86 cm»); 20 % → 93,0 cm.

O que significam os 75 kg: mantendo a massa magra em 67,4 kg dá cerca de 10,1 % de gordura; perdendo cerca de 25 % dos 10 kg em massa magra (2,5 kg) dá cerca de 13,5 %.

Porque não se usa a pesagem crua: com 86,5 kg (depois de um jantar salgado) a massa magra daria 68,58 kg, ou seja cerca de 1,2 kg de «músculo» inventado.

**Cuidados:**
- A fita não é um exame médico: o erro absoluto ronda ±3,5–4 pp e, nos homens, costuma dar 2 a 6 pontos abaixo do DEXA. Por isso o intervalo e o método estão sempre a um toque (ⓘ). Serve para ver a direção ao longo de semanas.
- A fita acerta na direção mas subestima o tamanho da mudança e é ruidosa em períodos curtos. Abaixo de 1,5 pp aparece «ainda dentro da margem da fita, confirma na próxima medição».
- Nas primeiras 2 a 3 semanas de dieta a massa magra desce 1 a 2 kg por água e glicogénio, não por músculo. O Corpo diz isto nesse período.
- «Massa magra» vem sempre explicada: músculo, água, osso e órgãos.
- Entre medições nunca se aplica a última %G ao peso de cada dia: isso inventaria perda de músculo (cerca de 79 % de cada kg iria para a massa magra).
- A cintura em cm aparece sempre ao lado da estimativa: é o número mais honesto, porque não passa por nenhum modelo.
- A «qualidade da perda» (Δgordura/Δpeso) só aparece com 3 medições ou mais e 3 kg ou mais de variação de peso (Fase 6).
- A balança de bioimpedância oscila 1 a 3 pp por dia e fica numa série à parte, com EWMA de α 0,1.
- O IMC (25,4) não mede composição: no máximo aparece em pequeno no ⓘ e nunca como meta.

## Integração do treino

**Principal:** **Juntar print do relógio (ou foto da consola)**, construído na Fase 3 junto com a Bicicleta habitual e o «Já fiz». Funciona com qualquer aparelho e é a resposta direta a «carregar um print do Garmin ou do Strava». O João escolhe 1 a 4 imagens:
- prints do Garmin Connect (Resumo e Estatísticas, ou «Foto com estatísticas»);
- prints do Strava (conta gratuita);
- foto da consola da bicicleta estática, provavelmente a única fonte de watts, porque um relógio dá batimentos mas não potência.

O Sonnet 5 lê tudo numa só chamada, sem pensamento alargado, e o servidor verifica os intervalos. O João confirma num cartão com os campos incertos a âmbar. Se já existe uma sessão parecida (por exemplo a Bicicleta habitual registada de manhã), a app propõe «Juntar»: o print acrescenta batimentos e rpm sem duplicar.

- **Lugar na interface:** ação secundária no Treino e na folha Treino. Para a bicicleta em casa as ações principais são a Bicicleta habitual e o «Já fiz», porque um print de bicicleta interior não traz watts e exige passos fora da app.
- **Custo:** cerca de 0,03 a 0,04 $ por treino, com prints no tamanho nativo.
- **Funções:** nenhuma nova; ações em api/workout.ts.
- **Porque vem na Fase 3:** reutiliza o pipeline das fotos de comida da Fase 2, cobre treinos que só existem no Strava e os dias em que a sincronização falha, e não depende de terceiros.

**Secundárias:**
- Bicicleta habitual (favorito criado pela Migração 3 a partir das sessões recentes, ou 30 min a 130 W): 3 toques com o joelho. É a ação principal para o dia a dia.
- «Já fiz» (treino à mão): com dia e hora, tipo, duração e watts da última vez já escolhidos, batimentos médios opcionais e o joelho em 3 botões.
- Sessão de ginásio livre (Fase 5): catálogo seguro para o joelho, 8 a 12 repetições, dupla progressão (regra 11), cargas da última vez e os favoritos «Pernas A» e «Corpo todo B».
- intervals.icu (Fase 7, só com relógio Garmin): grátis e sincronizado com o Garmin Connect. Autenticação HTTP Basic com utilizador 'API_KEY' e a chave como palavra-passe (Authorization: Basic base64('API_KEY:' + chave)), atleta 0. GET /api/v1/athlete/0/activities e /wellness.json. Sincroniza no passo 1 da cron (últimos 3 dias, teto de 8 s), ao abrir Hoje ou Treino com mais de 20 min desde a última vez e com «Sincronizar agora». Ride, VirtualRide ou trainer=true → bike; WeightTraining → strength; o resto → other. Batimentos em repouso e sono vão para health_daily com source 'intervals'; o peso só entra em dias sem pesagem do João e nunca a substitui. As atividades vindas do Strava chegam vazias, por isso é preciso desmarcar o Strava lá.
- Atalho Apple Saúde (Fase 8, opcional): sobretudo para peso e % de gordura de uma balança que escreva no Saúde. Estende POST /api/health/daily com body[] e mantém o mesmo URL.
- Ficheiros FIT (Fase 8, opcional): leitura no browser com @garmin/fitsdk e fflate, sem custo de IA, e depois a mesma ação save.

**Esquema de leitura dos prints:**
- images[]: index; app (garmin_connect | strava | bike_console | apple_fitness | other | not_workout); screen (summary | stats | laps | zones | sets | charts | share_card | console | other); date_shown tal como impresso («Ontem 07:12»)
- same_activity (boolean) e mismatch_reason: se for falso, a app oferece tratar cada print em separado
- activity.sport (indoor_bike | outdoor_bike | strength | walk | run | elliptical | swim | other), sport_label_raw e title
- activity.date (AAAA-MM-DD; «Hoje», «Ontem» e o ano em falta resolvem-se com payload.hoje, a data de Lisboa) e start_time (HH:MM, hora local)
- total_time_s, moving_time_s, distance_km
- avg_hr, max_hr
- avg_power_w, max_power_w, np_w (Normalized do Garmin ou Weighted Avg do Strava)
- avg_cadence, max_cadence
- calories_device: guarda-se e mostra-se; nunca conta na bicicleta nem no ginásio
- elevation_gain_m, aerobic_te, anaerobic_te, training_load e training_load_kind (garmin_exercise_load | strava_relative_effort | tss | other), rpe
- hr_zones[] {zone, seconds} (vazio se não aparecer); laps[] {n, time_s, avg_hr, avg_power_w, avg_cadence}; strength_sets[] {exercise_raw, reps, weight_kg}
- field_confidence[] {field de uma lista fixa de nomes, confidence alta | media | baixa, image_index}. Sem mapas abertos: os structured outputs exigem additionalProperties false e não aceitam limites numéricos
- notes
- Regras do prompt: copiar só o que está impresso e nunca estimar; null quando falta; converter unidades (mi para km, lb para kg, «1:02:15» para 3735 s); ler rótulos em PT e EN; 'baixa' para valores cortados ou desfocados; se as imagens discordarem, preferir o ecrã mais específico (Estatísticas antes de Resumo) e marcar 'media'
- Chamada: Sonnet 5 com thinking {type: 'disabled'}, max_tokens 4096, maxRetries 0, timeout 35 s; verificar stop_reason ('max_tokens' ou 'refusal' passam a 'erro' com mensagem simples) antes de ler parsed_output
- Imagens: prints no tamanho nativo até 2576 px no lado maior (JPEG q0,9, cerca de 4 mil tokens cada); foto da consola a 1600 px
- Verificações no servidor: batimentos 35–220 (máximo ≥ média), watts 20–700, rpm 30–150, duração 1–400 min; fora do intervalo o campo passa a 'baixa'. Minutos da bicicleta = tempo em movimento; do ginásio = tempo total. kcal_est sai sempre da regra 2
- O rascunho fica em workout_imports.parsed com edited_fields; «Juntar outro print» envia só as imagens novas com valores_atuais e edited_fields, e os campos editados à mão nunca são reescritos

**Passos do utilizador:**
- Para já (nada a configurar): depois da bicicleta, toca em Treino → Bicicleta habitual → diz como esteve o joelho.
- Se quiseres juntar os batimentos do relógio: no Garmin Connect abre o treino e faz 2 capturas de ecrã (botão lateral + volume para cima), uma do Resumo e outra das Estatísticas. Na bicicleta, podes tirar também uma foto à consola no fim, antes de ela se apagar.
- Na app: Treino → Juntar print do relógio → Fototeca → escolhe as imagens → Adicionar → confirma «Juntar à Bicicleta das 07:10» → Guardar.
- intervals.icu, só se usares um relógio Garmin (Fase 7), passo 1: cria uma conta grátis em intervals.icu.
- Passo 2: em Settings → Garmin Connect → Connect, entra no Garmin e autoriza atividades e bem-estar.
- Passo 3: se o Strava também estiver ligado lá, desmarca «Download activities» do Strava, para o Garmin ser a origem.
- Passo 4: em Settings → Developer Settings (no fundo da página), gera a chave e copia-a.
- Passo 5: na app, Definições → Ligações → Treinos automáticos → cola a chave → Testar → Importar últimos 30 dias.

**Rejeitadas:**
- **API do Strava (OAuth e webhook já construídos)** — Desde 1 de junho de 2026 exige subscrição paga (cerca de 11,99 $/mês) e o João não é subscritor. O router e api/_strava/* vão para /archive na Fase 0 e libertam uma função. O intervals.icu também não resolve isto, porque os termos do Strava obrigam-no a devolver essas atividades vazias.
- **API oficial do Garmin (Health, Activity, Training)** — Só para empresas, e os novos pedidos estão pausados desde a primavera de 2026, sem data de reabertura.
- **Bibliotecas não oficiais do Garmin (garth, python-garminconnect)** — Partem com frequência (verificações Cloudflare desde março de 2026), vão contra os termos do Garmin, obrigam a guardar a palavra-passe e os códigos 2FA no servidor e precisam de um runtime Python.
- **Atalho Apple Saúde como via principal de treinos** — Só corre com o iPhone desbloqueado; os batimentos médios e os watts não fazem parte do treino no Saúde, e o Garmin só escreve os valores alto e baixo. Fica para dados do corpo (Fase 8).
- **Ficheiros FIT, TCX ou GPX como via principal** — A app Garmin Connect no iPhone não exporta ficheiros: seria preciso o site no Safari, «Export Original», ZIP e Ficheiros. Demasiados passos para o João. Fica como extra (Fase 8).

## Dados

**Tabelas novas:**
- **favorites** — Um só conceito de Favorito para refeições e treinos (incluindo a Bicicleta habitual e as rotinas de ginásio). Registo com 1 toque, sem IA. Migração 1.
  - id uuid pk default gen_random_uuid()
  - user_id uuid not null references auth.users on delete cascade
  - kind text not null check (kind in ('meal','workout'))
  - name text not null
  - items jsonb: refeição, com a forma de meals.items; os totais recalculam-se sempre a partir dos itens
  - workout jsonb: {type:'bike', minutes, watts} ou {type:'strength', exercises:[{exercise_id, sets, rep_min:8, rep_max:12}]}
  - kcal int, protein numeric(5,1), carbs numeric(5,1), fat numeric(5,1): cache para a grelha
  - photo_path text: miniatura copiada para meal-photos/{uid}/fav/{id}.jpg
  - default_slot text check (default_slot in ('pequeno_almoco','almoco','lanche','jantar','ceia'))
  - source_meal_id uuid references meals on delete set null
  - use_count int not null default 0, last_used_at timestamptz
  - archived boolean not null default false, created_at timestamptz default now(), updated_at timestamptz default now()
  - índice (user_id, kind, archived, use_count desc); RLS owner_all (drop policy if exists + create policy)
- **workout_imports** — Rascunhos dos prints e fotos da consola até serem guardados. Nunca contam em nenhum total. Migração 3.
  - id uuid pk, user_id uuid not null references auth.users on delete cascade
  - client_id uuid not null unique
  - status text not null default 'a_ler' check (status in ('a_ler','por_confirmar','guardado','descartado','erro'))
  - source_paths text[] not null default '{}', thumb_paths text[] not null default '{}', image_hashes text[] not null default '{}'
  - parsed jsonb (WorkoutShotSchema), edited_fields text[] not null default '{}'
  - analysis_started_at timestamptz, analysis_attempts int not null default 0, analysis_error text
  - workout_id uuid references workouts on delete set null (preenchido ao guardar ou juntar)
  - created_at timestamptz default now(); índice (user_id, status); RLS owner_all
- **body_measurements** — Medidas com fita para estimar gordura e massa magra. Valores derivados calculados na hora a partir de weight_used_kg. Migração 4.
  - id uuid pk default gen_random_uuid()
  - user_id uuid not null references auth.users on delete cascade
  - date date not null (mesma convenção de weights.date), measured_at timestamptz default now()
  - method text not null default 'tape' check (method in ('tape')) (o DEXA entra nos extras, com migração própria)
  - neck_cm numeric(4,1) check (neck_cm between 25 and 60), waist_cm numeric(4,1) check (waist_cm between 50 and 180); o telemóvel valida antes com texto simples
  - chest_cm, hips_cm, arm_cm, thigh_cm, calf_cm numeric(4,1)
  - readings jsonb, por exemplo {"waist":[94.0,94.5],"neck":[40.0,40.0]}
  - weight_used_kg numeric(5,2) not null: peso médio usado, canónico para esta medição
  - fasted boolean not null default true, flags text[] not null default '{}' (pausa_dieta, depois_jantar_fora, plausibilidade), note text
  - created_at timestamptz default now(); unique (user_id, date, method), com «Substituir a medição de hoje?» no telemóvel; RLS owner_all
- **integrations** — Chave do intervals.icu (Fase 7). Só o servidor a lê. Migração 7.
  - user_id uuid not null references auth.users on delete cascade
  - provider text not null check (provider in ('intervals'))
  - api_key text not null, athlete_id text
  - last_sync_at timestamptz, last_error text, settings jsonb default '{}'
  - created_at timestamptz default now(); primary key (user_id, provider)
  - RLS ativa sem políticas (como strava_tokens): só a service role lê e escreve, pela ação workout/connect. O cliente vê o estado em profile.integration_status
- **progress_photos** — Fotos de progresso de frente e de lado (Fase 8, opcional).
  - id uuid pk, user_id uuid not null, date date not null
  - pose text check (pose in ('frente','lado','costas'))
  - path text: bucket privado progress-photos, pasta do dono
  - created_at timestamptz default now(); RLS owner_all

**Alterações:**
- **Mapa de migrações por fase** — Uma migração por fase, aditiva e idempotente, com guia PT de copiar e colar no SQL Editor. Cada uma começa com `create table if not exists days_bak_AAAAMMDD as table days`, faz os preenchimentos com os triggers desligados (ou antes de os criar), usa `drop policy if exists` + `create policy`, `create or replace trigger` e constraints com nome explícito, e acaba com a verificação `select tablename from pg_tables where schemaname='public' and not rowsecurity` (tem de vir vazia).
- **Migração 1 (Fase 1):** favorites; profile.sex, birth_year, theme, calm_mode, pin_mode, maintenance_enabled, maintenance_anchor (= min(days.date)), dismissed_hints, nudge_state, carbs_ref_g, fat_ref_g, scale_has_bodyfat; days.carbs, days.fat (preenchidos juntando por user_id e date), days.dirty; weights.measured_at e weights_source_check com 'shortcut' e 'intervals'; meals.deleted_at, favorite_id, source_meal_id, portion_factor e meals_input_type_check com 'favorite' e 'repeat'; workouts.deleted_at e preenchimento de kcal_est nulos com a regra antiga; vistas meals_counted e workouts_active (security_invoker); função e triggers mark_day_dirty.
- **Migração 2 (Fase 2):** colunas assíncronas de meals, tags, item sintético, meals_input_type_check com 'quick', vista meals_counted redefinida com status, days.meals_pending, RPC claim_meal_analysis, profile.ai_monthly_cap_eur e ai_daily_vision_cap, função storage_orphan_candidates.
- **Migração 3 (Fase 3):** colunas novas de workouts, workouts_source_check alargado, índice único de external_id, workout_imports, bucket workout-shots e políticas, RPC claim_workout_parse, profile.has_garmin_watch e console_shows_watts, favorito «Bicicleta habitual».
- **Migração 4 (Fase 4):** body_measurements; profile.measure_interval_days, thigh_landmark_cm, body_comp_source.
- **Migração 5 (Fase 5):** favoritos «Pernas A» e «Corpo todo B» (where not exists).
- **Migração 6 (Fase 6):** days.kcal_out_est, daily_base_est, formula_base; weekly_reviews.kind com troca de unique; profile.trend_method e trend_method_since.
- **Migração 7 (Fase 7):** integrations, profile.integration_status, health_daily.source.
- **Migração 8 (extras):** progress_photos e bucket; body_measurements.method com 'dexa'; com acordo do João, remover meals.photo_path e as tabelas estacionadas.
- **meals** — Migração 1: deleted_at timestamptz (apagar reversível 7 dias), favorite_id uuid references favorites on delete set null, source_meal_id uuid, portion_factor numeric(4,2) default 1; meals_input_type_check passa a text, photo, barcode, manual, favorite, repeat.
Migração 2:
- client_id uuid unique (idempotência)
- photo_paths text[] not null default '{}' (preenchido com array[photo_path] onde não é nulo), thumb_paths text[] not null default '{}', image_hashes text[] not null default '{}'
- note text, analysis_note text, tags text[] not null default '{}'
- slot text check (pequeno_almoco | almoco | lanche | jantar | ceia), deduzido nas linhas antigas de logged_at at time zone 'Europe/Lisbon'
- status text not null default 'ok' check ('a_analisar','por_rever','ok','erro','sem_analise')
- analysis_started_at timestamptz, analysis_attempts int default 0, analysis_error text, confirmed_at timestamptz (created_at nas linhas antigas que não eram estimativa)
- meals_input_type_check ganha 'quick'
- linhas antigas com items = '[]' e kcal > 0 recebem o item sintético «Registo rápido».
kcal e macros continuam NOT NULL DEFAULT 0. photo_path fica só de leitura até à Migração 8.
- **days** — Migração 1: carbs numeric(5,1) default 0 e fat numeric(5,1) default 0 (preenchidos com update … from (select user_id, date, sum(carbs), sum(fat) from meals group by user_id, date)); dirty boolean not null default false.
Migração 2: meals_pending int default 0.
Migração 6: kcal_out_est int, daily_base_est int, formula_base int.
flags passa a aceitar 'faltou_algo' (resposta «Não, faltou algo»), ao lado do 'dia_fechado' existente («Sim, foi tudo»). A regra 5 respeita as duas marcas; is_complete e tdee_est só se calculam para dias anteriores ao dia nutricional em curso.
- **workouts** — Migração 1: deleted_at timestamptz; kcal_est nulos preenchidos com a regra antiga (congelado a partir daqui).
Migração 3:
- client_id uuid unique, external_id text, started_at timestamptz
- sport text (valor em bruto), name text
- moving_s int, elapsed_s int, distance_km numeric, np_w int, max_w int, max_cadence int
- kcal_device int, kcal_rule text, kcal_estimated boolean default false
- watts_source text check ('device','console','manual','favorite','prefill')
- training_load numeric, aerobic_te numeric, anaerobic_te numeric, rpe int
- hr_zones jsonb, laps jsonb, source_paths text[] default '{}', image_hashes text[] default '{}', merged_from jsonb
- note text, favorite_id uuid references favorites on delete set null
workouts_source_check passa a strava | manual | screenshot | intervals | health | fit. Índice unique (user_id, source, external_id) where external_id is not null. Os rascunhos ficam em workout_imports, por isso workouts só tem treinos guardados. A data de um treino novo é o dia nutricional de started_at; as linhas antigas não mudam.
- **weights** — Migração 1: measured_at timestamptz; weights_source_check passa a manual | withings | shortcut | intervals. body_fat_pct guarda só a leitura da balança (interruptor nas Definições). Mantém-se unique (user_id, date). Apagar uma pesagem é apagar mesmo; o Anular re-insere a linha que o telemóvel guardou.
- **profile** — Migração 1: sex text default 'm', birth_year int, theme text default 'system', calm_mode boolean default false, pin_mode text default '12h' check ('off','12h','always'), maintenance_enabled boolean default true, maintenance_anchor date, dismissed_hints jsonb default '[]', nudge_state jsonb default '{}' (ignorados e pausas dos lembretes), carbs_ref_g int, fat_ref_g int, scale_has_bodyfat boolean default false.
Migração 2: ai_monthly_cap_eur numeric default 10, ai_daily_vision_cap int default 40.
Migração 3: has_garmin_watch boolean, console_shows_watts boolean.
Migração 4: measure_interval_days int default 14, thigh_landmark_cm int default 15, body_comp_source text default 'tape'.
Migração 6: trend_method text default 'sma7', trend_method_since date. expected_tdee deixa de ser editável e passa a ser escrito pelo servidor com Mifflin-St Jeor × 1,2 quando há ano de nascimento.
Migração 7: integration_status jsonb (escrito pelo servidor).
bike_watts_options, bike_hr_avg_cap, bike_hr_max_cap e bike_min_cadence mantêm-se e ficam editáveis na secção Bicicleta.
- **health_daily** — Migração 7: source text default 'shortcut' check ('shortcut','intervals').
- **weekly_reviews** — Migração 6: add column kind text not null default 'narrador' (as linhas antigas ficam 'narrador'); alter column kind set default 'resumo'; drop constraint weekly_reviews_user_id_week_start_key; add unique (user_id, week_start, kind). generateWeeklyReview filtra por kind na verificação de existência. As antigas aparecem no Arquivo.
- **exercise_log** — Sem alteração de esquema. As sessões de ginásio livres (Fase 5) usam workout_id com workouts.planned_session_id nulo.
- **Storage (buckets)** — meal-photos mantém-se, organizado por {uid}/{client_id}/ (foto de 1024 px e miniatura de 256 px) e {uid}/fav/{id}.jpg. Novo bucket privado workout-shots (Migração 3) com a política por pasta do dono copiada de meal-photos. progress-photos, privado, só nos extras. chapter-photos deixa de receber escritas. Limpeza ao domingo: a função SQL security definer storage_orphan_candidates(bucket, 7 dias, 50) devolve objetos com mais de 7 dias cuja pasta ({client_id} ou fav/{id}) não existe em meals, workout_imports ou favorites e cujo caminho não está em photo_paths, thumb_paths, source_paths ou favorites.photo_path; a cron apaga-os pela API do Storage (storage.from(bucket).remove()), no máximo 50 por noite.
- **Funções SQL, vistas e triggers** — - meals_counted (deleted_at nulo e, a partir da Migração 2, status in ('ok','por_rever')) e workouts_active (deleted_at nulo), ambas with (security_invoker = true). Todos os leitores de totais usam-nas.
- claim_meal_analysis(meal_id, reset) e claim_workout_parse(import_id, reset): reivindicação atómica com lease de 90 s, no máximo 3 tentativas, e passagem a 'erro' quando se esgotam (security invoker).
- mark_day_dirty(): trigger after insert, update ou delete em meals, workouts e weights, com cláusula WHEN que só dispara quando mudam date, kcal, protein, carbs, fat, status, deleted_at, kcal_est ou kg (nunca nas atualizações de lease). Faz upsert em days (user_id, date, dirty = true) para a data antiga e para a nova.
- Só um recálculo para a frente, por ordem de data até ontem, limpa dirty (propaga peso médio e cadeia EMA). O recálculo de um só dia, feito depois de cada escrita no servidor, deixa dirty ligado.
- Todas são funções do Postgres e não contam para o limite da Vercel.

**Arquivado:**
- **chapters, plan_blocks, planned_sessions** — A narrativa e o plano gerado pela IA saem da navegação (capítulo na Fase 1, plano na Fase 5). Os dados ficam, visíveis só para leitura em Definições › Arquivo; a FK workouts.planned_session_id mantém-se.
- **strava_tokens, workouts.strava_id** — A API do Strava exige subscrição. As colunas são inofensivas e os treinos antigos continuam legíveis.
- **Bucket chapter-photos** — Deixa de ser escrito. As fotos continuam no Arquivo.
- **meals.photo_path** — Substituída por photo_paths. Só é removida na Migração 8, com o acordo do João.
- **Código: api/strava.ts e api/_strava/* (Fase 0); api/plan/generate.ts, api/calendar.ts, api/_lib/pairing.ts, api/_lib/ics.ts e a validação knee-safe de schemas.ts (Fase 5)** — Vão para /archive, fora de api/, do include do tsconfig e do vitest, por isso não fazem deploy nem typecheck; os testes de ics e pairing seguem com eles. Ficam onde estão, por serem puros e usados pelo cliente: api/_lib/rules/plan-dates.ts (e o seu teste, usado por Treino.tsx e Capitulo.tsx) e api/_lib/strava.ts com mapStravaType e mapActivityToWorkout (e tests/strava-mapping.test.ts); se algum importar de api/_strava, essa parte desce para _lib antes de arquivar.

## Funções serverless (5)

- **api/meal.ts** — Tudo o que é comida, incluindo todas as chamadas à IA de comida. Totais e dia nutricional sempre no servidor (decisão 20). Cada escrita chama recomputeDay(datas afetadas) de _lib/close-day.js, que atualiza o dia mas deixa dirty ligado para o recálculo para a frente.
  - POST /api/meal/capture: cria ou recupera a refeição por client_id (foto, texto ou os dois), calcula o dia nutricional, responde 202 e analisa em waitUntil (Fase 2)
  - POST /api/meal/analyse: nova tentativa com lease; ?reset=1 para Tentar de novo e Reanalisar foto (Fase 2)
  - POST /api/meal/parse-text e /api/meal/parse-photo: fluxo antigo, usado pelo Registar atual até ao fim da Fase 2, depois retirado
  - POST /api/meal/save: manual e código de barras
  - POST /api/meal/quick: Só números, com item sintético (Fase 2)
  - POST /api/meal/update: itens, porções, hora, momento, nota, tags e confirmar; totais e dia recalculados no servidor (Fase 2)
  - POST /api/meal/correct: Haiku sobre os itens atuais e o texto, sem imagem (Fase 2)
  - POST /api/meal/delete e /api/meal/restore: apagar reversível (deleted_at) (Fase 1)
  - POST /api/meal/log-favorite: itens × fator, dia escolhido, zero IA (Fase 1)
  - POST /api/meal/repeat: Igual a ontem, Repetir hoje, Copiar para outro dia (Fase 1)
  - GET /api/food/barcode/:ean → rewrite para /api/meal?action=barcode&ean=:ean (Fase 0)
- **api/workout.ts** — Tudo o que é treino. A regra 2 revista calcula e congela kcal_est no servidor; cada escrita chama recomputeDay. Até à Fase 3 mantêm-se as ações manual, checkin e session atuais.
  - POST /api/workout/save: Já fiz, favorito (favorite_id + joelho) e confirmar ou juntar um import, com deduplicação e fusão (substitui manual; Fase 3)
  - POST /api/workout/parse-shot: cria o rascunho em workout_imports por client_id, responde 202 e lê os prints em waitUntil; ?reset=1 para Tentar de novo (Fase 3)
  - POST /api/workout/update, /api/workout/delete e /api/workout/restore (Fase 3)
  - POST /api/workout/checkin: joelho durante e no dia seguinte
  - POST /api/workout/strength: sessão de ginásio livre com séries, criar e editar (substitui session; Fase 5)
  - POST /api/workout/connect, /api/workout/sync e GET /api/workout/status: intervals.icu (Fase 7)
- **api/day.ts** — Saúde do deploy e recálculo dos dias depois de pesagens em dias passados, edições que mudam uma refeição de dia ou a troca do método do peso médio. Usa o mesmo _lib/close-day.js da cron. Rewrite /api/day/:action.
  - GET /api/day/health: com token; verifica variáveis de ambiente, prompts legíveis, um select ao Supabase e anthropic.models.retrieve('claude-sonnet-5') (Fase 0)
  - POST /api/day/recompute {from, to}: recálculo para a frente por ordem de data, em blocos de 30 dias no máximo (o telemóvel repete até acabar); limpa dirty (Fase 2)
- **api/health/daily.ts** — Passos, sono e batimentos em repouso vindos do Atalho. Fica exatamente onde está para não partir o Atalho.
  - POST /api/health/daily: Bearer HEALTH_INGEST_TOKEN; mesmo caminho do Atalho iOS atual, sem rewrite; nos extras ganha body[] opcional (peso e % de gordura da balança)
- **api/cron/daily.ts** — Uma só cron com prazo interno de 45 s, verificado antes de cada passo e de cada dia, e sem chamadas ao Sonnet:
1. (Fase 7) Sincroniza o intervals.icu, últimos 3 dias, com teto de 8 s.
2. Recalcula para a frente desde min(dirty mais antigo, hoje − 3) até ontem, no máximo 21 dias por noite, limpando dirty por ordem (a noite seguinte continua): kcal, macros, treino (kcal_est guardado), plano ou pausa (maintenance_anchor), dia completo (com as marcas dia_fechado e faltou_algo), peso médio, gasto medido, gasto de hoje e aviso do mínimo.
3. Gera o Resumo da semana (Haiku, timeout 15 s) sempre que falte o da semana anterior, em qualquer dia, só com 20 s ou mais de folga.
4. Marca como 'erro' as análises presas (lease expirado com 3 tentativas, ou mais de 24 h); não repete análises: o telemóvel faz isso ao abrir.
5. Ao domingo: apaga até 50 ficheiros órfãos, purga linhas apagadas há mais de 7 dias (e as suas fotos) e imagens de prints com mais de 90 dias.
Saem da cron o reconcileStrava (Fase 0) e a expiração de blocos (Fase 5).
  - GET /api/cron/daily: cron '30 4 * * *' UTC, protegida por CRON_SECRET

## IA

- **Refeição por foto (1 a 4 fotos, com nota opcional)** (claude-sonnet-5 (visão; thinking {type: 'disabled'}; sem temperature)) — - **Entrada:** fotos a 1024 px (cerca de 1 000 a 1 400 tokens cada, largura × altura / 750), nota e tags, hora, momento e os 40 alimentos da biblioteca mais usados nesse momento com índices curtos (a1…a40) e porções aprendidas.
- **Saída:** JSON estrito via zodOutputFormat: items[{name, grams, kcal, protein, carbs, fat, confidence alta|media|baixa, food_ref?}], meal_confidence, titulo_curto, slot_sugerido.
- **Pedido:** max_tokens 4096; opções por pedido {maxRetries: 0, timeout: 35_000}; verificar stop_reason ('max_tokens', 'refusal') antes de parsed_output. Uma nova tentativa explícita só em 429, 5xx ou erro de ligação, e só com 20 s ou mais de folga.
- **Pensamento:** omitir thinking no Sonnet 5 liga o pensamento adaptativo em esforço alto, que é cobrado, atrasa e pode cortar o JSON. Desligado, a chamada fica mais barata e previsível. Na Fase 0 compara-se em 10 fotos reais com adaptive + effort 'low' e fica o mais barato que mantiver a qualidade.
- **Uso:** uma chamada por refeição, não por foto.
- **Custo:** cerca de 0,012 a 0,015 $ por refeição.
- **Refeição por texto ou ditado** (claude-haiku-4-5 (temperature 0)) — - **Entrada:** texto e biblioteca com índices curtos.
- **Saída:** o mesmo esquema de itens.
- **Pedido:** maxRetries 0, timeout 20 s.
- **Custo:** cerca de 0,001 a 0,002 $.
- **Corrigir por texto, ou nota que chega depois da análise** (claude-haiku-4-5 (temperature 0)) — - **Entrada:** o JSON dos itens atuais e o texto, sem imagem.
- **Saída:** os itens revistos; a app mostra a diferença, com Anular.
- **Custo:** cerca de 0,2 cêntimos. Hoje a correção reenvia a foto ao Sonnet.
- **Reanalisar foto (só a pedido do João)** (claude-sonnet-5 (thinking desligado)) — - **Entrada:** fotos, nota e itens anteriores, por /api/meal/analyse?reset=1.
- **Custo:** cerca de 0,015 $.
- **Ler print de treino ou foto da consola** (claude-sonnet-5 (thinking desligado)) — - **Entrada:** 1 a 4 imagens; prints no tamanho nativo até 2576 px (cerca de 4 000 tokens cada), foto da consola a 1600 px; a data de hoje em Lisboa; ao juntar outro print, valores_atuais e edited_fields.
- **Saída:** WorkoutShotSchema, com confiança por campo num array de nomes fixos e verificação de intervalos no servidor.
- **Pedido:** as mesmas regras de maxRetries, timeout e stop_reason da refeição.
- **Custo:** cerca de 0,03 a 0,04 $ por treino.
- **Mais tarde (extras):** medir o Haiku 4.5 em 10 prints reais e só trocar se acertar em todos os campos principais.
- **Resumo da semana** (claude-haiku-4-5) — - **Quando:** na cron, depois de recalcular os dias, sempre que falte o da semana anterior.
- **Entrada:** só agregados (comer, gasto, peso médio, treino, joelho, medição), sem capítulos nem plano.
- **Saída:** {titulo, frases[4..6]} em PT-PT neutro, sem culpa.
- **Custo:** cerca de 0,002 $ por semana.
- **Sem IA** (— (regras puras testadas)) — Código de barras, favoritos, Igual a ontem, Só números, pesagem, composição, peso médio, gasto medido e gasto de hoje, Próximo passo, frases do Balanço, deduplicação, sincronização com o intervals.icu e sugestão de favorito.
- **Controlo de custos** (—) — - Redimensionar no telemóvel antes de enviar; o SHA-256 evita analisar a mesma imagem duas vezes.
- Correções no Haiku sem imagem; favoritos e Repetir custam 0 €.
- Sem repetições escondidas: o SDK passa a maxRetries 0 por pedido (por omissão faz 2 repetições com timeout de 10 min, o que podia dar 3 a 6 chamadas dentro de uma função de 60 s).
- Limite mensal suave calculado em api_calls (10 € por omissão), com aviso em Definições › Avançado aos 80 %. Aos 100 %, as fotos ficam 'sem_analise' e aparece o cartão com [Analisar esta mesmo assim] [Subir limite] [Escrever em vez disso]. Nunca pergunta antes de cada foto.
- Limite de segurança de 40 análises de visão por dia.
- Prompt caching: não compensa (chamadas separadas por horas, cache de 5 min, prefixo pequeno).
- Na Fase 0, ler tokens reais em api_calls para confirmar estes valores antes de fixar o limite e os textos.
- **Estimativa:** 5 fotos por dia × 30 × cerca de 0,014 $ ≈ 2,10 $; 9 prints por mês ≈ 0,35 $; texto e correções ≈ 0,10 $; resumos ≈ 0,01 $. Total: cerca de 2,5 $ por mês (cerca de 2,2 €).

## Fica, muda, sai

- [keep] **Dia nutricional 04–04 (rules/nutritional-day)** — Continua a ser o núcleo da contagem e passa a aplicar-se também aos treinos, através de started_at.
- [keep] **Totais no servidor (rules/meal-totals)** — Decisão 20. Passa a servir também favoritos, repetir, Só números (item sintético) e update.
- [change] **Gasto adaptativo (regra 4)** — O cálculo do tdee_est fica igual e aparece como «Gasto medido pelo teu peso». shouldAdjustBase passa a comparar com a fórmula (Mifflin × 1,2 + média do treino) em vez do expected_tdee fixo; a sugestão de plano base aplica-se com 1 toque e Anular.
- [change] **expected_tdee (gasto previsto nas Definições)** — Deixa de ser editável e de aparecer; passa a ser a fórmula calculada pelo servidor. Evita três «gastos previstos» diferentes.
- [change] **Peso médio SMA7 (rules/weight trend7)** — Passa a Holt com tempo (α 0,15, β 0,05) na Fase 6, só se ganhar o teste com os pesos reais. Na troca faz-se backup e recalcula-se toda a história por /api/day/recompute em blocos; as medições guardam weight_used_kg e não mudam.
- [change] **Dia completo (regra 5) e «Fechar o dia»** — A regra fica (2 refeições ou marca manual). «Fechar o dia» dá lugar à pergunta «Ontem registaste 2 refeições. Foi tudo?»: «Sim» marca dia_fechado, «Faltou algo» marca faltou_algo e tira o dia das contas. A palavra «completo» nunca aparece.
- [keep] **Aviso do mínimo semanal de 1 400 (regra 6)** — Passa a nota âmbar no Balanço.
- [change] **Semana de manutenção (regra 7)** — Passa a «Semana de pausa da dieta», em chip, com explicação e interruptor; âncora fixa em profile.maintenance_anchor para uma pesagem antiga não mudar as semanas.
- [change] **Proteína ≥ 35 g por refeição (regra 8)** — Só no pequeno-almoço, almoço e jantar, sobre as refeições contadas, com tom neutro.
- [change] **Semáforo do joelho (regra 9)** — A regra fica igual. A interface passa a 3 botões (1, 4 e 7) com detalhe 0–10 opcional, dentro do treino, na confirmação da pesagem e numa linha fixa até 48 h; nunca na fila do Próximo passo. Acaba a grelha de 11 botões.
- [change] **Progressão da bicicleta (regra 10)** — Passa a «Sugestão seguinte», desligada do plano. Sessões com watts supostos ('prefill') ou sem batimentos não contam para subir nem reiniciam; os textos usam os degraus 130 · 140 · 150 e explicam o que falta.
- [keep] **Dupla progressão de força (regra 11)** — Passa para a Sessão de ginásio livre (Fase 5).
- [drop] **% refeições estimadas (regra 12)** — Com fotos ficaria perto de 100 % e a alternativa (% confirmadas) seria uma nota de cumprimento. Fica só um valor interno, sem ecrã.
- [change] **Regra 2 (kcal do exercício)** — Calorias do dispositivo × 0,7 para Outro, MET quando não há calorias (Fase 0, corrige o Outro = 0), cadeia de origem dos watts, kcal_rule e kcal_est congelado ao guardar.
- [keep] **Biblioteca de alimentos e porções aprendidas** — Vive só em Favoritos › Alimentos. O prompt leva os 40 mais usados por momento do dia, com índices curtos. Aprende com as correções; as fotos continuam sem criar alimentos.
- [keep] **Código de barras (Open Food Facts)** — Passa para meal?action=barcode com rewrite que mantém o URL; fica dentro de Escrever e em «+ Adicionar item».
- [change] **Fila offline** — Guarda também fotos (primeiro o ficheiro original), pesagens e prints, e só larga um item quando o servidor confirma. Envia ao abrir, no online e no visibilitychange.
- [drop] **Ecrã Registar** — Na Fase 1 continua a ser o destino de Fotografar, Galeria e Escrever a partir do (+); na Fase 2 é substituído pelas folhas e pelo pipeline assíncrono.
- [change] **Revisão obrigatória (MealReview)** — Passa à folha Refeição e à folha Rever (opcional, com botões).
- [change] **Hoje** — Ecrã inicial e centro do dia: número principal, barra da proteína, linhas do joelho, 1 Próximo passo e linha do dia com um número por linha. Saem os mosaicos e a linha semanal.
- [drop] **Separador Gráficos** — Cada gráfico passa para junto do seu tema: peso no Corpo; potência, batimentos e cargas no Treino; gasto no Balanço.
- [change] **Narrador semanal** — Passa a «Resumo da semana» neutro (Haiku), sem capítulo nem aderência a blocos, gerado sempre que falte.
- [park] **Capítulos, patrono, cartaz, Linha do tempo** — Vão contra o «centro de fitness» e o «simples». Saem da navegação na Fase 1 e ficam em Definições › Arquivo, só de leitura.
- [park] **Plano de 4 semanas gerado pela IA (plan/generate)** — Continua a servir o registo de força até à Fase 5, quando chega o ginásio livre com favoritos semeados a partir do último bloco. rules/plan-dates.ts fica no sítio.
- [park] **Calendário .ics** — Depende do plano. Arquivado na Fase 5, com guia para remover a subscrição no iPhone.
- [drop] **Strava OAuth, webhook e reconcileStrava** — Exigem subscrição. Saem do deploy na Fase 0 (para /archive); o mapeamento em _lib/strava.ts fica, com o seu teste. Os textos «Regista no Strava (entra sozinha)» são corrigidos.
- [keep] **Atalho iOS /api/health/daily** — Mesmo URL. Passos e sono aparecem numa linha em «Ver detalhes» do Balanço e nunca somam.
- [change] **PIN a cada 5 min** — Pede só depois de 12 h por omissão, com Desligado e Sempre.
- [change] **Definições com jargão** — Etiquetas simples, secção Bicicleta (potências, batimentos, rpm), balança, Ligações, Aparência, Avançado (custos em €) e Arquivo. Saem base_kcal, knee_safe, ICS_TOKEN e o gasto previsto editável.
- [drop] **Botão «Atualizar» manual** — A app refresca no visibilitychange.
- [change] **Tema só escuro e letra Georgia** — Tema Sistema, Escuro ou Claro, com a fonte do sistema.
- [keep] **Exportar CSV, api_calls com custos, 95 testes** — O CSV inclui favoritos, medidas e treinos novos. Custos em € em Definições › Avançado. Testes novos: composição (18 vetores), Holt, regra 2 e regra 10 revistas, closeDay com refeições por contar, circularidade do Balanço, concorrência da nota, e as guardas de funções, imports .js, regras puras, rotas e colunas.

## Design visual

Calmo e pessoal, como um instrumento, não um jogo. Superfícies cinzento-escuras (nunca preto puro). A cor só aparece quando tem significado, e sempre o mesmo: Comer a índigo (calmo, longe dos tons de alerta), Gasto a teal, Proteína a azul-céu, Corpo a fúcsia, atenção a âmbar. O vermelho fica só para dor no joelho ≥ 6 e para erros. Nada depende só da cor: acima do plano a barra ganha padrão tracejado e texto. Números grandes e tabulares; tudo o que é registo acontece em folhas inferiores; a decoração narrativa desaparece. As fotos de comida são as protagonistas visuais do Hoje.

**Tema:** Sistema, Escuro ou Claro, por omissão Sistema, guardado em profile.theme e aplicado com data-theme no <html>. Os tokens ficam em @theme (Tailwind v4, src/index.css) e são redefinidos em :root[data-theme="light"] e em @media (prefers-color-scheme: light) quando o tema é Sistema. Fotos e gráficos testam-se nos dois temas; no claro, as miniaturas levam borda de 1 px. Verificação de contraste (texto ≥ 4,5:1, barras ≥ 3:1 contra o trilho) e de daltonismo (deuteranopia e protanopia) nas barras de Comer, Proteína e Gasto, nos dois temas. O Modo calmo esconde a pesagem do dia.

**Tipografia:** Fonte do sistema (-apple-system, «SF Pro Text», system-ui): sem pedidos à rede, sem Inter nem Georgia. Todos os números usam tabular-nums.

| Papel | Tamanho e peso |
|---|---|
| Número principal | 56 px, 700, tracking-tight |
| Título de ecrã | 22 px, 600 |
| Número de cartão | 24 px, 600 |
| Corpo | 17 px (padrão do iOS) |
| Secundário | 15 px |
| Legendas | 13 px |

No máximo 2 pesos por ecrã.

Números com Intl.NumberFormat('pt-PT'), vírgula decimal e espaço fino nos milhares («1 880»). Arredondamentos: kcal a 10 nas frases e nas linhas, g a 1, kg de peso a 0,1, kg de composição a 0,5, % de gordura inteira. «cerca de» nas frases e «≈» só nas linhas compactas. Nas manchetes, palavras em vez de sinais («a descer 0,4 kg por semana»).

**Paleta:**
- **Fundo** #0F1115 — Fundo da app no escuro (claro: #F6F7F9)
- **Superfície** #181B21 — Cartões e folhas (claro: #FFFFFF)
- **Superfície 2** #22262E — Chips, campos, trilho das barras (claro: #EEF0F3)
- **Linha** #2C313A — Bordas e grelha dos gráficos (claro: #E1E4E9)
- **Texto** #F2F3F5 — Texto principal (claro: #111318)
- **Texto secundário** #9AA1AC — Legendas, pesagem do dia, sugestões (claro: #5F6672)
- **Comer** #8B8FF7 — Barra de energia, barras do Balanço, botão (+) (claro: #4F53CF)
- **Gasto** #2DD4BF — Treino e gasto: «+380 do treino», linha do gasto, minutos de treino (claro: #0F8F80)
- **Proteína** #4CC3F5 — Barra e valores de proteína (claro: #0B7FB8)
- **Corpo / Massa magra** #E879F9 — Linha do peso médio, segmento de massa magra, cintura (claro: #A21CAF)
- **Gordura corporal** #F5D0FE — Segmento de gordura na barra empilhada; tom claro da família Corpo (claro: #F0ABFC)
- **Atenção** #F5B942 — Por confirmar, «confirma», acima do plano (com padrão), joelho amarelo (claro: #B7791F)
- **Dor / erro** #F0716B — Só joelho ≥ 6 e erros técnicos; nunca comida nem peso (claro: #D14343)
- **OK** #4ADE80 — Só ✓ discretos e joelho verde (claro: #15803D)

**Componentes:**
- BottomSheet: pega, deslizar para baixo fecha, botão principal fixo no fundo, visualViewport para o teclado nunca tapar o campo, padding-bottom env(safe-area-inset-bottom), abre em 220 ms com cubic-bezier(.2,.8,.2,1); no máximo uma aberta
- CaptureButton (+): 64 px, elevado 8 px, fundo na cor Comer
- HeroNumber: conta até ao valor em 400 ms quando o plano muda; estado esbatido «ainda a contar N fotos»
- EnergyBar e MacroBar: 12 px, arredondadas; acima de 100 % o excesso aparece âmbar com padrão tracejado e texto
- NextStepCard: no máximo 1 por ecrã, com «Agora não»
- KneeRow e KneePicker: 3 botões de 56 px (Bem, Algum incómodo, Doeu) e «mais detalhe 0–10»; a linha fica fixa no topo da linha do dia
- TimelineRow: miniatura de 64 px, altura mínima de 56 px, um número por linha, variantes peso, refeição, a analisar (shimmer), por confirmar, erro, sem análise e treino; estado «acabado de registar · Anular» durante 60 s
- FavoriteGrid: grelha fixa 2 × 3 de 48 px de altura; mais de 8 px de movimento cancela o toque
- Toast com Anular: 10 s, acima da barra e do (+); os favoritos mostram porções («½ · 1½ · 2»)
- WeekStrip: só datas, hoje em destaque, ‹ › para semanas, sem pontos nem contadores
- DateTimeSheet: dia em chips, momento em chips com hora habitual, hora exata recolhida
- NumberField de pesagem: 48 px, teclado aberto, sugestão a cinzento, ±0,1 de 48 px
- ConfidenceTag: âmbar «confirma» ou «confirma a porção»
- StackedBar: magra | gordura
- SegmentedControl e RangeChips (1M · 3M · Tudo)
- SyncBadge e QueueChip («2 à espera de rede»)
- Shimmer que se transforma num ✓ quando os números chegam
- Gráficos (Recharts): pontos a 30 % de opacidade, linha de 2,5 px, meta tracejada, rótulos na própria série, cores lidas das variáveis CSS; nunca mais de 2 séries por gráfico
- Movimento: entradas de 150 a 250 ms ease-out; «+380 do treino» sobe a partir da barra; tudo desligado com prefers-reduced-motion. Sem vibração (não existe no iOS): o retorno é visual
- Toque: alvos de 44 pt ou mais, botões principais de 56 px com a largura toda na zona do polegar, margens laterais de 16 px, sem scroll horizontal da página

## Fases


### Fase 0 — Estabilizar o deploy

**Objetivo:** Produção sem erros 500, chamadas à IA previsíveis e proteções para o deploy não voltar a falhar em silêncio. Duração: 1 a 2 dias.

- Confirmar a correção dos imports .js em produção: 1 parse-text, 1 parse-photo e 1 health/daily reais; ver os logs da Vercel e api_calls
- Chamadas à Anthropic: opções por pedido {maxRetries: 0, timeout: 35_000}; thinking {type: 'disabled'} no Sonnet 5 para refeição e print (comparado em 10 fotos reais com adaptive + effort 'low'); verificar stop_reason antes de parsed_output; uma nova tentativa explícita só em 429, 5xx ou ligação e com 20 s ou mais de folga
- Ler tokens reais em api_calls e registar o custo por foto e por texto, para calibrar o limite e os textos de custo
- vercel.json: "regions" junto ao projeto Supabase; sai o rewrite /api/strava/:action; entram /api/food/barcode/:ean → /api/meal?action=barcode&ean=:ean e /api/day/:action → /api/day?action=:action
- Mover api/strava.ts e api/_strava/* para /archive; tirar reconcileStrava da cron (8 → 7). api/_lib/strava.ts (mapeamento) fica com o seu teste
- Juntar api/food/barcode/[ean].ts ao meal?action=barcode (7 → 6)
- Criar api/day.ts com a ação health (6 → 7)
- Testes de guarda no vitest: contagem de entradas em api/ (ignorando segmentos que começam por _ ou . e README) que falha acima de 10; imports relativos em /api terminados em .js; api/_lib/rules/* sem @supabase nem node:; cada /api/… chamado em src/ corresponde a uma função ou rewrite
- Script de fumo depois de cada deploy: curl a cada função (401 ou 405, nunca 500) e GET /api/day/health com token (200)
- Regra 2: Outro sem calorias passa a MET × peso médio × horas (função pura + testes); manual.ts grava-o. Corrige o Outro = 0
- Corrigir os textos «Regista no Strava (entra sozinha)» e «Definições (M6) ou no Supabase»
- Backup CSV de todos os dados; decisões novas em docs/decisions.md

**Pronto quando:** O João regista 1 refeição por texto e 1 por foto em produção sem erro; api_calls mostra as chamadas sem pensamento e o custo real por foto; o script de fumo e o /api/day/health passam; os testes (95 mais as guardas) passam; a Vercel mostra 7 funções.

### Fase 1 — Casca nova, Hoje, pesagem e favoritos de refeição

**Objetivo:** Mudar já a forma como a app funciona com o que se usa todos os dias: o Hoje como centro, o (+) com desenho final, pesagem em 2 toques, favoritos e «Igual a ontem» sem IA. A captura de fotos continua a ser a atual, só que aberta a partir do (+). Duração: cerca de 2 semanas.

- Router com URLs (wouter) e a barra Hoje · Balanço · (+) · Treino · Corpo; «‹ Voltar» fora dos separadores
- Componentes base: BottomSheet, Toast com Anular (10 s), FavoriteGrid, NumberField, KneeRow e KneePicker, DateTimeSheet; tokens de tema Sistema/Escuro/Claro com a paleta nova; fonte do sistema
- Migração 1 (ver Mapa de migrações): favorites, profile, days.carbs/fat/dirty, maintenance_anchor, soft delete, kcal_est congelado, vistas meals_counted e workouts_active, trigger mark_day_dirty criado no fim
- _lib/close-day.ts extraído da cron: soma meals_counted e workouts_active.kcal_est, carbs e fat; usa maintenance_anchor; respeita dia_fechado e faltou_algo. A cron recalcula desde min(dirty mais antigo, hoje − 3), no máximo 21 dias por noite, limpando dirty por ordem
- Hoje: número principal e barra da proteína, linhas do joelho (a lógica atual de pain_next_day passa para aqui e para a confirmação da pesagem), Próximo passo 4, 5, 7 e 8, linha do dia com um número por linha, faixa da semana sem pontos, registo num dia passado
- Folha (+) com o desenho final: Fotografar, Galeria e Escrever abrem o Registar atual como página /registar, com Galeria sem capture, a nota guardada em raw_text e logged_at editável (o servidor já aceita); Treino abre o formulário manual atual; Medidas ainda não aparece
- Folha Refeição v1 (foto por URL assinado, itens, 4 macros, ☆ Favorito, Repetir hoje, Copiar para outro dia, Apagar com Anular) e ações meal/log-favorite, repeat, delete e restore
- Página Favoritos (Refeições · Alimentos), grelha no (+) e «Igual a ontem»
- Folha Pesagem (teclado aberto, sugestão, ±0,1, dia, verificação de 3 kg, texto da água, joelho pendente, % da balança com o interruptor)
- Corpo v1: cartão Peso com gráfico e peso médio calculado no telemóvel, estados iniciais
- Balanço v1: «Esta semana comeste em média 1 750 por dia; o plano era 1 850. O peso médio está a descer 0,4 kg por semana.», um gráfico de barras com o plano, o aviso do mínimo e o gasto medido atual em «Ver detalhes»
- Treino: ecrã atual sem o cartão de capítulo e patrono, com os gráficos de potência, batimentos e cargas vindos de Gráficos; o plano de força continua a funcionar
- Sai Gráficos; Capítulo e Linha do tempo passam para /definicoes/arquivo; Definições com linguagem simples e secção Bicicleta; PIN a 12 h; cartões da primeira vez (Pesa-te, Fotografa)

**Pronto quando:** A app abre no Hoje. O João pesa-se em 2 toques mais o número; guarda o pequeno-almoço habitual como favorito e regista-o no dia seguinte em 2 toques, sem nova linha em api_calls; «Igual a ontem» repete o almoço; apaga uma refeição e anula; recarregar mantém o ecrã; uma pesagem de há 5 dias aparece logo no gráfico e em days depois da cron seguinte; tudo o que funcionava continua a funcionar; 7 funções.

### Fase 2 — Comida sem espera

**Objetivo:** Fotos ao longo do dia sem esperar, com notas, editáveis e sem perder nada. O requisito 1 fica completo. Duração: cerca de 2 semanas.

- Primeiro dia: teste no iPhone do João (foto com EXIF, foto guardada do WhatsApp, HEIC, captura de ecrã, seleção múltipla de 3, lastModified)
- Migração 2 (colunas assíncronas de meals com preenchimentos antes de religar o trigger, tags, item sintético, meals_counted com status, days.meals_pending, claim_meal_analysis, limites de custo, storage_orphan_candidates)
- meal: capture (202 + waitUntil), analyse com reset, correct, update com escrita protegida da nota, quick, delete e restore; índices curtos dos alimentos; limites mensal e diário
- day: recompute {from, to} em blocos de 30 dias; o telemóvel chama-o depois de pesagens em dias passados e de mudanças de dia
- Telemóvel: fila IndexedDB com o ficheiro original primeiro, processamento uma foto de cada vez, EXIF antes do canvas, 1024 px mais miniatura de 256 px, SHA-256, upload com upsert, pergunta de estado de 3 em 3 s, novas tentativas no visibilitychange e no online, chip «à espera de rede»
- Folhas Fotos da galeria (hora desconhecida com chips obrigatórios, Mover para…), Nota, Escrever ou ditar (Juntar foto, Código de barras, Só números), Refeição v2 (steppers, Corrigir por texto, tags, Reanalisar), Rever (botões, Corrigir no próprio cartão)
- Hoje: estados a analisar, por confirmar, erro e sem análise; número esbatido «ainda a contar»; Próximo passo 1, 2 e 6; linha de lacuna
- Cron: marca análises presas como erro (sem IA); ao domingo limpa órfãos pela API do Storage e purga apagados com mais de 7 dias
- Sai o Registar antigo; parse-text e parse-photo saem quando a fila antiga estiver vazia

**Pronto quando:** O João tira 3 fotos seguidas sem esperar; carrega 2 fotos antigas da galeria que ficam na hora e no dia certos; uma foto do WhatsApp pede «Quando foi?»; junta «comi metade» a uma foto ainda em análise e a nota é aplicada; corrige outra por texto e apaga uma com Anular. Com o modo de avião, a foto fica na fila e entra quando volta a rede. Enquanto analisa, o número diz «ainda a contar 1 foto». Os days batem certo com o Hoje. 7 funções.

### Fase 3 — Treino: registo rápido e print

**Objetivo:** Qualquer treino entra em poucos toques, com os watts certos e o joelho registado; o print do Garmin ou do Strava junta-se à sessão sem duplicar. O requisito 2 fica completo. Duração: cerca de 1 a 2 semanas.

- Antes de começar: perguntar ao João «Gravas num relógio Garmin?» e «A consola mostra os watts?»; as respostas ficam no perfil e decidem textos e ordem dos botões
- Migração 3 (colunas de workouts, workouts_source_check, índice de external_id, workout_imports, bucket workout-shots, claim_workout_parse, profile.has_garmin_watch e console_shows_watts, favorito «Bicicleta habitual»)
- workout: save (Já fiz, favorito, confirmar ou juntar import, deduplicação e fusão), parse-shot (202 + waitUntil, prints no tamanho nativo), update, delete, restore e checkin
- Regra 2 revista (deviceCalories, cadeia de watts, kcal_rule, kcal_estimated) e regra 10 revista (prefill e sem batimentos neutros), com testes novos e os antigos a passar
- Folhas Treino, Joelho, Já fiz (com batimentos opcionais) e Confirmar treino (com «Juntar à Bicicleta das 07:10»); linhas do joelho também para «durante»; pergunta «E depois da última sessão?» no registo seguinte
- Separador Treino novo: Esta semana, Bicicleta habitual e Já fiz como ações principais, Juntar print do relógio, Sugestão seguinte, Histórico com /treino/:id, Progressão, Joelho, Treinos favoritos; a secção «Plano de força atual» fica até à Fase 5
- Favoritos › Treinos; Próximo passo 3 («falta confirmar»)

**Pronto quando:** O João regista a Bicicleta habitual em 3 toques com o joelho; junta 2 prints do Garmin a essa sessão, que ganha batimentos sem duplicar; o plano sobe exatamente workoutKcal dos valores guardados (140 W × 45 min = 378, mostrado «+380»); o mesmo print outra vez abre o treino existente sem custo; um «Outro» de 40 min de caminhada conta mais de 0; 7 funções.

### Fase 4 — Corpo: medidas, gordura e massa magra

**Objetivo:** Medidas quando quiser e a gordura e massa magra com intervalo e sem falsa precisão. O requisito 3 fica completo. Duração: cerca de 1 semana.

- Migração 4 (body_measurements; profile.measure_interval_days, thigh_landmark_cm, body_comp_source)
- api/_lib/rules/composicao.ts com os 18 vetores de teste, a constante única de plausibilidade, referenceWeight com janela de 7 dias e as diferenças a partir dos valores arredondados
- Folhas Medidas (1 leitura por omissão, Medir 2 vezes, validação simples, «Substituir a medição de hoje?») e Como medir; página Histórico de medidas com editar e apagar
- Corpo: cartões Gordura e massa magra e Cintura; série da balança à parte quando o interruptor está ligado
- (+) ganha 📏 Medidas; Próximo passo 9; cartão de primeira vez «Mede cintura e pescoço»

**Pronto quando:** O João faz a primeira medição e vê «Gordura 17,5 kg (cerca de 21 %) · Massa magra 67,5 kg»; corrige um erro de digitação no histórico; medir de novo no mesmo dia pede para substituir; 7 funções.

### Fase 5 — Ginásio livre e fim do plano gerado

**Objetivo:** Séries de 8 a 12 repetições sem plano, com as cargas da última vez, e saída do plano de 4 semanas. Duração: cerca de 1 semana.

- Migração 5: favoritos «Pernas A» e «Corpo todo B» a partir das sessões de força do último plan_block ou, sem elas, de um modelo fixo seguro para o joelho com 3 × 8–12
- workout/strength (criar e editar séries); ecrã Sessão de ginásio em /treino/ginasio e /treino/:id; sugestões da regra 11; texto de primeira vez
- Treino: botão Ginásio, carga por exercício na Progressão, sai a secção «Plano de força atual»
- Arquivar plan/generate, calendar, pairing e ics em /archive (plan-dates fica); tirar a expiração de blocos da cron (7 → 5); aviso em Definições › Avançado para remover a subscrição do calendário no iPhone

**Pronto quando:** O João faz uma sessão 3 × 10 a partir de «Pernas A» com as cargas preenchidas e corrige depois uma série errada; o script de fumo passa; a Vercel mostra 5 funções.

### Fase 6 — Balanço completo

**Objetivo:** Fechar a visão de centro de fitness: gasto de hoje, gasto medido contra fórmula e a frase da semana, sem contradições nem circularidade. Duração: cerca de 1 semana.

- Migração 6 (days.kcal_out_est, daily_base_est, formula_base; weekly_reviews.kind com troca de unique; profile.trend_method e trend_method_since)
- recomputeDay calcula formula_base (Mifflin × 1,2), daily_base_est e kcal_out_est; expected_tdee passa a ser escrito pelo servidor; testes da regra 4 atualizados; teste da circularidade (20 % de subregisto)
- Balanço final: frase da semana com tdee congelado, frase de coerência a partir da 3.ª semana, gráfico de barras e linha do gasto, Resumo da semana, «Ver detalhes» (proteína média, treino, gasto medido contra fórmula, sugestão de plano base com Anular), ano de nascimento inline
- Folha O plano de hoje com «Gastas cerca de 2 580 hoje. O plano deixa-te comer 1 880…»
- Resumo da semana neutro (Haiku), gerado sempre que falte, com kind
- Teste do Holt contra o SMA7 com os pesos reais; se ganhar: backup, trend_method = 'holt', recálculo de toda a história por /api/day/recompute em blocos, tests/peso-tendencia.test.ts atualizado
- Modo calmo; «qualidade da perda» no Corpo (3 medições ou mais e 3 kg ou mais)

**Pronto quando:** No Balanço, o João lê numa frase quanto come abaixo do que gasta e se o peso confirma; antes de 10 dias completos vê «Gasto (a aprender)» com o contador; num dia acima do plano mas abaixo do gasto, o Hoje e a folha dizem a mesma coisa; o resumo de segunda-feira sai sem capítulos; 5 funções.

### Fase 7 — Treinos automáticos (intervals.icu), só com relógio Garmin

**Objetivo:** Treinos com 0 toques e 1 toque para o joelho.

- Migração 7 (integrations sem políticas, profile.integration_status, health_daily.source)
- workout: connect (valida em /athlete/0 com Basic 'API_KEY:' + chave), sync e status; sincronização ao abrir (mais de 20 min), com o botão e no passo 1 da cron (teto de 8 s); mapeamento de tipos; fusão silenciosa com a Bicicleta habitual ou a foto da consola e chip «possível duplicado»; bem-estar para health_daily; peso só em dias sem pesagem do João
- Linhas do joelho «durante» para treinos sincronizados
- Guia simples em Definições › Ligações com [Testar] e [Importar últimos 30 dias] (os dias antigos entram por dirty e pelo recálculo em blocos)

**Pronto quando:** Um treino gravado no relógio aparece sozinho até 20 minutos depois de abrir a app, com os batimentos do Garmin; a foto da consola junta-se ao mesmo treino sem duplicar; uma pesagem manual nunca é substituída; 5 funções.

### Fase 8 — Extras (opcional)

**Objetivo:** Melhorias independentes, cada uma utilizável sozinha, sem mudar o número de funções.

- Balanço › Mês (barras por semana, evolução do gasto medido, passos e sono) e os 10 alimentos mais frequentes
- Fotos de progresso (bucket privado progress-photos, frente e lado)
- Registo de exame DEXA como referência (method 'dexa')
- Atalho Apple Saúde para a balança (body[] em /api/health/daily)
- Um lembrete push matinal opcional (iOS 16.4 ou mais, PWA no ecrã principal)
- Upload de FIT para quem quiser
- Medir o Haiku 4.5 na leitura de prints (10 prints reais)
- Passkey com Face ID (WebAuthn) em vez do PIN
- Com o acordo do João: remover meals.photo_path e as tabelas estacionadas numa migração separada

**Pronto quando:** Cada extra funciona sozinho e continuam 5 funções.

## Riscos

- **A produção ainda está instável: a correção dos .js não está confirmada.** — A Fase 0 vem antes de tudo: chamadas reais, script de fumo, /api/day/health e teste de guarda dos imports .js.
- **O deploy volta a falhar em silêncio por passar o limite de 12 funções.** — O estado final usa 5 funções e nunca passa de 7 pelo caminho. O teste de guarda falha acima de 10; funcionalidades novas entram como ?action= nos routers existentes; código arquivado vai para /archive.
- **Chamadas à IA mais caras, lentas ou cortadas do que o previsto (pensamento adaptativo ligado por omissão no Sonnet 5, repetições do SDK dentro de uma função de 60 s).** — thinking desligado e maxRetries 0 por pedido desde a Fase 0; timeout de 35 s; stop_reason verificado; custo real medido em api_calls antes de fixar limites e textos.
- **O iOS mata a PWA a meio de um upload ou de uma análise (não há Background Sync) ou por falta de memória com várias fotos.** — Ficheiro original no IndexedDB antes de tudo, fotos processadas uma a uma, item só sai da fila com o 202. Linha criada pelo servidor antes da IA (upsert por client_id), análise em waitUntil, pergunta de estado enquanto visível, lease de 90 s e 'erro' à 3.ª falha.
- **Uma tentativa atrasada escreve por cima de outra mais recente, ou uma nota perde-se entre a análise e a gravação.** — Escrita final protegida pelo analysis_started_at reivindicado e pela nota usada (comparar e trocar); meal/update volta a verificar a nota; teste com os passos intercalados.
- **Rascunhos e refeições por analisar entram nos totais, no plano de hoje, na progressão ou no dia completo.** — Prints por confirmar vivem em workout_imports; refeições contam só pela vista meals_counted, usada por todos os leitores; teste de que 2 refeições com erro não tornam o dia completo.
- **Fotos da galeria sem EXIF ficam todas «agora» e juntam-se numa só refeição no dia errado.** — Sem EXIF a hora é desconhecida, a data do ficheiro só se usa se for claramente antiga, fotos sem hora nunca se agrupam e pedem dia e momento antes de «Analisar». Teste no iPhone no primeiro dia da Fase 2.
- **A limpeza de órfãos apaga miniaturas, fotos à espera na fila ou fotos de favoritos.** — Guarda por pasta ({uid}/{client_id}/ e fav/{id}) e por thumb_paths, só considera objetos com mais de 7 dias, apaga pela API do Storage, no máximo 50 por noite.
- **Os days ficam desatualizados, ou a cadeia do gasto medido fica por recalcular, depois de edições e pesagens antigas.** — Trigger mark_day_dirty com cláusula WHEN; só o recálculo para a frente limpa dirty; cron com máximo de 21 dias por noite e /api/day/recompute em blocos de 30; kcal_est congelado para o passado não mudar com regras novas.
- **Uma pesagem ou import antigo move a semana de pausa da dieta e reescreve planos passados.** — Âncora fixa em profile.maintenance_anchor, definida uma vez na Migração 1.
- **A cron passa os 60 s (recálculo longo, resumo, sincronização).** — "regions" junto ao Supabase, prazo interno de 45 s verificado antes de cada dia e passo, máximo de 21 dias por noite, nenhuma chamada ao Sonnet na cron, resumo gerado sempre que falte (não só à segunda-feira).
- **O Balanço diz coisas contraditórias ou culpabilizantes (plano contra gasto, «porções subestimadas»).** — Duas palavras fixas (Comer, Gasto), frase que explica a diferença, comparação sem circularidade, textos neutros revistos, nada de «se não comeres mais».
- **A pergunta do joelho não aparece e a progressão para sem explicação.** — Joelho fora da fila do Próximo passo: na pesagem, numa linha fixa até 48 h e no treino seguinte; favoritos de treino passam sempre pela folha Joelho; a Sugestão seguinte diz o que falta.
- **A progressão da bicicleta sobe com watts supostos ou sem batimentos.** — Sessões 'prefill' ou sem batimentos não contam para subir; testes dedicados; campo opcional de batimentos no «Já fiz».
- **A troca para Holt mistura métodos ou reescreve medições antigas.** — Só depois do teste com os pesos reais; backup; recálculo de toda a história de uma vez; as medições guardam weight_used_kg.
- **A estimativa de gordura é lida como exata, ou a descida de massa magra nas primeiras semanas assusta.** — Intervalo e método a um toque, pontos só nas datas medidas, «a fita já confirma» só a partir de 1,5 pp, frase sobre água e glicogénio, cintura em cm sempre ao lado.
- **Apagar sem querer (deslizar, toque num favorito ao fazer scroll).** — Sem deslizar para mudar de dia; apagar reversível 7 dias; avisos de 10 s; «acabado de registar · Anular» durante 60 s; grelha fixa sem scroll lateral.
- **O intervals.icu depende de terceiros.** — Opcional e no fim; a Bicicleta habitual, o Já fiz e o print funcionam sempre; erros em linguagem simples nas Ligações.
- **Espaço no Supabase gratuito (1 GB).** — Fotos de 1024 px (cerca de 150 KB) e miniaturas de 15 KB, cerca de 0,3 GB por ano; prints apagados aos 90 dias; limpeza de órfãos; aviso em Definições › Avançado aos 700 MB.
- **Migrações feitas à mão no SQL Editor.** — Uma por fase, aditiva e idempotente (drop … if exists, create or replace, constraints com nome), backup de days antes, preenchimentos antes dos triggers, verificação de RLS no fim, guia PT de copiar e colar e teste de guarda das colunas.
- **É uma mudança grande para um utilizador pouco técnico.** — Cada fase entrega algo utilizável; o (+) tem o desenho final desde a Fase 1; estados vazios ensinam uma ação de cada vez; Anular em tudo.
- **Perda de motivação sem a narrativa.** — A frase do Corpo («cerca de 2 kg de gordura a menos, massa magra estável») e o Resumo da semana contam a história do progresso real. Os capítulos ficam no Arquivo.
- **O Supabase gratuito pausa o projeto por inatividade.** — O uso diário evita a pausa. O CSV fica como backup.

## Decisões do utilizador

- **Gravas a bicicleta e o ginásio num relógio Garmin?** Recomendação: Responder antes da Fase 3. Para a bicicleta em casa, a ação principal passa a ser a Bicicleta habitual; o print junta os batimentos. O intervals.icu (Fase 7) só entra se responderes que sim. Alternativas: Sim: faz-se a Fase 7 e os treinos entram sozinhos | Não: fica a Bicicleta habitual, o Já fiz e o print, e a secção Ligações desaparece
- **A consola da bicicleta mostra os watts?** Recomendação: Se mostra, a Bicicleta habitual usa os teus watts e podes tirar uma foto à consola quando mudares de potência. A app nunca usa as calorias do relógio na bicicleta. Alternativas: Não mostra: a app usa os últimos watts conhecidos, marcados com ≈, que não contam para subir a potência | Usar as calorias do relógio × 0,5 (não recomendado, contraria a regra testada)
- **Como queres dizer como está o joelho?** Recomendação: 3 botões grandes, Bem · Algum incómodo · Doeu, com «mais detalhe 0–10» opcional. O semáforo continua exato. Alternativas: Só a escala 0–10, como hoje
- **O que fazer aos capítulos, ao patrono, ao cartaz e ao plano de 4 semanas gerado pela IA?** Recomendação: Arquivar: saem da navegação e ficam em Definições › Arquivo, só para ver. O plano continua até a Fase 5 trazer o ginásio livre, com 2 rotinas criadas a partir do teu último bloco. Alternativas: Apagar de vez | Manter o plano de 4 semanas ativo no separador Treino
- **PIN na app?** Recomendação: Pedir só depois de 12 h com a app fechada. Alternativas: Desligado (a sessão Supabase já protege) | Sempre, como hoje (a cada 5 min)
- **Uma refeição com dúvidas conta logo?** Recomendação: Sim, conta com ≈ assim que os números chegam; confirmas quando quiseres. Enquanto uma foto está a ser analisada, o número diz «ainda a contar 1 foto». Alternativas: Só contam depois de as confirmares
- **Podes dar o ano de nascimento?** Recomendação: Sim, uma vez, quando o Balanço o pedir. Serve para estimar o teu gasto desde o primeiro dia. O sexo já está no perfil. Alternativas: Não dar: até haver 10 dias completos o gasto usa o valor fixo atual (2 200)
- **Limite de gastos com a IA por mês?** Recomendação: 10 € por mês, com aviso aos 80 % em Definições › Avançado. Ao chegar ao limite, as fotos ficam guardadas e escolhes analisar mesmo assim, subir o limite ou escrever. O custo esperado ronda os 2 a 3 € por mês. Alternativas: 5 € por mês | Sem limite
- **Quanto tempo guardar as fotos?** Recomendação: As fotos de comida ficam sempre, a 1024 px (cerca de 0,3 GB por ano). As imagens dos prints apagam-se aos 90 dias, mas os números ficam. O que apagas pode ser reposto durante 7 dias. Alternativas: Apagar as fotos de comida ao fim de 12 meses | Guardar também os prints para sempre
- **A tua balança mede a % de gordura?** Recomendação: Se sim, liga o interruptor e aparece um campo opcional na pesagem; fica numa linha à parte da fita. Alternativas: Não: fica só a fita métrica
- **Queres metas para hidratos e gordura?** Recomendação: Não: só se mostram na folha O plano de hoje. As metas ficam nas calorias e na proteína (140 g). Alternativas: Definir metas de hidratos e gordura nas Definições
- **Manter a semana de pausa da dieta a cada 6 semanas?** Recomendação: Manter, com explicação na app e interruptor nas Definições. Alternativas: Desligar
- **Que nome aparece no ecrã principal do iPhone?** Recomendação: «Regresso»: curto, o iOS não o corta. Alternativas: «A Época do Regresso» (fica cortado debaixo do ícone) | Outro nome à tua escolha
- **Esconder a pesagem do dia e mostrar só o peso médio (Modo calmo)?** Recomendação: Desligado por omissão. Mesmo assim, a pesagem nunca aparece a vermelho nem como diferença para ontem. Alternativas: Ligado desde o início
