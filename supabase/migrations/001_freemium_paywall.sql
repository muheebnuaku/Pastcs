-- ================================================================
-- MIGRATION: PastCS Freemium Paywall
-- Run this in the Supabase SQL Editor once.
-- ================================================================

-- ----------------------------------------------------------------
-- 1. Extend users table
-- ----------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS selected_level    INTEGER CHECK (selected_level   IN (100,200,300,400)),
  ADD COLUMN IF NOT EXISTS selected_semester INTEGER CHECK (selected_semester IN (1,2)),
  ADD COLUMN IF NOT EXISTS free_course_code  TEXT;

-- ----------------------------------------------------------------
-- 2. Ensure courses table has level + semester (idempotent)
-- They already exist in the live DB, but this keeps schema.sql in sync.
-- ----------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'courses' AND column_name = 'level'
  ) THEN
    ALTER TABLE public.courses
      ADD COLUMN level INTEGER DEFAULT 100 CHECK (level IN (100,200,300,400));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'courses' AND column_name = 'semester'
  ) THEN
    ALTER TABLE public.courses
      ADD COLUMN semester INTEGER DEFAULT 1 CHECK (semester IN (1,2));
  END IF;
END
$$;

-- ----------------------------------------------------------------
-- 3. Subscriptions table
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  level             INTEGER NOT NULL CHECK (level    IN (100,200,300,400)),
  semester          INTEGER NOT NULL CHECK (semester IN (1,2)),
  payment_reference TEXT    NOT NULL UNIQUE,   -- prevents replay attacks
  amount            INTEGER NOT NULL DEFAULT 100,  -- pesewas (100 = GHC 1)
  status            TEXT    NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','active','failed')),
  paid_at           TIMESTAMP WITH TIME ZONE,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- index for fast "is user paid for level/sem?" lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_level_sem
  ON public.subscriptions(user_id, level, semester);

-- ----------------------------------------------------------------
-- 4. RLS for subscriptions
-- ----------------------------------------------------------------
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_view_own_subscriptions"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- All inserts/updates happen via service-role in the /api/payments/verify route.
