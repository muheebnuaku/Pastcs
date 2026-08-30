-- ================================================================
-- MIGRATION: AI Tutor chat history + AI usage logging
-- Run this in the Supabase SQL Editor once. Safe to re-run (idempotent).
--
-- Two gaps from the AI feature audit:
--  - AI Tutor conversations lived only in page state — closing the tab
--    erased everything. chat_messages persists them.
--  - No visibility into what the 6 AI-backed features actually cost.
--    ai_usage_log records tokens per call from each route.
-- ================================================================

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id  UUID REFERENCES public.courses(id) ON DELETE SET NULL,
  role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content    TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON public.chat_messages(user_id, created_at);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_messages_select_own" ON public.chat_messages;
DROP POLICY IF EXISTS "chat_messages_insert_own" ON public.chat_messages;
DROP POLICY IF EXISTS "chat_messages_delete_own" ON public.chat_messages;
CREATE POLICY "chat_messages_select_own" ON public.chat_messages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "chat_messages_insert_own" ON public.chat_messages FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "chat_messages_delete_own" ON public.chat_messages FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.ai_usage_log (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES public.users(id) ON DELETE SET NULL,
  feature           TEXT NOT NULL,
  model             TEXT NOT NULL,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens      INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_feature ON public.ai_usage_log(feature, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_user    ON public.ai_usage_log(user_id);

ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_usage_log_admin_select" ON public.ai_usage_log;
CREATE POLICY "ai_usage_log_admin_select" ON public.ai_usage_log FOR SELECT USING (is_admin());
