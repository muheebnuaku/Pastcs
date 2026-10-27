-- ================================================================
-- MIGRATION: The grade ladder (approved design, 2026-10-27)
-- ================================================================
-- Every student climbs each course from F to A on the University of
-- Ghana scale: F, E, D, D+, C, C+, B, B+, A (stage 0 to 8). Moving up to
-- grade s needs, all at once:
--   * a full bar: 8, 10, 12, 14, 16, 18, 20, 25 counted correct answers
--     while at the grade below (s = 1 … 8);
--   * accuracy over the last 30 counted answers of at least 40 + 5s %
--     (E 45, D 50, D+ 55, C 60, C+ 65, B 70, B+ 75, A 80), from 10+ answers;
--   * coverage: D+ two topics practised (5+ answers each); C and C+ half
--     the topics; B and B+ three quarters at 50%+; A every topic at 60%+
--     and a mock exam at 70%+ in the last 30 days.
-- One grade per saved test, at most two a day. A free course stops at
-- D+ (C needs topics a free course doesn't open). A grade slips (warned)
-- after a session 10+ points under its boundary, is held by 7 of the
-- next 10, and drops one grade only after a second weak session on
-- another day — never within 3 days of a promotion, at most once a week,
-- and never below D once C has been reached.
--
-- Counted answers: quizzes, mock exams and Climb rounds (not battles).
-- Unanswered questions count as wrong in Climb and aren't counted
-- elsewhere. A right answer doesn't count if the same question was
-- answered right in the last 7 days, or wrong in the last day.
--
-- Everything runs in the database: record_test updates the grade in the
-- same step that saves a test. Existing students are placed by replaying
-- their history, capped at D+.
--
-- Safe to run more than once.
-- ================================================================

ALTER TABLE public.tests DROP CONSTRAINT IF EXISTS tests_test_type_check;
ALTER TABLE public.tests ADD CONSTRAINT tests_test_type_check
  CHECK (test_type IN ('practice', 'exam_simulation', 'battle', 'climb'));

CREATE TABLE IF NOT EXISTS public.course_grades (
  user_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id      UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  stage          SMALLINT NOT NULL DEFAULT 0 CHECK (stage BETWEEN 0 AND 8),
  bar            INTEGER NOT NULL DEFAULT 0 CHECK (bar >= 0),
  best_stage     SMALLINT NOT NULL DEFAULT 0 CHECK (best_stage BETWEEN 0 AND 8),
  slipping_since TIMESTAMPTZ,
  promoted_at    TIMESTAMPTZ,
  dropped_at     TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id)
);
ALTER TABLE public.course_grades ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_grades FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.grade_events (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id  UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  test_id    UUID REFERENCES public.tests(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('promote', 'warn', 'clear', 'drop', 'capped')),
  from_stage SMALLINT NOT NULL,
  to_stage   SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_grade_events_user ON public.grade_events(user_id, course_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_grade_events_test ON public.grade_events(test_id);
ALTER TABLE public.grade_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.grade_events FROM anon, authenticated;

INSERT INTO public.achievements (name, description, icon, criteria) VALUES
  ('First C', 'Reach C in any course', 'medal', '{"type":"grade","value":4}'),
  ('Straight A', 'Reach A in any course', 'crown', '{"type":"grade","value":8}'),
  ('Top of the Class', 'Reach A in every course of a semester', 'trophy', '{"type":"grade_all","value":8}')
ON CONFLICT (name) DO NOTHING;

-- ── Rules ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.grade_label(p_stage INTEGER)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT (ARRAY['F', 'E', 'D', 'D+', 'C', 'C+', 'B', 'B+', 'A'])[p_stage + 1];
$$;

-- Correct answers to fill the bar for grade p_stage (1 … 8).
CREATE OR REPLACE FUNCTION public.grade_bar_needed(p_stage INTEGER)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT (ARRAY[8, 10, 12, 14, 16, 18, 20, 25])[p_stage];
$$;

-- The counted answers, oldest first, as of p_upto.
CREATE OR REPLACE FUNCTION public.ladder_answers(p_user UUID, p_course UUID, p_upto TIMESTAMPTZ DEFAULT now())
RETURNS TABLE (answer_id UUID, test_id UUID, at TIMESTAMPTZ, question_id UUID, topic_key TEXT, correct BOOLEAN)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH a AS (
    SELECT ta.id AS aid, t.id AS tid, t.created_at AS ts, ta.question_id AS qid,
           lower(btrim(tp.topic_name)) AS tkey, t.test_type AS ttype,
           (ta.selected_answer IS NULL OR ta.selected_answer = '[]'::jsonb OR ta.selected_answer = '[""]'::jsonb) AS blank,
           ta.is_correct AS raw_ok
    FROM public.test_answers ta
    JOIN public.tests t ON t.id = ta.test_id
    JOIN public.questions q ON q.id = ta.question_id
    LEFT JOIN public.topics tp ON tp.id = q.topic_id
    WHERE t.user_id = p_user AND t.course_id = p_course
      AND t.test_type IN ('practice', 'exam_simulation', 'climb') AND t.created_at <= p_upto
  ), b AS (
    SELECT a.*, (a.raw_ok AND NOT a.blank) AS ok FROM a
  )
  SELECT b.aid, b.tid, b.ts, b.qid, b.tkey, b.ok FROM b
  WHERE NOT (b.blank AND b.ttype <> 'climb')
    AND NOT (b.ok AND EXISTS (
      SELECT 1 FROM b e WHERE e.qid = b.qid AND e.ts < b.ts AND (
        (e.ok AND e.ts > b.ts - interval '7 days')
        OR (NOT e.ok AND NOT e.blank AND e.ts > b.ts - interval '1 day'))))
  ORDER BY b.ts, b.aid;
$$;
REVOKE EXECUTE ON FUNCTION public.ladder_answers(UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- A course's topics that can be practised (5+ approved questions),
-- duplicate topic rows grouped by name.
CREATE OR REPLACE FUNCTION public.ladder_topics(p_course UUID)
RETURNS TABLE (topic_key TEXT, first_order INTEGER)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT lower(btrim(tp.topic_name)), min(coalesce(tp.order_index, 2147483647))::int
  FROM public.topics tp JOIN public.questions q ON q.topic_id = tp.id AND q.is_approved
  WHERE tp.course_id = p_course
  GROUP BY 1 HAVING count(DISTINCT q.id) >= 5;
$$;
REVOKE EXECUTE ON FUNCTION public.ladder_topics(UUID) FROM PUBLIC, anon, authenticated;

-- Accuracy, coverage and the mock exam, as of p_upto.
CREATE OR REPLACE FUNCTION public.ladder_stats(p_user UUID, p_course UUID, p_upto TIMESTAMPTZ DEFAULT now())
RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH la AS (SELECT * FROM public.ladder_answers(p_user, p_course, p_upto)),
  last30 AS (SELECT correct FROM la ORDER BY at DESC, answer_id DESC LIMIT 30),
  per AS (
    SELECT t.topic_key, count(la.answer_id) AS n, avg(la.correct::int) AS acc
    FROM public.ladder_topics(p_course) t LEFT JOIN la ON la.topic_key = t.topic_key
    GROUP BY t.topic_key
  )
  SELECT jsonb_build_object(
    'acc30', (SELECT round(100.0 * avg(correct::int), 1) FROM last30),
    'n30', (SELECT count(*) FROM last30),
    'total', (SELECT count(*) FROM la),
    'topics_total', (SELECT count(*) FROM per),
    'practised', (SELECT count(*) FROM per WHERE n >= 5),
    'at50', (SELECT count(*) FROM per WHERE n >= 5 AND acc >= 0.5),
    'at60', (SELECT count(*) FROM per WHERE n >= 5 AND acc >= 0.6),
    'mock70', EXISTS (SELECT 1 FROM public.tests t WHERE t.user_id = p_user AND t.course_id = p_course
                      AND t.test_type = 'exam_simulation' AND t.percentage >= 70
                      AND t.created_at <= p_upto AND t.created_at > p_upto - interval '30 days')
  );
$$;
REVOKE EXECUTE ON FUNCTION public.ladder_stats(UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- Coverage for grade p_stage: what's needed, and of which kind.
CREATE OR REPLACE FUNCTION public.ladder_coverage(p_stats JSONB, p_stage INTEGER)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_stage <= 2 THEN jsonb_build_object('kind', 'none', 'have', 0, 'need', 0, 'ok', true)
    WHEN p_stage = 3 THEN jsonb_build_object('kind', 'practised', 'have', (p_stats->>'practised')::int,
      'need', least(2, (p_stats->>'topics_total')::int),
      'ok', (p_stats->>'practised')::int >= least(2, (p_stats->>'topics_total')::int))
    WHEN p_stage <= 5 THEN jsonb_build_object('kind', 'practised', 'have', (p_stats->>'practised')::int,
      'need', ceil((p_stats->>'topics_total')::numeric / 2)::int,
      'ok', (p_stats->>'practised')::int >= ceil((p_stats->>'topics_total')::numeric / 2))
    WHEN p_stage <= 7 THEN jsonb_build_object('kind', 'at50', 'have', (p_stats->>'at50')::int,
      'need', ceil((p_stats->>'topics_total')::numeric * 3 / 4)::int,
      'ok', (p_stats->>'at50')::int >= ceil((p_stats->>'topics_total')::numeric * 3 / 4))
    ELSE jsonb_build_object('kind', 'at60', 'have', (p_stats->>'at60')::int,
      'need', (p_stats->>'topics_total')::int, 'mock', (p_stats->>'mock70')::boolean,
      'ok', (p_stats->>'at60')::int >= (p_stats->>'topics_total')::int AND (p_stats->>'mock70')::boolean)
  END;
$$;

-- ── Updating a grade after a saved test ──────────────────────────────
-- p_replay: placing a student from their history (no XP, events or daily
-- limit, no slipping, capped at D+).
CREATE OR REPLACE FUNCTION public.update_course_grade(p_user UUID, p_course UUID, p_test UUID, p_replay BOOLEAN DEFAULT false)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.tests%ROWTYPE;
  g public.course_grades%ROWTYPE;
  upto TIMESTAMPTZ;
  gained INTEGER;
  stats JSONB;
  acc NUMERIC;
  n30 INTEGER;
  nxt INTEGER;
  ok_since INTEGER;
  n_since INTEGER;
  floor_stage INTEGER;
  co public.courses%ROWTYPE;
BEGIN
  SELECT * INTO t FROM public.tests WHERE id = p_test;
  IF t.id IS NULL OR t.test_type NOT IN ('practice', 'exam_simulation', 'climb') THEN RETURN; END IF;
  INSERT INTO public.course_grades (user_id, course_id) VALUES (p_user, p_course) ON CONFLICT DO NOTHING;
  SELECT * INTO g FROM public.course_grades WHERE user_id = p_user AND course_id = p_course FOR UPDATE;
  upto := CASE WHEN p_replay THEN t.created_at ELSE now() END;

  SELECT count(*) FILTER (WHERE correct) INTO gained FROM public.ladder_answers(p_user, p_course, upto) WHERE test_id = p_test;
  -- Placement stops at D+ with an empty bar: C is earned with fresh answers.
  IF p_replay AND g.stage >= 3 THEN gained := 0; END IF;
  IF g.stage < 8 THEN
    g.bar := least(g.bar + gained, public.grade_bar_needed(g.stage + 1));
  END IF;

  stats := public.ladder_stats(p_user, p_course, upto);
  acc := (stats->>'acc30')::numeric;
  n30 := (stats->>'n30')::int;
  nxt := g.stage + 1;

  IF g.stage < 8 AND g.bar >= public.grade_bar_needed(nxt) AND n30 >= 10 AND acc >= 40 + 5 * nxt
     AND (public.ladder_coverage(stats, nxt)->>'ok')::boolean THEN
    IF p_replay AND nxt > 3 THEN
      NULL; -- placement stops at D+
    ELSIF NOT p_replay AND nxt >= 4 AND public.is_free_access(p_user, p_course) THEN
      -- Earned it, but C onwards needs the locked topics: say so, once a day.
      IF NOT EXISTS (SELECT 1 FROM public.grade_events WHERE user_id = p_user AND course_id = p_course
                     AND kind = 'capped' AND created_at::date = CURRENT_DATE) THEN
        INSERT INTO public.grade_events (user_id, course_id, test_id, kind, from_stage, to_stage)
        VALUES (p_user, p_course, p_test, 'capped', g.stage, nxt);
      END IF;
    ELSIF NOT p_replay AND (SELECT count(*) FROM public.grade_events WHERE user_id = p_user AND course_id = p_course
                            AND kind = 'promote' AND created_at::date = CURRENT_DATE) >= 2 THEN
      NULL; -- two promotions a day at most
    ELSE
      g.stage := nxt;
      g.bar := 0;
      g.best_stage := greatest(g.best_stage, nxt);
      g.promoted_at := upto;
      g.slipping_since := NULL;
      IF NOT p_replay THEN
        INSERT INTO public.grade_events (user_id, course_id, test_id, kind, from_stage, to_stage)
        VALUES (p_user, p_course, p_test, 'promote', nxt - 1, nxt);
        UPDATE public.users SET xp = xp + CASE WHEN nxt = 8 THEN 200 ELSE 50 END WHERE id = p_user;
        INSERT INTO public.user_achievements (user_id, achievement_id)
        SELECT p_user, a.id FROM public.achievements a
        WHERE (a.criteria->>'type' = 'grade' AND (a.criteria->>'value')::int <= nxt)
        ON CONFLICT DO NOTHING;
        IF nxt = 8 THEN
          SELECT * INTO co FROM public.courses WHERE id = p_course;
          IF NOT EXISTS (
            SELECT 1 FROM public.courses c2
            JOIN public.course_programs cp ON cp.course_id = c2.id
            JOIN public.users u ON u.id = p_user AND u.program_id = cp.program_id
            WHERE c2.level = co.level AND c2.semester = co.semester AND c2.id <> p_course
              AND NOT EXISTS (SELECT 1 FROM public.course_grades x WHERE x.user_id = p_user AND x.course_id = c2.id AND x.stage = 8)
          ) THEN
            INSERT INTO public.user_achievements (user_id, achievement_id)
            SELECT p_user, a.id FROM public.achievements a WHERE a.criteria->>'type' = 'grade_all'
            ON CONFLICT DO NOTHING;
          END IF;
        END IF;
      END IF;
    END IF;
  ELSIF NOT p_replay AND g.stage >= 1 AND n30 >= 10 THEN
    IF g.slipping_since IS NOT NULL THEN
      SELECT count(*), count(*) FILTER (WHERE correct) INTO n_since, ok_since FROM (
        SELECT correct FROM public.ladder_answers(p_user, p_course, upto)
        WHERE at > g.slipping_since ORDER BY at, answer_id LIMIT 10) s;
      floor_stage := CASE WHEN g.best_stage >= 4 THEN 2 ELSE 0 END;
      IF (n_since >= 10 AND ok_since >= 7) OR acc >= 40 + 5 * g.stage THEN
        INSERT INTO public.grade_events (user_id, course_id, test_id, kind, from_stage, to_stage)
        VALUES (p_user, p_course, p_test, 'clear', g.stage, g.stage);
        g.slipping_since := NULL;
      ELSIF acc <= 40 + 5 * g.stage - 10
        AND g.slipping_since::date < CURRENT_DATE
        AND (g.promoted_at IS NULL OR g.promoted_at < now() - interval '3 days')
        AND (g.dropped_at IS NULL OR g.dropped_at < now() - interval '7 days')
        AND g.stage > floor_stage THEN
        INSERT INTO public.grade_events (user_id, course_id, test_id, kind, from_stage, to_stage)
        VALUES (p_user, p_course, p_test, 'drop', g.stage, g.stage - 1);
        g.bar := ceil(public.grade_bar_needed(g.stage)::numeric / 2)::int;
        g.stage := g.stage - 1;
        g.dropped_at := now();
        g.slipping_since := NULL;
      END IF;
    ELSIF acc <= 40 + 5 * g.stage - 10 THEN
      g.slipping_since := now();
      INSERT INTO public.grade_events (user_id, course_id, test_id, kind, from_stage, to_stage)
      VALUES (p_user, p_course, p_test, 'warn', g.stage, g.stage);
    END IF;
  END IF;

  UPDATE public.course_grades SET stage = g.stage, bar = g.bar, best_stage = g.best_stage,
    slipping_since = g.slipping_since, promoted_at = g.promoted_at, dropped_at = g.dropped_at, updated_at = now()
  WHERE user_id = p_user AND course_id = p_course;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.update_course_grade(UUID, UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- ── Saving a test (as migration 038, plus Climb and the grade) ──────
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
  DELETE FROM pg_temp.submitted;
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

-- ── What students see ────────────────────────────────────────────────
-- The caller's grade in a course and what the next one needs.
CREATE OR REPLACE FUNCTION public.get_course_grade(p_course UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  me UUID := auth.uid();
  g public.course_grades%ROWTYPE;
  stats JSONB;
  nxt INTEGER;
  free BOOLEAN;
  n_since INTEGER := 0;
  ok_since INTEGER := 0;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF coalesce(public.course_access_for(me, p_course), '') NOT IN ('free', 'paid')
     AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = me AND role IN ('admin', 'super_admin')) THEN
    RETURN jsonb_build_object('access', 'locked');
  END IF;
  SELECT * INTO g FROM public.course_grades WHERE user_id = me AND course_id = p_course;
  g.stage := coalesce(g.stage, 0); g.bar := coalesce(g.bar, 0); g.best_stage := coalesce(g.best_stage, 0);
  stats := public.ladder_stats(me, p_course);
  nxt := least(g.stage + 1, 8);
  free := public.is_free_access(me, p_course);
  IF g.slipping_since IS NOT NULL THEN
    SELECT count(*), count(*) FILTER (WHERE correct) INTO n_since, ok_since FROM (
      SELECT correct FROM public.ladder_answers(me, p_course) WHERE at > g.slipping_since ORDER BY at, answer_id LIMIT 10) s;
  END IF;
  RETURN jsonb_build_object(
    'access', 'ok',
    'stage', g.stage, 'label', public.grade_label(g.stage),
    'best', g.best_stage, 'best_label', public.grade_label(g.best_stage),
    'next', CASE WHEN g.stage < 8 THEN nxt END,
    'next_label', CASE WHEN g.stage < 8 THEN public.grade_label(nxt) END,
    'bar', g.bar, 'bar_needed', CASE WHEN g.stage < 8 THEN public.grade_bar_needed(nxt) END,
    'acc30', stats->'acc30', 'n30', stats->'n30',
    'acc_needed', CASE WHEN g.stage < 8 THEN 40 + 5 * nxt END,
    'coverage', CASE WHEN g.stage < 8 THEN public.ladder_coverage(stats, nxt) END,
    'topics_total', stats->'topics_total',
    'free', free,
    'capped', free AND g.stage < 8 AND nxt >= 4,
    'slipping', g.slipping_since IS NOT NULL,
    'hold', CASE WHEN g.slipping_since IS NOT NULL THEN jsonb_build_object('answered', n_since, 'right', ok_since) END
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_course_grade(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_grade(UUID) TO authenticated;

-- Badges for the dashboard: every course the caller has a grade in.
CREATE OR REPLACE FUNCTION public.get_my_course_grades()
RETURNS TABLE (course_id UUID, stage INTEGER, label TEXT, bar INTEGER, bar_needed INTEGER, next_label TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT g.course_id, g.stage::int, public.grade_label(g.stage), g.bar,
         CASE WHEN g.stage < 8 THEN public.grade_bar_needed(g.stage + 1) END,
         CASE WHEN g.stage < 8 THEN public.grade_label(g.stage + 1) END
  FROM public.course_grades g WHERE g.user_id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_course_grades() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_course_grades() TO authenticated;

-- What a saved test did to the caller's grade (results page).
CREATE OR REPLACE FUNCTION public.get_test_grade_outcome(p_test UUID)
RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'kind', e.kind, 'from', e.from_stage, 'to', e.to_stage,
           'from_label', public.grade_label(e.from_stage), 'to_label', public.grade_label(e.to_stage))
         ORDER BY e.created_at), '[]'::jsonb)
  FROM public.grade_events e JOIN public.tests t ON t.id = e.test_id
  WHERE e.test_id = p_test AND t.user_id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.get_test_grade_outcome(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_test_grade_outcome(UUID) TO authenticated;

-- ── Climb rounds ─────────────────────────────────────────────────────
-- 10 questions for the caller's grade: the difficulty mix and topics in
-- the design, open topics only on a free course, nothing they got right
-- in the last 7 days. Difficulty comes from real answer rates once a
-- question has 20+ answers, else from its tag.
CREATE OR REPLACE FUNCTION public.get_climb_round(p_course UUID)
RETURNS SETOF public.questions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE AS $$
DECLARE
  me UUID := auth.uid();
  st INTEGER;
  want_easy INTEGER; want_med INTEGER; want_hard INTEGER;
  free BOOLEAN;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF coalesce(public.course_access_for(me, p_course), '') NOT IN ('free', 'paid')
     AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = me AND role IN ('admin', 'super_admin')) THEN
    RAISE EXCEPTION 'payment_required';
  END IF;
  SELECT coalesce((SELECT stage FROM public.course_grades WHERE user_id = me AND course_id = p_course), 0) INTO st;
  free := public.is_free_access(me, p_course);
  SELECT e, m, h INTO want_easy, want_med, want_hard FROM (VALUES
    (0, 6, 4, 0), (1, 6, 4, 0), (2, 3, 6, 1), (3, 3, 6, 1), (4, 2, 5, 3), (5, 2, 5, 3), (6, 1, 5, 4), (7, 1, 5, 4), (8, 0, 5, 5)
  ) v(s, e, m, h) WHERE v.s = st;

  RETURN QUERY
  WITH la AS (SELECT * FROM public.ladder_answers(me, p_course)),
  tstats AS (
    SELECT t.topic_key, t.first_order, count(la.answer_id) AS n, avg(la.correct::int) AS acc
    FROM public.ladder_topics(p_course) t LEFT JOIN la ON la.topic_key = t.topic_key
    GROUP BY t.topic_key, t.first_order
  ),
  firsts AS (SELECT topic_key FROM tstats ORDER BY first_order, topic_key LIMIT 3),
  weakest AS (SELECT topic_key FROM tstats WHERE n >= 5 ORDER BY acc, topic_key LIMIT 3),
  pool AS (
    SELECT q.id,
      CASE WHEN coalesce(q.times_answered, 0) >= 20 THEN
             CASE WHEN q.times_correct::numeric / q.times_answered > 0.75 THEN 'easy'
                  WHEN q.times_correct::numeric / q.times_answered < 0.45 THEN 'hard' ELSE 'medium' END
           ELSE coalesce(q.difficulty, 'medium') END AS diff,
      CASE
        WHEN st <= 1 THEN lower(btrim(tp.topic_name)) IN (SELECT topic_key FROM firsts)
        WHEN st <= 3 THEN coalesce((SELECT n FROM tstats s WHERE s.topic_key = lower(btrim(tp.topic_name))), 0) < 5
        WHEN st <= 5 THEN lower(btrim(tp.topic_name)) IN (SELECT topic_key FROM weakest)
        WHEN st <= 7 THEN lower(btrim(tp.topic_name)) IN (SELECT topic_key FROM weakest)
                          OR q.id IN (SELECT question_id FROM la WHERE NOT correct)
        ELSE false END AS pref
    FROM public.questions q
    LEFT JOIN public.topics tp ON tp.id = q.topic_id
    WHERE q.course_id = p_course AND q.is_approved
      AND (NOT free OR q.topic_id IN (SELECT public.free_topic_ids(p_course)))
      AND NOT EXISTS (SELECT 1 FROM la WHERE la.question_id = q.id AND la.correct AND la.at > now() - interval '7 days')
  ),
  ranked AS (
    SELECT p.id, p.diff, row_number() OVER (PARTITION BY p.diff ORDER BY random() * CASE WHEN p.pref THEN 0.4 ELSE 1 END) AS rn
    FROM pool p
  ),
  picked AS (
    SELECT r.id FROM ranked r
    ORDER BY (r.rn <= CASE r.diff WHEN 'easy' THEN want_easy WHEN 'hard' THEN want_hard ELSE want_med END) DESC,
             CASE r.diff WHEN 'medium' THEN 0 ELSE 1 END, r.rn
    LIMIT 10
  )
  SELECT q.* FROM public.questions q JOIN picked p ON p.id = q.id ORDER BY random();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_climb_round(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_climb_round(UUID) TO authenticated;

-- ── Streak reminder names the next grade (as migration 041 otherwise) ──
CREATE OR REPLACE FUNCTION public.generate_my_reminders()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me UUID := auth.uid();
  u public.users%ROWTYPE;
  last_test DATE;
  gap INTEGER;
  m INTEGER;
  made INTEGER := 0;
  n INTEGER;
  goal TEXT;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT * INTO u FROM public.users WHERE id = me;
  IF u.id IS NULL OR u.role <> 'student' THEN RETURN 0; END IF;

  IF u.last_practice_date = CURRENT_DATE - 1 AND u.practice_streak >= 2 THEN
    SELECT ' You’re ' || (public.grade_bar_needed(g.stage + 1) - g.bar) || ' correct from '
           || public.grade_label(g.stage + 1) || ' in ' || c.course_code || '.'
      INTO goal
    FROM public.course_grades g JOIN public.courses c ON c.id = g.course_id
    WHERE g.user_id = me AND g.stage < 8 AND g.bar < public.grade_bar_needed(g.stage + 1)
    ORDER BY g.updated_at DESC LIMIT 1;
    INSERT INTO public.notifications (user_id, type, message, link, dedupe_key)
    VALUES (me, 'streak_risk',
            '🔥 Keep your ' || u.practice_streak || '-day streak going: practise today before midnight.' || coalesce(goal, ''),
            '/courses', 'streak_risk:' || CURRENT_DATE)
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; made := made + n;
  ELSIF u.last_practice_date < CURRENT_DATE - 1 AND u.practice_streak > 0 THEN
    IF u.practice_streak >= 3 THEN
      INSERT INTO public.notifications (user_id, type, message, link, dedupe_key)
      VALUES (me, 'streak_lost',
              'Your ' || u.practice_streak || '-day streak ended. One quiz today starts a new one.',
              '/courses', 'streak_lost:' || u.last_practice_date)
      ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
      GET DIAGNOSTICS n = ROW_COUNT; made := made + n;
    END IF;
    UPDATE public.users SET practice_streak = 0 WHERE id = me;
  END IF;

  SELECT max(created_at)::date INTO last_test FROM public.tests WHERE user_id = me;
  IF last_test IS NOT NULL THEN
    gap := CURRENT_DATE - last_test;
    IF gap >= 7 THEN
      INSERT INTO public.notifications (user_id, type, message, link, dedupe_key)
      VALUES (me, 'inactivity',
              CASE WHEN gap > 60
                THEN '📚 It’s been a while since your last quiz. A quick 10-question session gets you back on track.'
                ELSE '📚 It’s been ' || gap || ' days since your last quiz. A quick 10-question session gets you back on track.'
              END,
              '/courses', 'inactivity:' || last_test)
      ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
      GET DIAGNOSTICS n = ROW_COUNT; made := made + n;
    END IF;
  ELSIF u.created_at < now() - interval '2 days' THEN
    INSERT INTO public.notifications (user_id, type, message, link, dedupe_key)
    VALUES (me, 'inactivity', '📚 Try your first quiz: 10 questions, about 5 minutes.', '/courses', 'first_quiz')
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; made := made + n;
  END IF;

  SELECT max(x) INTO m FROM unnest(ARRAY[1, 10, 25, 50, 100]) x WHERE x <= u.total_tests_taken;
  IF m IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, message, link, dedupe_key)
    VALUES (me, 'milestone', CASE m
              WHEN 1 THEN '🎉 You completed your first test. Great start!'
              WHEN 10 THEN '⚡ 10 tests completed. You’re building real momentum.'
              WHEN 25 THEN '🏆 25 tests done. You’re well on your way to exam readiness.'
              WHEN 50 THEN '🔥 50 tests completed. That’s serious commitment.'
              ELSE '👑 100 tests. Exams don’t stand a chance.'
            END,
            '/leaderboard?tab=achievements', 'milestone:' || m)
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; made := made + n;
  END IF;

  RETURN made;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.generate_my_reminders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_my_reminders() TO authenticated;

-- ── Placing existing students ────────────────────────────────────────
-- Replays each student's past tests through the rules above, capped at
-- D+, so regular users don't start back at F but earn C onwards afresh.
-- Students who already have a grade row are left alone.
DO $$
DECLARE r RECORD; t RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT x.user_id, x.course_id FROM public.tests x
    WHERE x.test_type IN ('practice', 'exam_simulation')
      AND NOT EXISTS (SELECT 1 FROM public.course_grades g WHERE g.user_id = x.user_id AND g.course_id = x.course_id)
  LOOP
    FOR t IN SELECT id FROM public.tests
             WHERE user_id = r.user_id AND course_id = r.course_id AND test_type IN ('practice', 'exam_simulation')
             ORDER BY created_at, id
    LOOP
      PERFORM public.update_course_grade(r.user_id, r.course_id, t.id, true);
    END LOOP;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
