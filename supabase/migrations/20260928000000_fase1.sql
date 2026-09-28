-- =====================================================================
-- Migração 1 (Fase 1 do redesenho) — favoritos, apagar com Anular,
-- macros no dia e recálculo dos dias alterados.
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro
-- inteiro → Run. Pode correr-se mais do que uma vez (é idempotente).
-- No fim aparece uma tabela: tem de vir VAZIA (todas as tabelas com RLS).
-- =====================================================================

-- Cópia de segurança dos dias antes de mexer (fica sem acesso do cliente).
create table if not exists public.days_bak_20260928 as table public.days;
alter table public.days_bak_20260928 enable row level security;

-- ---------------------------------------------------------------------
-- favorites — refeições (e, mais tarde, treinos) para registar com 1 toque
-- ---------------------------------------------------------------------
create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  name text not null,
  items jsonb not null default '[]'::jsonb, -- mesma forma de meals.items
  workout jsonb,                            -- {type:'bike', minutes, watts} (Fase 3)
  kcal integer not null default 0,          -- cache para a grelha
  protein numeric(5,1) not null default 0,
  carbs numeric(5,1) not null default 0,
  fat numeric(5,1) not null default 0,
  photo_path text,
  default_slot text,
  source_meal_id uuid references public.meals (id) on delete set null,
  use_count integer not null default 0,
  last_used_at timestamptz,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.favorites drop constraint if exists favorites_kind_check;
alter table public.favorites add constraint favorites_kind_check
  check (kind in ('meal', 'workout'));
alter table public.favorites drop constraint if exists favorites_default_slot_check;
alter table public.favorites add constraint favorites_default_slot_check
  check (default_slot is null
    or default_slot in ('pequeno_almoco', 'almoco', 'lanche', 'jantar', 'ceia'));

create index if not exists favorites_user_kind_idx
  on public.favorites (user_id, kind, archived, use_count desc);

alter table public.favorites enable row level security;
drop policy if exists owner_all on public.favorites;
create policy owner_all on public.favorites for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- profile — preferências novas
-- ---------------------------------------------------------------------
alter table public.profile
  add column if not exists sex text not null default 'm',
  add column if not exists birth_year integer,
  add column if not exists theme text not null default 'system',
  add column if not exists calm_mode boolean not null default false,
  add column if not exists pin_mode text not null default '12h',
  add column if not exists maintenance_enabled boolean not null default true,
  add column if not exists maintenance_anchor date,
  add column if not exists dismissed_hints jsonb not null default '[]'::jsonb,
  add column if not exists nudge_state jsonb not null default '{}'::jsonb,
  add column if not exists carbs_ref_g integer,
  add column if not exists fat_ref_g integer,
  add column if not exists scale_has_bodyfat boolean not null default false;

alter table public.profile drop constraint if exists profile_sex_check;
alter table public.profile add constraint profile_sex_check check (sex in ('m', 'f'));
alter table public.profile drop constraint if exists profile_theme_check;
alter table public.profile add constraint profile_theme_check
  check (theme in ('system', 'dark', 'light'));
alter table public.profile drop constraint if exists profile_pin_mode_check;
alter table public.profile add constraint profile_pin_mode_check
  check (pin_mode in ('off', '12h', 'always'));
alter table public.profile drop constraint if exists profile_birth_year_check;
alter table public.profile add constraint profile_birth_year_check
  check (birth_year is null or birth_year between 1900 and 2020);

-- A âncora da semana de pausa da dieta fica fixa: uma pesagem antiga não
-- muda as semanas.
update public.profile p
set maintenance_anchor = (select min(d.date) from public.days d where d.user_id = p.user_id)
where p.maintenance_anchor is null;

-- ---------------------------------------------------------------------
-- days — hidratos, gordura e a marca «precisa de recálculo»
-- ---------------------------------------------------------------------
alter table public.days
  add column if not exists carbs numeric(6,1) not null default 0,
  add column if not exists fat numeric(6,1) not null default 0,
  add column if not exists dirty boolean not null default false;

create index if not exists days_user_dirty_idx on public.days (user_id, date) where dirty;

-- ---------------------------------------------------------------------
-- weights — hora da pesagem e novas origens
-- ---------------------------------------------------------------------
alter table public.weights add column if not exists measured_at timestamptz;
alter table public.weights drop constraint if exists weights_source_check;
alter table public.weights add constraint weights_source_check
  check (source in ('manual', 'withings', 'shortcut', 'intervals'));

-- ---------------------------------------------------------------------
-- meals — apagar reversível, favorito de origem, porção
-- ---------------------------------------------------------------------
alter table public.meals
  add column if not exists deleted_at timestamptz,
  add column if not exists favorite_id uuid references public.favorites (id) on delete set null,
  add column if not exists source_meal_id uuid,
  add column if not exists portion_factor numeric(4,2) not null default 1;

alter table public.meals drop constraint if exists meals_input_type_check;
alter table public.meals add constraint meals_input_type_check
  check (input_type in ('text', 'photo', 'barcode', 'manual', 'favorite', 'repeat'));

-- ---------------------------------------------------------------------
-- workouts — apagar reversível e kcal congeladas
-- ---------------------------------------------------------------------
alter table public.workouts add column if not exists deleted_at timestamptz;

-- As kcal de cada treino ficam guardadas: preenche as que faltam com a regra
-- antiga (bike = W × min × 0,06; força = 150 com 30 min; outro = 70 % do relógio).
update public.workouts
set kcal_est = case
  when type = 'bike' then
    case when watts is not null and minutes is not null then round(watts * minutes * 0.06) else 0 end
  when type = 'strength' then
    case when coalesce(minutes, 0) >= 30 then 150 else 0 end
  else
    case when jsonb_typeof(raw -> 'calories') = 'number'
      then round((raw ->> 'calories')::numeric * 0.7) else 0 end
end
where kcal_est is null;

-- Hidratos e gordura dos dias já fechados.
update public.days d
set carbs = s.carbs, fat = s.fat
from (
  select user_id, date, sum(carbs) as carbs, sum(fat) as fat
  from public.meals
  where deleted_at is null
  group by user_id, date
) s
where d.user_id = s.user_id and d.date = s.date;

-- ---------------------------------------------------------------------
-- Vistas: o que conta para os totais (sem as linhas apagadas)
-- ---------------------------------------------------------------------
create or replace view public.meals_counted with (security_invoker = true) as
  select * from public.meals where deleted_at is null;

create or replace view public.workouts_active with (security_invoker = true) as
  select * from public.workouts where deleted_at is null;

grant select on public.meals_counted to authenticated;
grant select on public.workouts_active to authenticated;

-- ---------------------------------------------------------------------
-- Marca o dia como «a recalcular» sempre que muda o que entra nas contas.
-- Criado no fim, depois dos preenchimentos, para não marcar tudo.
-- ---------------------------------------------------------------------
create or replace function public.mark_day_dirty() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    insert into public.days (user_id, date, dirty) values (old.user_id, old.date, true)
    on conflict (user_id, date) do update set dirty = true;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    insert into public.days (user_id, date, dirty) values (new.user_id, new.date, true)
    on conflict (user_id, date) do update set dirty = true;
  end if;
  return null;
end;
$$;

create or replace trigger meals_dirty_insdel
  after insert or delete on public.meals
  for each row execute function public.mark_day_dirty();
create or replace trigger meals_dirty_upd
  after update on public.meals
  for each row
  when (old.date is distinct from new.date
     or old.kcal is distinct from new.kcal
     or old.protein is distinct from new.protein
     or old.carbs is distinct from new.carbs
     or old.fat is distinct from new.fat
     or old.deleted_at is distinct from new.deleted_at)
  execute function public.mark_day_dirty();

create or replace trigger workouts_dirty_insdel
  after insert or delete on public.workouts
  for each row execute function public.mark_day_dirty();
create or replace trigger workouts_dirty_upd
  after update on public.workouts
  for each row
  when (old.date is distinct from new.date
     or old.kcal_est is distinct from new.kcal_est
     or old.deleted_at is distinct from new.deleted_at)
  execute function public.mark_day_dirty();

create or replace trigger weights_dirty_insdel
  after insert or delete on public.weights
  for each row execute function public.mark_day_dirty();
create or replace trigger weights_dirty_upd
  after update on public.weights
  for each row
  when (old.date is distinct from new.date or old.kg is distinct from new.kg)
  execute function public.mark_day_dirty();

-- ---------------------------------------------------------------------
-- Verificação: tem de vir vazia (todas as tabelas públicas com RLS).
-- ---------------------------------------------------------------------
select tablename as "tabela sem RLS (tem de vir vazio)"
from pg_tables
where schemaname = 'public' and not rowsecurity;
