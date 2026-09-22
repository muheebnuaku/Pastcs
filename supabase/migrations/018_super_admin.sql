-- ================================================================
-- MIGRATION: Super admin role + tracker access
-- Run this in the Supabase SQL Editor once. Safe to re-run (idempotent).
--
-- super_admin is a strict superset of admin: sees everything a regular
-- admin sees, plus a super-admin-only "Tracker" page (payments/revenue
-- across the whole platform, with an AI-generated summary) that even
-- regular admins never see. is_admin() now treats super_admin as
-- admin too, so nothing that already gates on is_admin() needs to
-- change — a new is_super_admin() gates the Tracker specifically.
-- ================================================================

-- The inline CHECK on users.role only allowed ('student','admin').
-- Postgres auto-names an unnamed inline CHECK as `<table>_<column>_check`.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('student', 'admin', 'super_admin'));

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT role IN ('admin', 'super_admin') FROM public.users WHERE id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT role = 'super_admin' FROM public.users WHERE id = auth.uid() LIMIT 1;
$$;

UPDATE public.users SET role = 'super_admin' WHERE email = 'kwabenacrys@gmail.com';
