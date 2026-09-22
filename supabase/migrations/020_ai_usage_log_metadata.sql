-- Adds a free-form metadata column to ai_usage_log so a call site can
-- attach feature-specific details (e.g. generate_questions logs course
-- code, topic, and question count) without a schema change per feature.
ALTER TABLE public.ai_usage_log ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
