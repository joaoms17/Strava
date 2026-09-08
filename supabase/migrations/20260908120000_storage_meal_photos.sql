-- Bucket privado para as fotografias de refeições.
-- O caminho de cada objeto começa pelo user_id: <user_id>/<timestamp>.jpg
insert into storage.buckets (id, name, public)
values ('meal-photos', 'meal-photos', false)
on conflict (id) do nothing;

create policy "meal_photos_owner_all"
on storage.objects for all to authenticated
using (
  bucket_id = 'meal-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'meal-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);
