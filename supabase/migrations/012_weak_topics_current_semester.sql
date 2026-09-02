-- ================================================================
-- MIGRATION: Scope get_weak_topics() to the student's current level/semester
-- Run this in the Supabase SQL Editor once. Safe to re-run (idempotent).
--
-- get_weak_topics() pulled from a student's ENTIRE test history across
-- every course they'd ever taken, with no filter on their currently
-- selected level/semester. Powers both the dashboard's "Topics to
-- Review" card and the Exam Countdown widget's "Focus on" list — after
-- a student changes semester, both kept showing weak topics from
-- courses in their OLD semester, which aren't relevant (or even
-- accessible) to what they're currently practising for.
--
-- Fixed by joining users to filter courses down to the student's
-- current selected_level/selected_semester inside the function itself
-- — no call-site changes needed, and both widgets pick this up
-- automatically since they call the same RPC.
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
  JOIN public.questions q      ON tp.id = q.topic_id
  JOIN public.test_answers ta  ON q.id = ta.question_id
  JOIN public.tests ts         ON ta.test_id = ts.id
  JOIN public.courses c        ON tp.course_id = c.id
  JOIN public.users u          ON u.id = p_user_id
  WHERE ts.user_id = p_user_id
    AND c.level    = u.selected_level
    AND c.semester = u.selected_semester
  GROUP BY tp.id, tp.topic_name, c.course_code
  HAVING COUNT(ta.id) >= 3
  ORDER BY 6 ASC LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
