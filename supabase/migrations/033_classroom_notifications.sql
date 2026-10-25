-- ================================================================
-- MIGRATION: Classroom notifications
-- Run this in the Supabase SQL Editor once, after 032. Safe to re-run.
--
-- 1. Unread counts: each member's last_read_at, one RPC for the badge on
--    the Classes tab and each classroom card, one to mark a chat read.
-- 2. Alerts: when a call starts, or someone @mentions you, a row lands
--    in notifications (the bell). The database decides who gets one, so
--    a client can't alert people outside the classroom or spam everyone.
-- 3. Web push: browser subscriptions, and the list of devices to ping
--    for a message (read by /api/classrooms/push with the service role).
-- Each member can switch alerts off per classroom (alerts_enabled).
-- ================================================================

-- ── Unread counts ──────────────────────────────────────────────────────
ALTER TABLE public.classroom_members ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMP WITH TIME ZONE;
-- Existing members start with nothing unread rather than 100 old messages.
UPDATE public.classroom_members SET last_read_at = now() WHERE last_read_at IS NULL;
ALTER TABLE public.classroom_members ALTER COLUMN last_read_at SET DEFAULT now();
ALTER TABLE public.classroom_members ADD COLUMN IF NOT EXISTS alerts_enabled BOOLEAN NOT NULL DEFAULT true;

-- Classmates' messages since I last opened each chat, capped at 100
-- (the badge shows 99+). Ended-call notices don't count as news.
CREATE OR REPLACE FUNCTION public.get_my_classroom_unread()
RETURNS TABLE (classroom_id UUID, unread INTEGER)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT m.classroom_id,
         (SELECT count(*) FROM (
            SELECT 1 FROM public.classroom_messages x
            WHERE x.classroom_id = m.classroom_id
              AND x.user_id <> m.user_id
              AND x.kind <> 'call_end'
              AND x.created_at > coalesce(m.last_read_at, m.joined_at)
            LIMIT 100
          ) recent)::INTEGER
  FROM public.classroom_members m
  WHERE m.user_id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_classroom_unread() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_classroom_unread() TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_classroom_read(p_classroom UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.classroom_members SET last_read_at = now()
  WHERE classroom_id = p_classroom AND user_id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.mark_classroom_read(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_classroom_read(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_classroom_alerts(p_classroom UUID, p_enabled BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.classroom_members SET alerts_enabled = coalesce(p_enabled, true)
  WHERE classroom_id = p_classroom AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'not_a_member'; END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_classroom_alerts(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_classroom_alerts(UUID, BOOLEAN) TO authenticated;

-- ── Notifications can link somewhere ───────────────────────────────────
-- link: an in-app path to open. meta: what the alert is about (for a
-- call, the room link the toast's Join button opens).
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS link TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_notifications_message ON public.notifications((meta->>'message_id'));

-- Live: the bell and the call toast update without a refresh.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

-- ── Clean what the client sends with a message ─────────────────────────
-- mentions: kept only on text messages, only classmates (not yourself),
-- at most 10. A call's link must be a meet.jit.si room, so the Join
-- button in everyone's alert can't point somewhere else.
CREATE OR REPLACE FUNCTION public.classroom_messages_clean_meta()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ids JSONB;
BEGIN
  NEW.meta := coalesce(NEW.meta, '{}'::jsonb);
  IF NEW.kind = 'text' AND jsonb_typeof(NEW.meta->'mentions') = 'array' THEN
    SELECT coalesce(jsonb_agg(picked.user_id), '[]'::jsonb) INTO ids FROM (
      SELECT DISTINCT cm.user_id
      FROM jsonb_array_elements_text(NEW.meta->'mentions') AS e(v)
      JOIN public.classroom_members cm ON cm.classroom_id = NEW.classroom_id AND cm.user_id::text = e.v
      WHERE cm.user_id <> NEW.user_id
      LIMIT 10
    ) picked;
    NEW.meta := jsonb_set(NEW.meta, '{mentions}', ids);
  ELSE
    NEW.meta := NEW.meta - 'mentions';
  END IF;
  IF NEW.kind = 'call' AND coalesce(NEW.meta->>'url', '') NOT LIKE 'https://meet.jit.si/%' THEN
    NEW.meta := NEW.meta - 'url';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS classroom_messages_clean_meta ON public.classroom_messages;
CREATE TRIGGER classroom_messages_clean_meta BEFORE INSERT ON public.classroom_messages
  FOR EACH ROW EXECUTE FUNCTION public.classroom_messages_clean_meta();

-- ── Who hears about a message ──────────────────────────────────────────
-- Calls alert every classmate with alerts on (one alert per classroom
-- per 10 minutes, so stop/start doesn't ping everyone again). Mentions
-- alert just the people mentioned. Ordinary messages alert nobody —
-- they only count towards the unread badge.
CREATE OR REPLACE FUNCTION public.classroom_messages_notify()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  room_name TEXT;
  sender TEXT;
BEGIN
  IF NEW.kind NOT IN ('call', 'text') THEN RETURN NULL; END IF;
  IF NEW.kind = 'text' AND jsonb_array_length(coalesce(NEW.meta->'mentions', '[]'::jsonb)) = 0 THEN RETURN NULL; END IF;
  IF NEW.kind = 'call' AND EXISTS (
    SELECT 1 FROM public.classroom_messages x
    WHERE x.classroom_id = NEW.classroom_id AND x.kind = 'call' AND x.id <> NEW.id
      AND x.created_at > NEW.created_at - interval '10 minutes'
  ) THEN RETURN NULL; END IF;

  SELECT name INTO room_name FROM public.classrooms WHERE id = NEW.classroom_id;
  SELECT coalesce(nullif(split_part(btrim(full_name), ' ', 1), ''), 'A classmate') INTO sender
  FROM public.users WHERE id = NEW.user_id;
  sender := coalesce(sender, 'A classmate');

  IF NEW.kind = 'call' THEN
    INSERT INTO public.notifications (user_id, type, message, link, meta)
    SELECT cm.user_id, 'classroom_call', sender || ' started a call in ' || room_name,
           '/classrooms/' || NEW.classroom_id,
           jsonb_strip_nulls(jsonb_build_object('classroom_id', NEW.classroom_id, 'message_id', NEW.id, 'url', NEW.meta->>'url'))
    FROM public.classroom_members cm
    WHERE cm.classroom_id = NEW.classroom_id AND cm.user_id <> NEW.user_id AND cm.alerts_enabled;
  ELSE
    INSERT INTO public.notifications (user_id, type, message, link, meta)
    SELECT cm.user_id, 'classroom_mention',
           sender || ' mentioned you in ' || room_name || ': ' || left(NEW.body, 140) || CASE WHEN char_length(NEW.body) > 140 THEN '…' ELSE '' END,
           '/classrooms/' || NEW.classroom_id,
           jsonb_build_object('classroom_id', NEW.classroom_id, 'message_id', NEW.id)
    FROM public.classroom_members cm
    WHERE cm.classroom_id = NEW.classroom_id AND cm.alerts_enabled
      AND cm.user_id::text IN (SELECT jsonb_array_elements_text(NEW.meta->'mentions'));
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS classroom_messages_notify ON public.classroom_messages;
CREATE TRIGGER classroom_messages_notify AFTER INSERT ON public.classroom_messages
  FOR EACH ROW EXECUTE FUNCTION public.classroom_messages_notify();

-- ── Web push ───────────────────────────────────────────────────────────
-- One row per browser. Only reachable through the functions below: a
-- subscription endpoint is a capability (anyone holding it can ping that
-- device), so clients never read the table.
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE CHECK (endpoint LIKE 'https://%' AND char_length(endpoint) <= 1000),
  p256dh     TEXT NOT NULL CHECK (char_length(p256dh) <= 200),
  auth       TEXT NOT NULL CHECK (char_length(auth) <= 100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions(user_id);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions FROM anon, authenticated;

-- Saving the same browser again (or for a different account that signed
-- in on it) moves the subscription to whoever is signed in now. Ten
-- devices per student; the oldest goes first.
CREATE OR REPLACE FUNCTION public.save_push_subscription(p_endpoint TEXT, p_p256dh TEXT, p_auth TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth)
  VALUES (uid, p_endpoint, p_p256dh, p_auth)
  ON CONFLICT (endpoint) DO UPDATE SET user_id = uid, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, created_at = now();
  DELETE FROM public.push_subscriptions WHERE id IN (
    SELECT id FROM public.push_subscriptions WHERE user_id = uid ORDER BY created_at DESC OFFSET 10
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.save_push_subscription(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_push_subscription(TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_push_subscription(p_endpoint TEXT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.push_subscriptions WHERE endpoint = p_endpoint AND user_id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.delete_push_subscription(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_push_subscription(TEXT) TO authenticated;

-- Each message is pushed at most once, however often the route is called.
CREATE TABLE IF NOT EXISTS public.classroom_push_sent (
  message_id UUID PRIMARY KEY REFERENCES public.classroom_messages(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.classroom_push_sent ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.classroom_push_sent FROM anon, authenticated;

-- The devices to ping for a message the sender just posted: exactly the
-- people the notify trigger alerted (so alerts_enabled and the call
-- cooldown apply to push too). Service role only — the route passes the
-- signed-in sender, and a message older than 10 minutes is never pushed.
CREATE OR REPLACE FUNCTION public.classroom_push_targets(p_message UUID, p_sender UUID)
RETURNS TABLE (endpoint TEXT, p256dh TEXT, auth TEXT, title TEXT, body TEXT, link TEXT, kind TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.classroom_messages
    WHERE id = p_message AND user_id = p_sender AND created_at > now() - interval '10 minutes'
  ) THEN RETURN; END IF;
  INSERT INTO public.classroom_push_sent (message_id) VALUES (p_message) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT s.endpoint, s.p256dh, s.auth, c.name, n.message, n.link, n.type
  FROM public.notifications n
  JOIN public.push_subscriptions s ON s.user_id = n.user_id
  JOIN public.classrooms c ON c.id::text = n.meta->>'classroom_id'
  WHERE n.meta->>'message_id' = p_message::text
    AND n.type IN ('classroom_call', 'classroom_mention');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.classroom_push_targets(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.classroom_push_targets(UUID, UUID) TO service_role;

-- Dead subscriptions (the browser unsubscribed) reported by the push
-- service; also service role only.
CREATE OR REPLACE FUNCTION public.drop_push_subscription(p_endpoint TEXT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.push_subscriptions WHERE endpoint = p_endpoint;
$$;
REVOKE EXECUTE ON FUNCTION public.drop_push_subscription(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.drop_push_subscription(TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
