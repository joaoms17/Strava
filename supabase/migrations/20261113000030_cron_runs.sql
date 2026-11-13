-- S1/S9 (auditoria 2026-11): registo de cada execução das crons (fecho da
-- noite e lembretes): início, fim, se correu bem e os erros. A app lê a
-- última noite em Avançado (aviso discreto se falhou); só o servidor (service
-- role) escreve. O código funciona sem esta tabela (ignora o registo).

create table if not exists public.cron_runs (
  id bigint generated always as identity primary key,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  errors jsonb not null default '[]'::jsonb,
  summary jsonb
);

create index if not exists cron_runs_job_started_idx on public.cron_runs (job, started_at desc);

alter table public.cron_runs enable row level security;

drop policy if exists cron_runs_read on public.cron_runs;
create policy cron_runs_read on public.cron_runs for select to authenticated using (true);

revoke all on public.cron_runs from anon, authenticated;
grant select on public.cron_runs to authenticated;
grant all on public.cron_runs to service_role;
