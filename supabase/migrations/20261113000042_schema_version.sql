-- Ideia 6 (auditoria 2026-11): a versão do schema fica explícita numa tabela,
-- em vez de se adivinhar pela existência de uma coluna. Uma linha só, com o
-- número (timestamp) da última migração aplicada. /api/day/health mostra-a ao
-- lado da versão que o código conhece (api/_lib/rules/esquema.ts); a app
-- poderá avisar de todas as migrações em falta de uma vez.
--
-- Aplicar depois da 20261113000040 e da 20261113000041 (por ordem do nome).
--
-- Regra para as migrações seguintes: cada uma acaba com
--   insert into public.schema_version (id, version) values (true, <timestamp>)
--   on conflict (id) do update
--     set version = greatest(public.schema_version.version, excluded.version),
--         applied_at = now();
-- e SCHEMA_VERSION em api/_lib/rules/esquema.ts passa para esse número.

create table if not exists public.schema_version (
  id boolean primary key default true check (id),
  version bigint not null,
  applied_at timestamptz not null default now()
);

alter table public.schema_version enable row level security;

-- Quem tem sessão pode ler (a app compara com a versão que conhece); só as
-- migrações escrevem.
drop policy if exists schema_version_read on public.schema_version;
create policy schema_version_read on public.schema_version
  for select to authenticated using (true);
revoke insert, update, delete on public.schema_version from anon, authenticated;
grant select on public.schema_version to authenticated;

insert into public.schema_version (id, version) values (true, 20261113000042)
on conflict (id) do update
  set version = greatest(public.schema_version.version, excluded.version),
      applied_at = now();
