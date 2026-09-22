-- A modest "who changed X and when" record for the highest-value admin
-- actions (course/question delete, price change, free-pass grant/revoke,
-- program delete) — not a full audit framework, just enough that these
-- actions have an answer. Viewable by super admins only, matching the
-- sensitivity class of Tracker.
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id   UUID REFERENCES public.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  action     TEXT NOT NULL,
  target     TEXT NOT NULL,
  metadata   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at ON public.admin_audit_log(created_at DESC);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Any admin/super_admin can write a row for their own action (client-side
-- deletes use this); server routes using the service-role key bypass RLS
-- entirely and pass actor_id explicitly instead of relying on the default.
DROP POLICY IF EXISTS "admin_audit_log_admin_insert" ON public.admin_audit_log;
CREATE POLICY "admin_audit_log_admin_insert" ON public.admin_audit_log FOR INSERT WITH CHECK (is_admin());

-- Only super admins can read the log — same sensitivity class as Tracker.
DROP POLICY IF EXISTS "admin_audit_log_super_admin_select" ON public.admin_audit_log;
CREATE POLICY "admin_audit_log_super_admin_select" ON public.admin_audit_log FOR SELECT USING (is_super_admin());
