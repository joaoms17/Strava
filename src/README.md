# /src — app React (PWA)

Como está organizada (o plano do redesenho de que saiu está em docs/redesenho-2026-09.md):

```
/screens
  Hoje.tsx            quanto ainda podes comer, proteína, dieta, próximo passo, linha do dia, faixa da semana
  Balanco.tsx         a semana numa frase com o selo, o gráfico dia a dia (tocar num dia), «Para esta semana», Semana a semana; Mês com o calendário dos dias no alvo
  Treino.tsx          registar treino, sugestão seguinte, plano de treino, histórico, progressão
  Ginasio.tsx         sessão de ginásio: séries com as cargas da última vez
  PlanoTreino.tsx     o plano de treino da pessoa, dia a dia
  Corpo.tsx           resumo (desde o início, projeção), peso, medidas, evolução, treino, recuperação; um período 1M · 3M · Tudo e a barra das secções
  Favoritos.tsx       refeições favoritas (1 toque) e biblioteca de alimentos
  Definicoes.tsx      pessoas, perfil, bicicleta, ligações, notificações, balança, aparência, exportar
  Avancado.tsx        uso e custos da IA, verificações do deploy
  Arquivo.tsx         capítulos, linha do tempo e resumos antigos (só leitura)
/components
  sheets/             folhas por URL (`?folha=`, src/lib/sheet.ts): (+), Peso, Medidas, Refeição, Galeria, Nota, Código de barras, Menu, Rever, treino, …
  charts/             o kit dos gráficos: cartão com a frase-título, eixos, dica, legenda, marcos sem sobreposição
  corpo/, balanco/    os gráficos e cartões do Corpo e do Balanço
  ui/                 folha inferior, Quando (dia e refeição), barras, faixa da semana, botão de foto
/lib                  supabase, perfil, dados do Corpo e do Balanço lidos uma vez (corpo.ts, balanco.ts), tema, avisos com Anular, espera com bloqueio (busy), folhas, fila de capturas e rascunho do Registar (IndexedDB), EXIF, fotos, formatação PT-PT
```

As regras de negócio vivem em `/api/_lib/rules` (funções puras testadas) e o cliente importa-as de lá. Sem segredos no cliente. Interface em PT-PT, tema Sistema/Escuro/Claro, uso a uma mão.
