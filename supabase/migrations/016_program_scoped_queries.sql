-- ================================================================
-- MIGRATION: Multi-program support (Phase 2 — read paths)
-- Run this in the Supabase SQL Editor once. Safe to re-run (idempotent).
--
-- get_weak_topics() already scopes to the student's current
-- selected_level/selected_semester (migration 012) — this adds the
-- same treatment for program, so a student who switches programs
-- (or a course that gets reassigned between programs) doesn't surface
-- weak topics from a course outside their current program. Everyone
-- migrated so far is on BSc IT with every course assigned to it, so
-- this changes nothing visible yet — it only matters once a second
-- program exists.
-- ================================================================

CREATE OR REPLACE FUNCTION public.get_weak_topics(p_user_id UUID, p_limit INTEGER DEFAULT 5)
RETURNS TABLE (topic_id UUID, topic_name TEXT, course_code TEXT, total_questions INTEGER, correct_answers INTEGER, accuracy DECIMAL) AS $$
BEGIN
  RETURN QUERY
  SELECT tp.id, tp.topic_name, c.course_code,
    COUNT(ta.id)::INTEGER,
    SUM(CASE WHEN ta.is_correct THEN 1 ELSE 0 END)::INTEGER,
    (SUM(CASE WHEN ta.is_correct THEN 1 ELSE 0 END)::DECIMAL / NULLIF(COUNT(ta.id),0) * 100)::DECIMAL
  FROM public.topics tp
  JOIN public.questions q         ON tp.id = q.topic_id
  JOIN public.test_answers ta     ON q.id = ta.question_id
  JOIN public.tests ts            ON ta.test_id = ts.id
  JOIN public.courses c           ON tp.course_id = c.id
  JOIN public.users u             ON u.id = p_user_id
  JOIN public.course_programs cp  ON cp.course_id = c.id AND cp.program_id = u.program_id
  WHERE ts.user_id = p_user_id
    AND c.level    = u.selected_level
    AND c.semester = u.selected_semester
  GROUP BY tp.id, tp.topic_name, c.course_code
  HAVING COUNT(ta.id) >= 3
  ORDER BY 6 ASC LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
