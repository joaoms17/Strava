-- =====================================================================
-- O custo da IA do mês, somado na base de dados (S3).
--
-- O teto mensal lia todas as linhas de api_calls do mês e somava-as no
-- servidor; a API do Supabase devolve no máximo 1 000 linhas por pedido, e
-- acima disso a soma ficava cortada e o teto não disparava. Esta função
-- devolve a soma de uma vez.
--
-- security invoker: com a chave de serviço (o servidor) lê tudo; com uma
-- sessão, o RLS de api_calls deixa somar só as linhas da própria pessoa.
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro
-- inteiro → Run. Pode correr-se mais do que uma vez. Sem ela tudo funciona:
-- o servidor soma por páginas de 1 000.
-- =====================================================================

create or replace function public.ai_cost_since(p_user_id uuid, p_from timestamptz)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(cost_usd), 0)
  from public.api_calls
  where user_id = p_user_id and created_at >= p_from;
$$;

revoke all on function public.ai_cost_since(uuid, timestamptz) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.ai_cost_since(uuid, timestamptz) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.ai_cost_since(uuid, timestamptz) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.ai_cost_since(uuid, timestamptz) to service_role;
  end if;
end $$;
