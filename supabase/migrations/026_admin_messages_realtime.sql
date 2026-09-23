-- Two follow-ups to admin_messages (025):
--
-- 1. Admins need to read a student's thread through the plain client,
--    not just the service-role API route — a live realtime subscription
--    authorizes itself under RLS just like any other client query, and
--    the existing self-only policy only lets a *student* see their own
--    thread, not an admin looking at someone else's.
DROP POLICY IF EXISTS "admin_messages_admin_select" ON public.admin_messages;
CREATE POLICY "admin_messages_admin_select" ON public.admin_messages FOR SELECT USING (is_admin());

-- 2. Without this, a message sent while the other side has the page/
--    modal open doesn't show up until they navigate away and back —
--    both the student's Messages page and the admin's thread view
--    subscribe to postgres_changes on this table.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'admin_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_messages;
  END IF;
END $$;
