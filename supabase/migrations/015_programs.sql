-- ================================================================
-- MIGRATION: Multi-program support (Phase 1 — data model + backfill)
-- Run this in the Supabase SQL Editor once. Safe to re-run (idempotent).
--
-- Every course today is filtered by level+semester only — there's no
-- notion of a program/department. This adds one, without touching any
-- application code yet: nothing reads program_id until Phase 2, so
-- every existing student keeps exactly the access they have today.
--
-- Course <-> program is many-to-many and admin-controlled — a course
-- is visible to a program ONLY if an admin explicitly assigns it there
-- (no automatic sharing by category). All of today's courses (DCIT
-- ones and the shared first-year ones alike) get assigned to
-- "BSc Information Technology" here, since that's the only program
-- that exists so far.
-- ================================================================

CREATE TABLE IF NOT EXISTS public.programs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL UNIQUE,   -- "BSc Information Technology"
  short_code  TEXT NOT NULL UNIQUE,   -- "IT" — compact label for admin UI
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.course_programs (
  course_id  UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  program_id UUID NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  PRIMARY KEY (course_id, program_id)
);

CREATE INDEX IF NOT EXISTS idx_course_programs_program ON public.course_programs(program_id);

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS program_id UUID REFERENCES public.programs(id);

-- Subscriptions become program-scoped: a payment unlocks one program's
-- courses at a level+semester, not every program's courses at that
-- level+semester (which is what happens today by accident, since the
-- concept of "program" didn't exist until this migration).
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS program_id UUID REFERENCES public.programs(id);

-- Seed the one program that exists today.
INSERT INTO public.programs (name, short_code)
VALUES ('BSc Information Technology', 'IT')
ON CONFLICT (name) DO NOTHING;

-- Assign every existing course to BSc IT — today's entire catalog
-- (DCIT courses and the shared first-year ones alike) is IT.
INSERT INTO public.course_programs (course_id, program_id)
SELECT c.id, p.id
FROM public.courses c
CROSS JOIN public.programs p
WHERE p.short_code = 'IT'
ON CONFLICT DO NOTHING;

-- Backfill every already-onboarded user into BSc IT so nobody loses
-- access or gets sent back through onboarding.
UPDATE public.users u
SET program_id = p.id
FROM public.programs p
WHERE p.short_code = 'IT'
  AND u.program_id IS NULL
  AND u.selected_level IS NOT NULL;

-- Backfill existing (already-paid) subscriptions the same way, so no
-- one loses access to something they already paid for.
UPDATE public.subscriptions s
SET program_id = p.id
FROM public.programs p
WHERE p.short_code = 'IT'
  AND s.program_id IS NULL;

-- RLS: every authenticated user can read programs and course-program
-- assignments (needed to filter the course list by their own program);
-- only admins can write.
ALTER TABLE public.programs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_programs  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "programs_select" ON public.programs;
CREATE POLICY "programs_select" ON public.programs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "programs_admin" ON public.programs;
CREATE POLICY "programs_admin" ON public.programs FOR ALL USING (is_admin());

DROP POLICY IF EXISTS "course_programs_select" ON public.course_programs;
CREATE POLICY "course_programs_select" ON public.course_programs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "course_programs_admin" ON public.course_programs;
CREATE POLICY "course_programs_admin" ON public.course_programs FOR ALL USING (is_admin());
