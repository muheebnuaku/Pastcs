-- The XP-awarding code has always called `supabase.rpc('increment_xp', ...)`,
-- but this function was never actually created — every call has been
-- silently failing (the error was never checked), so `users.xp` has never
-- moved for anyone. This creates the missing function.
--
-- Separately, the achievement-checking logic lived only in the unused
-- /api/tests/submit route (the real practice/exam pages insert into
-- `tests` directly from the client and never called it), and even that
-- dead code read `achievement.achievement_type` / `achievement.requirement`
-- columns that don't exist — the real schema stores `criteria` as JSONB
-- (`{"type": "...", "value": N}`). Both are fixed in application code
-- (lib/gamification.ts) now wired into the practice and exam pages; this
-- migration only adds the missing DB function XP needs.
CREATE OR REPLACE FUNCTION public.increment_xp(p_user_id UUID, p_amount INTEGER)
RETURNS void AS $$
BEGIN
  UPDATE public.users SET xp = xp + p_amount WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
