-- ================================================================
-- MIGRATION: Admin-editable AI Tutor credit pack pricing
-- Run this in the Supabase SQL Editor once. Safe to re-run (idempotent).
--
-- The AI Tutor top-up packs (Starter/Standard/Pro) were hardcoded in
-- TutorPricingModal.tsx and in the payment-verification route — admin
-- could only control per-level course subscription prices
-- (subscription_prices), not these. This gives the tutor packs the
-- same DB-backed pricing subscription_prices already has, just keyed
-- by plan id instead of level, so admin can edit both credits and
-- price per pack from /admin/pricing.
-- ================================================================

CREATE TABLE IF NOT EXISTS public.tutor_credit_plans (
  id         TEXT PRIMARY KEY,           -- 'starter' | 'pack_50' | 'pack_100'
  name       TEXT NOT NULL,
  credits    INTEGER NOT NULL,
  amount     INTEGER NOT NULL,           -- in pesewas (÷ 100 = GHC)
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO public.tutor_credit_plans (id, name, credits, amount) VALUES
  ('starter',  'Starter',  30,  3000),
  ('pack_50',  'Standard', 50,  5000),
  ('pack_100', 'Pro',      100, 10000)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.tutor_credit_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tutor_plans_select" ON public.tutor_credit_plans;
CREATE POLICY "tutor_plans_select" ON public.tutor_credit_plans
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "tutor_plans_admin" ON public.tutor_credit_plans;
CREATE POLICY "tutor_plans_admin" ON public.tutor_credit_plans
  FOR ALL USING (public.is_admin());
