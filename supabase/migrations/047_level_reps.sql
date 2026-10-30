-- ================================================================
-- MIGRATION: Level Reps — ambassadors paid on the sign-ups they bring
-- (2026-10-30)
-- ================================================================
-- An admin makes any account (student or admin) a Level Rep for a
-- programme and level, with two rates the admin sets, 0–50% each:
--   * discount_pct — taken off every unlock a student pays who signed up
--     with the rep's code (users.referred_by, set at sign-up and locked
--     since migration 031);
--   * commission_pct — the rep's share of what those students actually
--     paid (after the discount).
-- Several reps can share a level; each earns only from their own
-- sign-ups. A rep that's switched off gives no discount and earns
-- nothing on new payments; what they already earned stays.
--
-- Commission is written by a trigger on subscriptions, so every way of
-- paying (checkout, Paystack webhook, a class rep's group payment) is
-- counted, each payment once. Free passes (amount 0) earn nothing.
-- Payouts are recorded by an admin ("Mark as paid") and settle every
-- commission line not yet paid.
--
-- Nothing here is readable by clients except through the functions at
-- the end: admins see everything, a rep sees their own totals and only
-- the first names of their sign-ups.
--
-- Safe to run more than once.
-- ================================================================

CREATE TABLE IF NOT EXISTS public.level_reps (
  user_id        UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  program_id     UUID REFERENCES public.programs(id) ON DELETE SET NULL,
  level          INTEGER NOT NULL CHECK (level IN (100, 200, 300, 400)),
  commission_pct NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (commission_pct BETWEEN 0 AND 50),
  discount_pct   NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 50),
  active         BOOLEAN NOT NULL DEFAULT true,
  created_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_level_reps_level ON public.level_reps(program_id, level);
ALTER TABLE public.level_reps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.level_reps FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.rep_payouts (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rep_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount     INTEGER NOT NULL CHECK (amount > 0),          -- pesewas
  note       TEXT CHECK (note IS NULL OR char_length(note) <= 200),
  paid_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  paid_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rep_payouts_rep ON public.rep_payouts(rep_id, paid_at DESC);
ALTER TABLE public.rep_payouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rep_payouts FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.rep_earnings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rep_id          UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  student_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subscription_id UUID UNIQUE REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  level           INTEGER,
  semester        INTEGER,
  paid_amount     INTEGER NOT NULL,                          -- pesewas the student paid
  commission_pct  NUMERIC(5, 2) NOT NULL,
  commission      INTEGER NOT NULL CHECK (commission >= 0),  -- pesewas
  payout_id       UUID REFERENCES public.rep_payouts(id) ON DELETE SET NULL,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rep_earnings_rep ON public.rep_earnings(rep_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rep_earnings_unpaid ON public.rep_earnings(rep_id) WHERE payout_id IS NULL;
ALTER TABLE public.rep_earnings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rep_earnings FROM anon, authenticated;

-- ── The discount a student gets ──────────────────────────────────────
-- The active rep whose code they signed up with, else 0. Used by the
-- price routes (service role) and shown to the student by
-- get_my_rep_discount.
CREATE OR REPLACE FUNCTION public.rep_discount_for(p_user UUID)
RETURNS NUMERIC
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT coalesce((
    SELECT r.discount_pct FROM public.users u
    JOIN public.level_reps r ON r.user_id = u.referred_by AND r.active
    WHERE u.id = p_user AND u.referred_by IS DISTINCT FROM p_user
  ), 0);
$$;
REVOKE EXECUTE ON FUNCTION public.rep_discount_for(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rep_discount_for(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_rep_discount()
RETURNS NUMERIC
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT public.rep_discount_for(auth.uid()) WHERE auth.uid() IS NOT NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_rep_discount() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_rep_discount() TO authenticated;

-- ── Commission on every paid unlock ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.subscriptions_rep_commission()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rep public.level_reps%ROWTYPE;
BEGIN
  IF NEW.status IS DISTINCT FROM 'active' OR coalesce(NEW.amount, 0) <= 0 THEN RETURN NULL; END IF;
  SELECT r.* INTO rep FROM public.users u
  JOIN public.level_reps r ON r.user_id = u.referred_by AND r.active
  WHERE u.id = NEW.user_id AND u.referred_by IS DISTINCT FROM NEW.user_id;
  IF rep.user_id IS NULL OR rep.commission_pct <= 0 THEN RETURN NULL; END IF;
  -- A rep paying for their own sign-ups' group unlock earns nothing on it
  -- (it would be a refund of their own money).
  IF (to_jsonb(NEW) ->> 'group_payment_id') IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.classroom_group_payments g
    WHERE g.id = (to_jsonb(NEW) ->> 'group_payment_id')::uuid AND g.payer_id = rep.user_id
  ) THEN RETURN NULL; END IF;

  INSERT INTO public.rep_earnings (rep_id, student_id, subscription_id, level, semester, paid_amount, commission_pct, commission)
  VALUES (rep.user_id, NEW.user_id, NEW.id, NEW.level, NEW.semester, NEW.amount, rep.commission_pct,
          floor(NEW.amount * rep.commission_pct / 100)::int)
  ON CONFLICT (subscription_id) DO NOTHING;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- A bookkeeping problem must never lose a payment.
  RAISE WARNING 'subscriptions_rep_commission failed: %', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.subscriptions_rep_commission() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS subscriptions_rep_commission ON public.subscriptions;
CREATE TRIGGER subscriptions_rep_commission AFTER INSERT ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.subscriptions_rep_commission();

-- ── Admin ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_level_rep(
  p_user UUID, p_program UUID, p_level INTEGER, p_commission NUMERIC, p_discount NUMERIC, p_active BOOLEAN DEFAULT true)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN RAISE EXCEPTION 'no_such_user'; END IF;
  IF p_level NOT IN (100, 200, 300, 400) THEN RAISE EXCEPTION 'bad_level'; END IF;
  IF p_commission IS NULL OR p_commission < 0 OR p_commission > 50
     OR p_discount IS NULL OR p_discount < 0 OR p_discount > 50 THEN RAISE EXCEPTION 'bad_rate'; END IF;
  INSERT INTO public.level_reps (user_id, program_id, level, commission_pct, discount_pct, active, created_by)
  VALUES (p_user, p_program, p_level, round(p_commission, 2), round(p_discount, 2), coalesce(p_active, true), auth.uid())
  ON CONFLICT (user_id) DO UPDATE SET
    program_id = EXCLUDED.program_id, level = EXCLUDED.level,
    commission_pct = EXCLUDED.commission_pct, discount_pct = EXCLUDED.discount_pct,
    active = EXCLUDED.active, updated_at = now();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_level_rep(UUID, UUID, INTEGER, NUMERIC, NUMERIC, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_level_rep(UUID, UUID, INTEGER, NUMERIC, NUMERIC, BOOLEAN) TO authenticated;

-- Every rep (active or not) with their numbers. Sign-ups = accounts made
-- with their code; paying = of those, how many have paid at least once.
CREATE OR REPLACE FUNCTION public.admin_list_level_reps()
RETURNS TABLE (user_id UUID, full_name TEXT, email TEXT, referral_code TEXT, program_id UUID, program_name TEXT,
               level INTEGER, commission_pct NUMERIC, discount_pct NUMERIC, active BOOLEAN,
               signups INTEGER, paying INTEGER, revenue BIGINT, earned BIGINT, unpaid BIGINT, paid_out BIGINT,
               created_at TIMESTAMP WITH TIME ZONE)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;
  RETURN QUERY
  SELECT r.user_id, u.full_name, u.email, u.referral_code, r.program_id, p.name, r.level,
         r.commission_pct, r.discount_pct, r.active,
         (SELECT count(*)::int FROM public.users s WHERE s.referred_by = r.user_id AND s.id <> r.user_id),
         (SELECT count(DISTINCT e.student_id)::int FROM public.rep_earnings e WHERE e.rep_id = r.user_id),
         (SELECT coalesce(sum(e.paid_amount), 0)::bigint FROM public.rep_earnings e WHERE e.rep_id = r.user_id),
         (SELECT coalesce(sum(e.commission), 0)::bigint FROM public.rep_earnings e WHERE e.rep_id = r.user_id),
         (SELECT coalesce(sum(e.commission), 0)::bigint FROM public.rep_earnings e WHERE e.rep_id = r.user_id AND e.payout_id IS NULL),
         (SELECT coalesce(sum(o.amount), 0)::bigint FROM public.rep_payouts o WHERE o.rep_id = r.user_id),
         r.created_at
  FROM public.level_reps r
  JOIN public.users u ON u.id = r.user_id
  LEFT JOIN public.programs p ON p.id = r.program_id
  ORDER BY r.level, u.full_name;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_list_level_reps() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_level_reps() TO authenticated;

-- One rep's sign-ups, newest first, with what each has paid.
CREATE OR REPLACE FUNCTION public.admin_rep_signups(p_rep UUID)
RETURNS TABLE (student_id UUID, full_name TEXT, email TEXT, level INTEGER, joined_at TIMESTAMP WITH TIME ZONE,
               paid BIGINT, commission BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;
  RETURN QUERY
  SELECT s.id, s.full_name, s.email, s.selected_level, s.created_at,
         coalesce(sum(e.paid_amount), 0)::bigint, coalesce(sum(e.commission), 0)::bigint
  FROM public.users s
  LEFT JOIN public.rep_earnings e ON e.student_id = s.id AND e.rep_id = p_rep
  WHERE s.referred_by = p_rep AND s.id <> p_rep
  GROUP BY s.id
  ORDER BY s.created_at DESC
  LIMIT 500;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_rep_signups(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_rep_signups(UUID) TO authenticated;

-- "Mark as paid": settles every unpaid commission line in one payout.
CREATE OR REPLACE FUNCTION public.admin_pay_level_rep(p_rep UUID, p_note TEXT DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  owed INTEGER;
  payout UUID;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;
  PERFORM 1 FROM public.rep_earnings WHERE rep_id = p_rep AND payout_id IS NULL FOR UPDATE;
  SELECT coalesce(sum(commission), 0) INTO owed FROM public.rep_earnings WHERE rep_id = p_rep AND payout_id IS NULL;
  IF owed <= 0 THEN RAISE EXCEPTION 'nothing_owed'; END IF;
  INSERT INTO public.rep_payouts (rep_id, amount, note, paid_by)
  VALUES (p_rep, owed, nullif(left(btrim(coalesce(p_note, '')), 200), ''), auth.uid())
  RETURNING id INTO payout;
  UPDATE public.rep_earnings SET payout_id = payout WHERE rep_id = p_rep AND payout_id IS NULL;
  INSERT INTO public.notifications (user_id, type, message, link)
  VALUES (p_rep, 'rep_payout', 'PastCS paid you GHC ' || trim(to_char(owed / 100.0, 'FM999999990.00')) || ' in Level Rep commission. Thank you!', '/rep');
  RETURN owed;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_pay_level_rep(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pay_level_rep(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_rep_payouts(p_rep UUID)
RETURNS TABLE (id UUID, amount INTEGER, note TEXT, paid_at TIMESTAMP WITH TIME ZONE, paid_by_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;
  RETURN QUERY
  SELECT o.id, o.amount, o.note, o.paid_at, a.full_name
  FROM public.rep_payouts o LEFT JOIN public.users a ON a.id = o.paid_by
  WHERE o.rep_id = p_rep ORDER BY o.paid_at DESC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_rep_payouts(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_rep_payouts(UUID) TO authenticated;

-- ── The rep's own page ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.am_i_level_rep()
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.level_reps WHERE user_id = auth.uid());
$$;
REVOKE EXECUTE ON FUNCTION public.am_i_level_rep() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.am_i_level_rep() TO authenticated;

-- Their totals, their sign-ups (first name only, and whether they've
-- paid), and their payouts. NULL for anyone who isn't a rep.
CREATE OR REPLACE FUNCTION public.get_my_rep_dashboard()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  me UUID := auth.uid();
  r public.level_reps%ROWTYPE;
BEGIN
  IF me IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO r FROM public.level_reps WHERE user_id = me;
  IF r.user_id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'active', r.active,
    'level', r.level,
    'program_name', (SELECT name FROM public.programs WHERE id = r.program_id),
    'commission_pct', r.commission_pct,
    'discount_pct', r.discount_pct,
    'referral_code', (SELECT referral_code FROM public.users WHERE id = me),
    'signups', (SELECT count(*) FROM public.users s WHERE s.referred_by = me AND s.id <> me),
    'paying', (SELECT count(DISTINCT student_id) FROM public.rep_earnings WHERE rep_id = me),
    'earned', (SELECT coalesce(sum(commission), 0) FROM public.rep_earnings WHERE rep_id = me),
    'unpaid', (SELECT coalesce(sum(commission), 0) FROM public.rep_earnings WHERE rep_id = me AND payout_id IS NULL),
    'paid_out', (SELECT coalesce(sum(amount), 0) FROM public.rep_payouts WHERE rep_id = me),
    'recent', coalesce((
      SELECT jsonb_agg(x ORDER BY x.joined_at DESC) FROM (
        SELECT coalesce(nullif(split_part(btrim(s.full_name), ' ', 1), ''), 'A student') AS first_name,
               s.selected_level AS level, s.created_at AS joined_at,
               EXISTS (SELECT 1 FROM public.rep_earnings e WHERE e.rep_id = me AND e.student_id = s.id) AS paid,
               (SELECT coalesce(sum(e.commission), 0) FROM public.rep_earnings e WHERE e.rep_id = me AND e.student_id = s.id) AS commission
        FROM public.users s
        WHERE s.referred_by = me AND s.id <> me
        ORDER BY s.created_at DESC
        LIMIT 100
      ) x), '[]'::jsonb),
    'payouts', coalesce((
      SELECT jsonb_agg(jsonb_build_object('amount', o.amount, 'paid_at', o.paid_at, 'note', o.note) ORDER BY o.paid_at DESC)
      FROM public.rep_payouts o WHERE o.rep_id = me), '[]'::jsonb)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_rep_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_rep_dashboard() TO authenticated;

NOTIFY pgrst, 'reload schema';
