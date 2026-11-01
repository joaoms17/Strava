-- =====================================================================
-- UMA VEZ SÓ (não é uma migração): o plano de treino do João (decisões 305
-- e 306).
--
-- O PDF do treinador («Plano de treino · Fase 1», out 2026) passa a dados do
-- João, e só dele: profile.goals.plano_treino (o Treino mostra «Plano de
-- treino», o Ginásio «Ver plano» e os treinos que chegam sozinhos «Qual
-- foi?» só a quem o tem; a Joana não tem nada). Também, só para ele:
--   * no catálogo dele, os 5 exercícios do plano que não havia (o catálogo da
--     app já os traz; aqui ficam marcados seguros para o joelho);
--   * os treinos dele «Fase 1 · Dia 1 · Superiores & core», «Fase 1 · Dia 2 · Inferiores», «Fase 1 · Dia 3 · Corpo inteiro»
--     (favoritos de ginásio), com as séries, as repetições (ou os segundos) e
--     as notas, para o Ginásio começar já preenchido. A app também os cria no
--     primeiro «Começar Dia N» ou «Qual foi? › Dia N» se faltarem (o mesmo
--     nome e os mesmos exercícios);
--   * o ginásio de 31 out 2026 (o mais recente desse dia) fica como «Dia 1»,
--     tal como a app faz quando ele escolhe «Dia 1» em «Qual foi?».
--
-- Pode correr-se mais do que uma vez: o plano é substituído (o resto de
-- goals fica), o catálogo e os favoritos não se duplicam (pelo nome) e o
-- treino de 31 out só muda uma vez.
-- Um teste (tests/plano-treino.test.ts) garante que este ficheiro e a app
-- montam os mesmos treinos.
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro → Run.
-- O resultado no fim mostra o plano, os 3 treinos e o treino de 31 out.
-- =====================================================================

-- 1. O plano no perfil do João (o resto de goals fica como está).
update public.profile
set goals = coalesce(goals, '{}'::jsonb) || jsonb_build_object('plano_treino', $plano$
{
  "versao": 1,
  "fase": 1,
  "quando": "Out 2026",
  "lema": "Construir força, proteger o joelho.",
  "cuidados": {
    "zona": "Joelho direito",
    "titulo": "3 roturas no cruzado + problemas de cartilagem",
    "detalhe": "Exige proteção articular estrita.",
    "evitar": [
      "Impacto excessivo",
      "Rotações agressivas",
      "Carga direta excessiva em flexão profunda sob stress no joelho direito"
    ],
    "foco": [
      "Exercícios estáveis",
      "Cadeias cinéticas fechadas e controladas nos membros inferiores"
    ]
  },
  "dias": [
    {
      "n": 1,
      "titulo": "Membros superiores & core",
      "curto": "Superiores & core",
      "resumo": "Peito, costas, ombros e core",
      "etiquetas": [
        "Tronco + core"
      ],
      "favorito": "Fase 1 · Dia 1 · Superiores & core",
      "minutos": 60,
      "exercicios": [
        {
          "nome": "Pendurar na barra",
          "detalhe": "Barra fixa · Pega e ombros",
          "unidade": "max",
          "exercicio": "Pendurar na barra (segundos)"
        },
        {
          "nome": "Supino inclinado",
          "detalhe": "Halteres · Peito",
          "series": 3,
          "min": 8,
          "max": 12,
          "unidade": "reps",
          "exercicio": "Supino inclinado com halteres"
        },
        {
          "nome": "Lat pulldown",
          "detalhe": "Máquina · Costas",
          "series": 3,
          "min": 8,
          "max": 12,
          "unidade": "reps",
          "exercicio": "Puxada à frente"
        },
        {
          "nome": "Remada unilateral",
          "detalhe": "Halteres · Costas",
          "series": 3,
          "min": 10,
          "unidade": "reps",
          "exercicio": "Remada com halteres"
        },
        {
          "nome": "Press de ombros",
          "detalhe": "Máquina · Ombros",
          "series": 3,
          "min": 10,
          "unidade": "reps",
          "exercicio": "Press de ombros na máquina"
        },
        {
          "nome": "Hollow rock",
          "detalhe": "Peso corporal · Core",
          "series": 3,
          "min": 20,
          "unidade": "seg",
          "exercicio": "Hollow rock (segundos)"
        }
      ]
    },
    {
      "n": 2,
      "titulo": "Membros inferiores",
      "curto": "Inferiores",
      "subtitulo": "Estabilidade",
      "resumo": "Estabilidade e proteção do joelho",
      "etiquetas": [
        "Cadeia cinética fechada"
      ],
      "aviso_joelho": "Evitar impacto, rotações agressivas e carga excessiva em flexão profunda.",
      "favorito": "Fase 1 · Dia 2 · Inferiores",
      "minutos": 50,
      "exercicios": [
        {
          "nome": "Wall sit",
          "detalhe": "Isometria · Quadríceps",
          "series": 3,
          "min": 1,
          "unidade": "min",
          "exercicio": "Isométrico de parede parcial (segundos)"
        },
        {
          "nome": "Ponte de glúteos",
          "detalhe": "Isometria · Glúteos",
          "series": 3,
          "min": 30,
          "max": 45,
          "unidade": "seg",
          "exercicio": "Ponte de glúteos isométrica (segundos)"
        },
        {
          "nome": "Leg press 45°",
          "detalhe": "Máquina · Pernas",
          "series": 3,
          "min": 10,
          "max": 12,
          "unidade": "reps",
          "nota": "Pés altos na plataforma",
          "nota_tipo": "subir",
          "exercicio": "Leg press 45°"
        },
        {
          "nome": "Leg curl",
          "detalhe": "Máquina · Posteriores",
          "series": 3,
          "min": 10,
          "max": 12,
          "unidade": "reps",
          "nota": "3-5 seg. a contrair",
          "nota_tipo": "tempo",
          "exercicio": "Leg curl"
        },
        {
          "nome": "Gémeos em pé",
          "detalhe": "Gémeos",
          "series": 4,
          "min": 15,
          "unidade": "reps",
          "exercicio": "Calf raise"
        }
      ]
    },
    {
      "n": 3,
      "titulo": "Corpo inteiro",
      "curto": "Corpo inteiro",
      "resumo": "Inclui supersérie de braços",
      "etiquetas": [
        "1 supersérie"
      ],
      "favorito": "Fase 1 · Dia 3 · Corpo inteiro",
      "minutos": 60,
      "exercicios": [
        {
          "nome": "Supino reto",
          "detalhe": "Barra · Peito",
          "series": 3,
          "min": 10,
          "unidade": "reps",
          "exercicio": "Supino plano com barra"
        },
        {
          "nome": "Remada baixa",
          "detalhe": "Barra · Costas",
          "series": 3,
          "min": 10,
          "unidade": "reps",
          "exercicio": "Remada sentada na polia"
        },
        {
          "nome": "Hip thrust",
          "detalhe": "Glúteos",
          "series": 3,
          "min": 10,
          "unidade": "reps",
          "exercicio": "Hip thrust"
        },
        {
          "nome": "Elevação lateral",
          "detalhe": "Ombros",
          "series": 3,
          "min": 12,
          "max": 15,
          "unidade": "reps",
          "exercicio": "Elevações laterais"
        },
        {
          "nome": "Supersérie",
          "detalhe": "Barra W · Bíceps e tríceps",
          "series": 4,
          "min": 12,
          "unidade": "reps",
          "nota": "A + B seguidos, descanso no fim da volta",
          "nota_tipo": "repetir",
          "superserie": [
            {
              "nome": "Curl de bíceps",
              "exercicio": "Curl com barra EZ"
            },
            {
              "nome": "Tríceps à testa",
              "exercicio": "Tríceps francês"
            }
          ]
        }
      ]
    }
  ],
  "progressao": [
    {
      "fase": 1,
      "estado": "atual",
      "titulo": "Estabilidade e proteção articular",
      "pontos": [
        "Exercícios estáveis",
        "Cadeias cinéticas fechadas e controladas nos membros inferiores"
      ]
    },
    {
      "fase": 2,
      "estado": "proxima",
      "titulo": "Unilateral e mais volume",
      "pontos": [
        "Introduzir trabalho unilateral",
        "Mais volume no tronco",
        "Ver como o corpo reage"
      ]
    },
    {
      "fase": 3,
      "estado": "talvez",
      "titulo": "Condicionamento",
      "pontos": [
        "HIIT na bike e no remo",
        "EMOMs no tronco e linhas"
      ]
    }
  ]
}
$plano$::jsonb)
where user_id = '3b3b6d86-f2e0-41f5-9681-2e3cce7e5724';

-- 2. Os exercícios do plano que não estavam no catálogo dele.
insert into public.exercise_catalog (user_id, name, pattern, knee_safe, notes)
values
  ('3b3b6d86-f2e0-41f5-9681-2e3cce7e5724', 'Pendurar na barra (segundos)', 'puxar-vertical', true, 'Barra fixa, máximo de tempo pendurado (pega e ombros).'),
  ('3b3b6d86-f2e0-41f5-9681-2e3cce7e5724', 'Hollow rock (segundos)', 'core', true, 'Peso corporal; segundos por série.'),
  ('3b3b6d86-f2e0-41f5-9681-2e3cce7e5724', 'Ponte de glúteos isométrica (segundos)', 'bridge', true, 'Isometria; segundos por série.'),
  ('3b3b6d86-f2e0-41f5-9681-2e3cce7e5724', 'Leg press 45°', 'pernas', true, 'Pés altos na plataforma (plano do treinador, fase 1).'),
  ('3b3b6d86-f2e0-41f5-9681-2e3cce7e5724', 'Leg curl', 'isolamento-joelho', true, 'Máquina; 3-5 s a contrair.')
on conflict (user_id, name) do nothing;

-- 3. Os treinos «Fase 1 · Dia N · …» (não duplica: pelo nome, entre os não arquivados).
insert into public.favorites (user_id, kind, name, workout, kcal)
select '3b3b6d86-f2e0-41f5-9681-2e3cce7e5724'::uuid, 'workout', t.name, t.workout, t.kcal
from (
  values
    ('Fase 1 · Dia 1 · Superiores & core', $treino${"type":"strength","minutes":60,"exercises":[{"name":"Pendurar na barra (segundos)","sets":1,"rep_min":0,"rep_max":0,"note":"Máx. tempo"},{"name":"Supino inclinado com halteres","sets":3,"rep_min":8,"rep_max":12},{"name":"Puxada à frente","sets":3,"rep_min":8,"rep_max":12,"note":"No plano: Lat pulldown"},{"name":"Remada com halteres","sets":3,"rep_min":10,"rep_max":10,"note":"No plano: Remada unilateral"},{"name":"Press de ombros na máquina","sets":3,"rep_min":10,"rep_max":10},{"name":"Hollow rock (segundos)","sets":3,"rep_min":20,"rep_max":20}]}$treino$::jsonb, 240),
    ('Fase 1 · Dia 2 · Inferiores', $treino${"type":"strength","minutes":50,"exercises":[{"name":"Isométrico de parede parcial (segundos)","sets":3,"rep_min":60,"rep_max":60,"note":"No plano: Wall sit"},{"name":"Ponte de glúteos isométrica (segundos)","sets":3,"rep_min":30,"rep_max":45},{"name":"Leg press 45°","sets":3,"rep_min":10,"rep_max":12,"note":"Pés altos na plataforma"},{"name":"Leg curl","sets":3,"rep_min":10,"rep_max":12,"note":"3-5 seg. a contrair"},{"name":"Calf raise","sets":4,"rep_min":15,"rep_max":15,"note":"No plano: Gémeos em pé"}]}$treino$::jsonb, 200),
    ('Fase 1 · Dia 3 · Corpo inteiro', $treino${"type":"strength","minutes":60,"exercises":[{"name":"Supino plano com barra","sets":3,"rep_min":10,"rep_max":10,"note":"No plano: Supino reto"},{"name":"Remada sentada na polia","sets":3,"rep_min":10,"rep_max":10,"note":"No plano: Remada baixa"},{"name":"Hip thrust","sets":3,"rep_min":10,"rep_max":10},{"name":"Elevações laterais","sets":3,"rep_min":12,"rep_max":15},{"name":"Curl com barra EZ","sets":4,"rep_min":12,"rep_max":12,"note":"Supersérie A · Curl de bíceps → Tríceps à testa · A + B seguidos, descanso no fim da volta"},{"name":"Tríceps francês","sets":4,"rep_min":12,"rep_max":12,"note":"Supersérie B · Curl de bíceps → Tríceps à testa · A + B seguidos, descanso no fim da volta"}]}$treino$::jsonb, 240)
) as t(name, workout, kcal)
where not exists (
  select 1 from public.favorites f
  where f.user_id = '3b3b6d86-f2e0-41f5-9681-2e3cce7e5724' and f.kind = 'workout' and f.name = t.name and not f.archived
);

-- 4. O último ginásio de 31 out 2026 foi o Dia 1: liga-o ao treino «Fase 1 · Dia 1 · Superiores & core»
--    como «Qual foi? › Dia 1» (favorite_id, o nome do treino, raw.qual_foi e
--    mais um uso do favorito). As kcal ficam (continua ginásio).
with fav as (
  select id, name from public.favorites
  where user_id = '3b3b6d86-f2e0-41f5-9681-2e3cce7e5724' and kind = 'workout' and name = 'Fase 1 · Dia 1 · Superiores & core' and not archived
  order by created_at
  limit 1
), alvo as (
  select w.id from public.workouts w
  where w.user_id = '3b3b6d86-f2e0-41f5-9681-2e3cce7e5724' and w.type = 'strength' and w.date = date '2026-10-31' and w.deleted_at is null
  order by coalesce(w.started_at, w.created_at) desc
  limit 1
), ligado as (
  update public.workouts w
  set favorite_id = fav.id,
      name = fav.name,
      raw = coalesce(w.raw, '{}'::jsonb) || '{"qual_foi": true}'::jsonb
  from fav, alvo
  where w.id = alvo.id and w.favorite_id is distinct from fav.id
  returning w.id
)
update public.favorites f
set use_count = f.use_count + 1, last_used_at = now()
from fav
where f.id = fav.id and exists (select 1 from ligado);

-- 5. Ver: o plano (fase e dias), os 3 treinos e o ginásio de 31 out.
select p.goals -> 'plano_treino' ->> 'fase' as fase,
       jsonb_array_length(p.goals -> 'plano_treino' -> 'dias') as dias,
       (select string_agg(f.name || ' (' || jsonb_array_length(f.workout -> 'exercises') || ' exercícios)', ' · ' order by f.name)
          from public.favorites f
         where f.user_id = p.user_id and f.kind = 'workout' and f.name like 'Fase 1 · Dia %' and not f.archived) as treinos,
       (select string_agg(coalesce(w.name, '(sem nome)') || ' · ' || w.minutes || ' min', ' | ')
          from public.workouts w
         where w.user_id = p.user_id and w.type = 'strength' and w.date = date '2026-10-31' and w.deleted_at is null) as ginasio_31_out
from public.profile p
where p.user_id = '3b3b6d86-f2e0-41f5-9681-2e3cce7e5724';
