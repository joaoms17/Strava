-- =====================================================================
-- Foto do antes e do depois («Sobrou comida?»): depois de comer, a pessoa
-- fotografa o que sobrou e a IA desconta-o dos itens da refeição. A foto do
-- depois fica na refeição, à parte das fotos do prato (photo_paths), para
-- nunca ir para a análise nem para o «Juntar foto»; leftover_kcal guarda as
-- kcal que ficaram no prato (0 quando comeu tudo). A limpeza de domingo
-- passa a contar também estas fotos (senão apagava-as aos 7 dias).
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro
-- inteiro → Run. Pode correr-se mais do que uma vez. No fim aparece uma
-- tabela: tem de vir VAZIA. Sem ela tudo funciona, só não aparece o
-- «Sobrou comida?».
-- =====================================================================

alter table public.meals
  add column if not exists leftover_photo_path text,
  add column if not exists leftover_thumb_path text,
  add column if not exists leftover_kcal numeric(6,1);

-- ---------------------------------------------------------------------
-- Ficheiros sem dono: agora também as fotos do que sobrou.
-- ---------------------------------------------------------------------
create or replace function public.storage_orphan_candidates(
  p_bucket text, p_min_age interval, p_limit integer)
returns table (name text)
language sql
security definer
set search_path = public, storage
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = p_bucket
    and o.created_at < now() - p_min_age
    and not exists (
      select 1 from public.meals m
      where m.photo_path = o.name or o.name = any (m.photo_paths) or o.name = any (m.thumb_paths)
         or m.leftover_photo_path = o.name or m.leftover_thumb_path = o.name)
    and not exists (select 1 from public.favorites f where f.photo_path = o.name)
    and not exists (
      select 1 from public.workout_imports i
      where o.name = any (i.source_paths) or o.name = any (i.thumb_paths))
    and not exists (select 1 from public.workouts w where o.name = any (w.source_paths))
  order by o.created_at
  limit p_limit
$$;

revoke all on function public.storage_orphan_candidates(text, interval, integer) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.storage_orphan_candidates(text, interval, integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.storage_orphan_candidates(text, interval, integer) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.storage_orphan_candidates(text, interval, integer) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Verificação: tem de vir vazia (todas as tabelas públicas com RLS).
-- ---------------------------------------------------------------------
select tablename as "tabela sem RLS (tem de vir vazio)"
from pg_tables
where schemaname = 'public' and not rowsecurity;
