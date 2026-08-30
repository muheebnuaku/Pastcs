-- ================================================================
-- MIGRATION: Spaced repetition (review_schedule)
-- Run this in the Supabase SQL Editor once. Safe to re-run (idempotent).
--
-- Light SM-2-style scheduler: one row per (user, question) ever
-- answered. A wrong answer resets the interval to 1 day; a right
-- answer advances it through 1 -> 3 -> 7 -> 14 -> 30 (capped). The
-- "Due for review" practice mode pulls whatever has
-- next_review_at <= today. Fully owned by the student — RLS lets the
-- regular authenticated client read/write its own rows directly.
-- ================================================================

CREATE TABLE IF NOT EXISTS public.review_schedule (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  question_id    UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  interval_days  INTEGER NOT NULL DEFAULT 1,
  next_review_at DATE NOT NULL,
  last_result    BOOLEAN,
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_review_schedule_due ON public.review_schedule(user_id, next_review_at);

ALTER TABLE public.review_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "review_schedule_select_own" ON public.review_schedule;
DROP POLICY IF EXISTS "review_schedule_insert_own" ON public.review_schedule;
DROP POLICY IF EXISTS "review_schedule_update_own" ON public.review_schedule;
CREATE POLICY "review_schedule_select_own" ON public.review_schedule FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "review_schedule_insert_own" ON public.review_schedule FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "review_schedule_update_own" ON public.review_schedule FOR UPDATE USING (auth.uid() = user_id);
