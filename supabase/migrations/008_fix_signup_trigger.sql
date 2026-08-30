-- ================================================================
-- HOTFIX: signup broken — "Database error creating new user"
-- Run this in the Supabase SQL Editor IMMEDIATELY. Safe to re-run.
--
-- handle_new_user() (added in 004_referral_loop.sql) had no exception
-- handling: any failure anywhere in the referral-code minting/lookup
-- logic aborts the whole trigger, which rolls back the entire signup
-- transaction — exactly the "Database error creating new user" being
-- reported. This wraps the whole function body so a referral-logic
-- failure can never block account creation again: on any error it
-- falls back to the original pre-referral behavior (just create the
-- minimal profile row) instead of blocking the signup.
--
-- If this doesn't fully explain it, check Supabase Dashboard -> Logs ->
-- Postgres Logs right after a failed signup for the RAISE WARNING this
-- adds ("handle_new_user: referral logic failed...") — it names the
-- exact underlying error.
-- ================================================================

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
EXCEPTION WHEN OTHERS THEN
  -- Referral bookkeeping is a nice-to-have; account creation is not.
  -- Log the real reason (visible in Postgres Logs) and fall back to
  -- exactly the pre-referral insert so signup always succeeds.
  RAISE WARNING 'handle_new_user: referral logic failed (%), falling back to minimal insert', SQLERRM;
  INSERT INTO public.users (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'student')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
