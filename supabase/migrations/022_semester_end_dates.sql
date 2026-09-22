-- Lets admins set, per program, when each semester ends — course access
-- purchased for that program+semester stops counting as active
-- grace_days after end_date. start_date is optional: only needed if an
-- admin reuses the same (program, semester) row for a new academic
-- cycle and wants to make sure a payment from the previous cycle isn't
-- silently treated as still current.
CREATE TABLE IF NOT EXISTS public.semester_end_dates (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_id UUID NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  semester   INTEGER NOT NULL CHECK (semester IN (1,2)),
  start_date DATE,
  end_date   DATE NOT NULL,
  grace_days INTEGER NOT NULL DEFAULT 3 CHECK (grace_days >= 0),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (program_id, semester)
);

ALTER TABLE public.semester_end_dates ENABLE ROW LEVEL SECURITY;

-- Same RLS shape as subscription_prices: any authenticated user can read
-- (so a student's own access-expiry check can run client-side), only
-- admins can write. The admin PUT route still goes through the
-- service-role client and logs to admin_audit_log — this policy is
-- defense-in-depth, not the primary write path.
DROP POLICY IF EXISTS "semester_end_dates_select" ON public.semester_end_dates;
CREATE POLICY "semester_end_dates_select" ON public.semester_end_dates FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "semester_end_dates_admin" ON public.semester_end_dates;
CREATE POLICY "semester_end_dates_admin" ON public.semester_end_dates FOR ALL USING (is_admin());
