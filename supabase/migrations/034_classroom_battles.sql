-- ================================================================
-- MIGRATION: Server-side test scoring + class battles
-- Run this in the Supabase SQL Editor once, after 033. Safe to re-run.
--
-- 1. Tests are scored on the server. Practice and mock exams used to
--    insert their own `tests` row with whatever score the browser sent,
--    and award themselves XP — so the class leaderboard (and now battle
--    results, which feed it) could be faked from the console. Now the
--    browser sends only its answers to /api/tests/submit, which calls
--    record_test() with the service role; students can no longer insert
--    tests or test_answers, or call increment_xp, directly.
-- 2. Class battles: a live 10-question quiz for classmates. Everyone
--    gets the same question at the same moment (the schedule is fixed by
--    the database from started_at, so it carries on if the host drops),
--    answers are marked by submit_battle_answer, and the correct answer
--    only leaves the database once the question has closed. A finished
--    battle becomes a `tests` row per player (type 'battle'), so it
--    counts toward the weekly class leaderboard and XP.
-- ================================================================

-- ── 1. Tests scored on the server ──────────────────────────────────────
ALTER TABLE public.tests DROP CONSTRAINT IF EXISTS tests_test_type_check;
ALTER TABLE public.tests ADD CONSTRAINT tests_test_type_check
  CHECK (test_type IN ('practice', 'exam_simulation', 'battle'));

DROP POLICY IF EXISTS "tests_insert_own" ON public.tests;
DROP POLICY IF EXISTS "test_answers_insert_own" ON public.test_answers;

-- XP is awarded by record_test and battle results only.
REVOKE EXECUTE ON FUNCTION public.increment_xp(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_xp(UUID, INTEGER) TO service_role;

-- Same normalising as /api/check-answer: case and spacing don't matter.
CREATE OR REPLACE FUNCTION public.norm_answer(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'));
$$;

-- An option-based answer is right when it picks exactly the correct options.
CREATE OR REPLACE FUNCTION public.options_match(p_selected JSONB, p_correct JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(p_selected) = 'array' AND jsonb_typeof(p_correct) = 'array'
    AND jsonb_array_length(p_selected) > 0
    AND (SELECT array_agg(DISTINCT v ORDER BY v) FROM jsonb_array_elements_text(p_selected) v)
      = (SELECT array_agg(DISTINCT v ORDER BY v) FROM jsonb_array_elements_text(p_correct) v);
$$;

-- XP and the daily streak after a test or battle. Internal only.
CREATE OR REPLACE FUNCTION public.apply_test_rewards(p_user UUID, p_xp INTEGER)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  last_date DATE;
BEGIN
  SELECT last_practice_date INTO last_date FROM public.users WHERE id = p_user;
  UPDATE public.users SET
    xp = xp + greatest(0, coalesce(p_xp, 0)),
    total_tests_taken = total_tests_taken + 1,
    practice_streak = CASE
      WHEN last_date = CURRENT_DATE THEN practice_streak
      WHEN last_date = CURRENT_DATE - 1 THEN practice_streak + 1
      ELSE 1 END,
    last_practice_date = CURRENT_DATE
  WHERE id = p_user;
END;
$$;

-- Marks a practice session or mock exam and saves it. Called only by
-- /api/tests/submit (service role), which has already checked the
-- fill-in-the-blank answers that need AI marking and passes those it
-- judged right in p_fill_ok. Everything else is marked here.
-- p_answers: [{ "question_id": uuid, "selected": [text], "confidence": "sure"|"unsure"|null }]
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
  IF p_type NOT IN ('practice', 'exam_simulation') THEN RAISE EXCEPTION 'bad_type'; END IF;
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

  -- Every question once, approved, and from this course.
  SELECT count(DISTINCT s.question_id) INTO matched
  FROM pg_temp.submitted s
  JOIN public.questions q ON q.id = s.question_id AND q.course_id = p_course AND q.is_approved;
  IF matched <> n THEN RAISE EXCEPTION 'bad_questions'; END IF;

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
  -- A deleted topic shouldn't fail the save.
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

  RETURN QUERY SELECT new_id, got, n;
END;
$$;

-- ── 2. Class battles ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.classroom_battles (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  classroom_id         UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  host_id              UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id            UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  topic_ids            UUID[] NOT NULL DEFAULT '{}',
  status               TEXT NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby', 'live', 'finished', 'cancelled')),
  question_count       INTEGER NOT NULL,
  seconds_per_question INTEGER NOT NULL DEFAULT 20,
  reveal_seconds       INTEGER NOT NULL DEFAULT 6,
  created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  started_at           TIMESTAMP WITH TIME ZONE,  -- when question 1 opens
  finished_at          TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_classroom_battles_room ON public.classroom_battles(classroom_id, created_at DESC);

-- Which questions, in order. Never readable by students: it names the
-- question ids, and the answers are one lookup away from those.
CREATE TABLE IF NOT EXISTS public.classroom_battle_questions (
  battle_id   UUID NOT NULL REFERENCES public.classroom_battles(id) ON DELETE CASCADE,
  idx         INTEGER NOT NULL,
  question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  PRIMARY KEY (battle_id, idx)
);

CREATE TABLE IF NOT EXISTS public.classroom_battle_players (
  battle_id UUID NOT NULL REFERENCES public.classroom_battles(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  -- Filled in when the battle finishes; live scores come from the answers.
  score     INTEGER NOT NULL DEFAULT 0,
  correct   INTEGER NOT NULL DEFAULT 0,
  answered  INTEGER NOT NULL DEFAULT 0,
  rank      INTEGER,
  PRIMARY KEY (battle_id, user_id)
);

-- One answer per player per question; read only through the RPCs, so
-- nobody sees who got it right until the question closes.
CREATE TABLE IF NOT EXISTS public.classroom_battle_answers (
  battle_id  UUID NOT NULL REFERENCES public.classroom_battles(id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  selected   JSONB NOT NULL,
  is_correct BOOLEAN NOT NULL,
  points     INTEGER NOT NULL,
  answer_ms  INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (battle_id, idx, user_id)
);

ALTER TABLE public.tests ADD COLUMN IF NOT EXISTS battle_id UUID REFERENCES public.classroom_battles(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tests_battle_user ON public.tests(battle_id, user_id) WHERE battle_id IS NOT NULL;

ALTER TABLE public.classroom_battles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_battle_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_battle_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_battle_answers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.classroom_battle_questions, public.classroom_battle_answers FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.classroom_battles, public.classroom_battle_players FROM anon, authenticated;

-- Members can see their classroom's battles and who's in them (the lobby
-- updates live from these); every write goes through the RPCs below.
DROP POLICY IF EXISTS "classroom_battles_select_member" ON public.classroom_battles;
CREATE POLICY "classroom_battles_select_member" ON public.classroom_battles FOR SELECT
  USING (public.classroom_role(classroom_id) IS NOT NULL);
DROP POLICY IF EXISTS "classroom_battle_players_select_member" ON public.classroom_battle_players;
CREATE POLICY "classroom_battle_players_select_member" ON public.classroom_battle_players FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.classroom_battles b
                 WHERE b.id = battle_id AND public.classroom_role(b.classroom_id) IS NOT NULL));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'classroom_battles') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.classroom_battles;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'classroom_battle_players') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.classroom_battle_players;
    END IF;
  END IF;
END $$;

-- "X started a battle" in the chat comes only from create_classroom_battle.
ALTER TABLE public.classroom_messages DROP CONSTRAINT IF EXISTS classroom_messages_kind_check;
ALTER TABLE public.classroom_messages ADD CONSTRAINT classroom_messages_kind_check
  CHECK (kind IN ('text', 'call', 'call_end', 'resource', 'battle'));

CREATE OR REPLACE FUNCTION public.classroom_messages_battle_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'battle' AND coalesce(current_setting('pastcs.battle_post', true), '') <> 'on' THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS classroom_messages_battle_guard ON public.classroom_messages;
CREATE TRIGGER classroom_messages_battle_guard BEFORE INSERT ON public.classroom_messages
  FOR EACH ROW EXECUTE FUNCTION public.classroom_messages_battle_guard();

-- Where a battle is right now, worked out from the clock: a short
-- countdown, then for each question `seconds_per_question` to answer and
-- `reveal_seconds` showing the answer and the leaderboard.
CREATE OR REPLACE FUNCTION public.battle_phase(b public.classroom_battles, p_at TIMESTAMP WITH TIME ZONE DEFAULT now())
RETURNS TABLE (phase TEXT, idx INTEGER, ends_at TIMESTAMP WITH TIME ZONE)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  slot_len NUMERIC := b.seconds_per_question + b.reveal_seconds;
  elapsed NUMERIC;
  slot INTEGER;
BEGIN
  IF b.status IN ('lobby', 'cancelled') THEN RETURN QUERY SELECT b.status, -1, NULL::timestamptz; RETURN; END IF;
  IF b.status = 'finished' THEN RETURN QUERY SELECT 'finished'::text, b.question_count - 1, NULL::timestamptz; RETURN; END IF;
  elapsed := extract(epoch FROM p_at - b.started_at);
  IF elapsed < 0 THEN RETURN QUERY SELECT 'countdown'::text, -1, b.started_at; RETURN; END IF;
  slot := floor(elapsed / slot_len);
  IF slot >= b.question_count THEN RETURN QUERY SELECT 'finished'::text, b.question_count - 1, NULL::timestamptz; RETURN; END IF;
  IF elapsed - slot * slot_len < b.seconds_per_question THEN
    RETURN QUERY SELECT 'question'::text, slot, b.started_at + make_interval(secs => slot * slot_len + b.seconds_per_question);
  ELSE
    RETURN QUERY SELECT 'reveal'::text, slot, b.started_at + make_interval(secs => (slot + 1) * slot_len);
  END IF;
END;
$$;

-- Tidies a classroom's battles: a lobby nobody started in 30 minutes is
-- cancelled, and a battle whose last question has closed is finished —
-- scores ranked, a `tests` row and XP for everyone who answered.
-- Idempotent (the row lock + status check), so any caller can run it.
CREATE OR REPLACE FUNCTION public.settle_classroom_battles(p_classroom UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b public.classroom_battles%ROWTYPE;
  ph TEXT;
  contenders INTEGER;
  p RECORD;
  new_test UUID;
BEGIN
  UPDATE public.classroom_battles SET status = 'cancelled', finished_at = now()
  WHERE classroom_id = p_classroom AND status = 'lobby' AND created_at < now() - INTERVAL '30 minutes';

  FOR b IN SELECT * FROM public.classroom_battles
           WHERE classroom_id = p_classroom AND status = 'live' FOR UPDATE LOOP
    SELECT x.phase INTO ph FROM public.battle_phase(b) x;
    CONTINUE WHEN ph <> 'finished';

    UPDATE public.classroom_battle_players pl SET
      score = coalesce(a.score, 0), correct = coalesce(a.correct, 0), answered = coalesce(a.answered, 0)
    FROM (SELECT pl2.user_id,
                 sum(ans.points)::int AS score,
                 count(*) FILTER (WHERE ans.is_correct)::int AS correct,
                 count(ans.idx)::int AS answered
          FROM public.classroom_battle_players pl2
          LEFT JOIN public.classroom_battle_answers ans ON ans.battle_id = pl2.battle_id AND ans.user_id = pl2.user_id
          WHERE pl2.battle_id = b.id GROUP BY pl2.user_id) a
    WHERE pl.battle_id = b.id AND pl.user_id = a.user_id;

    UPDATE public.classroom_battle_players pl SET rank = r.rnk
    FROM (SELECT user_id, rank() OVER (ORDER BY score DESC, correct DESC)::int AS rnk
          FROM public.classroom_battle_players WHERE battle_id = b.id AND answered > 0) r
    WHERE pl.battle_id = b.id AND pl.user_id = r.user_id;

    SELECT count(*) INTO contenders FROM public.classroom_battle_players WHERE battle_id = b.id AND answered > 0;

    FOR p IN SELECT * FROM public.classroom_battle_players WHERE battle_id = b.id AND answered > 0 LOOP
      INSERT INTO public.tests (user_id, course_id, test_type, score, total_questions, percentage, completed_at, battle_id)
      VALUES (p.user_id, b.course_id, 'battle', p.correct, p.answered, round(p.correct::NUMERIC * 100 / p.answered, 2), now(), b.id)
      ON CONFLICT DO NOTHING
      RETURNING id INTO new_test;
      CONTINUE WHEN new_test IS NULL;
      INSERT INTO public.test_answers (test_id, question_id, selected_answer, is_correct)
      SELECT new_test, bq.question_id, ans.selected, ans.is_correct
      FROM public.classroom_battle_answers ans
      JOIN public.classroom_battle_questions bq ON bq.battle_id = ans.battle_id AND bq.idx = ans.idx
      WHERE ans.battle_id = b.id AND ans.user_id = p.user_id;
      -- 10 XP a correct answer, like practice, plus a podium bonus when
      -- there was someone to beat.
      PERFORM public.apply_test_rewards(p.user_id, p.correct * 10 + CASE
        WHEN contenders < 2 THEN 0 WHEN p.rank = 1 THEN 30 WHEN p.rank = 2 THEN 20 WHEN p.rank = 3 THEN 10 ELSE 0 END);
      new_test := NULL;
    END LOOP;

    UPDATE public.classroom_battles SET status = 'finished', finished_at = now() WHERE id = b.id;
  END LOOP;
END;
$$;

-- Any member can open a battle on the classroom's course: up to 10
-- random option questions (typed answers need AI marking — too slow for
-- a 20-second round), optionally from chosen topics.
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

CREATE OR REPLACE FUNCTION public.join_classroom_battle(p_battle UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me UUID := auth.uid();
  b public.classroom_battles%ROWTYPE;
BEGIN
  SELECT * INTO b FROM public.classroom_battles WHERE id = p_battle FOR UPDATE;
  IF me IS NULL OR b.id IS NULL OR public.classroom_role(b.classroom_id) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF EXISTS (SELECT 1 FROM public.classroom_battle_players WHERE battle_id = p_battle AND user_id = me) THEN RETURN; END IF;
  IF b.status <> 'lobby' THEN RAISE EXCEPTION 'battle_started'; END IF;
  IF coalesce(public.course_access_for(me, b.course_id), '') NOT IN ('free', 'paid') THEN RAISE EXCEPTION 'payment_required'; END IF;
  IF (SELECT count(*) FROM public.classroom_battle_players WHERE battle_id = p_battle) >= 50 THEN RAISE EXCEPTION 'battle_full'; END IF;
  INSERT INTO public.classroom_battle_players (battle_id, user_id) VALUES (p_battle, me);
END;
$$;

-- Leave a lobby (the host cancels instead).
CREATE OR REPLACE FUNCTION public.leave_classroom_battle(p_battle UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.classroom_battle_players pl
  USING public.classroom_battles b
  WHERE pl.battle_id = p_battle AND pl.user_id = auth.uid()
    AND b.id = pl.battle_id AND b.status = 'lobby' AND b.host_id <> auth.uid();
$$;

-- The host (or the classroom's owner/leaders) starts it for everyone:
-- question 1 opens 4 seconds later, the same moment on every phone.
CREATE OR REPLACE FUNCTION public.start_classroom_battle(p_battle UUID)
RETURNS TIMESTAMP WITH TIME ZONE
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b public.classroom_battles%ROWTYPE;
  at TIMESTAMP WITH TIME ZONE := now() + INTERVAL '4 seconds';
BEGIN
  SELECT * INTO b FROM public.classroom_battles WHERE id = p_battle FOR UPDATE;
  IF b.id IS NULL OR public.classroom_role(b.classroom_id) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF b.host_id <> auth.uid() AND public.classroom_role(b.classroom_id) NOT IN ('owner', 'leader') THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF b.status <> 'lobby' THEN RAISE EXCEPTION 'battle_started'; END IF;
  IF (SELECT count(*) FROM public.classroom_battle_players WHERE battle_id = p_battle) < 2 THEN RAISE EXCEPTION 'need_two_players'; END IF;
  UPDATE public.classroom_battles SET status = 'live', started_at = at WHERE id = p_battle;
  RETURN at;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_classroom_battle(p_battle UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b public.classroom_battles%ROWTYPE;
BEGIN
  SELECT * INTO b FROM public.classroom_battles WHERE id = p_battle FOR UPDATE;
  IF b.id IS NULL OR public.classroom_role(b.classroom_id) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF b.host_id <> auth.uid() AND public.classroom_role(b.classroom_id) NOT IN ('owner', 'leader') THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF b.status <> 'lobby' THEN RAISE EXCEPTION 'battle_started'; END IF;
  UPDATE public.classroom_battles SET status = 'cancelled', finished_at = now() WHERE id = p_battle;
END;
$$;

-- Lock in an answer for the open question. Points: 0 if wrong; if right,
-- 500 plus up to 500 for speed. A second and a half of grace covers the
-- trip from a slow phone. Returns nothing about whether it was right —
-- that's revealed to everyone together when the question closes.
CREATE OR REPLACE FUNCTION public.submit_battle_answer(p_battle UUID, p_idx INTEGER, p_selected JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me UUID := auth.uid();
  b public.classroom_battles%ROWTYPE;
  q public.questions%ROWTYPE;
  t NUMERIC;
  ok BOOLEAN;
  inserted INTEGER;
BEGIN
  SELECT * INTO b FROM public.classroom_battles WHERE id = p_battle;
  IF me IS NULL OR b.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.classroom_battle_players WHERE battle_id = p_battle AND user_id = me
  ) OR public.classroom_role(b.classroom_id) IS NULL THEN
    RAISE EXCEPTION 'not_in_battle';
  END IF;
  IF b.status <> 'live' OR p_idx IS NULL OR p_idx < 0 OR p_idx >= b.question_count THEN RAISE EXCEPTION 'question_closed'; END IF;
  t := extract(epoch FROM now() - (b.started_at + make_interval(secs => p_idx * (b.seconds_per_question + b.reveal_seconds))));
  IF t < 0 OR t > b.seconds_per_question + 1.5 THEN RAISE EXCEPTION 'question_closed'; END IF;
  IF jsonb_typeof(p_selected) <> 'array' OR jsonb_array_length(p_selected) NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'bad_answer'; END IF;

  SELECT qq.* INTO q FROM public.classroom_battle_questions bq JOIN public.questions qq ON qq.id = bq.question_id
  WHERE bq.battle_id = p_battle AND bq.idx = p_idx;
  ok := public.options_match(p_selected, q.correct_answers);

  INSERT INTO public.classroom_battle_answers (battle_id, idx, user_id, selected, is_correct, points, answer_ms)
  VALUES (p_battle, p_idx, me, p_selected, ok,
          CASE WHEN ok THEN 500 + round(500 * greatest(0, 1 - least(t, b.seconds_per_question) / b.seconds_per_question))::int ELSE 0 END,
          round(least(t, b.seconds_per_question) * 1000)::int)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF inserted = 0 THEN RAISE EXCEPTION 'already_answered'; END IF;
  RETURN jsonb_build_object('accepted', true);
END;
$$;

-- Everything a phone needs to draw the battle right now, so a player who
-- drops and comes back picks up exactly where everyone else is. The
-- correct answer is included only once the question has closed, and
-- scores only count closed questions.
CREATE OR REPLACE FUNCTION public.get_classroom_battle(p_battle UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me UUID := auth.uid();
  b public.classroom_battles%ROWTYPE;
  ph RECORD;
  closed_through INTEGER;  -- questions 0..closed_through count toward scores
  q public.questions%ROWTYPE;
  res JSONB;
BEGIN
  SELECT * INTO b FROM public.classroom_battles WHERE id = p_battle;
  IF me IS NULL OR b.id IS NULL OR public.classroom_role(b.classroom_id) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF b.status IN ('lobby', 'live') THEN
    PERFORM public.settle_classroom_battles(b.classroom_id);
    SELECT * INTO b FROM public.classroom_battles WHERE id = p_battle;
  END IF;
  SELECT * INTO ph FROM public.battle_phase(b);
  closed_through := CASE ph.phase WHEN 'question' THEN ph.idx - 1 WHEN 'reveal' THEN ph.idx WHEN 'finished' THEN b.question_count - 1 ELSE -1 END;

  res := jsonb_build_object(
    'id', b.id, 'classroom_id', b.classroom_id, 'host_id', b.host_id, 'status', b.status,
    'phase', ph.phase, 'idx', ph.idx, 'phase_ends_at', ph.ends_at, 'server_now', now(),
    'started_at', b.started_at, 'created_at', b.created_at, 'question_count', b.question_count,
    'seconds_per_question', b.seconds_per_question, 'reveal_seconds', b.reveal_seconds,
    'am_player', EXISTS (SELECT 1 FROM public.classroom_battle_players WHERE battle_id = b.id AND user_id = me),
    'topics', coalesce((SELECT jsonb_agg(tp.topic_name ORDER BY tp.topic_name) FROM public.topics tp WHERE tp.id = ANY (b.topic_ids)), '[]'::jsonb),
    'players', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', pl.user_id, 'full_name', u.full_name, 'avatar_url', u.avatar_url, 'is_me', pl.user_id = me,
        'score', coalesce(s.score, 0), 'correct', coalesce(s.correct, 0), 'rank', pl.rank,
        'last_points', CASE WHEN ph.phase IN ('reveal', 'finished') THEN s.last_points END,
        'answered_current', ph.phase = 'question' AND EXISTS (
          SELECT 1 FROM public.classroom_battle_answers a WHERE a.battle_id = b.id AND a.idx = ph.idx AND a.user_id = pl.user_id)
      ) ORDER BY coalesce(s.score, 0) DESC, coalesce(s.correct, 0) DESC, pl.joined_at)
      FROM public.classroom_battle_players pl
      JOIN public.users u ON u.id = pl.user_id
      LEFT JOIN LATERAL (
        SELECT sum(a.points)::int AS score, count(*) FILTER (WHERE a.is_correct)::int AS correct,
               max(a.points) FILTER (WHERE a.idx = closed_through) AS last_points
        FROM public.classroom_battle_answers a
        WHERE a.battle_id = b.id AND a.user_id = pl.user_id AND a.idx <= closed_through
      ) s ON TRUE
      WHERE pl.battle_id = b.id
    ), '[]'::jsonb)
  );

  IF ph.phase IN ('question', 'reveal') THEN
    SELECT qq.* INTO q FROM public.classroom_battle_questions bq JOIN public.questions qq ON qq.id = bq.question_id
    WHERE bq.battle_id = b.id AND bq.idx = ph.idx;
    res := res || jsonb_build_object('question', jsonb_build_object(
      'idx', ph.idx, 'type', q.question_type, 'text', q.question_text, 'options', q.options,
      'correct_answers', CASE WHEN ph.phase = 'reveal' THEN q.correct_answers END,
      'explanation', CASE WHEN ph.phase = 'reveal' THEN q.explanation END
    ));
    res := res || jsonb_build_object('my_answer', (
      SELECT jsonb_build_object('selected', a.selected,
        'is_correct', CASE WHEN ph.phase = 'reveal' THEN a.is_correct END,
        'points', CASE WHEN ph.phase = 'reveal' THEN a.points END)
      FROM public.classroom_battle_answers a WHERE a.battle_id = b.id AND a.idx = ph.idx AND a.user_id = me));
  END IF;
  RETURN res;
END;
$$;

-- The classroom's battles, newest first, for the Battles card: the open
-- one (if any) and recent results.
CREATE OR REPLACE FUNCTION public.get_classroom_battles(p_classroom UUID)
RETURNS TABLE (
  id UUID, status TEXT, host_id UUID, host_name TEXT, players INTEGER, question_count INTEGER,
  created_at TIMESTAMP WITH TIME ZONE, winner_name TEXT, my_rank INTEGER, my_score INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL OR public.classroom_role(p_classroom) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  PERFORM public.settle_classroom_battles(p_classroom);
  RETURN QUERY
  SELECT b.id, b.status, b.host_id, hu.full_name,
    (SELECT count(*)::int FROM public.classroom_battle_players pl WHERE pl.battle_id = b.id),
    b.question_count, b.created_at,
    (SELECT u.full_name FROM public.classroom_battle_players pl JOIN public.users u ON u.id = pl.user_id
     WHERE pl.battle_id = b.id AND pl.rank = 1 ORDER BY pl.correct DESC LIMIT 1),
    (SELECT pl.rank FROM public.classroom_battle_players pl WHERE pl.battle_id = b.id AND pl.user_id = auth.uid()),
    (SELECT pl.score FROM public.classroom_battle_players pl WHERE pl.battle_id = b.id AND pl.user_id = auth.uid())
  FROM public.classroom_battles b
  JOIN public.users hu ON hu.id = b.host_id
  WHERE b.classroom_id = p_classroom AND b.status <> 'cancelled'
  ORDER BY b.created_at DESC
  LIMIT 10;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_test(UUID, UUID, UUID, TEXT, JSONB, INTEGER, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_test(UUID, UUID, UUID, TEXT, JSONB, INTEGER, UUID[]) TO service_role;
REVOKE EXECUTE ON FUNCTION public.apply_test_rewards(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.settle_classroom_battles(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.battle_phase(public.classroom_battles, TIMESTAMP WITH TIME ZONE) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_classroom_battle(UUID, UUID[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.join_classroom_battle(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.leave_classroom_battle(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.start_classroom_battle(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_classroom_battle(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.submit_battle_answer(UUID, INTEGER, JSONB) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_classroom_battle(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_classroom_battles(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_classroom_battle(UUID, UUID[]), public.join_classroom_battle(UUID),
  public.leave_classroom_battle(UUID), public.start_classroom_battle(UUID), public.cancel_classroom_battle(UUID),
  public.submit_battle_answer(UUID, INTEGER, JSONB), public.get_classroom_battle(UUID), public.get_classroom_battles(UUID)
  TO authenticated;
