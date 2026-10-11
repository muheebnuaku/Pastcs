-- AI Tutor "My Lessons" library. A generated lesson used to exist only in
-- the browser (and before that, only until the page refreshed) — saving it
-- to the account lets a student reopen any past lesson on any device
-- without spending another lesson credit. `content` is the lesson's full
-- markdown (sections are re-split client-side); `images` is the keyword →
-- picture map fetched after generation.
CREATE TABLE IF NOT EXISTS public.tutor_lessons (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id  UUID REFERENCES public.courses(id) ON DELETE SET NULL,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  images     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tutor_lessons_user ON public.tutor_lessons(user_id, created_at DESC);

ALTER TABLE public.tutor_lessons ENABLE ROW LEVEL SECURITY;

-- Not in schema.sql's central idempotent-drop table list — self-guard
-- each policy the same way admin_messages does. A student only ever
-- sees and manages their own lessons.
DROP POLICY IF EXISTS "tutor_lessons_select_own" ON public.tutor_lessons;
CREATE POLICY "tutor_lessons_select_own" ON public.tutor_lessons FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "tutor_lessons_insert_own" ON public.tutor_lessons;
CREATE POLICY "tutor_lessons_insert_own" ON public.tutor_lessons FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "tutor_lessons_update_own" ON public.tutor_lessons;
CREATE POLICY "tutor_lessons_update_own" ON public.tutor_lessons FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "tutor_lessons_delete_own" ON public.tutor_lessons;
CREATE POLICY "tutor_lessons_delete_own" ON public.tutor_lessons FOR DELETE USING (auth.uid() = user_id);
