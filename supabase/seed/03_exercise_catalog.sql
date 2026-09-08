-- Seed do catálogo de exercícios.
-- RASCUNHO a validar pelo utilizador, idealmente com fisio (secção 11 da spec).
-- Os excluídos por defeito ficam no catálogo com knee_safe = false: a geração
-- de planos só pode escolher exercícios com knee_safe = true.
do $$
declare
  v_user uuid;
begin
  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then
    raise exception 'Nenhum utilizador em auth.users. Cria a conta primeiro (Supabase Auth).';
  end if;

  insert into public.exercise_catalog (user_id, name, pattern, knee_safe, rep_min, rep_max, notes)
  values
    (v_user, 'Bike zona 2', 'bike', true, null, null,
     '130/140/150 W; cadência >= 85 rpm; progressão por tempo: 30, 45, 60 min.'),
    (v_user, 'RDL com halteres', 'hinge', true, 8, 12, 'Hip hinge; costas neutras.'),
    (v_user, 'Glute bridge', 'bridge', true, 10, 15, null),
    (v_user, 'Hip thrust', 'bridge', true, 8, 12, 'Com apoio no banco.'),
    (v_user, 'Step-up baixo', 'step', true, 8, 12, 'Degrau baixo; subir controlado; parar com dor.'),
    (v_user, 'Extensão terminal do joelho com banda', 'isolamento-joelho', true, 12, 20,
     'TKE; amplitude final, sem carga axial.'),
    (v_user, 'Isométrico de parede parcial', 'isometrico', true, null, null,
     'Ângulo parcial, sem profundidade; medir em segundos (20-45 s por série).'),
    (v_user, 'Abdução de anca com banda', 'abducao', true, 12, 20, null),
    (v_user, 'Calf raise', 'gemeos', true, 10, 15, null),
    (v_user, 'Press de ombros com halteres', 'empurrar-vertical', true, 8, 12, null),
    (v_user, 'Elevações laterais', 'isolamento-ombro', true, 10, 15, null),
    (v_user, 'Remada com halteres', 'puxar-horizontal', true, 8, 12, null),
    (v_user, 'Supino no banco com halteres', 'empurrar-horizontal', true, 8, 12, null),
    (v_user, 'Curl de bíceps', 'isolamento-biceps', true, 8, 12, null),
    (v_user, 'Extensão de tríceps', 'isolamento-triceps', true, 8, 12, null),
    (v_user, 'Dead bug', 'core', true, 8, 12, 'Reps por lado.'),
    (v_user, 'Pallof press com banda', 'core', true, 10, 15, 'Reps por lado.'),
    -- Excluídos por defeito
    (v_user, 'Agachamento profundo com carga', 'agachamento', false, null, null,
     'Excluído por defeito (joelho).'),
    (v_user, 'Afundos profundos', 'afundo', false, null, null,
     'Excluído por defeito (joelho).'),
    (v_user, 'Saltos', 'pliometria', false, null, null,
     'Excluído por defeito (impacto).'),
    (v_user, 'Corrida', 'corrida', false, null, null,
     'Excluída por defeito (impacto).')
  on conflict (user_id, name) do nothing;
end $$;
