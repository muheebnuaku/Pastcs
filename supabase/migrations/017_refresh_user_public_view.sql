-- ================================================================
-- MIGRATION: Refresh the user_public view (fixes "Could not find the
-- 'program_id' column of 'user_public' in the schema cache")
-- Run this in the Supabase SQL Editor once. Safe to re-run (idempotent).
--
-- ROOT CAUSE: `CREATE VIEW ... AS SELECT * FROM public.users` freezes
-- the view's column list at the moment it's created — Postgres does
-- NOT retroactively add a column to an existing view just because the
-- underlying table gained one. user_public was last (re)created back
-- when the table was still called `profiles` (migration 001) — every
-- column added to `users` since then via a standalone ALTER TABLE
-- (referral_code, referred_by, program, exam_date, and now program_id)
-- never actually reached user_public, because none of those later
-- migrations recreated the view. Only schema.sql's own copy of the
-- view (used for a from-scratch install) was ever up to date.
--
-- This is why /api/user/selection, /api/payments/verify, and
-- /api/user/free-course all fail on program_id specifically — they're
-- the only endpoints that reference it through user_public. Every
-- other column above happened to already exist on the view from an
-- earlier full run of schema.sql, which is why only program_id showed
-- up as missing.
--
-- Fix: drop and recreate the view so it picks up every current column
-- on `users`, then tell PostgREST to reload its schema cache
-- immediately rather than waiting for its next automatic check.
-- ================================================================

DROP VIEW IF EXISTS public.user_public;
CREATE VIEW public.user_public AS SELECT * FROM public.users;

NOTIFY pgrst, 'reload schema';
