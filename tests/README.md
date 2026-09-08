# /tests — regras de negócio (secção 5 da spec)

Cada regra tem testes; as implementações vivem em `/api/_lib/rules` como funções puras. Mapa previsto:

| Regra | Ficheiro |
| --- | --- |
| 1. Dia nutricional 04:00–04:00 (Europe/Lisbon) | `dia-nutricional.test.ts` |
| 2. `kcal_target` e `kcal_exercise` (bike = W×min×0,06; força = 150; outros = Strava×0,7) | `kcal-exercicio.test.ts` |
| 3. Tendência de peso (média 7d) + projeção linear (21d) | `peso-tendencia.test.ts` |
| 4. Gasto adaptativo (14 dias completos, EMA α 0,3, ≥ 10 dias) | `adaptativo.test.ts` |
| 5. Dia completo (≥ 2 refeições ou "dia fechado"; < 800 kcal sem marca = incompleto) | `dia-completo.test.ts` |
| 6. Chão semanal (média 7 dias completos < `kcal_floor_week`) | `chao.test.ts` |
| 7. Semana de manutenção a cada 6 semanas | `manutencao.test.ts` |
| 8. Proteína por dia e por refeição principal | `proteina.test.ts` |
| 9. Semáforo de dor (verde ≤ 2, amarelo 3–5, vermelho ≥ 6; progressão só com 2 verdes) | `semaforo.test.ts` |
| 10. Progressão de bike (tempo, cadência, caps de FC, validação de 30 min) | `progressao-bike.test.ts` |
| 11. Dupla progressão de força (+2 kg; deload -40% na semana 4) | `progressao-forca.test.ts` |
| 12. Estimativas (`is_estimate` em foto e "jantar fora"; % na semana) | `estimativas.test.ts` |
