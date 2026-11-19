-- ================================================================
-- MIGRATION: status.pastcs.com — live system status (2026-11-19)
-- ================================================================
-- A public status page: is each part of PastCS working right now, how
-- has it done over 90 days, what's broken and when it should be fixed.
--
--   status_components        the parts shown on the page.
--   status_checks            one row per automatic check (kept 8 days).
--   status_daily             checks rolled up per part per day (90-day bars).
--   status_incidents         problems and planned maintenance, with the
--                            parts affected and the expected fix time.
--   status_incident_updates  the timeline posted on each one.
--
-- Every 5 minutes pg_cron runs status_run(), which calls the app's
-- /api/status/check through pg_net (with the push drain's secret). That
-- route tests the database, sign-in, file storage, Paystack, OpenAI and
-- the push queue, and records the results with status_record(). If the
-- app doesn't answer, status_run() records the website as down itself on
-- the next run.
--
-- A part failing two checks in a row opens an incident automatically and
-- tells the admins (push). It closes itself when the part passes again.
-- Admins post incidents, updates and maintenance from Admin › Status.
--
-- Safe to run more than once. Needs pg_net and pg_cron (both already
-- used by migrations 046 and 050).
-- ================================================================

CREATE TABLE IF NOT EXISTS public.status_components (
  key         TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0
);
INSERT INTO public.status_components (key, name, description, sort_order) VALUES
  ('website',  'Website and app',             'Opening PastCS on the web and the installed app.',          1),
  ('login',    'Sign-in and accounts',        'Logging in, signing up and staying signed in.',             2),
  ('database', 'Practice, tests and progress','Questions, saving results, streaks and leaderboards.',      3),
  ('payments', 'Payments',                    'Unlocking courses and buying skills (Paystack).',           4),
  ('ai',       'AI Tutor and explanations',   'The AI Tutor, answer explanations and the assistant.',      5),
  ('storage',  'Files and uploads',           'Profile pictures, classroom files and downloads.',          6),
  ('push',     'Phone notifications',         'Notifications on your lock screen.',                        7)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.status_checks (
  id         BIGSERIAL PRIMARY KEY,
  component  TEXT NOT NULL REFERENCES public.status_components(key) ON DELETE CASCADE,
  ok         BOOLEAN NOT NULL,
  latency_ms INTEGER,
  detail     TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS status_checks_component_idx ON public.status_checks (component, checked_at DESC);

CREATE TABLE IF NOT EXISTS public.status_daily (
  component TEXT NOT NULL REFERENCES public.status_components(key) ON DELETE CASCADE,
  day       DATE NOT NULL,
  checks    INTEGER NOT NULL DEFAULT 0,
  ok_checks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (component, day)
);

CREATE TABLE IF NOT EXISTS public.status_settings (
  id              BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  check_url       TEXT,
  last_request_id BIGINT,
  last_request_at TIMESTAMPTZ
);
INSERT INTO public.status_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.status_incidents (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title           TEXT NOT NULL CHECK (btrim(title) <> ''),
  impact          TEXT NOT NULL DEFAULT 'minor' CHECK (impact IN ('minor', 'major', 'critical', 'maintenance')),
  status          TEXT NOT NULL DEFAULT 'investigating'
                  CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved', 'scheduled', 'in_progress', 'completed')),
  components      TEXT[] NOT NULL DEFAULT '{}',
  expected_fix_at TIMESTAMPTZ,
  is_maintenance  BOOLEAN NOT NULL DEFAULT false,
  scheduled_for   TIMESTAMPTZ,
  scheduled_until TIMESTAMPTZ,
  is_auto         BOOLEAN NOT NULL DEFAULT false,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ,
  created_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS status_incidents_open_idx ON public.status_incidents (resolved_at, started_at DESC);

CREATE TABLE IF NOT EXISTS public.status_incident_updates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id     UUID NOT NULL REFERENCES public.status_incidents(id) ON DELETE CASCADE,
  status          TEXT NOT NULL,
  message         TEXT NOT NULL CHECK (btrim(message) <> ''),
  expected_fix_at TIMESTAMPTZ,
  created_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS status_incident_updates_idx ON public.status_incident_updates (incident_id, created_at DESC);

ALTER TABLE public.status_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_incident_updates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.status_components, public.status_checks, public.status_daily, public.status_settings,
              public.status_incidents, public.status_incident_updates FROM anon, authenticated;

-- ── Incidents opening and closing themselves ──
CREATE OR REPLACE FUNCTION public.status_evaluate()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c RECORD;
  inc public.status_incidents%ROWTYPE;
  new_id UUID;
BEGIN
  -- Down: the last two checks failed and no open incident covers it.
  FOR c IN
    SELECT sc.key, sc.name
    FROM public.status_components sc
    WHERE (SELECT count(*) FROM (
             SELECT k.ok FROM public.status_checks k WHERE k.component = sc.key
             ORDER BY k.checked_at DESC LIMIT 2) last2 WHERE NOT last2.ok) = 2
      AND NOT EXISTS (SELECT 1 FROM public.status_incidents i
                      WHERE i.resolved_at IS NULL AND NOT i.is_maintenance AND sc.key = ANY (i.components))
  LOOP
    INSERT INTO public.status_incidents (title, impact, status, components, is_auto)
    VALUES (c.name || ' not working',
            CASE WHEN c.key IN ('website', 'database', 'login') THEN 'critical' ELSE 'major' END,
            'investigating', ARRAY[c.key], true)
    RETURNING id INTO new_id;
    INSERT INTO public.status_incident_updates (incident_id, status, message)
    VALUES (new_id, 'investigating', 'Our automatic checks found a problem with ' || lower(c.name) || '. We’re looking into it.');

    INSERT INTO public.notifications (user_id, type, message, link, dedupe_key, meta)
    SELECT a.id, 'status_alert', c.name || ' failed two checks in a row. An incident is open on the status page: post an update and an expected fix time.',
           '/admin/status', 'status:' || new_id, jsonb_build_object('push_title', '⚠️ ' || c.name || ' is down')
    FROM public.users a WHERE a.role IN ('admin', 'super_admin')
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;

  -- Back up: an automatic incident whose parts all pass their latest check.
  FOR inc IN
    SELECT * FROM public.status_incidents i
    WHERE i.is_auto AND i.resolved_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM unnest(i.components) AS comp(key)
        WHERE coalesce((SELECT k.ok FROM public.status_checks k WHERE k.component = comp.key
                        ORDER BY k.checked_at DESC LIMIT 1), false) = false)
  LOOP
    UPDATE public.status_incidents SET status = 'resolved', resolved_at = now(), expected_fix_at = NULL WHERE id = inc.id;
    INSERT INTO public.status_incident_updates (incident_id, status, message)
    VALUES (inc.id, 'resolved', 'This is working again. Our checks have passed since ' || to_char(now() AT TIME ZONE 'UTC', 'HH24:MI') || ' GMT.');
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.status_evaluate() FROM PUBLIC, anon, authenticated;

-- ── Save one round of check results (the check route, service key). ──
-- p_results: [{"component": "payments", "ok": true, "latency_ms": 312, "detail": null}, …]
CREATE OR REPLACE FUNCTION public.status_record(p_results JSONB)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n INTEGER;
BEGIN
  WITH r AS (
    SELECT x->>'component' AS component, coalesce((x->>'ok')::boolean, false) AS ok,
           nullif(x->>'latency_ms', '')::int AS latency_ms, left(x->>'detail', 300) AS detail
    FROM jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) x
    WHERE x->>'component' IN (SELECT key FROM public.status_components)
  ), ins AS (
    INSERT INTO public.status_checks (component, ok, latency_ms, detail)
    SELECT component, ok, latency_ms, detail FROM r
    RETURNING component, ok
  ), daily AS (
    INSERT INTO public.status_daily (component, day, checks, ok_checks)
    SELECT component, (now() AT TIME ZONE 'UTC')::date, count(*), count(*) FILTER (WHERE ok) FROM ins GROUP BY component
    ON CONFLICT (component, day) DO UPDATE SET
      checks = public.status_daily.checks + EXCLUDED.checks,
      ok_checks = public.status_daily.ok_checks + EXCLUDED.ok_checks
    RETURNING 1
  )
  SELECT count(*) INTO n FROM ins;
  PERFORM public.status_evaluate();
  RETURN n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.status_record(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.status_record(JSONB) TO service_role;

-- ── Every 5 minutes (pg_cron): read the last call's answer, make the next. ──
CREATE OR REPLACE FUNCTION public.status_run()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg public.status_settings%ROWTYPE;
  secret TEXT;
  url TEXT;
  code INTEGER;
  timed_out BOOLEAN;
  err TEXT;
  found_reply BOOLEAN := false;
  req BIGINT;
BEGIN
  SELECT * INTO cfg FROM public.status_settings WHERE id;
  SELECT p.secret, coalesce(cfg.check_url, replace(p.drain_url, '/api/push/drain', '/api/status/check'))
    INTO secret, url FROM public.push_settings p WHERE p.id;

  -- The previous call: no answer, a timeout or a server error means the
  -- app itself is down (a working app records its own results).
  IF cfg.last_request_id IS NOT NULL AND to_regclass('net._http_response') IS NOT NULL THEN
    EXECUTE 'SELECT true, status_code, timed_out, error_msg FROM net._http_response WHERE id = $1'
      INTO found_reply, code, timed_out, err USING cfg.last_request_id;
    IF NOT coalesce(found_reply, false) OR coalesce(timed_out, false) OR code IS NULL OR code >= 500 THEN
      PERFORM public.status_record(jsonb_build_array(jsonb_build_object(
        'component', 'website', 'ok', false,
        'detail', CASE WHEN NOT coalesce(found_reply, false) THEN 'no answer'
                       WHEN coalesce(timed_out, false) THEN 'timed out'
                       WHEN code IS NULL THEN coalesce(err, 'connection failed')
                       ELSE 'HTTP ' || code END)));
    END IF;
  END IF;

  DELETE FROM public.status_checks WHERE checked_at < now() - interval '8 days';
  DELETE FROM public.status_daily WHERE day < current_date - 120;

  IF url IS NULL OR secret IS NULL OR to_regproc('net.http_post') IS NULL THEN
    UPDATE public.status_settings SET last_request_id = NULL WHERE id;
    RETURN;
  END IF;
  EXECUTE 'SELECT net.http_post(url := $1, body := ''{}''::jsonb, headers := $2, timeout_milliseconds := 30000)'
    INTO req
    USING url, jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret);
  UPDATE public.status_settings SET last_request_id = req, last_request_at = now() WHERE id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.status_run() FROM PUBLIC, anon, authenticated;

-- ── Status of each part right now: the worse of its checks and any open
-- incident. ──
CREATE OR REPLACE FUNCTION public.status_component_states()
RETURNS TABLE (key TEXT, name TEXT, description TEXT, sort_order INTEGER, state TEXT, last_checked TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH last2 AS (
    SELECT sc.key,
           (SELECT array_agg(k.ok ORDER BY k.checked_at DESC) FROM (
              SELECT ok, checked_at FROM public.status_checks
              WHERE component = sc.key AND checked_at > now() - interval '30 minutes'
              ORDER BY checked_at DESC LIMIT 2) k) AS oks,
           (SELECT max(checked_at) FROM public.status_checks WHERE component = sc.key) AS last_checked
    FROM public.status_components sc
  ), ranked AS (
    SELECT sc.key,
           greatest(
             CASE WHEN l.oks IS NULL OR l.oks[1] THEN 0
                  WHEN array_length(l.oks, 1) >= 2 AND NOT l.oks[2] THEN 3
                  ELSE 1 END,
             coalesce((SELECT max(CASE
                         WHEN i.is_maintenance THEN CASE WHEN i.status = 'in_progress' THEN 4 ELSE 0 END
                         WHEN i.impact = 'critical' THEN 3
                         WHEN i.impact = 'major' THEN 2
                         ELSE 1 END)
                       FROM public.status_incidents i
                       WHERE i.resolved_at IS NULL AND sc.key = ANY (i.components)), 0)) AS lvl,
           l.last_checked
    FROM public.status_components sc JOIN last2 l ON l.key = sc.key
  )
  SELECT sc.key, sc.name, sc.description, sc.sort_order,
         CASE r.lvl WHEN 0 THEN 'operational' WHEN 1 THEN 'degraded' WHEN 2 THEN 'partial_outage'
                    WHEN 3 THEN 'major_outage' ELSE 'maintenance' END,
         r.last_checked
  FROM public.status_components sc JOIN ranked r ON r.key = sc.key
  ORDER BY sc.sort_order;
$$;
REVOKE EXECUTE ON FUNCTION public.status_component_states() FROM PUBLIC, anon, authenticated;

-- An incident with its timeline, as JSON.
CREATE OR REPLACE FUNCTION public.status_incident_json(p_id UUID)
RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT jsonb_build_object(
    'id', i.id, 'title', i.title, 'impact', i.impact, 'status', i.status, 'components', to_jsonb(i.components),
    'expected_fix_at', i.expected_fix_at, 'is_maintenance', i.is_maintenance, 'is_auto', i.is_auto,
    'scheduled_for', i.scheduled_for, 'scheduled_until', i.scheduled_until,
    'started_at', i.started_at, 'resolved_at', i.resolved_at,
    'updates', coalesce((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'status', u.status, 'message', u.message,
                                                             'expected_fix_at', u.expected_fix_at, 'created_at', u.created_at)
                                          ORDER BY u.created_at DESC)
                         FROM public.status_incident_updates u WHERE u.incident_id = i.id), '[]'::jsonb))
  FROM public.status_incidents i WHERE i.id = p_id;
$$;
REVOKE EXECUTE ON FUNCTION public.status_incident_json(UUID) FROM PUBLIC, anon, authenticated;

-- ── The public page, in one call (anyone). ──
CREATE OR REPLACE FUNCTION public.get_status_page()
RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH states AS (SELECT * FROM public.status_component_states()),
  days AS (SELECT (current_date - g)::date AS day FROM generate_series(0, 89) g)
  SELECT jsonb_build_object(
    'generated_at', now(),
    'components', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'key', s.key, 'name', s.name, 'description', s.description, 'state', s.state, 'last_checked', s.last_checked,
        'uptime', (SELECT round(100.0 * sum(d.ok_checks) / nullif(sum(d.checks), 0), 2)
                   FROM public.status_daily d WHERE d.component = s.key AND d.day > current_date - 90),
        'days', (SELECT jsonb_agg(jsonb_build_object(
                    'day', dd.day,
                    'pct', (SELECT round(100.0 * d.ok_checks / nullif(d.checks, 0), 2) FROM public.status_daily d
                            WHERE d.component = s.key AND d.day = dd.day),
                    'incidents', (SELECT jsonb_agg(jsonb_build_object('title', i.title, 'impact', i.impact))
                                  FROM public.status_incidents i
                                  WHERE NOT i.is_maintenance AND s.key = ANY (i.components)
                                    AND i.started_at::date <= dd.day AND coalesce(i.resolved_at, now())::date >= dd.day))
                  ORDER BY dd.day)
                 FROM days dd)
      ) ORDER BY s.sort_order) FROM states s), '[]'::jsonb),
    'active', coalesce((SELECT jsonb_agg(public.status_incident_json(i.id) ORDER BY i.started_at DESC)
                        FROM public.status_incidents i
                        WHERE i.resolved_at IS NULL AND (NOT i.is_maintenance OR i.status = 'in_progress')), '[]'::jsonb),
    'maintenance', coalesce((SELECT jsonb_agg(public.status_incident_json(i.id) ORDER BY i.scheduled_for)
                             FROM public.status_incidents i
                             WHERE i.is_maintenance AND i.resolved_at IS NULL AND i.status = 'scheduled'), '[]'::jsonb),
    'history', coalesce((SELECT jsonb_agg(public.status_incident_json(i.id) ORDER BY i.started_at DESC)
                         FROM (SELECT * FROM public.status_incidents
                               WHERE resolved_at IS NOT NULL AND started_at > now() - interval '30 days'
                               ORDER BY started_at DESC LIMIT 50) i), '[]'::jsonb)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.get_status_page() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_status_page() TO anon, authenticated, service_role;

-- ── The in-app banner: only what a student would notice. ──
CREATE OR REPLACE FUNCTION public.get_status_banner()
RETURNS TABLE (id UUID, title TEXT, impact TEXT, status TEXT, expected_fix_at TIMESTAMPTZ, is_maintenance BOOLEAN)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT i.id, i.title, i.impact, i.status, coalesce(i.expected_fix_at, i.scheduled_until), i.is_maintenance
  FROM public.status_incidents i
  WHERE i.resolved_at IS NULL
    AND ((NOT i.is_maintenance AND i.impact IN ('major', 'critical')) OR (i.is_maintenance AND i.status = 'in_progress'))
  ORDER BY CASE i.impact WHEN 'critical' THEN 0 WHEN 'major' THEN 1 ELSE 2 END, i.started_at DESC
  LIMIT 3;
$$;
REVOKE EXECUTE ON FUNCTION public.get_status_banner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_status_banner() TO anon, authenticated;

-- ── Admin ──
CREATE OR REPLACE FUNCTION public.admin_status_overview()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;
  RETURN jsonb_build_object(
    'components', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'key', s.key, 'name', s.name, 'state', s.state, 'last_checked', s.last_checked,
        'last_detail', (SELECT k.detail FROM public.status_checks k WHERE k.component = s.key ORDER BY k.checked_at DESC LIMIT 1),
        'last_ok', (SELECT k.ok FROM public.status_checks k WHERE k.component = s.key ORDER BY k.checked_at DESC LIMIT 1),
        'last_latency', (SELECT k.latency_ms FROM public.status_checks k WHERE k.component = s.key ORDER BY k.checked_at DESC LIMIT 1))
      ORDER BY s.sort_order) FROM public.status_component_states() s), '[]'::jsonb),
    'open', coalesce((SELECT jsonb_agg(public.status_incident_json(i.id) ORDER BY i.started_at DESC)
                      FROM public.status_incidents i WHERE i.resolved_at IS NULL), '[]'::jsonb),
    'recent', coalesce((SELECT jsonb_agg(public.status_incident_json(r.id) ORDER BY r.started_at DESC)
                        FROM (SELECT id, started_at FROM public.status_incidents WHERE resolved_at IS NOT NULL
                              ORDER BY started_at DESC LIMIT 15) r), '[]'::jsonb),
    'checks_running', EXISTS (SELECT 1 FROM public.status_checks WHERE checked_at > now() - interval '15 minutes'),
    'last_check_at', (SELECT max(checked_at) FROM public.status_checks)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_status_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_status_overview() TO authenticated;

-- Open a new incident or schedule maintenance, with its first update.
CREATE OR REPLACE FUNCTION public.admin_status_open(
  p_title TEXT, p_impact TEXT, p_components TEXT[], p_status TEXT, p_message TEXT,
  p_expected_fix_at TIMESTAMPTZ, p_is_maintenance BOOLEAN, p_scheduled_for TIMESTAMPTZ, p_scheduled_until TIMESTAMPTZ)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_id UUID;
  maint BOOLEAN := coalesce(p_is_maintenance, false);
  st TEXT := coalesce(p_status, CASE WHEN coalesce(p_is_maintenance, false) THEN 'scheduled' ELSE 'investigating' END);
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;
  IF p_title IS NULL OR btrim(p_title) = '' THEN RAISE EXCEPTION 'bad_title'; END IF;
  IF p_message IS NULL OR btrim(p_message) = '' THEN RAISE EXCEPTION 'bad_message'; END IF;
  IF p_components IS NULL OR cardinality(p_components) = 0
     OR EXISTS (SELECT 1 FROM unnest(p_components) c WHERE c NOT IN (SELECT key FROM public.status_components)) THEN
    RAISE EXCEPTION 'bad_components';
  END IF;
  IF maint THEN
    IF st NOT IN ('scheduled', 'in_progress') THEN RAISE EXCEPTION 'bad_status'; END IF;
    IF p_scheduled_for IS NULL OR p_scheduled_until IS NULL OR p_scheduled_until <= p_scheduled_for THEN RAISE EXCEPTION 'bad_window'; END IF;
  ELSE
    IF st NOT IN ('investigating', 'identified', 'monitoring') THEN RAISE EXCEPTION 'bad_status'; END IF;
    IF coalesce(p_impact, '') NOT IN ('minor', 'major', 'critical') THEN RAISE EXCEPTION 'bad_impact'; END IF;
  END IF;

  INSERT INTO public.status_incidents (title, impact, status, components, expected_fix_at, is_maintenance,
                                       scheduled_for, scheduled_until, started_at, created_by)
  VALUES (btrim(p_title), CASE WHEN maint THEN 'maintenance' ELSE p_impact END, st,
          ARRAY(SELECT DISTINCT unnest(p_components)),
          CASE WHEN maint THEN NULL ELSE p_expected_fix_at END, maint,
          CASE WHEN maint THEN p_scheduled_for END, CASE WHEN maint THEN p_scheduled_until END,
          CASE WHEN maint AND st = 'scheduled' THEN p_scheduled_for ELSE now() END, auth.uid())
  RETURNING id INTO new_id;
  INSERT INTO public.status_incident_updates (incident_id, status, message, expected_fix_at, created_by)
  VALUES (new_id, st, btrim(p_message), CASE WHEN maint THEN NULL ELSE p_expected_fix_at END, auth.uid());
  RETURN new_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_status_open(TEXT, TEXT, TEXT[], TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_status_open(TEXT, TEXT, TEXT[], TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- Post an update: new status, a message, and the expected fix time
-- (NULL clears it). Resolved / completed closes the incident.
CREATE OR REPLACE FUNCTION public.admin_status_update(
  p_incident UUID, p_status TEXT, p_message TEXT, p_expected_fix_at TIMESTAMPTZ, p_impact TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inc public.status_incidents%ROWTYPE;
  closing BOOLEAN;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;
  SELECT * INTO inc FROM public.status_incidents WHERE id = p_incident FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF p_message IS NULL OR btrim(p_message) = '' THEN RAISE EXCEPTION 'bad_message'; END IF;
  IF inc.is_maintenance AND p_status NOT IN ('scheduled', 'in_progress', 'completed') THEN RAISE EXCEPTION 'bad_status'; END IF;
  IF NOT inc.is_maintenance AND p_status NOT IN ('investigating', 'identified', 'monitoring', 'resolved') THEN RAISE EXCEPTION 'bad_status'; END IF;
  IF p_impact IS NOT NULL AND (inc.is_maintenance OR p_impact NOT IN ('minor', 'major', 'critical')) THEN RAISE EXCEPTION 'bad_impact'; END IF;
  closing := p_status IN ('resolved', 'completed');

  UPDATE public.status_incidents SET
    status = p_status,
    impact = coalesce(p_impact, impact),
    expected_fix_at = CASE WHEN closing THEN NULL ELSE p_expected_fix_at END,
    resolved_at = CASE WHEN closing THEN now() ELSE NULL END,
    started_at = CASE WHEN is_maintenance AND p_status = 'in_progress' AND status = 'scheduled' THEN now() ELSE started_at END,
    -- Someone has taken it over: it no longer closes by itself.
    is_auto = false
  WHERE id = p_incident;
  INSERT INTO public.status_incident_updates (incident_id, status, message, expected_fix_at, created_by)
  VALUES (p_incident, p_status, btrim(p_message), CASE WHEN closing THEN NULL ELSE p_expected_fix_at END, auth.uid());
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_status_update(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_status_update(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT) TO authenticated;

-- Remove one posted by mistake.
CREATE OR REPLACE FUNCTION public.admin_status_delete(p_incident UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;
  DELETE FROM public.status_incidents WHERE id = p_incident;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_status_delete(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_status_delete(UUID) TO authenticated;

-- Every 5 minutes.
DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    BEGIN
      PERFORM cron.unschedule('pastcs-status-checks');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule('pastcs-status-checks', '*/5 * * * *', 'SELECT public.status_run()');
  ELSE
    RAISE NOTICE 'pg_cron is not enabled: turn it on under Database > Extensions, then run this again';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
