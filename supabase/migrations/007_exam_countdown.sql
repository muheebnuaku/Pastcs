-- ================================================================
-- MIGRATION: Exam-date countdown & study plan
-- Run this in the Supabase SQL Editor once. Safe to re-run (idempotent).
--
-- Powers a dashboard widget: once a student sets their exam date, it
-- shows a day countdown plus a short focus list drawn from the
-- already-existing get_weak_topics() RPC — no new backend logic
-- needed for the "plan" half, just a date to count down to.
-- ================================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS exam_date DATE;
