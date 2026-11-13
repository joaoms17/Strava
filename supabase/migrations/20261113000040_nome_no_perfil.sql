-- P7 (auditoria 2026-11): o nome de cada pessoa passa a estar no perfil, para
-- o servidor não ir à API de Auth (getUserById) em cada partilha e em cada
-- «Pergunta à app». É uma cópia: a fonte continua a ser a conta
-- (auth.users.raw_user_meta_data->>'name', mudada em Definições), e a base de
-- dados mantém-na igual sozinha:
--   - ao criar o perfil (antes do insert, se vier sem nome);
--   - quando a pessoa muda o nome ou o email na conta (gatilho em auth.users).
-- Sem nome escolhido fica o início do email, como o servidor já fazia.
-- O servidor lê a coluna com tolerância: sem esta migração, pergunta ao Auth
-- como antes (api/_lib/people.ts).

alter table public.profile add column if not exists display_name text;

create or replace function public.account_display_name(p_name text, p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(btrim(p_name), ''), nullif(split_part(coalesce(p_email, ''), '@', 1), ''))
$$;

-- Os perfis que já existem.
update public.profile p
set display_name = public.account_display_name(u.raw_user_meta_data ->> 'name', u.email)
from auth.users u
where u.id = p.user_id
  and p.display_name is distinct from public.account_display_name(u.raw_user_meta_data ->> 'name', u.email);

-- Perfil novo sem nome: o da conta.
create or replace function public.profile_fill_display_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.display_name is null then
    select public.account_display_name(u.raw_user_meta_data ->> 'name', u.email)
      into new.display_name
    from auth.users u
    where u.id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists profile_fill_display_name on public.profile;
create trigger profile_fill_display_name
  before insert on public.profile
  for each row execute function public.profile_fill_display_name();

-- A pessoa mudou o nome (ou o email) na conta: o perfil acompanha.
create or replace function public.sync_profile_display_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := public.account_display_name(new.raw_user_meta_data ->> 'name', new.email);
begin
  update public.profile
  set display_name = v_name
  where user_id = new.id
    and display_name is distinct from v_name;
  return new;
end;
$$;

drop trigger if exists sync_profile_display_name on auth.users;
create trigger sync_profile_display_name
  after update of raw_user_meta_data, email on auth.users
  for each row
  when (
    old.raw_user_meta_data ->> 'name' is distinct from new.raw_user_meta_data ->> 'name'
    or old.email is distinct from new.email
  )
  execute function public.sync_profile_display_name();

-- Só a base de dados chama estas funções.
revoke all on function public.profile_fill_display_name() from public, anon, authenticated;
revoke all on function public.sync_profile_display_name() from public, anon, authenticated;
