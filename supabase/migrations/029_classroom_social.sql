-- Classrooms, part 2: class chat (with calls posted into it), shared
-- resources (links + files), the "class deal" discount, and onboarding
-- for students who arrive through an invite link.

-- ── Chat ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.classroom_messages (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  classroom_id UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'call', 'resource')),
  body         TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  meta         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_classroom_messages_room ON public.classroom_messages(classroom_id, created_at DESC);
ALTER TABLE public.classroom_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "classroom_messages_select_member" ON public.classroom_messages;
CREATE POLICY "classroom_messages_select_member" ON public.classroom_messages FOR SELECT
  USING (public.classroom_role(classroom_id) IS NOT NULL);
DROP POLICY IF EXISTS "classroom_messages_insert_member" ON public.classroom_messages;
CREATE POLICY "classroom_messages_insert_member" ON public.classroom_messages FOR INSERT
  WITH CHECK (user_id = auth.uid() AND public.classroom_role(classroom_id) IS NOT NULL);
-- Your own messages, or anyone's if you lead the classroom.
DROP POLICY IF EXISTS "classroom_messages_delete" ON public.classroom_messages;
CREATE POLICY "classroom_messages_delete" ON public.classroom_messages FOR DELETE
  USING (user_id = auth.uid() OR public.classroom_role(classroom_id) IN ('owner', 'leader'));

-- Anti-spam: at most 20 messages a minute per student per classroom.
CREATE OR REPLACE FUNCTION public.classroom_messages_rate_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT count(*) FROM public.classroom_messages
      WHERE classroom_id = NEW.classroom_id AND user_id = NEW.user_id
        AND created_at > NOW() - INTERVAL '1 minute') >= 20 THEN
    RAISE EXCEPTION 'slow_down';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS classroom_messages_rate_limit ON public.classroom_messages;
CREATE TRIGGER classroom_messages_rate_limit BEFORE INSERT ON public.classroom_messages
  FOR EACH ROW EXECUTE FUNCTION public.classroom_messages_rate_limit();

-- Live updates for the chat.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'classroom_messages'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.classroom_messages;
  END IF;
END $$;

-- ── Resources ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.classroom_resources (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  classroom_id UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  kind         TEXT NOT NULL CHECK (kind IN ('link', 'file')),
  url          TEXT CHECK (url IS NULL OR url ~* '^https?://'),
  file_path    TEXT,
  file_size    INTEGER,
  mime_type    TEXT,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CHECK ((kind = 'link' AND url IS NOT NULL) OR (kind = 'file' AND file_path IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_classroom_resources_room ON public.classroom_resources(classroom_id, created_at DESC);
ALTER TABLE public.classroom_resources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "classroom_resources_select_member" ON public.classroom_resources;
CREATE POLICY "classroom_resources_select_member" ON public.classroom_resources FOR SELECT
  USING (public.classroom_role(classroom_id) IS NOT NULL);
DROP POLICY IF EXISTS "classroom_resources_insert_member" ON public.classroom_resources;
CREATE POLICY "classroom_resources_insert_member" ON public.classroom_resources FOR INSERT
  WITH CHECK (user_id = auth.uid() AND public.classroom_role(classroom_id) IS NOT NULL
              AND (file_path IS NULL OR file_path LIKE classroom_id::TEXT || '/%'));
DROP POLICY IF EXISTS "classroom_resources_delete" ON public.classroom_resources;
CREATE POLICY "classroom_resources_delete" ON public.classroom_resources FOR DELETE
  USING (user_id = auth.uid() OR public.classroom_role(classroom_id) IN ('owner', 'leader'));

-- Private storage for shared files: <classroom id>/<file>. Only members of
-- that classroom can read; members upload; uploader or a leader deletes.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('classroom-files', 'classroom-files', false, 15728640, ARRAY[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint', 'application/msword',
  'image/png', 'image/jpeg', 'image/webp', 'text/plain'
])
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.classroom_folder_role(p_name TEXT)
RETURNS TEXT
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT CASE
    WHEN split_part(p_name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
    THEN public.classroom_role(split_part(p_name, '/', 1)::UUID)
  END;
$$;

DROP POLICY IF EXISTS "classroom_files_read" ON storage.objects;
CREATE POLICY "classroom_files_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'classroom-files' AND public.classroom_folder_role(name) IS NOT NULL);
DROP POLICY IF EXISTS "classroom_files_upload" ON storage.objects;
CREATE POLICY "classroom_files_upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'classroom-files' AND public.classroom_folder_role(name) IS NOT NULL);
DROP POLICY IF EXISTS "classroom_files_delete" ON storage.objects;
CREATE POLICY "classroom_files_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'classroom-files'
         AND (owner = auth.uid() OR public.classroom_folder_role(name) IN ('owner', 'leader')));

-- ── Invite onboarding ──────────────────────────────────────────────────
-- A student joining by invite who hasn't set up yet starts practising
-- straight away: the classroom's course becomes their one free course
-- (only if they have none — it never replaces an existing pick), and an
-- empty level/semester/program is filled from that course.
CREATE OR REPLACE FUNCTION public.join_classroom(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  room public.classrooms%ROWTYPE;
  co public.courses%ROWTYPE;
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

  SELECT * INTO co FROM public.courses WHERE id = room.course_id;
  UPDATE public.users u SET
    selected_level    = coalesce(u.selected_level, co.level),
    selected_semester = coalesce(u.selected_semester, co.semester),
    program_id        = coalesce(u.program_id, (SELECT cp.program_id FROM public.course_programs cp WHERE cp.course_id = co.id LIMIT 1)),
    free_course_code  = co.course_code
  WHERE u.id = uid AND u.free_course_code IS NULL;

  RETURN room.id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.join_classroom(TEXT) FROM anon;

-- ── Class deal ─────────────────────────────────────────────────────────
-- How many members of a classroom have already unlocked its course's
-- level+semester (any program the course belongs to). Counts only — the
-- page shows "7 of 10 unlocked", never who.
CREATE OR REPLACE FUNCTION public.classroom_paid_count(p_classroom UUID, p_exclude UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT count(DISTINCT m.user_id)::INTEGER
  FROM public.classroom_members m
  JOIN public.classrooms c ON c.id = m.classroom_id
  JOIN public.courses co ON co.id = c.course_id
  JOIN public.subscriptions s ON s.user_id = m.user_id
    AND s.status = 'active' AND s.level = co.level AND s.semester = co.semester
    AND s.program_id IN (SELECT cp.program_id FROM public.course_programs cp WHERE cp.course_id = co.id)
  WHERE m.classroom_id = p_classroom
    AND (p_exclude IS NULL OR m.user_id <> p_exclude);
$$;
REVOKE EXECUTE ON FUNCTION public.classroom_paid_count(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- For a member viewing their classroom.
CREATE OR REPLACE FUNCTION public.get_class_deal(p_classroom UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
BEGIN
  IF public.classroom_role(p_classroom) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  RETURN public.classroom_paid_count(p_classroom, auth.uid());
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_class_deal(UUID) FROM anon;

-- For the payment server (service role only): the student's classroom with
-- the most paid classmates at the level+semester being bought.
CREATE OR REPLACE FUNCTION public.class_deal_for(p_user UUID, p_level INTEGER, p_semester INTEGER)
RETURNS TABLE (classroom_id UUID, classroom_name TEXT, paid_count INTEGER)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT c.id, c.name, public.classroom_paid_count(c.id, p_user)
  FROM public.classroom_members m
  JOIN public.classrooms c ON c.id = m.classroom_id
  JOIN public.courses co ON co.id = c.course_id
  WHERE m.user_id = p_user AND co.level = p_level AND co.semester = p_semester
  ORDER BY 3 DESC
  LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.class_deal_for(UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.classroom_paid_count(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.class_deal_for(UUID, INTEGER, INTEGER) TO service_role;
