-- G4 (auditoria 2026-11): o token do Atalho do iPhone passa a ter data e a
-- poder ser trocado por pessoa.
--
-- `profile.ingest_token_at`: quando a pessoa gerou o token atual em
-- Definições › Atalho do iPhone. Entra na assinatura do token: «Gerar novo
-- token» muda a data e o token anterior deixa de valer. Vazia (como fica ao
-- correr isto), vale o token de origem, o que já está no Atalho: nada se
-- parte até a pessoa gerar um novo. Quando a primeira conta gera o seu, o
-- segredo da casa (HEALTH_INGEST_TOKEN usado diretamente) deixa de gravar
-- nela.
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro
-- inteiro → Run. Pode correr-se mais do que uma vez. Sem ela tudo funciona
-- como antes (o token de origem, sem «Gerar novo token»).
-- =====================================================================

-- Só o servidor a escreve (ao gerar um token). A app grava o perfil por
-- partes (update só dos campos mudados), nunca a reescreve.
alter table public.profile add column if not exists ingest_token_at timestamptz;

insert into public.schema_version (id, version) values (true, 20261113000061)
on conflict (id) do update
  set version = greatest(public.schema_version.version, excluded.version),
      applied_at = now();
