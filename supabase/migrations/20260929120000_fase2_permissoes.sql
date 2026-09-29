-- =====================================================================
-- Migração 3 (correção da migração 2) — a função de limpeza do Storage
-- fica só para o servidor.
--
-- No Supabase, as funções novas em public ficam executáveis por anon e
-- authenticated (privilégios por omissão do schema), e o «revoke … from
-- public» da migração 2 não lhes tira isso. Como a função é security
-- definer, qualquer sessão conseguia listar nomes de ficheiros do Storage.
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar → Run.
-- Pode correr-se mais do que uma vez. No fim aparece uma tabela com quem
-- pode executar a função: só postgres e service_role.
-- =====================================================================

revoke all on function public.storage_orphan_candidates(text, interval, integer) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.storage_orphan_candidates(text, interval, integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.storage_orphan_candidates(text, interval, integer) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.storage_orphan_candidates(text, interval, integer) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Verificação: só podem aparecer postgres e service_role.
-- ---------------------------------------------------------------------
select r.rolname as "pode executar storage_orphan_candidates"
from pg_roles r
where has_function_privilege(r.oid, 'public.storage_orphan_candidates(text, interval, integer)', 'execute')
  and r.rolname in ('anon', 'authenticated', 'service_role', 'postgres', 'public')
order by 1;
