# /prompts — prompts versionados

Um ficheiro por função, com a versão no nome: `<funcao>.v<N>.md`. A versão usada fica registada em `prompt_version` nas linhas criadas (refeições, resumos, análises).

Uma alteração ao prompt é sempre um ficheiro novo (`v2`, `v3`, …), nunca uma edição do antigo. Quando uma versão deixa de ser carregada, o ficheiro vai para `archive/prompts/` (o `vercel.json` inclui esta pasta inteira nas funções que chamam a IA — `api/meal.ts`, `api/workout.ts`, `api/day.ts` e a cron diária —, por isso aqui só ficam as versões em uso).

As versões em uso são as constantes de `api/_lib/prompts.ts`; o estado do deploy (`/api/day/health`) confirma que os ficheiros delas foram incluídos.
