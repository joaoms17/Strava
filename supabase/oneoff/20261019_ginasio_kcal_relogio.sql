-- =====================================================================
-- UMA VEZ SÓ (não é uma migração): as kcal dos ginásios de UMA pessoa pela
-- regra nova (decisão 277).
--
-- Até aqui o ginásio valia 150 kcal fixas com 30 min ou mais (0 abaixo) e as
-- calorias do relógio nunca contavam. Agora contam por inteiro, para quem as
-- traz (print, relógio pelo intervals.icu, «Dizer ou escrever»); sem elas,
-- estima-se pelos minutos ao ritmo da própria pessoa (kcal por minuto dos
-- seus ginásios dos últimos 120 dias com calorias do relógio, pelo menos 2,
-- cada um com 10 a 240 min e 1,5 a 15 kcal/min), senão pelo peso perto desse
-- dia (4 METs líquidos × kg × horas), senão a 4 kcal por minuto. É a mesma
-- conta de `api/_lib/rules/kcal-ginasio.ts` (o «hoje» do ritmo é o dia
-- nutricional de agora em Lisboa, como no servidor).
--
-- A app nunca reescreve treinos antigos (decisão 64). Isto corrige só os da
-- pessoa indicada (a Joana); os ginásios antigos do João ficam como estão.
-- Só mexe nos ginásios dela não apagados que ainda têm a regra antiga
-- (`strength_flat`, ou sem regra): correr outra vez não muda nada.
--
-- Os dias recalculam-se como depois de editar um treino na app: o trigger
-- `workouts_dirty_upd` (mark_day_dirty) marca `days.dirty` em cada dia cujas
-- kcal mudaram. O Hoje e o plano do Balanço somam logo as kcal guardadas nos
-- treinos (`kcal_est`); o fecho do dia (kcal_exercise, meta, gasto medido do
-- Balanço e o resumo da semana) refaz-se na cron das 04:30 UTC, a partir do
-- dia marcado mais antigo até ontem (no máximo 21 dias por noite; a noite
-- seguinte continua).
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro →
-- substituir as 3 ocorrências de :user_id pelo id da Joana entre plicas (ex.:
-- '1b2c…'; está em Authentication → Users, ou `select id, email from
-- auth.users;`) → Run. No psql: psql "$DATABASE_URL" -v user_id="'<id>'" -f
-- supabase/oneoff/20261019_ginasio_kcal_relogio.sql
-- O resultado no fim mostra os ginásios dela com as kcal novas e se o dia
-- ficou marcado para recalcular.
-- =====================================================================

-- 1. Ver antes (só lê): cada ginásio com a regra antiga, o que tinha e o que
--    passa a ter.
with pessoa as (
  select p.user_id,
         ((now() at time zone 'Europe/Lisbon') - make_interval(hours => p.nutrition_day_cutoff_hour))::date as hoje
  from public.profile p
  where p.user_id = :user_id::uuid
),
ritmo as (
  select count(*) as sessoes, sum(w.kcal_device)::numeric / nullif(sum(w.minutes), 0) as kcal_min
  from public.workouts w
  join pessoa p on p.user_id = w.user_id
  where w.type = 'strength'
    and w.deleted_at is null
    and w.kcal_device > 0
    and w.date between p.hoje - 120 and p.hoje
    and w.minutes between 10 and 240
    and w.kcal_device::numeric / w.minutes between 1.5 and 15
),
alvo as (
  select w.id, w.user_id, w.date, w.kcal_est, w.kcal_rule,
         greatest(coalesce(w.minutes, 0), 0) as minutos,
         coalesce(w.kcal_device::numeric,
                  case when jsonb_typeof(w.raw -> 'calories') = 'number' then (w.raw ->> 'calories')::numeric end) as relogio
  from public.workouts w
  join pessoa p on p.user_id = w.user_id
  where w.type = 'strength'
    and w.deleted_at is null
    and coalesce(w.kcal_rule, 'strength_flat') = 'strength_flat'
),
peso as (
  select a.id,
         coalesce(
           (select avg(x.kg) from public.weights x
             where x.user_id = a.user_id and x.date between a.date - 6 and a.date),
           (select x.kg from public.weights x
             where x.user_id = a.user_id and x.date <= a.date order by x.date desc limit 1)
         ) as kg
  from alvo a
)
select a.date, a.minutos, a.relogio as kcal_relogio, a.kcal_est as kcal_antes, a.kcal_rule as regra_antes,
       case
         when a.relogio > 0 then round(a.relogio)
         when r.sessoes >= 2 then round(r.kcal_min * a.minutos)
         when pe.kg is not null then round(4 * pe.kg * a.minutos / 60.0)
         else round(4 * a.minutos)
       end::integer as kcal_depois,
       case
         when a.relogio > 0 then 'device'
         when r.sessoes >= 2 then 'strength_rate'
         when pe.kg is not null then 'met'
         else 'strength_time'
       end as regra_depois,
       round(r.kcal_min, 2) as ritmo_kcal_min,
       r.sessoes as sessoes_no_ritmo
from alvo a
cross join ritmo r
join peso pe on pe.id = a.id
order by a.date;

-- 2. Aplicar: as kcal novas nos ginásios dela com a regra antiga. Só escreve
--    o que muda; o trigger marca o dia para recalcular quando as kcal mudam.
with pessoa as (
  select p.user_id,
         ((now() at time zone 'Europe/Lisbon') - make_interval(hours => p.nutrition_day_cutoff_hour))::date as hoje
  from public.profile p
  where p.user_id = :user_id::uuid
),
ritmo as (
  select count(*) as sessoes, sum(w.kcal_device)::numeric / nullif(sum(w.minutes), 0) as kcal_min
  from public.workouts w
  join pessoa p on p.user_id = w.user_id
  where w.type = 'strength'
    and w.deleted_at is null
    and w.kcal_device > 0
    and w.date between p.hoje - 120 and p.hoje
    and w.minutes between 10 and 240
    and w.kcal_device::numeric / w.minutes between 1.5 and 15
),
alvo as (
  select w.id, w.user_id, w.date,
         greatest(coalesce(w.minutes, 0), 0) as minutos,
         coalesce(w.kcal_device::numeric,
                  case when jsonb_typeof(w.raw -> 'calories') = 'number' then (w.raw ->> 'calories')::numeric end) as relogio
  from public.workouts w
  join pessoa p on p.user_id = w.user_id
  where w.type = 'strength'
    and w.deleted_at is null
    and coalesce(w.kcal_rule, 'strength_flat') = 'strength_flat'
),
peso as (
  select a.id,
         coalesce(
           (select avg(x.kg) from public.weights x
             where x.user_id = a.user_id and x.date between a.date - 6 and a.date),
           (select x.kg from public.weights x
             where x.user_id = a.user_id and x.date <= a.date order by x.date desc limit 1)
         ) as kg
  from alvo a
),
novo as (
  select a.id, a.user_id,
         case
           when a.relogio > 0 then round(a.relogio)
           when r.sessoes >= 2 then round(r.kcal_min * a.minutos)
           when pe.kg is not null then round(4 * pe.kg * a.minutos / 60.0)
           else round(4 * a.minutos)
         end::integer as kcal_est,
         case
           when a.relogio > 0 then 'device'
           when r.sessoes >= 2 then 'strength_rate'
           when pe.kg is not null then 'met'
           else 'strength_time'
         end as kcal_rule,
         not coalesce(a.relogio > 0, false) as kcal_estimated
  from alvo a
  cross join ritmo r
  join peso pe on pe.id = a.id
)
update public.workouts w
set kcal_est = n.kcal_est,
    kcal_rule = n.kcal_rule,
    kcal_estimated = n.kcal_estimated
from novo n
where w.id = n.id
  and w.user_id = n.user_id
  and w.type = 'strength'
  and w.deleted_at is null
  and (w.kcal_est, w.kcal_rule, w.kcal_estimated) is distinct from (n.kcal_est, n.kcal_rule, n.kcal_estimated);

-- 3. Ver depois: os ginásios dela, as kcal que contam e se o dia ficou
--    marcado para a cron das 04:30 UTC o recalcular (dia_a_recalcular).
select w.date, w.minutes, w.kcal_device as kcal_relogio, w.kcal_est, w.kcal_rule, w.kcal_estimated,
       d.dirty as dia_a_recalcular
from public.workouts w
left join public.days d on d.user_id = w.user_id and d.date = w.date
where w.user_id = :user_id::uuid
  and w.type = 'strength'
  and w.deleted_at is null
order by w.date desc;
