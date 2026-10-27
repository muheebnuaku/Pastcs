-- ================================================================
-- MIGRATION: Free-course limits
-- ================================================================
-- A student on free access to a course (it's their free course and they
-- haven't paid for its level) now gets only its first 2 topics. The rest
-- are locked until they unlock the level.
--
-- 1. is_free_access(user, course): the one definition every limit uses.
--    Paying wins over the free course: a student who has paid for the
--    level is never on free access, even in their free course.
-- 2. free_topic_ids(course): the open topics — every row of the first 2
--    distinct topic names by order_index (the course page groups
--    duplicate topic rows by name, so this matches what students see).
-- 3. Questions: until now any signed-in student could read every approved
--    question in every course straight from the table. Now a question is
--    readable only in a course you've paid for, in an open topic of your
--    free course, or if you've already answered it (so old results still
--    show). Admins keep full access through questions_admin.
-- 4. record_test refuses answers to locked questions ('topic_locked').
-- 5. get_course_access(course) tells the course and practice pages what
--    is open.
--
-- Safe to run more than once.
-- ================================================================

-- ── 1. Who is on free access ─────────────────────────────────────────

-- Has this student paid for this course's level (in their programme, for
-- the current term)? Same subscription rule as course_access_for, which
-- returns 'free' before checking payment and so can't answer this.
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
        AND (t.start_date IS NULL OR s.paid_at IS NULL OR s.paid_at >= (t.start_date::timestamp AT TIME ZONE 'UTC'))
      ))
  );
$$;
REVOKE EXECUTE ON FUNCTION public.course_paid_for(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_free_access(p_user UUID, p_course UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u JOIN public.courses co ON co.id = p_course
    WHERE u.id = p_user
      AND u.role NOT IN ('admin', 'super_admin')
      AND u.free_course_code IS NOT NULL
      AND upper(u.free_course_code) = upper(co.course_code)
  ) AND NOT public.course_paid_for(p_user, p_course);
$$;
REVOKE EXECUTE ON FUNCTION public.is_free_access(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ── 2. The open topics ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.free_topic_ids(p_course UUID)
RETURNS SETOF UUID
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH names AS (
    SELECT lower(btrim(topic_name)) AS k, min(coalesce(order_index, 2147483647)) AS ord
    FROM public.topics WHERE course_id = p_course
    GROUP BY 1
    ORDER BY 2, 1
    LIMIT 2
  )
  SELECT t.id FROM public.topics t JOIN names n ON n.k = lower(btrim(t.topic_name))
  WHERE t.course_id = p_course;
$$;
REVOKE EXECUTE ON FUNCTION public.free_topic_ids(UUID) FROM PUBLIC, anon, authenticated;

-- ── 3. Who can read which questions ──────────────────────────────────
-- Uncorrelated set functions, so the policy below works each set out once
-- per query rather than once per question row.

-- Courses the caller has paid for (only their programme can be paid for).
CREATE OR REPLACE FUNCTION public.my_paid_course_ids()
RETURNS SETOF UUID
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT cp.course_id FROM public.course_programs cp
  JOIN public.users u ON u.id = auth.uid() AND u.program_id = cp.program_id
  WHERE public.course_paid_for(auth.uid(), cp.course_id);
$$;
REVOKE EXECUTE ON FUNCTION public.my_paid_course_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_paid_course_ids() TO authenticated;

-- The open topics of the caller's free course, if they're on free access
-- to it. (Paid for it: the whole course is in my_paid_course_ids.)
CREATE OR REPLACE FUNCTION public.my_free_topic_ids()
RETURNS SETOF UUID
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT f.id
  FROM public.users u
  JOIN public.courses co ON upper(co.course_code) = upper(u.free_course_code)
  CROSS JOIN LATERAL public.free_topic_ids(co.id) AS f(id)
  WHERE u.id = auth.uid() AND public.is_free_access(u.id, co.id);
$$;
REVOKE EXECUTE ON FUNCTION public.my_free_topic_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_free_topic_ids() TO authenticated;

-- Questions the caller has already answered: their results pages keep
-- working after a topic locks, and nothing new is revealed.
CREATE OR REPLACE FUNCTION public.my_answered_question_ids()
RETURNS SETOF UUID
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT DISTINCT a.question_id FROM public.test_answers a
  JOIN public.tests t ON t.id = a.test_id
  WHERE t.user_id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.my_answered_question_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_answered_question_ids() TO authenticated;

DROP POLICY IF EXISTS "questions_select_approved" ON public.questions;
DROP POLICY IF EXISTS "questions_select_open" ON public.questions;
CREATE POLICY "questions_select_open" ON public.questions FOR SELECT TO authenticated USING (
  is_approved AND (
    course_id IN (SELECT public.my_paid_course_ids())
    OR topic_id IN (SELECT public.my_free_topic_ids())
    OR id IN (SELECT public.my_answered_question_ids())
  )
);

-- ── 4. Saving a test ─────────────────────────────────────────────────
-- As in migration 034, plus: on free access, every question must be in
-- an open topic.
CREATE OR REPLACE FUNCTION public.record_test(
  p_user UUID, p_course UUID, p_topic UUID, p_type TEXT, p_answers JSONB,
  p_time_taken INTEGER DEFAULT NULL, p_fill_ok UUID[] DEFAULT '{}'
)
RETURNS TABLE (test_id UUID, score INTEGER, total INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  n INTEGER;
  matched INTEGER;
  got INTEGER;
  new_id UUID;
  pct NUMERIC;
  topic UUID := p_topic;
BEGIN
  IF p_type NOT IN ('practice', 'exam_simulation') THEN RAISE EXCEPTION 'bad_type'; END IF;
  IF coalesce(public.course_access_for(p_user, p_course), '') NOT IN ('free', 'paid')
     AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user AND role IN ('admin', 'super_admin')) THEN
    RAISE EXCEPTION 'payment_required';
  END IF;
  IF jsonb_typeof(p_answers) <> 'array' THEN RAISE EXCEPTION 'bad_answers'; END IF;
  n := jsonb_array_length(p_answers);
  IF n < 1 OR n > 100 THEN RAISE EXCEPTION 'bad_answers'; END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.submitted (
    question_id UUID, selected JSONB, confidence TEXT, is_correct BOOLEAN
  ) ON COMMIT DROP;
  DELETE FROM pg_temp.submitted;
  INSERT INTO pg_temp.submitted (question_id, selected, confidence)
  SELECT (e->>'question_id')::uuid,
         CASE WHEN jsonb_typeof(e->'selected') = 'array' AND jsonb_array_length(e->'selected') <= 10
              THEN e->'selected' ELSE '[]'::jsonb END,
         CASE WHEN e->>'confidence' IN ('sure', 'unsure') THEN e->>'confidence' END
  FROM jsonb_array_elements(p_answers) e;

  -- Every question once, approved, and from this course.
  SELECT count(DISTINCT s.question_id) INTO matched
  FROM pg_temp.submitted s
  JOIN public.questions q ON q.id = s.question_id AND q.course_id = p_course AND q.is_approved;
  IF matched <> n THEN RAISE EXCEPTION 'bad_questions'; END IF;

  -- Free access: only the open topics count.
  IF public.is_free_access(p_user, p_course) AND EXISTS (
    SELECT 1 FROM pg_temp.submitted s JOIN public.questions q ON q.id = s.question_id
    WHERE q.topic_id IS NULL OR q.topic_id NOT IN (SELECT public.free_topic_ids(p_course))
  ) THEN
    RAISE EXCEPTION 'topic_locked';
  END IF;

  UPDATE pg_temp.submitted s SET is_correct = CASE
      WHEN q.question_type = 'fill_in_blank' THEN
        q.id = ANY (coalesce(p_fill_ok, '{}'))
        OR (public.norm_answer(s.selected->>0) <> '' AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(q.correct_answers) ca
          WHERE public.norm_answer(ca) = public.norm_answer(s.selected->>0)))
      ELSE public.options_match(s.selected, q.correct_answers)
    END
  FROM public.questions q WHERE q.id = s.question_id;

  SELECT count(*) FILTER (WHERE s.is_correct) INTO got FROM pg_temp.submitted s;
  pct := round(got::NUMERIC * 100 / n, 2);
  -- A deleted topic shouldn't fail the save.
  IF topic IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.topics t WHERE t.id = topic AND t.course_id = p_course) THEN
    topic := NULL;
  END IF;

  INSERT INTO public.tests (user_id, course_id, topic_id, test_type, score, total_questions, percentage, time_taken, completed_at)
  VALUES (p_user, p_course, topic, p_type, got, n, pct,
          CASE WHEN p_time_taken BETWEEN 0 AND 86400 THEN p_time_taken END, now())
  RETURNING id INTO new_id;

  INSERT INTO public.test_answers (test_id, question_id, selected_answer, is_correct, confidence)
  SELECT new_id, s.question_id, s.selected, s.is_correct, s.confidence FROM pg_temp.submitted s;

  PERFORM public.apply_test_rewards(p_user, got * 10 + CASE WHEN p_type = 'exam_simulation' AND pct >= 70 THEN 50 ELSE 0 END);

  RETURN QUERY SELECT new_id, got, n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_test(UUID, UUID, UUID, TEXT, JSONB, INTEGER, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_test(UUID, UUID, UUID, TEXT, JSONB, INTEGER, UUID[]) TO service_role;

-- ── 5. What the pages show ───────────────────────────────────────────
-- {access: 'full' | 'free' | 'locked', open_topic_ids: [...]}
-- 'full': paid (or admin); 'free': free access, only open_topic_ids;
-- 'locked': neither.
CREATE OR REPLACE FUNCTION public.get_course_access(p_course UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id = uid AND role IN ('admin', 'super_admin'))
     OR public.course_paid_for(uid, p_course) THEN
    RETURN jsonb_build_object('access', 'full', 'open_topic_ids', '[]'::jsonb);
  END IF;
  IF public.is_free_access(uid, p_course) THEN
    RETURN jsonb_build_object('access', 'free',
      'open_topic_ids', coalesce((SELECT jsonb_agg(id) FROM public.free_topic_ids(p_course) AS f(id)), '[]'::jsonb));
  END IF;
  RETURN jsonb_build_object('access', 'locked', 'open_topic_ids', '[]'::jsonb);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_course_access(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_access(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
