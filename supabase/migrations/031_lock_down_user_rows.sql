-- ================================================================
-- MIGRATION: Lock down user rows + make the free course permanent
-- Run this in the Supabase SQL Editor once. Safe to re-run (idempotent).
--
-- Four holes, all reachable from the browser with the public anon key:
--
-- 1. user_public was a plain view, and a plain view runs with its
--    owner's rights — so RLS on users never applied to it. Supabase
--    grants new views to anon/authenticated, which meant anyone could
--    read every user's email/IP/student ID through it, and update any
--    account (including role) by writing through it.
-- 2. users_update_own let students update every column of their own
--    row: role → super_admin, is_suspended → false, xp, free course…
-- 3. Signup copied `role` from the signup metadata, which the browser
--    controls — `signUp({ options: { data: { role: 'admin' } } })` made
--    an admin. The client-side "create missing profile" path did too.
-- 4. increment_xp / update_practice_streak took any user id (and any
--    XP amount), callable even signed out.
--
-- Plus the free course: changing level/programme used to clear it so
-- another could be picked — one account, unlimited free courses (and
-- free classrooms). It's now a one-time grant: free_course_claimed_at
-- is set the first time, and a student who changes programme keeps
-- their free course but never gets a second one.
-- ================================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS free_course_claimed_at TIMESTAMP WITH TIME ZONE;
UPDATE public.users SET free_course_claimed_at = coalesce(updated_at, created_at, now())
WHERE free_course_code IS NOT NULL AND free_course_claimed_at IS NULL;

-- (1) The view now runs as the caller, so users' own RLS applies:
-- students see their own row, admins see everyone (admins_select_all_users).
-- Recreated anyway to pick up the new column (SELECT * is frozen at
-- create time — see migration 017).
DROP VIEW IF EXISTS public.user_public;
CREATE VIEW public.user_public WITH (security_invoker = true) AS SELECT * FROM public.users;

-- (2) + (3) Students may change only these columns of their own row.
-- Everything else (role, suspension, XP and streak, the free course,
-- referral fields…) changes only through server code: the service role,
-- or SECURITY DEFINER functions, which run as their owner. New columns
-- are protected by default until they're added to this list.
CREATE OR REPLACE FUNCTION public.guard_user_row()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  editable TEXT[] := ARRAY['full_name', 'avatar_url', 'exam_date', 'selected_level', 'selected_semester',
                           'program_id', 'program', 'student_id', 'updated_at'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Nobody is born an admin: promote with an UPDATE from the SQL editor.
    NEW.role := 'student';
    IF current_user IN ('authenticated', 'anon') THEN
      NEW.is_suspended := false;
      NEW.xp := 0;
      NEW.practice_streak := 0;
      NEW.total_tests_taken := 0;
      NEW.last_practice_date := NULL;
      NEW.free_course_code := NULL;
      NEW.free_course_claimed_at := NULL;
      NEW.referred_by := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF current_user IN ('authenticated', 'anon')
     AND (to_jsonb(NEW) - editable) IS DISTINCT FROM (to_jsonb(OLD) - editable) THEN
    RAISE EXCEPTION 'protected_columns' USING HINT = 'Only your name, photo, exam date and course selection can be changed here.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_user_row ON public.users;
CREATE TRIGGER guard_user_row BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_row();

-- (4) Your own XP and streak only. The cap is above the most a single
-- test can earn (10 per correct answer + 50 exam bonus), so normal play
-- is unaffected but one call can't add millions.
CREATE OR REPLACE FUNCTION public.increment_xp(p_user_id UUID, p_amount INTEGER)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF p_amount IS NULL OR p_amount < 0 OR p_amount > 2000 THEN RAISE EXCEPTION 'bad_amount'; END IF;
  UPDATE public.users SET xp = xp + p_amount WHERE id = p_user_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.increment_xp(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_xp(UUID, INTEGER) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_practice_streak(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  last_date      DATE;
  current_streak INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT last_practice_date, practice_streak INTO last_date, current_streak
  FROM public.users WHERE id = p_user_id;
  IF last_date IS NULL OR last_date < CURRENT_DATE - INTERVAL '1 day' THEN
    UPDATE public.users SET practice_streak = 1, last_practice_date = CURRENT_DATE WHERE id = p_user_id;
  ELSIF last_date = CURRENT_DATE - INTERVAL '1 day' THEN
    UPDATE public.users SET practice_streak = current_streak + 1, last_practice_date = CURRENT_DATE WHERE id = p_user_id;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.update_practice_streak(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_practice_streak(UUID) TO authenticated, service_role;

-- ── Permanent free course in the classroom rules (migration 030) ──────
-- available_free only for a student who has never claimed one.
CREATE OR REPLACE FUNCTION public.course_access_for(p_user UUID, p_course UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  u  public.users%ROWTYPE;
  co public.courses%ROWTYPE;
BEGIN
  SELECT * INTO u FROM public.users WHERE id = p_user;
  SELECT * INTO co FROM public.courses WHERE id = p_course;
  IF u.id IS NULL OR co.id IS NULL THEN RETURN 'payment_required'; END IF;

  IF u.free_course_code IS NOT NULL AND upper(u.free_course_code) = upper(co.course_code) THEN
    RETURN 'free';
  END IF;

  IF u.program_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.course_programs cp WHERE cp.course_id = co.id AND cp.program_id = u.program_id
  ) THEN
    RETURN 'wrong_program';
  END IF;

  IF u.program_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.subscriptions s
    LEFT JOIN public.semester_end_dates t ON t.program_id = s.program_id AND t.semester = s.semester
    WHERE s.user_id = p_user
      AND s.status = 'active'
      AND s.level = co.level
      AND s.semester = co.semester
      AND s.program_id = u.program_id
      AND (t.id IS NULL OR (
        now() < ((t.end_date + t.grace_days + 1)::timestamp AT TIME ZONE 'UTC')
        AND (t.start_date IS NULL OR s.paid_at IS NULL OR s.paid_at >= (t.start_date::timestamp AT TIME ZONE 'UTC'))
      ))
  ) THEN
    RETURN 'paid';
  END IF;

  IF u.free_course_code IS NULL AND u.free_course_claimed_at IS NULL THEN RETURN 'available_free'; END IF;
  RETURN 'payment_required';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.course_access_for(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_free_course(p_user UUID, p_course UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.users u SET
    selected_level         = coalesce(u.selected_level, co.level),
    selected_semester      = coalesce(u.selected_semester, co.semester),
    program_id             = coalesce(u.program_id, (SELECT cp.program_id FROM public.course_programs cp WHERE cp.course_id = co.id LIMIT 1)),
    free_course_code       = co.course_code,
    free_course_claimed_at = now()
  FROM public.courses co
  WHERE u.id = p_user AND co.id = p_course
    AND u.free_course_code IS NULL AND u.free_course_claimed_at IS NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_free_course(UUID, UUID) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
