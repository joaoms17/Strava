-- =====================================================================
-- Dividir ao partilhar: o João e a Joana pedem um prato para os dois. No
-- «Também para …» do ＋ escolhe-se como comeram: «A meias», outra divisão
-- («João 60 · Joana 40») ou cada um a refeição toda. Como a análise corre em
-- segundo plano, a parte de quem regista fica na refeição até a análise
-- acabar bem; aí a refeição fica com essa parte e a cópia com o resto, e a
-- divisão fica vazia (divide-se uma vez só).
--
-- share_split: a parte de quem regista (0,5 a meias; 0,6 = 60 %). Vazia:
-- cada um comeu isto tudo (como antes).
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro
-- inteiro → Run. Pode correr-se mais do que uma vez. No fim aparece uma
-- tabela: tem de vir VAZIA. Sem ela tudo funciona, só o «Também para …» do ＋
-- partilha a refeição toda (a divisão faz-se depois, na folha da refeição).
-- =====================================================================

alter table public.meals add column if not exists share_split numeric(3,2);

alter table public.meals drop constraint if exists meals_share_split_check;
alter table public.meals
  add constraint meals_share_split_check check (share_split is null or (share_split >= 0.1 and share_split <= 0.9));

-- ---------------------------------------------------------------------
-- Verificação: tem de vir vazia (todas as tabelas públicas com RLS).
-- ---------------------------------------------------------------------
select tablename as "tabela sem RLS (tem de vir vazio)"
from pg_tables
where schemaname = 'public' and not rowsecurity;
