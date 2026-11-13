# Ações da API sem chamador (arquivadas na auditoria de novembro de 2026, L6)

- `meal-quick.ts` — `POST /api/meal/quick` («Só números»), sem entrada na app
  desde a decisão 246.
- `workout-checkin.ts` — `POST /api/workout/checkin` (dados da consola), sem
  chamador; gravava kcal sem a regra atual.

Só para consulta: fora de `api/`, do `tsconfig` e do vitest.
