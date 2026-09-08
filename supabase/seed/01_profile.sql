-- Seed do perfil.
-- Requer a conta criada primeiro em Supabase Auth (email + password).
do $$
declare
  v_user uuid;
begin
  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then
    raise exception 'Nenhum utilizador em auth.users. Cria a conta primeiro (Supabase Auth).';
  end if;

  insert into public.profile (user_id, equipment, constraints, goals, timeline)
  values (
    v_user,
    '{
      "casa": ["bicicleta estática", "halteres", "bandas elásticas", "banco"],
      "ginasio": true
    }'::jsonb,
    '{
      "joelho": "artrose",
      "regras": ["sem impacto", "carga baixa", "cadência alta", "regra do semáforo de dor"]
    }'::jsonb,
    '{
      "peso_alvo_kg": 75,
      "ftp_wkg_alvo": 2.5,
      "foco": ["forma física", "força", "W/kg"]
    }'::jsonb,
    '[
      {"label": "Rutura do ligamento cruzado (andebol)", "when": "aos 17 anos"},
      {"label": "Artrose no joelho", "when": "aos 33 anos"},
      {"label": "Início da Época do Regresso", "when": "setembro de 2026"}
    ]'::jsonb
  )
  on conflict (user_id) do nothing;
end $$;
