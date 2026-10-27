-- ================================================================
-- MIGRATION: Classroom limits on free access
-- ================================================================
-- A student in a classroom on free access to its course (migration 038's
-- is_free_access) gets, in that classroom, for good:
--   * 2 class battles (joining or starting one; a cancelled battle, or
--     leaving a lobby before it starts, doesn't use one up), and only on
--     the course's open topics;
--   * 5 text messages (deleting one doesn't give it back);
--   * 2 video call joins (rejoining the same call is free).
-- Paid students are unaffected.
--
-- Calls: the Jitsi room was "PastCS-<classroom id>", and every call
-- message carried the link, so anyone could join without asking. Each
-- classroom now has a secret room name members can't read, the link
-- comes only from join_classroom_call (which counts the join), call
-- messages no longer carry it, and clients can't post call messages
-- directly any more.
--
-- Safe to run more than once.
-- ================================================================

CREATE TABLE IF NOT EXISTS public.classroom_free_usage (
  classroom_id UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('message', 'call')),
  ref_id       UUID NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (classroom_id, user_id, kind, ref_id)
);
ALTER TABLE public.classroom_free_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.classroom_free_usage FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.classroom_call_rooms (
  classroom_id UUID PRIMARY KEY REFERENCES public.classrooms(id) ON DELETE CASCADE,
  room         TEXT NOT NULL
);
ALTER TABLE public.classroom_call_rooms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.classroom_call_rooms FROM anon, authenticated;

-- Is this student on free access to this classroom's course?
CREATE OR REPLACE FUNCTION public.classroom_free_access(p_user UUID, p_classroom UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT coalesce((SELECT public.is_free_access(p_user, c.course_id) FROM public.classrooms c WHERE c.id = p_classroom), false);
$$;
REVOKE EXECUTE ON FUNCTION public.classroom_free_access(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- Battles this student has played (or is in) in a classroom.
CREATE OR REPLACE FUNCTION public.classroom_battles_used(p_user UUID, p_classroom UUID, p_except UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT count(*)::int FROM public.classroom_battle_players pl
  JOIN public.classroom_battles b ON b.id = pl.battle_id
  WHERE pl.user_id = p_user AND b.classroom_id = p_classroom AND b.status <> 'cancelled'
    AND (p_except IS NULL OR b.id <> p_except);
$$;
REVOKE EXECUTE ON FUNCTION public.classroom_battles_used(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ── Battles ──────────────────────────────────────────────────────────
-- Every way into a battle (starting one or joining a lobby) inserts a
-- player row, so the limit lives here.
CREATE OR REPLACE FUNCTION public.classroom_battle_players_free_limit()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b public.classroom_battles%ROWTYPE;
BEGIN
  SELECT * INTO b FROM public.classroom_battles WHERE id = NEW.battle_id;
  IF b.id IS NULL OR NOT public.is_free_access(NEW.user_id, b.course_id) THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM public.classroom_battle_questions bq JOIN public.questions q ON q.id = bq.question_id
    WHERE bq.battle_id = b.id
      AND (q.topic_id IS NULL OR q.topic_id NOT IN (SELECT public.free_topic_ids(b.course_id)))
  ) THEN
    RAISE EXCEPTION 'battle_topics_locked';
  END IF;
  IF public.classroom_battles_used(NEW.user_id, b.classroom_id, b.id) >= 2 THEN
    RAISE EXCEPTION 'free_limit_battles';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS classroom_battle_players_free_limit ON public.classroom_battle_players;
CREATE TRIGGER classroom_battle_players_free_limit BEFORE INSERT ON public.classroom_battle_players
  FOR EACH ROW EXECUTE FUNCTION public.classroom_battle_players_free_limit();

-- As in migration 034, plus: a host on free access gets the open topics
-- when they pick none, and can't pick locked ones.
CREATE OR REPLACE FUNCTION public.create_classroom_battle(p_classroom UUID, p_topic_ids UUID[] DEFAULT '{}')
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me UUID := auth.uid();
  room public.classrooms%ROWTYPE;
  topics UUID[] := coalesce(p_topic_ids, '{}');
  new_id UUID;
  picked INTEGER;
  first_name TEXT;
BEGIN
  IF me IS NULL OR public.classroom_role(p_classroom) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  SELECT * INTO room FROM public.classrooms WHERE id = p_classroom;
  IF coalesce(public.course_access_for(me, room.course_id), '') NOT IN ('free', 'paid') THEN RAISE EXCEPTION 'payment_required'; END IF;

  PERFORM public.settle_classroom_battles(p_classroom);
  IF EXISTS (SELECT 1 FROM public.classroom_battles WHERE classroom_id = p_classroom AND status IN ('lobby', 'live')) THEN
    RAISE EXCEPTION 'battle_in_progress';
  END IF;
  IF (SELECT count(*) FROM public.classroom_battles WHERE classroom_id = p_classroom AND host_id = me
      AND created_at > now() - INTERVAL '1 hour') >= 6 THEN
    RAISE EXCEPTION 'slow_down';
  END IF;
  IF cardinality(topics) > 20 OR EXISTS (
    SELECT 1 FROM unnest(topics) t(id) WHERE NOT EXISTS (SELECT 1 FROM public.topics tp WHERE tp.id = t.id AND tp.course_id = room.course_id)
  ) THEN
    RAISE EXCEPTION 'bad_topic';
  END IF;

  IF public.is_free_access(me, room.course_id) THEN
    IF public.classroom_battles_used(me, p_classroom) >= 2 THEN RAISE EXCEPTION 'free_limit_battles'; END IF;
    IF cardinality(topics) = 0 THEN
      topics := ARRAY(SELECT public.free_topic_ids(room.course_id));
    ELSIF EXISTS (SELECT 1 FROM unnest(topics) t(id) WHERE t.id NOT IN (SELECT public.free_topic_ids(room.course_id))) THEN
      RAISE EXCEPTION 'battle_topics_locked';
    END IF;
  END IF;

  INSERT INTO public.classroom_battles (classroom_id, host_id, course_id, topic_ids, question_count)
  VALUES (p_classroom, me, room.course_id, topics, 0) RETURNING id INTO new_id;

  INSERT INTO public.classroom_battle_questions (battle_id, idx, question_id)
  SELECT new_id, (row_number() OVER () - 1)::int, q.id FROM (
    SELECT q.id FROM public.questions q
    WHERE q.course_id = room.course_id AND q.is_approved
      AND q.question_type IN ('single_choice', 'multiple_choice')
      AND jsonb_typeof(q.options) = 'array' AND jsonb_array_length(q.options) >= 2
      AND jsonb_typeof(q.correct_answers) = 'array' AND jsonb_array_length(q.correct_answers) >= 1
      AND (cardinality(topics) = 0 OR q.topic_id = ANY (topics))
    ORDER BY random() LIMIT 10
  ) q;
  GET DIAGNOSTICS picked = ROW_COUNT;
  IF picked < 5 THEN RAISE EXCEPTION 'not_enough_questions'; END IF;
  UPDATE public.classroom_battles SET question_count = picked WHERE id = new_id;

  INSERT INTO public.classroom_battle_players (battle_id, user_id) VALUES (new_id, me);

  SELECT split_part(coalesce(nullif(btrim(full_name), ''), 'A classmate'), ' ', 1) INTO first_name FROM public.users WHERE id = me;
  PERFORM set_config('pastcs.battle_post', 'on', true);
  INSERT INTO public.classroom_messages (classroom_id, user_id, kind, body, meta)
  VALUES (p_classroom, me, 'battle', first_name || ' started a battle: ' || picked || ' questions. Join the lobby!',
          jsonb_build_object('battle_id', new_id));
  PERFORM set_config('pastcs.battle_post', '', true);
  RETURN new_id;
END;
$$;

-- ── Messages, and call messages ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.classroom_messages_free_limit()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.kind = 'call' THEN
    -- Only join_classroom_call posts calls, and the link never goes in
    -- the message: members would read it and join without counting.
    IF coalesce(current_setting('pastcs.call_post', true), '') <> 'on' THEN RAISE EXCEPTION 'use_join_call'; END IF;
    NEW.meta := coalesce(NEW.meta, '{}'::jsonb) - 'url';
  ELSIF NEW.kind = 'text' AND public.classroom_free_access(NEW.user_id, NEW.classroom_id) THEN
    IF (SELECT count(*) FROM public.classroom_free_usage
        WHERE classroom_id = NEW.classroom_id AND user_id = NEW.user_id AND kind = 'message') >= 5 THEN
      RAISE EXCEPTION 'free_limit_messages';
    END IF;
    INSERT INTO public.classroom_free_usage (classroom_id, user_id, kind, ref_id)
    VALUES (NEW.classroom_id, NEW.user_id, 'message', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS classroom_messages_free_limit ON public.classroom_messages;
CREATE TRIGGER classroom_messages_free_limit BEFORE INSERT ON public.classroom_messages
  FOR EACH ROW EXECUTE FUNCTION public.classroom_messages_free_limit();

-- ── Calls ────────────────────────────────────────────────────────────
-- Start a call (p_start) or join the one in progress. Returns
-- {url, message_id}. A call stays joinable for 2 hours, or until someone
-- ends it — the same window the chat shows "Call in progress" for.
CREATE OR REPLACE FUNCTION public.join_classroom_call(p_classroom UUID, p_start BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me UUID := auth.uid();
  live UUID;
  secret TEXT;
  first_name TEXT;
  is_free BOOLEAN;
BEGIN
  IF me IS NULL OR public.classroom_role(p_classroom) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;

  SELECT m.id INTO live FROM public.classroom_messages m
  WHERE m.classroom_id = p_classroom AND m.kind = 'call' AND m.created_at > now() - interval '2 hours'
    AND NOT EXISTS (SELECT 1 FROM public.classroom_messages e
                    WHERE e.classroom_id = p_classroom AND e.kind = 'call_end' AND e.created_at > m.created_at)
  ORDER BY m.created_at DESC LIMIT 1;
  IF live IS NULL AND NOT coalesce(p_start, false) THEN RAISE EXCEPTION 'no_call'; END IF;

  is_free := public.classroom_free_access(me, p_classroom);
  -- Checked before posting, so a student at the limit can't ring everyone.
  IF is_free AND NOT EXISTS (
       SELECT 1 FROM public.classroom_free_usage
       WHERE classroom_id = p_classroom AND user_id = me AND kind = 'call' AND ref_id = live)
     AND (SELECT count(*) FROM public.classroom_free_usage
          WHERE classroom_id = p_classroom AND user_id = me AND kind = 'call') >= 2 THEN
    RAISE EXCEPTION 'free_limit_calls';
  END IF;

  IF live IS NULL THEN
    SELECT split_part(coalesce(nullif(btrim(full_name), ''), 'A classmate'), ' ', 1) INTO first_name FROM public.users WHERE id = me;
    PERFORM set_config('pastcs.call_post', 'on', true);
    INSERT INTO public.classroom_messages (classroom_id, user_id, kind, body, meta)
    VALUES (p_classroom, me, 'call', first_name || ' started a video call', '{}'::jsonb)
    RETURNING id INTO live;
    PERFORM set_config('pastcs.call_post', '', true);
  END IF;

  IF is_free THEN
    INSERT INTO public.classroom_free_usage (classroom_id, user_id, kind, ref_id)
    VALUES (p_classroom, me, 'call', live) ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.classroom_call_rooms (classroom_id, room)
  VALUES (p_classroom, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
  ON CONFLICT (classroom_id) DO NOTHING;
  SELECT room INTO secret FROM public.classroom_call_rooms WHERE classroom_id = p_classroom;

  RETURN jsonb_build_object('url', 'https://meet.jit.si/PastCS-' || secret, 'message_id', live);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.join_classroom_call(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_classroom_call(UUID, BOOLEAN) TO authenticated;

-- ── What the classroom page shows ────────────────────────────────────
-- {free: bool, messages|battles|calls: {used, limit}}
CREATE OR REPLACE FUNCTION public.get_my_classroom_limits(p_classroom UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE me UUID := auth.uid();
BEGIN
  IF me IS NULL OR public.classroom_role(p_classroom) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF NOT public.classroom_free_access(me, p_classroom) THEN RETURN jsonb_build_object('free', false); END IF;
  RETURN jsonb_build_object(
    'free', true,
    'messages', jsonb_build_object('limit', 5, 'used',
      (SELECT count(*) FROM public.classroom_free_usage WHERE classroom_id = p_classroom AND user_id = me AND kind = 'message')),
    'battles', jsonb_build_object('limit', 2, 'used', public.classroom_battles_used(me, p_classroom)),
    'calls', jsonb_build_object('limit', 2, 'used',
      (SELECT count(*) FROM public.classroom_free_usage WHERE classroom_id = p_classroom AND user_id = me AND kind = 'call'))
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_classroom_limits(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_classroom_limits(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
