-- Seed dos capítulos de "A Época do Regresso".
-- Só factos verificáveis; podem acrescentar-se, nunca inventar.
do $$
declare
  v_user uuid;
begin
  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then
    raise exception 'Nenhum utilizador em auth.users. Cria a conta primeiro (Supabase Auth).';
  end if;

  insert into public.chapters
    (user_id, order_index, title, patron, sport, jersey_number, poster_stat, theme, honest_note, facts)
  values
  (
    v_user, 0, 'Prólogo', 'Roberto Baggio', 'futebol', 10, null,
    'A lesão no início não decide o fim.', null,
    '[
      "1985: aos 18 anos, lesão grave no joelho direito num jogo pelo Vicenza; cirurgia com 220 pontos.",
      "1986: nova operação ao mesmo joelho.",
      "1993: Bola de Ouro.",
      "1994: leva a Itália à final do Mundial."
    ]'::jsonb
  ),
  (
    v_user, 1, 'Reconstrução', 'Ronaldo Nazário', 'futebol', 9, null,
    'Base, paciência, zona 2, sem atalhos.', null,
    '[
      "Novembro de 1999: rutura do tendão rotuliano do joelho direito.",
      "Abril de 2000: volta na final da Taça de Itália e rompe outra vez aos 6 minutos.",
      "Quase dois anos praticamente sem jogar.",
      "2002: campeão do mundo e melhor marcador do Mundial, com 8 golos."
    ]'::jsonb
  ),
  (
    v_user, 2, 'Aparecer', 'Alan Shearer', 'futebol', 9, null,
    'Consistência semanal.', null,
    '[
      "Dezembro de 1992: rutura de ligamento cruzado no Blackburn.",
      "1994-95: 34 golos e campeão da Premier League.",
      "Melhor marcador da história da Premier League, com 260 golos."
    ]'::jsonb
  ),
  (
    v_user, 3, 'O joelho que tens', 'Zlatan Ibrahimović', 'futebol', 11, null,
    'A cabeça.',
    'A lição é a mentalidade, não o método; o semáforo existe para não pagar o preço dele.',
    '[
      "Abril de 2017: aos 35 anos, rutura de ligamentos do joelho no Manchester United; carreira dada como acabada.",
      "Novembro de 2017: regressa.",
      "Maio de 2022: aos 40 anos, campeão de Itália pelo Milan.",
      "Revelou depois ter jogado meses sem ligamento cruzado, com dezenas de injeções, e foi operado a seguir ao título.",
      "Retirou-se em 2023, aos 41 anos."
    ]'::jsonb
  ),
  (
    v_user, 4, 'Ninguém te esperava', 'Ruud van Nistelrooy', 'futebol', 10, null,
    'O revés antes do pico.', null,
    '[
      "Abril de 2000: a transferência para o Manchester United cai por dúvidas nos exames ao joelho; dias depois, rompe o cruzado no treino.",
      "2001: assina pelo Manchester United.",
      "2001-02: jogador do ano da PFA.",
      "2002-03: melhor marcador da Premier League, com 25 golos."
    ]'::jsonb
  ),
  (
    v_user, 5, 'A idade não decide', 'Nikola Karabatić', 'andebol', 13, null,
    'O teu desporto.', null,
    '[
      "Outubro de 2020: aos 36 anos, rutura do ligamento cruzado anterior.",
      "Agosto de 2021: aos 37 anos, ouro olímpico em Tóquio pela França."
    ]'::jsonb
  ),
  (
    v_user, 6, 'A bicicleta', 'Egan Bernal', 'ciclismo', null, '20',
    '150 W e 2,5 W/kg.', null,
    '[
      "Janeiro de 2022: choque contra um autocarro em treino; cerca de 20 fraturas, incluindo fémur, rótula e vértebras.",
      "Agosto de 2022: volta a competir.",
      "2024: campeão da Colômbia de estrada e de contrarrelógio; corre o Tour de France."
    ]'::jsonb
  )
  on conflict (user_id, order_index) do nothing;
end $$;
