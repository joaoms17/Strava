-- G3 (auditoria 2026-11): as subscrições das notificações só se criam e
-- mudam pelo servidor (/api/day/push-subscribe, com a lista de serviços
-- permitidos em pushEndpointAllowed). O cliente já gravava por lá; aqui
-- tira-se-lhe o insert/update direto pela RLS, que deixava pôr um endereço
-- qualquer para o servidor depois lhe fazer um POST. Ler e apagar as suas
-- continua (o «desligar» apaga pela sessão da pessoa).

drop policy if exists owner_all on public.push_subscriptions;
drop policy if exists owner_select on public.push_subscriptions;
drop policy if exists owner_delete on public.push_subscriptions;

create policy owner_select on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy owner_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update on public.push_subscriptions from authenticated, anon;
grant select, delete on public.push_subscriptions to authenticated;
