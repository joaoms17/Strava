-- =====================================================================
-- A forma do intervals.icu (Garmin → intervals.icu): forma (CTL, 42 dias),
-- fadiga (ATL, 7 dias) e a rampa, como o intervals.icu as calcula com o
-- histórico todo, e o VO2máx do relógio. Chegam com o bem-estar de cada dia;
-- se deixarem de vir, a app usa a forma que ela própria calcula.
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro
-- inteiro → Run. Pode correr-se mais do que uma vez. No fim aparece uma
-- tabela: tem de vir VAZIA.
-- =====================================================================

alter table public.health_daily
  add column if not exists ctl numeric(5,1),
  add column if not exists atl numeric(5,1),
  add column if not exists ramp_rate numeric(5,1),
  add column if not exists vo2max numeric(4,1);

-- ---------------------------------------------------------------------
-- Verificação: tem de vir vazia (todas as tabelas públicas com RLS).
-- ---------------------------------------------------------------------
select tablename as "tabela sem RLS (tem de vir vazio)"
from pg_tables
where schemaname = 'public' and not rowsecurity;
