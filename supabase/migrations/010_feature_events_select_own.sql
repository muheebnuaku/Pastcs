-- ================================================================
-- MIGRATION: Let a user read their own feature_events rows
-- Run this in the Supabase SQL Editor once. Safe to re-run (idempotent).
--
-- feature_events only had an admin-only SELECT policy — reasonable
-- when it was purely an admin activity log (rows are written via the
-- service-role client in api/track/route.ts, which bypasses RLS
-- either way). But the AI Tutor page's upload counter
-- (app/(student)/assistant/page.tsx's loadUploadCount) reads this
-- table with the normal RLS-scoped client to count a student's own
-- 'document_upload' events — with no matching SELECT policy, that
-- query silently returned zero rows for every non-admin, so the
-- upload count never advanced past 0 no matter how many documents
-- they'd actually uploaded, and the free-tier limit never kicked in.
-- ================================================================

DROP POLICY IF EXISTS "feature_events_select_own" ON public.feature_events;
CREATE POLICY "feature_events_select_own" ON public.feature_events
  FOR SELECT USING (auth.uid() = user_id);
