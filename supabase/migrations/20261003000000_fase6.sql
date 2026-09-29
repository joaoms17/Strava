-- =====================================================================
-- Migração 7 (Fase 6 do redesenho) — Balanço completo: o gasto de cada
-- dia (só para mostrar), o resumo semanal neutro e o método do peso médio.
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro
-- inteiro → Run. Precisa das migrações 1 a 6. Pode correr-se mais do que
-- uma vez. No fim aparece uma tabela: tem de vir VAZIA.
-- =====================================================================

-- ---------------------------------------------------------------------
-- days — gasto de hoje = base sem treino + treino (nunca entra no plano)
-- ---------------------------------------------------------------------
alter table public.days
  add column if not exists kcal_out_est integer,
  add column if not exists daily_base_est integer,
  add column if not exists formula_base integer;

-- ---------------------------------------------------------------------
-- weekly_reviews — o resumo neutro (Haiku) vive ao lado do antigo, do
-- narrador: uma linha por semana e por tipo.
-- ---------------------------------------------------------------------
alter table public.weekly_reviews
  add column if not exists kind text not null default 'narrador';
alter table public.weekly_reviews drop constraint if exists weekly_reviews_kind_check;
alter table public.weekly_reviews add constraint weekly_reviews_kind_check
  check (kind in ('narrador', 'neutro'));
alter table public.weekly_reviews drop constraint if exists weekly_reviews_user_id_week_start_key;
create unique index if not exists weekly_reviews_user_week_kind_idx
  on public.weekly_reviews (user_id, week_start, kind);

-- ---------------------------------------------------------------------
-- profile — método do peso médio (média de 7 dias; Holt só se ganhar o
-- teste com os pesos reais)
-- ---------------------------------------------------------------------
alter table public.profile
  add column if not exists trend_method text not null default 'sma7',
  add column if not exists trend_method_since date;
alter table public.profile drop constraint if exists profile_trend_method_check;
alter table public.profile add constraint profile_trend_method_check
  check (trend_method in ('sma7', 'holt'));

-- ---------------------------------------------------------------------
-- Verificação: tem de vir vazia (todas as tabelas públicas com RLS).
-- ---------------------------------------------------------------------
select tablename as "tabela sem RLS (tem de vir vazio)"
from pg_tables
where schemaname = 'public' and not rowsecurity;
