-- Perguntas da IA nas fotos de refeições (rules/perguntas.ts): as que o
-- modelo fez sobre a foto, com as sugestões e a resposta de quem comeu.
-- As respondidas voltam como contexto das análises seguintes.
alter table public.meals add column if not exists questions jsonb;

insert into public.schema_version (id, version) values (true, 20261123000000)
on conflict (id) do update
  set version = greatest(public.schema_version.version, excluded.version),
      applied_at = now();
