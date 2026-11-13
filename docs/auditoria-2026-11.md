# Auditoria completa — novembro de 2026

Auditoria só de leitura ao código (`src/`, `api/`, `supabase/`, `prompts/`, `tests/`; o `archive/` ficou de fora) e à base de dados de produção (consultas de leitura). Nada foi alterado na app nem nos dados.

**Como ler:** cada achado tem um código (K = cálculos, M = comida, T = treino, S = servidor, H = Hoje e registo, B = Balanço e Corpo, G = segurança, L = legado, P = performance, D = dados reais), a gravidade, o sítio no código, o que acontece e a correção proposta. «Confirmado» quer dizer que corri a função com valores concretos ou li o caminho inteiro; «suspeita» quer dizer que falta um passo para ter a certeza, e digo qual.

## Estado de partida

- `npm run typecheck` limpo, 877 testes a passar, build de produção sem erros.
- Integridade dos dados reais: nos 381 dias guardados, as kcal do dia batem com a soma das refeições e dos treinos (as únicas diferenças são os dois dias de hoje, ainda por fechar); nas 473 refeições, o total de cada uma é exatamente a soma dos itens; não há fotos órfãs no Storage; não há refeições presas em análise.
- Só existem as 2 contas esperadas; todas as tabelas têm RLS; não encontrei nenhum caminho para uma conta ler ou alterar dados de outra por id.
- Datas: toda a aritmética é em UTC sobre `AAAA-MM-DD`, o dia nutricional (corte às 4h) e as semanas de segunda a domingo estão coerentes, incluindo as mudanças de hora e a passagem de ano.
- Fórmulas conferidas e certas: Marinha dos EUA (homem e mulher), Mifflin × 1,2, 7 700 kcal/kg, bicicleta W × min × 0,06, ginásio pelo relógio/ritmo/METs, ciclo, semana de pausa, calendário e resumo do mês.

A base é sólida. Os problemas concentram-se em cinco sítios: o **gasto medido com poucas pesagens**, a **junção de treinos que entram por duas vias**, os **cortes a dobrar nas refeições** (etiquetas, notas, porção e sobras que a IA não conhece), a **robustez do que corre sem ninguém a ver** (cron noturna, fila de fotos) e o **peso do que já não se usa**.

## 1. O que tratar primeiro

| # | Achado | Porquê primeiro |
| --- | --- | --- |
| 1 | **K1** — o «gasto medido pelo peso» nasce com uma ou duas pesagens e fica igual ao que a pessoa come | Alimenta o Balanço, a Conta da gordura, a projeção e a sugestão de plano; nos dados reais já acontece na conta que se pesa pouco |
| 2 | **T1** — o mesmo treino conta duas vezes quando a app e o relógio discordam mais de 5–10 % na duração | Duplica as kcal do dia sem nenhum aviso |
| 3 | **M1** — o chip «Comi metade» numa refeição a analisar não muda os números: fica o prato inteiro | O dobro das kcal com a etiqueta a dizer o contrário |
| 4 | **B1** — o gráfico do Peso em 1M/3M tem outro «início» e outra descida do que o resumo por cima | É o período por omissão; apanha toda a gente nos primeiros 3 meses |
| 5 | **S1** — a cron noturna pára para toda a gente se o fecho de um dia de uma pessoa falhar | Falha em silêncio; ficam dias por fechar, sem resumo semanal e sem limpeza |
| 6 | **H1** — uma foto que falhe sempre com erro 5xx bloqueia todas as fotos atrás dela na fila | As seguintes ficam em «A enviar…» para sempre |
| 7 | **S2** — o fecho do dia ignora erros de leitura e regrava o dia sem as marcas «Foi tudo?» | Perde respostas do utilizador |
| 8 | **H2 / B8** — um refresh do Hoje que falhe apaga o dia que estava no ecrã; o Balanço sem rede diz «Regista alguns dias» | São os ecrãs mais usados, com rede móvel |
| 9 | **M2** — «Analisar outra vez» numa foto lida pelo modelo de reserva não relê as porções e apaga o aviso | 118 das 473 refeições foram lidas pela reserva |
| 10 | **T2** — print de bicicleta com calorias e sem watts: a folha promete um número e o servidor grava outro | A pessoa não tem como evitar |
| 11 | **T5** e **T6** — abrir um treino de ginásio pelo ＋ não abre o Ginásio; o campo da carga não aceita 12,5 kg | Dois defeitos diários no ginásio |
| 12 | **B6 / B7** — medidas fora dos limites gravam sem confirmação; «Anular» uma pesagem antiga apaga a original | Um erro de dedo estraga o gráfico; perde-se um dado |
| 13 | **G1** — a fronteira da «casa» depende de o registo de contas estar desligado no painel do Supabase | 1 minuto a confirmar; se estiver ligado, é grave |
| 14 | **S3 / H3** — tudo o que lê mais de 1 000 linhas fica cortado sem aviso (teto mensal da IA, exportar CSV, «dias seguidos») | Ainda não aconteceu (473 refeições); acontece dentro de meses |
| 15 | **L1** — o README não lista 2 migrações e a app não avisa da falta delas | Reinstalar o projeto fica com colunas em falta sem aviso |
| 16 | **D1** — 10 treinos de bicicleta antigos estão a 0 kcal com 160–610 kcal medidas pelo relógio | Correção de dados de uma vez |

## 2. Cálculos — corpo e energia

**K1 · alta · confirmado por execução e nos dados reais** — `api/_lib/rules/adaptativo.ts:32-60` (`tdeeRaw`) com `api/_lib/close-day.ts:320-324`.
O fecho do dia grava em `weight_trend` a média das pesagens de [dia−6, dia]; uma única pesagem dá por isso 7 dias seguidos com a mesma tendência. O `tdeeRaw` só exige duas tendências em datas diferentes e lê isto como «peso estável»: descida 0, logo gasto = média do que se comeu. Simulação: homem com gasto real de 2 130 kcal a comer 1 600, duas pesagens no mesmo fim de semana → `raw` = 1 600 e o gasto estimado desce até ~1 800 e fica lá; com uma pesagem só, a sugestão do plano base chega a propor o mínimo. Passados 10 dias completos o Balanço deixa de dizer «a aprender» e apresenta o número como «medido pelo teu peso». Nos dados reais, a conta com 0 a 2 pesagens por semana tem o gasto bruto das últimas semanas colado ao que comeu.
*Correção:* medir a descida entre pesagens reais (não entre dias que carregam a média) e exigir um mínimo, por exemplo 4 pesagens a cobrir 10–14 dias, como a projeção já exige; sem isso fica a fórmula e o ecrã diz «fórmula», não «medido».

**K2 · média · confirmado por execução** — `api/_lib/rules/conta-gordura.ts:28-52`, `src/components/ContaGordura.tsx:65-77`.
O «previsto» soma o défice só dos dias completos; o «real» é a descida do peso em todos os dias de calendário. Com 30 dias e 15 completos: previsto 1,5 kg, real 3 kg, e a nota conclui «no início sai água, ou o gasto real é maior», quando a diferença são só os dias de fora. O desvio acumula desde o início da dieta.
*Correção:* extrapolar o défice médio dos dias contados aos dias de calendário, ou comparar só quando os dias de fora são poucos.

**K3 · média · confirmado por execução** — `api/_lib/close-day.ts:64-71, 97-113` contra `adaptativo.ts:225-236`; espelho em `src/lib/expenditure.ts:34-40`.
A base sem treino é o gasto medido (reage em semanas) menos o treino médio de 14 dias (reage em dias). Quando a frequência de treino muda, a base desvia-se: parar de treinar depois de 10 semanas com 5 treinos dá uma base até +147 kcal/dia acima da real durante ~5 semanas. Nesse período o «acima do gasto» fica mais brando e a Conta da gordura soma défice que não existiu.
*Correção:* usar para a base o mesmo treino médio da janela do gasto medido.

**K4 · média · decisão a rever (175 e 304)** — `adaptativo.ts:175-179, 247-248`, `gasto.ts:62-65`, texto em `src/screens/Balanco.tsx:604-611`.
Depois das 6 semanas o gasto medido fica para sempre a ±400 kcal da fórmula sedentária e a marca do limite é escondida. Quem gasta de facto 2 500 fica preso em fórmula + 400 (e o número desce com o peso, sem o gasto real mudar), com a explicação «no início o peso desce depressa com água», falsa ao fim de 4 meses. Nos dados reais, a conta que se pesa todos os dias está a ~360 kcal acima da fórmula, quase no teto.
*Correção:* alargar o limite quando o valor bruto está estável há 6+ semanas, ou manter visível «limitado a +400 da fórmula».

**K5 · média-baixa · latente** — `api/_lib/rules/manutencao.ts:21-23`.
`maintenanceTarget(null)` devolve 2 000 kcal para qualquer pessoa. Sem gasto medido, a semana de pausa manda comer 2 000: ~420 kcal acima do gasto para uma mulher de 62 kg, um défice para um homem grande. Hoje a semana de pausa está desligada nas duas contas, por isso não se vê.
*Correção:* sem gasto medido, usar a fórmula da pessoa mais o treino médio.

**K6 · média-baixa · confirmado por execução** — `api/_lib/rules/projecao.ts:97, 115-118`.
As pesagens são cortadas aos 28 dias antes de calcular a média móvel, por isso os primeiros pontos não têm o atraso da média e o declive sai achatado: descida real de 0,70 kg/semana dá «pelo peso médio 0,66». No mesmo dia o Corpo diz 0,7 e a folha da projeção 0,66.
*Correção:* calcular a tendência sobre todas as pesagens e só depois filtrar pela janela (os chamadores já leem 40 dias).

**K7 · média-baixa · confirmado por execução** — `src/screens/Balanco.tsx:386-388, 497-504`.
«✓ Bate certo» / «ainda não coincidem» calcula-se com qualquer número de dias completos da semana, basta um. À terça de manhã o veredicto depende de um dia só.
*Correção:* exigir 3 ou 4 dias, como o aviso do mínimo já faz.

**K8 · média-baixa · decisão a rever (288)** — `projecao.ts:233` contra `targets.ts:100`.
O cenário «+1 treino/semana» promete chegar mais cedo tirando as kcal do treino ao balanço, mas a regra 2 manda comer essas kcal. Para quem segue o plano o efeito é ~0.
*Correção:* tirar o chip, ou dizer «sem comer as kcal do treino».

**Menores (baixa):**
- **K9** — Hoje recalcula no telemóvel o gasto de um dia passado; o Balanço usa o guardado. Pesos e perfil diferentes podem trocar o veredicto na margem (`Hoje.tsx:399` contra `Balanco.tsx:251`). Usar `kcal_out_est` da linha do dia.
- **K10** — Corpo, Projeção e «O teu mês» usam a data de calendário; o Balanço usa o dia nutricional. Entre as 00:00 e as 04:00 as janelas ficam desalinhadas um dia.
- **K11** — um dia completo com alvo 0 (linha criada pelo gatilho e ainda por recalcular) conta como «acima do alvo» no calendário (`balanco-graficos.ts:179`).
- **K12** — «Esta semana, com hoje: 1 900 kcal abaixo do plano» às 9h com 0 kcal comidas: soma o plano inteiro de hoje (`balanco.ts:71-81`).
- **K13** — a média da gordura da balança (EWMA α 0,1) parte do primeiro valor: [25, 22, 22, 22, 22] dá 24,0 (`composicao.ts:372-377`).
- **K14** — medidas absurdas mas dentro dos limites (pescoço 45, cintura 60) dão gordura negativa, que os cartões desenham (`composicao.ts:134-149`).
- **K15** — texto «Faltam o gasto medido.» (`projecao.ts:107-109`).
- **K16** — no cartão do Hoje, Plano − Comido ≠ «Podes comer» em 25 % dos casos, por cada número arredondar a 10 por si: 1 500 − 70 mostra 1 440 (`src/lib/format.ts:15-17`).

## 3. Cálculos e fluxo — comida

As contas de base estão certas: escala por 100 g, total = soma dos itens em todos os caminhos de escrita, kJ → kcal e sal ↔ sódio do Open Food Facts, divisão que soma sempre a mesa (1,5 a 60/40 = 0,9 + 0,6), sobras em passos de 5 % pelo nome do item, e Anular pela ordem inversa a devolver exatamente o original. A reivindicação da análise em segundo plano é atómica e uma resposta tardia não escreve por cima de um reset. Os problemas estão no **contexto que a IA não recebe** e em **multiplicadores que não se conhecem uns aos outros**.

**M1 · alta · confirmado por leitura e simulação** — `api/_meal/async.ts:418`, `api/_lib/meal-analysis.ts:231, 364-365`, `NoteSheet.tsx:41-43`.
No «＋ Nota» de uma refeição ainda a analisar, tocar no chip «Comi metade» (ou «Azeite», «Porção grande») sem escrever texto grava só a etiqueta. A análise em curso já leu as etiquetas antigas, e a escrita protegida só verifica se a **nota** mudou, não as etiquetas. A refeição fica marcada «Comi metade» com os números do prato inteiro: o dobro das kcal. Se a análise já acabou é igual: sem nota nova não há correção, e o aviso diz «Nota aplicada».
*Correção:* guardar as etiquetas usadas na análise e tratá-las como a nota; numa refeição já analisada, uma etiqueta nova chama a correção.

**M2 · média · confirmado por leitura; 118 refeições afetadas nos dados reais** — `meal-analysis.ts:179-181, 211, 236, 336, 398-401`, `MealSheet.tsx:670-671`.
«Analisar outra vez», o botão do aviso «esta foto foi lida por outra que acerta menos nas porções», repõe a refeição em análise mas os itens ficam; como há itens, a chamada vai com o prompt de **juntar** («os itens atuais ficam como estão, devolve só o que é novo»). As porções mal lidas não são reestimadas e o aviso desaparece. O botão é quase um no-op que esconde o problema. Uma em cada quatro refeições (118 de 473) foi lida pelo modelo de reserva.
*Correção:* um modo «reler» explícito, com o prompt de raiz, a mostrar antes → depois com Anular.

**M3 · média · confirmado por execução** — `meal-analysis.ts:416-425`, `rules/analise.ts:166-168`.
«Juntar foto» ou «Analisar outra vez» numa refeição com mais de 12 h: num erro passageiro da IA a refeição fica em análise à espera de que o telemóvel peça outra tentativa, mas o telemóvel conta as 12 h desde a criação da refeição e não pede. Uma refeição que contava sai do total do dia até alguém tocar em «Tentar outra vez».
*Correção:* a juntar, qualquer falha volta logo a «por rever» com os itens que tinha.

**M4 · média · confirmado por leitura** — `async.ts:440-441`, `meal-analysis.ts:390-394`.
Quando a nota muda, a correção recebe a nota **inteira**. Se «comi metade» já tinha sido aplicado e a pessoa edita para «comi metade, sem pão», o prompt manda aplicar «comi metade» outra vez a itens já a metade. A segunda divisão depende do modelo; falta um caso real.
*Correção:* enviar também a nota já aplicada, com a instrução de aplicar só a diferença.

**M5 · média · confirmado por leitura** — `api/_meal/leftovers.ts:73-85`.
«Sobrou comida?» não diz à IA as etiquetas nem a porção. Numa refeição já a metade (chip ou Porção ½), a foto do depois mostra meio prato, a IA responde «comeu 50 %» e o corte aplica-se outra vez: 25 % do prato.
*Correção:* enviar as etiquetas e a porção, ou não oferecer «Sobrou comida?» com «Comi metade».

**M6 · média · confirmado por execução** — `MealSheet.tsx:324`, `async.ts:432`.
Anular «Mudar dia ou refeição» envia só a hora; o servidor deduz o momento pela hora. Uma favorita registada às 18:50 no «Jantar» volta como «Lanche».
*Correção:* o Anular enviar também o momento de antes (o servidor já o devolve).

**M7 · média · confirmado por execução; ainda sem casos reais** — `api/_meal/quick.ts:86-89, 325-328`.
Mudar a porção (ou partilhar a meias) depois de descontar sobras não reescala `leftover_kcal`: a refeição passa a 65 kcal e a folha continua a dizer «Sobraram ≈ 378 kcal». Nos dados reais há 5 refeições com sobras e nenhuma com porção diferente de 1.

**M8 · baixa-média · confirmado por leitura** — totais de dias passados.
`days.kcal_in` de um dia passado só é recalculado na hora quando o ecrã se lembra de o pedir. Não pedem: favorita num dia passado, «Repetir»/«Copiar para outro dia», código de barras, repor uma refeição apagada, e a análise de uma foto registada para ontem. O Balanço mostra o dia sem a refeição até à cron das 04:30. O mesmo para o que muda na conta de outra pessoa por partilha.
*Correção:* o servidor recalcular o dia no fim de cada escrita com data anterior a hoje, em vez de ~20 chamadas espalhadas pelo cliente.

**Menores (baixa):**
- **M9** — numa refeição a ½, «Juntar foto» e o código de barras metem itens a tamanho inteiro; voltar a «1» duplica-os (`rules/analise.ts:89-97`).
- **M10** — juntar um rótulo (confiança alta) a uma refeição por rever passa-a a «ok» sem ninguém confirmar (`meal-analysis.ts:345`).
- **M11** — Anular «Corrigir por texto» repõe os itens mas deixa a refeição como confirmada (`MealSheet.tsx:286`).
- **M12** — partilhar a meias, a outra pessoa apagar a cópia, e voltar a partilhar a meias dá 0,25 + 0,25: metade do jantar desaparece (`share.ts:126-133`).
- **M13** — se a cópia do «Também para…» falhar, a marca é limpa na mesma e a partilha perde-se sem aviso (`share.ts:348-354`).
- **M14** — apagar uma refeição a meio da análise não trava a escrita nem o aviso «Jantar analisado · 640 kcal» (`meal-analysis.ts:364`, `push.ts:145`).
- **M15** — Open Food Facts: produto com energia e sem macros entra com proteína 0 sem aviso; só com valores por dose dá erro quando dava para converter (`rules/off.ts:59-96`).
- **M16** — o filtro de linhas que não são comida corre em todas as fotos, não só em pedidos de entrega: «Total 0% Fage» e «Serviço de pão e azeitonas» são removidos (`rules/pedido.ts:35, 40`).
- **M17** — receitas: «1 bolo» ou «1 tarte (8 fatias)» ficam como 1 dose, e a favorita «por dose» fica com o bolo inteiro sem pedir confirmação (`rules/receita.ts:125-135`).
- **M18** — «Repetir uma refeição» com «Agora» grava à hora habitual do momento (às 21:30 fica às 20:00); uma favorita com «Agora» fica à hora real (`quick.ts:208`).
- **M19** — os botões − / + dos gramas escalam a partir do item já arredondado; o erro acumula em muitos toques (`src/lib/meal-diff.ts:29-41`).
- **M20** — limites da IA: as correções não verificam nenhum limite; chamadas que falham não contam; a verificação e a contagem não são atómicas (10 fotos da galeria passam todas).

## 4. Treino

### Cálculos e junção de treinos

**T1 · alta · confirmado por execução** — `api/_lib/rules/intervals.ts:172-192` (`syncMatch`), `treino.ts:126-130`, `sessoes.ts:110-131`.
Toda a deduplicação (fusão automática, «É este treino?» e o aviso «possível duplicado») exige duração parecida; nenhuma olha para a sobreposição no tempo. Três casos executados:
- Ginásio com o cronómetro da app (62 min, 18:00) e relógio (55 min, 18:03): duas sessões, 600 kcal em vez de ~300, sem aviso.
- «Bicicleta habitual» de 45 min e a mesma volta no relógio com 52 min: não junta, não pergunta, não avisa.
- Relógio partiu o treino em 20 + 25 min e houve «Já fiz» de 45: 756 kcal para um treino de 378.
*Correção:* tratar como candidato qualquer par do mesmo dia e tipo em que um é manual e o outro do relógio e os intervalos se sobrepõem (ou a hora do manual é suposta); no mínimo marcar sempre «possível duplicado» e oferecer «Juntar os dois».

**T2 · média · confirmado por execução** — `api/_workout/actions.ts:297-308`, `ConfirmWorkoutSheet.tsx:292, 540-545`.
Print (ou «Dizer») de bicicleta com calorias do relógio e sem watts: a folha mostra «Guardar · +450» pela regra das calorias do relógio e envia `watts: null`; o servidor vai sempre buscar os watts da última sessão e grava 504 «≈». O campo Potência nem aparece na folha.
*Correção:* no servidor, só ir buscar os últimos watts quando não há calorias do relógio.

**T3 · média · confirmado por leitura** — `DizerTreinoSheet.tsx:131, 139-160`.
«Dizer ou escrever» um ginásio nunca pergunta «É este treino?»: se o relógio já importou a sessão, fica um segundo ginásio ao lado e as kcal contam duas vezes. Na ordem inversa (ditar primeiro) junta bem: o resultado depende da ordem.
*Correção:* procurar a sessão do dia e, em «Sim, é esse», gravar as séries nessa sessão.

**T4 · média · confirmado por execução** — `intervals.ts:172-192`, `ConfirmWorkoutSheet.tsx:320-334`.
A fusão ignora o desporto nos «outros»: pilates dito (60 min) e caminhada do relógio (58 min) no mesmo dia ficam um só treino, em silêncio, com a FC e os km da caminhada.
*Correção:* exigir o mesmo desporto quando o tipo é «outro».

**T7 · média · confirmado por execução** — `src/screens/Ginasio.tsx:637-643, 224-227`, `progressao-forca.ts:56-92`.
Progressão de força: ao subir a carga (40 → 42 kg) as repetições vêm pré-preenchidas no topo (12); um toque em «✓ Todas» grava 42 × 12 sem as fazer e a sessão seguinte sugere 44. Além disso: não se exige a mesma carga nas duas sessões (30 × 12 e 40 × 12 → 42); peso do corpo (carga 0) sugere «Hoje: 1 kg»; exercícios de tempo máximo ficam «prontos para subir» com 12 segundos.
*Correção:* ao subir, pré-preencher com o mínimo de repetições; exigir a mesma carga de topo; não sugerir carga com carga 0 nem em exercícios de tempo.

**T8 · média · confirmado por execução** — `progressao-bike.ts:55-63, 92-94`.
O nível da bicicleta é sempre o da última sessão: depois de uma sessão leve (30 min a 130 W) a seguir a 160 W × 60 min, a sugestão recomeça em 130 W e são precisas ~10 sessões para voltar a 160. Uma volta de estrada a 95 W médios tem o mesmo efeito. Não há regra de descida quando a validação falha os limites de FC.
*Correção:* guardar o nível (o W mais alto validado nas últimas semanas) e voltar a ele depois da sessão leve.

**T9 · média · confirmado por leitura e execução da regra** — `api/_lib/intervals-sync.ts:402-422`.
Quando a sincronização junta um «outro» manual ao do relógio, guarda as calorias do relógio mas não refaz as kcal: caminhada dita (150 kcal estimadas) + relógio (320) fica com 150 em vez de 224. O `save` já corrige isto (decisão 207); a sincronização não.

**T19 · baixa · suspeita** — `api/_lib/fit.ts:51-52`.
A potência do ficheiro FIT lê-se da sessão, senão da última volta, senão do último registo; nos dois últimos casos é a potência do fim do treino, não a média. Falta um FIT real para confirmar.

**D1 · baixa-média · confirmado nos dados reais** — 10 treinos de bicicleta do intervals.icu (dez. 2025 a fev. 2026) estão com `kcal_rule = 'watts'`, sem watts e `kcal_est = 0`, tendo 160 a 610 kcal do relógio (~3 850 kcal no total). Entraram com a regra anterior à decisão 159 (5 de outubro) e a sincronização só refaz as contas dentro da janela recente. São dias anteriores ao início dos registos de comida, por isso não mexem no Balanço; afetam os totais de treino.
*Correção:* um SQL de uma vez em `supabase/oneoff/`, como o dos ginásios (decisão 280).

### UX do treino

**T5 · média · reproduzido no Chrome** — `TreinoSheet.tsx:42`, `DizerTreinoSheet.tsx:209` (e `MedidasSheet.tsx:330-331`).
Tocar num treino de ginásio no ＋ › Treino faz `sheet.close()` (um `history.back()` assíncrono) seguido de `navigate()`: o recuo executa depois e desfaz a navegação. 500 ms depois está-se em `/treino`, não no Ginásio. O próprio código conhece o risco e resolve-o noutra folha.
*Correção:* `navigate(url, { replace: true })` sem `sheet.close()`.

**T6 · média · confirmado por execução** — `src/screens/Ginasio.tsx:515-521`.
O campo da carga é controlado pelo número: ao escrever «12,» volta a «12», e o 5 seguinte dá «125». Os botões −/+ andam de 1 ou 2 kg, por isso 12,5, 17,5 e 22,5 quase não se conseguem escrever. O `TemplateSheet` já resolveu o mesmo problema.
*Correção:* guardar o texto em edição por série e converter ao sair do campo.

**T10 · média** — `Chips.tsx:42`, `DizerTreinoSheet.tsx:87, 322`.
O dia do treino só tem chips Hoje · Ontem · Anteontem. «No sábado fiz…» dito na quinta grava no sábado sem nenhum chip escolhido e sem a data aparecer em lado nenhum; num print de há 5 dias é igual. Se a IA leu mal, vai para o dia errado sem a pessoa ver.
*Correção:* um quarto chip com a data lida («sáb 7 nov»).

**T11 · média** — `Ginasio.tsx:59-68, 105-122, 187-194`, `Treino.tsx:54-93`.
Ginásio com pouca rede: «Começar Dia N» precisa de rede; com os pedidos a falhar, a sessão abre vazia e tudo aparece como «Primeira vez», sem dizer que foi erro; «Terminar» sem rede só mostra um aviso (não há fila, as refeições têm); o rascunho expira 6 h depois do início, por isso fechar a app e reabrir de manhã perde as séries. No Treino, qualquer erro mostra «Ainda sem treinos».

**T12 · média** — caminhos para registar um treino.
Existem 7: relógio (0 toques), print (4–5 + espera), dizer/escrever (4 + espera), um dos meus treinos (3–4, em três sítios diferentes, nenhum no separador Treino), «Já fiz» à mão (só alcançável como «Foi diferente?» dentro de outro), ginásio de um treino guardado e ginásio livre (sem nenhum botão que o abra). **Não há forma direta de registar à mão sem IA**: «45 min de bicicleta a 140 W» exige print ou «Dizer», e se a IA falhar o «Dizer» não tem «Preencher à mão».
*Correção:* três entradas no próprio Treino (Print · Dizer · À mão) com os teus treinos logo por baixo.

**T15 · média-baixa · decisão a rever (147)** — coisas que só fazem sentido para uma pessoa.
- `corpo/TreinoCharts.tsx:46, 74-80`: «Minutos de treino» soma só bicicleta e ginásio. Para quem faz caminhadas e aulas o gráfico diz «Sem treinos nos últimos 7 dias» com 3 treinos nessa semana.
- `Treino.tsx:139, 201-217`: «Próxima bicicleta: começa com 30 min a 130 W» aparece a quem tenha uma única volta de estrada do relógio.
- `rules/treino.ts:94`: qualquer bicicleta sem watts explica «a bicicleta manda-lhe os watts», falso numa volta de estrada.
- `PendingInfo.tsx:93-95`: qualquer bicicleta do relógio sem km nem potência pede «2 prints com a secção Connect IQ» durante 14 dias.
- «joelho» escrito no código em `Ginasio.tsx:408` e `PlanoSheet.tsx:29`; potências 130/140/150 por omissão.

**Menores (baixa):**
- **T13** — os watts supostos («≈ 140 W da última sessão») não se conseguem confirmar: a folha só envia `watts` se o número mudar. Só escrevendo 141 e voltando a 140.
- **T14** — «Juntar print» dentro da folha de um treino não diz a que treino é; se a duração lida diferir, cria um treino novo (`ConfirmWorkoutSheet.tsx:1002-1004`).
- **T17** — `ConfirmWorkoutSheet` (1 020 linhas, três folhas num ficheiro): em modo «Juntar» a Duração continua editável mas é ignorada, e apagar um dígito faz a folha mudar de forma; «Descartar» ao lado de «Guardar», imediato e sem Anular; os chips «Qual foi?» gravam logo e repõem alterações por guardar; não se conseguem corrigir as calorias do relógio de um treino guardado.
- **T18** — dados recolhidos e nunca mostrados: a nota que a IA tira do «Dizer», `laps`, `anaerobic_te`, `np_w`, `max_w`, `max_cadence`. Mostrar a nota; deixar de pedir o resto à IA.
- **T20** — o aviso «A ler o print…» no Treino não se atualiza depois de fechar a folha.
- **T21** — uma «Bicicleta habitual» junta ao relógio aparece no histórico como «print» (`Treino.tsx:25`).
- **T23** — no `TemplateSheet` séries e repetições não se conseguem limpar (8 → apagar dá 1 → escrever 6 dá 16); no Ginásio as repetições só mudam com −/+ (60 s são 12 toques); −/+ das séries a 40 px e chips a 36 px.
- **T24** — `saveWorkout` gera um `client_id` novo em cada chamada (a proteção contra repetições não funciona neste caminho); o Anular do «Qual foi?» falha em silêncio.

## 5. Servidor e robustez

**S1 · média-alta · confirmado por leitura** — `api/cron/daily.ts:68-127`.
`closed.push(await closeDay(...))` não tem `try/catch` por pessoa nem por dia. Um erro num dia de uma pessoa dá 500 à cron inteira: ficam por fazer as pessoas seguintes, todos os resumos semanais e a limpeza de domingo. O Vercel não repete crons. A ordem das pessoas roda de noite para noite, o que atenua mas não resolve.
*Correção:* `try/catch` por pessoa e por dia (marcando o dia como sujo), com os erros no JSON de resposta.

**S2 · média · confirmado por leitura** — `api/_lib/close-day.ts:229-265, 290-291, 311-318`.
Das 7 leituras em paralelo do fecho do dia só se verifica o erro de duas (refeições e treinos). Se a leitura da linha do dia falhar, o upsert regrava as marcas sem `dia_fechado`/`faltou_algo` (perde-se a resposta «Foi tudo?») e regrava o plano base com o de hoje, o que a migração `dias_certos` quis impedir. Se a contagem de fotos por analisar falhar, o dia fecha como completo. O mesmo padrão (`const { data } = await …` sem ver `error`) existe em `review.ts:24-72` (resumo bom reescrito com «0 dias») e `evolution.ts:77-112` (análise paga feita com dados vazios e guardada como a do dia).
*Correção:* lançar em qualquer erro das 7 leituras; no resumo e na evolução, abortar em vez de chamar a IA.

**S3 · média · confirmado por execução (da função)** — `api/_lib/meal-analysis.ts:119-127`, `src/screens/Avancado.tsx:61`.
O teto mensal de custo lê todas as linhas do mês e soma em JavaScript. A API do Supabase devolve no máximo 1 000 linhas por pedido (valor por omissão; não há configuração no repo que o mude): acima disso a soma fica truncada e o teto não dispara; se a query falhar, a soma é 0 e não há limite. Só interessa com o Claude; com o Gemini o custo é 0.
*Correção:* somar na base de dados e tratar o erro como «limite atingido».

**S4 · baixa-média** — `api/cron/daily.ts:72-80, 131-141`, `api/cron/lembretes.ts:28, 75-85`.
A sincronização do relógio (até 8 s) corre em série por pessoa: com 4 pessoas são até 32 s dos 45 s úteis; em paralelo seriam 8 s. O aviso «Resumo da semana pronto» só é verificado à segunda: se o resumo sair na terça (por falta de tempo ou falha da IA), nunca há aviso.

**S5 · baixa** — corrida no fecho: `close-day.ts:357` grava `dirty: false` e as marcas lidas no início; uma escrita do telemóvel entre a leitura e o upsert é apagada. Acontece sobretudo com o recálculo que o telemóvel pede logo a seguir a cada edição; a cron corrige os últimos 3 dias, os mais antigos ficam errados até à edição seguinte.

**S6 · baixa-média** — limites da IA: `evolution` e `training_week` usam o modelo das fotos mas não contam para o limite diário de fotos; «Analisar outra vez» não tem limite por dia; o áudio do «Dizer» conta como foto mas nunca é travado (`rules/custos.ts:12-20`, `said.ts:62`). Com o Gemini a quota do modelo das fotos é uma só para a casa.

**S7 · baixa** — margem do horário: no plano Hobby a cron corre num minuto qualquer das 04:00–04:59 UTC, que no inverno é 04:00–04:59 em Lisboa, margem zero face ao corte das 4h. Passar a `30 5 * * *`.

**S8 · baixa** — o estado do deploy (`api/_day/health.ts:79-91`) verifica o prompt do narrador antigo, que nenhuma chamada usa, e não verifica três prompts vivos (evolução, treino dito, menu). `scripts/smoke.mjs` ainda sonda `/api/meal/parse-text`, que já não existe, e dá «✓» porque só falha com 500.

**S9 · baixa** — retenção: `api_calls` e `off_searches` nunca são limpas; os prints antigos só saem se tiverem miniatura; se a cron de domingo passar dos 45 s, a limpeza salta uma semana.

## 6. Hoje, registo de comida e casca da app

### Erros

**H1 · média-alta · confirmado por execução e leitura** — `src/lib/capture-queue.ts:186-207`, `api/_lib/rules/falhas.ts:26`.
Qualquer erro ≥ 500 é tratado como passageiro: a captura fica «pendente» e o ciclo sai com `return`. Como a lista vai da mais antiga para a mais recente, as fotos seguintes nunca são tentadas. Simulei 50 falhas seguidas: continua «pendente», nova tentativa a cada 5 min, nunca passa a «erro»; cada tentativa volta a comprimir e reenviar as fotos.
*Correção:* depois de N falhas 5xx com rede, passar a «erro» e continuar para a seguinte; só parar o ciclo sem rede.

**H2 · média · confirmado por leitura** — `src/screens/Hoje.tsx:154-268`.
O Hoje só olha para o erro de 1 das ~24 respostas. Se falhar só o pedido dos treinos, o plano fica igual à base e o cartão diz «Passaste o plano» sem aviso. Se a app voltar ao primeiro plano sem rede, o dia bom é trocado por um vazio com «—». Um erro não passageiro nas refeições mostra «O teu dia começa aqui» com zeros.
*Correção:* se um pedido essencial falhar, manter os dados anteriores e mostrar «não consegui atualizar · Tentar».

**H3 · média · suspeita forte** — `src/screens/Definicoes.tsx:193-200`, `src/components/Sequencia.tsx:15-18`.
Exportar CSV pede `.limit(20_000)`, mas o teto de 1 000 linhas da API ganha, e sem `order` as 1 000 são arbitrárias; o ficheiro parece completo. «N dias seguidos» lê 120 dias de refeições sem ordem nem limite: acima de 1 000 linhas a sequência cai para 0. Falta confirmar o «Max rows» no painel (Settings › API); hoje há 473 refeições, por isso ainda não se vê.
*Correção:* paginar com `.range()`; a sequência ler `days` em vez de refeições.

**H4 · média-baixa · confirmado por leitura** — `src/components/BarcodeScanner.tsx:45-84`.
O efeito depende de uma função criada a cada render da folha: a câmara reinicia e a imagem pisca. No caminho do iPhone (ZXing) não há verificação de «parado» depois dos `await`: fechar antes de a câmara arrancar pode deixá-la ligada. Falta reproduzir num iPhone.

**H5 · baixa** — a folha da refeição recarrega de 3 em 3 s enquanto uma partilha está por aplicar (até 5 min se falhar) e repõe o que se está a editar: gramas alteradas ou o nome da favorita a meio (`MealSheet.tsx:86-120, 157-164`).

**H6 · baixa · suspeita** — `log-favorite` e `repeat` não levam chave de idempotência: resposta perdida em rede fraca, segundo toque, duas refeições (`src/lib/meal-actions.ts:42, 97`).

**H7 · baixa** — versões novas só chegam num arranque a frio: não há `registration.update()` ao voltar ao primeiro plano, e uma PWA que fica dias em memória não verifica (`src/main.tsx:17`).

**H8 · baixa · suspeita** — ao trocar de pessoa há uma janela de milissegundos em que um texto da fila pode sair com a sessão da outra (`accounts.ts:91-105`, `api.ts:17-19`); enviar com o token do início do ciclo.

### Fluxos de UX

**H9 · média** — o Hoje tem 14 blocos possíveis e a lista do dia fica abaixo de até 6 cartões de ação.
Por ordem: faixa da semana, aviso sem rede, cartão do plano, «Foi tudo a…?», «Marcado como faltou algo», «O teu mês está pronto», «Qual foi?» (até 3 cartões), cartões de pessoa nova, próximo passo (1 de 9), linhas do relógio, o dia, dieta de hoje, lacuna «Ainda sem almoço», apagados.
No primeiro dia de uma pessoa nova, pesar é pedido 3 vezes e fotografar 3 vezes (cartão «Pesa-te», cartão «Fotografa», próximo passo «Pesa-te?», cartão vazio com os dois).
*Correção:* cartão do plano, no máximo um cartão de ação (uma fila de prioridade única) e logo a lista do dia.

**H10 · média** — há 10 maneiras de registar comida no ＋ e mais 5 fora dele; a dieta aparece em 3 sítios e as favoritas em 4. O caso mais comum (foto) são 3 toques na app e 2 na câmara, o que está bem; o problema é o resto competir pelo mesmo ecrã.
Uso real desde 28 de setembro: 238 refeições por foto, 80 por favorita, 78 por «Repetir», 70 por texto, **7 por código de barras**, 6 usos do «Escolher pelo menu», 5 «Sobrou comida?», **0 dietas criadas**.
*Correção:* em cima texto, Fotografar e Galeria; por baixo um «Repetir» único com favoritas e histórico; código de barras e menu numa linha de ícones.

**H11 · média** — `MealSheet.tsx:454-480, 720-737, 783-816`.
«Corrigir por texto», «Mudar dia ou refeição», «☆ Favorita» e «Escrever o que era» não têm «Cancelar»: é preciso fechar a folha e reabrir. «★ Favorita» numa refeição que já é favorita é um botão que não faz nada. O rodapé tem três botões iguais, «Favorita · Repetir hoje · Apagar»: um toque ao lado apaga ou duplica. Há 5 maneiras de mexer na quantidade (porção, gramas, corrigir por texto, sobras, divisão ao partilhar).

**H12 · média-baixa** — voltar tem três comportamentos: «‹ Voltar» empilha em vez de recuar (depois de Definições › Avançado › Voltar › Voltar, o gesto do iPhone reentra em Avançado); Favoritas volta sempre ao Hoje, mesmo vindo das Definições; três folhas locais («O plano de hoje», editar favorita, alimento) não fecham com o gesto, sai-se do ecrã.

**H13 · baixa-média** — mensagens de programador para quem só usa a app: «verifica as VITE_SUPABASE_* no Vercel», «No Supabase: Authentication → Users…», «abre o SQL Editor e corre…» (`Login.tsx:36-43`, `App.tsx:298-327`).

**H14 · baixa-média** — Definições mistura dois modelos de gravação na mesma secção (interruptores gravam ao toque; altura, plano base e proteína só com «Guardar») sem avisar de alterações por guardar. «Terminar sessão» não tem confirmação. A secção Bicicleta e o Atalho aparecem a toda a gente.

**H15 · média · confirmado por cálculo** — contraste no tema claro: o laranja (`--color-eat: #d9480f`) como texto dá 3,4–4,3:1 (o mínimo é 4,5) em todas as ligações de 13–15 px («Anular», «Tentar», «Todas ›»…); «Apagar» sobre a superfície dá 3,6; o verde 3,5. No escuro passa tudo. Escurecer para ~`#b93a0a`.

**H16 · baixa** — alvos de toque abaixo de 44 px: chips (36), × − + dos alimentos (40, com o × vermelho colado ao −), «Tirar a foto» (32), setas da semana (28 de largura), várias ligações de 13 px sem altura mínima. As folhas não gerem o foco; todo o texto está em px fixos (o tamanho de letra do sistema não se aplica).

**H17 · baixa** — incoerências no registo: «Escolher pelo menu» ignora o «Quando» escolhido e regista agora; a Galeria corta às 12 fotos sem dizer; no código de barras as gramas só mudam de 10 em 10 e fechar com produtos lidos perde-os; tocar numa favorita no ecrã de gestão regista-a logo; «Arquivar» uma favorita não tem lista de arquivadas.

## 7. Balanço e Corpo

Certo e verificado: o dia de hoje nunca conta como cumprido nem falhado; dias sem registo nunca contam como 0 kcal; o veredicto de cada dia é o mesmo no gráfico da semana, no calendário e em «O teu mês»; o cartão do Hoje segue a regra do Balanço (decisão 309); os eixos das barras partem do zero e os das linhas têm amplitude mínima; a pesagem apanha erros de dedo (824, 8,24 → «Queres dizer 82,4?»).

### O que o ecrã diz contra o que os números são

**B1 · alta · confirmado por execução** — `src/components/corpo/PesoChart.tsx:85-88`.
A decisão 300 («o começo de sempre é um número só») só foi aplicada ao período «Tudo». Em 1M e 3M, numa conta mais nova do que o período, o gráfico parte da primeira pesagem em vez da média da primeira semana. O 3M é o período por omissão, por isso apanha toda a gente nos primeiros 3 meses. Exemplo com 5 semanas de conta: o gráfico diz «−5,0 kg em 5 semanas» com o marco «96,4 · início», e o resumo logo acima diz «Desde o início: −3,7 kg» (início 95,1). Dois inícios e duas descidas no mesmo ecrã.
*Correção:* usar o começo de sempre sempre que o período começa na primeira pesagem.

**B2 · média · confirmado por execução** — `src/components/corpo/Resumo.tsx:27, 116-127`, `rules/evolucao.ts:150`.
A decisão 232 (não mostrar um ritmo de há semanas como o de agora) só foi aplicada ao Balanço. O Resumo do Corpo usa o ritmo ancorado na última pesagem: três semanas depois de a pessoa deixar de se pesar, o Corpo continua a dizer «a descer 1,1 kg por semana» com o aviso «Estás a perder depressa. Come um pouco mais». A análise da IA recebe o mesmo ritmo velho.
*Correção:* `weeklyRateAsOf(series, hoje)` nos dois sítios.

**B3 · média · confirmado por execução** — `rules/balanco-graficos.ts:443-447`, `Balanco.tsx:398-420`.
«Para esta semana» não sabe dos dias acima do alvo nem do tipo de projeção: sem dia acima do gasto, cai sempre em «Continua assim», mesmo com «0 de 5 dias no alvo · 5 acima do alvo» no gráfico por cima, ou quando a própria frase diz «a este ritmo não chega».

**B4 · média · confirmado por execução** — `rules/balanco-graficos.ts:305-324`, `BalancoMes.tsx:108-115, 175`.
A semana em curso entra nas frases com o peso de uma semana inteira: 11 semanas com défice de 500 e uma semana em curso com 3 dias maus dão «défice médio de 410 e −2,6 kg» em vez de 500 e −4,0. No Mês, um dia vale uma semana à terça, e a barra em curso não está marcada como incompleta.
*Correção:* tirar a semana em curso das frases e marcar a barra.

**B5 · média · confirmado por execução** — eixos que esmagam os dados.
- Peso (`PesoChart.tsx:130-131`): com projeção, o eixo estica sempre até à meta, mesmo quando a linha tracejada acaba muito antes. Peso médio 96 → 91 com meta 78: eixo de 70 a 100 e os dados em 17 % da altura. A Cintura e a %G já resolvem isto com «alvo 87 ↓».
- Recuperação (`Recuperacao.tsx:233-315`): em «Tudo» os pontos passam a médias semanais mas o eixo continua a vir dos extremos diários. HRV em 20 % da altura; passos com eixo até 30 000 para barras de 11 000.

**B6 · média · confirmado por execução (regras) e leitura (fluxo)** — `MedidasSheet.tsx:151, 190-194, 400, 432`.
Os avisos de limites dizem «Confirma.» mas não há confirmação: «Guardar» grava logo. Cintura 8,7 em vez de 87 fica gravada e o gráfico passa a «−85,3 cm · a mais baixa de sempre». Pescoço e cintura trocados gravam. Sem pesagem nos 7 dias, o «Peso de hoje» aceita 824 e grava-o também nas pesagens, sem o detetor de erro de dedo. Se já mediu hoje, a folha abre vazia e «Substituir» apaga as zonas opcionais da primeira medição. Nos dados reais não há nenhuma medida suspeita.
*Correção:* fora dos limites, com cintura ≤ pescoço ou %G fora de 5–45, pedir um toque de confirmação, como a pesagem.

**B7 · média · confirmado por leitura** — `WeighSheet.tsx:35-40, 49, 88-99, 284-298`.
A folha da pesagem só lê 60 dias. Aberta pelo Hoje de um dia mais antigo, não vê a pesagem que lá está: guardar substitui-a e **«Anular» apaga-a** em vez de a repor. «Anular» também não pede o recálculo dos dias seguintes. E aberta para um dia com 3+ dias, a folha não diz que dia é.

**B8 · média · confirmado por leitura** — `Balanco.tsx:122-186, 465-473`, `ContaGordura.tsx:32-37`.
O Balanço nunca olha para o erro dos pedidos. Sem rede ou com a sessão expirada, mostra «Regista alguns dias e aqui aparece a tua semana» a quem tem meses de dados. O Corpo trata o erro; o Balanço não.

**Menores (baixa):**
- **B9** — a cron só refaz o resumo da semana imediatamente anterior; responder a um «dia de fora» de há 3 semanas muda a frase do topo e o resumo da IA por baixo fica com os números antigos para sempre.
- **B10** — plurais e frases: «Faltam 1 dias completos», «1 dias mais cedo», «Em 1 semanas», «1 dias no alvo», «A este ritmo: 80 kg: a este ritmo não chega», «Esta semana comeste…» numa semana de há um mês.
- **B11** — números incoerentes: %G com 1 casa no gráfico e arredondada no cartão ao lado; «peso médio» com dois valores no mesmo dia (média de 7 dias no gráfico, fim da reta de regressão na Projeção, com um degrau à vista onde a tracejada começa); duas «médias» diferentes no cartão da Semana; milhares com espaço normal em algumas frases (pode partir «1 020 kcal» a meio); números sem unidade nos detalhes.
- **B12** — «O teu mês»: «Partilhar» no aviso do Hoje chama a partilha depois de 5 pedidos, e no iOS pode falhar por já não haver gesto recente, com a mensagem errada (suspeita, falta testar com rede lenta); ‹ recua sem limite para meses vazios; a projeção de um mês antigo mostra uma data já passada.
- **B13** — buracos: os gráficos de sono, FC e HRV ligam com uma reta os dias sem relógio; duas semanas sem dados parecem uma descida contínua.
- **B14** — o `ChartCard` põe os botões dos dias e do calendário dentro de um `role="img"`, o que os pode esconder do VoiceOver (falta confirmar no iPhone).
- **B15** — contraste no tema claro: os números a verde do «Desde o início» têm 2,7:1 sobre a superfície; alvos de toque de 40 px no calendário e várias ligações sem altura mínima. No claro, «gasto» e «bicicleta» são o mesmo azul, «peso» e «ginásio» o mesmo magenta.

### Fluxos e organização

**B16 · média** — à segunda de manhã, antes do pequeno-almoço, o Balanço › Semana fica reduzido a uma caixa: escondem-se «Semana a semana», «Para esta semana» e a proteína, que não dependem das refeições desta semana (`Balanco.tsx:465-484`).

**B17 · baixa** — secções repetidas ou fora do sítio:
- «Semana a semana» (12 semanas, no separador Semana) e «Por semana» (5 semanas, no separador Mês) são a mesma conta desenhada de duas maneiras, com a visão longa no separador curto.
- Passos e sono aparecem em 3 sítios; a projeção em 4.
- A sugestão do plano base com «Aplicar», a única ação do Balanço que muda o plano, está dentro de «Ver detalhes».
- No Corpo das mulheres, o cartão do Ciclo (~330 px, com as opções da pílula sempre abertas) fica entre o Peso e as Medidas.
- O Corpo tem 6–7 ecrãs de altura com tudo ativo; a barra de secções funciona, mas falta-lhe um botão para a Evolução.

**B18 · baixa** — carregamento: cada ‹ › no Balanço troca tudo por «A carregar…» (a página encolhe e volta a crescer); a Conta da gordura aparece depois e empurra o calendário ~220 px; a análise da Evolução pode demorar mais de um minuto e o único sinal é o texto do botão.

## 8. Segurança

**G1 · média (alta se o registo estiver aberto) · confirmar no painel** — `api/_lib/supabase.ts:43-53`, `api/_day/people.ts:118-128`.
«A casa» não existe no código: é qualquer conta do Supabase Auth do projeto. Se «Allow new users to sign up» estiver ligado (vem ligado por omissão e o README não manda desligar), alguém com a chave pública do bundle cria uma conta e pode ver os nomes de todos, pôr refeições «por rever» em qualquer dia de qualquer pessoa, ler os alimentos por código de barras e gastar a quota da IA. Hoje só existem as 2 contas esperadas (a última criada a 4 de outubro), por isso não há sinal de abuso.
*A fazer já:* confirmar em Authentication › Sign In / Providers que o registo está desligado e pôr o passo no README. Em profundidade: `requireUser` exigir perfil e uma lista de emails da casa numa variável de ambiente.

**G2 · baixa-média** — os caminhos das fotos só são validados quando chegam pelo corpo do pedido, mas `meals.photo_paths` é uma coluna que o cliente escreve pela RLS e que o servidor lê com a chave de serviço. Exige adivinhar um UUID da outra pessoa; não encontrei sítio que o exponha. Exigir o prefixo `<user_id>/` em `photoContent` e `copyMealTo`.

**G3 · baixa** — `push_subscriptions` deixa o cliente inserir um endpoint qualquer, saltando a lista de servidores permitidos; o servidor faz depois um POST cego a esse endereço. Política só de leitura e apagar.

**G4 · baixa** — o `CRON_SECRET` vai em `?token=` para ver o estado do deploy (fica no histórico e nos registos) e é o mesmo que autoriza as crons; `api/health/daily.ts:46` compara o segredo sem tempo constante; o token pessoal do Atalho não expira nem se revoga por pessoa.

**G5 · baixa** — os buckets não têm limite de tamanho nem de tipo de ficheiro; `vercel.json` não define cabeçalhos de segurança (CSP), e os refresh tokens de todas as pessoas estão no `localStorage`; vários handlers devolvem a mensagem crua do Postgres.

**G6 · baixa** — avisos do próprio Supabase: a proteção contra palavras-passe expostas está desligada (um clique em Authentication › Policies); 20 políticas RLS usam `auth.uid()` em vez de `(select auth.uid())` (irrelevante com este volume).

**Verificado e certo:** todos os handlers validam o JWT; updates e deletes por id passam pela RLS; a partilha exige destino com perfil e só anula cópias recentes; as ações da «Pergunta à app» são validadas contra uma lista fechada (de 9 propostas maliciosas, 8 caíram) e o servidor nunca as executa; a proteção contra SSRF nas receitas recusou todos os endereços privados testados; as crons estão fechadas sem `CRON_SECRET`.

## 9. Partes antigas que deixaram de ser usadas

Estimativa do que pode sair: **~5 400 linhas** (~2 700 de código, testes e prompts; ~2 700 de documentação e SQL histórico), mais 5 tabelas, ~20 colunas e 1 bucket.

### Ainda visível ao utilizador

- **L2 · média** — Definições › **Arquivo** (capítulos, patronos, linha do tempo, «resumos antigos do narrador») aparece a toda a gente. Os capítulos só existem para a primeira conta: a segunda pessoa lê «Capítulo não encontrado — corre os seeds no Supabase». A lista «Resumos antigos do narrador» mostra na verdade os resumos novos do Balanço (`.neq('kind','evolucao')` traz os `neutro`; `Arquivo.tsx:12-17`). São ~600 linhas, 3 tabelas e 1 bucket público vazio. *Decisão do dono:* apagar (guardando o texto dos capítulos num ficheiro) ou manter corrigido e só para quem tem capítulos.
- **L3 · média** — duas definições sem efeito: «Cadência mínima» e «A consola da bicicleta mostra os watts» gravam no perfil e nenhuma regra as lê (`Definicoes.tsx:63, 286-291`).
- **L4 · baixa** — Avançado ainda fala do calendário .ics e tem rótulos de tipos de chamada que já não existem.

### Ligado mas sem interface

- **L5 · média** — o **plano semanal com IA** «desligado» (decisão 162) continua publicado em `POST /api/workout/plan-week`: sem ecrã, mas qualquer sessão com a preferência antiga ligada faz uma chamada ao modelo das fotos e escreve em `plan_blocks`. São ~835 linhas (`api/_workout/plan.ts`, `WeekPlanCard.tsx`, metade de `rules/plano.ts`, prompt, testes). *Proposta:* mover para `archive/plano-semanal/` e tirar a rota.
- **L6 · baixa** — 3 das 54 ações da API não têm chamador: `meal/quick`, `workout/checkin`, `workout/plan-week`. O `checkin` grava kcal sem a regra atual.
- **L7 · baixa** — a dor no joelho: os esquemas aceitam `pain_during`/`pain_next_day`, nenhum ecrã os envia desde a decisão 143 e não há um único treino com esses campos preenchidos.
- **L8 · baixa** — a fila offline antiga (`src/lib/queue.ts`): ninguém a enche, mas é aberta em cada arranque e cada regresso ao primeiro plano.
- **L9 · baixa** — a folha `escrever` e o modo `?refeicao=` do código de barras não têm nenhum caminho que os abra; o Ginásio livre (sem treino guardado) também não.

### Testes a manter vivo código que a app não chama

- **L10 · média** — ~35 dos 877 testes cobrem regras sem chamador. Os casos que importam são aqueles em que **a regra testada não é a que corre**: `pickWatts` (a cadeia real está escrita à mão em `actions.ts:296-306`, sem teste, e é onde está o T2), `proteinMealOk` (a conta está em linha no `MealSheet`), `lisbonDay` (a app usa outras duas funções, sem teste), `projectWeight`/`goalDate` (a projeção real vive em `rules/projecao.ts`). Os restantes (`readyForIncrease`, `canProgress`, `shouldAdjustBase`, `estimatePct`…) são regras antigas: apagar com os testes.

### Base de dados

- **L11** — tabelas órfãs: `strava_tokens` (vazia) e 4 cópias de segurança de setembro (`days_bak_20260928`, `days_bak_20260929`, `meals_bak_20260929`, `workouts_bak_20260930`), que são cópias inteiras de refeições e dias.
- **L12** — colunas sem nenhuma leitura: no perfil `equipment`, `constraints`, `strava_athlete_id`, `carbs_ref_g`, `fat_ref_g`, `body_comp_source`, `trend_method_since`, `bike_min_cadence`, `console_shows_watts`; `days.water_ml` (4 dias com valor); `workouts.planned_session_id` e `strava_id`; `body_measurements.fasted`; `foods.aliases`; `integrations.settings`; `plan_blocks.review`.
- **L13 · armadilha** — `src/lib/profile.tsx:99, 103` decide que faltam migrações pela existência das colunas `pin_mode` e `trend_method`, que são as duas colunas mortas mais óbvias. Quem as apagar deixa a app presa em «Falta um passo no Supabase». Trocar os marcadores **antes** de qualquer limpeza.
- **L14 · latente, confirmado em produção** — a vista `meals_counted` foi criada com `select *` e ficou com as colunas desse dia: não tem `leftover_kcal`, `share_with`, `share_split`, `order_people` nem `model_reserve`. Hoje nada parte, mas qualquer código novo que leia uma destas colunas pela vista recebe `undefined`. A fase 3 já recriou a outra vista pelo mesmo motivo.
- **L15** — há 273 linhas em `days` anteriores ao primeiro registo de comida, criadas pelo gatilho ao importar o histórico do relógio. Inofensivas, mas entram em qualquer leitura sem filtro de datas.

### Prompts, dependências, documentação

- **L16** — 17 dos 30 prompts não são carregados por nenhuma chamada (versões antigas e funcionalidades arquivadas), e o `vercel.json` inclui `prompts/**` nas 6 funções. Mover para `archive/prompts/`.
- **L17** — `playwright-core` não é importado em lado nenhum (14 MB); `ICS_TOKEN` continua no `.env.example` e no estado do deploy; há 13 comentários `eslint-disable` sem ESLint instalado; `api/_lib/strava.ts` só é importado por um teste; ~215 linhas de exports sem uso (`ui/Bar.tsx`, os esquemas do plano de 4 semanas em `schemas.ts:100-181`, `toJpeg`, `monthLong`…).
- **L1 · média** — README: o passo 2b não lista `20261018130000_alimentos_marca.sql` nem `20261018140000_dias_certos.sql`, e a app não deteta a falta delas (reinstalar fica sem `days.base_kcal` e sem os campos de marca, sem aviso). O primeiro parágrafo tem 969 palavras e contradiz-se («ficam 5 funções» / «6 funções»; «12 regras» quando são 57 ficheiros). A secção «Marcos» descreve PIN, Baggio, Strava e narrador. A estrutura de pastas refere `/src/types` e o ecrã Registar, que não existem. `tests/README.md` aponta para dois ficheiros de teste que não existem.
- **L18** — `docs/redesenho-2026-09.json` (2 494 linhas, 331 KB) não é referenciado por nada; `supabase/oneoff/20261019_ginasio_kcal_relogio.sql` já correu. Atenção: `supabase/oneoff/20261101_plano_treino_joao.sql` é lido por um teste, não apagar.
- **L19** — nomes antigos: `"name": "epoca-do-regresso"` no `package.json`, `EpocaDoRegresso/0.2` no User-Agent enviado ao Open Food Facts. As chaves `regresso.*` do armazenamento local **não devem mudar**: trocar o prefixo desliga sessões, rascunhos e a fila.

### Duplicação com risco de divergir

- **L20** — os últimos watts confirmados: o servidor limita aos 30 dias antes do treino, o cliente faz a mesma consulta sem janela (`actions.ts:190-203` contra `ConfirmWorkoutSheet.tsx:229-238`). `src/lib/kcal-context.ts` e `api/_lib/kcal-context.ts` são a mesma consulta escrita duas vezes. `KCAL_PER_KG = 7700` em 3 ficheiros; `MAX_ITEM_GRAMS` com três valores diferentes e o mesmo nome; «dia em Lisboa» em 3 funções; `fold`, `round1` e `mean` copiados em 6–8 ficheiros.

### Ordem segura de remoção

1. **Já, sem risco** (~300 linhas): exports e ficheiros sem uso, fila antiga, folha `escrever`, `playwright-core`, `ICS_TOKEN`, sonda do smoke.
2. **Já, com testes** (~370): ligar a app a `pickWatts`, `proteinMealOk` e a um só «dia em Lisboa»; apagar as outras regras só de testes.
3. **Ações sem cliente** (~150): `quick`, `checkin`, a dor nos esquemas.
4. **Decisão do dono** (~1 930): plano semanal, Strava e prompts antigos para `archive/`; Arquivo e capítulos.
5. **Documentação** (~2 700): README curto com a lista de migrações gerada por `ls`, diário para `docs/historia.md`, JSON do redesenho.
6. **Base de dados, por último:** primeiro o L13 publicado; depois uma migração única com os `drop`. Só depois de o código que lê as colunas ter saído, porque o telemóvel guarda o perfil em cache.

## 10. Performance (o que o utilizador não vê, mas sente)

A base de dados não é o gargalo: são 2 contas, ~470 refeições, 381 dias. O que pesa é o número de pedidos por ecrã, o tamanho do que se descarrega e o arranque das funções.

**P1 · média** — cada refresh do Hoje são ~24 pedidos (17 queries, 5 do gasto, dieta, URLs assinados), sem cache, repetidos a cada regresso ao primeiro plano e a cada evento de dados, sem debounce: 3 fotos da fila a sair são 3 recargas completas. Um dos pedidos (`workouts_active.*` de ontem, com o JSON em bruto) nunca é lido. `weights` é pedida 4 vezes e `days` 6. (`Hoje.tsx:174-231`)
*Proposta:* cache por (pessoa, data) com «mostra o que tens e atualiza por trás», um pedido único para o dia, debounce de ~300 ms, e não recarregar se o último carregamento tem menos de ~30 s.

**P1b · média** — o Balanço é igual: abrir a Semana são 20 pedidos (a tabela `days` é pedida 9 vezes), cada toque em ‹ › refaz 17, e na vista Mês correm 17 cujo resultado não é usado, 24–25 no total. As 16 semanas de `days` que o ecrã já lê cobrem quase tudo o que a semana pede. O Corpo está bem (6 pedidos, e 1S/1M/3M filtram em memória), mas «Tudo» relê tudo de raiz e os 9 gráficos montam de uma vez, cada um com o seu observador de tema. (`Balanco.tsx:120-185`, `src/lib/corpo.ts:53-74`)
*Proposta:* um só carregamento das 16 semanas com todas as colunas e a semana vista derivada em memória: de 20 para ~6 pedidos, e ‹ › instantâneo.

**P2 · média · medido no build** — o service worker instala 2,4 MB a toda a gente, dos quais cerca de metade só serve com rede: o leitor de códigos ZXing (466 KiB, só usado sem `BarcodeDetector`), o Recharts (346), o Zod da «Pergunta à app» (90) e ~270 KiB de ícones listados duas vezes. O chunk principal tem 602 kB (177 kB comprimido) porque o `App.tsx` importa estaticamente 20 folhas; o cliente do Supabase traz ~155 kB de código de tempo real que a app não usa.
*Proposta:* excluir esses chunks do precache (cache em tempo de execução) e `lazy()` nas folhas raras. A instalação desce para ~1,2 MB e o chunk principal perde 150–200 kB.

**P3 · baixa-média** — o fecho de cada dia faz ~17 queries em 5 idas em série; um recálculo de 30 dias são ~500 queries; a cron fecha até 24 dias por pessoa dentro de 45 s. Uma das leituras calcula uma marca (`chao`) que nenhum ecrã lê. (`close-day.ts`)
*Proposta:* fundir as leituras (5 idas → 3) e, a prazo, fechar o dia numa função SQL: resolve de caminho o S2 e o S5.

**P4 · baixa-média · medido** — `trend7` é O(n²) com `Date.parse` dentro do filtro: 365 pesagens → 40 ms, 1 000 → 200 ms, 3 000 → 1,7 s num servidor (3–5× mais num telemóvel), e o Resumo do Corpo chama-o duas vezes por render sem `useMemo`. Com o período «Tudo» e o histórico importado, nota-se. (`rules/weight.ts:26-37`, `corpo/Resumo.tsx:26-27`)

**P5 · média-baixa** — o separador Treino faz `select('*')` de 12 semanas de treinos, com os JSON em bruto, para usar ~15 colunas, e recarrega as 5 consultas a cada mudança; «Ver mais antigos» traz até 500 linhas completas de uma vez e acima disso não há mais páginas; `QualFoi` repete a consulta que o Treino acabou de fazer; a folha de confirmar faz um `select('*')` a cada tecla na duração.

**P6 · média** — fotos: o rascunho do ＋ regrava no IndexedDB todos os originais (até 4 × 3–8 MB) a cada pausa de 400 ms a escrever a nota; a fila descodifica o original de 12 MP para uma miniatura de 48 px a cada evento, sem libertar o URL; as favoritas só têm a foto de 1 024 px (~150 kB cada, em cada abertura do ＋, para miniaturas de 42 px); nenhuma imagem tem `loading="lazy"`; os URLs assinados mudam a cada arranque e anulam a cache do browser.

**P7 · baixa** — arranque a frio das funções: cada router importa todos os handlers e com eles o SDK da Anthropic (54 ms, nunca usado com o Gemini), o `web-push` (29 ms) e o `@garmin/fitsdk` (29 ms). Cada pedido faz uma ida ao Supabase Auth para validar o token, e o nome de cada pessoa é pedido à API de Auth em cada partilha e cada pergunta.
*Proposta:* `import()` dinâmico, validar o JWT localmente e guardar o nome em `profile`: ~100–250 ms a menos por pedido.

**P8 · baixa** — o Atalho do iPhone grava até 31 pesagens uma a uma (62 idas à base de dados por noite quando manda o mês todo); a função que procura fotos órfãs compara cada objeto com todas as refeições sem índice.

## 11. Dados reais: o que a produção mostra

- **Uso das funcionalidades** (desde 28 de setembro, chamadas à IA e registos): fotos de refeições 261, correções por texto 95, texto 80, resumo semanal 16, prints de treino 15, evolução 8, «Pergunta à app» 7, menu 6, sobras 5, treino dito por áudio 1, plano semanal 1. Porção diferente de 1 em 22 refeições. **Dietas: nunca foi criada nenhuma.** Água: 4 dias. Dor/joelho: nenhum treino. Vale a pena usar isto para decidir o que simplificar no ＋ e no Hoje.
- **Migrações:** o histórico de migrações do Supabase só regista 12; as restantes foram aplicadas pelo SQL Editor. Conferi que os objetos de todas as migrações do repo existem em produção.
- **Custos:** todas as chamadas estão a 0 USD (Gemini gratuito); o teto mensal em euros não tem efeito prático hoje.
- **Storage:** 63 MB em fotos de refeições (522 ficheiros, média 123 kB) e 14 MB em prints de treino; sem órfãos.
- **Escritas repetidas:** a linha de `integrations` foi atualizada 533 vezes e a de `push_subscriptions` 422 (uma por abertura da app); `days` teve 4 107 atualizações para 381 linhas. Sem impacto com este volume, mas confirma o padrão de recargas do P1.

## 12. Ideias de alteração

### Com impacto na utilização

1. **Dizer a verdade sobre o gasto.** Um só estado, igual no Hoje, no Balanço e na projeção: «fórmula», «a aprender (faltam N pesagens)», «medido». Resolve o K1 à vista e incentiva a pesar. Complemento: usar os passos do relógio para escolher o fator da fórmula (1,2 a 1,5) em vez de 1,2 fixo, para quem anda muito deixar de bater no teto de +400.
2. **«Juntar estes dois»** no aviso de possível duplicado e na folha do treino, e propor por omissão pôr as séries dentro da sessão do relógio. Resolve T1, T3 e T4 sem perder séries nem dados do relógio.
3. **Hoje com hierarquia fixa:** cartão do plano, um cartão de ação (o mais importante de uma fila única) e a lista do dia. Hoje a lista pode ficar abaixo de 6 cartões.
4. **＋ em duas camadas,** guiado pelo uso real: foto, texto e galeria em cima; um «Repetir» único (favoritas + histórico, com pesquisa); código de barras e menu como ícones. Decidir se a Dieta, que nunca foi usada, fica.
5. **«Registar treino» no próprio separador Treino:** Print · Dizer · À mão, com os teus treinos por baixo. Bicicleta habitual em 2 toques e um caminho sem IA.
6. **Ginásio que funciona sem rede:** treinos do plano e últimas séries guardados no telemóvel, fila para «Terminar», rascunho que não expira com séries feitas. É onde a app mais se usa com pior rede.
7. **A app de cada pessoa:** esconder o que é de uma pessoa só (bicicleta, joelho, Connect IQ, Atalho, Arquivo) a quem não o usa, e contar caminhadas e aulas nos minutos de treino.
8. **Folha da refeição arrumada:** «Cancelar» em cada modo, «Apagar» fora do rodapé, ★ que abre a favorita.
9. **Nível da bicicleta guardado,** com frases como «voltas a 160 W depois da sessão leve».
10. **Fila que se explica:** «1 foto falhou e está a segurar outras 3 · Ver».
11. **Conta da gordura justa:** «previsto para os N dias contados» e «se os dias de fora fossem iguais», lado a lado.
12. **Dia sempre à vista** quando não é hoje, ontem ou anteontem (treino dito, print, pesagem de um dia antigo).
13. **A IA a saber o que já foi aplicado:** etiquetas, nota, porção e sobras em cada chamada, e um «Reler as porções» a sério com antes → depois. Acaba com os cortes a dobrar (M1, M4, M5) e dá uso ao aviso da reserva (M2).
14. **Balanço que decide:** «Para esta semana» logo a seguir à frase do topo e com uma ação quando os dias estão acima do alvo; a sugestão do plano base fora de «Ver detalhes»; «Semana a semana» e «Por semana» num só gráfico, com a semana em curso marcada e fora das frases.
15. **Pesagem em 1 toque quando o peso não mudou** (tocar em «ontem 82,4» preenche o campo) e medidas com Hoje/Ontem, como a pesagem.
16. **Um só «início» e um só «peso médio»** em todos os períodos e folhas do Corpo (B1, B11).

### Que o utilizador não vê

1. **Cache do dia e pedido único** (P1, P1b): mudar de dia, de semana e voltar à app ficam instantâneos; de ~24 pedidos para 1–2 no Hoje e de 20 para ~6 no Balanço.
1b. **Itens guardados na base 1,** com porção × divisão × sobras aplicados só na leitura dos totais. Acaba de uma vez com M7, M9, M12 e o erro de arredondamento acumulado; os Anular passam a ser trocar um número, e a folha pode mostrar «prato 815 kcal · a tua parte 60 % · sobraram 25 %». É a alteração estrutural mais valiosa na comida.
1c. **Recalcular o dia passado no servidor** em cada escrita (M8), em vez de depender de cada ecrã se lembrar.
2. **Instalação e arranque mais leves** (P2): de 2,4 MB para ~1,2 MB.
3. **Fecho do dia atómico** numa função SQL (P3, S2, S5), com um registo de cada execução das crons (`cron_runs`) e um aviso em Avançado quando a última noite falhou. Hoje uma cron que falha só se vê nos registos do Vercel.
4. **Teste de simulação do fecho, dia a dia,** para 4–5 perfis (pesagens diárias, semanais, uma só, nenhuma, treino que pára). O fecho do dia e o gasto no cliente não têm nenhum teste, e é lá que estão K1, K3 e K5.
5. **Guardas contra legado novo:** `noUnusedLocals` no `tsconfig`, knip no `npm test`, e em `tests/guardas.test.ts` «cada ação da API tem chamador» e «cada prompt tem ficheiro». Hoje as guardas deixaram passar 3 ações mortas e uma sonda para um endpoint que não existe.
6. **Versão do schema explícita** (uma tabela `schema_version`) em vez de «a coluna X existe»: a app avisa de todas as migrações em falta e a limpeza de colunas deixa de poder bloqueá-la.
7. **Validação local do JWT, imports dinâmicos e nome no perfil** (P7).
8. **`trend7` linear e um «modelo do peso» calculado uma vez** por carregamento do Corpo, partilhado por resumo, gráfico e projeção (P4, K6): os três passam a mostrar o mesmo número.
9. **Miniaturas** na fila e nas favoritas e `loading="lazy"` (P6).
10. **Retenção:** limpeza mensal de `api_calls` e `off_searches`, remoção das tabelas `*_bak`, limites de tamanho e tipo nos buckets.
11. **README de um ecrã** com a lista de migrações gerada, e o diário das fases num ficheiro à parte.

## 13. Proposta de ordem de trabalho

- **Onda 1 — números em que se pode confiar** (pequena a média): K1, K2, K7, M1, M5, M6, B1, B2, B4, T2, T9, D1, K16, com o teste de simulação do fecho.
- **Onda 2 — nada falha em silêncio** (pequena): S1, S2, H1, H2, B8, M3, B6, B7, S3/H3, G1 (confirmar o painel), L1.
- **Onda 3 — ginásio e treino no dia a dia** (média): T5, T6, T1 com «Juntar os dois», T3, T4, T7, T10, T12.
- **Onda 4 — limpeza** (média, quase sem risco): passos 1 a 3 e 5 da remoção, L13, L14, guardas novas. Passo 4 depois das tuas decisões; base de dados no fim.
- **Onda 5 — rapidez** (média): P1, P1b, P2, P5, P6.
- **Onda 6 — redesenho leve do Hoje, do ＋ e do Balanço** (maior, precisa de decisões de produto): H9, H10, H11, B3, B16, B17, M2, mais as ideias 1, 4, 7, 13 e 14.
- **Mais tarde, se valer a pena:** itens na base 1 (ideia 1b), que mexe no formato dos dados das refeições.

### Decisões que são tuas

1. O **Arquivo** (capítulos, linha do tempo): apagar ou manter corrigido?
2. O **plano semanal com IA**, o mapeamento do **Strava** e os **prompts antigos**: podem ir para `archive/`?
3. A **Dieta** (nunca usada), o **código de barras** (7 usos) e o **menu** (6 usos): ficam no ＋ com o mesmo destaque?
4. O **teto de ±400 kcal** do gasto medido (decisão 175) e o chip **«+1 treino/semana»** (decisão 288): revêem-se?
5. Os **minutos de treino** contarem caminhadas e aulas (decisão 147)?

## Anexo — cobertura

Lido por inteiro: as 26 regras de corpo e energia e os seus chamadores; as 23 regras e todos os handlers de comida, com os prompts carregados conferidos contra os esquemas Zod; treino de ponta a ponta (regras, servidor, ecrãs e folhas); routers, crons, `_day` e bibliotecas do servidor; todas as migrações; casca da app, Hoje, Favoritas, Definições e as folhas de registo de comida; Balanço, Corpo, gráficos, pesagem e medidas; biblioteca do cliente.

Não coberto ou só em parte: `WeekPlanCard` e `IntervalsSettings` em parte; a maioria dos ficheiros de teste foi lida só pelos nomes; a app não foi corrida num telemóvel real (os achados de interface são por leitura do código e execução das regras, exceto T5, reproduzido no Chrome), por isso VoiceOver, a partilha no iOS e a câmara do leitor de códigos ficam por confirmar no iPhone; não tive acesso aos painéis do Supabase e do Vercel (falta confirmar o registo de contas e o «Max rows»); o `archive/` ficou de fora por desenho.

Os achados M4, M5, T19, H3, H6, H8 e B12 estão marcados como suspeita: o caminho no código está confirmado, o efeito depende da resposta real da IA, de um ficheiro FIT real, de uma opção do painel ou de um teste em dispositivo.
