-- =====================================================================
-- Notificações (Definições › Notificações): cada telemóvel que as liga
-- guarda aqui a sua subscrição (o endereço do serviço de notificações da
-- Apple ou da Google e as chaves do browser), com as notificações que quer.
-- As chaves VAPID do servidor ficam em app_secrets: o servidor cria-as
-- sozinho na primeira vez e nunca as troca. RLS ligada SEM políticas (como
-- integrations): só o servidor (service role) lá chega.
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro
-- inteiro → Run. Pode correr-se mais do que uma vez. No fim aparece uma
-- tabela: tem de vir VAZIA. Sem ela a app funciona; só Definições ›
-- Notificações diz que falta este passo.
-- =====================================================================

create table if not exists public.app_secrets (
  key text primary key,
  value jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  -- a chave pública com que foi feita: com outra chave já não funciona
  vapid_key text not null,
  -- {"refeicao": true, "jantar": false, "semana": true}
  prefs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_ok_at timestamptz
);

alter table public.push_subscriptions drop constraint if exists push_subscriptions_prefs_object_check;
alter table public.push_subscriptions add constraint push_subscriptions_prefs_object_check
  check (jsonb_typeof(prefs) = 'object');
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
drop policy if exists owner_all on public.push_subscriptions;
create policy owner_all on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- ---------------------------------------------------------------------
-- Verificação: tem de vir vazia (todas as tabelas públicas com RLS).
-- ---------------------------------------------------------------------
select tablename as "tabela sem RLS (tem de vir vazio)"
from pg_tables
where schemaname = 'public' and not rowsecurity;
