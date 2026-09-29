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
