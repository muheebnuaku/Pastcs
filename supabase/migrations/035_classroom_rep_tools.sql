-- ================================================================
-- MIGRATION: Tools for class reps
-- Run this in the Supabase SQL Editor once, after 034. Safe to re-run.
--
-- 1. Pinned announcements: the owner and leaders pin up to 3 short
--    notices, shown at the top of the chat and This week.
-- 2. Weekly goals: "Practise <topic> (N questions) by <date>". Progress
--    is counted from the tests/test_answers students already create —
--    practice, mock exams and battles — and respects each member's
--    share level: a private member's progress is visible only to them.
-- 3. Exam countdown: the owner and leaders set the exam date, shown in
--    the classroom header.
-- Every write goes through the functions below, which check the role.
-- ================================================================

-- ── 1. Pinned announcements ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.classroom_announcements (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  classroom_id UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  author_id    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  body         TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 500),
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_classroom_announcements_room ON public.classroom_announcements(classroom_id, created_at DESC);

ALTER TABLE public.classroom_announcements ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.classroom_announcements FROM anon, authenticated;
DROP POLICY IF EXISTS "classroom_announcements_select_member" ON public.classroom_announcements;
CREATE POLICY "classroom_announcements_select_member" ON public.classroom_announcements FOR SELECT
  USING (public.classroom_role(classroom_id) IS NOT NULL);

CREATE OR REPLACE FUNCTION public.pin_classroom_announcement(p_classroom UUID, p_body TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_id UUID;
BEGIN
  IF public.classroom_role(p_classroom) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF public.classroom_role(p_classroom) NOT IN ('owner', 'leader') THEN RAISE EXCEPTION 'leaders_only'; END IF;
  IF char_length(btrim(coalesce(p_body, ''))) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'bad_announcement'; END IF;
  -- Serialise pins per classroom so two leaders can't both slip in a 4th.
  PERFORM 1 FROM public.classrooms WHERE id = p_classroom FOR UPDATE;
  IF (SELECT count(*) FROM public.classroom_announcements WHERE classroom_id = p_classroom) >= 3 THEN
    RAISE EXCEPTION 'too_many_pins';
  END IF;
  INSERT INTO public.classroom_announcements (classroom_id, author_id, body)
  VALUES (p_classroom, auth.uid(), btrim(p_body)) RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.unpin_classroom_announcement(p_announcement UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  room UUID;
BEGIN
  SELECT classroom_id INTO room FROM public.classroom_announcements WHERE id = p_announcement;
  IF room IS NULL OR public.classroom_role(room) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF public.classroom_role(room) NOT IN ('owner', 'leader') THEN RAISE EXCEPTION 'leaders_only'; END IF;
  DELETE FROM public.classroom_announcements WHERE id = p_announcement;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'classroom_announcements') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.classroom_announcements;
  END IF;
END $$;

-- ── 2. Weekly goals ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.classroom_goals (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  classroom_id     UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  author_id        UUID REFERENCES public.users(id) ON DELETE SET NULL,
  topic_id         UUID REFERENCES public.topics(id) ON DELETE SET NULL,  -- NULL: any topic in the course
  target_questions INTEGER NOT NULL CHECK (target_questions BETWEEN 1 AND 500),
  due_date         DATE NOT NULL,
  -- Practice counts from this moment until the end of the due date.
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_classroom_goals_room ON public.classroom_goals(classroom_id, due_date DESC);

ALTER TABLE public.classroom_goals ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.classroom_goals FROM anon, authenticated;
DROP POLICY IF EXISTS "classroom_goals_select_member" ON public.classroom_goals;
CREATE POLICY "classroom_goals_select_member" ON public.classroom_goals FOR SELECT
  USING (public.classroom_role(classroom_id) IS NOT NULL);

CREATE OR REPLACE FUNCTION public.create_classroom_goal(p_classroom UUID, p_topic UUID, p_target INTEGER, p_due DATE)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_id UUID;
BEGIN
  IF public.classroom_role(p_classroom) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF public.classroom_role(p_classroom) NOT IN ('owner', 'leader') THEN RAISE EXCEPTION 'leaders_only'; END IF;
  IF p_target IS NULL OR p_target NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'bad_target'; END IF;
  IF p_due IS NULL OR p_due < CURRENT_DATE OR p_due > CURRENT_DATE + 60 THEN RAISE EXCEPTION 'bad_due_date'; END IF;
  IF p_topic IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.topics t JOIN public.classrooms c ON c.course_id = t.course_id
    WHERE t.id = p_topic AND c.id = p_classroom
  ) THEN
    RAISE EXCEPTION 'bad_topic';
  END IF;
  PERFORM 1 FROM public.classrooms WHERE id = p_classroom FOR UPDATE;
  IF (SELECT count(*) FROM public.classroom_goals WHERE classroom_id = p_classroom AND due_date >= CURRENT_DATE) >= 5 THEN
    RAISE EXCEPTION 'too_many_goals';
  END IF;
  INSERT INTO public.classroom_goals (classroom_id, author_id, topic_id, target_questions, due_date)
  VALUES (p_classroom, auth.uid(), p_topic, p_target, p_due) RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_classroom_goal(p_goal UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  room UUID;
BEGIN
  SELECT classroom_id INTO room FROM public.classroom_goals WHERE id = p_goal;
  IF room IS NULL OR public.classroom_role(room) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF public.classroom_role(room) NOT IN ('owner', 'leader') THEN RAISE EXCEPTION 'leaders_only'; END IF;
  DELETE FROM public.classroom_goals WHERE id = p_goal;
END;
$$;

-- Questions one member has answered toward one goal. Internal only.
CREATE OR REPLACE FUNCTION public.classroom_goal_count(
  p_user UUID, p_course UUID, p_topic UUID, p_from TIMESTAMP WITH TIME ZONE, p_due DATE
)
RETURNS INTEGER
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT count(*)::int
  FROM public.test_answers ta
  JOIN public.tests t ON t.id = ta.test_id
  LEFT JOIN public.questions q ON q.id = ta.question_id
  WHERE t.user_id = p_user AND t.course_id = p_course
    AND t.created_at >= p_from
    AND t.created_at < (p_due + 1)::timestamp AT TIME ZONE 'UTC'
    AND (p_topic IS NULL OR q.topic_id = p_topic);
$$;

-- The classroom's goals (current ones, then the last few finished), each
-- with my own progress and how many classmates who share have hit it.
CREATE OR REPLACE FUNCTION public.get_classroom_goals(p_classroom UUID)
RETURNS TABLE (
  id UUID, topic_id UUID, topic_name TEXT, target_questions INTEGER, due_date DATE, created_at TIMESTAMP WITH TIME ZONE,
  author_name TEXT, my_count INTEGER, done_count INTEGER, sharing_count INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
#variable_conflict use_column
DECLARE
  course UUID;
BEGIN
  IF auth.uid() IS NULL OR public.classroom_role(p_classroom) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  SELECT c.course_id INTO course FROM public.classrooms c WHERE c.id = p_classroom;
  RETURN QUERY
  SELECT g.id, g.topic_id, tp.topic_name, g.target_questions, g.due_date, g.created_at, au.full_name,
    public.classroom_goal_count(auth.uid(), course, g.topic_id, g.created_at, g.due_date),
    (SELECT count(*)::int FROM public.classroom_members m
     WHERE m.classroom_id = p_classroom AND (m.share_level <> 'hidden' OR m.user_id = auth.uid())
       AND public.classroom_goal_count(m.user_id, course, g.topic_id, g.created_at, g.due_date) >= g.target_questions),
    (SELECT count(*)::int FROM public.classroom_members m
     WHERE m.classroom_id = p_classroom AND (m.share_level <> 'hidden' OR m.user_id = auth.uid()))
  FROM (
    (SELECT * FROM public.classroom_goals x WHERE x.classroom_id = p_classroom AND x.due_date >= CURRENT_DATE)
    UNION ALL
    (SELECT * FROM public.classroom_goals x WHERE x.classroom_id = p_classroom AND x.due_date < CURRENT_DATE
     ORDER BY x.due_date DESC LIMIT 3)
  ) g
  LEFT JOIN public.topics tp ON tp.id = g.topic_id
  LEFT JOIN public.users au ON au.id = g.author_id
  ORDER BY (g.due_date < CURRENT_DATE), g.due_date, g.created_at;
END;
$$;

-- The leaders' checklist: every member against one goal. A private
-- member shows as a name with no number — to leaders too.
CREATE OR REPLACE FUNCTION public.get_classroom_goal_progress(p_goal UUID)
RETURNS TABLE (user_id UUID, full_name TEXT, avatar_url TEXT, is_me BOOLEAN, answered INTEGER, done BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
#variable_conflict use_column
DECLARE
  g public.classroom_goals%ROWTYPE;
  course UUID;
BEGIN
  SELECT * INTO g FROM public.classroom_goals x WHERE x.id = p_goal;
  IF g.id IS NULL OR auth.uid() IS NULL OR public.classroom_role(g.classroom_id) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF public.classroom_role(g.classroom_id) NOT IN ('owner', 'leader') THEN RAISE EXCEPTION 'leaders_only'; END IF;
  SELECT c.course_id INTO course FROM public.classrooms c WHERE c.id = g.classroom_id;
  RETURN QUERY
  SELECT m.user_id, u.full_name, u.avatar_url, m.user_id = auth.uid(),
    CASE WHEN v.visible THEN n.cnt END,
    CASE WHEN v.visible THEN n.cnt >= g.target_questions END
  FROM public.classroom_members m
  JOIN public.users u ON u.id = m.user_id
  CROSS JOIN LATERAL (SELECT (m.share_level <> 'hidden' OR m.user_id = auth.uid()) AS visible) v
  CROSS JOIN LATERAL (SELECT CASE WHEN v.visible THEN public.classroom_goal_count(m.user_id, course, g.topic_id, g.created_at, g.due_date) END AS cnt) n
  WHERE m.classroom_id = g.classroom_id
  ORDER BY (NOT v.visible), n.cnt DESC NULLS LAST, u.full_name;
END;
$$;

-- ── 3. Exam countdown ──────────────────────────────────────────────────
ALTER TABLE public.classrooms ADD COLUMN IF NOT EXISTS exam_date DATE;

CREATE OR REPLACE FUNCTION public.set_classroom_exam_date(p_classroom UUID, p_date DATE)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.classroom_role(p_classroom) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF public.classroom_role(p_classroom) NOT IN ('owner', 'leader') THEN RAISE EXCEPTION 'leaders_only'; END IF;
  IF p_date IS NOT NULL AND (p_date < CURRENT_DATE OR p_date > CURRENT_DATE + 365) THEN RAISE EXCEPTION 'bad_exam_date'; END IF;
  UPDATE public.classrooms SET exam_date = p_date WHERE id = p_classroom;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.classroom_goal_count(UUID, UUID, UUID, TIMESTAMP WITH TIME ZONE, DATE) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pin_classroom_announcement(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.unpin_classroom_announcement(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_classroom_goal(UUID, UUID, INTEGER, DATE) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_classroom_goal(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_classroom_goals(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_classroom_goal_progress(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_classroom_exam_date(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pin_classroom_announcement(UUID, TEXT), public.unpin_classroom_announcement(UUID),
  public.create_classroom_goal(UUID, UUID, INTEGER, DATE), public.delete_classroom_goal(UUID),
  public.get_classroom_goals(UUID), public.get_classroom_goal_progress(UUID), public.set_classroom_exam_date(UUID, DATE)
  TO authenticated;
