-- =====================================================================
-- Migração 4 (Fase 3 do redesenho) — treino: Bicicleta habitual, «Já fiz»
-- e o print do relógio (Garmin, Strava ou a consola da bicicleta).
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro
-- inteiro → Run. Precisa das migrações 1, 2 e 3. Pode correr-se mais do
-- que uma vez. No fim aparece uma tabela: tem de vir VAZIA (todas as
-- tabelas com RLS).
-- =====================================================================

-- Cópia de segurança dos treinos antes de mexer (sem acesso do cliente).
create table if not exists public.workouts_bak_20260930 as table public.workouts;
alter table public.workouts_bak_20260930 enable row level security;

-- ---------------------------------------------------------------------
-- workouts — o que vem do print, a origem dos watts e das kcal
-- ---------------------------------------------------------------------
alter table public.workouts
  add column if not exists client_id uuid unique,
  add column if not exists external_id text,
  add column if not exists started_at timestamptz,
  add column if not exists sport text,               -- valor em bruto (walk, elliptical…)
  add column if not exists name text,
  add column if not exists moving_s integer,
  add column if not exists elapsed_s integer,
  add column if not exists distance_km numeric(7,2),
  add column if not exists np_w integer,
  add column if not exists max_w integer,
  add column if not exists max_cadence integer,
  add column if not exists kcal_device integer,      -- mostra-se; nunca conta na bicicleta
  add column if not exists kcal_rule text,
  add column if not exists kcal_estimated boolean not null default false,
  add column if not exists watts_source text,
  add column if not exists training_load numeric(7,1),
  add column if not exists aerobic_te numeric(3,1),
  add column if not exists anaerobic_te numeric(3,1),
  add column if not exists rpe integer,
  add column if not exists hr_zones jsonb,
  add column if not exists laps jsonb,
  add column if not exists source_paths text[] not null default '{}',
  add column if not exists image_hashes text[] not null default '{}',
  add column if not exists merged_from jsonb,
  add column if not exists note text,
  add column if not exists favorite_id uuid references public.favorites (id) on delete set null;

alter table public.workouts drop constraint if exists workouts_source_check;
alter table public.workouts add constraint workouts_source_check
  check (source in ('strava', 'manual', 'screenshot', 'intervals', 'health', 'fit'));
alter table public.workouts drop constraint if exists workouts_watts_source_check;
alter table public.workouts add constraint workouts_watts_source_check
  check (watts_source is null
    or watts_source in ('device', 'console', 'manual', 'favorite', 'prefill'));

create unique index if not exists workouts_external_idx
  on public.workouts (user_id, source, external_id) where external_id is not null;

-- Os treinos antigos com watts dizem de onde vieram.
update public.workouts
set watts_source = case when source = 'strava' then 'device' else 'manual' end,
    kcal_rule = coalesce(kcal_rule, case type
      when 'bike' then 'watts'
      when 'strength' then 'strength_flat'
      else 'legacy' end)
where watts is not null and watts_source is null;

-- A vista tem de ver as colunas novas.
drop view if exists public.workouts_active;
create view public.workouts_active with (security_invoker = true) as
  select * from public.workouts where deleted_at is null;
grant select on public.workouts_active to authenticated;

-- ---------------------------------------------------------------------
-- workout_imports — rascunhos dos prints até serem guardados. Nunca contam.
-- ---------------------------------------------------------------------
create table if not exists public.workout_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid not null unique,
  status text not null default 'a_ler',
  source_paths text[] not null default '{}',
  thumb_paths text[] not null default '{}',
  image_hashes text[] not null default '{}',
  parsed jsonb,
  edited_fields text[] not null default '{}',
  analysis_started_at timestamptz,
  analysis_attempts integer not null default 0,
  analysis_error text,
  workout_id uuid references public.workouts (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.workout_imports drop constraint if exists workout_imports_status_check;
alter table public.workout_imports add constraint workout_imports_status_check
  check (status in ('a_ler', 'por_confirmar', 'guardado', 'descartado', 'erro'));

create index if not exists workout_imports_user_status_idx
  on public.workout_imports (user_id, status);

alter table public.workout_imports enable row level security;
drop policy if exists owner_all on public.workout_imports;
create policy owner_all on public.workout_imports for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Bucket privado dos prints, cada um na pasta do dono.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('workout-shots', 'workout-shots', false)
on conflict (id) do nothing;

drop policy if exists "workout_shots_owner_all" on storage.objects;
create policy "workout_shots_owner_all"
on storage.objects for all to authenticated
using (
  bucket_id = 'workout-shots'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'workout-shots'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- ---------------------------------------------------------------------
-- Reivindicação atómica da leitura de um print (igual à das refeições):
-- só avança em 'a_ler', com o prazo anterior (90 s) expirado e menos de 3
-- tentativas; com 3 gastas e o prazo expirado, passa a 'erro'.
-- ---------------------------------------------------------------------
create or replace function public.claim_workout_parse(p_import_id uuid, p_reset boolean default false)
returns setof public.workout_imports
language plpgsql
set search_path = public
as $$
begin
  if p_reset then
    update public.workout_imports
    set status = 'a_ler', analysis_attempts = 0, analysis_started_at = null, analysis_error = null
    where id = p_import_id and status in ('a_ler', 'erro');
  end if;

  return query
    update public.workout_imports
    set analysis_started_at = now(), analysis_attempts = analysis_attempts + 1
    where id = p_import_id
      and status = 'a_ler'
      and analysis_attempts < 3
      and (analysis_started_at is null or analysis_started_at < now() - interval '90 seconds')
    returning *;

  if not found then
    update public.workout_imports
    set status = 'erro',
        analysis_error = coalesce(analysis_error, 'Não consegui ler este print.')
    where id = p_import_id
      and status = 'a_ler'
      and analysis_attempts >= 3
      and (analysis_started_at is null or analysis_started_at < now() - interval '90 seconds');
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Ficheiros sem dono: agora também os prints (rascunhos e treinos).
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
      where m.photo_path = o.name or o.name = any (m.photo_paths) or o.name = any (m.thumb_paths))
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
-- profile — relógio Garmin e consola com watts (respostas do João: grava
-- tudo no Garmin e a consola mostra os watts). Editáveis nas Definições.
-- ---------------------------------------------------------------------
alter table public.profile
  add column if not exists has_garmin_watch boolean,
  add column if not exists console_shows_watts boolean;
update public.profile set has_garmin_watch = true where has_garmin_watch is null;
update public.profile set console_shows_watts = true where console_shows_watts is null;

-- ---------------------------------------------------------------------
-- Favorito «Bicicleta habitual»: a combinação mais frequente das últimas 5
-- sessões de bicicleta com watts (ou 30 min a 130 W, se ainda não houver).
-- ---------------------------------------------------------------------
insert into public.favorites (user_id, kind, name, workout, kcal)
select p.user_id, 'workout', 'Bicicleta habitual',
  jsonb_build_object(
    'type', 'bike',
    'minutes', coalesce(usual.minutes, 30),
    'watts', coalesce(usual.watts, 130)),
  round(coalesce(usual.watts, 130) * coalesce(usual.minutes, 30) * 0.06)::integer
from public.profile p
left join lateral (
  select recent.minutes, recent.watts
  from (
    select w.minutes, w.watts, w.date
    from public.workouts w
    where w.user_id = p.user_id and w.type = 'bike' and w.deleted_at is null
      and w.minutes is not null and w.watts is not null
    order by w.date desc, w.created_at desc
    limit 5
  ) recent
  group by recent.minutes, recent.watts
  order by count(*) desc, max(recent.date) desc
  limit 1
) usual on true
where not exists (
  select 1 from public.favorites f
  where f.user_id = p.user_id and f.kind = 'workout' and f.name = 'Bicicleta habitual'
);

-- ---------------------------------------------------------------------
-- Verificação: tem de vir vazia (todas as tabelas públicas com RLS).
-- ---------------------------------------------------------------------
select tablename as "tabela sem RLS (tem de vir vazio)"
from pg_tables
where schemaname = 'public' and not rowsecurity;
