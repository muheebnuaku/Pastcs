-- The registration page now lets a new student pick their program
-- during signup itself, before they have a session — so the programs
-- list needs to be readable by an unauthenticated (anon) request, not
-- just authenticated ones. Program name/short_code is non-sensitive
-- reference data already shown throughout the app; safe to open up.
DROP POLICY IF EXISTS "programs_select" ON public.programs;
CREATE POLICY "programs_select" ON public.programs FOR SELECT USING (true);
