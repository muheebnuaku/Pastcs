-- Two-way messaging between an admin and an individual student. The
-- earlier "Send Message" feature piggybacked on the notifications table
-- (one-way, fire-and-forget) — this replaces its storage with a proper
-- thread the student can actually reply to. `user_id` names which
-- student's thread a row belongs to; `sender_id` is whoever actually
-- wrote it (the student themselves, or an admin) — comparing the two
-- tells you the direction without a separate flag that could drift.
CREATE TABLE IF NOT EXISTS public.admin_messages (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sender_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_messages_user ON public.admin_messages(user_id, created_at);

ALTER TABLE public.admin_messages ENABLE ROW LEVEL SECURITY;

-- Not in schema.sql's central idempotent-drop table list — self-guard
-- each policy the same way semester_end_dates/admin_audit_log do.
DROP POLICY IF EXISTS "admin_messages_select_own" ON public.admin_messages;
CREATE POLICY "admin_messages_select_own" ON public.admin_messages FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "admin_messages_insert_own" ON public.admin_messages;
CREATE POLICY "admin_messages_insert_own" ON public.admin_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id AND auth.uid() = sender_id);

DROP POLICY IF EXISTS "admin_messages_update_own" ON public.admin_messages;
CREATE POLICY "admin_messages_update_own" ON public.admin_messages FOR UPDATE USING (auth.uid() = user_id);

-- Admin reads/writes go through the service-role API route
-- (app/api/admin/messages), which bypasses RLS like free-pass/suspend —
-- no admin-specific policy needed here.
