-- =====================================================================
-- Pesagens apagadas: quando se apaga uma pesagem (ex.: outra pessoa na
-- balança, pesado de roupa), fica aqui o dia e o peso. A sincronização do
-- intervals.icu e o Atalho do iPhone não a voltam a pôr (antes voltava na
-- sincronização seguinte); um peso diferente nesse dia entra como antes.
-- «Anular» tira a marca.
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro
-- inteiro → Run. Pode correr-se mais do que uma vez. No fim aparece uma
-- tabela: tem de vir VAZIA. Sem ela tudo funciona, só que uma pesagem do
-- relógio apagada volta na sincronização seguinte.
-- =====================================================================

create table if not exists public.weights_deleted (
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  kg numeric(5,2),
  source text,
  deleted_at timestamptz not null default now(),
  primary key (user_id, date)
);

alter table public.weights_deleted enable row level security;
drop policy if exists owner_all on public.weights_deleted;
create policy owner_all on public.weights_deleted for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.weights_deleted to authenticated;

-- ---------------------------------------------------------------------
-- Verificação: tem de vir vazia (todas as tabelas públicas com RLS).
-- ---------------------------------------------------------------------
select tablename as "tabela sem RLS (tem de vir vazio)"
from pg_tables
where schemaname = 'public' and not rowsecurity;
