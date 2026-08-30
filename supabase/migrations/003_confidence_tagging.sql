-- ================================================================
-- MIGRATION: Confidence tagging on practice answers
-- Run this in the Supabase SQL Editor once. Safe to re-run (idempotent).
--
-- Backs the "Sure / Not Sure" tap added to the practice page: a
-- correct-but-unsure answer is a near-miss that plain is_correct can't
-- see, and it's now recorded alongside the answer.
-- ================================================================

ALTER TABLE public.test_answers
  ADD COLUMN IF NOT EXISTS confidence TEXT CHECK (confidence IN ('sure','unsure'));
