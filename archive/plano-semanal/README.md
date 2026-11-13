# Plano semanal com IA (arquivado na auditoria de novembro de 2026, L5)

Desligado na app desde a decisão 162, mas ainda publicado em
`POST /api/workout/plan-week`. Saiu do servidor: a rota, `api/_workout/plan.ts`,
o cartão `WeekPlanCard.tsx` (sem uso), a parte de `rules/plano.ts` que só o
servia (número da semana, descarga, tendência do bem-estar, limpeza e
progresso do plano: `plano-semana.ts`), o prompt `training-week.v1.md` e os
testes só dele. Ficam aqui para consulta: estão fora de `api/`, do `tsconfig`
e do vitest, por isso não fazem deploy nem typecheck (os imports podem estar
desatualizados).

As preferências em `profile.goals.plano` e as semanas em `plan_blocks`
(`weeks` = 1) ficam na base de dados; `cleanPrefs` continua em
`rules/plano.ts` porque as notificações a usam.
