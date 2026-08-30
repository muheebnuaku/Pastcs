-- ================================================================
-- MIGRATION: Notifications, feature events, scenario-question tagging
-- Run this in the Supabase SQL Editor once. Safe to re-run (idempotent).
--
-- Backs three things already live in app code:
--  - lib/hooks/useNotifications.ts reads/writes `notifications` — without
--    this table, streak-risk/inactivity/milestone nudges silently no-op.
--  - app/api/track/route.ts writes `feature_events` — without this table,
--    analytics events silently no-op (the route catches and swallows it).
--  - The AI question generator tags questions `is_scenario`, but nothing
--    persisted it until now.
-- ================================================================

-- ----------------------------------------------------------------
-- 1. Notifications table
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  message    TEXT NOT NULL,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_delete_own" ON public.notifications;

CREATE POLICY "notifications_select_own" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "notifications_insert_own" ON public.notifications FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "notifications_update_own" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "notifications_delete_own" ON public.notifications FOR DELETE USING (auth.uid() = user_id);

-- ----------------------------------------------------------------
-- 2. Feature events table (written only via the service-role client
--    in api/track/route.ts, which bypasses RLS — the policy below
--    just lets admins review the raw event log)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.feature_events (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  event      TEXT NOT NULL,
  metadata   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feature_events_user  ON public.feature_events(user_id);
CREATE INDEX IF NOT EXISTS idx_feature_events_event ON public.feature_events(event);

ALTER TABLE public.feature_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feature_events_admin_select" ON public.feature_events;
CREATE POLICY "feature_events_admin_select" ON public.feature_events FOR SELECT USING (is_admin());

-- ----------------------------------------------------------------
-- 3. Scenario-style tagging on questions
-- ----------------------------------------------------------------
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS is_scenario BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_questions_scenario ON public.questions(course_id, is_scenario);
