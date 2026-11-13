-- =====================================================================
-- A vista meals_counted com as colunas de hoje (L14).
--
-- A vista foi criada com `select *` na fase 2, e o Postgres fixa as colunas
-- de um `select *` no dia em que a vista é criada: as colunas que entraram
-- depois em meals (model_reserve, share_with, share_split, leftover_photo_path,
-- leftover_thumb_path, leftover_kcal, order_people, analysis_tags, …) não
-- aparecem nela, e quem as lesse pela vista recebia `undefined`.
--
-- Recria-se igual à da fase 2 (20260929000000): as refeições não apagadas e
-- analisadas (ok e por_rever), com security_invoker (o RLS de meals aplica-se
-- a quem lê) e leitura para authenticated. Nenhuma outra vista depende dela.
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro
-- inteiro → Run, DEPOIS de todas as migrações que juntam colunas a meals
-- (incluindo a 20261113000020). Pode correr-se mais do que uma vez (e deve
-- correr-se outra vez sempre que meals ganhar uma coluna). No fim aparece uma
-- tabela: tem de vir VAZIA (colunas de meals que faltam na vista).
-- =====================================================================

drop view if exists public.meals_counted;
create view public.meals_counted with (security_invoker = true) as
  select * from public.meals
  where deleted_at is null and status in ('ok', 'por_rever');
grant select on public.meals_counted to authenticated;

-- ---------------------------------------------------------------------
-- Verificação: tem de vir vazia (colunas de meals que faltam na vista).
-- ---------------------------------------------------------------------
select c.column_name as "coluna de meals em falta na vista (tem de vir vazio)"
from information_schema.columns c
where c.table_schema = 'public' and c.table_name = 'meals'
  and not exists (
    select 1 from information_schema.columns v
    where v.table_schema = 'public' and v.table_name = 'meals_counted' and v.column_name = c.column_name
  );
