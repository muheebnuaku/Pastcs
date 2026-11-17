-- ================================================================
-- MIGRATION: Skills — paid courses beyond the exam syllabus (2026-11-17)
-- ================================================================
-- PastCS now sells practical skill courses (Vibe Coding, AI Automation,
-- WhatsApp AI Bot). Paying gives a student a fixed stretch of teaching
-- (two weeks by default) and the class link for it.
--
--   skill_courses     what's on sale: copy, price (pesewas), how many days
--                     of teaching a purchase buys, and the class link
--                     (WhatsApp group / meeting) that only enrolled
--                     students ever see.
--   skill_enrolments  one row per payment: who, which course, what they
--                     paid, and the window their teaching runs for.
--
-- Both tables are closed to direct reads; everything goes through the
-- functions below. The price is checked here, not in the app:
-- record_skill_enrolment() refuses a payment below the course's price.
-- Buying again while a course is still running adds the new days to the
-- end of the current window.
--
-- Safe to run more than once.
-- ================================================================

CREATE TABLE IF NOT EXISTS public.skill_courses (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug          TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 60),
  title         TEXT NOT NULL CHECK (btrim(title) <> ''),
  tagline       TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  outcomes      TEXT[] NOT NULL DEFAULT '{}',
  price         INTEGER NOT NULL CHECK (price BETWEEN 100 AND 100000000),   -- pesewas
  duration_days INTEGER NOT NULL DEFAULT 14 CHECK (duration_days BETWEEN 1 AND 365),
  class_link    TEXT,
  cohort_note   TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.skill_courses ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.skill_enrolments (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  skill_course_id   UUID NOT NULL REFERENCES public.skill_courses(id) ON DELETE RESTRICT,
  payment_reference TEXT NOT NULL UNIQUE,
  amount            INTEGER NOT NULL CHECK (amount >= 0),                   -- pesewas paid
  starts_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at           TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS skill_enrolments_user_idx ON public.skill_enrolments (user_id, skill_course_id, ends_at DESC);
CREATE INDEX IF NOT EXISTS skill_enrolments_course_idx ON public.skill_enrolments (skill_course_id, created_at DESC);
ALTER TABLE public.skill_enrolments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.skill_courses, public.skill_enrolments FROM anon, authenticated;

-- The three launch courses. Admin › Skills edits the copy and prices.
INSERT INTO public.skill_courses (slug, title, tagline, description, outcomes, price, duration_days, sort_order) VALUES
('vibe-coding', 'Vibe Coding',
 'Build real apps by describing them to AI.',
 'Learn to turn an idea into a working web app with AI coding tools, even if you have never written much code. You describe what you want, the AI writes it, and you learn to steer it, test it and fix it until it works. By the end you have your own app online.',
 ARRAY['Go from an idea to a working web app with AI coding tools',
       'Write prompts that produce clean, working code',
       'Find and fix bugs without starting over',
       'Put your app online with a link you can share'],
 90000, 14, 1),
('ai-automation', 'AI Automation',
 'Make AI do the repetitive work for you and for clients.',
 'Learn to connect everyday tools, like email, Google Sheets and forms, so work moves on its own, with AI reading, sorting and replying along the way. You build automations a real business would pay for, and learn how to sell them.',
 ARRAY['Connect email, spreadsheets and forms so tasks run on their own',
       'Use AI to sort, summarise and reply to messages',
       'Build automations for real business problems',
       'Price and sell automation as a service'],
 120000, 14, 2),
('whatsapp-ai-bot', 'WhatsApp AI Bot',
 'Build an AI assistant that answers customers on WhatsApp.',
 'Learn to build a WhatsApp bot that knows a business''s prices, hours and answers, takes orders and bookings, and hands the chat to a person when it should. Every shop, salon and church in Ghana is on WhatsApp: this is a skill you can sell the week you finish.',
 ARRAY['Set up a WhatsApp Business number for a bot',
       'Teach the bot a business''s prices, hours and common questions',
       'Take orders and bookings through chat',
       'Hand the conversation to a person when needed',
       'Set up and sell bots to local businesses'],
 200000, 14, 3)
ON CONFLICT (slug) DO NOTHING;

-- ── What's on sale (anyone, signed in or not). No class link. ──
CREATE OR REPLACE FUNCTION public.get_skill_courses()
RETURNS TABLE (id UUID, slug TEXT, title TEXT, tagline TEXT, description TEXT, outcomes TEXT[],
               price INTEGER, duration_days INTEGER, cohort_note TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT c.id, c.slug, c.title, c.tagline, c.description, c.outcomes, c.price, c.duration_days, c.cohort_note
  FROM public.skill_courses c
  WHERE c.is_active
  ORDER BY c.sort_order, c.title;
$$;
REVOKE EXECUTE ON FUNCTION public.get_skill_courses() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_skill_courses() TO anon, authenticated, service_role;

-- ── The signed-in student's courses: latest window per course. The class
-- link only while their teaching is running. ──
CREATE OR REPLACE FUNCTION public.get_my_skill_enrolments()
RETURNS TABLE (skill_course_id UUID, slug TEXT, title TEXT, starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ,
               is_active BOOLEAN, class_link TEXT, cohort_note TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT DISTINCT ON (c.id) c.id, c.slug, c.title,
         coalesce((SELECT min(x.starts_at) FROM public.skill_enrolments x
                   WHERE x.user_id = e.user_id AND x.skill_course_id = c.id AND x.ends_at > now()), e.starts_at),
         e.ends_at, e.ends_at > now(),
         CASE WHEN e.ends_at > now() THEN c.class_link END,
         c.cohort_note
  FROM public.skill_enrolments e
  JOIN public.skill_courses c ON c.id = e.skill_course_id
  WHERE e.user_id = auth.uid()
  ORDER BY c.id, e.ends_at DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_skill_enrolments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_skill_enrolments() TO authenticated;

-- ── Record a paid enrolment (payment routes only, with the service key).
-- Idempotent on the Paystack reference, so the browser's verify call and
-- Paystack's webhook can both arrive. ──
CREATE OR REPLACE FUNCTION public.record_skill_enrolment(
  p_user UUID, p_slug TEXT, p_reference TEXT, p_amount INTEGER, p_currency TEXT)
RETURNS TABLE (enrolment_id UUID, title TEXT, ends_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.skill_courses%ROWTYPE;
  prior public.skill_enrolments%ROWTYPE;
  begins TIMESTAMPTZ;
  new_id UUID;
  who TEXT;
BEGIN
  IF p_reference IS NULL OR btrim(p_reference) = '' THEN RAISE EXCEPTION 'bad_reference'; END IF;

  SELECT * INTO prior FROM public.skill_enrolments WHERE payment_reference = p_reference;
  IF FOUND THEN
    IF prior.user_id <> p_user THEN RAISE EXCEPTION 'reference_used'; END IF;
    RETURN QUERY SELECT prior.id, (SELECT s.title FROM public.skill_courses s WHERE s.id = prior.skill_course_id), prior.ends_at;
    RETURN;
  END IF;

  -- A course switched off after the student opened checkout still honours
  -- the payment.
  SELECT * INTO c FROM public.skill_courses WHERE slug = p_slug;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_such_skill'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN RAISE EXCEPTION 'no_such_user'; END IF;
  IF coalesce(p_currency, '') <> 'GHS' OR p_amount IS NULL OR p_amount < c.price THEN
    RAISE EXCEPTION 'amount_too_low';
  END IF;

  -- One purchase at a time per student and course, so two payments
  -- arriving together stack their windows instead of overlapping.
  PERFORM pg_advisory_xact_lock(hashtext('skill:' || p_user::text || ':' || c.id::text));

  SELECT greatest(now(), coalesce(max(e.ends_at), now())) INTO begins
  FROM public.skill_enrolments e
  WHERE e.user_id = p_user AND e.skill_course_id = c.id;

  INSERT INTO public.skill_enrolments (user_id, skill_course_id, payment_reference, amount, starts_at, ends_at)
  VALUES (p_user, c.id, p_reference, p_amount, begins, begins + make_interval(days => c.duration_days))
  ON CONFLICT (payment_reference) DO NOTHING
  RETURNING id INTO new_id;

  IF new_id IS NULL THEN
    -- The other path recorded it a moment ago.
    RETURN QUERY SELECT e.id, c.title, e.ends_at FROM public.skill_enrolments e WHERE e.payment_reference = p_reference;
    RETURN;
  END IF;

  SELECT coalesce(nullif(btrim(full_name), ''), email, 'A student') INTO who FROM public.users WHERE id = p_user;

  INSERT INTO public.notifications (user_id, type, message, link, dedupe_key, meta)
  VALUES (p_user, 'skill_enrolled',
          'You’re in: ' || c.title || '. Your teaching runs until '
            || to_char(begins + make_interval(days => c.duration_days), 'FMDD Mon')
            || '. Open the course page for your class link.',
          '/skills/' || c.slug, 'skill:' || p_reference,
          jsonb_build_object('push_title', 'Welcome to ' || c.title))
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  INSERT INTO public.notifications (user_id, type, message, link, dedupe_key, meta)
  SELECT a.id, 'skill_sale',
         who || ' paid GHC ' || trim(to_char(p_amount / 100.0, 'FM999G999G990D00')) || ' for ' || c.title || '.',
         '/admin/skills', 'skill:' || p_reference,
         jsonb_build_object('push_title', 'New ' || c.title || ' student')
  FROM public.users a
  WHERE a.role IN ('admin', 'super_admin') AND a.id <> p_user
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  RETURN QUERY SELECT e.id, c.title, e.ends_at FROM public.skill_enrolments e WHERE e.id = new_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_skill_enrolment(UUID, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_skill_enrolment(UUID, TEXT, TEXT, INTEGER, TEXT) TO service_role;

-- ── Admin: every course, with the class link and how it's selling. ──
CREATE OR REPLACE FUNCTION public.admin_list_skill_courses()
RETURNS TABLE (id UUID, slug TEXT, title TEXT, tagline TEXT, description TEXT, outcomes TEXT[],
               price INTEGER, duration_days INTEGER, class_link TEXT, cohort_note TEXT,
               is_active BOOLEAN, sort_order INTEGER, students BIGINT, running BIGINT, revenue BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;
  RETURN QUERY
  SELECT c.id, c.slug, c.title, c.tagline, c.description, c.outcomes, c.price, c.duration_days,
         c.class_link, c.cohort_note, c.is_active, c.sort_order,
         (SELECT count(DISTINCT e.user_id) FROM public.skill_enrolments e WHERE e.skill_course_id = c.id),
         (SELECT count(DISTINCT e.user_id) FROM public.skill_enrolments e WHERE e.skill_course_id = c.id AND e.ends_at > now()),
         (SELECT coalesce(sum(e.amount), 0) FROM public.skill_enrolments e WHERE e.skill_course_id = c.id)::bigint
  FROM public.skill_courses c
  ORDER BY c.sort_order, c.title;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_list_skill_courses() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_skill_courses() TO authenticated;

-- ── Admin: add (p_id NULL) or edit a course. Price in pesewas. ──
CREATE OR REPLACE FUNCTION public.admin_save_skill_course(
  p_id UUID, p_slug TEXT, p_title TEXT, p_tagline TEXT, p_description TEXT, p_outcomes TEXT[],
  p_price INTEGER, p_duration_days INTEGER, p_class_link TEXT, p_cohort_note TEXT,
  p_active BOOLEAN, p_sort_order INTEGER)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  out_id UUID;
  link TEXT := nullif(btrim(coalesce(p_class_link, '')), '');
  clean TEXT[];
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(p_slug) > 60 THEN RAISE EXCEPTION 'bad_slug'; END IF;
  IF p_title IS NULL OR btrim(p_title) = '' THEN RAISE EXCEPTION 'bad_title'; END IF;
  IF p_price IS NULL OR p_price < 100 OR p_price > 100000000 THEN RAISE EXCEPTION 'bad_price'; END IF;
  IF p_duration_days IS NULL OR p_duration_days < 1 OR p_duration_days > 365 THEN RAISE EXCEPTION 'bad_duration'; END IF;
  IF link IS NOT NULL AND link !~* '^https://' THEN RAISE EXCEPTION 'bad_link'; END IF;
  IF EXISTS (SELECT 1 FROM public.skill_courses WHERE slug = p_slug AND id IS DISTINCT FROM p_id) THEN
    RAISE EXCEPTION 'slug_taken';
  END IF;

  SELECT coalesce(array_agg(btrim(o) ORDER BY n), '{}') INTO clean
  FROM unnest(coalesce(p_outcomes, '{}')) WITH ORDINALITY AS t(o, n)
  WHERE btrim(o) <> '';

  IF p_id IS NULL THEN
    INSERT INTO public.skill_courses (slug, title, tagline, description, outcomes, price, duration_days,
                                      class_link, cohort_note, is_active, sort_order)
    VALUES (p_slug, btrim(p_title), btrim(coalesce(p_tagline, '')), btrim(coalesce(p_description, '')), clean,
            p_price, p_duration_days, link, nullif(btrim(coalesce(p_cohort_note, '')), ''),
            coalesce(p_active, true), coalesce(p_sort_order, 0))
    RETURNING id INTO out_id;
  ELSE
    UPDATE public.skill_courses SET
      slug = p_slug, title = btrim(p_title), tagline = btrim(coalesce(p_tagline, '')),
      description = btrim(coalesce(p_description, '')), outcomes = clean, price = p_price,
      duration_days = p_duration_days, class_link = link,
      cohort_note = nullif(btrim(coalesce(p_cohort_note, '')), ''),
      is_active = coalesce(p_active, true), sort_order = coalesce(p_sort_order, 0), updated_at = now()
    WHERE id = p_id
    RETURNING id INTO out_id;
    IF out_id IS NULL THEN RAISE EXCEPTION 'no_such_skill'; END IF;
  END IF;
  RETURN out_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_save_skill_course(UUID, TEXT, TEXT, TEXT, TEXT, TEXT[], INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_skill_course(UUID, TEXT, TEXT, TEXT, TEXT, TEXT[], INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, INTEGER) TO authenticated;

-- ── Admin: who has paid, newest first. ──
CREATE OR REPLACE FUNCTION public.admin_list_skill_enrolments()
RETURNS TABLE (id UUID, user_id UUID, full_name TEXT, email TEXT, course_title TEXT, amount INTEGER,
               payment_reference TEXT, paid_at TIMESTAMPTZ, starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, is_active BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;
  RETURN QUERY
  SELECT e.id, e.user_id, u.full_name, u.email, c.title, e.amount, e.payment_reference,
         e.created_at, e.starts_at, e.ends_at, e.ends_at > now()
  FROM public.skill_enrolments e
  JOIN public.skill_courses c ON c.id = e.skill_course_id
  LEFT JOIN public.users u ON u.id = e.user_id
  ORDER BY e.created_at DESC
  LIMIT 1000;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_list_skill_enrolments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_skill_enrolments() TO authenticated;

-- ── Admin: add days to a student's window (missed classes, a delayed start). ──
CREATE OR REPLACE FUNCTION public.admin_extend_skill_enrolment(p_id UUID, p_days INTEGER)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  out_end TIMESTAMPTZ;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 90 THEN RAISE EXCEPTION 'bad_days'; END IF;
  UPDATE public.skill_enrolments
  SET ends_at = greatest(ends_at, now()) + make_interval(days => p_days)
  WHERE id = p_id
  RETURNING ends_at INTO out_end;
  IF out_end IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN out_end;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_extend_skill_enrolment(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_extend_skill_enrolment(UUID, INTEGER) TO authenticated;

-- An account that bought a skill course keeps its payment history: it
-- can't be deleted from Admin › Users, like any other paying account.
CREATE OR REPLACE FUNCTION public.admin_delete_blocker(p_actor UUID, p_user UUID)
RETURNS TEXT
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN 'not_found'
    WHEN p_actor = p_user THEN 'self'
    WHEN EXISTS (SELECT 1 FROM public.users WHERE id = p_user AND role IN ('admin', 'super_admin')) THEN 'admin_account'
    WHEN EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = p_user AND coalesce(amount, 0) > 0)
      OR EXISTS (SELECT 1 FROM public.ai_tutor_credits WHERE user_id = p_user AND amount_paid > 0)
      OR EXISTS (SELECT 1 FROM public.classroom_group_payments WHERE payer_id = p_user AND status = 'paid')
      OR EXISTS (SELECT 1 FROM public.skill_enrolments WHERE user_id = p_user AND amount > 0) THEN 'has_payments'
    WHEN EXISTS (SELECT 1 FROM public.rep_earnings WHERE rep_id = p_user OR student_id = p_user)
      OR EXISTS (SELECT 1 FROM public.rep_payouts WHERE rep_id = p_user) THEN 'rep_records'
    ELSE NULL
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_delete_blocker(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_blocker(UUID, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
