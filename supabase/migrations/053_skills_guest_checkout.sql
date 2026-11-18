-- ================================================================
-- MIGRATION: Skills without an account, samples and pictures (2026-11-18)
-- ================================================================
-- 1. Anyone can buy a skill course: no PastCS account needed. The buyer
--    gives a name, email and WhatsApp number (the number is how they get
--    added to the class group). Every purchase has a secret access_token;
--    its link (/skills/<course>?access=<token>) shows the class link
--    and downloads, on any device. A signed-in student is still recorded
--    against their account as before.
-- 2. Each course can show a real example (sample_url + sample_label), a
--    picture (image_url), and a sample project file (a zip) that admins
--    upload. The file is for paying students unless sample_file_public.
-- 3. WhatsApp AI Bot is now GHC 3000, with the demo bot's number as its
--    example. Vibe Coding's example is pastcs.com, AI Automation's is
--    nyansaai.com.
--
-- Storage buckets: skill-images (public pictures) and skill-files
-- (private zips, handed out by the app through short-lived links).
-- Only admins can upload to either.
--
-- Safe to run more than once. Run after 052.
-- ================================================================

ALTER TABLE public.skill_courses ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE public.skill_courses ADD COLUMN IF NOT EXISTS sample_url TEXT;
ALTER TABLE public.skill_courses ADD COLUMN IF NOT EXISTS sample_label TEXT;
ALTER TABLE public.skill_courses ADD COLUMN IF NOT EXISTS sample_file_path TEXT;
ALTER TABLE public.skill_courses ADD COLUMN IF NOT EXISTS sample_file_name TEXT;
ALTER TABLE public.skill_courses ADD COLUMN IF NOT EXISTS sample_file_public BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.skill_enrolments ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.skill_enrolments ADD COLUMN IF NOT EXISTS buyer_name TEXT;
ALTER TABLE public.skill_enrolments ADD COLUMN IF NOT EXISTS buyer_email TEXT;
ALTER TABLE public.skill_enrolments ADD COLUMN IF NOT EXISTS buyer_phone TEXT;
ALTER TABLE public.skill_enrolments ADD COLUMN IF NOT EXISTS access_token UUID NOT NULL DEFAULT uuid_generate_v4();
CREATE UNIQUE INDEX IF NOT EXISTS skill_enrolments_access_token_idx ON public.skill_enrolments (access_token);
CREATE INDEX IF NOT EXISTS skill_enrolments_email_idx ON public.skill_enrolments (lower(buyer_email), skill_course_id, ends_at DESC);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'skill_enrolments_has_buyer') THEN
    ALTER TABLE public.skill_enrolments
      ADD CONSTRAINT skill_enrolments_has_buyer CHECK (user_id IS NOT NULL OR buyer_email IS NOT NULL);
  END IF;
END;
$$;

-- The examples and the new WhatsApp price.
UPDATE public.skill_courses SET sample_url = 'https://pastcs.com',
  sample_label = 'PastCS, the site you’re on, was built with vibe coding.'
WHERE slug = 'vibe-coding' AND sample_url IS NULL;
UPDATE public.skill_courses SET sample_url = 'https://nyansaai.com/',
  sample_label = 'Nyansa AI reads a company’s documents and answers questions about them, with sources.'
WHERE slug = 'ai-automation' AND sample_url IS NULL;
UPDATE public.skill_courses SET sample_url = 'https://wa.me/233270000004',
  sample_label = 'Chat with our demo bot on WhatsApp: +233 27 000 0004'
WHERE slug = 'whatsapp-ai-bot' AND sample_url IS NULL;
UPDATE public.skill_courses SET price = 300000, updated_at = now()
WHERE slug = 'whatsapp-ai-bot' AND price = 200000;

-- ── Storage ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('skill-images', 'skill-images', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('skill-files', 'skill-files', false, 52428800)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS "skill_images_public_read" ON storage.objects;
CREATE POLICY "skill_images_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'skill-images');
DROP POLICY IF EXISTS "skill_media_admin_insert" ON storage.objects;
CREATE POLICY "skill_media_admin_insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id IN ('skill-images', 'skill-files') AND public.is_admin());
DROP POLICY IF EXISTS "skill_media_admin_update" ON storage.objects;
CREATE POLICY "skill_media_admin_update" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id IN ('skill-images', 'skill-files') AND public.is_admin());
DROP POLICY IF EXISTS "skill_media_admin_delete" ON storage.objects;
CREATE POLICY "skill_media_admin_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id IN ('skill-images', 'skill-files') AND public.is_admin());
DROP POLICY IF EXISTS "skill_files_admin_read" ON storage.objects;
CREATE POLICY "skill_files_admin_read" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'skill-files' AND public.is_admin());

-- ── What's on sale, now with picture, example and whether there's a file. ──
DROP FUNCTION IF EXISTS public.get_skill_courses();
CREATE FUNCTION public.get_skill_courses()
RETURNS TABLE (id UUID, slug TEXT, title TEXT, tagline TEXT, description TEXT, outcomes TEXT[],
               price INTEGER, duration_days INTEGER, cohort_note TEXT, image_url TEXT,
               sample_url TEXT, sample_label TEXT, has_sample_file BOOLEAN, sample_file_public BOOLEAN)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT c.id, c.slug, c.title, c.tagline, c.description, c.outcomes, c.price, c.duration_days, c.cohort_note,
         c.image_url, c.sample_url, c.sample_label, c.sample_file_path IS NOT NULL, c.sample_file_public
  FROM public.skill_courses c
  WHERE c.is_active
  ORDER BY c.sort_order, c.title;
$$;
REVOKE EXECUTE ON FUNCTION public.get_skill_courses() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_skill_courses() TO anon, authenticated, service_role;

-- ── A purchase seen through its access link (anyone holding the token). ──
CREATE OR REPLACE FUNCTION public.get_skill_access(p_token UUID)
RETURNS TABLE (slug TEXT, title TEXT, buyer_name TEXT, starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ,
               is_active BOOLEAN, class_link TEXT, cohort_note TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  -- The whole run of stacked purchases this one belongs to, so an older
  -- link still shows the latest end date.
  WITH me AS (
    SELECT e.* FROM public.skill_enrolments e WHERE e.access_token = p_token
  ), run AS (
    SELECT x.* FROM public.skill_enrolments x, me
    WHERE x.skill_course_id = me.skill_course_id
      AND ((me.user_id IS NOT NULL AND x.user_id = me.user_id)
        OR (me.user_id IS NULL AND x.user_id IS NULL AND lower(x.buyer_email) = lower(me.buyer_email)))
  )
  SELECT c.slug, c.title, (SELECT coalesce(me.buyer_name, u.full_name) FROM me LEFT JOIN public.users u ON u.id = me.user_id),
         coalesce((SELECT min(r.starts_at) FROM run r WHERE r.ends_at > now()), (SELECT me.starts_at FROM me)),
         (SELECT max(r.ends_at) FROM run r),
         (SELECT max(r.ends_at) FROM run r) > now(),
         CASE WHEN (SELECT max(r.ends_at) FROM run r) > now() THEN c.class_link END,
         c.cohort_note
  FROM me JOIN public.skill_courses c ON c.id = me.skill_course_id;
$$;
REVOKE EXECUTE ON FUNCTION public.get_skill_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_skill_access(UUID) TO anon, authenticated, service_role;

-- ── Record a purchase: an account (p_user) or a guest (p_user NULL, email
-- required). Returns the access token for the buyer's link. ──
DROP FUNCTION IF EXISTS public.record_skill_enrolment(UUID, TEXT, TEXT, INTEGER, TEXT);
CREATE OR REPLACE FUNCTION public.record_skill_enrolment(
  p_user UUID, p_slug TEXT, p_reference TEXT, p_amount INTEGER, p_currency TEXT,
  p_name TEXT, p_email TEXT, p_phone TEXT)
RETURNS TABLE (enrolment_id UUID, title TEXT, ends_at TIMESTAMPTZ, access_token UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.skill_courses%ROWTYPE;
  prior public.skill_enrolments%ROWTYPE;
  begins TIMESTAMPTZ;
  new_id UUID;
  who TEXT;
  mail TEXT := nullif(lower(btrim(coalesce(p_email, ''))), '');
  nm TEXT := nullif(left(btrim(coalesce(p_name, '')), 120), '');
  ph TEXT := nullif(left(btrim(coalesce(p_phone, '')), 40), '');
BEGIN
  IF p_reference IS NULL OR btrim(p_reference) = '' THEN RAISE EXCEPTION 'bad_reference'; END IF;

  SELECT * INTO prior FROM public.skill_enrolments e WHERE e.payment_reference = p_reference;
  IF FOUND THEN
    IF prior.user_id IS DISTINCT FROM p_user THEN RAISE EXCEPTION 'reference_used'; END IF;
    RETURN QUERY SELECT prior.id, (SELECT s.title FROM public.skill_courses s WHERE s.id = prior.skill_course_id), prior.ends_at, prior.access_token;
    RETURN;
  END IF;

  SELECT * INTO c FROM public.skill_courses s WHERE s.slug = p_slug;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_such_skill'; END IF;
  IF p_user IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN RAISE EXCEPTION 'no_such_user'; END IF;
    SELECT coalesce(mail, lower(u.email)), coalesce(nm, nullif(btrim(u.full_name), '')) INTO mail, nm FROM public.users u WHERE u.id = p_user;
  ELSIF mail IS NULL THEN
    RAISE EXCEPTION 'no_buyer';
  END IF;
  IF coalesce(p_currency, '') <> 'GHS' OR p_amount IS NULL OR p_amount < c.price THEN
    RAISE EXCEPTION 'amount_too_low';
  END IF;

  -- One purchase at a time per buyer and course, so two payments arriving
  -- together stack instead of overlapping.
  PERFORM pg_advisory_xact_lock(hashtext('skill:' || coalesce(p_user::text, mail) || ':' || c.id::text));

  SELECT greatest(now(), coalesce(max(e.ends_at), now())) INTO begins
  FROM public.skill_enrolments e
  WHERE e.skill_course_id = c.id
    AND ((p_user IS NOT NULL AND e.user_id = p_user)
      OR (p_user IS NULL AND e.user_id IS NULL AND lower(e.buyer_email) = mail));

  INSERT INTO public.skill_enrolments (user_id, skill_course_id, payment_reference, amount, starts_at, ends_at,
                                       buyer_name, buyer_email, buyer_phone)
  VALUES (p_user, c.id, p_reference, p_amount, begins, begins + make_interval(days => c.duration_days), nm, mail, ph)
  ON CONFLICT (payment_reference) DO NOTHING
  RETURNING id INTO new_id;

  IF new_id IS NULL THEN
    RETURN QUERY SELECT e.id, c.title, e.ends_at, e.access_token FROM public.skill_enrolments e WHERE e.payment_reference = p_reference;
    RETURN;
  END IF;

  who := coalesce(nm, mail, 'Someone');

  IF p_user IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, message, link, dedupe_key, meta)
    VALUES (p_user, 'skill_enrolled',
            'You’re in: ' || c.title || '. Your teaching runs until '
              || to_char(begins + make_interval(days => c.duration_days), 'FMDD Mon')
              || '. Open the course page for your class link.',
            '/skills/' || c.slug, 'skill:' || p_reference,
            jsonb_build_object('push_title', 'Welcome to ' || c.title))
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END IF;

  INSERT INTO public.notifications (user_id, type, message, link, dedupe_key, meta)
  SELECT a.id, 'skill_sale',
         who || ' paid GHC ' || trim(to_char(p_amount / 100.0, 'FM999G999G990D00')) || ' for ' || c.title
           || CASE WHEN ph IS NOT NULL THEN '. WhatsApp: ' || ph ELSE '' END || '.',
         '/admin/skills', 'skill:' || p_reference,
         jsonb_build_object('push_title', 'New ' || c.title || ' student')
  FROM public.users a
  WHERE a.role IN ('admin', 'super_admin') AND a.id IS DISTINCT FROM p_user
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  RETURN QUERY SELECT e.id, c.title, e.ends_at, e.access_token FROM public.skill_enrolments e WHERE e.id = new_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_skill_enrolment(UUID, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_skill_enrolment(UUID, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ── Can this buyer download the course's sample file? (download route) ──
CREATE OR REPLACE FUNCTION public.skill_file_for(p_slug TEXT, p_user UUID, p_token UUID)
RETURNS TABLE (path TEXT, file_name TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT c.sample_file_path, coalesce(c.sample_file_name, c.slug || '-sample.zip')
  FROM public.skill_courses c
  WHERE c.slug = p_slug AND c.sample_file_path IS NOT NULL
    AND (c.sample_file_public
      OR EXISTS (SELECT 1 FROM public.skill_enrolments e WHERE e.skill_course_id = c.id
                 AND ((p_user IS NOT NULL AND e.user_id = p_user) OR (p_token IS NOT NULL AND e.access_token = p_token))));
$$;
REVOKE EXECUTE ON FUNCTION public.skill_file_for(TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.skill_file_for(TEXT, UUID, UUID) TO service_role;

-- ── Admin: courses with the new fields. ──
DROP FUNCTION IF EXISTS public.admin_list_skill_courses();
CREATE FUNCTION public.admin_list_skill_courses()
RETURNS TABLE (id UUID, slug TEXT, title TEXT, tagline TEXT, description TEXT, outcomes TEXT[],
               price INTEGER, duration_days INTEGER, class_link TEXT, cohort_note TEXT,
               is_active BOOLEAN, sort_order INTEGER, image_url TEXT, sample_url TEXT, sample_label TEXT,
               sample_file_path TEXT, sample_file_name TEXT, sample_file_public BOOLEAN,
               students BIGINT, running BIGINT, revenue BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;
  RETURN QUERY
  SELECT c.id, c.slug, c.title, c.tagline, c.description, c.outcomes, c.price, c.duration_days,
         c.class_link, c.cohort_note, c.is_active, c.sort_order, c.image_url, c.sample_url, c.sample_label,
         c.sample_file_path, c.sample_file_name, c.sample_file_public,
         (SELECT count(DISTINCT coalesce(e.user_id::text, lower(e.buyer_email))) FROM public.skill_enrolments e WHERE e.skill_course_id = c.id),
         (SELECT count(DISTINCT coalesce(e.user_id::text, lower(e.buyer_email))) FROM public.skill_enrolments e WHERE e.skill_course_id = c.id AND e.ends_at > now()),
         (SELECT coalesce(sum(e.amount), 0) FROM public.skill_enrolments e WHERE e.skill_course_id = c.id)::bigint
  FROM public.skill_courses c
  ORDER BY c.sort_order, c.title;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_list_skill_courses() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_skill_courses() TO authenticated;

DROP FUNCTION IF EXISTS public.admin_save_skill_course(UUID, TEXT, TEXT, TEXT, TEXT, TEXT[], INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, INTEGER);
CREATE OR REPLACE FUNCTION public.admin_save_skill_course(
  p_id UUID, p_slug TEXT, p_title TEXT, p_tagline TEXT, p_description TEXT, p_outcomes TEXT[],
  p_price INTEGER, p_duration_days INTEGER, p_class_link TEXT, p_cohort_note TEXT,
  p_active BOOLEAN, p_sort_order INTEGER,
  p_image_url TEXT, p_sample_url TEXT, p_sample_label TEXT, p_sample_file_public BOOLEAN)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  out_id UUID;
  link TEXT := nullif(btrim(coalesce(p_class_link, '')), '');
  img TEXT := nullif(btrim(coalesce(p_image_url, '')), '');
  sample TEXT := nullif(btrim(coalesce(p_sample_url, '')), '');
  clean TEXT[];
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(p_slug) > 60 THEN RAISE EXCEPTION 'bad_slug'; END IF;
  IF p_title IS NULL OR btrim(p_title) = '' THEN RAISE EXCEPTION 'bad_title'; END IF;
  IF p_price IS NULL OR p_price < 100 OR p_price > 100000000 THEN RAISE EXCEPTION 'bad_price'; END IF;
  IF p_duration_days IS NULL OR p_duration_days < 1 OR p_duration_days > 365 THEN RAISE EXCEPTION 'bad_duration'; END IF;
  IF link IS NOT NULL AND link !~* '^https://' THEN RAISE EXCEPTION 'bad_link'; END IF;
  IF sample IS NOT NULL AND sample !~* '^https://' THEN RAISE EXCEPTION 'bad_sample_link'; END IF;
  IF img IS NOT NULL AND img !~* '^https://' THEN RAISE EXCEPTION 'bad_image'; END IF;
  IF EXISTS (SELECT 1 FROM public.skill_courses s WHERE s.slug = p_slug AND s.id IS DISTINCT FROM p_id) THEN
    RAISE EXCEPTION 'slug_taken';
  END IF;

  SELECT coalesce(array_agg(btrim(o) ORDER BY n), '{}') INTO clean
  FROM unnest(coalesce(p_outcomes, '{}')) WITH ORDINALITY AS t(o, n)
  WHERE btrim(o) <> '';

  IF p_id IS NULL THEN
    INSERT INTO public.skill_courses (slug, title, tagline, description, outcomes, price, duration_days,
                                      class_link, cohort_note, is_active, sort_order,
                                      image_url, sample_url, sample_label, sample_file_public)
    VALUES (p_slug, btrim(p_title), btrim(coalesce(p_tagline, '')), btrim(coalesce(p_description, '')), clean,
            p_price, p_duration_days, link, nullif(btrim(coalesce(p_cohort_note, '')), ''),
            coalesce(p_active, true), coalesce(p_sort_order, 0),
            img, sample, nullif(btrim(coalesce(p_sample_label, '')), ''), coalesce(p_sample_file_public, false))
    RETURNING id INTO out_id;
  ELSE
    UPDATE public.skill_courses s SET
      slug = p_slug, title = btrim(p_title), tagline = btrim(coalesce(p_tagline, '')),
      description = btrim(coalesce(p_description, '')), outcomes = clean, price = p_price,
      duration_days = p_duration_days, class_link = link,
      cohort_note = nullif(btrim(coalesce(p_cohort_note, '')), ''),
      is_active = coalesce(p_active, true), sort_order = coalesce(p_sort_order, 0),
      image_url = img, sample_url = sample, sample_label = nullif(btrim(coalesce(p_sample_label, '')), ''),
      sample_file_public = coalesce(p_sample_file_public, false), updated_at = now()
    WHERE s.id = p_id
    RETURNING s.id INTO out_id;
    IF out_id IS NULL THEN RAISE EXCEPTION 'no_such_skill'; END IF;
  END IF;
  RETURN out_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_save_skill_course(UUID, TEXT, TEXT, TEXT, TEXT, TEXT[], INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, INTEGER, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_skill_course(UUID, TEXT, TEXT, TEXT, TEXT, TEXT[], INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, INTEGER, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

-- ── Admin: point a course at an uploaded sample file (or clear it). ──
CREATE OR REPLACE FUNCTION public.admin_set_skill_file(p_id UUID, p_path TEXT, p_name TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;
  IF p_path IS NOT NULL AND (p_path !~ '^[a-z0-9-]+/[A-Za-z0-9._-]+$') THEN RAISE EXCEPTION 'bad_path'; END IF;
  UPDATE public.skill_courses SET sample_file_path = p_path,
    sample_file_name = CASE WHEN p_path IS NULL THEN NULL ELSE left(coalesce(nullif(btrim(p_name), ''), 'sample.zip'), 120) END,
    updated_at = now()
  WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_such_skill'; END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_skill_file(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_skill_file(UUID, TEXT, TEXT) TO authenticated;

-- ── Admin: who has paid, with guest buyers' details and access tokens. ──
DROP FUNCTION IF EXISTS public.admin_list_skill_enrolments();
CREATE FUNCTION public.admin_list_skill_enrolments()
RETURNS TABLE (id UUID, user_id UUID, full_name TEXT, email TEXT, phone TEXT, has_account BOOLEAN,
               course_slug TEXT, course_title TEXT, amount INTEGER, payment_reference TEXT, access_token UUID,
               paid_at TIMESTAMPTZ, starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, is_active BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;
  RETURN QUERY
  SELECT e.id, e.user_id, coalesce(e.buyer_name, u.full_name), coalesce(e.buyer_email, u.email), e.buyer_phone,
         e.user_id IS NOT NULL, c.slug, c.title, e.amount, e.payment_reference, e.access_token,
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

NOTIFY pgrst, 'reload schema';
