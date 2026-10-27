-- ================================================================
-- MIGRATION: Leaderboards by course, level and everyone
-- ================================================================
-- The leaderboard page now has three boards: one course, the student's
-- level (their programme's courses at their level and semester), and
-- everyone. Points are correct answers, this week or all time.
--
-- get_leaderboard (schema.sql) ranked every student on the platform and
-- returned full names to anyone who called it, signed in or not. It is
-- replaced by get_leaderboard_board, which:
--   * returns first names only;
--   * leaves out suspended accounts and anyone who has switched off
--     "Show me on leaderboards" (they still see their own position);
--   * always includes the caller's own row, even outside the top N.
--
-- Safe to run more than once.
-- ================================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS leaderboard_visible BOOLEAN NOT NULL DEFAULT true;

-- The old board is no longer used by the app.
REVOKE EXECUTE ON FUNCTION public.get_leaderboard(UUID, INTEGER) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_leaderboard_visible(p_visible BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  UPDATE public.users SET leaderboard_visible = coalesce(p_visible, true) WHERE id = auth.uid();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_leaderboard_visible(BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_leaderboard_visible(BOOLEAN) TO authenticated;

-- p_scope: 'course' (needs p_course), 'level' or 'general'.
-- p_period: 'week' (since Monday) or 'all'.
CREATE OR REPLACE FUNCTION public.get_leaderboard_board(
  p_scope TEXT, p_course UUID DEFAULT NULL, p_period TEXT DEFAULT 'week', p_limit INTEGER DEFAULT 25
)
RETURNS TABLE (rank INTEGER, user_id UUID, first_name TEXT, avatar_url TEXT, points BIGINT, tests BIGINT, accuracy NUMERIC, is_me BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
#variable_conflict use_column
DECLARE
  me UUID := auth.uid();
  u public.users%ROWTYPE;
  since TIMESTAMPTZ;
  lim INTEGER := least(greatest(coalesce(p_limit, 25), 1), 100);
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF p_scope NOT IN ('course', 'level', 'general') THEN RAISE EXCEPTION 'bad_scope'; END IF;
  IF p_scope = 'course' AND NOT EXISTS (SELECT 1 FROM public.courses WHERE id = p_course) THEN RAISE EXCEPTION 'bad_course'; END IF;
  SELECT * INTO u FROM public.users WHERE id = me;
  since := CASE WHEN p_period = 'all' THEN '-infinity'::timestamptz ELSE date_trunc('week', now()) END;

  RETURN QUERY
  WITH scoped AS (
    SELECT t.user_id, t.score, t.total_questions
    FROM public.tests t
    JOIN public.courses co ON co.id = t.course_id
    WHERE t.created_at >= since
      AND CASE p_scope
            WHEN 'course' THEN t.course_id = p_course
            WHEN 'level' THEN co.level = u.selected_level AND co.semester = u.selected_semester
              AND EXISTS (SELECT 1 FROM public.course_programs cp WHERE cp.course_id = co.id AND cp.program_id = u.program_id)
            ELSE true
          END
  ),
  totals AS (
    SELECT s.user_id, sum(s.score)::BIGINT AS points, count(*)::BIGINT AS tests,
           round(sum(s.score)::NUMERIC * 100 / nullif(sum(s.total_questions), 0), 1) AS accuracy
    FROM scoped s
    JOIN public.users x ON x.id = s.user_id
    WHERE x.role = 'student' AND NOT x.is_suspended
      AND (x.leaderboard_visible OR x.id = me)
    GROUP BY s.user_id
  ),
  ranked AS (
    SELECT rank() OVER (ORDER BY t.points DESC, t.accuracy DESC NULLS LAST)::INTEGER AS rnk, t.*
    FROM totals t
  )
  SELECT r.rnk, r.user_id,
         coalesce(nullif(split_part(btrim(x.full_name), ' ', 1), ''), 'Student'),
         x.avatar_url, r.points, r.tests, r.accuracy, r.user_id = me
  FROM ranked r JOIN public.users x ON x.id = r.user_id
  WHERE r.rnk <= lim OR r.user_id = me
  ORDER BY r.rnk, r.user_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_leaderboard_board(TEXT, UUID, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_board(TEXT, UUID, TEXT, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
