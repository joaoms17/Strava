-- =====================================================================
-- Migração 8 (Fase 7 do redesenho) — treinos automáticos do relógio
-- Garmin através do intervals.icu.
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro
-- inteiro → Run. Precisa das migrações 1 a 7. Pode correr-se mais do que
-- uma vez. No fim aparece uma tabela: tem de vir VAZIA.
-- =====================================================================

-- ---------------------------------------------------------------------
-- integrations — a chave do intervals.icu. RLS ligada SEM políticas (como
-- strava_tokens): só o servidor (service role) a lê e escreve; a app vê o
-- estado em profile.integration_status e nunca a chave.
-- ---------------------------------------------------------------------
create table if not exists public.integrations (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  api_key text not null,
  athlete_id text,
  last_sync_at timestamptz,
  last_error text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, provider)
);
alter table public.integrations drop constraint if exists integrations_provider_check;
alter table public.integrations add constraint integrations_provider_check
  check (provider in ('intervals'));
alter table public.integrations enable row level security;

-- ---------------------------------------------------------------------
-- profile — estado das ligações, visível na app (sem segredos)
-- ---------------------------------------------------------------------
alter table public.profile
  add column if not exists integration_status jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------
-- health_daily — de onde vêm os passos, o sono e a FC em repouso
-- ---------------------------------------------------------------------
alter table public.health_daily
  add column if not exists source text not null default 'shortcut';
alter table public.health_daily drop constraint if exists health_daily_source_check;
alter table public.health_daily add constraint health_daily_source_check
  check (source in ('shortcut', 'intervals'));

-- ---------------------------------------------------------------------
-- Verificação: tem de vir vazia (todas as tabelas públicas com RLS).
-- ---------------------------------------------------------------------
select tablename as "tabela sem RLS (tem de vir vazio)"
from pg_tables
where schemaname = 'public' and not rowsecurity;
