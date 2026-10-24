-- ================================================================
-- MIGRATION: Classroom analytics for admins
-- Run this in the Supabase SQL Editor once, after 031. Safe to re-run.
--
-- Answers "are classrooms working, and are they making or losing
-- money?": invites opened vs. joins, free vs. paid joins, whether
-- members go on to pay, and what the class deal actually costs.
-- ================================================================

-- ── Invite opens ───────────────────────────────────────────────────────
-- Written only by log_classroom_invite_view (no direct access), so the
-- count can't be inflated by inserting rows.
CREATE TABLE IF NOT EXISTS public.classroom_invite_views (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  classroom_id UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_classroom_invite_views_time ON public.classroom_invite_views(created_at);
CREATE INDEX IF NOT EXISTS idx_classroom_invite_views_room ON public.classroom_invite_views(classroom_id);
ALTER TABLE public.classroom_invite_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.classroom_invite_views FROM anon, authenticated;

-- The invite page calls this on open, signed in or not. A signed-in
-- student counts once per classroom per day; anonymous opens are capped
-- per classroom per minute so a refresh loop can't skew the numbers.
CREATE OR REPLACE FUNCTION public.log_classroom_invite_view(p_code TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  room_id UUID;
BEGIN
  SELECT id INTO room_id FROM public.classrooms WHERE join_code = upper(btrim(coalesce(p_code, '')));
  IF room_id IS NULL THEN RETURN; END IF;
  IF uid IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.classroom_invite_views v
    WHERE v.classroom_id = room_id AND v.user_id = uid AND v.created_at > now() - interval '1 day'
  ) THEN RETURN; END IF;
  IF uid IS NULL AND (
    SELECT count(*) FROM public.classroom_invite_views v
    WHERE v.classroom_id = room_id AND v.user_id IS NULL AND v.created_at > now() - interval '1 minute'
  ) >= 20 THEN RETURN; END IF;
  INSERT INTO public.classroom_invite_views (classroom_id, user_id) VALUES (room_id, uid);
END;
$$;
GRANT EXECUTE ON FUNCTION public.log_classroom_invite_view(TEXT) TO anon, authenticated;

-- ── How each member got in ─────────────────────────────────────────────
-- 'owner' (created it), 'free' (their free course, including one this
-- join claimed), 'paid' (an unlocked level). NULL = joined before this
-- migration.
ALTER TABLE public.classroom_members ADD COLUMN IF NOT EXISTS joined_with TEXT
  CHECK (joined_with IN ('owner', 'free', 'paid'));

CREATE OR REPLACE FUNCTION public.join_classroom(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  room public.classrooms%ROWTYPE;
  access TEXT;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT * INTO room FROM public.classrooms WHERE join_code = upper(btrim(coalesce(p_code, '')));
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_code'; END IF;
  IF EXISTS (SELECT 1 FROM public.classroom_members WHERE classroom_id = room.id AND user_id = uid) THEN
    RETURN room.id;
  END IF;
  IF (SELECT count(*) FROM public.classroom_members WHERE classroom_id = room.id) >= room.max_members THEN
    RAISE EXCEPTION 'classroom_full';
  END IF;

  -- Serialises this student's joins, so two invites opened at once can't
  -- both be taken as "my free course".
  PERFORM 1 FROM public.users WHERE id = uid FOR UPDATE;
  access := public.course_access_for(uid, room.course_id);
  IF access IN ('payment_required', 'wrong_program') THEN RAISE EXCEPTION '%', access; END IF;

  INSERT INTO public.classroom_members (classroom_id, user_id, joined_with)
  VALUES (room.id, uid, CASE WHEN access = 'paid' THEN 'paid' ELSE 'free' END);
  IF access = 'available_free' THEN PERFORM public.claim_free_course(uid, room.course_id); END IF;
  RETURN room.id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.join_classroom(TEXT) FROM anon;

CREATE OR REPLACE FUNCTION public.create_classroom(p_name TEXT, p_course_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  new_id UUID;
  access TEXT;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF char_length(btrim(coalesce(p_name, ''))) NOT BETWEEN 3 AND 80 THEN RAISE EXCEPTION 'bad_name'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.courses WHERE id = p_course_id) THEN RAISE EXCEPTION 'bad_course'; END IF;
  -- Abuse guard: a student can own at most 10 classrooms.
  IF (SELECT count(*) FROM public.classrooms WHERE owner_id = uid) >= 10 THEN RAISE EXCEPTION 'too_many_classrooms'; END IF;

  PERFORM 1 FROM public.users WHERE id = uid FOR UPDATE;
  access := public.course_access_for(uid, p_course_id);
  IF access IN ('payment_required', 'wrong_program') THEN RAISE EXCEPTION '%', access; END IF;

  INSERT INTO public.classrooms (name, course_id, owner_id, join_code)
  VALUES (btrim(p_name), p_course_id, uid, public.new_classroom_code())
  RETURNING id INTO new_id;

  INSERT INTO public.classroom_members (classroom_id, user_id, role, joined_with) VALUES (new_id, uid, 'owner', 'owner');
  IF access = 'available_free' THEN PERFORM public.claim_free_course(uid, p_course_id); END IF;
  RETURN new_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_classroom(TEXT, UUID) FROM anon;

-- ── What a payment would have cost without the class deal ──────────────
-- Set by /api/payments/verify and the webhook. NULL on older rows.
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS full_amount INTEGER;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS deal_classroom_id UUID REFERENCES public.classrooms(id) ON DELETE SET NULL;

-- ── The dashboard, in one call ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_classroom_stats(p_days INTEGER DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  since TIMESTAMP WITH TIME ZONE := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
  result JSONB;
BEGIN
  IF NOT coalesce(public.is_admin(), false) THEN RAISE EXCEPTION 'admin_only'; END IF;

  WITH member_pay AS (
    -- A member "paid after joining" if they unlocked the classroom's
    -- level+semester within 14 days of joining it (counted once each).
    SELECT DISTINCT ON (m.user_id, m.classroom_id) m.user_id, m.classroom_id, s.amount
    FROM public.classroom_members m
    JOIN public.classrooms c ON c.id = m.classroom_id
    JOIN public.courses co ON co.id = c.course_id
    JOIN public.subscriptions s ON s.user_id = m.user_id AND s.status = 'active'
      AND s.level = co.level AND s.semester = co.semester
      AND s.paid_at >= m.joined_at AND s.paid_at < m.joined_at + interval '14 days'
    WHERE m.joined_at >= since AND m.role <> 'owner'
    ORDER BY m.user_id, m.classroom_id, s.paid_at
  ),
  days AS (
    SELECT generate_series(date_trunc('day', since), date_trunc('day', now()), interval '1 day')::date AS day
  )
  SELECT jsonb_build_object(
    'days', greatest(1, least(coalesce(p_days, 30), 365)),
    'classrooms_total', (SELECT count(*) FROM public.classrooms),
    'classrooms_new', (SELECT count(*) FROM public.classrooms WHERE created_at >= since),
    'members_total', (SELECT count(*) FROM public.classroom_members),
    'invite_views', (SELECT count(*) FROM public.classroom_invite_views WHERE created_at >= since),
    'joins', (SELECT count(*) FROM public.classroom_members WHERE joined_at >= since AND role <> 'owner'),
    'joins_free', (SELECT count(*) FROM public.classroom_members WHERE joined_at >= since AND joined_with = 'free'),
    'joins_paid', (SELECT count(*) FROM public.classroom_members WHERE joined_at >= since AND joined_with = 'paid'),
    'paid_after_join', (SELECT count(*) FROM member_pay),
    'paid_after_join_amount', (SELECT coalesce(sum(amount), 0) FROM member_pay),
    'payments_total', (SELECT count(*) FROM public.subscriptions WHERE status = 'active' AND paid_at >= since),
    'payments_with_deal', (SELECT count(*) FROM public.subscriptions WHERE status = 'active' AND paid_at >= since AND deal_classroom_id IS NOT NULL),
    'deal_discount_total', (SELECT coalesce(sum(full_amount - amount), 0) FROM public.subscriptions
                            WHERE status = 'active' AND paid_at >= since AND deal_classroom_id IS NOT NULL AND full_amount > amount),
    'daily', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'day', d.day,
                'views', (SELECT count(*) FROM public.classroom_invite_views v WHERE v.created_at::date = d.day),
                'joins', (SELECT count(*) FROM public.classroom_members m WHERE m.joined_at::date = d.day AND m.role <> 'owner'),
                'created', (SELECT count(*) FROM public.classrooms c WHERE c.created_at::date = d.day)
              ) ORDER BY d.day), '[]'::jsonb) FROM days d),
    'top', (SELECT coalesce(jsonb_agg(t ORDER BY t.messages_7d + t.tests_7d DESC, t.members DESC), '[]'::jsonb) FROM (
              SELECT * FROM (
                SELECT c.id, c.name, co.course_code, c.created_at,
                       (SELECT count(*) FROM public.classroom_members m WHERE m.classroom_id = c.id)::INTEGER AS members,
                       (SELECT count(*) FROM public.classroom_messages x WHERE x.classroom_id = c.id AND x.created_at > now() - interval '7 days')::INTEGER AS messages_7d,
                       (SELECT count(*) FROM public.tests te JOIN public.classroom_members m ON m.user_id = te.user_id AND m.classroom_id = c.id
                        WHERE te.course_id = c.course_id AND te.created_at > now() - interval '7 days')::INTEGER AS tests_7d
                FROM public.classrooms c JOIN public.courses co ON co.id = c.course_id
              ) ranked
              ORDER BY messages_7d + tests_7d DESC, members DESC
              LIMIT 10
            ) t)
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_classroom_stats(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_classroom_stats(INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
