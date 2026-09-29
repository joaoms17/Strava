-- =====================================================================
-- Migração 9 — o sono do relógio (Garmin → intervals.icu): pontuação do
-- sono (0–100), qualidade (1 ótima … 4 fraca), HRV da noite e FC média
-- durante o sono, ao lado das horas dormidas que já existiam.
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro
-- inteiro → Run. Precisa das migrações 1 a 8. Pode correr-se mais do que
-- uma vez. No fim aparece uma tabela: tem de vir VAZIA.
-- =====================================================================

alter table public.health_daily
  add column if not exists sleep_score smallint,
  add column if not exists sleep_quality smallint,
  add column if not exists hrv numeric(5,1),
  add column if not exists avg_sleep_hr smallint;

alter table public.health_daily drop constraint if exists health_daily_sleep_score_check;
alter table public.health_daily add constraint health_daily_sleep_score_check
  check (sleep_score is null or sleep_score between 0 and 100);
alter table public.health_daily drop constraint if exists health_daily_sleep_quality_check;
alter table public.health_daily add constraint health_daily_sleep_quality_check
  check (sleep_quality is null or sleep_quality between 1 and 4);

-- ---------------------------------------------------------------------
-- Verificação: tem de vir vazia (todas as tabelas públicas com RLS).
-- ---------------------------------------------------------------------
select tablename as "tabela sem RLS (tem de vir vazio)"
from pg_tables
where schemaname = 'public' and not rowsecurity;
