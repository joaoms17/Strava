# /src — app React (PWA)

Redesenho em curso (docs/redesenho-2026-09.md). Fases 1 e 2:

```
/screens
  Hoje.tsx            quanto ainda podes comer, proteína, joelho, próximo passo, linha do dia, faixa da semana
  Balanco.tsx         a semana numa frase e num gráfico (Comer contra o plano), detalhes recolhidos
  Treino.tsx          «Já fiz», sugestão seguinte, plano de 4 semanas (até à Fase 5), histórico, progressão
  Corpo.tsx           peso médio, ritmo semanal, gráfico 1M · 3M · Tudo
  Favoritos.tsx       refeições favoritas (1 toque) e biblioteca de alimentos
  Definicoes.tsx      perfil, bicicleta, balança, aparência, PIN, exportar
  Avancado.tsx        custos da IA, mínimo semanal, exercícios seguros, calendário
  Arquivo.tsx         capítulos, linha do tempo e resumos antigos (só leitura)
/components
  sheets/             folhas por URL: (+), Peso, Refeição, Galeria, Escrever, Nota, Só números, Código de barras, Rever
  ui/                 folha inferior, joelho em 1 toque, barras, faixa da semana, botão de foto
/lib                  supabase, perfil, tema, avisos com Anular, folhas, fila de capturas (IndexedDB), EXIF, fotos, formatação PT-PT
```

As regras de negócio vivem em `/api/_lib/rules` (funções puras testadas) e o cliente importa-as de lá. Sem segredos no cliente. Interface em PT-PT, tema Sistema/Escuro/Claro, uso a uma mão.
