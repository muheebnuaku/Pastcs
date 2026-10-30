-- ================================================================
-- MIGRATION: A daily nudge on the lock screen (2026-10-31)
-- ================================================================
-- Every notification already reaches the phone (migration 046), but the
-- reminders that bring a student back (streak, time away) were only made
-- when they opened the app, so there was nothing to push while they were
-- away. send_daily_nudges() runs every day at 18:00 (Ghana time = UTC)
-- through pg_cron and gives each active student who hasn't practised yet
-- that day one notification, the most useful of:
--   1. their streak ends at midnight (always first when it applies);
--   2. they're a few correct answers from their next grade;
--   3. their weakest topic this semester, to cover today;
--   4. the Exam Boss is waiting;
--   5. it's been 3+ days: a quick quiz to come back.
-- 2–5 rotate by day, so it isn't the same line every evening. One a day
-- (dedupe_key), and nudges older than a week are cleared from the bell.
-- "Active": a phone with push on, or used PastCS in the last 30 days.
--
-- The reminders made when the app opens (streak, time away, milestones)
-- are no longer pushed: the student is in the app when they appear.
-- The app-icon number now counts unread messages from PastCS as well as
-- the bell.
--
-- Safe to run more than once. Needs pg_cron (Database > Extensions);
-- without it the function is there and nothing is scheduled.
-- ================================================================

CREATE OR REPLACE FUNCTION public.push_skips_type(p_type TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT p_type IN ('classroom_call', 'classroom_mention', 'streak_risk', 'streak_lost', 'inactivity', 'milestone');
$$;
REVOKE EXECUTE ON FUNCTION public.push_skips_type(TEXT) FROM PUBLIC, anon, authenticated;

-- The drain now also gets a title per notification (meta.push_title) and
-- an icon count that includes unread messages from PastCS.
DROP FUNCTION IF EXISTS public.claim_push_batch(INTEGER);
CREATE OR REPLACE FUNCTION public.claim_push_batch(p_limit INTEGER DEFAULT 100)
RETURNS TABLE (notification_id UUID, endpoint TEXT, p256dh TEXT, auth TEXT,
               type TEXT, message TEXT, link TEXT, unread INTEGER, push_title TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.push_outbox o
  WHERE o.created_at < now() - interval '1 day'
     OR (o.claimed_at IS NOT NULL AND o.claimed_at < now() - interval '1 hour');
  DELETE FROM public.push_outbox o
  USING public.notifications n
  WHERE n.id = o.notification_id
    AND (n.is_read OR NOT EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.user_id = n.user_id));

  RETURN QUERY
  WITH picked AS (
    SELECT o.notification_id FROM public.push_outbox o
    WHERE o.claimed_at IS NULL OR o.claimed_at < now() - interval '2 minutes'
    ORDER BY o.created_at
    LIMIT greatest(1, least(coalesce(p_limit, 100), 500))
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.push_outbox o SET claimed_at = now()
    FROM picked p WHERE o.notification_id = p.notification_id
    RETURNING o.notification_id
  )
  SELECT n.id, s.endpoint, s.p256dh, s.auth, n.type, n.message, n.link,
         ((SELECT count(*) FROM public.notifications x WHERE x.user_id = n.user_id AND NOT x.is_read)
          + (SELECT count(*) FROM public.admin_messages m WHERE m.user_id = n.user_id AND m.sender_id <> n.user_id AND NOT m.is_read))::int,
         n.meta ->> 'push_title'
  FROM claimed c
  JOIN public.notifications n ON n.id = c.notification_id
  JOIN public.push_subscriptions s ON s.user_id = n.user_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_push_batch(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_batch(INTEGER) TO service_role;

-- A course code as it appears in the app's course links.
CREATE OR REPLACE FUNCTION public.course_link(p_code TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT '/courses/' || replace(replace(replace(lower(p_code), '%', '%25'), ' ', '%20'), '/', '%2F');
$$;
REVOKE EXECUTE ON FUNCTION public.course_link(TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.send_daily_nudges()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  made INTEGER;
  day INTEGER := extract(doy FROM CURRENT_DATE)::int;
BEGIN
  DELETE FROM public.notifications WHERE type = 'daily_nudge' AND created_at < now() - interval '7 days';

  WITH candidates AS (
    SELECT u.id, u.practice_streak, u.last_practice_date, u.selected_level, u.selected_semester, u.program_id,
           (SELECT max(t.created_at) FROM public.tests t WHERE t.user_id = u.id) AS last_test
    FROM public.users u
    WHERE u.role = 'student' AND NOT u.is_suspended
      AND u.program_id IS NOT NULL AND u.selected_level IS NOT NULL AND u.selected_semester IS NOT NULL
      AND (EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.user_id = u.id)
           OR u.created_at > now() - interval '30 days'
           OR EXISTS (SELECT 1 FROM public.tests t WHERE t.user_id = u.id AND t.created_at > now() - interval '30 days')
           OR EXISTS (SELECT 1 FROM public.feature_events e WHERE e.user_id = u.id AND e.created_at > now() - interval '30 days'))
      -- Already practised today: no nudge needed.
      AND NOT EXISTS (SELECT 1 FROM public.tests t WHERE t.user_id = u.id AND t.created_at >= CURRENT_DATE)
      AND NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = u.id AND n.dedupe_key = 'nudge:' || CURRENT_DATE)
  ),
  options AS (
    -- 1. Streak ends at midnight.
    SELECT c.id, 0 AS pri, '🔥 Keep your ' || c.practice_streak || '-day streak' AS title,
           'Your streak ends at midnight. One quick quiz keeps it going.' AS body, '/courses' AS link
    FROM candidates c
    WHERE c.practice_streak >= 2 AND c.last_practice_date = CURRENT_DATE - 1
    UNION ALL
    -- 2. Close to the next grade in a course this semester (the closest one).
    SELECT * FROM (
    SELECT DISTINCT ON (c.id) c.id, 1 AS pri, 'So close to a ' || public.grade_label(g.stage + 1) AS title,
           'You’re ' || (public.grade_bar_needed(g.stage + 1) - g.bar) || ' correct answer'
             || CASE WHEN public.grade_bar_needed(g.stage + 1) - g.bar = 1 THEN '' ELSE 's' END
             || ' from a ' || public.grade_label(g.stage + 1) || ' in ' || co.course_code || '. A short Climb gets you there.' AS body,
           public.course_link(co.course_code) AS link
    FROM candidates c
    JOIN public.course_grades g ON g.user_id = c.id
    JOIN public.courses co ON co.id = g.course_id AND co.level = c.selected_level AND co.semester = c.selected_semester
    WHERE g.stage < 8 AND public.grade_bar_needed(g.stage + 1) - g.bar BETWEEN 1 AND 5
    ORDER BY c.id, public.grade_bar_needed(g.stage + 1) - g.bar
    ) closest
    UNION ALL
    -- 3. Their weakest topic this semester.
    SELECT c.id, 1, 'Cover ' || w.topic_name || ' today',
           w.topic_name || ' in ' || w.course_code || ' is your weakest topic (' || round(w.accuracy) || '%). Ten questions today will move it.',
           public.course_link(w.course_code)
    FROM candidates c
    CROSS JOIN LATERAL public.get_weak_topics(c.id, 1) w
    WHERE w.accuracy < 70
    UNION ALL
    -- 4. The Exam Boss.
    SELECT c.id, 1, 'The Exam Boss is waiting',
           'Revision as a 2-minute fight. Answer fast, hit hard, and see if you can beat it today.', '/boss'
    FROM candidates c
    UNION ALL
    -- 5. Been away 3+ days.
    SELECT c.id, 1, 'Your courses miss you',
           CASE WHEN c.last_test IS NULL THEN 'Try your first quiz: 10 questions, about 5 minutes.'
                ELSE 'It’s been ' || (CURRENT_DATE - c.last_test::date) || ' days. A 10-question quiz gets you back on track.' END,
           '/courses'
    FROM candidates c
    WHERE c.last_test IS NULL OR c.last_test < now() - interval '3 days'
  ),
  ranked AS (
    SELECT o.*, row_number() OVER (PARTITION BY o.id ORDER BY o.pri, md5(o.title) ) AS n,
           count(*) OVER (PARTITION BY o.id, o.pri) AS k
    FROM options o
  ),
  chosen AS (
    -- The streak if it applies; otherwise one of the rest, turning with the day.
    SELECT DISTINCT ON (r.id) r.id, r.title, r.body, r.link
    FROM ranked r
    WHERE r.pri = (SELECT min(pri) FROM ranked x WHERE x.id = r.id)
      AND (r.pri = 0 OR (r.n - 1) = ((day + abs(hashtext(r.id::text))) % r.k))
    ORDER BY r.id, r.n
  )
  INSERT INTO public.notifications (user_id, type, message, link, dedupe_key, meta)
  SELECT ch.id, 'daily_nudge', ch.body, ch.link, 'nudge:' || CURRENT_DATE, jsonb_build_object('push_title', ch.title)
  FROM chosen ch
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS made = ROW_COUNT;
  RETURN made;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.send_daily_nudges() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_daily_nudges() TO service_role;

-- Every day at 18:00 UTC (6pm in Ghana).
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not enabled (%): enable it under Database > Extensions, then run this again', SQLERRM;
  END;
  IF to_regnamespace('cron') IS NOT NULL THEN
    BEGIN
      PERFORM cron.unschedule('pastcs-daily-nudges');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule('pastcs-daily-nudges', '0 18 * * *', 'SELECT public.send_daily_nudges()');
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
