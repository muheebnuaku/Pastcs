-- ================================================================
-- MIGRATION: Referral loop
-- Run this in the Supabase SQL Editor once. Safe to re-run (idempotent).
--
-- Every user gets a shareable referral_code. A new signup can arrive
-- with someone else's code (?ref=CODE on /register, resolved via
-- referred_by), which creates a `referrals` row. The reward — a free
-- pass for both sides, reusing the existing free-pass subscription
-- mechanism — is granted by api/referrals/complete once the referred
-- user completes their first test, not at signup (cheap signup-only
-- abuse resistance).
-- ================================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS referred_by   UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- Unrelated to referrals, but discovered while touching this table:
-- `program` is used throughout the app (profile page, admin, and the
-- student layout's onboarding redirect) but was never actually added
-- to schema.sql — the profile page even has its own error message
-- admitting this. Bundled in here since it's a one-line, zero-risk fix.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS program TEXT;

CREATE INDEX IF NOT EXISTS idx_users_referral_code ON public.users(referral_code);

CREATE TABLE IF NOT EXISTS public.referrals (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referrer_id          UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  referred_id          UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE UNIQUE,
  referred_rewarded_at TIMESTAMP WITH TIME ZONE,
  referrer_rewarded_at TIMESTAMP WITH TIME ZONE,
  created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals(referrer_id);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "referrals_select_own" ON public.referrals;
DROP POLICY IF EXISTS "referrals_admin" ON public.referrals;
CREATE POLICY "referrals_select_own" ON public.referrals FOR SELECT
  USING (auth.uid() = referrer_id OR auth.uid() = referred_id);
CREATE POLICY "referrals_admin" ON public.referrals FOR ALL USING (is_admin());

-- Replaces handle_new_user() to also mint a referral code for every new
-- signup and resolve/record the code they signed up with, if any.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_code   TEXT;
  referrer   UUID;
  ref_input  TEXT;
BEGIN
  LOOP
    new_code := UPPER(SUBSTRING(REPLACE(uuid_generate_v4()::text, '-', ''), 1, 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.users WHERE referral_code = new_code);
  END LOOP;

  ref_input := NEW.raw_user_meta_data->>'referral_code';
  referrer := NULL;
  IF ref_input IS NOT NULL AND TRIM(ref_input) <> '' THEN
    SELECT id INTO referrer FROM public.users WHERE referral_code = UPPER(TRIM(ref_input));
  END IF;

  INSERT INTO public.users (id, email, full_name, role, referral_code, referred_by)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'student'),
    new_code,
    referrer
  )
  ON CONFLICT (id) DO NOTHING;

  IF referrer IS NOT NULL THEN
    INSERT INTO public.referrals (referrer_id, referred_id)
    VALUES (referrer, NEW.id)
    ON CONFLICT (referred_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Existing users predate this trigger — give them a code too.
DO $$
DECLARE
  r RECORD;
  new_code TEXT;
BEGIN
  FOR r IN SELECT id FROM public.users WHERE referral_code IS NULL LOOP
    LOOP
      new_code := UPPER(SUBSTRING(REPLACE(uuid_generate_v4()::text, '-', ''), 1, 8));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.users WHERE referral_code = new_code);
    END LOOP;
    UPDATE public.users SET referral_code = new_code WHERE id = r.id;
  END LOOP;
END $$;
