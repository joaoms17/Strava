-- =====================================================================
-- UMA VEZ SÓ (não é uma migração): as kcal das bicicletas antigas do
-- relógio que ficaram a 0 (auditoria de novembro de 2026, D1).
--
-- Antes da decisão 159 (5 de outubro), uma bicicleta sem watts contava pela
-- potência, mesmo sem potência: 0 kcal. Desde então, sem watts contam as
-- calorias do relógio por inteiro (`kcal_rule` = 'device', como em
-- `api/_lib/rules/treino.ts`, `exerciseKcal`). A sincronização só refaz as
-- contas dentro da janela recente, por isso ficaram 10 bicicletas do
-- intervals.icu (dez. 2025 a fev. 2026) com `kcal_rule` = 'watts', sem watts,
-- `kcal_est` = 0 e 160 a 610 kcal do relógio (~3 850 no total).
--
-- Só mexe em bicicletas não apagadas com `kcal_rule` = 'watts', sem watts,
-- `kcal_est` = 0 e calorias do relógio (`kcal_device`, ou `raw.calories`
-- nas antigas) acima de 0. Correr outra vez não muda nada. Serve para todas
-- as pessoas (é a regra de hoje, não uma escolha de alguém).
--
-- Os dias recalculam-se como depois de editar um treino na app: o trigger
-- `workouts_dirty_upd` (mark_day_dirty) marca `days.dirty` em cada dia cujas
-- kcal mudaram. O Hoje e o plano do Balanço somam logo as kcal guardadas nos
-- treinos (`kcal_est`); o fecho do dia (kcal_exercise, meta, gasto medido do
-- Balanço e o resumo da semana) refaz-se na cron das 04:30 UTC, a partir do
-- dia marcado mais antigo até ontem (no máximo 21 dias por noite; a noite
-- seguinte continua). São dias anteriores aos registos de comida, por isso
-- não mexem no Balanço; mudam os totais de treino.
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro → Run.
-- No psql: psql "$DATABASE_URL" -f supabase/oneoff/20261113_bicicletas_kcal_relogio.sql
-- O resultado no fim mostra as bicicletas com as kcal novas e se o dia ficou
-- marcado para recalcular.
-- =====================================================================

-- 1. Ver antes (só lê): cada bicicleta afetada, o que tinha e o que passa a ter.
with alvo as (
  select w.id, w.user_id, w.date, w.minutes, w.kcal_est, w.kcal_rule,
         coalesce(w.kcal_device::numeric,
                  case when jsonb_typeof(w.raw -> 'calories') = 'number' then (w.raw ->> 'calories')::numeric end) as relogio
  from public.workouts w
  where w.type = 'bike'
    and w.deleted_at is null
    and w.kcal_rule = 'watts'
    and w.watts is null
    and coalesce(w.kcal_est, 0) = 0
)
select a.user_id, a.date, a.minutes, a.relogio as kcal_relogio, a.kcal_est as kcal_antes, a.kcal_rule as regra_antes,
       round(a.relogio)::integer as kcal_depois, 'device' as regra_depois
from alvo a
where a.relogio > 0
order by a.user_id, a.date;

-- 2. Aplicar: as calorias do relógio por inteiro, como a regra de hoje. Só
--    escreve o que muda; o trigger marca o dia para recalcular.
update public.workouts w
set kcal_est = round(coalesce(w.kcal_device::numeric,
                              case when jsonb_typeof(w.raw -> 'calories') = 'number' then (w.raw ->> 'calories')::numeric end))::integer,
    kcal_rule = 'device',
    kcal_estimated = false
where w.type = 'bike'
  and w.deleted_at is null
  and w.kcal_rule = 'watts'
  and w.watts is null
  and coalesce(w.kcal_est, 0) = 0
  and coalesce(w.kcal_device::numeric,
               case when jsonb_typeof(w.raw -> 'calories') = 'number' then (w.raw ->> 'calories')::numeric end) > 0;

-- 3. Ver depois: as bicicletas do relógio sem watts antes da decisão 159, as
--    kcal que contam e se o dia ficou marcado para a cron das 04:30 UTC o
--    recalcular (dia_a_recalcular).
select w.user_id, w.date, w.minutes, w.kcal_device as kcal_relogio, w.kcal_est, w.kcal_rule, w.kcal_estimated,
       d.dirty as dia_a_recalcular
from public.workouts w
left join public.days d on d.user_id = w.user_id and d.date = w.date
where w.type = 'bike'
  and w.deleted_at is null
  and w.watts is null
  and w.date < date '2026-10-05'
order by w.user_id, w.date;
