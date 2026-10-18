-- =====================================================================
-- Produtos de marca: os alimentos lidos por código de barras (Open Food
-- Facts) ou pelo rótulo guardam também a fibra, os açúcares, a gordura
-- saturada, o sal, o Nutri-Score e a dose do rótulo («1 pote (125 g)»).
-- A pesquisa de produtos pelo nome fica em cache (o Open Food Facts aceita
-- no máximo 10 pesquisas por minuto): off_searches só é lida e escrita pelo
-- servidor (RLS sem políticas, como integrations).
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro
-- inteiro → Run. Pode correr-se mais do que uma vez. No fim aparece uma
-- tabela: tem de vir VAZIA. Sem ela tudo funciona, só que os alimentos
-- guardam só as calorias e os macros e a pesquisa não fica em cache.
-- =====================================================================

alter table public.foods
  add column if not exists fiber_100g numeric(5,1),
  add column if not exists sugars_100g numeric(5,1),
  add column if not exists sat_fat_100g numeric(5,1),
  add column if not exists salt_100g numeric(5,2),
  add column if not exists nutriscore text,
  add column if not exists serving_label text;

alter table public.foods drop constraint if exists foods_nutriscore_check;
alter table public.foods add constraint foods_nutriscore_check
  check (nutriscore is null or nutriscore in ('a', 'b', 'c', 'd', 'e'));

-- O mesmo código de barras procura-se nos alimentos de todas as pessoas da
-- casa (o que o João já leu aparece à Joana sem ir ao Open Food Facts).
create index if not exists foods_barcode_idx on public.foods (barcode)
  where barcode is not null;

create table if not exists public.off_searches (
  q text primary key,
  results jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);

create index if not exists off_searches_fetched_idx on public.off_searches (fetched_at desc);

alter table public.off_searches enable row level security;

-- ---------------------------------------------------------------------
-- Verificação: tem de vir vazia (todas as tabelas públicas com RLS).
-- ---------------------------------------------------------------------
select tablename as "tabela sem RLS (tem de vir vazio)"
from pg_tables
where schemaname = 'public' and not rowsecurity;
