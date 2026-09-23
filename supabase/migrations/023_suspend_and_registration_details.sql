-- Three related additions:
-- 1. is_suspended — an admin-set flag. A suspended account is treated as
--    "not found" at login (deliberately vague — never confirms to
--    whoever's logging in that this specific account was flagged, which
--    would just tell a bad actor to go make another one).
-- 2. registration_ip — captured once at signup, so an admin can spot
--    several accounts registered from the same IP (the "one free course
--    per fake account" pattern reported).
-- 3. handle_new_user() now also accepts student_id, program_id, and
--    registration_ip from signup metadata — the registration form can
--    collect these directly instead of a separate post-signup step.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_suspended    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS registration_ip TEXT;

-- user_public is `SELECT * FROM users` — its column list froze at CREATE
-- time, so the two new columns above need the view recreated to actually
-- appear in it (same gotcha migration 017 hit for program_id).
DROP VIEW IF EXISTS public.user_public;
CREATE VIEW public.user_public AS SELECT * FROM public.users;
NOTIFY pgrst, 'reload schema';

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

  INSERT INTO public.users (
    id, email, full_name, role, referral_code, referred_by,
    student_id, program_id, program, registration_ip
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'student'),
    new_code,
    referrer,
    NEW.raw_user_meta_data->>'student_id',
    NULLIF(NEW.raw_user_meta_data->>'program_id', '')::UUID,
    NEW.raw_user_meta_data->>'program',
    NEW.raw_user_meta_data->>'registration_ip'
  )
  ON CONFLICT (id) DO NOTHING;

  IF referrer IS NOT NULL THEN
    INSERT INTO public.referrals (referrer_id, referred_id)
    VALUES (referrer, NEW.id)
    ON CONFLICT (referred_id) DO NOTHING;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Referral bookkeeping (and the new optional fields above) are a
  -- nice-to-have; account creation is not. Log the real reason (visible
  -- in Postgres Logs) and fall back to exactly the minimal insert so
  -- signup always succeeds even if e.g. program_id doesn't parse as a UUID.
  RAISE WARNING 'handle_new_user: extended insert failed (%), falling back to minimal insert', SQLERRM;
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
