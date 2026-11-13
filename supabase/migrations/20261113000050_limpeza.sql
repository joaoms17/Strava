-- =====================================================================
-- Limpeza da base de dados (auditoria 2026-11: L11, L12 e os marcadores do
-- L13; «Ordem segura de remoção», passo 6).
--
-- ATENÇÃO — LER ANTES DE CORRER
--
-- 1. Só depois de o código novo estar publicado HÁ UNS DIAS. O telemóvel
--    guarda o perfil em cache e uma versão antiga da app (PWA ainda por
--    atualizar) pode ler colunas daqui; a versão nova já não lê nenhuma
--    (src/lib/profile-cache.ts tira-as da cópia guardada) e deteta as
--    migrações em falta pela tabela schema_version, não por colunas.
-- 2. É IRREVERSÍVEL: as tabelas e colunas apagadas perdem os dados. Antes,
--    fazer uma cópia de segurança (Supabase → Database → Backups, ou um
--    pg_dump das tabelas profile, days, workouts, body_measurements, foods,
--    integrations e plan_blocks e das 5 tabelas que saem).
-- 3. Correr depois da 20261113000042_schema_version.sql.
--
-- O que sai:
--   * Tabelas órfãs (L11): strava_tokens (vazia; o Strava foi arquivado) e as
--     4 cópias de segurança das migrações de setembro.
--   * Colunas sem nenhuma leitura no código (L12): no perfil equipment,
--     constraints, strava_athlete_id, carbs_ref_g, fat_ref_g,
--     body_comp_source, trend_method_since, bike_min_cadence,
--     console_shows_watts; days.water_ml; workouts.planned_session_id e
--     strava_id; body_measurements.fasted; foods.aliases;
--     integrations.settings; plan_blocks.review.
--   * pin_mode e trend_method do perfil: eram os marcadores de migração antes
--     do L13 e mais nada as lê.
--
-- Vistas: workouts_active foi criada com `select *` (fase 3) e depende das
-- colunas de workouts — sai antes e volta a ser criada igual no fim (com as
-- colunas de hoje). meals_counted não muda (nenhuma coluna de meals sai).
-- Nenhuma função ou gatilho das migrações usa as colunas que saem.
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro
-- inteiro → Run. Pode correr-se mais do que uma vez (if exists em tudo).
-- No fim aparece uma tabela: tem de vir VAZIA.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- L11 — tabelas órfãs
-- ---------------------------------------------------------------------
drop table if exists public.strava_tokens;
drop table if exists public.days_bak_20260928;
drop table if exists public.days_bak_20260929;
drop table if exists public.meals_bak_20260929;
drop table if exists public.workouts_bak_20260930;

-- ---------------------------------------------------------------------
-- L12 — colunas mortas
-- ---------------------------------------------------------------------
alter table public.profile
  drop column if exists equipment,
  drop column if exists constraints,
  drop column if exists strava_athlete_id,
  drop column if exists carbs_ref_g,
  drop column if exists fat_ref_g,
  drop column if exists body_comp_source,
  drop column if exists trend_method,
  drop column if exists trend_method_since,
  drop column if exists bike_min_cadence,
  drop column if exists console_shows_watts,
  drop column if exists pin_mode;

alter table public.days drop column if exists water_ml;

-- A vista depende das colunas de workouts: sai e volta igual (fase 3).
drop view if exists public.workouts_active;
alter table public.workouts
  drop column if exists planned_session_id,
  drop column if exists strava_id;
create view public.workouts_active with (security_invoker = true) as
  select * from public.workouts where deleted_at is null;
grant select on public.workouts_active to authenticated;

alter table public.body_measurements drop column if exists fasted;
alter table public.foods drop column if exists aliases;
alter table public.integrations drop column if exists settings;
alter table public.plan_blocks drop column if exists review;

-- ---------------------------------------------------------------------
-- Versão do schema (ideia 6)
-- ---------------------------------------------------------------------
insert into public.schema_version (id, version) values (true, 20261113000050)
on conflict (id) do update
  set version = greatest(public.schema_version.version, excluded.version),
      applied_at = now();

commit;

-- ---------------------------------------------------------------------
-- Verificação: tem de vir vazia (o que devia ter saído e ainda existe, e
-- colunas de workouts que faltam na vista).
-- ---------------------------------------------------------------------
select t.table_name || coalesce('.' || t.column_name, '') as "ainda existe (tem de vir vazio)"
from (
  select table_name, null::text as column_name
  from information_schema.tables
  where table_schema = 'public'
    and table_name in ('strava_tokens', 'days_bak_20260928', 'days_bak_20260929', 'meals_bak_20260929', 'workouts_bak_20260930')
  union all
  select table_name, column_name
  from information_schema.columns
  where table_schema = 'public'
    and (table_name, column_name) in (
      ('profile', 'equipment'), ('profile', 'constraints'), ('profile', 'strava_athlete_id'),
      ('profile', 'carbs_ref_g'), ('profile', 'fat_ref_g'), ('profile', 'body_comp_source'),
      ('profile', 'trend_method'), ('profile', 'trend_method_since'), ('profile', 'bike_min_cadence'),
      ('profile', 'console_shows_watts'), ('profile', 'pin_mode'), ('days', 'water_ml'),
      ('workouts', 'planned_session_id'), ('workouts', 'strava_id'), ('body_measurements', 'fasted'),
      ('foods', 'aliases'), ('integrations', 'settings'), ('plan_blocks', 'review')
    )
  union all
  select 'workouts_active (falta a coluna)', c.column_name
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'workouts'
    and not exists (
      select 1 from information_schema.columns v
      where v.table_schema = 'public' and v.table_name = 'workouts_active' and v.column_name = c.column_name
    )
) t;
