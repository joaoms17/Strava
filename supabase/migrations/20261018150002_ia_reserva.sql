-- =====================================================================
-- Foto lida pelo modelo de reserva da IA: com o Gemini, quando o modelo
-- das fotos esgota o limite gratuito do dia, a foto é lida pelo do texto,
-- que acerta menos nas porções. Fica marcado na refeição para a folha dizer
-- porquê e oferecer «Analisar outra vez».
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro
-- inteiro → Run. Pode correr-se mais do que uma vez. No fim aparece uma
-- tabela: tem de vir VAZIA. Sem ela tudo funciona, só não aparece o aviso.
-- =====================================================================

alter table public.meals add column if not exists model_reserve boolean not null default false;

-- ---------------------------------------------------------------------
-- Verificação: tem de vir vazia (todas as tabelas públicas com RLS).
-- ---------------------------------------------------------------------
select tablename as "tabela sem RLS (tem de vir vazio)"
from pg_tables
where schemaname = 'public' and not rowsecurity;
