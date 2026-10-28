-- ================================================================
-- MIGRATION: Exam Boss (approved design, 2026-10-28)
-- ================================================================
-- A 2–3 minute fight: a robot boss attacks, the student dodges and hits
-- back by answering before a countdown runs out. Single and multiple
-- choice questions only.
--
-- The learning algorithm is an Elo-style rating. Each student has a
-- rating per course (starting 1000) and each question a difficulty
-- rating (from its tag, or its answer rate once it has 20+ answers).
-- After every answer, with E = 1 / (1 + 10^((Q − S) / 400)) and R = 1 for
-- right in time, else 0:
--     S ← S + K_s (R − E)   K_s = 32 for the first 30 answers, then 16
--     Q ← Q − 8 (R − E)
-- The next question aims for E = 0.70 (a question about 150 below the
-- student), 0.60 after three right in a row or when the boss is
-- enraged, 0.80 after two wrong in a row. The student's rating sets the
-- boss level (1–10): shorter countdowns and more boss health as it rises.
--
-- The server runs every fight: it sends one question at a time without
-- its answer, keeps the clock (1.5 s grace), works out damage, hearts,
-- power strikes and the KO, and updates both ratings. Fights give XP and
-- trophies but don't create tests, so they don't move grades.
--
-- Free access: 3 fights a day on the open topics; the Daily Boss is for
-- paid students (one attempt a day, the same 12 questions for everyone).
--
-- Safe to run more than once.
-- ================================================================

CREATE TABLE IF NOT EXISTS public.boss_ratings (
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id  UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  rating     NUMERIC NOT NULL DEFAULT 1000,
  answers    INTEGER NOT NULL DEFAULT 0,
  best_level INTEGER NOT NULL DEFAULT 1,
  wins       INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id)
);

CREATE TABLE IF NOT EXISTS public.question_ratings (
  question_id UUID PRIMARY KEY REFERENCES public.questions(id) ON DELETE CASCADE,
  rating      NUMERIC NOT NULL,
  answers     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.boss_fights (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id   UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  topic_id    UUID REFERENCES public.topics(id) ON DELETE SET NULL,
  is_daily    BOOLEAN NOT NULL DEFAULT false,
  daily_date  DATE,
  level       INTEGER NOT NULL,
  hearts      INTEGER NOT NULL DEFAULT 3,
  boss_hp     INTEGER NOT NULL,
  boss_max_hp INTEGER NOT NULL,
  streak      INTEGER NOT NULL DEFAULT 0,
  misses      INTEGER NOT NULL DEFAULT 0,
  power       BOOLEAN NOT NULL DEFAULT false,
  status      TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'won', 'lost', 'abandoned')),
  xp          INTEGER NOT NULL DEFAULT 0,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at    TIMESTAMPTZ,
  time_ms     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_boss_fights_user ON public.boss_fights(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_boss_fights_daily ON public.boss_fights(course_id, daily_date) WHERE is_daily;

CREATE TABLE IF NOT EXISTS public.boss_fight_answers (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fight_id      UUID NOT NULL REFERENCES public.boss_fights(id) ON DELETE CASCADE,
  idx           INTEGER NOT NULL,
  question_id   UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  countdown     INTEGER NOT NULL,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deadline      TIMESTAMPTZ NOT NULL,
  answered_at   TIMESTAMPTZ,
  selected      JSONB,
  is_correct    BOOLEAN,
  timed_out     BOOLEAN NOT NULL DEFAULT false,
  damage        INTEGER NOT NULL DEFAULT 0,
  rating_before NUMERIC,
  rating_after  NUMERIC,
  UNIQUE (fight_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_boss_answers_question ON public.boss_fight_answers(question_id);

-- topic_id = the nil uuid for a whole-course trophy.
CREATE TABLE IF NOT EXISTS public.boss_trophies (
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id     UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  topic_id      UUID NOT NULL,
  gold          BOOLEAN NOT NULL DEFAULT false,
  best_time_ms  INTEGER,
  first_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id, topic_id)
);

CREATE TABLE IF NOT EXISTS public.boss_daily (
  course_id    UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  day          DATE NOT NULL,
  question_ids UUID[] NOT NULL,
  PRIMARY KEY (course_id, day)
);

ALTER TABLE public.boss_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boss_fights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boss_fight_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boss_trophies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boss_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.boss_ratings, public.question_ratings, public.boss_fights, public.boss_fight_answers,
  public.boss_trophies, public.boss_daily FROM anon, authenticated;

-- ── Rules ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.boss_level(p_rating NUMERIC)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT least(10, greatest(1, floor((p_rating - 900) / 100)::int + 2));
$$;

CREATE OR REPLACE FUNCTION public.boss_name(p_level INTEGER, p_daily BOOLEAN DEFAULT false)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_daily THEN 'The Daily Boss'
              WHEN p_level <= 3 THEN 'Quiz Drone' WHEN p_level <= 6 THEN 'The Examiner'
              WHEN p_level <= 9 THEN 'Chief Invigilator' ELSE 'The Final Paper' END;
$$;

-- Seconds to answer. Multiple choice gets 4 more.
CREATE OR REPLACE FUNCTION public.boss_countdown(p_level INTEGER, p_enraged BOOLEAN, p_multi BOOLEAN)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT (CASE WHEN p_enraged THEN (ARRAY[11, 10, 9, 8, 7, 7, 6, 6, 6, 5])[p_level]
               ELSE (ARRAY[14, 13, 12, 11, 10, 10, 9, 9, 8, 8])[p_level] END)
         + CASE WHEN p_multi THEN 4 ELSE 0 END;
$$;

-- Boss health is counted in half-hits: a normal hit does 2, a fast one 3,
-- a power strike doubles. Level 1 needs 6 hits, level 10 needs 15.
CREATE OR REPLACE FUNCTION public.boss_max_hp(p_level INTEGER)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$ SELECT (5 + p_level) * 2; $$;

-- A question's difficulty rating: learned, else from its answer rate, else its tag.
CREATE OR REPLACE FUNCTION public.boss_question_rating(p_question UUID)
RETURNS NUMERIC
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT coalesce(
    (SELECT r.rating FROM public.question_ratings r WHERE r.question_id = p_question),
    (SELECT CASE
       WHEN coalesce(q.times_answered, 0) >= 20 THEN
         least(1400, greatest(600, 1000 + 400 * log(
           greatest(0.02, least(0.98, 1 - q.times_correct::numeric / q.times_answered))
           / greatest(0.02, least(0.98, q.times_correct::numeric / q.times_answered)))))
       WHEN q.difficulty = 'easy' THEN 850
       WHEN q.difficulty = 'hard' THEN 1150
       ELSE 1000 END
     FROM public.questions q WHERE q.id = p_question),
    1000);
$$;
REVOKE EXECUTE ON FUNCTION public.boss_question_rating(UUID) FROM PUBLIC, anon, authenticated;

-- Questions a fight may use: approved single/multiple choice with options,
-- in the course (and topic), open topics only on free access.
CREATE OR REPLACE FUNCTION public.boss_pool(p_user UUID, p_course UUID, p_topic UUID)
RETURNS SETOF UUID
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT q.id FROM public.questions q
  WHERE q.course_id = p_course AND q.is_approved
    AND q.question_type IN ('single_choice', 'multiple_choice')
    AND jsonb_typeof(q.options) = 'array' AND jsonb_array_length(q.options) >= 2
    AND jsonb_typeof(q.correct_answers) = 'array' AND jsonb_array_length(q.correct_answers) >= 1
    AND (p_topic IS NULL OR q.topic_id = p_topic)
    AND (NOT public.is_free_access(p_user, p_course) OR q.topic_id IN (SELECT public.free_topic_ids(p_course)));
$$;
REVOKE EXECUTE ON FUNCTION public.boss_pool(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;

-- Send the next question of a fight. Its clock starts after p_pause
-- seconds (the "get ready" or the last answer's reveal); until then the
-- phone gets only its start time, not its text.
DROP FUNCTION IF EXISTS public.boss_next_question(UUID);
CREATE OR REPLACE FUNCTION public.boss_next_question(p_fight UUID, p_pause NUMERIC DEFAULT 0)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f public.boss_fights%ROWTYPE;
  s NUMERIC;
  target_e NUMERIC;
  target_q NUMERIC;
  qid UUID;
  qtype TEXT;
  n INTEGER;
  daily_ids UUID[];
BEGIN
  SELECT * INTO f FROM public.boss_fights WHERE id = p_fight;
  SELECT count(*) INTO n FROM public.boss_fight_answers WHERE fight_id = f.id;

  IF f.is_daily THEN
    SELECT question_ids INTO daily_ids FROM public.boss_daily WHERE course_id = f.course_id AND day = f.daily_date;
    qid := daily_ids[n + 1];
  ELSE
    SELECT coalesce((SELECT rating FROM public.boss_ratings WHERE user_id = f.user_id AND course_id = f.course_id), 1000) INTO s;
    target_e := CASE WHEN f.misses >= 2 THEN 0.80
                     WHEN f.streak >= 3 OR f.boss_hp * 2 <= f.boss_max_hp THEN 0.60
                     ELSE 0.70 END;
    target_q := s + 400 * log(1 / target_e - 1);
    -- Nearest to the target difficulty, with a little randomness; never a
    -- question already in this fight, and not one answered right in the
    -- last 7 days unless the pool would run dry.
    SELECT p.id INTO qid FROM public.boss_pool(f.user_id, f.course_id, f.topic_id) AS p(id)
    WHERE p.id NOT IN (SELECT question_id FROM public.boss_fight_answers WHERE fight_id = f.id)
    ORDER BY (EXISTS (
               SELECT 1 FROM public.boss_fight_answers a JOIN public.boss_fights bf ON bf.id = a.fight_id
               WHERE bf.user_id = f.user_id AND a.question_id = p.id AND a.is_correct AND a.answered_at > now() - interval '7 days')
             OR EXISTS (
               SELECT 1 FROM public.test_answers ta JOIN public.tests t ON t.id = ta.test_id
               WHERE t.user_id = f.user_id AND ta.question_id = p.id AND ta.is_correct AND t.created_at > now() - interval '7 days')),
             abs(public.boss_question_rating(p.id) - target_q) + random() * 60
    LIMIT 1;
  END IF;

  IF qid IS NULL THEN RETURN; END IF;
  SELECT question_type INTO qtype FROM public.questions WHERE id = qid;
  INSERT INTO public.boss_fight_answers (fight_id, idx, question_id, countdown, sent_at, deadline)
  VALUES (f.id, n, qid,
          public.boss_countdown(f.level, f.boss_hp * 2 <= f.boss_max_hp, qtype = 'multiple_choice'),
          clock_timestamp() + make_interval(secs => p_pause),
          clock_timestamp() + make_interval(secs => p_pause + public.boss_countdown(f.level, f.boss_hp * 2 <= f.boss_max_hp, qtype = 'multiple_choice')));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.boss_next_question(UUID, NUMERIC) FROM PUBLIC, anon, authenticated;

-- Finish a fight: time, XP, trophies, wins.
CREATE OR REPLACE FUNCTION public.boss_finish(p_fight UUID, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f public.boss_fights%ROWTYPE;
  ms INTEGER;
  gained INTEGER;
BEGIN
  SELECT * INTO f FROM public.boss_fights WHERE id = p_fight FOR UPDATE;
  IF f.status <> 'live' THEN RETURN; END IF;
  ms := (extract(epoch FROM clock_timestamp() - f.started_at) * 1000)::int;
  gained := f.xp + CASE WHEN p_status = 'won' THEN CASE WHEN f.is_daily THEN 100 ELSE 50 END ELSE 0 END;
  UPDATE public.boss_fights SET status = p_status, ended_at = clock_timestamp(), time_ms = ms, xp = gained WHERE id = f.id;
  UPDATE public.users SET xp = xp + gained WHERE id = f.user_id;
  IF p_status = 'won' THEN
    UPDATE public.boss_ratings SET wins = wins + 1 WHERE user_id = f.user_id AND course_id = f.course_id;
    IF NOT f.is_daily THEN
      INSERT INTO public.boss_trophies (user_id, course_id, topic_id, gold, best_time_ms)
      VALUES (f.user_id, f.course_id, coalesce(f.topic_id, '00000000-0000-0000-0000-000000000000'), f.hearts = 3, ms)
      ON CONFLICT (user_id, course_id, topic_id) DO UPDATE
        SET gold = boss_trophies.gold OR EXCLUDED.gold,
            best_time_ms = least(boss_trophies.best_time_ms, EXCLUDED.best_time_ms);
    END IF;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.boss_finish(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- Mark the current question: right (in time) or not, then the ratings,
-- damage, hearts, streak and the end of the fight.
CREATE OR REPLACE FUNCTION public.boss_resolve(p_fight UUID, p_selected JSONB, p_timeout BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f public.boss_fights%ROWTYPE;
  a public.boss_fight_answers%ROWTYPE;
  q public.questions%ROWTYPE;
  s NUMERIC;
  s_answers INTEGER;
  qr NUMERIC;
  e NUMERIC;
  r INTEGER;
  ok BOOLEAN;
  late BOOLEAN;
  dmg INTEGER := 0;
  total INTEGER;
BEGIN
  SELECT * INTO f FROM public.boss_fights WHERE id = p_fight FOR UPDATE;
  IF f.status <> 'live' THEN RETURN; END IF;
  SELECT * INTO a FROM public.boss_fight_answers WHERE fight_id = f.id AND answered_at IS NULL ORDER BY idx DESC LIMIT 1 FOR UPDATE;
  IF a.id IS NULL THEN RETURN; END IF;
  SELECT * INTO q FROM public.questions WHERE id = a.question_id;

  late := clock_timestamp() > a.deadline + interval '1.5 seconds';
  ok := NOT p_timeout AND NOT late AND public.options_match(coalesce(p_selected, '[]'::jsonb), q.correct_answers);
  r := CASE WHEN ok THEN 1 ELSE 0 END;

  -- The learning step.
  INSERT INTO public.boss_ratings (user_id, course_id) VALUES (f.user_id, f.course_id) ON CONFLICT DO NOTHING;
  SELECT rating, answers INTO s, s_answers FROM public.boss_ratings WHERE user_id = f.user_id AND course_id = f.course_id FOR UPDATE;
  qr := public.boss_question_rating(q.id);
  e := 1 / (1 + power(10, (qr - s) / 400));
  UPDATE public.boss_ratings
  SET rating = s + CASE WHEN s_answers < 30 THEN 32 ELSE 16 END * (r - e),
      answers = answers + 1,
      best_level = greatest(best_level, public.boss_level(s + CASE WHEN s_answers < 30 THEN 32 ELSE 16 END * (r - e))),
      updated_at = now()
  WHERE user_id = f.user_id AND course_id = f.course_id;
  INSERT INTO public.question_ratings (question_id, rating, answers) VALUES (q.id, qr - 8 * (r - e), 1)
  ON CONFLICT (question_id) DO UPDATE SET rating = question_ratings.rating - 8 * (r - e), answers = question_ratings.answers + 1;

  IF ok THEN
    -- Fast (within the first 40% of the countdown): 3 half-hits, else 2;
    -- a charged power strike doubles it.
    dmg := CASE WHEN clock_timestamp() <= a.sent_at + make_interval(secs => a.countdown * 0.4) THEN 3 ELSE 2 END;
    IF f.power THEN dmg := dmg * 2; f.power := false; END IF;
    f.boss_hp := greatest(0, f.boss_hp - dmg);
    f.streak := f.streak + 1;
    f.misses := 0;
    IF f.streak % 3 = 0 THEN f.power := true; END IF;
    f.xp := f.xp + 10;
  ELSE
    f.hearts := f.hearts - 1;
    f.streak := 0;
    f.misses := f.misses + 1;
    f.power := false;
  END IF;

  UPDATE public.boss_fight_answers
  SET answered_at = clock_timestamp(), selected = p_selected, is_correct = ok, timed_out = (p_timeout OR late),
      damage = dmg, rating_before = s, rating_after = s + CASE WHEN s_answers < 30 THEN 32 ELSE 16 END * (r - e)
  WHERE id = a.id;
  UPDATE public.boss_fights SET boss_hp = f.boss_hp, hearts = f.hearts, streak = f.streak, misses = f.misses,
    power = f.power, xp = f.xp WHERE id = f.id;

  SELECT count(*) INTO total FROM public.boss_fight_answers WHERE fight_id = f.id;
  IF f.boss_hp <= 0 THEN
    PERFORM public.boss_finish(f.id, 'won');
  ELSIF f.hearts <= 0 OR total >= 30 THEN
    PERFORM public.boss_finish(f.id, 'lost');
  ELSE
    PERFORM public.boss_next_question(f.id, CASE WHEN ok THEN 1.2 ELSE 2.5 END);
    IF NOT EXISTS (SELECT 1 FROM public.boss_fight_answers WHERE fight_id = f.id AND answered_at IS NULL) THEN
      PERFORM public.boss_finish(f.id, 'lost'); -- ran out of questions
    END IF;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.boss_resolve(UUID, JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- ── What students call ───────────────────────────────────────────────
-- Start a fight. p_daily: today's Daily Boss (paid only, once a day).
CREATE OR REPLACE FUNCTION public.start_boss_fight(p_course UUID, p_topic UUID DEFAULT NULL, p_daily BOOLEAN DEFAULT false)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me UUID := auth.uid();
  free BOOLEAN;
  s NUMERIC;
  lvl INTEGER;
  fid UUID;
  pool_size INTEGER;
  ids UUID[];
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF coalesce(public.course_access_for(me, p_course), '') NOT IN ('free', 'paid')
     AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = me AND role IN ('admin', 'super_admin')) THEN
    RAISE EXCEPTION 'payment_required';
  END IF;
  free := public.is_free_access(me, p_course);
  IF p_topic IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.topics WHERE id = p_topic AND course_id = p_course) THEN
    RAISE EXCEPTION 'bad_topic';
  END IF;
  IF free AND p_topic IS NOT NULL AND p_topic NOT IN (SELECT public.free_topic_ids(p_course)) THEN
    RAISE EXCEPTION 'topic_locked';
  END IF;

  -- One live fight at a time: an unfinished one is abandoned.
  UPDATE public.boss_fights SET status = 'abandoned', ended_at = now() WHERE user_id = me AND status = 'live';

  IF p_daily THEN
    IF free THEN RAISE EXCEPTION 'daily_paid_only'; END IF;
    IF EXISTS (SELECT 1 FROM public.boss_fights WHERE user_id = me AND course_id = p_course AND is_daily AND daily_date = CURRENT_DATE) THEN
      RAISE EXCEPTION 'daily_done';
    END IF;
    -- Today's 12 questions, the same for everyone, picked on first use.
    IF NOT EXISTS (SELECT 1 FROM public.boss_daily WHERE course_id = p_course AND day = CURRENT_DATE) THEN
      SELECT array_agg(id) INTO ids FROM (
        SELECT p.id FROM public.boss_pool(NULL, p_course, NULL) AS p(id) ORDER BY random() LIMIT 12) x;
      IF coalesce(array_length(ids, 1), 0) < 12 THEN RAISE EXCEPTION 'not_enough_questions'; END IF;
      INSERT INTO public.boss_daily (course_id, day, question_ids) VALUES (p_course, CURRENT_DATE, ids)
      ON CONFLICT DO NOTHING;
    END IF;
    lvl := 5;
    INSERT INTO public.boss_fights (user_id, course_id, is_daily, daily_date, level, boss_hp, boss_max_hp)
    VALUES (me, p_course, true, CURRENT_DATE, lvl, 20, 20) RETURNING id INTO fid;
  ELSE
    IF free AND (SELECT count(*) FROM public.boss_fights WHERE user_id = me AND NOT is_daily
                 AND started_at::date = CURRENT_DATE) >= 3 THEN
      RAISE EXCEPTION 'free_limit_fights';
    END IF;
    SELECT count(*) INTO pool_size FROM public.boss_pool(me, p_course, p_topic);
    IF pool_size < 15 THEN RAISE EXCEPTION 'not_enough_questions'; END IF;
    SELECT coalesce((SELECT rating FROM public.boss_ratings WHERE user_id = me AND course_id = p_course), 1000) INTO s;
    lvl := public.boss_level(s);
    INSERT INTO public.boss_fights (user_id, course_id, topic_id, level, boss_hp, boss_max_hp)
    VALUES (me, p_course, p_topic, lvl, public.boss_max_hp(lvl), public.boss_max_hp(lvl)) RETURNING id INTO fid;
  END IF;

  PERFORM public.boss_next_question(fid, 3);
  RETURN fid;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.start_boss_fight(UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_boss_fight(UUID, UUID, BOOLEAN) TO authenticated;

-- The fight as the phone shows it. A question past its deadline is
-- resolved as a time-out first. The current question never carries its
-- answer; the last one does.
CREATE OR REPLACE FUNCTION public.get_boss_fight(p_fight UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me UUID := auth.uid();
  f public.boss_fights%ROWTYPE;
  cur RECORD;
  prev RECORD;
  co public.courses%ROWTYPE;
BEGIN
  SELECT * INTO f FROM public.boss_fights WHERE id = p_fight;
  IF me IS NULL OR f.id IS NULL OR f.user_id <> me THEN RAISE EXCEPTION 'not_found'; END IF;
  IF f.status = 'live' AND EXISTS (
    SELECT 1 FROM public.boss_fight_answers WHERE fight_id = f.id AND answered_at IS NULL
      AND deadline + interval '1.5 seconds' < clock_timestamp()) THEN
    PERFORM public.boss_resolve(f.id, NULL, true);
    SELECT * INTO f FROM public.boss_fights WHERE id = p_fight;
  END IF;
  SELECT * INTO co FROM public.courses WHERE id = f.course_id;

  SELECT a.idx, a.sent_at, a.deadline, a.countdown, q.id AS qid, q.question_type, q.question_text, q.options INTO cur
  FROM public.boss_fight_answers a JOIN public.questions q ON q.id = a.question_id
  WHERE a.fight_id = f.id AND a.answered_at IS NULL AND f.status = 'live' ORDER BY a.idx DESC LIMIT 1;
  SELECT a.idx, a.is_correct, a.timed_out, a.damage, a.selected, q.correct_answers, q.explanation INTO prev
  FROM public.boss_fight_answers a JOIN public.questions q ON q.id = a.question_id
  WHERE a.fight_id = f.id AND a.answered_at IS NOT NULL ORDER BY a.idx DESC LIMIT 1;

  RETURN jsonb_build_object(
    'id', f.id, 'status', f.status, 'course_id', f.course_id, 'course_code', co.course_code,
    'topic_id', f.topic_id, 'is_daily', f.is_daily,
    'level', f.level, 'boss_name', public.boss_name(f.level, f.is_daily),
    'hearts', f.hearts, 'boss_hp', f.boss_hp, 'boss_max_hp', f.boss_max_hp,
    'streak', f.streak, 'power', f.power, 'enraged', f.boss_hp * 2 <= f.boss_max_hp,
    'xp', f.xp, 'time_ms', f.time_ms, 'server_now', clock_timestamp(),
    'answered', (SELECT count(*) FROM public.boss_fight_answers WHERE fight_id = f.id AND answered_at IS NOT NULL),
    'right', (SELECT count(*) FROM public.boss_fight_answers WHERE fight_id = f.id AND is_correct),
    'rating', (SELECT round(rating) FROM public.boss_ratings WHERE user_id = me AND course_id = f.course_id),
    'question', CASE WHEN cur.qid IS NOT NULL THEN jsonb_build_object(
      'idx', cur.idx, 'type', cur.question_type, 'starts_at', cur.sent_at, 'deadline', cur.deadline, 'countdown', cur.countdown,
      'text', CASE WHEN cur.sent_at <= clock_timestamp() THEN cur.question_text END,
      'options', CASE WHEN cur.sent_at <= clock_timestamp() THEN cur.options END) END,
    'last', CASE WHEN prev.idx IS NOT NULL THEN jsonb_build_object(
      'idx', prev.idx, 'correct', prev.is_correct, 'timed_out', prev.timed_out, 'damage', prev.damage,
      'selected', prev.selected, 'correct_answers', prev.correct_answers, 'explanation', prev.explanation) END
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_boss_fight(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_boss_fight(UUID) TO authenticated;

-- Answer the current question (p_selected null = gave up / timed out).
CREATE OR REPLACE FUNCTION public.answer_boss_fight(p_fight UUID, p_idx INTEGER, p_selected JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me UUID := auth.uid();
  f public.boss_fights%ROWTYPE;
BEGIN
  SELECT * INTO f FROM public.boss_fights WHERE id = p_fight;
  IF me IS NULL OR f.id IS NULL OR f.user_id <> me THEN RAISE EXCEPTION 'not_found'; END IF;
  IF f.status = 'live' AND EXISTS (SELECT 1 FROM public.boss_fight_answers
                                   WHERE fight_id = f.id AND idx = p_idx AND answered_at IS NULL
                                     AND sent_at <= clock_timestamp()) THEN
    PERFORM public.boss_resolve(f.id, CASE WHEN jsonb_typeof(p_selected) = 'array' THEN p_selected END, p_selected IS NULL);
  END IF;
  RETURN public.get_boss_fight(p_fight);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.answer_boss_fight(UUID, INTEGER, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.answer_boss_fight(UUID, INTEGER, JSONB) TO authenticated;

-- The boss hub for a course: level, rating, fights left, Daily Boss, trophies.
CREATE OR REPLACE FUNCTION public.get_boss_home(p_course UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  me UUID := auth.uid();
  br public.boss_ratings%ROWTYPE;
  free BOOLEAN;
  lvl INTEGER;
  daily public.boss_fights%ROWTYPE;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF coalesce(public.course_access_for(me, p_course), '') NOT IN ('free', 'paid')
     AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = me AND role IN ('admin', 'super_admin')) THEN
    RETURN jsonb_build_object('access', 'locked');
  END IF;
  SELECT * INTO br FROM public.boss_ratings WHERE user_id = me AND course_id = p_course;
  free := public.is_free_access(me, p_course);
  lvl := public.boss_level(coalesce(br.rating, 1000));
  SELECT * INTO daily FROM public.boss_fights WHERE user_id = me AND course_id = p_course AND is_daily AND daily_date = CURRENT_DATE
  ORDER BY started_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'access', 'ok', 'free', free,
    'rating', round(coalesce(br.rating, 1000)), 'level', lvl, 'boss_name', public.boss_name(lvl),
    'next_level_at', CASE WHEN lvl < 10 THEN 900 + (lvl - 1) * 100 END,
    'best_level', coalesce(br.best_level, 1), 'wins', coalesce(br.wins, 0),
    'fights_today', (SELECT count(*) FROM public.boss_fights WHERE user_id = me AND NOT is_daily AND started_at::date = CURRENT_DATE),
    'free_limit', CASE WHEN free THEN 3 END,
    'pool', (SELECT count(*) FROM public.boss_pool(me, p_course, NULL)),
    'daily', jsonb_build_object('status', coalesce(daily.status, 'open'), 'time_ms', daily.time_ms, 'fight_id', daily.id),
    'trophies', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'topic_id', NULLIF(t.topic_id, '00000000-0000-0000-0000-000000000000'),
        'topic_name', (SELECT topic_name FROM public.topics WHERE id = t.topic_id),
        'gold', t.gold, 'best_time_ms', t.best_time_ms) ORDER BY t.first_at)
      FROM public.boss_trophies t WHERE t.user_id = me AND t.course_id = p_course), '[]'::jsonb)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_boss_home(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_boss_home(UUID) TO authenticated;

-- Today's fastest Daily Boss KOs in a course (or within one classroom).
CREATE OR REPLACE FUNCTION public.get_daily_boss_board(p_course UUID, p_classroom UUID DEFAULT NULL)
RETURNS TABLE (rank INTEGER, user_id UUID, first_name TEXT, avatar_url TEXT, time_ms INTEGER, hearts INTEGER, is_me BOOLEAN)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH board AS (
    SELECT f.user_id, f.time_ms, f.hearts,
           rank() OVER (ORDER BY f.time_ms, f.hearts DESC)::int AS rnk
    FROM public.boss_fights f JOIN public.users u ON u.id = f.user_id
    WHERE f.course_id = p_course AND f.is_daily AND f.daily_date = CURRENT_DATE AND f.status = 'won'
      AND u.role = 'student' AND NOT u.is_suspended AND (u.leaderboard_visible OR u.id = auth.uid())
      AND (p_classroom IS NULL OR EXISTS (SELECT 1 FROM public.classroom_members m WHERE m.classroom_id = p_classroom AND m.user_id = f.user_id))
  )
  SELECT b.rnk, b.user_id, coalesce(nullif(split_part(btrim(u.full_name), ' ', 1), ''), 'Student'), u.avatar_url,
         b.time_ms, b.hearts, b.user_id = auth.uid()
  FROM board b JOIN public.users u ON u.id = b.user_id
  WHERE auth.uid() IS NOT NULL AND (b.rnk <= 20 OR b.user_id = auth.uid())
    AND (p_classroom IS NULL OR public.classroom_role(p_classroom) IS NOT NULL)
  ORDER BY b.rnk;
$$;
REVOKE EXECUTE ON FUNCTION public.get_daily_boss_board(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_boss_board(UUID, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
