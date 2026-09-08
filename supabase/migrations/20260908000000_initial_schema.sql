-- =====================================================================
-- "A Época do Regresso" — schema inicial
--
-- Todas as tabelas têm RLS ativa. As tabelas de dados do utilizador são
-- filtradas por user_id = auth.uid(). Duas exceções, mais restritas:
--   - strava_tokens: sem políticas (o cliente nunca lê tokens; só o
--     servidor, com service role, que ignora RLS)
--   - api_calls: o dono pode ler (custos); escrita só via service role
-- Ver docs/decisions.md.
-- =====================================================================

-- =====================================================================
-- profile — uma linha por utilizador
-- =====================================================================
create table public.profile (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  target_weight_kg numeric(5,2) not null default 75,
  base_kcal integer not null default 1500,
  protein_g integer not null default 140,
  protein_per_meal_g integer not null default 35,
  kcal_floor_week integer not null default 1400,
  expected_tdee integer not null default 2200,
  -- dia nutricional: das 04:00 às 04:00 locais (Europe/Lisbon)
  nutrition_day_cutoff_hour integer not null default 4
    check (nutrition_day_cutoff_hour between 0 and 12),
  height_cm integer not null default 183,
  bike_watts_options integer[] not null default '{130,140,150}',
  bike_hr_avg_cap integer not null default 112,
  bike_hr_max_cap integer not null default 125,
  bike_min_cadence integer not null default 85,
  equipment jsonb not null default '[]'::jsonb,
  constraints jsonb not null default '{}'::jsonb,
  goals jsonb not null default '{}'::jsonb,
  timeline jsonb not null default '[]'::jsonb, -- [{label, when}]
  strava_athlete_id bigint,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- foods — alimentos pessoais (aprendizagem de porções e macros)
-- =====================================================================
create table public.foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  aliases text[] not null default '{}',
  default_portion_g numeric(6,1),
  kcal_100g numeric(6,1) not null,
  protein_100g numeric(5,1) not null,
  carbs_100g numeric(5,1) not null,
  fat_100g numeric(5,1) not null,
  source text not null check (source in ('user', 'off', 'claude')),
  barcode text,
  use_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index foods_user_use_count_idx on public.foods (user_id, use_count desc);
create unique index foods_user_barcode_idx on public.foods (user_id, barcode)
  where barcode is not null;

-- =====================================================================
-- meals — refeições registadas
-- =====================================================================
create table public.meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null, -- dia nutricional (04:00–04:00), calculado no servidor
  logged_at timestamptz not null default now(),
  input_type text not null check (input_type in ('text', 'photo', 'barcode', 'manual')),
  raw_text text,
  photo_path text,
  -- [{name, grams, kcal, protein, carbs, fat, food_id?, estimated}]
  items jsonb not null default '[]'::jsonb,
  kcal numeric(6,1) not null default 0,
  protein numeric(5,1) not null default 0,
  carbs numeric(5,1) not null default 0,
  fat numeric(5,1) not null default 0,
  is_estimate boolean not null default false,
  confidence numeric(3,2) check (confidence between 0 and 1),
  prompt_version text,
  model text,
  cost_usd numeric(8,5),
  created_at timestamptz not null default now()
);

create index meals_user_date_idx on public.meals (user_id, date);

-- =====================================================================
-- days — agregado diário (fechado pela cron das 04:30)
-- =====================================================================
create table public.days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  kcal_in integer not null default 0,
  protein numeric(5,1) not null default 0,
  kcal_exercise integer not null default 0,
  kcal_target integer not null default 0,
  is_complete boolean not null default false,
  weight_kg numeric(5,2),
  weight_trend numeric(5,2), -- média móvel de 7 dias
  tdee_est numeric(6,1),     -- gasto adaptativo (EMA alfa 0,3)
  flags jsonb not null default '[]'::jsonb, -- ex.: ["chao", "dia_incompleto"]
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

-- =====================================================================
-- weights — pesagens
-- =====================================================================
create table public.weights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  kg numeric(5,2) not null,
  body_fat_pct numeric(4,1),
  source text not null default 'manual' check (source in ('manual', 'withings')),
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

-- =====================================================================
-- health_daily — passos, sono, FC em repouso (Atalho iOS)
-- =====================================================================
create table public.health_daily (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  steps integer,
  sleep_minutes integer,
  resting_hr integer,
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

-- =====================================================================
-- exercise_catalog — única fonte de exercícios para os planos.
-- Os excluídos por defeito existem com knee_safe = false; a geração de
-- planos só pode escolher knee_safe = true.
-- =====================================================================
create table public.exercise_catalog (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  pattern text not null,
  knee_safe boolean not null default true,
  rep_min integer,
  rep_max integer,
  notes text,
  created_at timestamptz not null default now(),
  unique (user_id, name),
  check (rep_min is null or rep_max is null or rep_min <= rep_max)
);

-- =====================================================================
-- chapters — capítulos da narrativa (facts: só factos verificáveis)
-- =====================================================================
create table public.chapters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  order_index integer not null, -- "order" é palavra reservada
  title text not null,
  patron text not null,
  sport text not null,
  jersey_number integer,
  poster_stat text,
  facts jsonb not null default '[]'::jsonb,
  theme text,
  honest_note text,
  photo_path text,
  photo_credit text,
  created_at timestamptz not null default now(),
  unique (user_id, order_index)
);

-- =====================================================================
-- plan_blocks — blocos de 4 semanas ligados a um capítulo
-- =====================================================================
create table public.plan_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  chapter_id uuid references public.chapters (id) on delete set null,
  start_date date not null,
  weeks integer not null default 4,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'completed', 'cancelled')),
  plan jsonb,
  review jsonb,
  prompt_version text,
  created_at timestamptz not null default now()
);

create index plan_blocks_user_start_idx on public.plan_blocks (user_id, start_date);

-- =====================================================================
-- workouts — sessões feitas (Strava ou manual)
-- planned_session_id ganha FK depois de planned_sessions existir.
-- =====================================================================
create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  source text not null check (source in ('strava', 'manual')),
  strava_id bigint unique,
  type text not null check (type in ('bike', 'strength', 'other')),
  planned_session_id uuid,
  minutes integer,
  watts integer,
  cadence integer,
  avg_hr integer,
  max_hr integer,
  kcal_est integer,
  pain_during integer check (pain_during between 0 and 10),
  pain_next_day integer check (pain_next_day between 0 and 10),
  status text check (status in ('green', 'yellow', 'red')),
  raw jsonb, -- resposta inteira do Strava, para reprocessar
  created_at timestamptz not null default now()
);

create index workouts_user_date_idx on public.workouts (user_id, date);

-- =====================================================================
-- planned_sessions — sessões planeadas de um bloco
-- =====================================================================
create table public.planned_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  block_id uuid not null references public.plan_blocks (id) on delete cascade,
  week integer not null check (week between 1 and 4),
  day_index integer not null check (day_index between 0 and 6), -- 0 = segunda
  type text not null check (type in ('bike', 'strength', 'other')),
  name text,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'planned'
    check (status in ('planned', 'done', 'skipped', 'swapped')),
  workout_id uuid references public.workouts (id) on delete set null,
  created_at timestamptz not null default now()
);

create index planned_sessions_block_idx on public.planned_sessions (block_id);

alter table public.workouts
  add constraint workouts_planned_session_id_fkey
  foreign key (planned_session_id) references public.planned_sessions (id)
  on delete set null;

-- =====================================================================
-- exercise_log — séries registadas numa sessão de força
-- =====================================================================
create table public.exercise_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workout_id uuid not null references public.workouts (id) on delete cascade,
  exercise text not null,
  set_index integer not null,
  reps integer,
  load_kg numeric(5,1),
  rpe numeric(3,1) check (rpe between 0 and 10),
  created_at timestamptz not null default now()
);

create index exercise_log_workout_idx on public.exercise_log (workout_id);
create index exercise_log_user_exercise_idx on public.exercise_log (user_id, exercise);

-- =====================================================================
-- weekly_reviews — review semanal em voz de narrador
-- =====================================================================
create table public.weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  week_start date not null,
  text text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, week_start)
);

-- =====================================================================
-- strava_tokens — só o servidor toca aqui (service role)
-- =====================================================================
create table public.strava_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  athlete_id bigint not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- api_calls — registo de todas as chamadas ao Claude
-- =====================================================================
create table public.api_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null, -- meal_parse_text | meal_parse_photo | plan_generate | weekly_review
  model text not null,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  cost_usd numeric(8,5) not null default 0,
  created_at timestamptz not null default now()
);

create index api_calls_user_created_idx on public.api_calls (user_id, created_at);

-- =====================================================================
-- RLS
-- =====================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'profile', 'foods', 'meals', 'days', 'weights', 'health_daily',
    'exercise_catalog', 'chapters', 'plan_blocks', 'workouts',
    'planned_sessions', 'exercise_log', 'weekly_reviews'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy owner_all on public.%I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- strava_tokens: RLS ativa sem políticas — nenhum acesso a partir do cliente
alter table public.strava_tokens enable row level security;

-- api_calls: o dono lê, mas só o servidor escreve
alter table public.api_calls enable row level security;
create policy owner_select on public.api_calls for select to authenticated
  using (user_id = auth.uid());
