-- =====================================================================
-- «Também para …» ao registar: o João e a Joana comem muitas vezes o
-- mesmo. No ＋ escolhe-se logo com quem a refeição fica partilhada; como a
-- análise corre em segundo plano, a escolha fica na refeição até a análise
-- acabar bem (captura, juntar foto, «Tentar outra vez» ou «Analisar mesmo
-- assim»). Aí a refeição segue para essas pessoas, por rever, e a lista
-- fica vazia (partilha-se uma vez só).
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro
-- inteiro → Run. Pode correr-se mais do que uma vez. No fim aparece uma
-- tabela: tem de vir VAZIA. Sem ela tudo funciona, só não partilha ao
-- registar (continua o «Partilhar com …» da folha da refeição).
-- =====================================================================

alter table public.meals add column if not exists share_with uuid[] not null default '{}';

-- ---------------------------------------------------------------------
-- Verificação: tem de vir vazia (todas as tabelas públicas com RLS).
-- ---------------------------------------------------------------------
select tablename as "tabela sem RLS (tem de vir vazio)"
from pg_tables
where schemaname = 'public' and not rowsecurity;
