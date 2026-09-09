-- Bucket público para as fotos dos capítulos (Wikimedia Commons, licença CC,
-- sempre com photo_credit em chapters). Leitura pública; escrita só autenticada.
insert into storage.buckets (id, name, public)
values ('chapter-photos', 'chapter-photos', true)
on conflict (id) do nothing;

create policy "chapter_photos_write"
on storage.objects for all to authenticated
using (bucket_id = 'chapter-photos')
with check (bucket_id = 'chapter-photos');
