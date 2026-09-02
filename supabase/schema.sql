-- ================================================================
-- PASTCS - Complete Database Setup (idempotent — safe to re-run)
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ================================================================
-- USERS TABLE
-- ================================================================
CREATE TABLE IF NOT EXISTS public.users (
  id                 UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email              TEXT NOT NULL UNIQUE,
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
  program            TEXT,
  referral_code      TEXT UNIQUE,
  referred_by        UUID REFERENCES public.users(id) ON DELETE SET NULL,
  exam_date          DATE,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add paywall columns if this table already existed without them
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS selected_level    INTEGER CHECK (selected_level    IN (100,200,300,400));
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS selected_semester INTEGER CHECK (selected_semester IN (1,2));
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS free_course_code  TEXT;
-- Used by the profile page and the student layout's onboarding redirect —
-- was referenced throughout the app but never actually added here.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS program          TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS referral_code     TEXT UNIQUE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS referred_by       UUID REFERENCES public.users(id) ON DELETE SET NULL;
-- Powers the dashboard's exam countdown + study plan widget
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS exam_date         DATE;

-- View alias used throughout the app
DROP VIEW IF EXISTS public.user_public;
CREATE VIEW public.user_public AS SELECT * FROM public.users;

-- ================================================================
-- COURSES TABLE
-- ================================================================
CREATE TABLE IF NOT EXISTS public.courses (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_code     TEXT NOT NULL UNIQUE,
  course_name     TEXT NOT NULL,
  description     TEXT,
  icon            TEXT,
  color           TEXT DEFAULT '#3B82F6',
  level           INTEGER NOT NULL DEFAULT 100 CHECK (level    IN (100,200,300,400)),
  semester        INTEGER NOT NULL DEFAULT 1   CHECK (semester IN (1,2)),
  total_questions INTEGER DEFAULT 0,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS level    INTEGER NOT NULL DEFAULT 100 CHECK (level    IN (100,200,300,400));
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS semester INTEGER NOT NULL DEFAULT 1   CHECK (semester IN (1,2));

-- ================================================================
-- TOPICS TABLE
-- ================================================================
CREATE TABLE IF NOT EXISTS public.topics (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id   UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  topic_name  TEXT NOT NULL,
  description TEXT,
  order_index INTEGER DEFAULT 0,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ================================================================
-- QUESTIONS TABLE
-- ================================================================
CREATE TABLE IF NOT EXISTS public.questions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id       UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  topic_id        UUID REFERENCES public.topics(id) ON DELETE SET NULL,
  question_type   TEXT NOT NULL CHECK (question_type IN ('single_choice','multiple_choice','fill_in_blank')),
  question_text   TEXT NOT NULL,
  options         JSONB,
  correct_answers JSONB NOT NULL,
  explanation     TEXT,
  difficulty      TEXT DEFAULT 'medium' CHECK (difficulty IN ('easy','medium','hard')),
  times_answered  INTEGER DEFAULT 0,
  times_correct   INTEGER DEFAULT 0,
  is_approved     BOOLEAN DEFAULT false,
  is_scenario     BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add scenario-style tagging if this table already existed without it
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS is_scenario BOOLEAN NOT NULL DEFAULT false;

-- ================================================================
-- TESTS TABLE
-- ================================================================
CREATE TABLE IF NOT EXISTS public.tests (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id       UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  topic_id        UUID REFERENCES public.topics(id) ON DELETE SET NULL,
  test_type       TEXT NOT NULL CHECK (test_type IN ('practice','exam_simulation')),
  score           INTEGER NOT NULL,
  total_questions INTEGER NOT NULL,
  percentage      DECIMAL(5,2),
  time_taken      INTEGER,
  completed_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ================================================================
-- TEST ANSWERS TABLE
-- ================================================================
CREATE TABLE IF NOT EXISTS public.test_answers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  test_id         UUID NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
  question_id     UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  selected_answer JSONB,
  is_correct      BOOLEAN NOT NULL,
  confidence      TEXT CHECK (confidence IN ('sure','unsure')),
  time_spent      INTEGER,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add self-reported confidence if this table already existed without it
ALTER TABLE public.test_answers ADD COLUMN IF NOT EXISTS confidence TEXT CHECK (confidence IN ('sure','unsure'));

-- ================================================================
-- ACHIEVEMENTS TABLE
-- ================================================================
CREATE TABLE IF NOT EXISTS public.achievements (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  icon        TEXT NOT NULL,
  criteria    JSONB NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ================================================================
-- USER ACHIEVEMENTS TABLE
-- ================================================================
CREATE TABLE IF NOT EXISTS public.user_achievements (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  achievement_id UUID NOT NULL REFERENCES public.achievements(id) ON DELETE CASCADE,
  earned_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, achievement_id)
);

-- ================================================================
-- LECTURE SLIDES TABLE
-- ================================================================
CREATE TABLE IF NOT EXISTS public.lecture_slides (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id           UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  topic_id            UUID REFERENCES public.topics(id) ON DELETE SET NULL,
  title               TEXT NOT NULL,
  content             TEXT NOT NULL,
  file_url            TEXT,
  questions_generated INTEGER DEFAULT 0,
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ================================================================
-- SUBSCRIPTIONS TABLE
-- ================================================================
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  level             INTEGER NOT NULL CHECK (level    IN (100,200,300,400)),
  semester          INTEGER NOT NULL CHECK (semester IN (1,2)),
  payment_reference TEXT    NOT NULL UNIQUE,
  amount            INTEGER NOT NULL DEFAULT 5000,
  status            TEXT    NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','active','failed')),
  paid_at           TIMESTAMP WITH TIME ZONE,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ================================================================
-- SUBSCRIPTION PRICES TABLE
-- ================================================================
CREATE TABLE IF NOT EXISTS public.subscription_prices (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  level      INTEGER NOT NULL UNIQUE CHECK (level IN (100, 200, 300, 400)),
  amount     INTEGER NOT NULL DEFAULT 5000, -- in pesewas (÷ 100 = GHC)
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Default prices (GHC 50 per level)
INSERT INTO public.subscription_prices (level, amount) VALUES
  (100, 5000),
  (200, 5000),
  (300, 5000),
  (400, 5000)
ON CONFLICT (level) DO NOTHING;

ALTER TABLE public.subscription_prices ENABLE ROW LEVEL SECURITY;

-- ================================================================
-- TUTOR CREDIT PLANS TABLE
-- (AI Tutor top-up packs — admin-editable from /admin/pricing,
-- same idea as subscription_prices but keyed by plan id)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.tutor_credit_plans (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  credits    INTEGER NOT NULL,
  amount     INTEGER NOT NULL, -- in pesewas (÷ 100 = GHC)
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO public.tutor_credit_plans (id, name, credits, amount) VALUES
  ('starter',  'Starter',  30,  3000),
  ('pack_50',  'Standard', 50,  5000),
  ('pack_100', 'Pro',      100, 10000)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.tutor_credit_plans ENABLE ROW LEVEL SECURITY;

-- ================================================================
-- AI TUTOR CREDITS TABLE
-- (written by app/api/payments/tutor-credits/route.ts once Paystack
-- confirms a top-up; read by the AI Tutor page's upload counter)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.ai_tutor_credits (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  plan              TEXT NOT NULL,
  amount_paid       INTEGER NOT NULL, -- pesewas, what Paystack actually confirmed
  total_credits     INTEGER NOT NULL,
  payment_reference TEXT NOT NULL UNIQUE,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.ai_tutor_credits ENABLE ROW LEVEL SECURITY;

-- ================================================================
-- NOTIFICATIONS TABLE
-- (read/written by lib/hooks/useNotifications.ts — streak-risk,
-- inactivity, and milestone nudges)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  message    TEXT NOT NULL,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ================================================================
-- FEATURE EVENTS TABLE
-- (written by app/api/track/route.ts — lightweight product analytics)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.feature_events (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  event      TEXT NOT NULL,
  metadata   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.notifications   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_events  ENABLE ROW LEVEL SECURITY;

-- ================================================================
-- REFERRALS TABLE
-- One row per successful referral signup. Each side's reward is
-- tracked independently — the referred user always has a level/
-- semester by the time they can finish a test, but the referrer might
-- not have picked one yet, so their grant can lag and catch up later
-- (see api/referrals/complete and api/user/selection).
-- ================================================================
CREATE TABLE IF NOT EXISTS public.referrals (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referrer_id          UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  referred_id          UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE UNIQUE,
  referred_rewarded_at TIMESTAMP WITH TIME ZONE,
  referrer_rewarded_at TIMESTAMP WITH TIME ZONE,
  created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- ================================================================
-- CHAT MESSAGES TABLE
-- Persists AI Tutor conversations (previously lived only in page
-- state — closing the tab erased everything). One flat, ongoing log
-- per user; course_id just tags which context a message was sent in.
-- ================================================================
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id  UUID REFERENCES public.courses(id) ON DELETE SET NULL,
  role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content    TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- ================================================================
-- AI USAGE LOG TABLE
-- One row per OpenAI call across every AI feature, so spend is
-- actually visible instead of a surprise bill. Written via the
-- service-role client from each AI route — no student-facing policy.
-- ================================================================
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

ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;

-- ================================================================
-- REVIEW SCHEDULE TABLE
-- Light SM-2-style spaced repetition. One row per (user, question)
-- ever answered. On a wrong answer the interval resets to 1 day; on a
-- right answer it advances through 1 -> 3 -> 7 -> 14 -> 30 (capped).
-- "Due for review" practice pulls whatever has next_review_at <= today.
-- ================================================================
CREATE TABLE IF NOT EXISTS public.review_schedule (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  question_id    UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  interval_days  INTEGER NOT NULL DEFAULT 1,
  next_review_at DATE NOT NULL,
  last_result    BOOLEAN,
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, question_id)
);

ALTER TABLE public.review_schedule ENABLE ROW LEVEL SECURITY;

-- ================================================================
-- INDEXES
-- ================================================================
CREATE INDEX IF NOT EXISTS idx_questions_course       ON public.questions(course_id);
CREATE INDEX IF NOT EXISTS idx_questions_topic        ON public.questions(topic_id);
CREATE INDEX IF NOT EXISTS idx_questions_approved     ON public.questions(is_approved);
CREATE INDEX IF NOT EXISTS idx_questions_scenario     ON public.questions(course_id, is_scenario);
CREATE INDEX IF NOT EXISTS idx_tests_user             ON public.tests(user_id);
CREATE INDEX IF NOT EXISTS idx_tests_course           ON public.tests(course_id);
CREATE INDEX IF NOT EXISTS idx_test_answers_test      ON public.test_answers(test_id);
CREATE INDEX IF NOT EXISTS idx_test_answers_question  ON public.test_answers(question_id);
CREATE INDEX IF NOT EXISTS idx_topics_course          ON public.topics(course_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON public.user_achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_level_sem ON public.subscriptions(user_id, level, semester);
CREATE INDEX IF NOT EXISTS idx_notifications_user    ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feature_events_user    ON public.feature_events(user_id);
CREATE INDEX IF NOT EXISTS idx_feature_events_event    ON public.feature_events(event);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer      ON public.referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_users_referral_code     ON public.users(referral_code);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user      ON public.chat_messages(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_feature    ON public.ai_usage_log(feature, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_user       ON public.ai_usage_log(user_id);
CREATE INDEX IF NOT EXISTS idx_review_schedule_due     ON public.review_schedule(user_id, next_review_at);

-- ================================================================
-- ROW LEVEL SECURITY
-- ================================================================
ALTER TABLE public.users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topics            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tests             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_answers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lecture_slides    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions     ENABLE ROW LEVEL SECURITY;

-- Drop existing policies before recreating (idempotent)
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname, tablename FROM pg_policies
           WHERE schemaname = 'public'
             AND tablename IN ('users','courses','topics','questions','tests',
                               'test_answers','achievements','user_achievements',
                               'lecture_slides','subscriptions','subscription_prices',
                               'tutor_credit_plans','ai_tutor_credits',
                               'notifications','feature_events','referrals',
                               'chat_messages','ai_usage_log','review_schedule')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- Helper: avoids infinite recursion by using SECURITY DEFINER (bypasses RLS)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT role = 'admin' FROM public.users WHERE id = auth.uid() LIMIT 1;
$$;

-- Users
CREATE POLICY "users_select_own"        ON public.users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "users_insert_own"        ON public.users FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "users_update_own"        ON public.users FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "admins_select_all_users" ON public.users FOR SELECT USING (is_admin());

-- Courses
CREATE POLICY "courses_select" ON public.courses FOR SELECT TO authenticated USING (true);
CREATE POLICY "courses_admin"  ON public.courses FOR ALL USING (is_admin());

-- Topics
CREATE POLICY "topics_select" ON public.topics FOR SELECT TO authenticated USING (true);
CREATE POLICY "topics_admin"  ON public.topics FOR ALL USING (is_admin());

-- Questions
CREATE POLICY "questions_select_approved" ON public.questions FOR SELECT TO authenticated USING (is_approved = true);
CREATE POLICY "questions_admin"           ON public.questions FOR ALL USING (is_admin());

-- Tests
CREATE POLICY "tests_select_own"  ON public.tests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "tests_insert_own"  ON public.tests FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "tests_admin"       ON public.tests FOR SELECT USING (is_admin());

-- Test answers
CREATE POLICY "test_answers_select_own" ON public.test_answers FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.tests WHERE tests.id = test_id AND tests.user_id = auth.uid()));
CREATE POLICY "test_answers_insert_own" ON public.test_answers FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.tests WHERE tests.id = test_id AND tests.user_id = auth.uid()));

-- Achievements
CREATE POLICY "achievements_select" ON public.achievements FOR SELECT TO authenticated USING (true);

-- User achievements
CREATE POLICY "user_achievements_select_own" ON public.user_achievements FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "user_achievements_insert_own" ON public.user_achievements FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Lecture slides
CREATE POLICY "lecture_slides_admin" ON public.lecture_slides FOR ALL USING (is_admin());

-- Subscriptions
CREATE POLICY "subscriptions_select_own" ON public.subscriptions FOR SELECT USING (auth.uid() = user_id);

-- Subscription prices (readable by all authenticated users, editable by admin only)
CREATE POLICY "prices_select" ON public.subscription_prices FOR SELECT TO authenticated USING (true);
CREATE POLICY "prices_admin"  ON public.subscription_prices FOR ALL USING (is_admin());

-- Tutor credit plans (same shape as subscription prices, above)
CREATE POLICY "tutor_plans_select" ON public.tutor_credit_plans FOR SELECT TO authenticated USING (true);
CREATE POLICY "tutor_plans_admin"  ON public.tutor_credit_plans FOR ALL USING (is_admin());

-- AI Tutor credits (rows are only ever written by the service-role
-- client in api/payments/tutor-credits/route.ts; a student just needs
-- to read their own purchased-credit total back)
CREATE POLICY "ai_tutor_credits_select_own" ON public.ai_tutor_credits FOR SELECT USING (auth.uid() = user_id);

-- Notifications (a user reads/dismisses their own; the client that
-- creates them inserts as that same authenticated user)
CREATE POLICY "notifications_select_own" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "notifications_insert_own" ON public.notifications FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "notifications_update_own" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "notifications_delete_own" ON public.notifications FOR DELETE USING (auth.uid() = user_id);

-- Feature events (written only via the service-role client in
-- api/track/route.ts, which bypasses RLS — this lets admins review
-- the raw event log, AND lets a user read back their own events,
-- e.g. the AI Tutor page counting a student's own document_upload
-- events client-side to enforce the free-tier upload limit)
CREATE POLICY "feature_events_admin_select" ON public.feature_events FOR SELECT USING (is_admin());
CREATE POLICY "feature_events_select_own"   ON public.feature_events FOR SELECT USING (auth.uid() = user_id);

-- Referrals (a user sees referrals where they're either side; the
-- reward-granting update happens via the service-role client in
-- api/referrals/complete, which bypasses RLS)
CREATE POLICY "referrals_select_own" ON public.referrals FOR SELECT
  USING (auth.uid() = referrer_id OR auth.uid() = referred_id);
CREATE POLICY "referrals_admin" ON public.referrals FOR ALL USING (is_admin());

-- Chat messages (a user reads/writes/clears only their own)
CREATE POLICY "chat_messages_select_own" ON public.chat_messages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "chat_messages_insert_own" ON public.chat_messages FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "chat_messages_delete_own" ON public.chat_messages FOR DELETE USING (auth.uid() = user_id);

-- AI usage log (written only via the service-role client from each AI
-- route; admins can review spend)
CREATE POLICY "ai_usage_log_admin_select" ON public.ai_usage_log FOR SELECT USING (is_admin());

-- Review schedule (fully owned by the student — no reward/abuse risk
-- like the referral free-passes, so the regular authenticated client
-- can read/write its own rows directly, no service-role route needed)
CREATE POLICY "review_schedule_select_own" ON public.review_schedule FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "review_schedule_insert_own" ON public.review_schedule FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "review_schedule_update_own" ON public.review_schedule FOR UPDATE USING (auth.uid() = user_id);

-- ================================================================
-- TRIGGER: auto-create user row on auth signup
-- ================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_code   TEXT;
  referrer   UUID;
  ref_input  TEXT;
BEGIN
  -- Every user gets their own shareable referral code, regardless of
  -- whether they arrived via one. Retry-until-unique is cheap here —
  -- with an 8-hex-char space, a first-try collision is already rare.
  LOOP
    new_code := UPPER(SUBSTRING(REPLACE(uuid_generate_v4()::text, '-', ''), 1, 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.users WHERE referral_code = new_code);
  END LOOP;

  -- Resolve the code they signed up with (if any) to its owner. An
  -- invalid or mistyped code just means no referrer — never blocks signup.
  ref_input := NEW.raw_user_meta_data->>'referral_code';
  referrer := NULL;
  IF ref_input IS NOT NULL AND TRIM(ref_input) <> '' THEN
    SELECT id INTO referrer FROM public.users WHERE referral_code = UPPER(TRIM(ref_input));
  END IF;

  INSERT INTO public.users (id, email, full_name, role, referral_code, referred_by)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'student'),
    new_code,
    referrer
  )
  ON CONFLICT (id) DO NOTHING;

  IF referrer IS NOT NULL THEN
    INSERT INTO public.referrals (referrer_id, referred_id)
    VALUES (referrer, NEW.id)
    ON CONFLICT (referred_id) DO NOTHING;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Referral bookkeeping is a nice-to-have; account creation is not.
  -- Log the real reason (visible in Postgres Logs) and fall back to
  -- exactly the pre-referral insert so signup always succeeds.
  RAISE WARNING 'handle_new_user: referral logic failed (%), falling back to minimal insert', SQLERRM;
  INSERT INTO public.users (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
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

-- Backfill: create user rows for any auth users that already exist
INSERT INTO public.users (id, email, full_name, role)
SELECT
  id,
  email,
  COALESCE(raw_user_meta_data->>'full_name', split_part(email, '@', 1)),
  COALESCE(raw_user_meta_data->>'role', 'student')
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- Backfill: assign a referral code to any existing user who predates
-- this feature. Safe to re-run — only ever touches NULL rows.
DO $$
DECLARE
  r RECORD;
  new_code TEXT;
BEGIN
  FOR r IN SELECT id FROM public.users WHERE referral_code IS NULL LOOP
    LOOP
      new_code := UPPER(SUBSTRING(REPLACE(uuid_generate_v4()::text, '-', ''), 1, 8));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.users WHERE referral_code = new_code);
    END LOOP;
    UPDATE public.users SET referral_code = new_code WHERE id = r.id;
  END LOOP;
END $$;

-- ================================================================
-- FUNCTIONS
-- ================================================================
CREATE OR REPLACE FUNCTION public.update_practice_streak(p_user_id UUID)
RETURNS void AS $$
DECLARE
  last_date      DATE;
  current_streak INTEGER;
BEGIN
  SELECT last_practice_date, practice_streak INTO last_date, current_streak
  FROM public.users WHERE id = p_user_id;
  IF last_date IS NULL OR last_date < CURRENT_DATE - INTERVAL '1 day' THEN
    UPDATE public.users SET practice_streak = 1, last_practice_date = CURRENT_DATE WHERE id = p_user_id;
  ELSIF last_date = CURRENT_DATE - INTERVAL '1 day' THEN
    UPDATE public.users SET practice_streak = current_streak + 1, last_practice_date = CURRENT_DATE WHERE id = p_user_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_leaderboard(p_course_id UUID DEFAULT NULL, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (user_id UUID, full_name TEXT, avatar_url TEXT, total_score BIGINT, total_tests BIGINT, avg_percentage DECIMAL) AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.full_name, u.avatar_url,
    COALESCE(SUM(t.score),0)::BIGINT, COUNT(t.id)::BIGINT, COALESCE(AVG(t.percentage),0)::DECIMAL
  FROM public.users u LEFT JOIN public.tests t ON u.id = t.user_id
  WHERE u.role = 'student' AND (p_course_id IS NULL OR t.course_id = p_course_id)
  GROUP BY u.id, u.full_name, u.avatar_url
  ORDER BY 4 DESC, 6 DESC LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_weak_topics(p_user_id UUID, p_limit INTEGER DEFAULT 5)
RETURNS TABLE (topic_id UUID, topic_name TEXT, course_code TEXT, total_questions INTEGER, correct_answers INTEGER, accuracy DECIMAL) AS $$
BEGIN
  RETURN QUERY
  SELECT tp.id, tp.topic_name, c.course_code,
    COUNT(ta.id)::INTEGER,
    SUM(CASE WHEN ta.is_correct THEN 1 ELSE 0 END)::INTEGER,
    (SUM(CASE WHEN ta.is_correct THEN 1 ELSE 0 END)::DECIMAL / NULLIF(COUNT(ta.id),0) * 100)::DECIMAL
  FROM public.topics tp
  JOIN public.questions q   ON tp.id = q.topic_id
  JOIN public.test_answers ta ON q.id = ta.question_id
  JOIN public.tests ts      ON ta.test_id = ts.id
  JOIN public.courses c     ON tp.course_id = c.id
  WHERE ts.user_id = p_user_id
  GROUP BY tp.id, tp.topic_name, c.course_code
  HAVING COUNT(ta.id) >= 3
  ORDER BY 6 ASC LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================================
-- SEED DATA (skipped if already present)
-- ================================================================
INSERT INTO public.courses (course_code, course_name, description, color, level, semester) VALUES
  ('DCIT101','Introduction to Computer Science','Fundamental concepts of computer science including algorithms, data structures, and programming basics.','#3B82F6',100,1),
  ('DCIT103','Office Productivity Tools','Master essential office applications including word processing, spreadsheets, and presentations.','#10B981',100,1),
  ('DCIT105','Mathematics for IT Professionals','Mathematical foundations including discrete mathematics, logic, and number systems.','#8B5CF6',100,1),
  ('ECON101','Introduction to Economics I','Basic economic principles including microeconomics and market dynamics.','#F59E0B',100,1),
  ('STAT111','Introduction to Statistics and Probability I','Statistical concepts, probability theory, and data analysis fundamentals.','#EF4444',100,1),
  ('UGRC150','Critical Thinking and Practical Reasoning','Develop logical reasoning, critical analysis, and argumentation skills.','#EC4899',100,1)
ON CONFLICT (course_code) DO NOTHING;

INSERT INTO public.achievements (name, description, icon, criteria) VALUES
  ('First Practice Test','Complete your first practice test','trophy','{"type":"tests_completed","value":1}'),
  ('10 Tests Completed','Complete 10 practice tests','medal','{"type":"tests_completed","value":10}'),
  ('50 Tests Completed','Complete 50 practice tests','star','{"type":"tests_completed","value":50}'),
  ('Top Performer','Score 100% on any test','crown','{"type":"perfect_score","value":1}'),
  ('Week Warrior','Maintain a 7-day practice streak','flame','{"type":"streak","value":7}'),
  ('Month Master','Maintain a 30-day practice streak','fire','{"type":"streak","value":30}'),
  ('Quick Learner','Complete a test in under 5 minutes','zap','{"type":"speed","value":300}'),
  ('All-Rounder','Practice all 6 courses','globe','{"type":"courses_practiced","value":6}')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.topics (course_id, topic_name, description, order_index)
SELECT id,'Introduction to Computing','Basic computing concepts and history',1 FROM public.courses WHERE course_code='DCIT101'
ON CONFLICT DO NOTHING;
INSERT INTO public.topics (course_id, topic_name, description, order_index)
SELECT id,'Number Systems','Binary, octal, decimal, and hexadecimal systems',2 FROM public.courses WHERE course_code='DCIT101'
ON CONFLICT DO NOTHING;
INSERT INTO public.topics (course_id, topic_name, description, order_index)
SELECT id,'Boolean Algebra','Logic gates and boolean expressions',3 FROM public.courses WHERE course_code='DCIT101'
ON CONFLICT DO NOTHING;
INSERT INTO public.topics (course_id, topic_name, description, order_index)
SELECT id,'Computer Hardware','CPU, memory, storage, and peripherals',4 FROM public.courses WHERE course_code='DCIT101'
ON CONFLICT DO NOTHING;
INSERT INTO public.topics (course_id, topic_name, description, order_index)
SELECT id,'Software Concepts','Operating systems and application software',5 FROM public.courses WHERE course_code='DCIT101'
ON CONFLICT DO NOTHING;

INSERT INTO public.topics (course_id, topic_name, description, order_index)
SELECT id,'Word Processing','Microsoft Word fundamentals',1 FROM public.courses WHERE course_code='DCIT103' ON CONFLICT DO NOTHING;
INSERT INTO public.topics (course_id, topic_name, description, order_index)
SELECT id,'Spreadsheets','Microsoft Excel basics and formulas',2 FROM public.courses WHERE course_code='DCIT103' ON CONFLICT DO NOTHING;
INSERT INTO public.topics (course_id, topic_name, description, order_index)
SELECT id,'Presentations','Microsoft PowerPoint essentials',3 FROM public.courses WHERE course_code='DCIT103' ON CONFLICT DO NOTHING;
INSERT INTO public.topics (course_id, topic_name, description, order_index)
SELECT id,'Database Basics','Introduction to Microsoft Access',4 FROM public.courses WHERE course_code='DCIT103' ON CONFLICT DO NOTHING;

INSERT INTO public.topics (course_id, topic_name, description, order_index)
SELECT id,'Number Theory','Prime numbers and divisibility',1 FROM public.courses WHERE course_code='DCIT105' ON CONFLICT DO NOTHING;
INSERT INTO public.topics (course_id, topic_name, description, order_index)
SELECT id,'Set Theory','Sets, subsets, and operations',2 FROM public.courses WHERE course_code='DCIT105' ON CONFLICT DO NOTHING;
INSERT INTO public.topics (course_id, topic_name, description, order_index)
SELECT id,'Logic','Propositional and predicate logic',3 FROM public.courses WHERE course_code='DCIT105' ON CONFLICT DO NOTHING;
INSERT INTO public.topics (course_id, topic_name, description, order_index)
SELECT id,'Relations and Functions','Mathematical relations and functions',4 FROM public.courses WHERE course_code='DCIT105' ON CONFLICT DO NOTHING;

INSERT INTO public.topics (course_id, topic_name, description, order_index)
SELECT id,'Basic Economic Concepts','Scarcity, choice, and opportunity cost',1 FROM public.courses WHERE course_code='ECON101' ON CONFLICT DO NOTHING;
INSERT INTO public.topics (course_id, topic_name, description, order_index)
SELECT id,'Demand and Supply','Market equilibrium and price determination',2 FROM public.courses WHERE course_code='ECON101' ON CONFLICT DO NOTHING;
INSERT INTO public.topics (course_id, topic_name, description, order_index)
SELECT id,'Elasticity','Price and income elasticity',3 FROM public.courses WHERE course_code='ECON101' ON CONFLICT DO NOTHING;
INSERT INTO public.topics (course_id, topic_name, description, order_index)
SELECT id,'Market Structures','Perfect competition and monopoly',4 FROM public.courses WHERE course_code='ECON101' ON CONFLICT DO NOTHING;

INSERT INTO public.topics (course_id, topic_name, description, order_index)
SELECT id,'Descriptive Statistics','Mean, median, mode, and standard deviation',1 FROM public.courses WHERE course_code='STAT111' ON CONFLICT DO NOTHING;
INSERT INTO public.topics (course_id, topic_name, description, order_index)
SELECT id,'Probability Basics','Probability rules and calculations',2 FROM public.courses WHERE course_code='STAT111' ON CONFLICT DO NOTHING;
INSERT INTO public.topics (course_id, topic_name, description, order_index)
SELECT id,'Probability Distributions','Normal and binomial distributions',3 FROM public.courses WHERE course_code='STAT111' ON CONFLICT DO NOTHING;
INSERT INTO public.topics (course_id, topic_name, description, order_index)
SELECT id,'Sampling','Sampling methods and sampling distributions',4 FROM public.courses WHERE course_code='STAT111' ON CONFLICT DO NOTHING;

INSERT INTO public.topics (course_id, topic_name, description, order_index)
SELECT id,'Introduction to Logic','Basic logical reasoning',1 FROM public.courses WHERE course_code='UGRC150' ON CONFLICT DO NOTHING;
INSERT INTO public.topics (course_id, topic_name, description, order_index)
SELECT id,'Arguments and Fallacies','Identifying valid arguments and fallacies',2 FROM public.courses WHERE course_code='UGRC150' ON CONFLICT DO NOTHING;
INSERT INTO public.topics (course_id, topic_name, description, order_index)
SELECT id,'Critical Analysis','Evaluating sources and evidence',3 FROM public.courses WHERE course_code='UGRC150' ON CONFLICT DO NOTHING;
INSERT INTO public.topics (course_id, topic_name, description, order_index)
SELECT id,'Problem Solving','Systematic problem-solving approaches',4 FROM public.courses WHERE course_code='UGRC150' ON CONFLICT DO NOTHING;
