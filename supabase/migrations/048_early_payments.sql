-- ================================================================
-- MIGRATION: Paying (or getting a pass) before the semester starts
-- (2026-10-30)
-- ================================================================
-- A payment made before a term's start_date was treated as belonging to
-- the previous cycle (so last year's Semester 1 payment can't open this
-- year's). But a student who paid, or was given a free pass, in the
-- weeks before Semester 1 started was locked out too: charged, and
-- still shown "Unlock".
--
-- A payment now counts for a term if it was made no earlier than 120
-- days before the term starts. Last cycle's payments are still shut out
-- (they're months older than that); early payers get in straight away.
-- The same window is used by lib/subscriptionAccess.ts.
--
-- Safe to run more than once.
-- ================================================================

CREATE OR REPLACE FUNCTION public.paid_in_term(p_paid_at TIMESTAMP WITH TIME ZONE, p_start DATE)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_start IS NULL OR p_paid_at IS NULL
      OR p_paid_at >= ((p_start - 120)::timestamp AT TIME ZONE 'UTC');
$$;
REVOKE EXECUTE ON FUNCTION public.paid_in_term(TIMESTAMP WITH TIME ZONE, DATE) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.course_paid_for(p_user UUID, p_course UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.courses co ON co.id = p_course
    JOIN public.course_programs cp ON cp.course_id = co.id AND cp.program_id = u.program_id
    JOIN public.subscriptions s ON s.user_id = u.id AND s.status = 'active'
      AND s.level = co.level AND s.semester = co.semester AND s.program_id = u.program_id
    LEFT JOIN public.semester_end_dates t ON t.program_id = s.program_id AND t.semester = s.semester
    WHERE u.id = p_user
      AND (t.id IS NULL OR (
        now() < ((t.end_date + t.grace_days + 1)::timestamp AT TIME ZONE 'UTC')
        AND public.paid_in_term(s.paid_at, t.start_date)
      ))
  );
$$;
REVOKE EXECUTE ON FUNCTION public.course_paid_for(UUID, UUID) FROM PUBLIC, anon, authenticated;

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
        AND public.paid_in_term(s.paid_at, t.start_date)
      ))
  ) THEN
    RETURN 'paid';
  END IF;

  IF u.free_course_code IS NULL AND u.free_course_claimed_at IS NULL THEN RETURN 'available_free'; END IF;
  RETURN 'payment_required';
END;
$$;

NOTIFY pgrst, 'reload schema';
