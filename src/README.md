# /src — app React (PWA)

Estrutura (os ecrãs de Treino e Gráficos são placeholders até ao M2/M3):

```
/screens
  Registar.tsx        default: câmara, texto, barcode, toggle "jantar fora"
  Hoje.tsx            faltam X kcal / Y g proteína, refeições, peso, check-in de dor
  Treino.tsx          sessão de hoje, cargas por toques, bike com alvo, sessão manual
  Graficos.tsx        peso + tendência + projeção, FC por W, cargas, kcal/proteína, adaptativo
  Capitulo.tsx        abertura e fecho de capítulo
  Historia.tsx        página do patrono (fotos CC opcionais)
  LinhaDoTempo.tsx    profile.timeline lado a lado com as linhas dos patronos
  Definicoes.tsx      profile, timeline, catálogo, export CSV
/components           Cartaz SVG (sem imagens externas), cartões, gráficos Recharts
/lib                  cliente supabase, fila offline (IndexedDB), formatação PT-PT
/types
```

Sem regras de negócio no cliente e sem segredos no cliente. Interface toda em PT-PT, dark mode, uso a uma mão.
