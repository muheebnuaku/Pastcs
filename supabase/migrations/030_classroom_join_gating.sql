-- Classrooms, part 3: a classroom is only for students who can use its
-- course. Before this, anyone with an invite code could join (or create)
-- a classroom for any course, so one free account could sit in every
-- class's chat, resources and calls without ever paying.
--
-- The rule, enforced here in the database so no client can skip it:
--   * the classroom's course is your free course, or you've paid for its
--     level+semester in your program → join;
--   * you haven't picked a free course yet (new students) → join, and the
--     classroom's course becomes your free course;
--   * otherwise → pay first (payment_required).
-- A course outside your program can't be unlocked by your payment at all,
-- so that's its own answer (wrong_program) rather than a useless paywall.

-- Mirrors lib/subscriptionAccess.ts (isSubscriptionCurrentlyActive): a
-- payment lasts until grace_days after its program+semester's end_date,
-- and one made before that term's start_date belongs to an older cycle.
CREATE OR REPLACE FUNCTION public.course_access_for(p_user UUID, p_course UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  u  public.users%ROWTYPE;
  co public.courses%ROWTYPE;
BEGIN
  SELECT * INTO u FROM public.users WHERE id = p_user;
  SELECT * INTO co FROM public.courses WHERE id = p_course;
  IF u.id IS NULL OR co.id IS NULL THEN RETURN 'payment_required'; END IF;

  IF u.free_course_code IS NOT NULL AND upper(u.free_course_code) = upper(co.course_code) THEN
    RETURN 'free';
  END IF;

  IF u.program_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.course_programs cp WHERE cp.course_id = co.id AND cp.program_id = u.program_id
  ) THEN
    RETURN 'wrong_program';
  END IF;

  IF u.program_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.subscriptions s
    LEFT JOIN public.semester_end_dates t ON t.program_id = s.program_id AND t.semester = s.semester
    WHERE s.user_id = p_user
      AND s.status = 'active'
      AND s.level = co.level
      AND s.semester = co.semester
      AND s.program_id = u.program_id
      AND (t.id IS NULL OR (
        now() < ((t.end_date + t.grace_days + 1)::timestamp AT TIME ZONE 'UTC')
        AND (t.start_date IS NULL OR s.paid_at IS NULL OR s.paid_at >= (t.start_date::timestamp AT TIME ZONE 'UTC'))
      ))
  ) THEN
    RETURN 'paid';
  END IF;

  IF u.free_course_code IS NULL THEN RETURN 'available_free'; END IF;
  RETURN 'payment_required';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.course_access_for(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- First classroom of a new student: its course becomes their free course,
-- and an empty level/semester/program is filled from it.
CREATE OR REPLACE FUNCTION public.claim_free_course(p_user UUID, p_course UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.users u SET
    selected_level    = coalesce(u.selected_level, co.level),
    selected_semester = coalesce(u.selected_semester, co.semester),
    program_id        = coalesce(u.program_id, (SELECT cp.program_id FROM public.course_programs cp WHERE cp.course_id = co.id LIMIT 1)),
    free_course_code  = co.course_code
  FROM public.courses co
  WHERE u.id = p_user AND co.id = p_course AND u.free_course_code IS NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_free_course(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.join_classroom(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  room public.classrooms%ROWTYPE;
  access TEXT;
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

  -- Serialises this student's joins, so two invites opened at once can't
  -- both be taken as "my free course".
  PERFORM 1 FROM public.users WHERE id = uid FOR UPDATE;
  access := public.course_access_for(uid, room.course_id);
  IF access IN ('payment_required', 'wrong_program') THEN RAISE EXCEPTION '%', access; END IF;

  INSERT INTO public.classroom_members (classroom_id, user_id) VALUES (room.id, uid);
  IF access = 'available_free' THEN PERFORM public.claim_free_course(uid, room.course_id); END IF;
  RETURN room.id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.join_classroom(TEXT) FROM anon;

-- Same rule for starting a classroom: otherwise "create one for the course
-- I want, then invite friends" would skip the paywall too.
CREATE OR REPLACE FUNCTION public.create_classroom(p_name TEXT, p_course_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  new_id UUID;
  access TEXT;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF char_length(btrim(coalesce(p_name, ''))) NOT BETWEEN 3 AND 80 THEN RAISE EXCEPTION 'bad_name'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.courses WHERE id = p_course_id) THEN RAISE EXCEPTION 'bad_course'; END IF;
  -- Abuse guard: a student can own at most 10 classrooms.
  IF (SELECT count(*) FROM public.classrooms WHERE owner_id = uid) >= 10 THEN RAISE EXCEPTION 'too_many_classrooms'; END IF;

  PERFORM 1 FROM public.users WHERE id = uid FOR UPDATE;
  access := public.course_access_for(uid, p_course_id);
  IF access IN ('payment_required', 'wrong_program') THEN RAISE EXCEPTION '%', access; END IF;

  INSERT INTO public.classrooms (name, course_id, owner_id, join_code)
  VALUES (btrim(p_name), p_course_id, uid, public.new_classroom_code())
  RETURNING id INTO new_id;

  INSERT INTO public.classroom_members (classroom_id, user_id, role) VALUES (new_id, uid, 'owner');
  IF access = 'available_free' THEN PERFORM public.claim_free_course(uid, p_course_id); END IF;
  RETURN new_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_classroom(TEXT, UUID) FROM anon;

-- What the invite page needs to show the right step for a signed-in
-- student before they press anything: already in, join (free or paid
-- access), pay first, or not their program. Level/semester say what a
-- payment would have to unlock.
CREATE OR REPLACE FUNCTION public.get_classroom_join_status(p_code TEXT)
RETURNS TABLE (status TEXT, classroom_id UUID, level INTEGER, semester INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  uid UUID := auth.uid();
  room public.classrooms%ROWTYPE;
  co public.courses%ROWTYPE;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT * INTO room FROM public.classrooms WHERE join_code = upper(btrim(coalesce(p_code, '')));
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_code'; END IF;
  SELECT * INTO co FROM public.courses WHERE id = room.course_id;
  IF EXISTS (SELECT 1 FROM public.classroom_members m WHERE m.classroom_id = room.id AND m.user_id = uid) THEN
    RETURN QUERY SELECT 'member'::TEXT, room.id, co.level, co.semester;
  ELSE
    -- The id only goes to members; everyone else gets the decision.
    RETURN QUERY SELECT public.course_access_for(uid, room.course_id), NULL::UUID, co.level, co.semester;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_classroom_join_status(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_classroom_join_status(TEXT) TO authenticated;

-- ── Ending a call ──────────────────────────────────────────────────────
-- A call used to look "live" for two hours after it was started, even
-- once everyone had hung up. An 'end' message closes it on the site.
ALTER TABLE public.classroom_messages DROP CONSTRAINT IF EXISTS classroom_messages_kind_check;
ALTER TABLE public.classroom_messages ADD CONSTRAINT classroom_messages_kind_check
  CHECK (kind IN ('text', 'call', 'call_end', 'resource'));

-- Only whoever started the current call, or the classroom's owner/leaders,
-- can end it — otherwise any member could hang up the call for everyone.
CREATE OR REPLACE FUNCTION public.classroom_call_end_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  starter UUID;
BEGIN
  IF NEW.kind <> 'call_end' THEN RETURN NEW; END IF;
  SELECT m.user_id INTO starter FROM public.classroom_messages m
  WHERE m.classroom_id = NEW.classroom_id AND m.kind = 'call'
  ORDER BY m.created_at DESC LIMIT 1;
  IF starter IS DISTINCT FROM NEW.user_id
     AND coalesce(public.classroom_role(NEW.classroom_id), '') NOT IN ('owner', 'leader') THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS classroom_call_end_guard ON public.classroom_messages;
CREATE TRIGGER classroom_call_end_guard BEFORE INSERT ON public.classroom_messages
  FOR EACH ROW EXECUTE FUNCTION public.classroom_call_end_guard();
