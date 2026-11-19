-- ================================================================
-- MIGRATION: Fix "Could not save your results" (2026-11-19)
-- ================================================================
-- Practice and exam saves were failing with
--   ERROR 21000: DELETE requires a WHERE clause
-- Supabase guards API requests against DELETE/UPDATE with no WHERE
-- (pg_safeupdate). record_test clears its scratch table of submitted
-- answers with "DELETE FROM pg_temp.submitted;", which the guard
-- refuses, so the whole save failed. It now says "WHERE true". Nothing
-- else in the function changes (this is migration 042's record_test).
--
-- Safe to run more than once.
-- ================================================================

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
  IF p_type NOT IN ('practice', 'exam_simulation', 'climb') THEN RAISE EXCEPTION 'bad_type'; END IF;
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
  DELETE FROM pg_temp.submitted WHERE true;
  INSERT INTO pg_temp.submitted (question_id, selected, confidence)
  SELECT (e->>'question_id')::uuid,
         CASE WHEN jsonb_typeof(e->'selected') = 'array' AND jsonb_array_length(e->'selected') <= 10
              THEN e->'selected' ELSE '[]'::jsonb END,
         CASE WHEN e->>'confidence' IN ('sure', 'unsure') THEN e->>'confidence' END
  FROM jsonb_array_elements(p_answers) e;

  SELECT count(DISTINCT s.question_id) INTO matched
  FROM pg_temp.submitted s
  JOIN public.questions q ON q.id = s.question_id AND q.course_id = p_course AND q.is_approved;
  IF matched <> n THEN RAISE EXCEPTION 'bad_questions'; END IF;

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
  PERFORM public.update_course_grade(p_user, p_course, new_id);

  RETURN QUERY SELECT new_id, got, n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_test(UUID, UUID, UUID, TEXT, JSONB, INTEGER, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_test(UUID, UUID, UUID, TEXT, JSONB, INTEGER, UUID[]) TO service_role;

NOTIFY pgrst, 'reload schema';
