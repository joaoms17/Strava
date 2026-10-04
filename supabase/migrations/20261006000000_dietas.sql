-- =====================================================================
-- Migração 10 — dietas feitas com as refeições favoritas: para cada
-- refeição do dia (pequeno-almoço … ceia), uma ou mais favoritas (a
-- primeira é a habitual). Só uma dieta está a ser seguida de cada vez.
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro
-- inteiro → Run. Precisa das migrações 1 a 9. Pode correr-se mais do que
-- uma vez. No fim aparece uma tabela: tem de vir VAZIA.
-- =====================================================================

create table if not exists public.diets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  -- {"almoco": ["<id da favorita>", …], …}; a primeira de cada é a habitual
  meals jsonb not null default '{}'::jsonb,
  active boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.diets drop constraint if exists diets_meals_object_check;
alter table public.diets add constraint diets_meals_object_check
  check (jsonb_typeof(meals) = 'object');
alter table public.diets drop constraint if exists diets_name_check;
alter table public.diets add constraint diets_name_check
  check (length(btrim(name)) between 1 and 60);

-- Só uma dieta seguida de cada vez.
create unique index if not exists diets_one_active
  on public.diets (user_id) where active and not archived;
create index if not exists diets_user_idx on public.diets (user_id, archived);

alter table public.diets enable row level security;
drop policy if exists owner_all on public.diets;
create policy owner_all on public.diets for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.diets to authenticated;

-- ---------------------------------------------------------------------
-- Verificação: tem de vir vazia (todas as tabelas públicas com RLS).
-- ---------------------------------------------------------------------
select tablename as "tabela sem RLS (tem de vir vazio)"
from pg_tables
where schemaname = 'public' and not rowsecurity;
