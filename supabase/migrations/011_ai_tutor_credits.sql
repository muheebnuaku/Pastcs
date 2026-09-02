-- ================================================================
-- MIGRATION: Create the ai_tutor_credits table
-- Run this in the Supabase SQL Editor once. Safe to re-run (idempotent).
--
-- Referenced by app/api/payments/tutor-credits/route.ts (inserts a row
-- once Paystack confirms a top-up) and by the AI Tutor page's upload
-- counter (reads a student's own purchased credits) — but it was never
-- actually created by any migration or schema.sql. Without it, an
-- actual AI Tutor credit purchase would fail at the save-credits step
-- after the student has already paid.
-- ================================================================

CREATE TABLE IF NOT EXISTS public.ai_tutor_credits (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  plan              TEXT NOT NULL,
  amount_paid       INTEGER NOT NULL, -- pesewas, what Paystack actually confirmed
  total_credits     INTEGER NOT NULL,
  payment_reference TEXT NOT NULL UNIQUE,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_tutor_credits_user ON public.ai_tutor_credits(user_id);

ALTER TABLE public.ai_tutor_credits ENABLE ROW LEVEL SECURITY;

-- Rows are only ever written by the service-role client in
-- api/payments/tutor-credits/route.ts (which bypasses RLS after
-- verifying payment with Paystack) — a student only needs to read
-- their own purchased-credit total back.
DROP POLICY IF EXISTS "ai_tutor_credits_select_own" ON public.ai_tutor_credits;
CREATE POLICY "ai_tutor_credits_select_own" ON public.ai_tutor_credits
  FOR SELECT USING (auth.uid() = user_id);
