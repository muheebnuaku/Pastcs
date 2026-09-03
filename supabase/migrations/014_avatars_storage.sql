-- Profile picture upload/edit/remove. Each student's avatar lives at a
-- single fixed path `<user_id>/avatar` in this bucket (no extension —
-- the actual image type is carried in the object's Content-Type, set at
-- upload time), so re-uploading overwrites the old one instead of
-- accumulating orphaned files.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Avatars are shown to other students too (leaderboard, etc.), so reads
-- are public; writes are restricted to a user's own folder.
drop policy if exists "avatar_public_read" on storage.objects;
create policy "avatar_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatar_insert_own" on storage.objects;
create policy "avatar_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatar_update_own" on storage.objects;
create policy "avatar_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatar_delete_own" on storage.objects;
create policy "avatar_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
