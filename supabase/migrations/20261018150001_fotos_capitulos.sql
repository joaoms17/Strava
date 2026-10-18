-- =====================================================================
-- Fotos dos capítulos (Arquivo): o bucket é público para ler, mas qualquer
-- conta com sessão podia escrever ou apagar qualquer ficheiro (agora há
-- várias pessoas). Passa a ser como as fotos das refeições: cada pessoa só
-- escreve na sua pasta (<user_id>/...). A leitura pública não muda e o
-- servidor (service role) continua a poder tudo.
--
-- COMO CORRER: Supabase → SQL Editor → New query → colar este ficheiro
-- inteiro → Run. Pode correr-se mais do que uma vez. No fim aparece uma
-- tabela: tem de vir VAZIA.
-- =====================================================================

drop policy if exists "chapter_photos_write" on storage.objects;
create policy "chapter_photos_write"
on storage.objects for all to authenticated
using (
  bucket_id = 'chapter-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'chapter-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- ---------------------------------------------------------------------
-- Verificação: tem de vir vazia (todas as tabelas públicas com RLS).
-- ---------------------------------------------------------------------
select tablename as "tabela sem RLS (tem de vir vazio)"
from pg_tables
where schemaname = 'public' and not rowsecurity;
