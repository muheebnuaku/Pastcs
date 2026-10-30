-- ================================================================
-- MIGRATION: Users admin at scale, spam sign-ups, deleting accounts
-- (2026-10-30)
-- ================================================================
-- 1. Spam names. Bots were signing up with a "name" that is an advert
--    and a link ("💎15k TL + 200 FS bedava! … https://bit.ly/…"), which
--    then goes out in our own emails and sits in the Users list. A name
--    that carries a link or web address, HTML, or runs past 80
--    characters is now refused by the database itself, on sign-up (any
--    route, including the auth API directly) and on later edits.
--    looks_like_spam_name is also the "Suspicious" filter for the ones
--    already in.
-- 2. The Users page loaded every account, every test and every tracked
--    event on each visit. admin_search_users pages, filters and counts
--    in the database; admin_user_detail is everything about one person.
-- 3. Deleting an account (done by /api/admin/users/delete with the auth
--    admin API) is checked here first: never yourself, never an admin,
--    never anyone who has paid (their payment records must stay) or a
--    rep with commission on record. Those can be suspended instead.
--
-- Safe to run more than once.
-- ================================================================

CREATE OR REPLACE FUNCTION public.looks_like_spam_name(p TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT p IS NOT NULL AND (
       p ~* '(https?://|www\.|bit\.ly|t\.me/|wa\.me/|tinyurl|discord\.gg|goo\.gl)'
    OR p ~* '[a-z0-9-]{2,}\.(com|net|org|ru|xyz|top|ly|io|info|biz|click|link|site|online|shop|store|vip|bet|win|tk|cn|su)([^a-z]|$)'
    OR p ~ '[<>]'
    OR char_length(p) > 80
  );
$$;
REVOKE EXECUTE ON FUNCTION public.looks_like_spam_name(TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_user_name()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF public.looks_like_spam_name(NEW.full_name)
     AND (TG_OP = 'INSERT' OR NEW.full_name IS DISTINCT FROM OLD.full_name) THEN
    RAISE EXCEPTION 'spam_name' USING HINT = 'Names can’t contain links or web addresses.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_user_name ON public.users;
CREATE TRIGGER guard_user_name BEFORE INSERT OR UPDATE OF full_name ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_name();

CREATE INDEX IF NOT EXISTS idx_users_registration_ip ON public.users(registration_ip) WHERE registration_ip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_created ON public.users(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_messages_unread_reply ON public.admin_messages(user_id) WHERE NOT is_read AND sender_id = user_id;
CREATE INDEX IF NOT EXISTS idx_feature_events_user_created ON public.feature_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tests_user_completed ON public.tests(user_id, completed_at DESC);

-- ── One filter rule, shared by the list and the counts ───────────────
CREATE OR REPLACE FUNCTION public.admin_user_matches(u public.users, p_filter TEXT)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT CASE coalesce(p_filter, 'all')
    WHEN 'all' THEN true
    WHEN 'students' THEN u.role = 'student'
    WHEN 'admins' THEN u.role IN ('admin', 'super_admin')
    WHEN 'suspended' THEN u.is_suspended
    WHEN 'suspicious' THEN public.looks_like_spam_name(u.full_name)
    WHEN 'unconfirmed' THEN EXISTS (SELECT 1 FROM auth.users a WHERE a.id = u.id AND a.email_confirmed_at IS NULL)
    WHEN 'reps' THEN EXISTS (SELECT 1 FROM public.level_reps r WHERE r.user_id = u.id)
    WHEN 'paid' THEN EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = u.id AND s.status = 'active' AND coalesce(s.amount, 0) > 0)
    WHEN 'free_pass' THEN EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = u.id AND s.status = 'active' AND s.payment_reference LIKE 'free\_pass\_%')
    WHEN 'unread' THEN EXISTS (SELECT 1 FROM public.admin_messages m WHERE m.user_id = u.id AND m.sender_id = u.id AND NOT m.is_read)
    WHEN 'shared_ip' THEN u.registration_ip IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.users o WHERE o.registration_ip = u.registration_ip AND o.id <> u.id)
    ELSE false
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_user_matches(public.users, TEXT) FROM PUBLIC, anon, authenticated;

-- A page of accounts, newest first, with what the list shows.
CREATE OR REPLACE FUNCTION public.admin_search_users(p_q TEXT DEFAULT NULL, p_filter TEXT DEFAULT 'all',
                                                     p_limit INTEGER DEFAULT 25, p_offset INTEGER DEFAULT 0)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  q TEXT := nullif(btrim(coalesce(p_q, '')), '');
  lim INTEGER := greatest(1, least(coalesce(p_limit, 25), 100));
  total INTEGER;
  rows JSONB;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;

  SELECT count(*) INTO total FROM public.users u
  WHERE public.admin_user_matches(u, p_filter)
    AND (q IS NULL OR u.full_name ILIKE '%' || q || '%' OR u.email ILIKE '%' || q || '%' OR u.id::text = q);

  SELECT coalesce(jsonb_agg(r ORDER BY r.created_at DESC, r.id), '[]'::jsonb) INTO rows FROM (
    SELECT u.id, u.email, u.full_name, u.role, u.avatar_url, u.program_id,
           p.short_code AS program_code, u.selected_level, u.selected_semester, u.created_at,
           u.is_suspended, u.total_tests_taken, u.practice_streak, u.xp,
           (a.email_confirmed_at IS NOT NULL) AS email_confirmed,
           greatest(
             (SELECT t.completed_at FROM public.tests t WHERE t.user_id = u.id ORDER BY t.completed_at DESC NULLS LAST LIMIT 1),
             (SELECT e.created_at FROM public.feature_events e WHERE e.user_id = u.id ORDER BY e.created_at DESC LIMIT 1)
           ) AS last_active,
           CASE
             WHEN EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = u.id AND s.status = 'active' AND coalesce(s.amount, 0) > 0) THEN 'paid'
             WHEN EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = u.id AND s.status = 'active' AND s.payment_reference LIKE 'free\_pass\_%') THEN 'free_pass'
             ELSE 'none'
           END AS access,
           EXISTS (SELECT 1 FROM public.admin_messages m WHERE m.user_id = u.id AND m.sender_id = u.id AND NOT m.is_read) AS unread_reply,
           CASE WHEN u.registration_ip IS NULL THEN 0
                ELSE (SELECT count(*)::int FROM public.users o WHERE o.registration_ip = u.registration_ip AND o.id <> u.id) END AS shared_ip,
           public.looks_like_spam_name(u.full_name) AS suspicious,
           (SELECT r.level FROM public.level_reps r WHERE r.user_id = u.id) AS rep_level
    FROM (
      SELECT u.id FROM public.users u
      WHERE public.admin_user_matches(u, p_filter)
        AND (q IS NULL OR u.full_name ILIKE '%' || q || '%' OR u.email ILIKE '%' || q || '%' OR u.id::text = q)
      ORDER BY u.created_at DESC, u.id
      LIMIT lim OFFSET greatest(coalesce(p_offset, 0), 0)
    ) h
    JOIN public.users u ON u.id = h.id
    LEFT JOIN public.programs p ON p.id = u.program_id
    LEFT JOIN auth.users a ON a.id = u.id
  ) r;

  RETURN jsonb_build_object('total', total, 'rows', rows);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_search_users(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_users(TEXT, TEXT, INTEGER, INTEGER) TO authenticated;

-- How many accounts each filter holds, for the filter chips.
CREATE OR REPLACE FUNCTION public.admin_user_counts()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  f TEXT;
  out JSONB := '{}'::jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;
  FOREACH f IN ARRAY ARRAY['all', 'students', 'admins', 'reps', 'paid', 'free_pass', 'unread', 'suspicious', 'shared_ip', 'unconfirmed', 'suspended'] LOOP
    out := out || jsonb_build_object(f, (SELECT count(*) FROM public.users u WHERE public.admin_user_matches(u, f)));
  END LOOP;
  RETURN out;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_user_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_user_counts() TO authenticated;

-- Everything the detail panel shows about one account.
CREATE OR REPLACE FUNCTION public.admin_user_detail(p_user UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  u public.users%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;
  SELECT * INTO u FROM public.users WHERE id = p_user;
  IF u.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'id', u.id, 'email', u.email, 'full_name', u.full_name, 'role', u.role, 'avatar_url', u.avatar_url,
    'student_id', u.student_id, 'program_id', u.program_id, 'program', u.program,
    'program_name', (SELECT name FROM public.programs WHERE id = u.program_id),
    'selected_level', u.selected_level, 'selected_semester', u.selected_semester,
    'free_course_code', u.free_course_code, 'referral_code', u.referral_code,
    'referred_by', (SELECT jsonb_build_object('id', r.id, 'name', r.full_name, 'email', r.email) FROM public.users r WHERE r.id = u.referred_by),
    'created_at', u.created_at, 'is_suspended', u.is_suspended,
    'total_tests_taken', u.total_tests_taken, 'practice_streak', u.practice_streak, 'xp', u.xp,
    'registration_ip', u.registration_ip,
    'email_confirmed_at', (SELECT email_confirmed_at FROM auth.users WHERE id = u.id),
    'last_sign_in_at', (SELECT last_sign_in_at FROM auth.users WHERE id = u.id),
    'last_active', greatest(
      (SELECT max(completed_at) FROM public.tests WHERE user_id = u.id),
      (SELECT max(created_at) FROM public.feature_events WHERE user_id = u.id)),
    'suspicious', public.looks_like_spam_name(u.full_name),
    'subscriptions', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'level', s.level, 'semester', s.semester, 'program_id', s.program_id,
                                          'program_code', pr.short_code, 'status', s.status, 'amount', s.amount,
                                          'payment_reference', s.payment_reference, 'paid_at', s.paid_at) ORDER BY s.paid_at DESC NULLS LAST)
      FROM public.subscriptions s LEFT JOIN public.programs pr ON pr.id = s.program_id WHERE s.user_id = u.id), '[]'::jsonb),
    'ip_siblings', CASE WHEN u.registration_ip IS NULL THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', o.id, 'name', o.full_name, 'email', o.email, 'suspended', o.is_suspended))
      FROM (SELECT * FROM public.users o WHERE o.registration_ip = u.registration_ip AND o.id <> u.id ORDER BY o.created_at DESC LIMIT 20) o), '[]'::jsonb) END,
    'classrooms', (SELECT count(*) FROM public.classroom_members m WHERE m.user_id = u.id),
    'rep', (SELECT jsonb_build_object('program_id', r.program_id, 'program_name', pr.name, 'level', r.level,
                                      'commission_pct', r.commission_pct, 'discount_pct', r.discount_pct, 'active', r.active,
                                      'signups', (SELECT count(*) FROM public.users s WHERE s.referred_by = r.user_id AND s.id <> r.user_id))
            FROM public.level_reps r LEFT JOIN public.programs pr ON pr.id = r.program_id WHERE r.user_id = u.id),
    'delete_blocked', public.admin_delete_blocker(auth.uid(), u.id)
  );
END;
$$;

-- Why an account can't be deleted, or NULL if it can.
CREATE OR REPLACE FUNCTION public.admin_delete_blocker(p_actor UUID, p_user UUID)
RETURNS TEXT
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN 'not_found'
    WHEN p_actor = p_user THEN 'self'
    WHEN EXISTS (SELECT 1 FROM public.users WHERE id = p_user AND role IN ('admin', 'super_admin')) THEN 'admin_account'
    WHEN EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = p_user AND coalesce(amount, 0) > 0)
      OR EXISTS (SELECT 1 FROM public.ai_tutor_credits WHERE user_id = p_user AND amount_paid > 0)
      OR EXISTS (SELECT 1 FROM public.classroom_group_payments WHERE payer_id = p_user AND status = 'paid') THEN 'has_payments'
    WHEN EXISTS (SELECT 1 FROM public.rep_earnings WHERE rep_id = p_user OR student_id = p_user)
      OR EXISTS (SELECT 1 FROM public.rep_payouts WHERE rep_id = p_user) THEN 'rep_records'
    ELSE NULL
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_delete_blocker(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_blocker(UUID, UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.admin_user_detail(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_user_detail(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
