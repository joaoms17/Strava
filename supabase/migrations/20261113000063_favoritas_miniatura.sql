-- P6 (auditoria 2026-11): miniatura das favoritas. As listas (＋, Repetir,
-- dietas, Favoritas) mostravam a foto de 1 024 px (~150 kB) em quadrados de
-- 26–52 px. A app passa a guardar, ao criar ou mudar a foto de uma favorita,
-- uma miniatura de 256 px ao lado ({uid}/fav/…_t.jpg) e o caminho aqui.
--
-- O código funciona sem esta migração (grava sem a coluna e mostra a foto);
-- com ela, as favoritas novas ou com foto nova ficam com miniatura. As
-- antigas continuam com a foto até se lhes mudar a foto.
--
-- Também: a limpeza dos ficheiros sem dono (cron diária) passa a contar a
-- miniatura da favorita como tendo dono — sem isto, apagava-a.

alter table public.favorites add column if not exists thumb_path text;

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
    and not exists (select 1 from public.favorites f where f.photo_path = o.name or f.thumb_path = o.name)
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

insert into public.schema_version (id, version) values (true, 20261113000063)
on conflict (id) do update
  set version = greatest(public.schema_version.version, excluded.version),
      applied_at = now();
