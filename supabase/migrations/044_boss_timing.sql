-- ================================================================
-- MIGRATION: Exam Boss timing — 20 seconds a question (2026-10-28)
-- ================================================================
-- Every question now gets 20 seconds at every level, instead of 14 down
-- to 8. An enraged boss (below half health) still gives less time: 16
-- seconds. Multiple choice still gets 4 more. Higher levels stay harder
-- through more boss health and harder questions.
--
-- Takes effect from the next question sent. Safe to run more than once.
-- ================================================================

CREATE OR REPLACE FUNCTION public.boss_countdown(p_level INTEGER, p_enraged BOOLEAN, p_multi BOOLEAN)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_enraged THEN 16 ELSE 20 END + CASE WHEN p_multi THEN 4 ELSE 0 END;
$$;

NOTIFY pgrst, 'reload schema';
