-- ================================================================
-- MIGRATION: Every notification reaches the phone (2026-10-28)
-- ================================================================
-- Web push only covered classroom calls and @mentions, and only because
-- the sender's browser asked /api/classrooms/push to send them. Every
-- other notification (a class rep paying for you, a free pass, a message
-- from PastCS, grade ladder news) waited in the bell until the student
-- next opened the app.
--
-- Now any new notification for a student with push switched on goes into
-- push_outbox, and the database asks /api/push/drain to send it straight
-- away (pg_net, after the insert commits). One request per statement, so
-- a bulk insert is one request. The route claims the queue with
-- claim_push_batch and sends each item once. Classroom calls and
-- @mentions keep their own route and are left out here, so nobody gets
-- them twice.
--
-- SET-UP, once, after running this:
--   1. Database > Extensions: enable pg_net (this tries to as well).
--   2. Add PUSH_DRAIN_SECRET to the site's environment (any long random
--      string) and redeploy.
--   3. Run, with your own domain and the same secret:
--        UPDATE public.push_settings
--        SET drain_url = 'https://www.pastcs.com/api/push/drain',
--            secret    = '<the same PUSH_DRAIN_SECRET>';
-- Until drain_url is set nothing is requested and the queue just waits.
--
-- Safe to run more than once.
-- ================================================================

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_net not enabled (%): enable it under Database > Extensions', SQLERRM;
END;
$$;

-- ── Where to send the "drain now" request ────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_settings (
  id        BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  drain_url TEXT CHECK (drain_url IS NULL OR drain_url LIKE 'https://%' OR drain_url LIKE 'http://localhost%'),
  secret    TEXT
);
INSERT INTO public.push_settings (id) VALUES (true) ON CONFLICT DO NOTHING;
ALTER TABLE public.push_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_settings FROM anon, authenticated;

-- ── The queue ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_outbox (
  notification_id UUID PRIMARY KEY REFERENCES public.notifications(id) ON DELETE CASCADE,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  claimed_at      TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_push_outbox_created ON public.push_outbox(created_at);
ALTER TABLE public.push_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_outbox FROM anon, authenticated;

-- Pushed by /api/classrooms/push already.
CREATE OR REPLACE FUNCTION public.push_skips_type(p_type TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT p_type IN ('classroom_call', 'classroom_mention');
$$;
REVOKE EXECUTE ON FUNCTION public.push_skips_type(TEXT) FROM PUBLIC, anon, authenticated;

-- Asks the site to send what's queued. Never lets a push problem undo the
-- notification itself.
CREATE OR REPLACE FUNCTION public.push_kick()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg public.push_settings%ROWTYPE;
BEGIN
  SELECT * INTO cfg FROM public.push_settings WHERE id;
  IF cfg.drain_url IS NULL OR coalesce(cfg.secret, '') = '' THEN RETURN; END IF;
  IF to_regproc('net.http_post') IS NULL THEN RETURN; END IF;
  EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 10000)'
    USING cfg.drain_url, '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', cfg.secret);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'push_kick failed: %', SQLERRM;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.push_kick() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notifications_queue_push()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n INTEGER;
BEGIN
  INSERT INTO public.push_outbox (notification_id)
  SELECT r.id FROM new_rows r
  WHERE NOT public.push_skips_type(r.type)
    AND EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.user_id = r.user_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN PERFORM public.push_kick(); END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notifications_queue_push failed: %', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notifications_queue_push() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS notifications_queue_push ON public.notifications;
CREATE TRIGGER notifications_queue_push AFTER INSERT ON public.notifications
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.notifications_queue_push();

-- ── What the drain route sends ───────────────────────────────────────
-- Takes up to p_limit queued notifications (each exactly once, even with
-- two drains running), and returns one row per device. Anything older
-- than a day is dropped instead: old news on a lock screen is noise.
-- A claim that never finished (the route crashed) is retried after two
-- minutes. unread is the student's bell count, for the app icon badge.
CREATE OR REPLACE FUNCTION public.claim_push_batch(p_limit INTEGER DEFAULT 100)
RETURNS TABLE (notification_id UUID, endpoint TEXT, p256dh TEXT, auth TEXT,
               type TEXT, message TEXT, link TEXT, unread INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.push_outbox o
  WHERE o.created_at < now() - interval '1 day'
     OR (o.claimed_at IS NOT NULL AND o.claimed_at < now() - interval '1 hour');
  -- Already read in the app, or no device left to send to.
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
         (SELECT count(*)::int FROM public.notifications x WHERE x.user_id = n.user_id AND NOT x.is_read)
  FROM claimed c
  JOIN public.notifications n ON n.id = c.notification_id
  JOIN public.push_subscriptions s ON s.user_id = n.user_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_push_batch(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_batch(INTEGER) TO service_role;

-- Sent (or given up on): off the queue.
CREATE OR REPLACE FUNCTION public.finish_push_batch(p_ids UUID[])
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.push_outbox WHERE notification_id = ANY(p_ids);
$$;
REVOKE EXECUTE ON FUNCTION public.finish_push_batch(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_push_batch(UUID[]) TO service_role;

NOTIFY pgrst, 'reload schema';
