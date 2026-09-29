-- =====================================================================
-- Migração 2 (Fase 2 do redesenho) — comida sem espera: análise em
-- segundo plano, várias fotos por refeição, notas, estados e limites.
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro
-- inteiro → Run. Precisa da migração 1. Pode correr-se mais do que uma vez.
-- No fim aparece uma tabela: tem de vir VAZIA (todas as tabelas com RLS).
-- =====================================================================

-- Cópias de segurança antes dos preenchimentos (sem acesso do cliente).
create table if not exists public.meals_bak_20260929 as table public.meals;
alter table public.meals_bak_20260929 enable row level security;
create table if not exists public.days_bak_20260929 as table public.days;
alter table public.days_bak_20260929 enable row level security;

-- Os preenchimentos não devem marcar dias: o trigger volta no fim.
drop trigger if exists meals_dirty_upd on public.meals;

-- ---------------------------------------------------------------------
-- meals — colunas da análise em segundo plano
-- ---------------------------------------------------------------------
alter table public.meals
  add column if not exists client_id uuid,
  add column if not exists photo_paths text[] not null default '{}',
  add column if not exists thumb_paths text[] not null default '{}',
  add column if not exists image_hashes text[] not null default '{}',
  add column if not exists note text,
  add column if not exists analysis_note text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists slot text,
  add column if not exists status text not null default 'ok',
  add column if not exists analysis_started_at timestamptz,
  add column if not exists analysis_attempts integer not null default 0,
  add column if not exists analysis_error text,
  add column if not exists confirmed_at timestamptz;

create unique index if not exists meals_client_id_key on public.meals (client_id);
create index if not exists meals_image_hashes_idx on public.meals using gin (image_hashes);
create index if not exists meals_pending_idx on public.meals (user_id, date)
  where status in ('a_analisar', 'sem_analise') and deleted_at is null;

alter table public.meals drop constraint if exists meals_status_check;
alter table public.meals add constraint meals_status_check
  check (status in ('a_analisar', 'por_rever', 'ok', 'erro', 'sem_analise'));
alter table public.meals drop constraint if exists meals_slot_check;
alter table public.meals add constraint meals_slot_check
  check (slot is null or slot in ('pequeno_almoco', 'almoco', 'lanche', 'jantar', 'ceia'));
alter table public.meals drop constraint if exists meals_input_type_check;
alter table public.meals add constraint meals_input_type_check
  check (input_type in ('text', 'photo', 'barcode', 'manual', 'favorite', 'repeat', 'quick'));

-- A foto antiga passa para a lista de fotos.
update public.meals
set photo_paths = array[photo_path]
where photo_path is not null and photo_paths = '{}';

-- Momento do dia deduzido da hora de Lisboa (04:00–10:59 pequeno-almoço,
-- 11:00–14:59 almoço, 15:00–18:29 lanche, 18:30–21:59 jantar, resto ceia).
update public.meals
set slot = case
  when m >= 240 and m < 660 then 'pequeno_almoco'
  when m >= 660 and m < 900 then 'almoco'
  when m >= 900 and m < 1110 then 'lanche'
  when m >= 1110 and m < 1320 then 'jantar'
  else 'ceia'
end
from (
  select id as mid,
    extract(hour from logged_at at time zone 'Europe/Lisbon') * 60
      + extract(minute from logged_at at time zone 'Europe/Lisbon') as m
  from public.meals
) t
where public.meals.id = t.mid and public.meals.slot is null;

-- As refeições antigas que não eram estimativa já contam como confirmadas.
update public.meals
set confirmed_at = created_at
where confirmed_at is null and not is_estimate;

-- Registos sem itens (só números) ganham um item sintético, para uma edição
-- futura nunca pôr os totais a zero.
update public.meals
set items = jsonb_build_array(jsonb_build_object(
  'name', 'Registo rápido', 'grams', 0,
  'kcal', kcal, 'protein', protein, 'carbs', carbs, 'fat', fat,
  'food_id', null, 'estimated', false))
where items = '[]'::jsonb and kcal > 0;

-- ---------------------------------------------------------------------
-- Só contam as refeições analisadas: ok e por_rever.
-- ---------------------------------------------------------------------
drop view if exists public.meals_counted;
create view public.meals_counted with (security_invoker = true) as
  select * from public.meals
  where deleted_at is null and status in ('ok', 'por_rever');
grant select on public.meals_counted to authenticated;

-- ---------------------------------------------------------------------
-- days — fotos ainda por contar; profile — limites da IA
-- ---------------------------------------------------------------------
alter table public.days add column if not exists meals_pending integer not null default 0;

alter table public.profile
  add column if not exists ai_monthly_cap_eur numeric(6,2) not null default 10,
  add column if not exists ai_daily_vision_cap integer not null default 40;

-- ---------------------------------------------------------------------
-- Reivindicação atómica de uma análise: só avança com a refeição em
-- 'a_analisar', o prazo anterior (90 s) expirado e menos de 3 tentativas.
-- Com 3 tentativas gastas e o prazo expirado, passa a 'erro'.
-- reset = true («Tentar de novo», «Reanalisar foto») repõe as tentativas.
-- ---------------------------------------------------------------------
create or replace function public.claim_meal_analysis(p_meal_id uuid, p_reset boolean default false)
returns setof public.meals
language plpgsql
set search_path = public
as $$
begin
  if p_reset then
    update public.meals
    set status = 'a_analisar', analysis_attempts = 0, analysis_started_at = null,
        analysis_error = null
    where id = p_meal_id and deleted_at is null;
  end if;

  return query
    update public.meals
    set analysis_started_at = now(), analysis_attempts = analysis_attempts + 1
    where id = p_meal_id
      and deleted_at is null
      and status = 'a_analisar'
      and analysis_attempts < 3
      and (analysis_started_at is null or analysis_started_at < now() - interval '90 seconds')
    returning *;

  if not found then
    update public.meals
    set status = 'erro',
        analysis_error = coalesce(analysis_error, 'Não consegui ler esta refeição.')
    where id = p_meal_id
      and status = 'a_analisar'
      and analysis_attempts >= 3
      and (analysis_started_at is null or analysis_started_at < now() - interval '90 seconds');
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Ficheiros sem dono no Storage (limpeza de domingo, só pela service role):
-- mais antigos do que p_min_age e sem nenhuma refeição ou favorito que os use.
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
  order by o.created_at
  limit p_limit
$$;

revoke all on function public.storage_orphan_candidates(text, interval, integer) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.storage_orphan_candidates(text, interval, integer) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- O trigger volta, agora também atento ao estado da análise.
-- ---------------------------------------------------------------------
create or replace trigger meals_dirty_upd
  after update on public.meals
  for each row
  when (old.date is distinct from new.date
     or old.kcal is distinct from new.kcal
     or old.protein is distinct from new.protein
     or old.carbs is distinct from new.carbs
     or old.fat is distinct from new.fat
     or old.status is distinct from new.status
     or old.deleted_at is distinct from new.deleted_at)
  execute function public.mark_day_dirty();

-- ---------------------------------------------------------------------
-- Verificação: tem de vir vazia (todas as tabelas públicas com RLS).
-- ---------------------------------------------------------------------
select tablename as "tabela sem RLS (tem de vir vazio)"
from pg_tables
where schemaname = 'public' and not rowsecurity;
