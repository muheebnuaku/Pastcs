-- ================================================================
-- MIGRATION: Accurate, once-only reminders
-- ================================================================
-- The streak, inactivity and milestone reminders were written by the
-- student's browser each time the app loaded, with a "once a day" check
-- kept in that browser. What went wrong:
--   * "Your 1-day streak is at risk!" fired after 2+ days without
--     practice — by then the streak had already broken — and every
--     device, tab or cleared browser sent it again;
--   * "You haven't taken an exam in 226 days" counted any quiz, repeated
--     every 3 days with a growing number, forever, and said "999 days"
--     to students who had never taken one;
--   * a milestone repeated daily while the test count sat on it.
--
-- generate_my_reminders() now does this in the database, for the caller
-- only. Every reminder has a dedupe_key (type + day, absence or
-- milestone) and a unique index, so it can't be created twice. A streak
-- that has already broken is set to 0 (the dashboard was showing it as
-- alive). Students can no longer insert notifications themselves: only
-- these reminders did, and it let anyone fake a "Message from PastCS"
-- in their own bell.
--
-- Clean-up: the old misleading streak and inactivity reminders are
-- removed, and repeated milestones are cut to one each.
--
-- Safe to run more than once.
-- ================================================================

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS link TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

-- ── Clean-up of what the old code wrote ──────────────────────────────
DELETE FROM public.notifications WHERE type IN ('streak_risk', 'inactivity') AND dedupe_key IS NULL;
UPDATE public.notifications SET dedupe_key = 'milestone:' || CASE
    WHEN message LIKE '%first test%' THEN '1'
    WHEN message LIKE '%10 tests%' THEN '10'
    WHEN message LIKE '%25 tests%' THEN '25'
    WHEN message LIKE '%50 tests%' THEN '50'
    WHEN message LIKE '%100 tests%' THEN '100'
  END
WHERE type = 'milestone' AND dedupe_key IS NULL
  AND (message LIKE '%first test%' OR message ~ '(10|25|50|100) tests');
DELETE FROM public.notifications n
USING public.notifications keep
WHERE n.type = 'milestone' AND keep.type = 'milestone'
  AND n.user_id = keep.user_id AND n.dedupe_key = keep.dedupe_key
  AND (n.created_at, n.id) > (keep.created_at, keep.id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe ON public.notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

DROP POLICY IF EXISTS "notifications_insert_own" ON public.notifications;

-- ── The reminders ────────────────────────────────────────────────────
-- Returns how many new reminders were created. Dates are the database's
-- (UTC, which is Ghana time).
CREATE OR REPLACE FUNCTION public.generate_my_reminders()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me UUID := auth.uid();
  u public.users%ROWTYPE;
  last_test DATE;
  gap INTEGER;
  m INTEGER;
  made INTEGER := 0;
  n INTEGER;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT * INTO u FROM public.users WHERE id = me;
  IF u.id IS NULL OR u.role <> 'student' THEN RETURN 0; END IF;

  -- 1. Streak. Practised yesterday but not yet today: still savable.
  IF u.last_practice_date = CURRENT_DATE - 1 AND u.practice_streak >= 2 THEN
    INSERT INTO public.notifications (user_id, type, message, link, dedupe_key)
    VALUES (me, 'streak_risk',
            '🔥 Keep your ' || u.practice_streak || '-day streak going: practise today before midnight.',
            '/courses', 'streak_risk:' || CURRENT_DATE)
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; made := made + n;
  -- Missed a day: the streak is already gone. Say so once, and stop
  -- showing it as alive.
  ELSIF u.last_practice_date < CURRENT_DATE - 1 AND u.practice_streak > 0 THEN
    IF u.practice_streak >= 3 THEN
      INSERT INTO public.notifications (user_id, type, message, link, dedupe_key)
      VALUES (me, 'streak_lost',
              'Your ' || u.practice_streak || '-day streak ended. One quiz today starts a new one.',
              '/courses', 'streak_lost:' || u.last_practice_date)
      ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
      GET DIAGNOSTICS n = ROW_COUNT; made := made + n;
    END IF;
    UPDATE public.users SET practice_streak = 0 WHERE id = me;
  END IF;

  -- 2. Time away: one reminder per absence, after a week.
  SELECT max(created_at)::date INTO last_test FROM public.tests WHERE user_id = me;
  IF last_test IS NOT NULL THEN
    gap := CURRENT_DATE - last_test;
    IF gap >= 7 THEN
      INSERT INTO public.notifications (user_id, type, message, link, dedupe_key)
      VALUES (me, 'inactivity',
              CASE WHEN gap > 60
                THEN '📚 It’s been a while since your last quiz. A quick 10-question session gets you back on track.'
                ELSE '📚 It’s been ' || gap || ' days since your last quiz. A quick 10-question session gets you back on track.'
              END,
              '/courses', 'inactivity:' || last_test)
      ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
      GET DIAGNOSTICS n = ROW_COUNT; made := made + n;
    END IF;
  ELSIF u.created_at < now() - interval '2 days' THEN
    INSERT INTO public.notifications (user_id, type, message, link, dedupe_key)
    VALUES (me, 'inactivity', '📚 Try your first quiz: 10 questions, about 5 minutes.', '/courses', 'first_quiz')
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; made := made + n;
  END IF;

  -- 3. Milestones: the highest one reached, once.
  SELECT max(x) INTO m FROM unnest(ARRAY[1, 10, 25, 50, 100]) x WHERE x <= u.total_tests_taken;
  IF m IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, message, link, dedupe_key)
    VALUES (me, 'milestone', CASE m
              WHEN 1 THEN '🎉 You completed your first test. Great start!'
              WHEN 10 THEN '⚡ 10 tests completed. You’re building real momentum.'
              WHEN 25 THEN '🏆 25 tests done. You’re well on your way to exam readiness.'
              WHEN 50 THEN '🔥 50 tests completed. That’s serious commitment.'
              ELSE '👑 100 tests. Exams don’t stand a chance.'
            END,
            '/leaderboard?tab=achievements', 'milestone:' || m)
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; made := made + n;
  END IF;

  RETURN made;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.generate_my_reminders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_my_reminders() TO authenticated;

NOTIFY pgrst, 'reload schema';
