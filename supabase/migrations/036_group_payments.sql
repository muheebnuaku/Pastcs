-- ================================================================
-- MIGRATION: Group payment through the class rep
-- ================================================================
-- A classroom's owner or leader picks classmates who haven't unlocked
-- the classroom's level yet (same programme as the rep) and pays for all
-- of them in one Paystack checkout.
--
-- 1. classroom_group_payments: one row per checkout. The server writes
--    it before Paystack opens: who is covered, the price per student
--    (class deal applied) and the total. The reference is made here, so
--    nothing the browser sends can change who or what is being paid for.
-- 2. fulfil_group_payment: called by /api/payments/group/verify and the
--    Paystack webhook once Paystack says the charge succeeded. It checks
--    the amount, then creates one subscription per student, exactly once
--    however many times it's called.
-- 3. Covered students get a notification; the rep gets a receipt.
--
-- Safe to run more than once.
-- ================================================================

CREATE TABLE IF NOT EXISTS public.classroom_group_payments (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference        TEXT NOT NULL UNIQUE,
  -- Payment records outlive the people and classrooms on them.
  payer_id         UUID REFERENCES public.users(id) ON DELETE SET NULL,
  classroom_id     UUID REFERENCES public.classrooms(id) ON DELETE SET NULL,
  classroom_name   TEXT NOT NULL,
  program_id       UUID NOT NULL,
  level            INTEGER NOT NULL,
  semester         INTEGER NOT NULL,
  student_ids      UUID[] NOT NULL,
  unit_amount      INTEGER NOT NULL CHECK (unit_amount > 0),
  full_unit_amount INTEGER NOT NULL CHECK (full_unit_amount >= unit_amount),
  deal             BOOLEAN NOT NULL DEFAULT false,
  total            INTEGER NOT NULL CHECK (total > 0),
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'problem')),
  amount_paid      INTEGER,
  covered          UUID[] NOT NULL DEFAULT '{}',
  -- Students who had unlocked by the time the money arrived: owed a refund.
  already_paid     UUID[] NOT NULL DEFAULT '{}',
  problem          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_group_payments_payer ON public.classroom_group_payments(payer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_payments_pending ON public.classroom_group_payments(classroom_id, created_at) WHERE status = 'pending';
ALTER TABLE public.classroom_group_payments ENABLE ROW LEVEL SECURITY;
-- Read through get_my_group_payments; written only by the functions below.
REVOKE ALL ON public.classroom_group_payments FROM anon, authenticated;

ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS group_payment_id UUID REFERENCES public.classroom_group_payments(id) ON DELETE SET NULL;

-- Has this student unlocked the classroom course's level (any programme
-- that has the course, the same rule as the class deal count)?
CREATE OR REPLACE FUNCTION public.group_pay_has_unlocked(p_user UUID, p_course UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    JOIN public.courses co ON co.id = p_course
    WHERE s.user_id = p_user AND s.status = 'active'
      AND s.level = co.level AND s.semester = co.semester
      AND s.program_id IN (SELECT cp.program_id FROM public.course_programs cp WHERE cp.course_id = co.id)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.group_pay_has_unlocked(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- Classmates the rep can pay for: members in the rep's programme (which
-- must have the classroom's course) who haven't unlocked yet. 'pending'
-- means another checkout started in the last 30 minutes covers them.
CREATE OR REPLACE FUNCTION public.group_pay_candidates(p_payer UUID, p_classroom UUID)
RETURNS TABLE (user_id UUID, full_name TEXT, avatar_url TEXT, is_me BOOLEAN, pending BOOLEAN)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT u.id, u.full_name, u.avatar_url, u.id = p_payer,
         EXISTS (SELECT 1 FROM public.classroom_group_payments g
                 WHERE g.classroom_id = p_classroom AND g.status = 'pending'
                   AND g.created_at > now() - interval '30 minutes' AND u.id = ANY (g.student_ids))
  FROM public.classroom_members m
  JOIN public.classrooms c ON c.id = m.classroom_id
  JOIN public.users u ON u.id = m.user_id
  JOIN public.users payer ON payer.id = p_payer
  WHERE m.classroom_id = p_classroom
    AND u.program_id = payer.program_id
    AND payer.program_id IN (SELECT cp.program_id FROM public.course_programs cp WHERE cp.course_id = c.course_id)
    AND NOT public.group_pay_has_unlocked(u.id, c.course_id)
  ORDER BY (u.id = p_payer) DESC, lower(coalesce(u.full_name, ''));
$$;
REVOKE EXECUTE ON FUNCTION public.group_pay_candidates(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.group_pay_check_rep(p_payer UUID, p_classroom UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE r TEXT;
BEGIN
  SELECT role INTO r FROM public.classroom_members WHERE classroom_id = p_classroom AND user_id = p_payer;
  IF r IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF r NOT IN ('owner', 'leader') THEN RAISE EXCEPTION 'leaders_only'; END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.group_pay_check_rep(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- For the rep's own screen: who can be paid for.
CREATE OR REPLACE FUNCTION public.get_group_payment_candidates(p_classroom UUID)
RETURNS TABLE (user_id UUID, full_name TEXT, avatar_url TEXT, is_me BOOLEAN, pending BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  PERFORM public.group_pay_check_rep(auth.uid(), p_classroom);
  RETURN QUERY SELECT * FROM public.group_pay_candidates(auth.uid(), p_classroom);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_group_payment_candidates(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_group_payment_candidates(UUID) TO authenticated;

-- Called by /api/payments/group/start (service role) after it has priced
-- one unlock for the rep's programme. Checks every student and records
-- the checkout; returns the reference and total to charge.
CREATE OR REPLACE FUNCTION public.create_group_payment(
  p_payer UUID, p_classroom UUID, p_students UUID[], p_unit_amount INTEGER, p_full_unit_amount INTEGER, p_deal BOOLEAN
)
RETURNS TABLE (reference TEXT, total INTEGER, student_count INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  room RECORD;
  payer_program UUID;
  wanted UUID[];
  ok_count INTEGER;
  ref TEXT;
BEGIN
  PERFORM public.group_pay_check_rep(p_payer, p_classroom);
  SELECT c.id, c.name, co.level, co.semester INTO room
  FROM public.classrooms c JOIN public.courses co ON co.id = c.course_id WHERE c.id = p_classroom;
  SELECT program_id INTO payer_program FROM public.users WHERE id = p_payer;
  IF payer_program IS NULL THEN RAISE EXCEPTION 'wrong_program'; END IF;

  SELECT array_agg(DISTINCT s) INTO wanted FROM unnest(p_students) s WHERE s IS NOT NULL;
  IF wanted IS NULL OR array_length(wanted, 1) = 0 THEN RAISE EXCEPTION 'no_students'; END IF;
  IF array_length(wanted, 1) > 50 THEN RAISE EXCEPTION 'too_many_students'; END IF;
  IF p_unit_amount IS NULL OR p_unit_amount <= 0 OR p_full_unit_amount < p_unit_amount THEN RAISE EXCEPTION 'bad_price'; END IF;

  -- Two reps (or two tabs) mustn't charge for the same classmate at once.
  PERFORM pg_advisory_xact_lock(hashtext('group_pay:' || p_classroom::text));

  SELECT count(*) INTO ok_count
  FROM public.group_pay_candidates(p_payer, p_classroom) c
  WHERE c.user_id = ANY (wanted) AND NOT c.pending;
  IF ok_count <> array_length(wanted, 1) THEN RAISE EXCEPTION 'student_not_eligible'; END IF;

  IF (SELECT count(*) FROM public.classroom_group_payments g
      WHERE g.payer_id = p_payer AND g.created_at > now() - interval '1 hour') >= 10 THEN
    RAISE EXCEPTION 'too_many_checkouts';
  END IF;

  ref := 'pastcs_grp_' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.classroom_group_payments
    (reference, payer_id, classroom_id, classroom_name, program_id, level, semester, student_ids,
     unit_amount, full_unit_amount, deal, total)
  VALUES (ref, p_payer, p_classroom, room.name, payer_program, room.level, room.semester, wanted,
          p_unit_amount, p_full_unit_amount, coalesce(p_deal, false), p_unit_amount * array_length(wanted, 1));
  RETURN QUERY SELECT ref, p_unit_amount * array_length(wanted, 1), array_length(wanted, 1);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_group_payment(UUID, UUID, UUID[], INTEGER, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_group_payment(UUID, UUID, UUID[], INTEGER, INTEGER, BOOLEAN) TO service_role;

-- Once Paystack confirms the charge (verify route or webhook, possibly
-- both, possibly more than once). Returns
--   {result: 'paid' | 'amount_mismatch' | 'not_found', covered, already_paid, payer_id}
-- 'amount_mismatch' is permanent: nothing is unlocked, and the row is
-- marked for support. Students who unlocked in the meantime are skipped
-- and listed in already_paid, so support can refund them.
CREATE OR REPLACE FUNCTION public.fulfil_group_payment(p_reference TEXT, p_amount INTEGER, p_currency TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g public.classroom_group_payments%ROWTYPE;
  sid UUID;
  got UUID[] := '{}';
  skipped UUID[] := '{}';
  payer_name TEXT;
  deal_room UUID;
BEGIN
  SELECT * INTO g FROM public.classroom_group_payments WHERE reference = p_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'not_found'); END IF;
  IF g.status = 'paid' THEN
    RETURN jsonb_build_object('result', 'paid', 'covered', to_jsonb(g.covered), 'already_paid', to_jsonb(g.already_paid), 'payer_id', g.payer_id, 'repeat', true);
  END IF;
  IF g.status = 'problem' THEN
    RETURN jsonb_build_object('result', 'amount_mismatch', 'payer_id', g.payer_id, 'repeat', true);
  END IF;

  -- The same rule as the single-student routes: GHS, and never less
  -- than what the server priced.
  IF coalesce(p_currency, '') <> 'GHS' OR p_amount IS NULL OR p_amount < g.total THEN
    UPDATE public.classroom_group_payments
    SET status = 'problem', amount_paid = p_amount,
        problem = format('amount_mismatch: charged %s %s, expected GHS %s', coalesce(p_amount::text, '?'), coalesce(p_currency, '?'), g.total)
    WHERE id = g.id;
    RETURN jsonb_build_object('result', 'amount_mismatch', 'payer_id', g.payer_id);
  END IF;

  deal_room := CASE WHEN g.deal THEN g.classroom_id END;
  FOREACH sid IN ARRAY g.student_ids LOOP
    IF EXISTS (SELECT 1 FROM public.subscriptions s
               WHERE s.user_id = sid AND s.status = 'active' AND s.level = g.level
                 AND s.semester = g.semester AND s.program_id = g.program_id) THEN
      skipped := skipped || sid;
      CONTINUE;
    END IF;
    INSERT INTO public.subscriptions
      (user_id, level, semester, program_id, payment_reference, amount, full_amount, deal_classroom_id, status, paid_at, group_payment_id)
    VALUES (sid, g.level, g.semester, g.program_id, g.reference || ':' || sid, g.unit_amount, g.full_unit_amount, deal_room, 'active', now(), g.id)
    ON CONFLICT (payment_reference) DO NOTHING;
    got := got || sid;
  END LOOP;

  SELECT coalesce(nullif(split_part(btrim(full_name), ' ', 1), ''), 'Your class rep') INTO payer_name
  FROM public.users WHERE id = g.payer_id;
  INSERT INTO public.notifications (user_id, type, message, link, meta)
  SELECT sid2, 'group_payment',
         coalesce(payer_name, 'Your class rep') || ' paid for your Level ' || g.level || ' unlock in ' || g.classroom_name
           || '. Every Level ' || g.level || ' course is open to you this semester.',
         CASE WHEN g.classroom_id IS NOT NULL THEN '/classrooms/' || g.classroom_id ELSE '/courses' END,
         jsonb_build_object('group_payment_id', g.id, 'classroom_id', g.classroom_id)
  FROM unnest(got) sid2
  WHERE sid2 IS DISTINCT FROM g.payer_id AND EXISTS (SELECT 1 FROM public.users WHERE id = sid2);

  UPDATE public.classroom_group_payments
  SET status = 'paid', paid_at = now(), amount_paid = p_amount, covered = got, already_paid = skipped,
      problem = CASE WHEN cardinality(skipped) > 0 THEN format('refund_due: %s student(s) had already unlocked, GHS %s each', cardinality(skipped), g.unit_amount) END
  WHERE id = g.id;
  RETURN jsonb_build_object('result', 'paid', 'covered', to_jsonb(got), 'already_paid', to_jsonb(skipped), 'payer_id', g.payer_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fulfil_group_payment(TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfil_group_payment(TEXT, INTEGER, TEXT) TO service_role;

-- The rep's receipts for one classroom (abandoned checkouts left out).
CREATE OR REPLACE FUNCTION public.get_my_group_payments(p_classroom UUID)
RETURNS TABLE (
  id UUID, reference TEXT, status TEXT, level INTEGER, semester INTEGER, unit_amount INTEGER,
  full_unit_amount INTEGER, deal BOOLEAN, total INTEGER, amount_paid INTEGER,
  created_at TIMESTAMPTZ, paid_at TIMESTAMPTZ, students JSONB
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT g.id, g.reference, g.status, g.level, g.semester, g.unit_amount, g.full_unit_amount, g.deal, g.total,
         g.amount_paid, g.created_at, g.paid_at,
         (SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'user_id', s,
                   'full_name', (SELECT u.full_name FROM public.users u WHERE u.id = s),
                   'state', CASE WHEN s = ANY (g.covered) THEN 'covered'
                                 WHEN s = ANY (g.already_paid) THEN 'already_paid'
                                 ELSE 'waiting' END) ORDER BY o), '[]'::jsonb)
          FROM unnest(g.student_ids) WITH ORDINALITY AS t(s, o))
  FROM public.classroom_group_payments g
  WHERE g.payer_id = auth.uid() AND g.classroom_id = p_classroom
    AND (g.status <> 'pending' OR g.created_at > now() - interval '1 day')
  ORDER BY g.created_at DESC
  LIMIT 20;
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_group_payments(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_group_payments(UUID) TO authenticated;
