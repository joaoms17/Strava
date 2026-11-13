-- P1 (auditoria 2026-11): o Hoje num só pedido.
--
-- Cada carregamento do Hoje eram ~16 pedidos à base de dados. Esta função
-- devolve num só JSON o que o dia precisa e que é sempre igual de ler:
--   meals            as refeições do dia (não apagadas), por hora
--   deleted          as apagadas desse dia desde p_deleted_since (7 dias)
--   workouts         os treinos ativos do dia, por ordem de registo
--   weights          a pesagem do dia
--   yesterday_meals  as refeições da véspera («Foi tudo?», fotos sem números)
--   days             as linhas de days desde p_days_from (a semana até este
--                    dia e a véspera) até ao dia
--   tdee             o último gasto estimado antes do dia
--   health           passos e sono desde p_health_from até ao dia (o cartão
--                    do sono e a média dos passos), do mais recente para trás
-- O resto (favoritas, contagens, prints por confirmar, gasto, dieta) continua
-- nos pedidos de sempre.
--
-- security invoker: corre com a sessão de quem pede, e o RLS de cada tabela
-- decide o que se vê (exatamente o que os pedidos separados viam).
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro
-- inteiro → Run. Pode correr-se mais do que uma vez. Sem ela tudo funciona:
-- o Hoje faz os pedidos separados de antes.
-- =====================================================================

create or replace function public.day_bundle(
  p_date date,
  p_days_from date default null,
  p_health_from date default null,
  p_deleted_since timestamptz default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'version', 1,
    'date', p_date,
    'meals', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.logged_at, m.id)
      from public.meals m
      where m.date = p_date and m.deleted_at is null
    ), '[]'::jsonb),
    'deleted', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.deleted_at)
      from public.meals m
      where m.date = p_date
        and m.deleted_at is not null
        and m.deleted_at >= coalesce(p_deleted_since, now() - interval '7 days')
    ), '[]'::jsonb),
    'workouts', coalesce((
      select jsonb_agg(to_jsonb(w) order by w.created_at)
      from public.workouts_active w
      where w.date = p_date
    ), '[]'::jsonb),
    'weights', coalesce((
      select jsonb_agg(jsonb_build_object('date', x.date, 'kg', x.kg, 'measured_at', x.measured_at, 'created_at', x.created_at))
      from public.weights x
      where x.date = p_date
    ), '[]'::jsonb),
    'yesterday_meals', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.logged_at, m.id)
      from public.meals m
      where m.date = p_date - 1 and m.deleted_at is null
    ), '[]'::jsonb),
    'days', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.date)
      from public.days d
      where d.date >= coalesce(p_days_from, least(date_trunc('week', p_date)::date, p_date - 1))
        and d.date <= p_date
    ), '[]'::jsonb),
    'tdee', (
      select d.tdee_est
      from public.days d
      where d.date < p_date and d.tdee_est is not null
      order by d.date desc
      limit 1
    ),
    'health', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.date desc)
      from public.health_daily h
      where h.date <= p_date and h.date >= coalesce(p_health_from, p_date - 30)
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.day_bundle(date, date, date, timestamptz) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.day_bundle(date, date, date, timestamptz) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.day_bundle(date, date, date, timestamptz) to authenticated;
  end if;
end $$;

insert into public.schema_version (id, version) values (true, 20261113000062)
on conflict (id) do update
  set version = greatest(public.schema_version.version, excluded.version),
      applied_at = now();
