-- ================================================================
-- MIGRATION: PastCS Profiles + Freemium Paywall
-- Run this in the Supabase SQL Editor once.
-- ================================================================

-- ----------------------------------------------------------------
-- 1. Create PastCS profiles table
--    (Keeps PastCS data separate from the shared "User" table)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id                 UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email              TEXT NOT NULL,
  full_name          TEXT,
  student_id         TEXT,
  role               TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','admin')),
  avatar_url         TEXT,
  practice_streak    INTEGER NOT NULL DEFAULT 0,
  last_practice_date DATE,
  total_tests_taken  INTEGER NOT NULL DEFAULT 0,
  xp                 INTEGER NOT NULL DEFAULT 0,
  selected_level     INTEGER CHECK (selected_level    IN (100,200,300,400)),
  selected_semester  INTEGER CHECK (selected_semester IN (1,2)),
  free_course_code   TEXT,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ----------------------------------------------------------------
-- 2. RLS for profiles
-- ----------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- ----------------------------------------------------------------
-- 3. Rebuild user_public view on top of profiles
-- ----------------------------------------------------------------
DROP VIEW IF EXISTS public.user_public;
CREATE VIEW public.user_public AS SELECT * FROM public.profiles;

-- ----------------------------------------------------------------
-- 4. Trigger: auto-create profile row when a new auth user signs up
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    COALESCE(NEW.raw_user_meta_data->>'role', 'student')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ----------------------------------------------------------------
-- 5. Backfill: create profiles for auth users who already exist
-- ----------------------------------------------------------------
INSERT INTO public.profiles (id, email, full_name, role)
SELECT
  id,
  email,
  raw_user_meta_data->>'full_name',
  COALESCE(raw_user_meta_data->>'role', 'student')
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------
-- 6. Ensure courses table has level + semester (idempotent)
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
-- 7. Subscriptions table
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  level             INTEGER NOT NULL CHECK (level    IN (100,200,300,400)),
  semester          INTEGER NOT NULL CHECK (semester IN (1,2)),
  payment_reference TEXT    NOT NULL UNIQUE,
  amount            INTEGER NOT NULL DEFAULT 100,
  status            TEXT    NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','active','failed')),
  paid_at           TIMESTAMP WITH TIME ZONE,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_level_sem
  ON public.subscriptions(user_id, level, semester);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_view_own_subscriptions"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- All inserts/updates happen via service-role in the /api/payments/verify route.
