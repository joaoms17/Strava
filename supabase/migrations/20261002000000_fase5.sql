-- =====================================================================
-- Migração 6 (Fase 5 do redesenho) — ginásio livre: favoritos «Pernas A»
-- e «Corpo todo B», com exercícios do catálogo seguro para o joelho e
-- 3 séries de 8 a 12 repetições.
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro
-- inteiro → Run. Precisa das migrações 1 a 5. Pode correr-se mais do que
-- uma vez (não duplica os favoritos). No fim aparece uma tabela: tem de
-- vir VAZIA.
-- =====================================================================

insert into public.favorites (user_id, kind, name, workout, kcal)
select p.user_id, 'workout', t.name,
  jsonb_build_object('type', 'strength', 'minutes', 45, 'exercises', t.exercises),
  150
from public.profile p
cross join (
  values
    ('Pernas A', jsonb_build_array(
      jsonb_build_object('name', 'RDL com halteres', 'sets', 3, 'rep_min', 8, 'rep_max', 12),
      jsonb_build_object('name', 'Hip thrust', 'sets', 3, 'rep_min', 8, 'rep_max', 12),
      jsonb_build_object('name', 'Step-up baixo', 'sets', 3, 'rep_min', 8, 'rep_max', 12),
      jsonb_build_object('name', 'Extensão terminal do joelho com banda', 'sets', 3, 'rep_min', 8, 'rep_max', 12),
      jsonb_build_object('name', 'Abdução de anca com banda', 'sets', 3, 'rep_min', 8, 'rep_max', 12),
      jsonb_build_object('name', 'Calf raise', 'sets', 3, 'rep_min', 8, 'rep_max', 12))),
    ('Corpo todo B', jsonb_build_array(
      jsonb_build_object('name', 'Supino no banco com halteres', 'sets', 3, 'rep_min', 8, 'rep_max', 12),
      jsonb_build_object('name', 'Remada com halteres', 'sets', 3, 'rep_min', 8, 'rep_max', 12),
      jsonb_build_object('name', 'Press de ombros com halteres', 'sets', 3, 'rep_min', 8, 'rep_max', 12),
      jsonb_build_object('name', 'Glute bridge', 'sets', 3, 'rep_min', 8, 'rep_max', 12),
      jsonb_build_object('name', 'Pallof press com banda', 'sets', 3, 'rep_min', 8, 'rep_max', 12),
      jsonb_build_object('name', 'Dead bug', 'sets', 3, 'rep_min', 8, 'rep_max', 12)))
) as t(name, exercises)
where not exists (
  select 1 from public.favorites f
  where f.user_id = p.user_id and f.kind = 'workout' and f.name = t.name
);

-- ---------------------------------------------------------------------
-- Verificação: tem de vir vazia (todas as tabelas públicas com RLS).
-- ---------------------------------------------------------------------
select tablename as "tabela sem RLS (tem de vir vazio)"
from pg_tables
where schemaname = 'public' and not rowsecurity;
