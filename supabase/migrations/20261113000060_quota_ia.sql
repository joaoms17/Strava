-- M20 (auditoria 2026-11): reserva de quota da IA, atómica.
--
-- Antes, o servidor contava as chamadas do dia e só depois chamava a IA e
-- registava a linha em api_calls: 10 fotos da galeria a chegar ao mesmo
-- tempo liam todas a mesma contagem e passavam todas; e uma chamada que
-- falhava não ficava registada (não contava). Agora, antes de cada chamada,
-- o servidor pede esta função, que numa só transação, com um lock por pessoa
-- (ou pela casa, com o Gemini, que partilha a chave):
--   1. conta as chamadas do dia dos tipos limitados e soma o custo do mês;
--   2. recusa se o limite diário ou o teto do mês já foram atingidos;
--   3. senão, regista logo a chamada com o estado «reservada».
-- Depois da resposta, o servidor marca a linha «ok» (com os tokens e o
-- custo) ou «falhou». As chamadas que falham também contam (decisão do dono).
--
-- Os limites (que tipos contam, quantas por dia, o teto em euros) vêm do
-- servidor (api/_lib/rules/custos.ts, quotaPlan): aqui só se aplicam.
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro
-- inteiro → Run. Pode correr-se mais do que uma vez. Sem ela tudo funciona
-- como antes (verificar e depois registar, sem reserva).
-- =====================================================================

alter table public.api_calls
  add column if not exists status text not null default 'ok';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'api_calls_status_check' and conrelid = 'public.api_calls'::regclass
  ) then
    alter table public.api_calls
      add constraint api_calls_status_check check (status in ('reservada', 'ok', 'falhou'));
  end if;
end $$;

-- A contagem do dia (por tipo, de toda a casa com o Gemini).
create index if not exists api_calls_kind_created_idx on public.api_calls (kind, created_at);

create or replace function public.ai_reserve_call(
  p_user_id uuid,
  p_kind text,
  p_model text,
  p_count_kinds text[],
  p_daily_cap integer,
  p_shared_daily boolean,
  p_day_start timestamptz,
  p_month_start timestamptz,
  p_monthly_cap_eur numeric,
  p_usd_to_eur numeric
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_count integer;
  v_month numeric;
  v_id uuid;
begin
  -- Um lock por pessoa (ou pela casa): duas reservas ao mesmo tempo esperam
  -- uma pela outra até ao fim da transação, e a segunda já vê a primeira.
  perform pg_advisory_xact_lock(
    hashtext('ai_quota:' || case when p_shared_daily then 'casa' else p_user_id::text end)
  );

  if p_daily_cap > 0 and coalesce(array_length(p_count_kinds, 1), 0) > 0 then
    select count(*) into v_count
    from public.api_calls
    where kind = any (p_count_kinds)
      and created_at >= p_day_start
      and (p_shared_daily or user_id = p_user_id);
    if v_count >= p_daily_cap then
      return jsonb_build_object('ok', false, 'reason', 'diario', 'count', v_count);
    end if;
  end if;

  if p_monthly_cap_eur > 0 then
    select coalesce(sum(cost_usd), 0) into v_month
    from public.api_calls
    where user_id = p_user_id and created_at >= p_month_start;
    if v_month * p_usd_to_eur >= p_monthly_cap_eur then
      return jsonb_build_object('ok', false, 'reason', 'mensal');
    end if;
  end if;

  insert into public.api_calls (user_id, kind, model, status)
  values (p_user_id, p_kind, coalesce(p_model, ''), 'reservada')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Só o servidor (chave de serviço) reserva: api_calls não tem escrita por RLS.
revoke all on function public.ai_reserve_call(uuid, text, text, text[], integer, boolean, timestamptz, timestamptz, numeric, numeric) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.ai_reserve_call(uuid, text, text, text[], integer, boolean, timestamptz, timestamptz, numeric, numeric) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.ai_reserve_call(uuid, text, text, text[], integer, boolean, timestamptz, timestamptz, numeric, numeric) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.ai_reserve_call(uuid, text, text, text[], integer, boolean, timestamptz, timestamptz, numeric, numeric) to service_role;
  end if;
end $$;

insert into public.schema_version (id, version) values (true, 20261113000060)
on conflict (id) do update
  set version = greatest(public.schema_version.version, excluded.version),
      applied_at = now();
