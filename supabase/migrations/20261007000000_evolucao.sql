-- =====================================================================
-- Migração 11 — análise da evolução pela IA (Corpo › Evolução): guarda-se
-- em weekly_reviews com kind 'evolucao' (uma por dia, week_start = o dia).
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro
-- inteiro → Run. Pode correr-se mais do que uma vez. No fim aparece uma
-- tabela: tem de vir VAZIA. Sem ela a análise aparece na mesma, só não
-- fica guardada para a próxima vez.
-- =====================================================================

alter table public.weekly_reviews drop constraint if exists weekly_reviews_kind_check;
alter table public.weekly_reviews
  add constraint weekly_reviews_kind_check check (kind in ('narrador', 'neutro', 'evolucao'));

-- ---------------------------------------------------------------------
-- Verificação: tem de vir vazia (todas as tabelas públicas com RLS).
-- ---------------------------------------------------------------------
select tablename as "tabela sem RLS (tem de vir vazio)"
from pg_tables
where schemaname = 'public' and not rowsecurity;
