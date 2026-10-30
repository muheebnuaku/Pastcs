-- ================================================================
-- MIGRATION: Every rep (and everyone) has a referral code (2026-10-31)
-- ================================================================
-- A referral code is generated at sign-up (migration 004), with a
-- one-time backfill then. An account created some other way, or from
-- before that backfill, can still have none — so a Level Rep made from
-- such an account showed a blank code on their page, in the admin list
-- and on every share link, and their sign-ups couldn't be credited.
--
-- ensure_referral_code() gives an account a code if it has none, and
-- admin_set_level_rep() now calls it, so making someone a rep always
-- gives them a working code. A backfill below covers everyone already in.
--
-- Safe to run more than once.
-- ================================================================

CREATE OR REPLACE FUNCTION public.ensure_referral_code(p_user UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  code TEXT;
  fresh TEXT;
BEGIN
  SELECT referral_code INTO code FROM public.users WHERE id = p_user;
  IF code IS NOT NULL AND btrim(code) <> '' THEN RETURN code; END IF;
  LOOP
    fresh := upper(substring(replace(uuid_generate_v4()::text, '-', ''), 1, 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.users WHERE referral_code = fresh);
  END LOOP;
  UPDATE public.users SET referral_code = fresh WHERE id = p_user;
  RETURN fresh;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ensure_referral_code(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_referral_code(UUID) TO service_role;

-- Backfill anyone still missing a code.
DO $$
DECLARE
  r RECORD;
  fresh TEXT;
BEGIN
  FOR r IN SELECT id FROM public.users WHERE referral_code IS NULL OR btrim(referral_code) = '' LOOP
    LOOP
      fresh := upper(substring(replace(uuid_generate_v4()::text, '-', ''), 1, 8));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.users WHERE referral_code = fresh);
    END LOOP;
    UPDATE public.users SET referral_code = fresh WHERE id = r.id;
  END LOOP;
END;
$$;

-- admin_set_level_rep, now giving the rep a code if they have none.
CREATE OR REPLACE FUNCTION public.admin_set_level_rep(
  p_user UUID, p_program UUID, p_level INTEGER, p_commission NUMERIC, p_discount NUMERIC, p_active BOOLEAN DEFAULT true)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN RAISE EXCEPTION 'no_such_user'; END IF;
  IF p_level NOT IN (100, 200, 300, 400) THEN RAISE EXCEPTION 'bad_level'; END IF;
  IF p_commission IS NULL OR p_commission < 0 OR p_commission > 50
     OR p_discount IS NULL OR p_discount < 0 OR p_discount > 50 THEN RAISE EXCEPTION 'bad_rate'; END IF;
  PERFORM public.ensure_referral_code(p_user);
  INSERT INTO public.level_reps (user_id, program_id, level, commission_pct, discount_pct, active, created_by)
  VALUES (p_user, p_program, p_level, round(p_commission, 2), round(p_discount, 2), coalesce(p_active, true), auth.uid())
  ON CONFLICT (user_id) DO UPDATE SET
    program_id = EXCLUDED.program_id, level = EXCLUDED.level,
    commission_pct = EXCLUDED.commission_pct, discount_pct = EXCLUDED.discount_pct,
    active = EXCLUDED.active, updated_at = now();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_level_rep(UUID, UUID, INTEGER, NUMERIC, NUMERIC, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_level_rep(UUID, UUID, INTEGER, NUMERIC, NUMERIC, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';
