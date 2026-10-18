-- =====================================================================
-- Hoje e Balanço certos:
-- 1. days.base_kcal — o plano base em vigor em cada dia. O fecho do dia
--    guarda-o na primeira vez e mantém-no ao recalcular: mudar o plano já
--    não reescreve os dias antigos (Hoje, Balanço, resumo da semana). Os
--    dias já fechados ficam com o plano que tinham (meta − treino), fora
--    das semanas de pausa da dieta.
-- 2. days.tdee_raw — o gasto só pelo peso, antes do ajuste lento e do
--    limite de 400 da fórmula, para o Balanço dizer «Pelo peso dava…».
-- 3. profile.maintenance_anchor — quem foi criado depois da migração 1 (a
--    Joana) não tinha âncora da semana de pausa da dieta, e a cron e os
--    ecrãs contavam semanas diferentes. Fica o dia da primeira refeição; os
--    dias desde aí ficam marcados para a cron os recalcular (21 por noite).
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro
-- inteiro → Run. Pode correr-se mais do que uma vez. No fim aparece uma
-- tabela: tem de vir VAZIA. Sem esta migração tudo funciona como antes: os
-- dias antigos usam o plano de hoje e o Balanço não mostra o gasto só pelo
-- peso (a âncora em falta é gravada pela cron na primeira noite).
-- =====================================================================

alter table public.days add column if not exists base_kcal integer;
alter table public.days add column if not exists tdee_raw numeric(6,1);

update public.days
set base_kcal = kcal_target - kcal_exercise
where base_kcal is null
  and kcal_target > 0
  and not (flags ? 'manutencao');

with anchored as (
  update public.profile p
  set maintenance_anchor = coalesce(
    (select min(m.date) from public.meals m where m.user_id = p.user_id and m.deleted_at is null),
    (select min(d.date) from public.days d where d.user_id = p.user_id),
    current_date
  )
  where p.maintenance_anchor is null
  returning p.user_id, p.maintenance_anchor
)
update public.days d
set dirty = true
from anchored a
where d.user_id = a.user_id
  and d.date >= a.maintenance_anchor;

-- ---------------------------------------------------------------------
-- Verificação: tem de vir vazia (todas as tabelas públicas com RLS).
-- ---------------------------------------------------------------------
select tablename as "tabela sem RLS (tem de vir vazio)"
from pg_tables
where schemaname = 'public' and not rowsecurity;
