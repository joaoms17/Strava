-- =====================================================================
-- Pedidos de entrega por captura de ecrã: a captura do resumo do pedido
-- (Glovo, Uber Eats, Bolt Food…) passa a uma refeição com todos os pratos.
-- Quando o pedido serve 2 ou mais pessoas e quem regista não disse como o
-- dividiram (sem «Também para …», sem «Comi metade», na porção 1), a
-- refeição fica por rever com a dica «Pedido para 2 · divide em Porção ½ ou
-- partilha a meias», para o jantar dos dois não contar inteiro a uma pessoa.
--
-- order_people: para quantas pessoas é o pedido (2 a 12), enquanto a pessoa
-- não o dividiu. Vazia: não é um pedido, é para uma pessoa ou já se disse
-- como comeram (partilhar ou uma nota limpam-na).
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro
-- inteiro → Run. Pode correr-se mais do que uma vez. No fim aparece uma
-- tabela: tem de vir VAZIA. Sem ela tudo funciona, só não aparece a dica
-- «Pedido para 2» (o pedido é lido na mesma, com os pratos todos).
-- =====================================================================

alter table public.meals add column if not exists order_people smallint;

alter table public.meals drop constraint if exists meals_order_people_check;
alter table public.meals
  add constraint meals_order_people_check check (order_people is null or (order_people >= 2 and order_people <= 12));

-- ---------------------------------------------------------------------
-- Verificação: tem de vir vazia (todas as tabelas públicas com RLS).
-- ---------------------------------------------------------------------
select tablename as "tabela sem RLS (tem de vir vazio)"
from pg_tables
where schemaname = 'public' and not rowsecurity;
