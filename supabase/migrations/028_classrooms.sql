-- Classrooms (phase 1): a shared space per course where classmates join by
-- link or code, see a weekly leaderboard and a class progress board.
-- Progress is never stored twice — it's computed from the tests/answers
-- students already create, filtered to the classroom's course.
--
-- All writes go through the SECURITY DEFINER functions below (create, join,
-- role and sharing changes), so a member can never promote themselves or
-- edit someone else's row; the only direct write a client makes is a
-- DELETE (leave, or a leader removing a member), which RLS limits.

CREATE TABLE IF NOT EXISTS public.classrooms (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 3 AND 80),
  course_id   UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  owner_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  join_code   TEXT NOT NULL UNIQUE,
  max_members INTEGER NOT NULL DEFAULT 200,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.classroom_members (
  classroom_id UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'leader', 'member')),
  -- 'totals' = classmates see your weekly numbers; 'hidden' = only your name.
  -- 'full' is reserved for a later per-topic breakdown.
  share_level  TEXT NOT NULL DEFAULT 'totals' CHECK (share_level IN ('full', 'totals', 'hidden')),
  joined_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (classroom_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_classroom_members_user ON public.classroom_members(user_id);
CREATE INDEX IF NOT EXISTS idx_tests_user_course_created ON public.tests(user_id, course_id, created_at DESC);

ALTER TABLE public.classrooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_members ENABLE ROW LEVEL SECURITY;

-- The caller's role in a classroom, or NULL if they aren't a member.
-- SECURITY DEFINER so policies on classroom_members can use it without
-- recursing into themselves (same reason as is_admin()).
CREATE OR REPLACE FUNCTION public.classroom_role(p_classroom UUID)
RETURNS TEXT
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT role FROM public.classroom_members
  WHERE classroom_id = p_classroom AND user_id = auth.uid();
$$;

DROP POLICY IF EXISTS "classrooms_select_member" ON public.classrooms;
CREATE POLICY "classrooms_select_member" ON public.classrooms FOR SELECT
  USING (public.classroom_role(id) IS NOT NULL);
DROP POLICY IF EXISTS "classrooms_delete_owner" ON public.classrooms;
CREATE POLICY "classrooms_delete_owner" ON public.classrooms FOR DELETE
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "classroom_members_select_member" ON public.classroom_members;
CREATE POLICY "classroom_members_select_member" ON public.classroom_members FOR SELECT
  USING (public.classroom_role(classroom_id) IS NOT NULL);
-- Leave (anyone but the owner, who deletes the classroom instead), or a
-- leader/owner removing an ordinary member.
DROP POLICY IF EXISTS "classroom_members_delete" ON public.classroom_members;
CREATE POLICY "classroom_members_delete" ON public.classroom_members FOR DELETE
  USING (
    (user_id = auth.uid() AND role <> 'owner')
    OR (role = 'member' AND public.classroom_role(classroom_id) IN ('owner', 'leader'))
  );

-- 6-character code without look-alike characters (no 0/O, 1/I/L).
CREATE OR REPLACE FUNCTION public.new_classroom_code()
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  alphabet CONSTANT TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code TEXT;
BEGIN
  LOOP
    code := '';
    FOR i IN 1..6 LOOP
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::INT, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.classrooms WHERE join_code = code);
  END LOOP;
  RETURN code;
END;
$$;
REVOKE ALL ON FUNCTION public.new_classroom_code() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_classroom(p_name TEXT, p_course_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  new_id UUID;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF char_length(btrim(coalesce(p_name, ''))) NOT BETWEEN 3 AND 80 THEN RAISE EXCEPTION 'bad_name'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.courses WHERE id = p_course_id) THEN RAISE EXCEPTION 'bad_course'; END IF;
  -- Abuse guard: a student can own at most 10 classrooms.
  IF (SELECT count(*) FROM public.classrooms WHERE owner_id = uid) >= 10 THEN RAISE EXCEPTION 'too_many_classrooms'; END IF;

  INSERT INTO public.classrooms (name, course_id, owner_id, join_code)
  VALUES (btrim(p_name), p_course_id, uid, public.new_classroom_code())
  RETURNING id INTO new_id;

  INSERT INTO public.classroom_members (classroom_id, user_id, role) VALUES (new_id, uid, 'owner');
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_classroom(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  room public.classrooms%ROWTYPE;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT * INTO room FROM public.classrooms WHERE join_code = upper(btrim(coalesce(p_code, '')));
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_code'; END IF;
  IF EXISTS (SELECT 1 FROM public.classroom_members WHERE classroom_id = room.id AND user_id = uid) THEN
    RETURN room.id;
  END IF;
  IF (SELECT count(*) FROM public.classroom_members WHERE classroom_id = room.id) >= room.max_members THEN
    RAISE EXCEPTION 'classroom_full';
  END IF;
  INSERT INTO public.classroom_members (classroom_id, user_id) VALUES (room.id, uid);
  RETURN room.id;
END;
$$;

-- What an invite link shows before joining (also to signed-out visitors):
-- just enough to decide, nothing about members' progress.
CREATE OR REPLACE FUNCTION public.get_classroom_preview(p_code TEXT)
RETURNS TABLE (name TEXT, course_code TEXT, course_name TEXT, member_count INTEGER, owner_name TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT c.name, co.course_code, co.course_name,
         (SELECT count(*)::INTEGER FROM public.classroom_members m WHERE m.classroom_id = c.id),
         split_part(coalesce(u.full_name, 'A classmate'), ' ', 1)
  FROM public.classrooms c
  JOIN public.courses co ON co.id = c.course_id
  LEFT JOIN public.users u ON u.id = c.owner_id
  WHERE c.join_code = upper(btrim(coalesce(p_code, '')));
$$;

CREATE OR REPLACE FUNCTION public.set_my_share_level(p_classroom UUID, p_level TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_level NOT IN ('full', 'totals', 'hidden') THEN RAISE EXCEPTION 'bad_level'; END IF;
  UPDATE public.classroom_members SET share_level = p_level
  WHERE classroom_id = p_classroom AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'not_a_member'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_member_role(p_classroom UUID, p_user UUID, p_role TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.classroom_role(p_classroom) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_only'; END IF;
  IF p_role NOT IN ('leader', 'member') THEN RAISE EXCEPTION 'bad_role'; END IF;
  UPDATE public.classroom_members SET role = p_role
  WHERE classroom_id = p_classroom AND user_id = p_user AND role <> 'owner';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_a_member'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.regenerate_classroom_code(p_classroom UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE code TEXT;
BEGIN
  IF public.classroom_role(p_classroom) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_only'; END IF;
  code := public.new_classroom_code();
  UPDATE public.classrooms SET join_code = code WHERE id = p_classroom;
  RETURN code;
END;
$$;

-- One row per member: weekly practice in the classroom's course plus
-- their streak. A member who chose 'hidden' shows only name and role to
-- others (their own row always shows everything).
CREATE OR REPLACE FUNCTION public.get_classroom_progress(p_classroom UUID, p_days INTEGER DEFAULT 7)
RETURNS TABLE (
  user_id UUID, full_name TEXT, avatar_url TEXT, role TEXT, share_level TEXT, is_me BOOLEAN,
  practice_streak INTEGER, tests_taken INTEGER, questions_answered INTEGER,
  correct_answers INTEGER, accuracy NUMERIC, last_active TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  course UUID;
  since TIMESTAMP WITH TIME ZONE := NOW() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 120)));
BEGIN
  IF public.classroom_role(p_classroom) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  SELECT c.course_id INTO course FROM public.classrooms c WHERE c.id = p_classroom;

  RETURN QUERY
  SELECT m.user_id, u.full_name, u.avatar_url, m.role, m.share_level, (m.user_id = auth.uid()),
    CASE WHEN visible THEN u.practice_streak END,
    CASE WHEN visible THEN coalesce(s.tests, 0) END,
    CASE WHEN visible THEN coalesce(s.answered, 0) END,
    CASE WHEN visible THEN coalesce(s.correct, 0) END,
    CASE WHEN visible AND coalesce(s.answered, 0) > 0 THEN round(s.correct::NUMERIC * 100 / s.answered, 1) END,
    CASE WHEN visible THEN la.last_at END
  FROM public.classroom_members m
  JOIN public.users u ON u.id = m.user_id
  CROSS JOIN LATERAL (SELECT (m.share_level <> 'hidden' OR m.user_id = auth.uid()) AS visible) v
  LEFT JOIN LATERAL (
    SELECT count(*)::INTEGER AS tests, sum(t.total_questions)::INTEGER AS answered, sum(t.score)::INTEGER AS correct
    FROM public.tests t
    WHERE t.user_id = m.user_id AND t.course_id = course AND t.created_at >= since
  ) s ON TRUE
  LEFT JOIN LATERAL (
    SELECT max(t.created_at) AS last_at FROM public.tests t WHERE t.user_id = m.user_id AND t.course_id = course
  ) la ON TRUE
  WHERE m.classroom_id = p_classroom;
END;
$$;

-- The class's accuracy per topic over the period, from members who share
-- their progress — the board's "weak topics" heat map. Aggregate only.
CREATE OR REPLACE FUNCTION public.get_classroom_topic_stats(p_classroom UUID, p_days INTEGER DEFAULT 30)
RETURNS TABLE (topic_id UUID, topic_name TEXT, attempts INTEGER, correct INTEGER, accuracy NUMERIC, students INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  course UUID;
  since TIMESTAMP WITH TIME ZONE := NOW() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 120)));
BEGIN
  IF public.classroom_role(p_classroom) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  SELECT c.course_id INTO course FROM public.classrooms c WHERE c.id = p_classroom;

  RETURN QUERY
  SELECT tp.id, tp.topic_name,
    count(*)::INTEGER,
    sum(CASE WHEN ta.is_correct THEN 1 ELSE 0 END)::INTEGER,
    round(sum(CASE WHEN ta.is_correct THEN 1 ELSE 0 END)::NUMERIC * 100 / count(*), 1),
    count(DISTINCT t.user_id)::INTEGER
  FROM public.test_answers ta
  JOIN public.tests t ON t.id = ta.test_id
  JOIN public.questions q ON q.id = ta.question_id
  JOIN public.topics tp ON tp.id = q.topic_id
  JOIN public.classroom_members m ON m.classroom_id = p_classroom AND m.user_id = t.user_id
  WHERE t.course_id = course AND t.created_at >= since
    AND (m.share_level <> 'hidden' OR m.user_id = auth.uid())
  GROUP BY tp.id, tp.topic_name
  ORDER BY 5 ASC, 3 DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_classroom_preview(TEXT) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_classroom(TEXT, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.join_classroom(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_my_share_level(UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_member_role(UUID, UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.regenerate_classroom_code(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_classroom_progress(UUID, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_classroom_topic_stats(UUID, INTEGER) FROM anon;
