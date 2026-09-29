-- =====================================================================
-- Migração 5 (Fase 4 do redesenho) — medidas com fita: gordura e massa
-- magra pelo método da Marinha dos EUA.
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro
-- inteiro → Run. Precisa das migrações 1 a 4. Pode correr-se mais do que
-- uma vez. No fim aparece uma tabela: tem de vir VAZIA.
-- =====================================================================

-- ---------------------------------------------------------------------
-- body_measurements — uma medição por dia e método. A gordura e a massa
-- magra calculam-se na hora a partir de weight_used_kg (peso médio usado).
-- ---------------------------------------------------------------------
create table if not exists public.body_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  measured_at timestamptz not null default now(),
  method text not null default 'tape',
  neck_cm numeric(4,1),
  waist_cm numeric(4,1),
  chest_cm numeric(4,1),
  hips_cm numeric(4,1),
  arm_cm numeric(4,1),
  thigh_cm numeric(4,1),
  calf_cm numeric(4,1),
  readings jsonb,                              -- {"waist":[94.0,94.5],"neck":[40.0,40.0]}
  weight_used_kg numeric(5,2) not null,
  fasted boolean not null default true,
  flags text[] not null default '{}',          -- pausa_dieta, depois_jantar_fora, plausibilidade…
  note text,
  created_at timestamptz not null default now()
);

alter table public.body_measurements drop constraint if exists body_measurements_method_check;
alter table public.body_measurements add constraint body_measurements_method_check
  check (method in ('tape'));
alter table public.body_measurements drop constraint if exists body_measurements_neck_check;
alter table public.body_measurements add constraint body_measurements_neck_check
  check (neck_cm is null or neck_cm between 25 and 60);
alter table public.body_measurements drop constraint if exists body_measurements_waist_check;
alter table public.body_measurements add constraint body_measurements_waist_check
  check (waist_cm is null or waist_cm between 50 and 180);
alter table public.body_measurements drop constraint if exists body_measurements_weight_check;
alter table public.body_measurements add constraint body_measurements_weight_check
  check (weight_used_kg between 30 and 300);

create unique index if not exists body_measurements_user_date_method_idx
  on public.body_measurements (user_id, date, method);

alter table public.body_measurements enable row level security;
drop policy if exists owner_all on public.body_measurements;
create policy owner_all on public.body_measurements for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- profile — de quanto em quanto tempo medir e a referência da coxa
-- ---------------------------------------------------------------------
alter table public.profile
  add column if not exists measure_interval_days integer not null default 14,
  add column if not exists thigh_landmark_cm integer not null default 15,
  add column if not exists body_comp_source text not null default 'tape';

-- ---------------------------------------------------------------------
-- Verificação: tem de vir vazia (todas as tabelas públicas com RLS).
-- ---------------------------------------------------------------------
select tablename as "tabela sem RLS (tem de vir vazio)"
from pg_tables
where schemaname = 'public' and not rowsecurity;
