-- ================================================================
-- MIGRATION: Course access as the server sees it (2026-10-28)
-- ================================================================
-- The "Create a classroom" form decided which courses were locked from
-- the subscriptions the phone loaded at sign-in. A free pass (or payment)
-- that arrived while the app was open still showed as locked, and the
-- form offered "Unlock" instead of creating. This gives the form the
-- server's own answer, from the same course_access_for that
-- create_classroom checks, for every course in the student's programme.
--
-- access: 'paid' | 'free' (their free course) | 'available_free' (no free
-- course yet; this would become it) | 'payment_required' | 'wrong_program'
--
-- Safe to run more than once.
-- ================================================================

CREATE OR REPLACE FUNCTION public.get_my_course_access_list()
RETURNS TABLE (course_id UUID, access TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT c.course_id, public.course_access_for(auth.uid(), c.course_id)
  FROM (
    SELECT cp.course_id FROM public.course_programs cp
    JOIN public.users u ON u.id = auth.uid() AND u.program_id = cp.program_id
    UNION
    SELECT co.id FROM public.courses co
    JOIN public.users u ON u.id = auth.uid() AND upper(co.course_code) = upper(u.free_course_code)
  ) c
  WHERE auth.uid() IS NOT NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_course_access_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_course_access_list() TO authenticated;

NOTIFY pgrst, 'reload schema';
