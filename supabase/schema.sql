-- ================================================================
-- PASTCS - Complete Database Setup (idempotent — safe to re-run)
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ================================================================
-- PROGRAMS TABLE
-- ================================================================
-- Created before USERS/COURSES since both reference it. A course is
-- visible to a program only if explicitly assigned via course_programs
-- below (admin-controlled, many-to-many — a course can be shared by
-- more than one program) — there's no automatic sharing by category.
CREATE TABLE IF NOT EXISTS public.programs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL UNIQUE,   -- "BSc Information Technology"
  short_code  TEXT NOT NULL UNIQUE,   -- "IT" — compact label for admin UI
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ================================================================
-- USERS TABLE
-- ================================================================
CREATE TABLE IF NOT EXISTS public.users (
  id                 UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email              TEXT NOT NULL UNIQUE,
  full_name          TEXT,
  student_id         TEXT,
  role               TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','admin','super_admin')),
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
-- Which program's courses this student sees — see PROGRAMS section below.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS program_id        UUID REFERENCES public.programs(id);
-- Admin-set — a suspended account is treated as "not found" at login,
-- deliberately vague so it never confirms to whoever's logging in that
-- this specific account was flagged.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_suspended      BOOLEAN NOT NULL DEFAULT false;
-- Captured once at signup so an admin can spot several accounts
-- registered from the same IP (the "one free course per fake account"
-- abuse pattern).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS registration_ip   TEXT;

-- View alias used throughout the app. IMPORTANT: `SELECT *` freezes the
-- view's column list at CREATE time — adding a column to `users` later
-- via a standalone ALTER TABLE does NOT retroactively add it here. Any
-- migration that adds a users column must also recreate this view (see
-- migration 017, which had to fix this after program_id silently
-- missed it for exactly that reason).
DROP VIEW IF EXISTS public.user_public;
CREATE VIEW public.user_public AS SELECT * FROM public.users;
NOTIFY pgrst, 'reload schema';

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
-- COURSE <-> PROGRAM (many-to-many, admin-controlled)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.course_programs (
  course_id  UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  program_id UUID NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  PRIMARY KEY (course_id, program_id)
);

CREATE INDEX IF NOT EXISTS idx_course_programs_program ON public.course_programs(program_id);

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

-- A payment unlocks one program's courses at a level+semester, not
-- every program's (which is what happened by accident before programs
-- existed, since nothing distinguished them).
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS program_id UUID REFERENCES public.programs(id);

-- ================================================================
-- SUBSCRIPTION PRICES TABLE
-- ================================================================
-- Price is per (level, program) — a program with no rows yet falls back
-- to the hardcoded GHC 50 default already built into usePricing() and
-- admin's pricing page, so a newly created program needs no seeding.
-- Default prices for BSc IT are seeded further down, after the
-- programs table itself has its seed row (see PROGRAMS SEED below).
CREATE TABLE IF NOT EXISTS public.subscription_prices (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  level      INTEGER NOT NULL CHECK (level IN (100, 200, 300, 400)),
  program_id UUID NOT NULL REFERENCES public.programs(id),
  amount     INTEGER NOT NULL DEFAULT 5000, -- in pesewas (÷ 100 = GHC)
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (level, program_id)
);

ALTER TABLE public.subscription_prices ENABLE ROW LEVEL SECURITY;

-- ================================================================
-- SEMESTER END DATES TABLE
-- Lets admins set, per program, when each semester ends — course
-- access purchased for that program+semester stops counting as active
-- grace_days after end_date (admin-editable from /admin/pricing).
-- start_date is optional: only needed if an admin reuses the same
-- (program, semester) row for a new academic cycle and wants to make
-- sure a payment from the previous cycle isn't silently treated as
-- still current. No row for a program+semester means no expiry is
-- enforced for it yet.
-- ================================================================
CREATE TABLE IF NOT EXISTS public.semester_end_dates (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_id UUID NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  semester   INTEGER NOT NULL CHECK (semester IN (1,2)),
  start_date DATE,
  end_date   DATE NOT NULL,
  grace_days INTEGER NOT NULL DEFAULT 3 CHECK (grace_days >= 0),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (program_id, semester)
);

ALTER TABLE public.semester_end_dates ENABLE ROW LEVEL SECURITY;

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
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;

-- ================================================================
-- ADMIN AUDIT LOG TABLE
-- A modest "who changed X and when" record for the highest-value admin
-- actions (course/question delete, price change, free-pass grant/
-- revoke, program delete) — not a full audit framework. Viewable by
-- super admins only, matching the sensitivity class of Tracker.
-- ================================================================
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id   UUID REFERENCES public.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  action     TEXT NOT NULL,
  target     TEXT NOT NULL,
  metadata   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at ON public.admin_audit_log(created_at DESC);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- ================================================================
-- ADMIN MESSAGES TABLE
-- Two-way thread between an admin and an individual student. user_id
-- names whose thread a row belongs to; sender_id is whoever wrote it
-- (the student or an admin) — comparing the two gives direction
-- without a separate flag that could drift.
-- ================================================================
CREATE TABLE IF NOT EXISTS public.admin_messages (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sender_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_messages_user ON public.admin_messages(user_id, created_at);

ALTER TABLE public.admin_messages ENABLE ROW LEVEL SECURITY;

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
ALTER TABLE public.programs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_programs   ENABLE ROW LEVEL SECURITY;
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
             AND tablename IN ('users','programs','course_programs','courses','topics','questions','tests',
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
-- super_admin counts as admin here too — it's a strict superset (see
-- is_super_admin() below, which gates the super-admin-only Tracker).
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT role IN ('admin', 'super_admin') FROM public.users WHERE id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT role = 'super_admin' FROM public.users WHERE id = auth.uid() LIMIT 1;
$$;

-- Users
CREATE POLICY "users_select_own"        ON public.users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "users_insert_own"        ON public.users FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "users_update_own"        ON public.users FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "admins_select_all_users" ON public.users FOR SELECT USING (is_admin());

-- Programs — readable by anyone, including a not-yet-authenticated
-- browser session, since the registration page lets a new student pick
-- their program during signup itself (name/short_code is non-sensitive).
CREATE POLICY "programs_select" ON public.programs FOR SELECT USING (true);
CREATE POLICY "programs_admin"  ON public.programs FOR ALL USING (is_admin());

-- Course <-> Program assignments
CREATE POLICY "course_programs_select" ON public.course_programs FOR SELECT TO authenticated USING (true);
CREATE POLICY "course_programs_admin"  ON public.course_programs FOR ALL USING (is_admin());

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

-- Semester end dates (same shape as subscription prices, above). Not in
-- the idempotent-drop table list above (added after it), so each policy
-- drops itself first the same way admin_audit_log's do.
DROP POLICY IF EXISTS "semester_end_dates_select" ON public.semester_end_dates;
CREATE POLICY "semester_end_dates_select" ON public.semester_end_dates FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "semester_end_dates_admin" ON public.semester_end_dates;
CREATE POLICY "semester_end_dates_admin"  ON public.semester_end_dates FOR ALL USING (is_admin());

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

-- Admin audit log (any admin/super_admin can write a row for their own
-- action — client-side deletes rely on this; service-role server routes
-- bypass RLS and pass actor_id explicitly. Only super admins can read it.)
CREATE POLICY "admin_audit_log_admin_insert" ON public.admin_audit_log FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "admin_audit_log_super_admin_select" ON public.admin_audit_log FOR SELECT USING (is_super_admin());

-- Admin messages (same shape as semester_end_dates, above — added after
-- the central idempotent-drop table list, so each policy drops itself
-- first). A student reads/replies in their own thread only; admin
-- reads/writes go through the service-role API route (bypasses RLS).
DROP POLICY IF EXISTS "admin_messages_select_own" ON public.admin_messages;
CREATE POLICY "admin_messages_select_own" ON public.admin_messages FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "admin_messages_insert_own" ON public.admin_messages;
CREATE POLICY "admin_messages_insert_own" ON public.admin_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id AND auth.uid() = sender_id);
DROP POLICY IF EXISTS "admin_messages_update_own" ON public.admin_messages;
CREATE POLICY "admin_messages_update_own" ON public.admin_messages FOR UPDATE USING (auth.uid() = user_id);
-- An admin viewing a student's thread live (realtime subscription, not
-- just the service-role API route) needs to read it via the plain
-- client too — authorized the same way admins_select_all_users is.
DROP POLICY IF EXISTS "admin_messages_admin_select" ON public.admin_messages;
CREATE POLICY "admin_messages_admin_select" ON public.admin_messages FOR SELECT USING (is_admin());

-- ================================================================
-- AI TUTOR LESSON LIBRARY ("My Lessons") — see migration 027.
-- A student reopens past lessons on any device without spending another
-- credit. Self-guarded policies, like admin_messages above.
-- ================================================================
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
DROP POLICY IF EXISTS "tutor_lessons_select_own" ON public.tutor_lessons;
CREATE POLICY "tutor_lessons_select_own" ON public.tutor_lessons FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "tutor_lessons_insert_own" ON public.tutor_lessons;
CREATE POLICY "tutor_lessons_insert_own" ON public.tutor_lessons FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "tutor_lessons_update_own" ON public.tutor_lessons;
CREATE POLICY "tutor_lessons_update_own" ON public.tutor_lessons FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "tutor_lessons_delete_own" ON public.tutor_lessons;
CREATE POLICY "tutor_lessons_delete_own" ON public.tutor_lessons FOR DELETE USING (auth.uid() = user_id);

-- Live updates for admin_messages — without this, a message sent while
-- the other side has the page/modal open doesn't appear until they
-- navigate away and back.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'admin_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_messages;
  END IF;
END $$;

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

  INSERT INTO public.users (
    id, email, full_name, role, referral_code, referred_by,
    student_id, program_id, program, registration_ip
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'student'),
    new_code,
    referrer,
    NEW.raw_user_meta_data->>'student_id',
    NULLIF(NEW.raw_user_meta_data->>'program_id', '')::UUID,
    NEW.raw_user_meta_data->>'program',
    NEW.raw_user_meta_data->>'registration_ip'
  )
  ON CONFLICT (id) DO NOTHING;

  IF referrer IS NOT NULL THEN
    INSERT INTO public.referrals (referrer_id, referred_id)
    VALUES (referrer, NEW.id)
    ON CONFLICT (referred_id) DO NOTHING;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Referral bookkeeping (and the registration-form fields above) are a
  -- nice-to-have; account creation is not. Log the real reason (visible
  -- in Postgres Logs) and fall back to exactly the minimal insert so
  -- signup always succeeds even if e.g. program_id doesn't parse as a UUID.
  RAISE WARNING 'handle_new_user: extended insert failed (%), falling back to minimal insert', SQLERRM;
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
-- The only place XP is ever awarded from (lib/gamification.ts, called by
-- the practice and exam pages right after a test is saved).
CREATE OR REPLACE FUNCTION public.increment_xp(p_user_id UUID, p_amount INTEGER)
RETURNS void AS $$
BEGIN
  UPDATE public.users SET xp = xp + p_amount WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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

-- Scoped to the student's CURRENT selected_level/selected_semester AND
-- program — powers both the dashboard's "Topics to Review" card and the
-- Exam Countdown widget's "Focus on" list, neither of which should
-- surface weak topics from a semester (or program) the student has
-- since moved on from.
CREATE OR REPLACE FUNCTION public.get_weak_topics(p_user_id UUID, p_limit INTEGER DEFAULT 5)
RETURNS TABLE (topic_id UUID, topic_name TEXT, course_code TEXT, total_questions INTEGER, correct_answers INTEGER, accuracy DECIMAL) AS $$
BEGIN
  RETURN QUERY
  SELECT tp.id, tp.topic_name, c.course_code,
    COUNT(ta.id)::INTEGER,
    SUM(CASE WHEN ta.is_correct THEN 1 ELSE 0 END)::INTEGER,
    (SUM(CASE WHEN ta.is_correct THEN 1 ELSE 0 END)::DECIMAL / NULLIF(COUNT(ta.id),0) * 100)::DECIMAL
  FROM public.topics tp
  JOIN public.questions q         ON tp.id = q.topic_id
  JOIN public.test_answers ta     ON q.id = ta.question_id
  JOIN public.tests ts            ON ta.test_id = ts.id
  JOIN public.courses c           ON tp.course_id = c.id
  JOIN public.users u             ON u.id = p_user_id
  JOIN public.course_programs cp  ON cp.course_id = c.id AND cp.program_id = u.program_id
  WHERE ts.user_id = p_user_id
    AND c.level    = u.selected_level
    AND c.semester = u.selected_semester
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

-- Seed the one program that exists today, assign every existing course
-- to it (today's whole catalog is IT), and backfill already-onboarded
-- users and already-paid subscriptions into it — nobody should lose
-- access or get sent back through onboarding just because "program"
-- now exists as a concept.
INSERT INTO public.programs (name, short_code)
VALUES ('BSc Information Technology', 'IT')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.course_programs (course_id, program_id)
SELECT c.id, p.id
FROM public.courses c
CROSS JOIN public.programs p
WHERE p.short_code = 'IT'
ON CONFLICT DO NOTHING;

UPDATE public.users u
SET program_id = p.id
FROM public.programs p
WHERE p.short_code = 'IT'
  AND u.program_id IS NULL
  AND u.selected_level IS NOT NULL;

UPDATE public.subscriptions s
SET program_id = p.id
FROM public.programs p
WHERE p.short_code = 'IT'
  AND s.program_id IS NULL;

-- Default prices (GHC 50 per level) for BSc IT — must come after the
-- programs seed above, since program_id is NOT NULL.
INSERT INTO public.subscription_prices (level, program_id, amount)
SELECT lvl, p.id, 5000
FROM public.programs p
CROSS JOIN (VALUES (100), (200), (300), (400)) AS levels(lvl)
WHERE p.short_code = 'IT'
ON CONFLICT (level, program_id) DO NOTHING;

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

-- ================================================================
-- STORAGE — profile picture upload/edit/remove
-- ================================================================
-- Each student's avatar lives at a single fixed path `<user_id>/avatar`
-- in this bucket (no extension — the image type is carried in the
-- object's Content-Type, set at upload time), so re-uploading overwrites
-- the old one instead of accumulating orphaned files.
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Avatars are shown to other students too (leaderboard, etc.), so reads
-- are public; writes are restricted to a user's own folder.
DROP POLICY IF EXISTS "avatar_public_read" ON storage.objects;
CREATE POLICY "avatar_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatar_insert_own" ON storage.objects;
CREATE POLICY "avatar_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "avatar_update_own" ON storage.objects;
CREATE POLICY "avatar_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "avatar_delete_own" ON storage.objects;
CREATE POLICY "avatar_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ================================================================
-- CLASSROOMS (phase 1) — see migration 028_classrooms.sql
-- ================================================================
-- Classrooms (phase 1): a shared space per course where classmates join by
-- link or code, see a weekly leaderboard and a class progress board.
-- Progress is never stored twice — it's computed from the tests/answers
-- students already create, filtered to the classroom's course.
--
-- All writes go through the SECURITY DEFINER functions below (create, join,
-- role and sharing changes), so a member can never promote themselves or
-- edit someone else's row; the only direct write a client makes is a
-- DELETE (leave, or a leader removing a member), which RLS limits.

CREATE TABLE IF NOT EXISTS public.classrooms (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 3 AND 80),
  course_id   UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  owner_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  join_code   TEXT NOT NULL UNIQUE,
  max_members INTEGER NOT NULL DEFAULT 200,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.classroom_members (
  classroom_id UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'leader', 'member')),
  -- 'totals' = classmates see your weekly numbers; 'hidden' = only your name.
  -- 'full' is reserved for a later per-topic breakdown.
  share_level  TEXT NOT NULL DEFAULT 'totals' CHECK (share_level IN ('full', 'totals', 'hidden')),
  joined_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (classroom_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_classroom_members_user ON public.classroom_members(user_id);
CREATE INDEX IF NOT EXISTS idx_tests_user_course_created ON public.tests(user_id, course_id, created_at DESC);

ALTER TABLE public.classrooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_members ENABLE ROW LEVEL SECURITY;

-- The caller's role in a classroom, or NULL if they aren't a member.
-- SECURITY DEFINER so policies on classroom_members can use it without
-- recursing into themselves (same reason as is_admin()).
CREATE OR REPLACE FUNCTION public.classroom_role(p_classroom UUID)
RETURNS TEXT
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT role FROM public.classroom_members
  WHERE classroom_id = p_classroom AND user_id = auth.uid();
$$;

DROP POLICY IF EXISTS "classrooms_select_member" ON public.classrooms;
CREATE POLICY "classrooms_select_member" ON public.classrooms FOR SELECT
  USING (public.classroom_role(id) IS NOT NULL);
DROP POLICY IF EXISTS "classrooms_delete_owner" ON public.classrooms;
CREATE POLICY "classrooms_delete_owner" ON public.classrooms FOR DELETE
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "classroom_members_select_member" ON public.classroom_members;
CREATE POLICY "classroom_members_select_member" ON public.classroom_members FOR SELECT
  USING (public.classroom_role(classroom_id) IS NOT NULL);
-- Leave (anyone but the owner, who deletes the classroom instead), or a
-- leader/owner removing an ordinary member.
DROP POLICY IF EXISTS "classroom_members_delete" ON public.classroom_members;
CREATE POLICY "classroom_members_delete" ON public.classroom_members FOR DELETE
  USING (
    (user_id = auth.uid() AND role <> 'owner')
    OR (role = 'member' AND public.classroom_role(classroom_id) IN ('owner', 'leader'))
  );

-- 6-character code without look-alike characters (no 0/O, 1/I/L).
CREATE OR REPLACE FUNCTION public.new_classroom_code()
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  alphabet CONSTANT TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code TEXT;
BEGIN
  LOOP
    code := '';
    FOR i IN 1..6 LOOP
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::INT, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.classrooms WHERE join_code = code);
  END LOOP;
  RETURN code;
END;
$$;
REVOKE ALL ON FUNCTION public.new_classroom_code() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_classroom(p_name TEXT, p_course_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  new_id UUID;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF char_length(btrim(coalesce(p_name, ''))) NOT BETWEEN 3 AND 80 THEN RAISE EXCEPTION 'bad_name'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.courses WHERE id = p_course_id) THEN RAISE EXCEPTION 'bad_course'; END IF;
  -- Abuse guard: a student can own at most 10 classrooms.
  IF (SELECT count(*) FROM public.classrooms WHERE owner_id = uid) >= 10 THEN RAISE EXCEPTION 'too_many_classrooms'; END IF;

  INSERT INTO public.classrooms (name, course_id, owner_id, join_code)
  VALUES (btrim(p_name), p_course_id, uid, public.new_classroom_code())
  RETURNING id INTO new_id;

  INSERT INTO public.classroom_members (classroom_id, user_id, role) VALUES (new_id, uid, 'owner');
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_classroom(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  room public.classrooms%ROWTYPE;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT * INTO room FROM public.classrooms WHERE join_code = upper(btrim(coalesce(p_code, '')));
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_code'; END IF;
  IF EXISTS (SELECT 1 FROM public.classroom_members WHERE classroom_id = room.id AND user_id = uid) THEN
    RETURN room.id;
  END IF;
  IF (SELECT count(*) FROM public.classroom_members WHERE classroom_id = room.id) >= room.max_members THEN
    RAISE EXCEPTION 'classroom_full';
  END IF;
  INSERT INTO public.classroom_members (classroom_id, user_id) VALUES (room.id, uid);
  RETURN room.id;
END;
$$;

-- What an invite link shows before joining (also to signed-out visitors):
-- just enough to decide, nothing about members' progress.
CREATE OR REPLACE FUNCTION public.get_classroom_preview(p_code TEXT)
RETURNS TABLE (name TEXT, course_code TEXT, course_name TEXT, member_count INTEGER, owner_name TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT c.name, co.course_code, co.course_name,
         (SELECT count(*)::INTEGER FROM public.classroom_members m WHERE m.classroom_id = c.id),
         split_part(coalesce(u.full_name, 'A classmate'), ' ', 1)
  FROM public.classrooms c
  JOIN public.courses co ON co.id = c.course_id
  LEFT JOIN public.users u ON u.id = c.owner_id
  WHERE c.join_code = upper(btrim(coalesce(p_code, '')));
$$;

CREATE OR REPLACE FUNCTION public.set_my_share_level(p_classroom UUID, p_level TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_level NOT IN ('full', 'totals', 'hidden') THEN RAISE EXCEPTION 'bad_level'; END IF;
  UPDATE public.classroom_members SET share_level = p_level
  WHERE classroom_id = p_classroom AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'not_a_member'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_member_role(p_classroom UUID, p_user UUID, p_role TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.classroom_role(p_classroom) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_only'; END IF;
  IF p_role NOT IN ('leader', 'member') THEN RAISE EXCEPTION 'bad_role'; END IF;
  UPDATE public.classroom_members SET role = p_role
  WHERE classroom_id = p_classroom AND user_id = p_user AND role <> 'owner';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_a_member'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.regenerate_classroom_code(p_classroom UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE code TEXT;
BEGIN
  IF public.classroom_role(p_classroom) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_only'; END IF;
  code := public.new_classroom_code();
  UPDATE public.classrooms SET join_code = code WHERE id = p_classroom;
  RETURN code;
END;
$$;

-- One row per member: weekly practice in the classroom's course plus
-- their streak. A member who chose 'hidden' shows only name and role to
-- others (their own row always shows everything).
CREATE OR REPLACE FUNCTION public.get_classroom_progress(p_classroom UUID, p_days INTEGER DEFAULT 7)
RETURNS TABLE (
  user_id UUID, full_name TEXT, avatar_url TEXT, role TEXT, share_level TEXT, is_me BOOLEAN,
  practice_streak INTEGER, tests_taken INTEGER, questions_answered INTEGER,
  correct_answers INTEGER, accuracy NUMERIC, last_active TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  course UUID;
  since TIMESTAMP WITH TIME ZONE := NOW() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 120)));
BEGIN
  IF public.classroom_role(p_classroom) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  SELECT c.course_id INTO course FROM public.classrooms c WHERE c.id = p_classroom;

  RETURN QUERY
  SELECT m.user_id, u.full_name, u.avatar_url, m.role, m.share_level, (m.user_id = auth.uid()),
    CASE WHEN visible THEN u.practice_streak END,
    CASE WHEN visible THEN coalesce(s.tests, 0) END,
    CASE WHEN visible THEN coalesce(s.answered, 0) END,
    CASE WHEN visible THEN coalesce(s.correct, 0) END,
    CASE WHEN visible AND coalesce(s.answered, 0) > 0 THEN round(s.correct::NUMERIC * 100 / s.answered, 1) END,
    CASE WHEN visible THEN la.last_at END
  FROM public.classroom_members m
  JOIN public.users u ON u.id = m.user_id
  CROSS JOIN LATERAL (SELECT (m.share_level <> 'hidden' OR m.user_id = auth.uid()) AS visible) v
  LEFT JOIN LATERAL (
    SELECT count(*)::INTEGER AS tests, sum(t.total_questions)::INTEGER AS answered, sum(t.score)::INTEGER AS correct
    FROM public.tests t
    WHERE t.user_id = m.user_id AND t.course_id = course AND t.created_at >= since
  ) s ON TRUE
  LEFT JOIN LATERAL (
    SELECT max(t.created_at) AS last_at FROM public.tests t WHERE t.user_id = m.user_id AND t.course_id = course
  ) la ON TRUE
  WHERE m.classroom_id = p_classroom;
END;
$$;

-- The class's accuracy per topic over the period, from members who share
-- their progress — the board's "weak topics" heat map. Aggregate only.
CREATE OR REPLACE FUNCTION public.get_classroom_topic_stats(p_classroom UUID, p_days INTEGER DEFAULT 30)
RETURNS TABLE (topic_id UUID, topic_name TEXT, attempts INTEGER, correct INTEGER, accuracy NUMERIC, students INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  course UUID;
  since TIMESTAMP WITH TIME ZONE := NOW() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 120)));
BEGIN
  IF public.classroom_role(p_classroom) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  SELECT c.course_id INTO course FROM public.classrooms c WHERE c.id = p_classroom;

  RETURN QUERY
  SELECT tp.id, tp.topic_name,
    count(*)::INTEGER,
    sum(CASE WHEN ta.is_correct THEN 1 ELSE 0 END)::INTEGER,
    round(sum(CASE WHEN ta.is_correct THEN 1 ELSE 0 END)::NUMERIC * 100 / count(*), 1),
    count(DISTINCT t.user_id)::INTEGER
  FROM public.test_answers ta
  JOIN public.tests t ON t.id = ta.test_id
  JOIN public.questions q ON q.id = ta.question_id
  JOIN public.topics tp ON tp.id = q.topic_id
  JOIN public.classroom_members m ON m.classroom_id = p_classroom AND m.user_id = t.user_id
  WHERE t.course_id = course AND t.created_at >= since
    AND (m.share_level <> 'hidden' OR m.user_id = auth.uid())
  GROUP BY tp.id, tp.topic_name
  ORDER BY 5 ASC, 3 DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_classroom_preview(TEXT) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_classroom(TEXT, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.join_classroom(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_my_share_level(UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_member_role(UUID, UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.regenerate_classroom_code(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_classroom_progress(UUID, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_classroom_topic_stats(UUID, INTEGER) FROM anon;

-- ================================================================
-- CLASSROOMS part 2 (chat, resources, class deal, invite onboarding) — see migration 029
-- ================================================================
-- Classrooms, part 2: class chat (with calls posted into it), shared
-- resources (links + files), the "class deal" discount, and onboarding
-- for students who arrive through an invite link.

-- ── Chat ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.classroom_messages (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  classroom_id UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'call', 'resource')),
  body         TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  meta         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_classroom_messages_room ON public.classroom_messages(classroom_id, created_at DESC);
ALTER TABLE public.classroom_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "classroom_messages_select_member" ON public.classroom_messages;
CREATE POLICY "classroom_messages_select_member" ON public.classroom_messages FOR SELECT
  USING (public.classroom_role(classroom_id) IS NOT NULL);
DROP POLICY IF EXISTS "classroom_messages_insert_member" ON public.classroom_messages;
CREATE POLICY "classroom_messages_insert_member" ON public.classroom_messages FOR INSERT
  WITH CHECK (user_id = auth.uid() AND public.classroom_role(classroom_id) IS NOT NULL);
-- Your own messages, or anyone's if you lead the classroom.
DROP POLICY IF EXISTS "classroom_messages_delete" ON public.classroom_messages;
CREATE POLICY "classroom_messages_delete" ON public.classroom_messages FOR DELETE
  USING (user_id = auth.uid() OR public.classroom_role(classroom_id) IN ('owner', 'leader'));

-- Anti-spam: at most 20 messages a minute per student per classroom.
CREATE OR REPLACE FUNCTION public.classroom_messages_rate_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT count(*) FROM public.classroom_messages
      WHERE classroom_id = NEW.classroom_id AND user_id = NEW.user_id
        AND created_at > NOW() - INTERVAL '1 minute') >= 20 THEN
    RAISE EXCEPTION 'slow_down';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS classroom_messages_rate_limit ON public.classroom_messages;
CREATE TRIGGER classroom_messages_rate_limit BEFORE INSERT ON public.classroom_messages
  FOR EACH ROW EXECUTE FUNCTION public.classroom_messages_rate_limit();

-- Live updates for the chat.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'classroom_messages'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.classroom_messages;
  END IF;
END $$;

-- ── Resources ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.classroom_resources (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  classroom_id UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  kind         TEXT NOT NULL CHECK (kind IN ('link', 'file')),
  url          TEXT CHECK (url IS NULL OR url ~* '^https?://'),
  file_path    TEXT,
  file_size    INTEGER,
  mime_type    TEXT,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CHECK ((kind = 'link' AND url IS NOT NULL) OR (kind = 'file' AND file_path IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_classroom_resources_room ON public.classroom_resources(classroom_id, created_at DESC);
ALTER TABLE public.classroom_resources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "classroom_resources_select_member" ON public.classroom_resources;
CREATE POLICY "classroom_resources_select_member" ON public.classroom_resources FOR SELECT
  USING (public.classroom_role(classroom_id) IS NOT NULL);
DROP POLICY IF EXISTS "classroom_resources_insert_member" ON public.classroom_resources;
CREATE POLICY "classroom_resources_insert_member" ON public.classroom_resources FOR INSERT
  WITH CHECK (user_id = auth.uid() AND public.classroom_role(classroom_id) IS NOT NULL
              AND (file_path IS NULL OR file_path LIKE classroom_id::TEXT || '/%'));
DROP POLICY IF EXISTS "classroom_resources_delete" ON public.classroom_resources;
CREATE POLICY "classroom_resources_delete" ON public.classroom_resources FOR DELETE
  USING (user_id = auth.uid() OR public.classroom_role(classroom_id) IN ('owner', 'leader'));

-- Private storage for shared files: <classroom id>/<file>. Only members of
-- that classroom can read; members upload; uploader or a leader deletes.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('classroom-files', 'classroom-files', false, 15728640, ARRAY[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint', 'application/msword',
  'image/png', 'image/jpeg', 'image/webp', 'text/plain'
])
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.classroom_folder_role(p_name TEXT)
RETURNS TEXT
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT CASE
    WHEN split_part(p_name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
    THEN public.classroom_role(split_part(p_name, '/', 1)::UUID)
  END;
$$;

DROP POLICY IF EXISTS "classroom_files_read" ON storage.objects;
CREATE POLICY "classroom_files_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'classroom-files' AND public.classroom_folder_role(name) IS NOT NULL);
DROP POLICY IF EXISTS "classroom_files_upload" ON storage.objects;
CREATE POLICY "classroom_files_upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'classroom-files' AND public.classroom_folder_role(name) IS NOT NULL);
DROP POLICY IF EXISTS "classroom_files_delete" ON storage.objects;
CREATE POLICY "classroom_files_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'classroom-files'
         AND (owner = auth.uid() OR public.classroom_folder_role(name) IN ('owner', 'leader')));

-- ── Invite onboarding ──────────────────────────────────────────────────
-- A student joining by invite who hasn't set up yet starts practising
-- straight away: the classroom's course becomes their one free course
-- (only if they have none — it never replaces an existing pick), and an
-- empty level/semester/program is filled from that course.
CREATE OR REPLACE FUNCTION public.join_classroom(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  room public.classrooms%ROWTYPE;
  co public.courses%ROWTYPE;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT * INTO room FROM public.classrooms WHERE join_code = upper(btrim(coalesce(p_code, '')));
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_code'; END IF;
  IF EXISTS (SELECT 1 FROM public.classroom_members WHERE classroom_id = room.id AND user_id = uid) THEN
    RETURN room.id;
  END IF;
  IF (SELECT count(*) FROM public.classroom_members WHERE classroom_id = room.id) >= room.max_members THEN
    RAISE EXCEPTION 'classroom_full';
  END IF;
  INSERT INTO public.classroom_members (classroom_id, user_id) VALUES (room.id, uid);

  SELECT * INTO co FROM public.courses WHERE id = room.course_id;
  UPDATE public.users u SET
    selected_level    = coalesce(u.selected_level, co.level),
    selected_semester = coalesce(u.selected_semester, co.semester),
    program_id        = coalesce(u.program_id, (SELECT cp.program_id FROM public.course_programs cp WHERE cp.course_id = co.id LIMIT 1)),
    free_course_code  = co.course_code
  WHERE u.id = uid AND u.free_course_code IS NULL;

  RETURN room.id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.join_classroom(TEXT) FROM anon;

-- ── Class deal ─────────────────────────────────────────────────────────
-- How many members of a classroom have already unlocked its course's
-- level+semester (any program the course belongs to). Counts only — the
-- page shows "7 of 10 unlocked", never who.
CREATE OR REPLACE FUNCTION public.classroom_paid_count(p_classroom UUID, p_exclude UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT count(DISTINCT m.user_id)::INTEGER
  FROM public.classroom_members m
  JOIN public.classrooms c ON c.id = m.classroom_id
  JOIN public.courses co ON co.id = c.course_id
  JOIN public.subscriptions s ON s.user_id = m.user_id
    AND s.status = 'active' AND s.level = co.level AND s.semester = co.semester
    AND s.program_id IN (SELECT cp.program_id FROM public.course_programs cp WHERE cp.course_id = co.id)
  WHERE m.classroom_id = p_classroom
    AND (p_exclude IS NULL OR m.user_id <> p_exclude);
$$;
REVOKE EXECUTE ON FUNCTION public.classroom_paid_count(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- For a member viewing their classroom.
CREATE OR REPLACE FUNCTION public.get_class_deal(p_classroom UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
BEGIN
  IF public.classroom_role(p_classroom) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  RETURN public.classroom_paid_count(p_classroom, auth.uid());
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_class_deal(UUID) FROM anon;

-- For the payment server (service role only): the student's classroom with
-- the most paid classmates at the level+semester being bought.
CREATE OR REPLACE FUNCTION public.class_deal_for(p_user UUID, p_level INTEGER, p_semester INTEGER)
RETURNS TABLE (classroom_id UUID, classroom_name TEXT, paid_count INTEGER)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT c.id, c.name, public.classroom_paid_count(c.id, p_user)
  FROM public.classroom_members m
  JOIN public.classrooms c ON c.id = m.classroom_id
  JOIN public.courses co ON co.id = c.course_id
  WHERE m.user_id = p_user AND co.level = p_level AND co.semester = p_semester
  ORDER BY 3 DESC
  LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.class_deal_for(UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.classroom_paid_count(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.class_deal_for(UUID, INTEGER, INTEGER) TO service_role;

-- ================================================================
-- CLASSROOMS part 3 (join gating, ending calls) — see migration 030
-- ================================================================
-- Classrooms, part 3: a classroom is only for students who can use its
-- course. Before this, anyone with an invite code could join (or create)
-- a classroom for any course, so one free account could sit in every
-- class's chat, resources and calls without ever paying.
--
-- The rule, enforced here in the database so no client can skip it:
--   * the classroom's course is your free course, or you've paid for its
--     level+semester in your program → join;
--   * you haven't picked a free course yet (new students) → join, and the
--     classroom's course becomes your free course;
--   * otherwise → pay first (payment_required).
-- A course outside your program can't be unlocked by your payment at all,
-- so that's its own answer (wrong_program) rather than a useless paywall.

-- Mirrors lib/subscriptionAccess.ts (isSubscriptionCurrentlyActive): a
-- payment lasts until grace_days after its program+semester's end_date,
-- and one made before that term's start_date belongs to an older cycle.
CREATE OR REPLACE FUNCTION public.course_access_for(p_user UUID, p_course UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  u  public.users%ROWTYPE;
  co public.courses%ROWTYPE;
BEGIN
  SELECT * INTO u FROM public.users WHERE id = p_user;
  SELECT * INTO co FROM public.courses WHERE id = p_course;
  IF u.id IS NULL OR co.id IS NULL THEN RETURN 'payment_required'; END IF;

  IF u.free_course_code IS NOT NULL AND upper(u.free_course_code) = upper(co.course_code) THEN
    RETURN 'free';
  END IF;

  IF u.program_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.course_programs cp WHERE cp.course_id = co.id AND cp.program_id = u.program_id
  ) THEN
    RETURN 'wrong_program';
  END IF;

  IF u.program_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.subscriptions s
    LEFT JOIN public.semester_end_dates t ON t.program_id = s.program_id AND t.semester = s.semester
    WHERE s.user_id = p_user
      AND s.status = 'active'
      AND s.level = co.level
      AND s.semester = co.semester
      AND s.program_id = u.program_id
      AND (t.id IS NULL OR (
        now() < ((t.end_date + t.grace_days + 1)::timestamp AT TIME ZONE 'UTC')
        AND (t.start_date IS NULL OR s.paid_at IS NULL OR s.paid_at >= (t.start_date::timestamp AT TIME ZONE 'UTC'))
      ))
  ) THEN
    RETURN 'paid';
  END IF;

  IF u.free_course_code IS NULL THEN RETURN 'available_free'; END IF;
  RETURN 'payment_required';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.course_access_for(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- First classroom of a new student: its course becomes their free course,
-- and an empty level/semester/program is filled from it.
CREATE OR REPLACE FUNCTION public.claim_free_course(p_user UUID, p_course UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.users u SET
    selected_level    = coalesce(u.selected_level, co.level),
    selected_semester = coalesce(u.selected_semester, co.semester),
    program_id        = coalesce(u.program_id, (SELECT cp.program_id FROM public.course_programs cp WHERE cp.course_id = co.id LIMIT 1)),
    free_course_code  = co.course_code
  FROM public.courses co
  WHERE u.id = p_user AND co.id = p_course AND u.free_course_code IS NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_free_course(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.join_classroom(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  room public.classrooms%ROWTYPE;
  access TEXT;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT * INTO room FROM public.classrooms WHERE join_code = upper(btrim(coalesce(p_code, '')));
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_code'; END IF;
  IF EXISTS (SELECT 1 FROM public.classroom_members WHERE classroom_id = room.id AND user_id = uid) THEN
    RETURN room.id;
  END IF;
  IF (SELECT count(*) FROM public.classroom_members WHERE classroom_id = room.id) >= room.max_members THEN
    RAISE EXCEPTION 'classroom_full';
  END IF;

  -- Serialises this student's joins, so two invites opened at once can't
  -- both be taken as "my free course".
  PERFORM 1 FROM public.users WHERE id = uid FOR UPDATE;
  access := public.course_access_for(uid, room.course_id);
  IF access IN ('payment_required', 'wrong_program') THEN RAISE EXCEPTION '%', access; END IF;

  INSERT INTO public.classroom_members (classroom_id, user_id) VALUES (room.id, uid);
  IF access = 'available_free' THEN PERFORM public.claim_free_course(uid, room.course_id); END IF;
  RETURN room.id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.join_classroom(TEXT) FROM anon;

-- Same rule for starting a classroom: otherwise "create one for the course
-- I want, then invite friends" would skip the paywall too.
CREATE OR REPLACE FUNCTION public.create_classroom(p_name TEXT, p_course_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  new_id UUID;
  access TEXT;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF char_length(btrim(coalesce(p_name, ''))) NOT BETWEEN 3 AND 80 THEN RAISE EXCEPTION 'bad_name'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.courses WHERE id = p_course_id) THEN RAISE EXCEPTION 'bad_course'; END IF;
  -- Abuse guard: a student can own at most 10 classrooms.
  IF (SELECT count(*) FROM public.classrooms WHERE owner_id = uid) >= 10 THEN RAISE EXCEPTION 'too_many_classrooms'; END IF;

  PERFORM 1 FROM public.users WHERE id = uid FOR UPDATE;
  access := public.course_access_for(uid, p_course_id);
  IF access IN ('payment_required', 'wrong_program') THEN RAISE EXCEPTION '%', access; END IF;

  INSERT INTO public.classrooms (name, course_id, owner_id, join_code)
  VALUES (btrim(p_name), p_course_id, uid, public.new_classroom_code())
  RETURNING id INTO new_id;

  INSERT INTO public.classroom_members (classroom_id, user_id, role) VALUES (new_id, uid, 'owner');
  IF access = 'available_free' THEN PERFORM public.claim_free_course(uid, p_course_id); END IF;
  RETURN new_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_classroom(TEXT, UUID) FROM anon;

-- What the invite page needs to show the right step for a signed-in
-- student before they press anything: already in, join (free or paid
-- access), pay first, or not their program. Level/semester say what a
-- payment would have to unlock.
CREATE OR REPLACE FUNCTION public.get_classroom_join_status(p_code TEXT)
RETURNS TABLE (status TEXT, classroom_id UUID, level INTEGER, semester INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  uid UUID := auth.uid();
  room public.classrooms%ROWTYPE;
  co public.courses%ROWTYPE;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT * INTO room FROM public.classrooms WHERE join_code = upper(btrim(coalesce(p_code, '')));
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_code'; END IF;
  SELECT * INTO co FROM public.courses WHERE id = room.course_id;
  IF EXISTS (SELECT 1 FROM public.classroom_members m WHERE m.classroom_id = room.id AND m.user_id = uid) THEN
    RETURN QUERY SELECT 'member'::TEXT, room.id, co.level, co.semester;
  ELSE
    -- The id only goes to members; everyone else gets the decision.
    RETURN QUERY SELECT public.course_access_for(uid, room.course_id), NULL::UUID, co.level, co.semester;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_classroom_join_status(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_classroom_join_status(TEXT) TO authenticated;

-- ── Ending a call ──────────────────────────────────────────────────────
-- A call used to look "live" for two hours after it was started, even
-- once everyone had hung up. An 'end' message closes it on the site.
ALTER TABLE public.classroom_messages DROP CONSTRAINT IF EXISTS classroom_messages_kind_check;
ALTER TABLE public.classroom_messages ADD CONSTRAINT classroom_messages_kind_check
  CHECK (kind IN ('text', 'call', 'call_end', 'resource'));

-- Only whoever started the current call, or the classroom's owner/leaders,
-- can end it — otherwise any member could hang up the call for everyone.
CREATE OR REPLACE FUNCTION public.classroom_call_end_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  starter UUID;
BEGIN
  IF NEW.kind <> 'call_end' THEN RETURN NEW; END IF;
  SELECT m.user_id INTO starter FROM public.classroom_messages m
  WHERE m.classroom_id = NEW.classroom_id AND m.kind = 'call'
  ORDER BY m.created_at DESC LIMIT 1;
  IF starter IS DISTINCT FROM NEW.user_id
     AND coalesce(public.classroom_role(NEW.classroom_id), '') NOT IN ('owner', 'leader') THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS classroom_call_end_guard ON public.classroom_messages;
CREATE TRIGGER classroom_call_end_guard BEFORE INSERT ON public.classroom_messages
  FOR EACH ROW EXECUTE FUNCTION public.classroom_call_end_guard();

-- ================================================================
-- LOCKED-DOWN USER ROWS + PERMANENT FREE COURSE — see migration 031
-- ================================================================
-- ================================================================
-- MIGRATION: Lock down user rows + make the free course permanent
-- Run this in the Supabase SQL Editor once. Safe to re-run (idempotent).
--
-- Four holes, all reachable from the browser with the public anon key:
--
-- 1. user_public was a plain view, and a plain view runs with its
--    owner's rights — so RLS on users never applied to it. Supabase
--    grants new views to anon/authenticated, which meant anyone could
--    read every user's email/IP/student ID through it, and update any
--    account (including role) by writing through it.
-- 2. users_update_own let students update every column of their own
--    row: role → super_admin, is_suspended → false, xp, free course…
-- 3. Signup copied `role` from the signup metadata, which the browser
--    controls — `signUp({ options: { data: { role: 'admin' } } })` made
--    an admin. The client-side "create missing profile" path did too.
-- 4. increment_xp / update_practice_streak took any user id (and any
--    XP amount), callable even signed out.
--
-- Plus the free course: changing level/programme used to clear it so
-- another could be picked — one account, unlimited free courses (and
-- free classrooms). It's now a one-time grant: free_course_claimed_at
-- is set the first time, and a student who changes programme keeps
-- their free course but never gets a second one.
-- ================================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS free_course_claimed_at TIMESTAMP WITH TIME ZONE;
UPDATE public.users SET free_course_claimed_at = coalesce(updated_at, created_at, now())
WHERE free_course_code IS NOT NULL AND free_course_claimed_at IS NULL;

-- (1) The view now runs as the caller, so users' own RLS applies:
-- students see their own row, admins see everyone (admins_select_all_users).
-- Recreated anyway to pick up the new column (SELECT * is frozen at
-- create time — see migration 017).
DROP VIEW IF EXISTS public.user_public;
CREATE VIEW public.user_public WITH (security_invoker = true) AS SELECT * FROM public.users;

-- (2) + (3) Students may change only these columns of their own row.
-- Everything else (role, suspension, XP and streak, the free course,
-- referral fields…) changes only through server code: the service role,
-- or SECURITY DEFINER functions, which run as their owner. New columns
-- are protected by default until they're added to this list.
CREATE OR REPLACE FUNCTION public.guard_user_row()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  editable TEXT[] := ARRAY['full_name', 'avatar_url', 'exam_date', 'selected_level', 'selected_semester',
                           'program_id', 'program', 'student_id', 'updated_at'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Nobody is born an admin: promote with an UPDATE from the SQL editor.
    NEW.role := 'student';
    IF current_user IN ('authenticated', 'anon') THEN
      NEW.is_suspended := false;
      NEW.xp := 0;
      NEW.practice_streak := 0;
      NEW.total_tests_taken := 0;
      NEW.last_practice_date := NULL;
      NEW.free_course_code := NULL;
      NEW.free_course_claimed_at := NULL;
      NEW.referred_by := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF current_user IN ('authenticated', 'anon')
     AND (to_jsonb(NEW) - editable) IS DISTINCT FROM (to_jsonb(OLD) - editable) THEN
    RAISE EXCEPTION 'protected_columns' USING HINT = 'Only your name, photo, exam date and course selection can be changed here.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_user_row ON public.users;
CREATE TRIGGER guard_user_row BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_row();

-- (4) Your own XP and streak only. The cap is above the most a single
-- test can earn (10 per correct answer + 50 exam bonus), so normal play
-- is unaffected but one call can't add millions.
CREATE OR REPLACE FUNCTION public.increment_xp(p_user_id UUID, p_amount INTEGER)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF p_amount IS NULL OR p_amount < 0 OR p_amount > 2000 THEN RAISE EXCEPTION 'bad_amount'; END IF;
  UPDATE public.users SET xp = xp + p_amount WHERE id = p_user_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.increment_xp(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_xp(UUID, INTEGER) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_practice_streak(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  last_date      DATE;
  current_streak INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT last_practice_date, practice_streak INTO last_date, current_streak
  FROM public.users WHERE id = p_user_id;
  IF last_date IS NULL OR last_date < CURRENT_DATE - INTERVAL '1 day' THEN
    UPDATE public.users SET practice_streak = 1, last_practice_date = CURRENT_DATE WHERE id = p_user_id;
  ELSIF last_date = CURRENT_DATE - INTERVAL '1 day' THEN
    UPDATE public.users SET practice_streak = current_streak + 1, last_practice_date = CURRENT_DATE WHERE id = p_user_id;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.update_practice_streak(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_practice_streak(UUID) TO authenticated, service_role;

-- ── Permanent free course in the classroom rules (migration 030) ──────
-- available_free only for a student who has never claimed one.
CREATE OR REPLACE FUNCTION public.course_access_for(p_user UUID, p_course UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  u  public.users%ROWTYPE;
  co public.courses%ROWTYPE;
BEGIN
  SELECT * INTO u FROM public.users WHERE id = p_user;
  SELECT * INTO co FROM public.courses WHERE id = p_course;
  IF u.id IS NULL OR co.id IS NULL THEN RETURN 'payment_required'; END IF;

  IF u.free_course_code IS NOT NULL AND upper(u.free_course_code) = upper(co.course_code) THEN
    RETURN 'free';
  END IF;

  IF u.program_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.course_programs cp WHERE cp.course_id = co.id AND cp.program_id = u.program_id
  ) THEN
    RETURN 'wrong_program';
  END IF;

  IF u.program_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.subscriptions s
    LEFT JOIN public.semester_end_dates t ON t.program_id = s.program_id AND t.semester = s.semester
    WHERE s.user_id = p_user
      AND s.status = 'active'
      AND s.level = co.level
      AND s.semester = co.semester
      AND s.program_id = u.program_id
      AND (t.id IS NULL OR (
        now() < ((t.end_date + t.grace_days + 1)::timestamp AT TIME ZONE 'UTC')
        AND (t.start_date IS NULL OR s.paid_at IS NULL OR s.paid_at >= (t.start_date::timestamp AT TIME ZONE 'UTC'))
      ))
  ) THEN
    RETURN 'paid';
  END IF;

  IF u.free_course_code IS NULL AND u.free_course_claimed_at IS NULL THEN RETURN 'available_free'; END IF;
  RETURN 'payment_required';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.course_access_for(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_free_course(p_user UUID, p_course UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.users u SET
    selected_level         = coalesce(u.selected_level, co.level),
    selected_semester      = coalesce(u.selected_semester, co.semester),
    program_id             = coalesce(u.program_id, (SELECT cp.program_id FROM public.course_programs cp WHERE cp.course_id = co.id LIMIT 1)),
    free_course_code       = co.course_code,
    free_course_claimed_at = now()
  FROM public.courses co
  WHERE u.id = p_user AND co.id = p_course
    AND u.free_course_code IS NULL AND u.free_course_claimed_at IS NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_free_course(UUID, UUID) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ================================================================
-- CLASSROOM ANALYTICS — see migration 032
-- ================================================================
-- ================================================================
-- MIGRATION: Classroom analytics for admins
-- Run this in the Supabase SQL Editor once, after 031. Safe to re-run.
--
-- Answers "are classrooms working, and are they making or losing
-- money?": invites opened vs. joins, free vs. paid joins, whether
-- members go on to pay, and what the class deal actually costs.
-- ================================================================

-- ── Invite opens ───────────────────────────────────────────────────────
-- Written only by log_classroom_invite_view (no direct access), so the
-- count can't be inflated by inserting rows.
CREATE TABLE IF NOT EXISTS public.classroom_invite_views (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  classroom_id UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_classroom_invite_views_time ON public.classroom_invite_views(created_at);
CREATE INDEX IF NOT EXISTS idx_classroom_invite_views_room ON public.classroom_invite_views(classroom_id);
ALTER TABLE public.classroom_invite_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.classroom_invite_views FROM anon, authenticated;

-- The invite page calls this on open, signed in or not. A signed-in
-- student counts once per classroom per day; anonymous opens are capped
-- per classroom per minute so a refresh loop can't skew the numbers.
CREATE OR REPLACE FUNCTION public.log_classroom_invite_view(p_code TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  room_id UUID;
BEGIN
  SELECT id INTO room_id FROM public.classrooms WHERE join_code = upper(btrim(coalesce(p_code, '')));
  IF room_id IS NULL THEN RETURN; END IF;
  IF uid IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.classroom_invite_views v
    WHERE v.classroom_id = room_id AND v.user_id = uid AND v.created_at > now() - interval '1 day'
  ) THEN RETURN; END IF;
  IF uid IS NULL AND (
    SELECT count(*) FROM public.classroom_invite_views v
    WHERE v.classroom_id = room_id AND v.user_id IS NULL AND v.created_at > now() - interval '1 minute'
  ) >= 20 THEN RETURN; END IF;
  INSERT INTO public.classroom_invite_views (classroom_id, user_id) VALUES (room_id, uid);
END;
$$;
GRANT EXECUTE ON FUNCTION public.log_classroom_invite_view(TEXT) TO anon, authenticated;

-- ── How each member got in ─────────────────────────────────────────────
-- 'owner' (created it), 'free' (their free course, including one this
-- join claimed), 'paid' (an unlocked level). NULL = joined before this
-- migration.
ALTER TABLE public.classroom_members ADD COLUMN IF NOT EXISTS joined_with TEXT
  CHECK (joined_with IN ('owner', 'free', 'paid'));

CREATE OR REPLACE FUNCTION public.join_classroom(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  room public.classrooms%ROWTYPE;
  access TEXT;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT * INTO room FROM public.classrooms WHERE join_code = upper(btrim(coalesce(p_code, '')));
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_code'; END IF;
  IF EXISTS (SELECT 1 FROM public.classroom_members WHERE classroom_id = room.id AND user_id = uid) THEN
    RETURN room.id;
  END IF;
  IF (SELECT count(*) FROM public.classroom_members WHERE classroom_id = room.id) >= room.max_members THEN
    RAISE EXCEPTION 'classroom_full';
  END IF;

  -- Serialises this student's joins, so two invites opened at once can't
  -- both be taken as "my free course".
  PERFORM 1 FROM public.users WHERE id = uid FOR UPDATE;
  access := public.course_access_for(uid, room.course_id);
  IF access IN ('payment_required', 'wrong_program') THEN RAISE EXCEPTION '%', access; END IF;

  INSERT INTO public.classroom_members (classroom_id, user_id, joined_with)
  VALUES (room.id, uid, CASE WHEN access = 'paid' THEN 'paid' ELSE 'free' END);
  IF access = 'available_free' THEN PERFORM public.claim_free_course(uid, room.course_id); END IF;
  RETURN room.id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.join_classroom(TEXT) FROM anon;

CREATE OR REPLACE FUNCTION public.create_classroom(p_name TEXT, p_course_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  new_id UUID;
  access TEXT;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF char_length(btrim(coalesce(p_name, ''))) NOT BETWEEN 3 AND 80 THEN RAISE EXCEPTION 'bad_name'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.courses WHERE id = p_course_id) THEN RAISE EXCEPTION 'bad_course'; END IF;
  -- Abuse guard: a student can own at most 10 classrooms.
  IF (SELECT count(*) FROM public.classrooms WHERE owner_id = uid) >= 10 THEN RAISE EXCEPTION 'too_many_classrooms'; END IF;

  PERFORM 1 FROM public.users WHERE id = uid FOR UPDATE;
  access := public.course_access_for(uid, p_course_id);
  IF access IN ('payment_required', 'wrong_program') THEN RAISE EXCEPTION '%', access; END IF;

  INSERT INTO public.classrooms (name, course_id, owner_id, join_code)
  VALUES (btrim(p_name), p_course_id, uid, public.new_classroom_code())
  RETURNING id INTO new_id;

  INSERT INTO public.classroom_members (classroom_id, user_id, role, joined_with) VALUES (new_id, uid, 'owner', 'owner');
  IF access = 'available_free' THEN PERFORM public.claim_free_course(uid, p_course_id); END IF;
  RETURN new_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_classroom(TEXT, UUID) FROM anon;

-- ── What a payment would have cost without the class deal ──────────────
-- Set by /api/payments/verify and the webhook. NULL on older rows.
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS full_amount INTEGER;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS deal_classroom_id UUID REFERENCES public.classrooms(id) ON DELETE SET NULL;

-- ── The dashboard, in one call ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_classroom_stats(p_days INTEGER DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  since TIMESTAMP WITH TIME ZONE := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
  result JSONB;
BEGIN
  IF NOT coalesce(public.is_admin(), false) THEN RAISE EXCEPTION 'admin_only'; END IF;

  WITH member_pay AS (
    -- A member "paid after joining" if they unlocked the classroom's
    -- level+semester within 14 days of joining it (counted once each).
    SELECT DISTINCT ON (m.user_id, m.classroom_id) m.user_id, m.classroom_id, s.amount
    FROM public.classroom_members m
    JOIN public.classrooms c ON c.id = m.classroom_id
    JOIN public.courses co ON co.id = c.course_id
    JOIN public.subscriptions s ON s.user_id = m.user_id AND s.status = 'active'
      AND s.level = co.level AND s.semester = co.semester
      AND s.paid_at >= m.joined_at AND s.paid_at < m.joined_at + interval '14 days'
    WHERE m.joined_at >= since AND m.role <> 'owner'
    ORDER BY m.user_id, m.classroom_id, s.paid_at
  ),
  days AS (
    SELECT generate_series(date_trunc('day', since), date_trunc('day', now()), interval '1 day')::date AS day
  )
  SELECT jsonb_build_object(
    'days', greatest(1, least(coalesce(p_days, 30), 365)),
    'classrooms_total', (SELECT count(*) FROM public.classrooms),
    'classrooms_new', (SELECT count(*) FROM public.classrooms WHERE created_at >= since),
    'members_total', (SELECT count(*) FROM public.classroom_members),
    'invite_views', (SELECT count(*) FROM public.classroom_invite_views WHERE created_at >= since),
    'joins', (SELECT count(*) FROM public.classroom_members WHERE joined_at >= since AND role <> 'owner'),
    'joins_free', (SELECT count(*) FROM public.classroom_members WHERE joined_at >= since AND joined_with = 'free'),
    'joins_paid', (SELECT count(*) FROM public.classroom_members WHERE joined_at >= since AND joined_with = 'paid'),
    'paid_after_join', (SELECT count(*) FROM member_pay),
    'paid_after_join_amount', (SELECT coalesce(sum(amount), 0) FROM member_pay),
    'payments_total', (SELECT count(*) FROM public.subscriptions WHERE status = 'active' AND paid_at >= since),
    'payments_with_deal', (SELECT count(*) FROM public.subscriptions WHERE status = 'active' AND paid_at >= since AND deal_classroom_id IS NOT NULL),
    'deal_discount_total', (SELECT coalesce(sum(full_amount - amount), 0) FROM public.subscriptions
                            WHERE status = 'active' AND paid_at >= since AND deal_classroom_id IS NOT NULL AND full_amount > amount),
    'daily', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'day', d.day,
                'views', (SELECT count(*) FROM public.classroom_invite_views v WHERE v.created_at::date = d.day),
                'joins', (SELECT count(*) FROM public.classroom_members m WHERE m.joined_at::date = d.day AND m.role <> 'owner'),
                'created', (SELECT count(*) FROM public.classrooms c WHERE c.created_at::date = d.day)
              ) ORDER BY d.day), '[]'::jsonb) FROM days d),
    'top', (SELECT coalesce(jsonb_agg(t ORDER BY t.messages_7d + t.tests_7d DESC, t.members DESC), '[]'::jsonb) FROM (
              SELECT * FROM (
                SELECT c.id, c.name, co.course_code, c.created_at,
                       (SELECT count(*) FROM public.classroom_members m WHERE m.classroom_id = c.id)::INTEGER AS members,
                       (SELECT count(*) FROM public.classroom_messages x WHERE x.classroom_id = c.id AND x.created_at > now() - interval '7 days')::INTEGER AS messages_7d,
                       (SELECT count(*) FROM public.tests te JOIN public.classroom_members m ON m.user_id = te.user_id AND m.classroom_id = c.id
                        WHERE te.course_id = c.course_id AND te.created_at > now() - interval '7 days')::INTEGER AS tests_7d
                FROM public.classrooms c JOIN public.courses co ON co.id = c.course_id
              ) ranked
              ORDER BY messages_7d + tests_7d DESC, members DESC
              LIMIT 10
            ) t)
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_classroom_stats(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_classroom_stats(INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ================================================================
-- CLASSROOM NOTIFICATIONS — see migration 033
-- (unread counts, call/@mention alerts, web push subscriptions)
-- ================================================================
-- ── Unread counts ──────────────────────────────────────────────────────
ALTER TABLE public.classroom_members ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMP WITH TIME ZONE;
-- Existing members start with nothing unread rather than 100 old messages.
UPDATE public.classroom_members SET last_read_at = now() WHERE last_read_at IS NULL;
ALTER TABLE public.classroom_members ALTER COLUMN last_read_at SET DEFAULT now();
ALTER TABLE public.classroom_members ADD COLUMN IF NOT EXISTS alerts_enabled BOOLEAN NOT NULL DEFAULT true;

-- Classmates' messages since I last opened each chat, capped at 100
-- (the badge shows 99+). Ended-call notices don't count as news.
CREATE OR REPLACE FUNCTION public.get_my_classroom_unread()
RETURNS TABLE (classroom_id UUID, unread INTEGER)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT m.classroom_id,
         (SELECT count(*) FROM (
            SELECT 1 FROM public.classroom_messages x
            WHERE x.classroom_id = m.classroom_id
              AND x.user_id <> m.user_id
              AND x.kind <> 'call_end'
              AND x.created_at > coalesce(m.last_read_at, m.joined_at)
            LIMIT 100
          ) recent)::INTEGER
  FROM public.classroom_members m
  WHERE m.user_id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_classroom_unread() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_classroom_unread() TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_classroom_read(p_classroom UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.classroom_members SET last_read_at = now()
  WHERE classroom_id = p_classroom AND user_id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.mark_classroom_read(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_classroom_read(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_classroom_alerts(p_classroom UUID, p_enabled BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.classroom_members SET alerts_enabled = coalesce(p_enabled, true)
  WHERE classroom_id = p_classroom AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'not_a_member'; END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_classroom_alerts(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_classroom_alerts(UUID, BOOLEAN) TO authenticated;

-- ── Notifications can link somewhere ───────────────────────────────────
-- link: an in-app path to open. meta: what the alert is about (for a
-- call, the room link the toast's Join button opens).
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS link TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_notifications_message ON public.notifications((meta->>'message_id'));

-- Live: the bell and the call toast update without a refresh.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

-- ── Clean what the client sends with a message ─────────────────────────
-- mentions: kept only on text messages, only classmates (not yourself),
-- at most 10. A call's link must be a meet.jit.si room, so the Join
-- button in everyone's alert can't point somewhere else.
CREATE OR REPLACE FUNCTION public.classroom_messages_clean_meta()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ids JSONB;
BEGIN
  NEW.meta := coalesce(NEW.meta, '{}'::jsonb);
  IF NEW.kind = 'text' AND jsonb_typeof(NEW.meta->'mentions') = 'array' THEN
    SELECT coalesce(jsonb_agg(picked.user_id), '[]'::jsonb) INTO ids FROM (
      SELECT DISTINCT cm.user_id
      FROM jsonb_array_elements_text(NEW.meta->'mentions') AS e(v)
      JOIN public.classroom_members cm ON cm.classroom_id = NEW.classroom_id AND cm.user_id::text = e.v
      WHERE cm.user_id <> NEW.user_id
      LIMIT 10
    ) picked;
    NEW.meta := jsonb_set(NEW.meta, '{mentions}', ids);
  ELSE
    NEW.meta := NEW.meta - 'mentions';
  END IF;
  IF NEW.kind = 'call' AND coalesce(NEW.meta->>'url', '') NOT LIKE 'https://meet.jit.si/%' THEN
    NEW.meta := NEW.meta - 'url';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS classroom_messages_clean_meta ON public.classroom_messages;
CREATE TRIGGER classroom_messages_clean_meta BEFORE INSERT ON public.classroom_messages
  FOR EACH ROW EXECUTE FUNCTION public.classroom_messages_clean_meta();

-- ── Who hears about a message ──────────────────────────────────────────
-- Calls alert every classmate with alerts on (one alert per classroom
-- per 10 minutes, so stop/start doesn't ping everyone again). Mentions
-- alert just the people mentioned. Ordinary messages alert nobody —
-- they only count towards the unread badge.
CREATE OR REPLACE FUNCTION public.classroom_messages_notify()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  room_name TEXT;
  sender TEXT;
BEGIN
  IF NEW.kind NOT IN ('call', 'text') THEN RETURN NULL; END IF;
  IF NEW.kind = 'text' AND jsonb_array_length(coalesce(NEW.meta->'mentions', '[]'::jsonb)) = 0 THEN RETURN NULL; END IF;
  IF NEW.kind = 'call' AND EXISTS (
    SELECT 1 FROM public.classroom_messages x
    WHERE x.classroom_id = NEW.classroom_id AND x.kind = 'call' AND x.id <> NEW.id
      AND x.created_at > NEW.created_at - interval '10 minutes'
  ) THEN RETURN NULL; END IF;

  SELECT name INTO room_name FROM public.classrooms WHERE id = NEW.classroom_id;
  SELECT coalesce(nullif(split_part(btrim(full_name), ' ', 1), ''), 'A classmate') INTO sender
  FROM public.users WHERE id = NEW.user_id;
  sender := coalesce(sender, 'A classmate');

  IF NEW.kind = 'call' THEN
    INSERT INTO public.notifications (user_id, type, message, link, meta)
    SELECT cm.user_id, 'classroom_call', sender || ' started a call in ' || room_name,
           '/classrooms/' || NEW.classroom_id,
           jsonb_strip_nulls(jsonb_build_object('classroom_id', NEW.classroom_id, 'message_id', NEW.id, 'url', NEW.meta->>'url'))
    FROM public.classroom_members cm
    WHERE cm.classroom_id = NEW.classroom_id AND cm.user_id <> NEW.user_id AND cm.alerts_enabled;
  ELSE
    INSERT INTO public.notifications (user_id, type, message, link, meta)
    SELECT cm.user_id, 'classroom_mention',
           sender || ' mentioned you in ' || room_name || ': ' || left(NEW.body, 140) || CASE WHEN char_length(NEW.body) > 140 THEN '…' ELSE '' END,
           '/classrooms/' || NEW.classroom_id,
           jsonb_build_object('classroom_id', NEW.classroom_id, 'message_id', NEW.id)
    FROM public.classroom_members cm
    WHERE cm.classroom_id = NEW.classroom_id AND cm.alerts_enabled
      AND cm.user_id::text IN (SELECT jsonb_array_elements_text(NEW.meta->'mentions'));
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS classroom_messages_notify ON public.classroom_messages;
CREATE TRIGGER classroom_messages_notify AFTER INSERT ON public.classroom_messages
  FOR EACH ROW EXECUTE FUNCTION public.classroom_messages_notify();

-- ── Web push ───────────────────────────────────────────────────────────
-- One row per browser. Only reachable through the functions below: a
-- subscription endpoint is a capability (anyone holding it can ping that
-- device), so clients never read the table.
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE CHECK (endpoint LIKE 'https://%' AND char_length(endpoint) <= 1000),
  p256dh     TEXT NOT NULL CHECK (char_length(p256dh) <= 200),
  auth       TEXT NOT NULL CHECK (char_length(auth) <= 100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions(user_id);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions FROM anon, authenticated;

-- Saving the same browser again (or for a different account that signed
-- in on it) moves the subscription to whoever is signed in now. Ten
-- devices per student; the oldest goes first.
CREATE OR REPLACE FUNCTION public.save_push_subscription(p_endpoint TEXT, p_p256dh TEXT, p_auth TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth)
  VALUES (uid, p_endpoint, p_p256dh, p_auth)
  ON CONFLICT (endpoint) DO UPDATE SET user_id = uid, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, created_at = now();
  DELETE FROM public.push_subscriptions WHERE id IN (
    SELECT id FROM public.push_subscriptions WHERE user_id = uid ORDER BY created_at DESC OFFSET 10
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.save_push_subscription(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_push_subscription(TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_push_subscription(p_endpoint TEXT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.push_subscriptions WHERE endpoint = p_endpoint AND user_id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.delete_push_subscription(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_push_subscription(TEXT) TO authenticated;

-- Each message is pushed at most once, however often the route is called.
CREATE TABLE IF NOT EXISTS public.classroom_push_sent (
  message_id UUID PRIMARY KEY REFERENCES public.classroom_messages(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.classroom_push_sent ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.classroom_push_sent FROM anon, authenticated;

-- The devices to ping for a message the sender just posted: exactly the
-- people the notify trigger alerted (so alerts_enabled and the call
-- cooldown apply to push too). Service role only — the route passes the
-- signed-in sender, and a message older than 10 minutes is never pushed.
CREATE OR REPLACE FUNCTION public.classroom_push_targets(p_message UUID, p_sender UUID)
RETURNS TABLE (endpoint TEXT, p256dh TEXT, auth TEXT, title TEXT, body TEXT, link TEXT, kind TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.classroom_messages
    WHERE id = p_message AND user_id = p_sender AND created_at > now() - interval '10 minutes'
  ) THEN RETURN; END IF;
  INSERT INTO public.classroom_push_sent (message_id) VALUES (p_message) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT s.endpoint, s.p256dh, s.auth, c.name, n.message, n.link, n.type
  FROM public.notifications n
  JOIN public.push_subscriptions s ON s.user_id = n.user_id
  JOIN public.classrooms c ON c.id::text = n.meta->>'classroom_id'
  WHERE n.meta->>'message_id' = p_message::text
    AND n.type IN ('classroom_call', 'classroom_mention');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.classroom_push_targets(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.classroom_push_targets(UUID, UUID) TO service_role;

-- Dead subscriptions (the browser unsubscribed) reported by the push
-- service; also service role only.
CREATE OR REPLACE FUNCTION public.drop_push_subscription(p_endpoint TEXT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.push_subscriptions WHERE endpoint = p_endpoint;
$$;
REVOKE EXECUTE ON FUNCTION public.drop_push_subscription(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.drop_push_subscription(TEXT) TO service_role;

-- ================================================================
-- SERVER-SCORED TESTS + CLASS BATTLES — see migration 034
-- (tests saved only through /api/tests/submit, live classroom battles)
-- ================================================================
-- ── 1. Tests scored on the server ──────────────────────────────────────
ALTER TABLE public.tests DROP CONSTRAINT IF EXISTS tests_test_type_check;
ALTER TABLE public.tests ADD CONSTRAINT tests_test_type_check
  CHECK (test_type IN ('practice', 'exam_simulation', 'battle'));

DROP POLICY IF EXISTS "tests_insert_own" ON public.tests;
DROP POLICY IF EXISTS "test_answers_insert_own" ON public.test_answers;

-- XP is awarded by record_test and battle results only.
REVOKE EXECUTE ON FUNCTION public.increment_xp(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_xp(UUID, INTEGER) TO service_role;

-- Same normalising as /api/check-answer: case and spacing don't matter.
CREATE OR REPLACE FUNCTION public.norm_answer(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'));
$$;

-- An option-based answer is right when it picks exactly the correct options.
CREATE OR REPLACE FUNCTION public.options_match(p_selected JSONB, p_correct JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(p_selected) = 'array' AND jsonb_typeof(p_correct) = 'array'
    AND jsonb_array_length(p_selected) > 0
    AND (SELECT array_agg(DISTINCT v ORDER BY v) FROM jsonb_array_elements_text(p_selected) v)
      = (SELECT array_agg(DISTINCT v ORDER BY v) FROM jsonb_array_elements_text(p_correct) v);
$$;

-- XP and the daily streak after a test or battle. Internal only.
CREATE OR REPLACE FUNCTION public.apply_test_rewards(p_user UUID, p_xp INTEGER)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  last_date DATE;
BEGIN
  SELECT last_practice_date INTO last_date FROM public.users WHERE id = p_user;
  UPDATE public.users SET
    xp = xp + greatest(0, coalesce(p_xp, 0)),
    total_tests_taken = total_tests_taken + 1,
    practice_streak = CASE
      WHEN last_date = CURRENT_DATE THEN practice_streak
      WHEN last_date = CURRENT_DATE - 1 THEN practice_streak + 1
      ELSE 1 END,
    last_practice_date = CURRENT_DATE
  WHERE id = p_user;
END;
$$;

-- Marks a practice session or mock exam and saves it. Called only by
-- /api/tests/submit (service role), which has already checked the
-- fill-in-the-blank answers that need AI marking and passes those it
-- judged right in p_fill_ok. Everything else is marked here.
-- p_answers: [{ "question_id": uuid, "selected": [text], "confidence": "sure"|"unsure"|null }]
CREATE OR REPLACE FUNCTION public.record_test(
  p_user UUID, p_course UUID, p_topic UUID, p_type TEXT, p_answers JSONB,
  p_time_taken INTEGER DEFAULT NULL, p_fill_ok UUID[] DEFAULT '{}'
)
RETURNS TABLE (test_id UUID, score INTEGER, total INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  n INTEGER;
  matched INTEGER;
  got INTEGER;
  new_id UUID;
  pct NUMERIC;
  topic UUID := p_topic;
BEGIN
  IF p_type NOT IN ('practice', 'exam_simulation') THEN RAISE EXCEPTION 'bad_type'; END IF;
  IF coalesce(public.course_access_for(p_user, p_course), '') NOT IN ('free', 'paid')
     AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user AND role IN ('admin', 'super_admin')) THEN
    RAISE EXCEPTION 'payment_required';
  END IF;
  IF jsonb_typeof(p_answers) <> 'array' THEN RAISE EXCEPTION 'bad_answers'; END IF;
  n := jsonb_array_length(p_answers);
  IF n < 1 OR n > 100 THEN RAISE EXCEPTION 'bad_answers'; END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.submitted (
    question_id UUID, selected JSONB, confidence TEXT, is_correct BOOLEAN
  ) ON COMMIT DROP;
  DELETE FROM pg_temp.submitted;
  INSERT INTO pg_temp.submitted (question_id, selected, confidence)
  SELECT (e->>'question_id')::uuid,
         CASE WHEN jsonb_typeof(e->'selected') = 'array' AND jsonb_array_length(e->'selected') <= 10
              THEN e->'selected' ELSE '[]'::jsonb END,
         CASE WHEN e->>'confidence' IN ('sure', 'unsure') THEN e->>'confidence' END
  FROM jsonb_array_elements(p_answers) e;

  -- Every question once, approved, and from this course.
  SELECT count(DISTINCT s.question_id) INTO matched
  FROM pg_temp.submitted s
  JOIN public.questions q ON q.id = s.question_id AND q.course_id = p_course AND q.is_approved;
  IF matched <> n THEN RAISE EXCEPTION 'bad_questions'; END IF;

  UPDATE pg_temp.submitted s SET is_correct = CASE
      WHEN q.question_type = 'fill_in_blank' THEN
        q.id = ANY (coalesce(p_fill_ok, '{}'))
        OR (public.norm_answer(s.selected->>0) <> '' AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(q.correct_answers) ca
          WHERE public.norm_answer(ca) = public.norm_answer(s.selected->>0)))
      ELSE public.options_match(s.selected, q.correct_answers)
    END
  FROM public.questions q WHERE q.id = s.question_id;

  SELECT count(*) FILTER (WHERE s.is_correct) INTO got FROM pg_temp.submitted s;
  pct := round(got::NUMERIC * 100 / n, 2);
  -- A deleted topic shouldn't fail the save.
  IF topic IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.topics t WHERE t.id = topic AND t.course_id = p_course) THEN
    topic := NULL;
  END IF;

  INSERT INTO public.tests (user_id, course_id, topic_id, test_type, score, total_questions, percentage, time_taken, completed_at)
  VALUES (p_user, p_course, topic, p_type, got, n, pct,
          CASE WHEN p_time_taken BETWEEN 0 AND 86400 THEN p_time_taken END, now())
  RETURNING id INTO new_id;

  INSERT INTO public.test_answers (test_id, question_id, selected_answer, is_correct, confidence)
  SELECT new_id, s.question_id, s.selected, s.is_correct, s.confidence FROM pg_temp.submitted s;

  PERFORM public.apply_test_rewards(p_user, got * 10 + CASE WHEN p_type = 'exam_simulation' AND pct >= 70 THEN 50 ELSE 0 END);

  RETURN QUERY SELECT new_id, got, n;
END;
$$;

-- ── 2. Class battles ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.classroom_battles (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  classroom_id         UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  host_id              UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id            UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  topic_ids            UUID[] NOT NULL DEFAULT '{}',
  status               TEXT NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby', 'live', 'finished', 'cancelled')),
  question_count       INTEGER NOT NULL,
  seconds_per_question INTEGER NOT NULL DEFAULT 20,
  reveal_seconds       INTEGER NOT NULL DEFAULT 6,
  created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  started_at           TIMESTAMP WITH TIME ZONE,  -- when question 1 opens
  finished_at          TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_classroom_battles_room ON public.classroom_battles(classroom_id, created_at DESC);

-- Which questions, in order. Never readable by students: it names the
-- question ids, and the answers are one lookup away from those.
CREATE TABLE IF NOT EXISTS public.classroom_battle_questions (
  battle_id   UUID NOT NULL REFERENCES public.classroom_battles(id) ON DELETE CASCADE,
  idx         INTEGER NOT NULL,
  question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  PRIMARY KEY (battle_id, idx)
);

CREATE TABLE IF NOT EXISTS public.classroom_battle_players (
  battle_id UUID NOT NULL REFERENCES public.classroom_battles(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  -- Filled in when the battle finishes; live scores come from the answers.
  score     INTEGER NOT NULL DEFAULT 0,
  correct   INTEGER NOT NULL DEFAULT 0,
  answered  INTEGER NOT NULL DEFAULT 0,
  rank      INTEGER,
  PRIMARY KEY (battle_id, user_id)
);

-- One answer per player per question; read only through the RPCs, so
-- nobody sees who got it right until the question closes.
CREATE TABLE IF NOT EXISTS public.classroom_battle_answers (
  battle_id  UUID NOT NULL REFERENCES public.classroom_battles(id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  selected   JSONB NOT NULL,
  is_correct BOOLEAN NOT NULL,
  points     INTEGER NOT NULL,
  answer_ms  INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (battle_id, idx, user_id)
);

ALTER TABLE public.tests ADD COLUMN IF NOT EXISTS battle_id UUID REFERENCES public.classroom_battles(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tests_battle_user ON public.tests(battle_id, user_id) WHERE battle_id IS NOT NULL;

ALTER TABLE public.classroom_battles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_battle_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_battle_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_battle_answers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.classroom_battle_questions, public.classroom_battle_answers FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.classroom_battles, public.classroom_battle_players FROM anon, authenticated;

-- Members can see their classroom's battles and who's in them (the lobby
-- updates live from these); every write goes through the RPCs below.
DROP POLICY IF EXISTS "classroom_battles_select_member" ON public.classroom_battles;
CREATE POLICY "classroom_battles_select_member" ON public.classroom_battles FOR SELECT
  USING (public.classroom_role(classroom_id) IS NOT NULL);
DROP POLICY IF EXISTS "classroom_battle_players_select_member" ON public.classroom_battle_players;
CREATE POLICY "classroom_battle_players_select_member" ON public.classroom_battle_players FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.classroom_battles b
                 WHERE b.id = battle_id AND public.classroom_role(b.classroom_id) IS NOT NULL));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'classroom_battles') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.classroom_battles;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'classroom_battle_players') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.classroom_battle_players;
    END IF;
  END IF;
END $$;

-- "X started a battle" in the chat comes only from create_classroom_battle.
ALTER TABLE public.classroom_messages DROP CONSTRAINT IF EXISTS classroom_messages_kind_check;
ALTER TABLE public.classroom_messages ADD CONSTRAINT classroom_messages_kind_check
  CHECK (kind IN ('text', 'call', 'call_end', 'resource', 'battle'));

CREATE OR REPLACE FUNCTION public.classroom_messages_battle_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'battle' AND coalesce(current_setting('pastcs.battle_post', true), '') <> 'on' THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS classroom_messages_battle_guard ON public.classroom_messages;
CREATE TRIGGER classroom_messages_battle_guard BEFORE INSERT ON public.classroom_messages
  FOR EACH ROW EXECUTE FUNCTION public.classroom_messages_battle_guard();

-- Where a battle is right now, worked out from the clock: a short
-- countdown, then for each question `seconds_per_question` to answer and
-- `reveal_seconds` showing the answer and the leaderboard.
CREATE OR REPLACE FUNCTION public.battle_phase(b public.classroom_battles, p_at TIMESTAMP WITH TIME ZONE DEFAULT now())
RETURNS TABLE (phase TEXT, idx INTEGER, ends_at TIMESTAMP WITH TIME ZONE)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  slot_len NUMERIC := b.seconds_per_question + b.reveal_seconds;
  elapsed NUMERIC;
  slot INTEGER;
BEGIN
  IF b.status IN ('lobby', 'cancelled') THEN RETURN QUERY SELECT b.status, -1, NULL::timestamptz; RETURN; END IF;
  IF b.status = 'finished' THEN RETURN QUERY SELECT 'finished'::text, b.question_count - 1, NULL::timestamptz; RETURN; END IF;
  elapsed := extract(epoch FROM p_at - b.started_at);
  IF elapsed < 0 THEN RETURN QUERY SELECT 'countdown'::text, -1, b.started_at; RETURN; END IF;
  slot := floor(elapsed / slot_len);
  IF slot >= b.question_count THEN RETURN QUERY SELECT 'finished'::text, b.question_count - 1, NULL::timestamptz; RETURN; END IF;
  IF elapsed - slot * slot_len < b.seconds_per_question THEN
    RETURN QUERY SELECT 'question'::text, slot, b.started_at + make_interval(secs => slot * slot_len + b.seconds_per_question);
  ELSE
    RETURN QUERY SELECT 'reveal'::text, slot, b.started_at + make_interval(secs => (slot + 1) * slot_len);
  END IF;
END;
$$;

-- Tidies a classroom's battles: a lobby nobody started in 30 minutes is
-- cancelled, and a battle whose last question has closed is finished —
-- scores ranked, a `tests` row and XP for everyone who answered.
-- Idempotent (the row lock + status check), so any caller can run it.
CREATE OR REPLACE FUNCTION public.settle_classroom_battles(p_classroom UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b public.classroom_battles%ROWTYPE;
  ph TEXT;
  contenders INTEGER;
  p RECORD;
  new_test UUID;
BEGIN
  UPDATE public.classroom_battles SET status = 'cancelled', finished_at = now()
  WHERE classroom_id = p_classroom AND status = 'lobby' AND created_at < now() - INTERVAL '30 minutes';

  FOR b IN SELECT * FROM public.classroom_battles
           WHERE classroom_id = p_classroom AND status = 'live' FOR UPDATE LOOP
    SELECT x.phase INTO ph FROM public.battle_phase(b) x;
    CONTINUE WHEN ph <> 'finished';

    UPDATE public.classroom_battle_players pl SET
      score = coalesce(a.score, 0), correct = coalesce(a.correct, 0), answered = coalesce(a.answered, 0)
    FROM (SELECT pl2.user_id,
                 sum(ans.points)::int AS score,
                 count(*) FILTER (WHERE ans.is_correct)::int AS correct,
                 count(ans.idx)::int AS answered
          FROM public.classroom_battle_players pl2
          LEFT JOIN public.classroom_battle_answers ans ON ans.battle_id = pl2.battle_id AND ans.user_id = pl2.user_id
          WHERE pl2.battle_id = b.id GROUP BY pl2.user_id) a
    WHERE pl.battle_id = b.id AND pl.user_id = a.user_id;

    UPDATE public.classroom_battle_players pl SET rank = r.rnk
    FROM (SELECT user_id, rank() OVER (ORDER BY score DESC, correct DESC)::int AS rnk
          FROM public.classroom_battle_players WHERE battle_id = b.id AND answered > 0) r
    WHERE pl.battle_id = b.id AND pl.user_id = r.user_id;

    SELECT count(*) INTO contenders FROM public.classroom_battle_players WHERE battle_id = b.id AND answered > 0;

    FOR p IN SELECT * FROM public.classroom_battle_players WHERE battle_id = b.id AND answered > 0 LOOP
      INSERT INTO public.tests (user_id, course_id, test_type, score, total_questions, percentage, completed_at, battle_id)
      VALUES (p.user_id, b.course_id, 'battle', p.correct, p.answered, round(p.correct::NUMERIC * 100 / p.answered, 2), now(), b.id)
      ON CONFLICT DO NOTHING
      RETURNING id INTO new_test;
      CONTINUE WHEN new_test IS NULL;
      INSERT INTO public.test_answers (test_id, question_id, selected_answer, is_correct)
      SELECT new_test, bq.question_id, ans.selected, ans.is_correct
      FROM public.classroom_battle_answers ans
      JOIN public.classroom_battle_questions bq ON bq.battle_id = ans.battle_id AND bq.idx = ans.idx
      WHERE ans.battle_id = b.id AND ans.user_id = p.user_id;
      -- 10 XP a correct answer, like practice, plus a podium bonus when
      -- there was someone to beat.
      PERFORM public.apply_test_rewards(p.user_id, p.correct * 10 + CASE
        WHEN contenders < 2 THEN 0 WHEN p.rank = 1 THEN 30 WHEN p.rank = 2 THEN 20 WHEN p.rank = 3 THEN 10 ELSE 0 END);
      new_test := NULL;
    END LOOP;

    UPDATE public.classroom_battles SET status = 'finished', finished_at = now() WHERE id = b.id;
  END LOOP;
END;
$$;

-- Any member can open a battle on the classroom's course: up to 10
-- random option questions (typed answers need AI marking — too slow for
-- a 20-second round), optionally from chosen topics.
CREATE OR REPLACE FUNCTION public.create_classroom_battle(p_classroom UUID, p_topic_ids UUID[] DEFAULT '{}')
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me UUID := auth.uid();
  room public.classrooms%ROWTYPE;
  topics UUID[] := coalesce(p_topic_ids, '{}');
  new_id UUID;
  picked INTEGER;
  first_name TEXT;
BEGIN
  IF me IS NULL OR public.classroom_role(p_classroom) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  SELECT * INTO room FROM public.classrooms WHERE id = p_classroom;
  IF coalesce(public.course_access_for(me, room.course_id), '') NOT IN ('free', 'paid') THEN RAISE EXCEPTION 'payment_required'; END IF;

  PERFORM public.settle_classroom_battles(p_classroom);
  IF EXISTS (SELECT 1 FROM public.classroom_battles WHERE classroom_id = p_classroom AND status IN ('lobby', 'live')) THEN
    RAISE EXCEPTION 'battle_in_progress';
  END IF;
  IF (SELECT count(*) FROM public.classroom_battles WHERE classroom_id = p_classroom AND host_id = me
      AND created_at > now() - INTERVAL '1 hour') >= 6 THEN
    RAISE EXCEPTION 'slow_down';
  END IF;
  IF cardinality(topics) > 20 OR EXISTS (
    SELECT 1 FROM unnest(topics) t(id) WHERE NOT EXISTS (SELECT 1 FROM public.topics tp WHERE tp.id = t.id AND tp.course_id = room.course_id)
  ) THEN
    RAISE EXCEPTION 'bad_topic';
  END IF;

  INSERT INTO public.classroom_battles (classroom_id, host_id, course_id, topic_ids, question_count)
  VALUES (p_classroom, me, room.course_id, topics, 0) RETURNING id INTO new_id;

  INSERT INTO public.classroom_battle_questions (battle_id, idx, question_id)
  SELECT new_id, (row_number() OVER () - 1)::int, q.id FROM (
    SELECT q.id FROM public.questions q
    WHERE q.course_id = room.course_id AND q.is_approved
      AND q.question_type IN ('single_choice', 'multiple_choice')
      AND jsonb_typeof(q.options) = 'array' AND jsonb_array_length(q.options) >= 2
      AND jsonb_typeof(q.correct_answers) = 'array' AND jsonb_array_length(q.correct_answers) >= 1
      AND (cardinality(topics) = 0 OR q.topic_id = ANY (topics))
    ORDER BY random() LIMIT 10
  ) q;
  GET DIAGNOSTICS picked = ROW_COUNT;
  IF picked < 5 THEN RAISE EXCEPTION 'not_enough_questions'; END IF;
  UPDATE public.classroom_battles SET question_count = picked WHERE id = new_id;

  INSERT INTO public.classroom_battle_players (battle_id, user_id) VALUES (new_id, me);

  SELECT split_part(coalesce(nullif(btrim(full_name), ''), 'A classmate'), ' ', 1) INTO first_name FROM public.users WHERE id = me;
  PERFORM set_config('pastcs.battle_post', 'on', true);
  INSERT INTO public.classroom_messages (classroom_id, user_id, kind, body, meta)
  VALUES (p_classroom, me, 'battle', first_name || ' started a battle: ' || picked || ' questions. Join the lobby!',
          jsonb_build_object('battle_id', new_id));
  PERFORM set_config('pastcs.battle_post', '', true);
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_classroom_battle(p_battle UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me UUID := auth.uid();
  b public.classroom_battles%ROWTYPE;
BEGIN
  SELECT * INTO b FROM public.classroom_battles WHERE id = p_battle FOR UPDATE;
  IF me IS NULL OR b.id IS NULL OR public.classroom_role(b.classroom_id) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF EXISTS (SELECT 1 FROM public.classroom_battle_players WHERE battle_id = p_battle AND user_id = me) THEN RETURN; END IF;
  IF b.status <> 'lobby' THEN RAISE EXCEPTION 'battle_started'; END IF;
  IF coalesce(public.course_access_for(me, b.course_id), '') NOT IN ('free', 'paid') THEN RAISE EXCEPTION 'payment_required'; END IF;
  IF (SELECT count(*) FROM public.classroom_battle_players WHERE battle_id = p_battle) >= 50 THEN RAISE EXCEPTION 'battle_full'; END IF;
  INSERT INTO public.classroom_battle_players (battle_id, user_id) VALUES (p_battle, me);
END;
$$;

-- Leave a lobby (the host cancels instead).
CREATE OR REPLACE FUNCTION public.leave_classroom_battle(p_battle UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.classroom_battle_players pl
  USING public.classroom_battles b
  WHERE pl.battle_id = p_battle AND pl.user_id = auth.uid()
    AND b.id = pl.battle_id AND b.status = 'lobby' AND b.host_id <> auth.uid();
$$;

-- The host (or the classroom's owner/leaders) starts it for everyone:
-- question 1 opens 4 seconds later, the same moment on every phone.
CREATE OR REPLACE FUNCTION public.start_classroom_battle(p_battle UUID)
RETURNS TIMESTAMP WITH TIME ZONE
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b public.classroom_battles%ROWTYPE;
  at TIMESTAMP WITH TIME ZONE := now() + INTERVAL '4 seconds';
BEGIN
  SELECT * INTO b FROM public.classroom_battles WHERE id = p_battle FOR UPDATE;
  IF b.id IS NULL OR public.classroom_role(b.classroom_id) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF b.host_id <> auth.uid() AND public.classroom_role(b.classroom_id) NOT IN ('owner', 'leader') THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF b.status <> 'lobby' THEN RAISE EXCEPTION 'battle_started'; END IF;
  IF (SELECT count(*) FROM public.classroom_battle_players WHERE battle_id = p_battle) < 2 THEN RAISE EXCEPTION 'need_two_players'; END IF;
  UPDATE public.classroom_battles SET status = 'live', started_at = at WHERE id = p_battle;
  RETURN at;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_classroom_battle(p_battle UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b public.classroom_battles%ROWTYPE;
BEGIN
  SELECT * INTO b FROM public.classroom_battles WHERE id = p_battle FOR UPDATE;
  IF b.id IS NULL OR public.classroom_role(b.classroom_id) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF b.host_id <> auth.uid() AND public.classroom_role(b.classroom_id) NOT IN ('owner', 'leader') THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF b.status <> 'lobby' THEN RAISE EXCEPTION 'battle_started'; END IF;
  UPDATE public.classroom_battles SET status = 'cancelled', finished_at = now() WHERE id = p_battle;
END;
$$;

-- Lock in an answer for the open question. Points: 0 if wrong; if right,
-- 500 plus up to 500 for speed. A second and a half of grace covers the
-- trip from a slow phone. Returns nothing about whether it was right —
-- that's revealed to everyone together when the question closes.
CREATE OR REPLACE FUNCTION public.submit_battle_answer(p_battle UUID, p_idx INTEGER, p_selected JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me UUID := auth.uid();
  b public.classroom_battles%ROWTYPE;
  q public.questions%ROWTYPE;
  t NUMERIC;
  ok BOOLEAN;
  inserted INTEGER;
BEGIN
  SELECT * INTO b FROM public.classroom_battles WHERE id = p_battle;
  IF me IS NULL OR b.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.classroom_battle_players WHERE battle_id = p_battle AND user_id = me
  ) OR public.classroom_role(b.classroom_id) IS NULL THEN
    RAISE EXCEPTION 'not_in_battle';
  END IF;
  IF b.status <> 'live' OR p_idx IS NULL OR p_idx < 0 OR p_idx >= b.question_count THEN RAISE EXCEPTION 'question_closed'; END IF;
  t := extract(epoch FROM now() - (b.started_at + make_interval(secs => p_idx * (b.seconds_per_question + b.reveal_seconds))));
  IF t < 0 OR t > b.seconds_per_question + 1.5 THEN RAISE EXCEPTION 'question_closed'; END IF;
  IF jsonb_typeof(p_selected) <> 'array' OR jsonb_array_length(p_selected) NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'bad_answer'; END IF;

  SELECT qq.* INTO q FROM public.classroom_battle_questions bq JOIN public.questions qq ON qq.id = bq.question_id
  WHERE bq.battle_id = p_battle AND bq.idx = p_idx;
  ok := public.options_match(p_selected, q.correct_answers);

  INSERT INTO public.classroom_battle_answers (battle_id, idx, user_id, selected, is_correct, points, answer_ms)
  VALUES (p_battle, p_idx, me, p_selected, ok,
          CASE WHEN ok THEN 500 + round(500 * greatest(0, 1 - least(t, b.seconds_per_question) / b.seconds_per_question))::int ELSE 0 END,
          round(least(t, b.seconds_per_question) * 1000)::int)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF inserted = 0 THEN RAISE EXCEPTION 'already_answered'; END IF;
  RETURN jsonb_build_object('accepted', true);
END;
$$;

-- Everything a phone needs to draw the battle right now, so a player who
-- drops and comes back picks up exactly where everyone else is. The
-- correct answer is included only once the question has closed, and
-- scores only count closed questions.
CREATE OR REPLACE FUNCTION public.get_classroom_battle(p_battle UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me UUID := auth.uid();
  b public.classroom_battles%ROWTYPE;
  ph RECORD;
  closed_through INTEGER;  -- questions 0..closed_through count toward scores
  q public.questions%ROWTYPE;
  res JSONB;
BEGIN
  SELECT * INTO b FROM public.classroom_battles WHERE id = p_battle;
  IF me IS NULL OR b.id IS NULL OR public.classroom_role(b.classroom_id) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF b.status IN ('lobby', 'live') THEN
    PERFORM public.settle_classroom_battles(b.classroom_id);
    SELECT * INTO b FROM public.classroom_battles WHERE id = p_battle;
  END IF;
  SELECT * INTO ph FROM public.battle_phase(b);
  closed_through := CASE ph.phase WHEN 'question' THEN ph.idx - 1 WHEN 'reveal' THEN ph.idx WHEN 'finished' THEN b.question_count - 1 ELSE -1 END;

  res := jsonb_build_object(
    'id', b.id, 'classroom_id', b.classroom_id, 'host_id', b.host_id, 'status', b.status,
    'phase', ph.phase, 'idx', ph.idx, 'phase_ends_at', ph.ends_at, 'server_now', now(),
    'started_at', b.started_at, 'created_at', b.created_at, 'question_count', b.question_count,
    'seconds_per_question', b.seconds_per_question, 'reveal_seconds', b.reveal_seconds,
    'am_player', EXISTS (SELECT 1 FROM public.classroom_battle_players WHERE battle_id = b.id AND user_id = me),
    'topics', coalesce((SELECT jsonb_agg(tp.topic_name ORDER BY tp.topic_name) FROM public.topics tp WHERE tp.id = ANY (b.topic_ids)), '[]'::jsonb),
    'players', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', pl.user_id, 'full_name', u.full_name, 'avatar_url', u.avatar_url, 'is_me', pl.user_id = me,
        'score', coalesce(s.score, 0), 'correct', coalesce(s.correct, 0), 'rank', pl.rank,
        'last_points', CASE WHEN ph.phase IN ('reveal', 'finished') THEN s.last_points END,
        'answered_current', ph.phase = 'question' AND EXISTS (
          SELECT 1 FROM public.classroom_battle_answers a WHERE a.battle_id = b.id AND a.idx = ph.idx AND a.user_id = pl.user_id)
      ) ORDER BY coalesce(s.score, 0) DESC, coalesce(s.correct, 0) DESC, pl.joined_at)
      FROM public.classroom_battle_players pl
      JOIN public.users u ON u.id = pl.user_id
      LEFT JOIN LATERAL (
        SELECT sum(a.points)::int AS score, count(*) FILTER (WHERE a.is_correct)::int AS correct,
               max(a.points) FILTER (WHERE a.idx = closed_through) AS last_points
        FROM public.classroom_battle_answers a
        WHERE a.battle_id = b.id AND a.user_id = pl.user_id AND a.idx <= closed_through
      ) s ON TRUE
      WHERE pl.battle_id = b.id
    ), '[]'::jsonb)
  );

  IF ph.phase IN ('question', 'reveal') THEN
    SELECT qq.* INTO q FROM public.classroom_battle_questions bq JOIN public.questions qq ON qq.id = bq.question_id
    WHERE bq.battle_id = b.id AND bq.idx = ph.idx;
    res := res || jsonb_build_object('question', jsonb_build_object(
      'idx', ph.idx, 'type', q.question_type, 'text', q.question_text, 'options', q.options,
      'correct_answers', CASE WHEN ph.phase = 'reveal' THEN q.correct_answers END,
      'explanation', CASE WHEN ph.phase = 'reveal' THEN q.explanation END
    ));
    res := res || jsonb_build_object('my_answer', (
      SELECT jsonb_build_object('selected', a.selected,
        'is_correct', CASE WHEN ph.phase = 'reveal' THEN a.is_correct END,
        'points', CASE WHEN ph.phase = 'reveal' THEN a.points END)
      FROM public.classroom_battle_answers a WHERE a.battle_id = b.id AND a.idx = ph.idx AND a.user_id = me));
  END IF;
  RETURN res;
END;
$$;

-- The classroom's battles, newest first, for the Battles card: the open
-- one (if any) and recent results.
CREATE OR REPLACE FUNCTION public.get_classroom_battles(p_classroom UUID)
RETURNS TABLE (
  id UUID, status TEXT, host_id UUID, host_name TEXT, players INTEGER, question_count INTEGER,
  created_at TIMESTAMP WITH TIME ZONE, winner_name TEXT, my_rank INTEGER, my_score INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL OR public.classroom_role(p_classroom) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  PERFORM public.settle_classroom_battles(p_classroom);
  RETURN QUERY
  SELECT b.id, b.status, b.host_id, hu.full_name,
    (SELECT count(*)::int FROM public.classroom_battle_players pl WHERE pl.battle_id = b.id),
    b.question_count, b.created_at,
    (SELECT u.full_name FROM public.classroom_battle_players pl JOIN public.users u ON u.id = pl.user_id
     WHERE pl.battle_id = b.id AND pl.rank = 1 ORDER BY pl.correct DESC LIMIT 1),
    (SELECT pl.rank FROM public.classroom_battle_players pl WHERE pl.battle_id = b.id AND pl.user_id = auth.uid()),
    (SELECT pl.score FROM public.classroom_battle_players pl WHERE pl.battle_id = b.id AND pl.user_id = auth.uid())
  FROM public.classroom_battles b
  JOIN public.users hu ON hu.id = b.host_id
  WHERE b.classroom_id = p_classroom AND b.status <> 'cancelled'
  ORDER BY b.created_at DESC
  LIMIT 10;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_test(UUID, UUID, UUID, TEXT, JSONB, INTEGER, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_test(UUID, UUID, UUID, TEXT, JSONB, INTEGER, UUID[]) TO service_role;
REVOKE EXECUTE ON FUNCTION public.apply_test_rewards(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.settle_classroom_battles(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.battle_phase(public.classroom_battles, TIMESTAMP WITH TIME ZONE) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_classroom_battle(UUID, UUID[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.join_classroom_battle(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.leave_classroom_battle(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.start_classroom_battle(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_classroom_battle(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.submit_battle_answer(UUID, INTEGER, JSONB) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_classroom_battle(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_classroom_battles(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_classroom_battle(UUID, UUID[]), public.join_classroom_battle(UUID),
  public.leave_classroom_battle(UUID), public.start_classroom_battle(UUID), public.cancel_classroom_battle(UUID),
  public.submit_battle_answer(UUID, INTEGER, JSONB), public.get_classroom_battle(UUID), public.get_classroom_battles(UUID)
  TO authenticated;

-- ================================================================
-- CLASS REP TOOLS — see migration 035
-- (pinned announcements, weekly goals, exam countdown)
-- ================================================================
-- ── 1. Pinned announcements ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.classroom_announcements (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  classroom_id UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  author_id    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  body         TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 500),
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_classroom_announcements_room ON public.classroom_announcements(classroom_id, created_at DESC);

ALTER TABLE public.classroom_announcements ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.classroom_announcements FROM anon, authenticated;
DROP POLICY IF EXISTS "classroom_announcements_select_member" ON public.classroom_announcements;
CREATE POLICY "classroom_announcements_select_member" ON public.classroom_announcements FOR SELECT
  USING (public.classroom_role(classroom_id) IS NOT NULL);

CREATE OR REPLACE FUNCTION public.pin_classroom_announcement(p_classroom UUID, p_body TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_id UUID;
BEGIN
  IF public.classroom_role(p_classroom) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF public.classroom_role(p_classroom) NOT IN ('owner', 'leader') THEN RAISE EXCEPTION 'leaders_only'; END IF;
  IF char_length(btrim(coalesce(p_body, ''))) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'bad_announcement'; END IF;
  -- Serialise pins per classroom so two leaders can't both slip in a 4th.
  PERFORM 1 FROM public.classrooms WHERE id = p_classroom FOR UPDATE;
  IF (SELECT count(*) FROM public.classroom_announcements WHERE classroom_id = p_classroom) >= 3 THEN
    RAISE EXCEPTION 'too_many_pins';
  END IF;
  INSERT INTO public.classroom_announcements (classroom_id, author_id, body)
  VALUES (p_classroom, auth.uid(), btrim(p_body)) RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.unpin_classroom_announcement(p_announcement UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  room UUID;
BEGIN
  SELECT classroom_id INTO room FROM public.classroom_announcements WHERE id = p_announcement;
  IF room IS NULL OR public.classroom_role(room) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF public.classroom_role(room) NOT IN ('owner', 'leader') THEN RAISE EXCEPTION 'leaders_only'; END IF;
  DELETE FROM public.classroom_announcements WHERE id = p_announcement;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'classroom_announcements') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.classroom_announcements;
  END IF;
END $$;

-- ── 2. Weekly goals ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.classroom_goals (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  classroom_id     UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  author_id        UUID REFERENCES public.users(id) ON DELETE SET NULL,
  topic_id         UUID REFERENCES public.topics(id) ON DELETE SET NULL,  -- NULL: any topic in the course
  target_questions INTEGER NOT NULL CHECK (target_questions BETWEEN 1 AND 500),
  due_date         DATE NOT NULL,
  -- Practice counts from this moment until the end of the due date.
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_classroom_goals_room ON public.classroom_goals(classroom_id, due_date DESC);

ALTER TABLE public.classroom_goals ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.classroom_goals FROM anon, authenticated;
DROP POLICY IF EXISTS "classroom_goals_select_member" ON public.classroom_goals;
CREATE POLICY "classroom_goals_select_member" ON public.classroom_goals FOR SELECT
  USING (public.classroom_role(classroom_id) IS NOT NULL);

CREATE OR REPLACE FUNCTION public.create_classroom_goal(p_classroom UUID, p_topic UUID, p_target INTEGER, p_due DATE)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_id UUID;
BEGIN
  IF public.classroom_role(p_classroom) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF public.classroom_role(p_classroom) NOT IN ('owner', 'leader') THEN RAISE EXCEPTION 'leaders_only'; END IF;
  IF p_target IS NULL OR p_target NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'bad_target'; END IF;
  IF p_due IS NULL OR p_due < CURRENT_DATE OR p_due > CURRENT_DATE + 60 THEN RAISE EXCEPTION 'bad_due_date'; END IF;
  IF p_topic IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.topics t JOIN public.classrooms c ON c.course_id = t.course_id
    WHERE t.id = p_topic AND c.id = p_classroom
  ) THEN
    RAISE EXCEPTION 'bad_topic';
  END IF;
  PERFORM 1 FROM public.classrooms WHERE id = p_classroom FOR UPDATE;
  IF (SELECT count(*) FROM public.classroom_goals WHERE classroom_id = p_classroom AND due_date >= CURRENT_DATE) >= 5 THEN
    RAISE EXCEPTION 'too_many_goals';
  END IF;
  INSERT INTO public.classroom_goals (classroom_id, author_id, topic_id, target_questions, due_date)
  VALUES (p_classroom, auth.uid(), p_topic, p_target, p_due) RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_classroom_goal(p_goal UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  room UUID;
BEGIN
  SELECT classroom_id INTO room FROM public.classroom_goals WHERE id = p_goal;
  IF room IS NULL OR public.classroom_role(room) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF public.classroom_role(room) NOT IN ('owner', 'leader') THEN RAISE EXCEPTION 'leaders_only'; END IF;
  DELETE FROM public.classroom_goals WHERE id = p_goal;
END;
$$;

-- Questions one member has answered toward one goal. Internal only.
CREATE OR REPLACE FUNCTION public.classroom_goal_count(
  p_user UUID, p_course UUID, p_topic UUID, p_from TIMESTAMP WITH TIME ZONE, p_due DATE
)
RETURNS INTEGER
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT count(*)::int
  FROM public.test_answers ta
  JOIN public.tests t ON t.id = ta.test_id
  LEFT JOIN public.questions q ON q.id = ta.question_id
  WHERE t.user_id = p_user AND t.course_id = p_course
    AND t.created_at >= p_from
    AND t.created_at < (p_due + 1)::timestamp AT TIME ZONE 'UTC'
    AND (p_topic IS NULL OR q.topic_id = p_topic);
$$;

-- The classroom's goals (current ones, then the last few finished), each
-- with my own progress and how many classmates who share have hit it.
CREATE OR REPLACE FUNCTION public.get_classroom_goals(p_classroom UUID)
RETURNS TABLE (
  id UUID, topic_id UUID, topic_name TEXT, target_questions INTEGER, due_date DATE, created_at TIMESTAMP WITH TIME ZONE,
  author_name TEXT, my_count INTEGER, done_count INTEGER, sharing_count INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
#variable_conflict use_column
DECLARE
  course UUID;
BEGIN
  IF auth.uid() IS NULL OR public.classroom_role(p_classroom) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  SELECT c.course_id INTO course FROM public.classrooms c WHERE c.id = p_classroom;
  RETURN QUERY
  SELECT g.id, g.topic_id, tp.topic_name, g.target_questions, g.due_date, g.created_at, au.full_name,
    public.classroom_goal_count(auth.uid(), course, g.topic_id, g.created_at, g.due_date),
    (SELECT count(*)::int FROM public.classroom_members m
     WHERE m.classroom_id = p_classroom AND (m.share_level <> 'hidden' OR m.user_id = auth.uid())
       AND public.classroom_goal_count(m.user_id, course, g.topic_id, g.created_at, g.due_date) >= g.target_questions),
    (SELECT count(*)::int FROM public.classroom_members m
     WHERE m.classroom_id = p_classroom AND (m.share_level <> 'hidden' OR m.user_id = auth.uid()))
  FROM (
    (SELECT * FROM public.classroom_goals x WHERE x.classroom_id = p_classroom AND x.due_date >= CURRENT_DATE)
    UNION ALL
    (SELECT * FROM public.classroom_goals x WHERE x.classroom_id = p_classroom AND x.due_date < CURRENT_DATE
     ORDER BY x.due_date DESC LIMIT 3)
  ) g
  LEFT JOIN public.topics tp ON tp.id = g.topic_id
  LEFT JOIN public.users au ON au.id = g.author_id
  ORDER BY (g.due_date < CURRENT_DATE), g.due_date, g.created_at;
END;
$$;

-- The leaders' checklist: every member against one goal. A private
-- member shows as a name with no number — to leaders too.
CREATE OR REPLACE FUNCTION public.get_classroom_goal_progress(p_goal UUID)
RETURNS TABLE (user_id UUID, full_name TEXT, avatar_url TEXT, is_me BOOLEAN, answered INTEGER, done BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
#variable_conflict use_column
DECLARE
  g public.classroom_goals%ROWTYPE;
  course UUID;
BEGIN
  SELECT * INTO g FROM public.classroom_goals x WHERE x.id = p_goal;
  IF g.id IS NULL OR auth.uid() IS NULL OR public.classroom_role(g.classroom_id) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF public.classroom_role(g.classroom_id) NOT IN ('owner', 'leader') THEN RAISE EXCEPTION 'leaders_only'; END IF;
  SELECT c.course_id INTO course FROM public.classrooms c WHERE c.id = g.classroom_id;
  RETURN QUERY
  SELECT m.user_id, u.full_name, u.avatar_url, m.user_id = auth.uid(),
    CASE WHEN v.visible THEN n.cnt END,
    CASE WHEN v.visible THEN n.cnt >= g.target_questions END
  FROM public.classroom_members m
  JOIN public.users u ON u.id = m.user_id
  CROSS JOIN LATERAL (SELECT (m.share_level <> 'hidden' OR m.user_id = auth.uid()) AS visible) v
  CROSS JOIN LATERAL (SELECT CASE WHEN v.visible THEN public.classroom_goal_count(m.user_id, course, g.topic_id, g.created_at, g.due_date) END AS cnt) n
  WHERE m.classroom_id = g.classroom_id
  ORDER BY (NOT v.visible), n.cnt DESC NULLS LAST, u.full_name;
END;
$$;

-- ── 3. Exam countdown ──────────────────────────────────────────────────
ALTER TABLE public.classrooms ADD COLUMN IF NOT EXISTS exam_date DATE;

CREATE OR REPLACE FUNCTION public.set_classroom_exam_date(p_classroom UUID, p_date DATE)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.classroom_role(p_classroom) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF public.classroom_role(p_classroom) NOT IN ('owner', 'leader') THEN RAISE EXCEPTION 'leaders_only'; END IF;
  IF p_date IS NOT NULL AND (p_date < CURRENT_DATE OR p_date > CURRENT_DATE + 365) THEN RAISE EXCEPTION 'bad_exam_date'; END IF;
  UPDATE public.classrooms SET exam_date = p_date WHERE id = p_classroom;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.classroom_goal_count(UUID, UUID, UUID, TIMESTAMP WITH TIME ZONE, DATE) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pin_classroom_announcement(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.unpin_classroom_announcement(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_classroom_goal(UUID, UUID, INTEGER, DATE) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_classroom_goal(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_classroom_goals(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_classroom_goal_progress(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_classroom_exam_date(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pin_classroom_announcement(UUID, TEXT), public.unpin_classroom_announcement(UUID),
  public.create_classroom_goal(UUID, UUID, INTEGER, DATE), public.delete_classroom_goal(UUID),
  public.get_classroom_goals(UUID), public.get_classroom_goal_progress(UUID), public.set_classroom_exam_date(UUID, DATE)
  TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ================================================================
-- GROUP PAYMENT THROUGH THE CLASS REP — see migration 036
-- (one Paystack checkout unlocks several classmates; receipts)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.classroom_group_payments (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference        TEXT NOT NULL UNIQUE,
  -- Payment records outlive the people and classrooms on them.
  payer_id         UUID REFERENCES public.users(id) ON DELETE SET NULL,
  classroom_id     UUID REFERENCES public.classrooms(id) ON DELETE SET NULL,
  classroom_name   TEXT NOT NULL,
  program_id       UUID NOT NULL,
  level            INTEGER NOT NULL,
  semester         INTEGER NOT NULL,
  student_ids      UUID[] NOT NULL,
  unit_amount      INTEGER NOT NULL CHECK (unit_amount > 0),
  full_unit_amount INTEGER NOT NULL CHECK (full_unit_amount >= unit_amount),
  deal             BOOLEAN NOT NULL DEFAULT false,
  total            INTEGER NOT NULL CHECK (total > 0),
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'problem')),
  amount_paid      INTEGER,
  covered          UUID[] NOT NULL DEFAULT '{}',
  -- Students who had unlocked by the time the money arrived: owed a refund.
  already_paid     UUID[] NOT NULL DEFAULT '{}',
  problem          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_group_payments_payer ON public.classroom_group_payments(payer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_payments_pending ON public.classroom_group_payments(classroom_id, created_at) WHERE status = 'pending';
ALTER TABLE public.classroom_group_payments ENABLE ROW LEVEL SECURITY;
-- Read through get_my_group_payments; written only by the functions below.
REVOKE ALL ON public.classroom_group_payments FROM anon, authenticated;

ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS group_payment_id UUID REFERENCES public.classroom_group_payments(id) ON DELETE SET NULL;

-- Has this student unlocked the classroom course's level (any programme
-- that has the course, the same rule as the class deal count)?
CREATE OR REPLACE FUNCTION public.group_pay_has_unlocked(p_user UUID, p_course UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    JOIN public.courses co ON co.id = p_course
    WHERE s.user_id = p_user AND s.status = 'active'
      AND s.level = co.level AND s.semester = co.semester
      AND s.program_id IN (SELECT cp.program_id FROM public.course_programs cp WHERE cp.course_id = co.id)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.group_pay_has_unlocked(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- Classmates the rep can pay for: members in the rep's programme (which
-- must have the classroom's course) who haven't unlocked yet. 'pending'
-- means another checkout started in the last 30 minutes covers them.
CREATE OR REPLACE FUNCTION public.group_pay_candidates(p_payer UUID, p_classroom UUID)
RETURNS TABLE (user_id UUID, full_name TEXT, avatar_url TEXT, is_me BOOLEAN, pending BOOLEAN)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT u.id, u.full_name, u.avatar_url, u.id = p_payer,
         EXISTS (SELECT 1 FROM public.classroom_group_payments g
                 WHERE g.classroom_id = p_classroom AND g.status = 'pending'
                   AND g.created_at > now() - interval '30 minutes' AND u.id = ANY (g.student_ids))
  FROM public.classroom_members m
  JOIN public.classrooms c ON c.id = m.classroom_id
  JOIN public.users u ON u.id = m.user_id
  JOIN public.users payer ON payer.id = p_payer
  WHERE m.classroom_id = p_classroom
    AND u.program_id = payer.program_id
    AND payer.program_id IN (SELECT cp.program_id FROM public.course_programs cp WHERE cp.course_id = c.course_id)
    AND NOT public.group_pay_has_unlocked(u.id, c.course_id)
  ORDER BY (u.id = p_payer) DESC, lower(coalesce(u.full_name, ''));
$$;
REVOKE EXECUTE ON FUNCTION public.group_pay_candidates(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.group_pay_check_rep(p_payer UUID, p_classroom UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE r TEXT;
BEGIN
  SELECT role INTO r FROM public.classroom_members WHERE classroom_id = p_classroom AND user_id = p_payer;
  IF r IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF r NOT IN ('owner', 'leader') THEN RAISE EXCEPTION 'leaders_only'; END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.group_pay_check_rep(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- For the rep's own screen: who can be paid for.
CREATE OR REPLACE FUNCTION public.get_group_payment_candidates(p_classroom UUID)
RETURNS TABLE (user_id UUID, full_name TEXT, avatar_url TEXT, is_me BOOLEAN, pending BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  PERFORM public.group_pay_check_rep(auth.uid(), p_classroom);
  RETURN QUERY SELECT * FROM public.group_pay_candidates(auth.uid(), p_classroom);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_group_payment_candidates(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_group_payment_candidates(UUID) TO authenticated;

-- Called by /api/payments/group/start (service role) after it has priced
-- one unlock for the rep's programme. Checks every student and records
-- the checkout; returns the reference and total to charge.
CREATE OR REPLACE FUNCTION public.create_group_payment(
  p_payer UUID, p_classroom UUID, p_students UUID[], p_unit_amount INTEGER, p_full_unit_amount INTEGER, p_deal BOOLEAN
)
RETURNS TABLE (reference TEXT, total INTEGER, student_count INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  room RECORD;
  payer_program UUID;
  wanted UUID[];
  ok_count INTEGER;
  ref TEXT;
BEGIN
  PERFORM public.group_pay_check_rep(p_payer, p_classroom);
  SELECT c.id, c.name, co.level, co.semester INTO room
  FROM public.classrooms c JOIN public.courses co ON co.id = c.course_id WHERE c.id = p_classroom;
  SELECT program_id INTO payer_program FROM public.users WHERE id = p_payer;
  IF payer_program IS NULL THEN RAISE EXCEPTION 'wrong_program'; END IF;

  SELECT array_agg(DISTINCT s) INTO wanted FROM unnest(p_students) s WHERE s IS NOT NULL;
  IF wanted IS NULL OR array_length(wanted, 1) = 0 THEN RAISE EXCEPTION 'no_students'; END IF;
  IF array_length(wanted, 1) > 50 THEN RAISE EXCEPTION 'too_many_students'; END IF;
  IF p_unit_amount IS NULL OR p_unit_amount <= 0 OR p_full_unit_amount < p_unit_amount THEN RAISE EXCEPTION 'bad_price'; END IF;

  -- Two reps (or two tabs) mustn't charge for the same classmate at once.
  PERFORM pg_advisory_xact_lock(hashtext('group_pay:' || p_classroom::text));

  SELECT count(*) INTO ok_count
  FROM public.group_pay_candidates(p_payer, p_classroom) c
  WHERE c.user_id = ANY (wanted) AND NOT c.pending;
  IF ok_count <> array_length(wanted, 1) THEN RAISE EXCEPTION 'student_not_eligible'; END IF;

  IF (SELECT count(*) FROM public.classroom_group_payments g
      WHERE g.payer_id = p_payer AND g.created_at > now() - interval '1 hour') >= 10 THEN
    RAISE EXCEPTION 'too_many_checkouts';
  END IF;

  ref := 'pastcs_grp_' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.classroom_group_payments
    (reference, payer_id, classroom_id, classroom_name, program_id, level, semester, student_ids,
     unit_amount, full_unit_amount, deal, total)
  VALUES (ref, p_payer, p_classroom, room.name, payer_program, room.level, room.semester, wanted,
          p_unit_amount, p_full_unit_amount, coalesce(p_deal, false), p_unit_amount * array_length(wanted, 1));
  RETURN QUERY SELECT ref, p_unit_amount * array_length(wanted, 1), array_length(wanted, 1);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_group_payment(UUID, UUID, UUID[], INTEGER, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_group_payment(UUID, UUID, UUID[], INTEGER, INTEGER, BOOLEAN) TO service_role;

-- Once Paystack confirms the charge (verify route or webhook, possibly
-- both, possibly more than once). Returns
--   {result: 'paid' | 'amount_mismatch' | 'not_found', covered, already_paid, payer_id}
-- 'amount_mismatch' is permanent: nothing is unlocked, and the row is
-- marked for support. Students who unlocked in the meantime are skipped
-- and listed in already_paid, so support can refund them.
CREATE OR REPLACE FUNCTION public.fulfil_group_payment(p_reference TEXT, p_amount INTEGER, p_currency TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g public.classroom_group_payments%ROWTYPE;
  sid UUID;
  got UUID[] := '{}';
  skipped UUID[] := '{}';
  payer_name TEXT;
  deal_room UUID;
BEGIN
  SELECT * INTO g FROM public.classroom_group_payments WHERE reference = p_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'not_found'); END IF;
  IF g.status = 'paid' THEN
    RETURN jsonb_build_object('result', 'paid', 'covered', to_jsonb(g.covered), 'already_paid', to_jsonb(g.already_paid), 'payer_id', g.payer_id, 'repeat', true);
  END IF;
  IF g.status = 'problem' THEN
    RETURN jsonb_build_object('result', 'amount_mismatch', 'payer_id', g.payer_id, 'repeat', true);
  END IF;

  -- The same rule as the single-student routes: GHS, and never less
  -- than what the server priced.
  IF coalesce(p_currency, '') <> 'GHS' OR p_amount IS NULL OR p_amount < g.total THEN
    UPDATE public.classroom_group_payments
    SET status = 'problem', amount_paid = p_amount,
        problem = format('amount_mismatch: charged %s %s, expected GHS %s', coalesce(p_amount::text, '?'), coalesce(p_currency, '?'), g.total)
    WHERE id = g.id;
    RETURN jsonb_build_object('result', 'amount_mismatch', 'payer_id', g.payer_id);
  END IF;

  deal_room := CASE WHEN g.deal THEN g.classroom_id END;
  FOREACH sid IN ARRAY g.student_ids LOOP
    IF EXISTS (SELECT 1 FROM public.subscriptions s
               WHERE s.user_id = sid AND s.status = 'active' AND s.level = g.level
                 AND s.semester = g.semester AND s.program_id = g.program_id) THEN
      skipped := skipped || sid;
      CONTINUE;
    END IF;
    INSERT INTO public.subscriptions
      (user_id, level, semester, program_id, payment_reference, amount, full_amount, deal_classroom_id, status, paid_at, group_payment_id)
    VALUES (sid, g.level, g.semester, g.program_id, g.reference || ':' || sid, g.unit_amount, g.full_unit_amount, deal_room, 'active', now(), g.id)
    ON CONFLICT (payment_reference) DO NOTHING;
    got := got || sid;
  END LOOP;

  SELECT coalesce(nullif(split_part(btrim(full_name), ' ', 1), ''), 'Your class rep') INTO payer_name
  FROM public.users WHERE id = g.payer_id;
  INSERT INTO public.notifications (user_id, type, message, link, meta)
  SELECT sid2, 'group_payment',
         coalesce(payer_name, 'Your class rep') || ' paid for your Level ' || g.level || ' unlock in ' || g.classroom_name
           || '. Every Level ' || g.level || ' course is open to you this semester.',
         CASE WHEN g.classroom_id IS NOT NULL THEN '/classrooms/' || g.classroom_id ELSE '/courses' END,
         jsonb_build_object('group_payment_id', g.id, 'classroom_id', g.classroom_id)
  FROM unnest(got) sid2
  WHERE sid2 IS DISTINCT FROM g.payer_id AND EXISTS (SELECT 1 FROM public.users WHERE id = sid2);

  UPDATE public.classroom_group_payments
  SET status = 'paid', paid_at = now(), amount_paid = p_amount, covered = got, already_paid = skipped,
      problem = CASE WHEN cardinality(skipped) > 0 THEN format('refund_due: %s student(s) had already unlocked, GHS %s each', cardinality(skipped), g.unit_amount) END
  WHERE id = g.id;
  RETURN jsonb_build_object('result', 'paid', 'covered', to_jsonb(got), 'already_paid', to_jsonb(skipped), 'payer_id', g.payer_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fulfil_group_payment(TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfil_group_payment(TEXT, INTEGER, TEXT) TO service_role;

-- The rep's receipts for one classroom (abandoned checkouts left out).
CREATE OR REPLACE FUNCTION public.get_my_group_payments(p_classroom UUID)
RETURNS TABLE (
  id UUID, reference TEXT, status TEXT, level INTEGER, semester INTEGER, unit_amount INTEGER,
  full_unit_amount INTEGER, deal BOOLEAN, total INTEGER, amount_paid INTEGER,
  created_at TIMESTAMPTZ, paid_at TIMESTAMPTZ, students JSONB
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT g.id, g.reference, g.status, g.level, g.semester, g.unit_amount, g.full_unit_amount, g.deal, g.total,
         g.amount_paid, g.created_at, g.paid_at,
         (SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'user_id', s,
                   'full_name', (SELECT u.full_name FROM public.users u WHERE u.id = s),
                   'state', CASE WHEN s = ANY (g.covered) THEN 'covered'
                                 WHEN s = ANY (g.already_paid) THEN 'already_paid'
                                 ELSE 'waiting' END) ORDER BY o), '[]'::jsonb)
          FROM unnest(g.student_ids) WITH ORDINALITY AS t(s, o))
  FROM public.classroom_group_payments g
  WHERE g.payer_id = auth.uid() AND g.classroom_id = p_classroom
    AND (g.status <> 'pending' OR g.created_at > now() - interval '1 day')
  ORDER BY g.created_at DESC
  LIMIT 20;
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_group_payments(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_group_payments(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ================================================================
-- CLASS DEAL REMOVED — see migration 037
-- ================================================================
-- Let members see how many classmates had paid, for the deal's progress bar.
DROP FUNCTION IF EXISTS public.get_class_deal(UUID);
-- Priced the deal for the payment routes.
DROP FUNCTION IF EXISTS public.class_deal_for(UUID, INTEGER, INTEGER);

NOTIFY pgrst, 'reload schema';

-- ================================================================
-- FREE-COURSE LIMITS — see migration 038
-- (first 2 topics open on free access; question reads; record_test)
-- ================================================================
-- ── 1. Who is on free access ─────────────────────────────────────────

-- Has this student paid for this course's level (in their programme, for
-- the current term)? Same subscription rule as course_access_for, which
-- returns 'free' before checking payment and so can't answer this.
CREATE OR REPLACE FUNCTION public.course_paid_for(p_user UUID, p_course UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.courses co ON co.id = p_course
    JOIN public.course_programs cp ON cp.course_id = co.id AND cp.program_id = u.program_id
    JOIN public.subscriptions s ON s.user_id = u.id AND s.status = 'active'
      AND s.level = co.level AND s.semester = co.semester AND s.program_id = u.program_id
    LEFT JOIN public.semester_end_dates t ON t.program_id = s.program_id AND t.semester = s.semester
    WHERE u.id = p_user
      AND (t.id IS NULL OR (
        now() < ((t.end_date + t.grace_days + 1)::timestamp AT TIME ZONE 'UTC')
        AND (t.start_date IS NULL OR s.paid_at IS NULL OR s.paid_at >= (t.start_date::timestamp AT TIME ZONE 'UTC'))
      ))
  );
$$;
REVOKE EXECUTE ON FUNCTION public.course_paid_for(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_free_access(p_user UUID, p_course UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u JOIN public.courses co ON co.id = p_course
    WHERE u.id = p_user
      AND u.role NOT IN ('admin', 'super_admin')
      AND u.free_course_code IS NOT NULL
      AND upper(u.free_course_code) = upper(co.course_code)
  ) AND NOT public.course_paid_for(p_user, p_course);
$$;
REVOKE EXECUTE ON FUNCTION public.is_free_access(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ── 2. The open topics ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.free_topic_ids(p_course UUID)
RETURNS SETOF UUID
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH names AS (
    SELECT lower(btrim(topic_name)) AS k, min(coalesce(order_index, 2147483647)) AS ord
    FROM public.topics WHERE course_id = p_course
    GROUP BY 1
    ORDER BY 2, 1
    LIMIT 2
  )
  SELECT t.id FROM public.topics t JOIN names n ON n.k = lower(btrim(t.topic_name))
  WHERE t.course_id = p_course;
$$;
REVOKE EXECUTE ON FUNCTION public.free_topic_ids(UUID) FROM PUBLIC, anon, authenticated;

-- ── 3. Who can read which questions ──────────────────────────────────
-- Uncorrelated set functions, so the policy below works each set out once
-- per query rather than once per question row.

-- Courses the caller has paid for (only their programme can be paid for).
CREATE OR REPLACE FUNCTION public.my_paid_course_ids()
RETURNS SETOF UUID
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT cp.course_id FROM public.course_programs cp
  JOIN public.users u ON u.id = auth.uid() AND u.program_id = cp.program_id
  WHERE public.course_paid_for(auth.uid(), cp.course_id);
$$;
REVOKE EXECUTE ON FUNCTION public.my_paid_course_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_paid_course_ids() TO authenticated;

-- The open topics of the caller's free course, if they're on free access
-- to it. (Paid for it: the whole course is in my_paid_course_ids.)
CREATE OR REPLACE FUNCTION public.my_free_topic_ids()
RETURNS SETOF UUID
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT f.id
  FROM public.users u
  JOIN public.courses co ON upper(co.course_code) = upper(u.free_course_code)
  CROSS JOIN LATERAL public.free_topic_ids(co.id) AS f(id)
  WHERE u.id = auth.uid() AND public.is_free_access(u.id, co.id);
$$;
REVOKE EXECUTE ON FUNCTION public.my_free_topic_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_free_topic_ids() TO authenticated;

-- Questions the caller has already answered: their results pages keep
-- working after a topic locks, and nothing new is revealed.
CREATE OR REPLACE FUNCTION public.my_answered_question_ids()
RETURNS SETOF UUID
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT DISTINCT a.question_id FROM public.test_answers a
  JOIN public.tests t ON t.id = a.test_id
  WHERE t.user_id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.my_answered_question_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_answered_question_ids() TO authenticated;

DROP POLICY IF EXISTS "questions_select_approved" ON public.questions;
DROP POLICY IF EXISTS "questions_select_open" ON public.questions;
CREATE POLICY "questions_select_open" ON public.questions FOR SELECT TO authenticated USING (
  is_approved AND (
    course_id IN (SELECT public.my_paid_course_ids())
    OR topic_id IN (SELECT public.my_free_topic_ids())
    OR id IN (SELECT public.my_answered_question_ids())
  )
);

-- ── 4. Saving a test ─────────────────────────────────────────────────
-- As in migration 034, plus: on free access, every question must be in
-- an open topic.
CREATE OR REPLACE FUNCTION public.record_test(
  p_user UUID, p_course UUID, p_topic UUID, p_type TEXT, p_answers JSONB,
  p_time_taken INTEGER DEFAULT NULL, p_fill_ok UUID[] DEFAULT '{}'
)
RETURNS TABLE (test_id UUID, score INTEGER, total INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  n INTEGER;
  matched INTEGER;
  got INTEGER;
  new_id UUID;
  pct NUMERIC;
  topic UUID := p_topic;
BEGIN
  IF p_type NOT IN ('practice', 'exam_simulation') THEN RAISE EXCEPTION 'bad_type'; END IF;
  IF coalesce(public.course_access_for(p_user, p_course), '') NOT IN ('free', 'paid')
     AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user AND role IN ('admin', 'super_admin')) THEN
    RAISE EXCEPTION 'payment_required';
  END IF;
  IF jsonb_typeof(p_answers) <> 'array' THEN RAISE EXCEPTION 'bad_answers'; END IF;
  n := jsonb_array_length(p_answers);
  IF n < 1 OR n > 100 THEN RAISE EXCEPTION 'bad_answers'; END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.submitted (
    question_id UUID, selected JSONB, confidence TEXT, is_correct BOOLEAN
  ) ON COMMIT DROP;
  DELETE FROM pg_temp.submitted;
  INSERT INTO pg_temp.submitted (question_id, selected, confidence)
  SELECT (e->>'question_id')::uuid,
         CASE WHEN jsonb_typeof(e->'selected') = 'array' AND jsonb_array_length(e->'selected') <= 10
              THEN e->'selected' ELSE '[]'::jsonb END,
         CASE WHEN e->>'confidence' IN ('sure', 'unsure') THEN e->>'confidence' END
  FROM jsonb_array_elements(p_answers) e;

  -- Every question once, approved, and from this course.
  SELECT count(DISTINCT s.question_id) INTO matched
  FROM pg_temp.submitted s
  JOIN public.questions q ON q.id = s.question_id AND q.course_id = p_course AND q.is_approved;
  IF matched <> n THEN RAISE EXCEPTION 'bad_questions'; END IF;

  -- Free access: only the open topics count.
  IF public.is_free_access(p_user, p_course) AND EXISTS (
    SELECT 1 FROM pg_temp.submitted s JOIN public.questions q ON q.id = s.question_id
    WHERE q.topic_id IS NULL OR q.topic_id NOT IN (SELECT public.free_topic_ids(p_course))
  ) THEN
    RAISE EXCEPTION 'topic_locked';
  END IF;

  UPDATE pg_temp.submitted s SET is_correct = CASE
      WHEN q.question_type = 'fill_in_blank' THEN
        q.id = ANY (coalesce(p_fill_ok, '{}'))
        OR (public.norm_answer(s.selected->>0) <> '' AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(q.correct_answers) ca
          WHERE public.norm_answer(ca) = public.norm_answer(s.selected->>0)))
      ELSE public.options_match(s.selected, q.correct_answers)
    END
  FROM public.questions q WHERE q.id = s.question_id;

  SELECT count(*) FILTER (WHERE s.is_correct) INTO got FROM pg_temp.submitted s;
  pct := round(got::NUMERIC * 100 / n, 2);
  -- A deleted topic shouldn't fail the save.
  IF topic IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.topics t WHERE t.id = topic AND t.course_id = p_course) THEN
    topic := NULL;
  END IF;

  INSERT INTO public.tests (user_id, course_id, topic_id, test_type, score, total_questions, percentage, time_taken, completed_at)
  VALUES (p_user, p_course, topic, p_type, got, n, pct,
          CASE WHEN p_time_taken BETWEEN 0 AND 86400 THEN p_time_taken END, now())
  RETURNING id INTO new_id;

  INSERT INTO public.test_answers (test_id, question_id, selected_answer, is_correct, confidence)
  SELECT new_id, s.question_id, s.selected, s.is_correct, s.confidence FROM pg_temp.submitted s;

  PERFORM public.apply_test_rewards(p_user, got * 10 + CASE WHEN p_type = 'exam_simulation' AND pct >= 70 THEN 50 ELSE 0 END);

  RETURN QUERY SELECT new_id, got, n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_test(UUID, UUID, UUID, TEXT, JSONB, INTEGER, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_test(UUID, UUID, UUID, TEXT, JSONB, INTEGER, UUID[]) TO service_role;

-- ── 5. What the pages show ───────────────────────────────────────────
-- {access: 'full' | 'free' | 'locked', open_topic_ids: [...]}
-- 'full': paid (or admin); 'free': free access, only open_topic_ids;
-- 'locked': neither.
CREATE OR REPLACE FUNCTION public.get_course_access(p_course UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id = uid AND role IN ('admin', 'super_admin'))
     OR public.course_paid_for(uid, p_course) THEN
    RETURN jsonb_build_object('access', 'full', 'open_topic_ids', '[]'::jsonb);
  END IF;
  IF public.is_free_access(uid, p_course) THEN
    RETURN jsonb_build_object('access', 'free',
      'open_topic_ids', coalesce((SELECT jsonb_agg(id) FROM public.free_topic_ids(p_course) AS f(id)), '[]'::jsonb));
  END IF;
  RETURN jsonb_build_object('access', 'locked', 'open_topic_ids', '[]'::jsonb);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_course_access(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_access(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ================================================================
-- CLASSROOM LIMITS ON FREE ACCESS — see migration 039
-- (2 battles, 5 messages, 2 call joins; secret call rooms)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.classroom_free_usage (
  classroom_id UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('message', 'call')),
  ref_id       UUID NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (classroom_id, user_id, kind, ref_id)
);
ALTER TABLE public.classroom_free_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.classroom_free_usage FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.classroom_call_rooms (
  classroom_id UUID PRIMARY KEY REFERENCES public.classrooms(id) ON DELETE CASCADE,
  room         TEXT NOT NULL
);
ALTER TABLE public.classroom_call_rooms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.classroom_call_rooms FROM anon, authenticated;

-- Is this student on free access to this classroom's course?
CREATE OR REPLACE FUNCTION public.classroom_free_access(p_user UUID, p_classroom UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT coalesce((SELECT public.is_free_access(p_user, c.course_id) FROM public.classrooms c WHERE c.id = p_classroom), false);
$$;
REVOKE EXECUTE ON FUNCTION public.classroom_free_access(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- Battles this student has played (or is in) in a classroom.
CREATE OR REPLACE FUNCTION public.classroom_battles_used(p_user UUID, p_classroom UUID, p_except UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT count(*)::int FROM public.classroom_battle_players pl
  JOIN public.classroom_battles b ON b.id = pl.battle_id
  WHERE pl.user_id = p_user AND b.classroom_id = p_classroom AND b.status <> 'cancelled'
    AND (p_except IS NULL OR b.id <> p_except);
$$;
REVOKE EXECUTE ON FUNCTION public.classroom_battles_used(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ── Battles ──────────────────────────────────────────────────────────
-- Every way into a battle (starting one or joining a lobby) inserts a
-- player row, so the limit lives here.
CREATE OR REPLACE FUNCTION public.classroom_battle_players_free_limit()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b public.classroom_battles%ROWTYPE;
BEGIN
  SELECT * INTO b FROM public.classroom_battles WHERE id = NEW.battle_id;
  IF b.id IS NULL OR NOT public.is_free_access(NEW.user_id, b.course_id) THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM public.classroom_battle_questions bq JOIN public.questions q ON q.id = bq.question_id
    WHERE bq.battle_id = b.id
      AND (q.topic_id IS NULL OR q.topic_id NOT IN (SELECT public.free_topic_ids(b.course_id)))
  ) THEN
    RAISE EXCEPTION 'battle_topics_locked';
  END IF;
  IF public.classroom_battles_used(NEW.user_id, b.classroom_id, b.id) >= 2 THEN
    RAISE EXCEPTION 'free_limit_battles';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS classroom_battle_players_free_limit ON public.classroom_battle_players;
CREATE TRIGGER classroom_battle_players_free_limit BEFORE INSERT ON public.classroom_battle_players
  FOR EACH ROW EXECUTE FUNCTION public.classroom_battle_players_free_limit();

-- As in migration 034, plus: a host on free access gets the open topics
-- when they pick none, and can't pick locked ones.
CREATE OR REPLACE FUNCTION public.create_classroom_battle(p_classroom UUID, p_topic_ids UUID[] DEFAULT '{}')
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me UUID := auth.uid();
  room public.classrooms%ROWTYPE;
  topics UUID[] := coalesce(p_topic_ids, '{}');
  new_id UUID;
  picked INTEGER;
  first_name TEXT;
BEGIN
  IF me IS NULL OR public.classroom_role(p_classroom) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  SELECT * INTO room FROM public.classrooms WHERE id = p_classroom;
  IF coalesce(public.course_access_for(me, room.course_id), '') NOT IN ('free', 'paid') THEN RAISE EXCEPTION 'payment_required'; END IF;

  PERFORM public.settle_classroom_battles(p_classroom);
  IF EXISTS (SELECT 1 FROM public.classroom_battles WHERE classroom_id = p_classroom AND status IN ('lobby', 'live')) THEN
    RAISE EXCEPTION 'battle_in_progress';
  END IF;
  IF (SELECT count(*) FROM public.classroom_battles WHERE classroom_id = p_classroom AND host_id = me
      AND created_at > now() - INTERVAL '1 hour') >= 6 THEN
    RAISE EXCEPTION 'slow_down';
  END IF;
  IF cardinality(topics) > 20 OR EXISTS (
    SELECT 1 FROM unnest(topics) t(id) WHERE NOT EXISTS (SELECT 1 FROM public.topics tp WHERE tp.id = t.id AND tp.course_id = room.course_id)
  ) THEN
    RAISE EXCEPTION 'bad_topic';
  END IF;

  IF public.is_free_access(me, room.course_id) THEN
    IF public.classroom_battles_used(me, p_classroom) >= 2 THEN RAISE EXCEPTION 'free_limit_battles'; END IF;
    IF cardinality(topics) = 0 THEN
      topics := ARRAY(SELECT public.free_topic_ids(room.course_id));
    ELSIF EXISTS (SELECT 1 FROM unnest(topics) t(id) WHERE t.id NOT IN (SELECT public.free_topic_ids(room.course_id))) THEN
      RAISE EXCEPTION 'battle_topics_locked';
    END IF;
  END IF;

  INSERT INTO public.classroom_battles (classroom_id, host_id, course_id, topic_ids, question_count)
  VALUES (p_classroom, me, room.course_id, topics, 0) RETURNING id INTO new_id;

  INSERT INTO public.classroom_battle_questions (battle_id, idx, question_id)
  SELECT new_id, (row_number() OVER () - 1)::int, q.id FROM (
    SELECT q.id FROM public.questions q
    WHERE q.course_id = room.course_id AND q.is_approved
      AND q.question_type IN ('single_choice', 'multiple_choice')
      AND jsonb_typeof(q.options) = 'array' AND jsonb_array_length(q.options) >= 2
      AND jsonb_typeof(q.correct_answers) = 'array' AND jsonb_array_length(q.correct_answers) >= 1
      AND (cardinality(topics) = 0 OR q.topic_id = ANY (topics))
    ORDER BY random() LIMIT 10
  ) q;
  GET DIAGNOSTICS picked = ROW_COUNT;
  IF picked < 5 THEN RAISE EXCEPTION 'not_enough_questions'; END IF;
  UPDATE public.classroom_battles SET question_count = picked WHERE id = new_id;

  INSERT INTO public.classroom_battle_players (battle_id, user_id) VALUES (new_id, me);

  SELECT split_part(coalesce(nullif(btrim(full_name), ''), 'A classmate'), ' ', 1) INTO first_name FROM public.users WHERE id = me;
  PERFORM set_config('pastcs.battle_post', 'on', true);
  INSERT INTO public.classroom_messages (classroom_id, user_id, kind, body, meta)
  VALUES (p_classroom, me, 'battle', first_name || ' started a battle: ' || picked || ' questions. Join the lobby!',
          jsonb_build_object('battle_id', new_id));
  PERFORM set_config('pastcs.battle_post', '', true);
  RETURN new_id;
END;
$$;

-- ── Messages, and call messages ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.classroom_messages_free_limit()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.kind = 'call' THEN
    -- Only join_classroom_call posts calls, and the link never goes in
    -- the message: members would read it and join without counting.
    IF coalesce(current_setting('pastcs.call_post', true), '') <> 'on' THEN RAISE EXCEPTION 'use_join_call'; END IF;
    NEW.meta := coalesce(NEW.meta, '{}'::jsonb) - 'url';
  ELSIF NEW.kind = 'text' AND public.classroom_free_access(NEW.user_id, NEW.classroom_id) THEN
    IF (SELECT count(*) FROM public.classroom_free_usage
        WHERE classroom_id = NEW.classroom_id AND user_id = NEW.user_id AND kind = 'message') >= 5 THEN
      RAISE EXCEPTION 'free_limit_messages';
    END IF;
    INSERT INTO public.classroom_free_usage (classroom_id, user_id, kind, ref_id)
    VALUES (NEW.classroom_id, NEW.user_id, 'message', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS classroom_messages_free_limit ON public.classroom_messages;
CREATE TRIGGER classroom_messages_free_limit BEFORE INSERT ON public.classroom_messages
  FOR EACH ROW EXECUTE FUNCTION public.classroom_messages_free_limit();

-- ── Calls ────────────────────────────────────────────────────────────
-- Start a call (p_start) or join the one in progress. Returns
-- {url, message_id}. A call stays joinable for 2 hours, or until someone
-- ends it — the same window the chat shows "Call in progress" for.
CREATE OR REPLACE FUNCTION public.join_classroom_call(p_classroom UUID, p_start BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me UUID := auth.uid();
  live UUID;
  secret TEXT;
  first_name TEXT;
  is_free BOOLEAN;
BEGIN
  IF me IS NULL OR public.classroom_role(p_classroom) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;

  SELECT m.id INTO live FROM public.classroom_messages m
  WHERE m.classroom_id = p_classroom AND m.kind = 'call' AND m.created_at > now() - interval '2 hours'
    AND NOT EXISTS (SELECT 1 FROM public.classroom_messages e
                    WHERE e.classroom_id = p_classroom AND e.kind = 'call_end' AND e.created_at > m.created_at)
  ORDER BY m.created_at DESC LIMIT 1;
  IF live IS NULL AND NOT coalesce(p_start, false) THEN RAISE EXCEPTION 'no_call'; END IF;

  is_free := public.classroom_free_access(me, p_classroom);
  -- Checked before posting, so a student at the limit can't ring everyone.
  IF is_free AND NOT EXISTS (
       SELECT 1 FROM public.classroom_free_usage
       WHERE classroom_id = p_classroom AND user_id = me AND kind = 'call' AND ref_id = live)
     AND (SELECT count(*) FROM public.classroom_free_usage
          WHERE classroom_id = p_classroom AND user_id = me AND kind = 'call') >= 2 THEN
    RAISE EXCEPTION 'free_limit_calls';
  END IF;

  IF live IS NULL THEN
    SELECT split_part(coalesce(nullif(btrim(full_name), ''), 'A classmate'), ' ', 1) INTO first_name FROM public.users WHERE id = me;
    PERFORM set_config('pastcs.call_post', 'on', true);
    INSERT INTO public.classroom_messages (classroom_id, user_id, kind, body, meta)
    VALUES (p_classroom, me, 'call', first_name || ' started a video call', '{}'::jsonb)
    RETURNING id INTO live;
    PERFORM set_config('pastcs.call_post', '', true);
  END IF;

  IF is_free THEN
    INSERT INTO public.classroom_free_usage (classroom_id, user_id, kind, ref_id)
    VALUES (p_classroom, me, 'call', live) ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.classroom_call_rooms (classroom_id, room)
  VALUES (p_classroom, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
  ON CONFLICT (classroom_id) DO NOTHING;
  SELECT room INTO secret FROM public.classroom_call_rooms WHERE classroom_id = p_classroom;

  RETURN jsonb_build_object('url', 'https://meet.jit.si/PastCS-' || secret, 'message_id', live);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.join_classroom_call(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_classroom_call(UUID, BOOLEAN) TO authenticated;

-- ── What the classroom page shows ────────────────────────────────────
-- {free: bool, messages|battles|calls: {used, limit}}
CREATE OR REPLACE FUNCTION public.get_my_classroom_limits(p_classroom UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE me UUID := auth.uid();
BEGIN
  IF me IS NULL OR public.classroom_role(p_classroom) IS NULL THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF NOT public.classroom_free_access(me, p_classroom) THEN RETURN jsonb_build_object('free', false); END IF;
  RETURN jsonb_build_object(
    'free', true,
    'messages', jsonb_build_object('limit', 5, 'used',
      (SELECT count(*) FROM public.classroom_free_usage WHERE classroom_id = p_classroom AND user_id = me AND kind = 'message')),
    'battles', jsonb_build_object('limit', 2, 'used', public.classroom_battles_used(me, p_classroom)),
    'calls', jsonb_build_object('limit', 2, 'used',
      (SELECT count(*) FROM public.classroom_free_usage WHERE classroom_id = p_classroom AND user_id = me AND kind = 'call'))
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_classroom_limits(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_classroom_limits(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ================================================================
-- LEADERBOARDS BY COURSE, LEVEL AND EVERYONE — see migration 040
-- ================================================================
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS leaderboard_visible BOOLEAN NOT NULL DEFAULT true;

-- The old board is no longer used by the app.
REVOKE EXECUTE ON FUNCTION public.get_leaderboard(UUID, INTEGER) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_leaderboard_visible(p_visible BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  UPDATE public.users SET leaderboard_visible = coalesce(p_visible, true) WHERE id = auth.uid();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_leaderboard_visible(BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_leaderboard_visible(BOOLEAN) TO authenticated;

-- p_scope: 'course' (needs p_course), 'level' or 'general'.
-- p_period: 'week' (since Monday) or 'all'.
CREATE OR REPLACE FUNCTION public.get_leaderboard_board(
  p_scope TEXT, p_course UUID DEFAULT NULL, p_period TEXT DEFAULT 'week', p_limit INTEGER DEFAULT 25
)
RETURNS TABLE (rank INTEGER, user_id UUID, first_name TEXT, avatar_url TEXT, points BIGINT, tests BIGINT, accuracy NUMERIC, is_me BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
#variable_conflict use_column
DECLARE
  me UUID := auth.uid();
  u public.users%ROWTYPE;
  since TIMESTAMPTZ;
  lim INTEGER := least(greatest(coalesce(p_limit, 25), 1), 100);
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF p_scope NOT IN ('course', 'level', 'general') THEN RAISE EXCEPTION 'bad_scope'; END IF;
  IF p_scope = 'course' AND NOT EXISTS (SELECT 1 FROM public.courses WHERE id = p_course) THEN RAISE EXCEPTION 'bad_course'; END IF;
  SELECT * INTO u FROM public.users WHERE id = me;
  since := CASE WHEN p_period = 'all' THEN '-infinity'::timestamptz ELSE date_trunc('week', now()) END;

  RETURN QUERY
  WITH scoped AS (
    SELECT t.user_id, t.score, t.total_questions
    FROM public.tests t
    JOIN public.courses co ON co.id = t.course_id
    WHERE t.created_at >= since
      AND CASE p_scope
            WHEN 'course' THEN t.course_id = p_course
            WHEN 'level' THEN co.level = u.selected_level AND co.semester = u.selected_semester
              AND EXISTS (SELECT 1 FROM public.course_programs cp WHERE cp.course_id = co.id AND cp.program_id = u.program_id)
            ELSE true
          END
  ),
  totals AS (
    SELECT s.user_id, sum(s.score)::BIGINT AS points, count(*)::BIGINT AS tests,
           round(sum(s.score)::NUMERIC * 100 / nullif(sum(s.total_questions), 0), 1) AS accuracy
    FROM scoped s
    JOIN public.users x ON x.id = s.user_id
    WHERE x.role = 'student' AND NOT x.is_suspended
      AND (x.leaderboard_visible OR x.id = me)
    GROUP BY s.user_id
  ),
  ranked AS (
    SELECT rank() OVER (ORDER BY t.points DESC, t.accuracy DESC NULLS LAST)::INTEGER AS rnk, t.*
    FROM totals t
  )
  SELECT r.rnk, r.user_id,
         coalesce(nullif(split_part(btrim(x.full_name), ' ', 1), ''), 'Student'),
         x.avatar_url, r.points, r.tests, r.accuracy, r.user_id = me
  FROM ranked r JOIN public.users x ON x.id = r.user_id
  WHERE r.rnk <= lim OR r.user_id = me
  ORDER BY r.rnk, r.user_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_leaderboard_board(TEXT, UUID, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_board(TEXT, UUID, TEXT, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ================================================================
-- ACCURATE, ONCE-ONLY REMINDERS — see migration 041
-- ================================================================
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS link TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

-- ── Clean-up of what the old code wrote ──────────────────────────────
DELETE FROM public.notifications WHERE type IN ('streak_risk', 'inactivity') AND dedupe_key IS NULL;
UPDATE public.notifications SET dedupe_key = 'milestone:' || CASE
    WHEN message LIKE '%first test%' THEN '1'
    WHEN message LIKE '%10 tests%' THEN '10'
    WHEN message LIKE '%25 tests%' THEN '25'
    WHEN message LIKE '%50 tests%' THEN '50'
    WHEN message LIKE '%100 tests%' THEN '100'
  END
WHERE type = 'milestone' AND dedupe_key IS NULL
  AND (message LIKE '%first test%' OR message ~ '(10|25|50|100) tests');
DELETE FROM public.notifications n
USING public.notifications keep
WHERE n.type = 'milestone' AND keep.type = 'milestone'
  AND n.user_id = keep.user_id AND n.dedupe_key = keep.dedupe_key
  AND (n.created_at, n.id) > (keep.created_at, keep.id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe ON public.notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

DROP POLICY IF EXISTS "notifications_insert_own" ON public.notifications;

-- ── The reminders ────────────────────────────────────────────────────
-- Returns how many new reminders were created. Dates are the database's
-- (UTC, which is Ghana time).
CREATE OR REPLACE FUNCTION public.generate_my_reminders()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me UUID := auth.uid();
  u public.users%ROWTYPE;
  last_test DATE;
  gap INTEGER;
  m INTEGER;
  made INTEGER := 0;
  n INTEGER;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT * INTO u FROM public.users WHERE id = me;
  IF u.id IS NULL OR u.role <> 'student' THEN RETURN 0; END IF;

  -- 1. Streak. Practised yesterday but not yet today: still savable.
  IF u.last_practice_date = CURRENT_DATE - 1 AND u.practice_streak >= 2 THEN
    INSERT INTO public.notifications (user_id, type, message, link, dedupe_key)
    VALUES (me, 'streak_risk',
            '🔥 Keep your ' || u.practice_streak || '-day streak going: practise today before midnight.',
            '/courses', 'streak_risk:' || CURRENT_DATE)
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; made := made + n;
  -- Missed a day: the streak is already gone. Say so once, and stop
  -- showing it as alive.
  ELSIF u.last_practice_date < CURRENT_DATE - 1 AND u.practice_streak > 0 THEN
    IF u.practice_streak >= 3 THEN
      INSERT INTO public.notifications (user_id, type, message, link, dedupe_key)
      VALUES (me, 'streak_lost',
              'Your ' || u.practice_streak || '-day streak ended. One quiz today starts a new one.',
              '/courses', 'streak_lost:' || u.last_practice_date)
      ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
      GET DIAGNOSTICS n = ROW_COUNT; made := made + n;
    END IF;
    UPDATE public.users SET practice_streak = 0 WHERE id = me;
  END IF;

  -- 2. Time away: one reminder per absence, after a week.
  SELECT max(created_at)::date INTO last_test FROM public.tests WHERE user_id = me;
  IF last_test IS NOT NULL THEN
    gap := CURRENT_DATE - last_test;
    IF gap >= 7 THEN
      INSERT INTO public.notifications (user_id, type, message, link, dedupe_key)
      VALUES (me, 'inactivity',
              CASE WHEN gap > 60
                THEN '📚 It’s been a while since your last quiz. A quick 10-question session gets you back on track.'
                ELSE '📚 It’s been ' || gap || ' days since your last quiz. A quick 10-question session gets you back on track.'
              END,
              '/courses', 'inactivity:' || last_test)
      ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
      GET DIAGNOSTICS n = ROW_COUNT; made := made + n;
    END IF;
  ELSIF u.created_at < now() - interval '2 days' THEN
    INSERT INTO public.notifications (user_id, type, message, link, dedupe_key)
    VALUES (me, 'inactivity', '📚 Try your first quiz: 10 questions, about 5 minutes.', '/courses', 'first_quiz')
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; made := made + n;
  END IF;

  -- 3. Milestones: the highest one reached, once.
  SELECT max(x) INTO m FROM unnest(ARRAY[1, 10, 25, 50, 100]) x WHERE x <= u.total_tests_taken;
  IF m IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, message, link, dedupe_key)
    VALUES (me, 'milestone', CASE m
              WHEN 1 THEN '🎉 You completed your first test. Great start!'
              WHEN 10 THEN '⚡ 10 tests completed. You’re building real momentum.'
              WHEN 25 THEN '🏆 25 tests done. You’re well on your way to exam readiness.'
              WHEN 50 THEN '🔥 50 tests completed. That’s serious commitment.'
              ELSE '👑 100 tests. Exams don’t stand a chance.'
            END,
            '/leaderboard?tab=achievements', 'milestone:' || m)
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; made := made + n;
  END IF;

  RETURN made;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.generate_my_reminders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_my_reminders() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ================================================================
-- THE GRADE LADDER — see migration 042
-- ================================================================
ALTER TABLE public.tests DROP CONSTRAINT IF EXISTS tests_test_type_check;
ALTER TABLE public.tests ADD CONSTRAINT tests_test_type_check
  CHECK (test_type IN ('practice', 'exam_simulation', 'battle', 'climb'));

CREATE TABLE IF NOT EXISTS public.course_grades (
  user_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id      UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  stage          SMALLINT NOT NULL DEFAULT 0 CHECK (stage BETWEEN 0 AND 8),
  bar            INTEGER NOT NULL DEFAULT 0 CHECK (bar >= 0),
  best_stage     SMALLINT NOT NULL DEFAULT 0 CHECK (best_stage BETWEEN 0 AND 8),
  slipping_since TIMESTAMPTZ,
  promoted_at    TIMESTAMPTZ,
  dropped_at     TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id)
);
ALTER TABLE public.course_grades ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_grades FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.grade_events (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id  UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  test_id    UUID REFERENCES public.tests(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('promote', 'warn', 'clear', 'drop', 'capped')),
  from_stage SMALLINT NOT NULL,
  to_stage   SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_grade_events_user ON public.grade_events(user_id, course_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_grade_events_test ON public.grade_events(test_id);
ALTER TABLE public.grade_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.grade_events FROM anon, authenticated;

INSERT INTO public.achievements (name, description, icon, criteria) VALUES
  ('First C', 'Reach C in any course', 'medal', '{"type":"grade","value":4}'),
  ('Straight A', 'Reach A in any course', 'crown', '{"type":"grade","value":8}'),
  ('Top of the Class', 'Reach A in every course of a semester', 'trophy', '{"type":"grade_all","value":8}')
ON CONFLICT (name) DO NOTHING;

-- ── Rules ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.grade_label(p_stage INTEGER)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT (ARRAY['F', 'E', 'D', 'D+', 'C', 'C+', 'B', 'B+', 'A'])[p_stage + 1];
$$;

-- Correct answers to fill the bar for grade p_stage (1 … 8).
CREATE OR REPLACE FUNCTION public.grade_bar_needed(p_stage INTEGER)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT (ARRAY[8, 10, 12, 14, 16, 18, 20, 25])[p_stage];
$$;

-- The counted answers, oldest first, as of p_upto.
CREATE OR REPLACE FUNCTION public.ladder_answers(p_user UUID, p_course UUID, p_upto TIMESTAMPTZ DEFAULT now())
RETURNS TABLE (answer_id UUID, test_id UUID, at TIMESTAMPTZ, question_id UUID, topic_key TEXT, correct BOOLEAN)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH a AS (
    SELECT ta.id AS aid, t.id AS tid, t.created_at AS ts, ta.question_id AS qid,
           lower(btrim(tp.topic_name)) AS tkey, t.test_type AS ttype,
           (ta.selected_answer IS NULL OR ta.selected_answer = '[]'::jsonb OR ta.selected_answer = '[""]'::jsonb) AS blank,
           ta.is_correct AS raw_ok
    FROM public.test_answers ta
    JOIN public.tests t ON t.id = ta.test_id
    JOIN public.questions q ON q.id = ta.question_id
    LEFT JOIN public.topics tp ON tp.id = q.topic_id
    WHERE t.user_id = p_user AND t.course_id = p_course
      AND t.test_type IN ('practice', 'exam_simulation', 'climb') AND t.created_at <= p_upto
  ), b AS (
    SELECT a.*, (a.raw_ok AND NOT a.blank) AS ok FROM a
  )
  SELECT b.aid, b.tid, b.ts, b.qid, b.tkey, b.ok FROM b
  WHERE NOT (b.blank AND b.ttype <> 'climb')
    AND NOT (b.ok AND EXISTS (
      SELECT 1 FROM b e WHERE e.qid = b.qid AND e.ts < b.ts AND (
        (e.ok AND e.ts > b.ts - interval '7 days')
        OR (NOT e.ok AND NOT e.blank AND e.ts > b.ts - interval '1 day'))))
  ORDER BY b.ts, b.aid;
$$;
REVOKE EXECUTE ON FUNCTION public.ladder_answers(UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- A course's topics that can be practised (5+ approved questions),
-- duplicate topic rows grouped by name.
CREATE OR REPLACE FUNCTION public.ladder_topics(p_course UUID)
RETURNS TABLE (topic_key TEXT, first_order INTEGER)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT lower(btrim(tp.topic_name)), min(coalesce(tp.order_index, 2147483647))::int
  FROM public.topics tp JOIN public.questions q ON q.topic_id = tp.id AND q.is_approved
  WHERE tp.course_id = p_course
  GROUP BY 1 HAVING count(DISTINCT q.id) >= 5;
$$;
REVOKE EXECUTE ON FUNCTION public.ladder_topics(UUID) FROM PUBLIC, anon, authenticated;

-- Accuracy, coverage and the mock exam, as of p_upto.
CREATE OR REPLACE FUNCTION public.ladder_stats(p_user UUID, p_course UUID, p_upto TIMESTAMPTZ DEFAULT now())
RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH la AS (SELECT * FROM public.ladder_answers(p_user, p_course, p_upto)),
  last30 AS (SELECT correct FROM la ORDER BY at DESC, answer_id DESC LIMIT 30),
  per AS (
    SELECT t.topic_key, count(la.answer_id) AS n, avg(la.correct::int) AS acc
    FROM public.ladder_topics(p_course) t LEFT JOIN la ON la.topic_key = t.topic_key
    GROUP BY t.topic_key
  )
  SELECT jsonb_build_object(
    'acc30', (SELECT round(100.0 * avg(correct::int), 1) FROM last30),
    'n30', (SELECT count(*) FROM last30),
    'total', (SELECT count(*) FROM la),
    'topics_total', (SELECT count(*) FROM per),
    'practised', (SELECT count(*) FROM per WHERE n >= 5),
    'at50', (SELECT count(*) FROM per WHERE n >= 5 AND acc >= 0.5),
    'at60', (SELECT count(*) FROM per WHERE n >= 5 AND acc >= 0.6),
    'mock70', EXISTS (SELECT 1 FROM public.tests t WHERE t.user_id = p_user AND t.course_id = p_course
                      AND t.test_type = 'exam_simulation' AND t.percentage >= 70
                      AND t.created_at <= p_upto AND t.created_at > p_upto - interval '30 days')
  );
$$;
REVOKE EXECUTE ON FUNCTION public.ladder_stats(UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- Coverage for grade p_stage: what's needed, and of which kind.
CREATE OR REPLACE FUNCTION public.ladder_coverage(p_stats JSONB, p_stage INTEGER)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_stage <= 2 THEN jsonb_build_object('kind', 'none', 'have', 0, 'need', 0, 'ok', true)
    WHEN p_stage = 3 THEN jsonb_build_object('kind', 'practised', 'have', (p_stats->>'practised')::int,
      'need', least(2, (p_stats->>'topics_total')::int),
      'ok', (p_stats->>'practised')::int >= least(2, (p_stats->>'topics_total')::int))
    WHEN p_stage <= 5 THEN jsonb_build_object('kind', 'practised', 'have', (p_stats->>'practised')::int,
      'need', ceil((p_stats->>'topics_total')::numeric / 2)::int,
      'ok', (p_stats->>'practised')::int >= ceil((p_stats->>'topics_total')::numeric / 2))
    WHEN p_stage <= 7 THEN jsonb_build_object('kind', 'at50', 'have', (p_stats->>'at50')::int,
      'need', ceil((p_stats->>'topics_total')::numeric * 3 / 4)::int,
      'ok', (p_stats->>'at50')::int >= ceil((p_stats->>'topics_total')::numeric * 3 / 4))
    ELSE jsonb_build_object('kind', 'at60', 'have', (p_stats->>'at60')::int,
      'need', (p_stats->>'topics_total')::int, 'mock', (p_stats->>'mock70')::boolean,
      'ok', (p_stats->>'at60')::int >= (p_stats->>'topics_total')::int AND (p_stats->>'mock70')::boolean)
  END;
$$;

-- ── Updating a grade after a saved test ──────────────────────────────
-- p_replay: placing a student from their history (no XP, events or daily
-- limit, no slipping, capped at D+).
CREATE OR REPLACE FUNCTION public.update_course_grade(p_user UUID, p_course UUID, p_test UUID, p_replay BOOLEAN DEFAULT false)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.tests%ROWTYPE;
  g public.course_grades%ROWTYPE;
  upto TIMESTAMPTZ;
  gained INTEGER;
  stats JSONB;
  acc NUMERIC;
  n30 INTEGER;
  nxt INTEGER;
  ok_since INTEGER;
  n_since INTEGER;
  floor_stage INTEGER;
  co public.courses%ROWTYPE;
BEGIN
  SELECT * INTO t FROM public.tests WHERE id = p_test;
  IF t.id IS NULL OR t.test_type NOT IN ('practice', 'exam_simulation', 'climb') THEN RETURN; END IF;
  INSERT INTO public.course_grades (user_id, course_id) VALUES (p_user, p_course) ON CONFLICT DO NOTHING;
  SELECT * INTO g FROM public.course_grades WHERE user_id = p_user AND course_id = p_course FOR UPDATE;
  upto := CASE WHEN p_replay THEN t.created_at ELSE now() END;

  SELECT count(*) FILTER (WHERE correct) INTO gained FROM public.ladder_answers(p_user, p_course, upto) WHERE test_id = p_test;
  -- Placement stops at D+ with an empty bar: C is earned with fresh answers.
  IF p_replay AND g.stage >= 3 THEN gained := 0; END IF;
  IF g.stage < 8 THEN
    g.bar := least(g.bar + gained, public.grade_bar_needed(g.stage + 1));
  END IF;

  stats := public.ladder_stats(p_user, p_course, upto);
  acc := (stats->>'acc30')::numeric;
  n30 := (stats->>'n30')::int;
  nxt := g.stage + 1;

  IF g.stage < 8 AND g.bar >= public.grade_bar_needed(nxt) AND n30 >= 10 AND acc >= 40 + 5 * nxt
     AND (public.ladder_coverage(stats, nxt)->>'ok')::boolean THEN
    IF p_replay AND nxt > 3 THEN
      NULL; -- placement stops at D+
    ELSIF NOT p_replay AND nxt >= 4 AND public.is_free_access(p_user, p_course) THEN
      -- Earned it, but C onwards needs the locked topics: say so, once a day.
      IF NOT EXISTS (SELECT 1 FROM public.grade_events WHERE user_id = p_user AND course_id = p_course
                     AND kind = 'capped' AND created_at::date = CURRENT_DATE) THEN
        INSERT INTO public.grade_events (user_id, course_id, test_id, kind, from_stage, to_stage)
        VALUES (p_user, p_course, p_test, 'capped', g.stage, nxt);
      END IF;
    ELSIF NOT p_replay AND (SELECT count(*) FROM public.grade_events WHERE user_id = p_user AND course_id = p_course
                            AND kind = 'promote' AND created_at::date = CURRENT_DATE) >= 2 THEN
      NULL; -- two promotions a day at most
    ELSE
      g.stage := nxt;
      g.bar := 0;
      g.best_stage := greatest(g.best_stage, nxt);
      g.promoted_at := upto;
      g.slipping_since := NULL;
      IF NOT p_replay THEN
        INSERT INTO public.grade_events (user_id, course_id, test_id, kind, from_stage, to_stage)
        VALUES (p_user, p_course, p_test, 'promote', nxt - 1, nxt);
        UPDATE public.users SET xp = xp + CASE WHEN nxt = 8 THEN 200 ELSE 50 END WHERE id = p_user;
        INSERT INTO public.user_achievements (user_id, achievement_id)
        SELECT p_user, a.id FROM public.achievements a
        WHERE (a.criteria->>'type' = 'grade' AND (a.criteria->>'value')::int <= nxt)
        ON CONFLICT DO NOTHING;
        IF nxt = 8 THEN
          SELECT * INTO co FROM public.courses WHERE id = p_course;
          IF NOT EXISTS (
            SELECT 1 FROM public.courses c2
            JOIN public.course_programs cp ON cp.course_id = c2.id
            JOIN public.users u ON u.id = p_user AND u.program_id = cp.program_id
            WHERE c2.level = co.level AND c2.semester = co.semester AND c2.id <> p_course
              AND NOT EXISTS (SELECT 1 FROM public.course_grades x WHERE x.user_id = p_user AND x.course_id = c2.id AND x.stage = 8)
          ) THEN
            INSERT INTO public.user_achievements (user_id, achievement_id)
            SELECT p_user, a.id FROM public.achievements a WHERE a.criteria->>'type' = 'grade_all'
            ON CONFLICT DO NOTHING;
          END IF;
        END IF;
      END IF;
    END IF;
  ELSIF NOT p_replay AND g.stage >= 1 AND n30 >= 10 THEN
    IF g.slipping_since IS NOT NULL THEN
      SELECT count(*), count(*) FILTER (WHERE correct) INTO n_since, ok_since FROM (
        SELECT correct FROM public.ladder_answers(p_user, p_course, upto)
        WHERE at > g.slipping_since ORDER BY at, answer_id LIMIT 10) s;
      floor_stage := CASE WHEN g.best_stage >= 4 THEN 2 ELSE 0 END;
      IF (n_since >= 10 AND ok_since >= 7) OR acc >= 40 + 5 * g.stage THEN
        INSERT INTO public.grade_events (user_id, course_id, test_id, kind, from_stage, to_stage)
        VALUES (p_user, p_course, p_test, 'clear', g.stage, g.stage);
        g.slipping_since := NULL;
      ELSIF acc <= 40 + 5 * g.stage - 10
        AND g.slipping_since::date < CURRENT_DATE
        AND (g.promoted_at IS NULL OR g.promoted_at < now() - interval '3 days')
        AND (g.dropped_at IS NULL OR g.dropped_at < now() - interval '7 days')
        AND g.stage > floor_stage THEN
        INSERT INTO public.grade_events (user_id, course_id, test_id, kind, from_stage, to_stage)
        VALUES (p_user, p_course, p_test, 'drop', g.stage, g.stage - 1);
        g.bar := ceil(public.grade_bar_needed(g.stage)::numeric / 2)::int;
        g.stage := g.stage - 1;
        g.dropped_at := now();
        g.slipping_since := NULL;
      END IF;
    ELSIF acc <= 40 + 5 * g.stage - 10 THEN
      g.slipping_since := now();
      INSERT INTO public.grade_events (user_id, course_id, test_id, kind, from_stage, to_stage)
      VALUES (p_user, p_course, p_test, 'warn', g.stage, g.stage);
    END IF;
  END IF;

  UPDATE public.course_grades SET stage = g.stage, bar = g.bar, best_stage = g.best_stage,
    slipping_since = g.slipping_since, promoted_at = g.promoted_at, dropped_at = g.dropped_at, updated_at = now()
  WHERE user_id = p_user AND course_id = p_course;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.update_course_grade(UUID, UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- ── Saving a test (as migration 038, plus Climb and the grade) ──────
CREATE OR REPLACE FUNCTION public.record_test(
  p_user UUID, p_course UUID, p_topic UUID, p_type TEXT, p_answers JSONB,
  p_time_taken INTEGER DEFAULT NULL, p_fill_ok UUID[] DEFAULT '{}'
)
RETURNS TABLE (test_id UUID, score INTEGER, total INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  n INTEGER;
  matched INTEGER;
  got INTEGER;
  new_id UUID;
  pct NUMERIC;
  topic UUID := p_topic;
BEGIN
  IF p_type NOT IN ('practice', 'exam_simulation', 'climb') THEN RAISE EXCEPTION 'bad_type'; END IF;
  IF coalesce(public.course_access_for(p_user, p_course), '') NOT IN ('free', 'paid')
     AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user AND role IN ('admin', 'super_admin')) THEN
    RAISE EXCEPTION 'payment_required';
  END IF;
  IF jsonb_typeof(p_answers) <> 'array' THEN RAISE EXCEPTION 'bad_answers'; END IF;
  n := jsonb_array_length(p_answers);
  IF n < 1 OR n > 100 THEN RAISE EXCEPTION 'bad_answers'; END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.submitted (
    question_id UUID, selected JSONB, confidence TEXT, is_correct BOOLEAN
  ) ON COMMIT DROP;
  DELETE FROM pg_temp.submitted;
  INSERT INTO pg_temp.submitted (question_id, selected, confidence)
  SELECT (e->>'question_id')::uuid,
         CASE WHEN jsonb_typeof(e->'selected') = 'array' AND jsonb_array_length(e->'selected') <= 10
              THEN e->'selected' ELSE '[]'::jsonb END,
         CASE WHEN e->>'confidence' IN ('sure', 'unsure') THEN e->>'confidence' END
  FROM jsonb_array_elements(p_answers) e;

  SELECT count(DISTINCT s.question_id) INTO matched
  FROM pg_temp.submitted s
  JOIN public.questions q ON q.id = s.question_id AND q.course_id = p_course AND q.is_approved;
  IF matched <> n THEN RAISE EXCEPTION 'bad_questions'; END IF;

  IF public.is_free_access(p_user, p_course) AND EXISTS (
    SELECT 1 FROM pg_temp.submitted s JOIN public.questions q ON q.id = s.question_id
    WHERE q.topic_id IS NULL OR q.topic_id NOT IN (SELECT public.free_topic_ids(p_course))
  ) THEN
    RAISE EXCEPTION 'topic_locked';
  END IF;

  UPDATE pg_temp.submitted s SET is_correct = CASE
      WHEN q.question_type = 'fill_in_blank' THEN
        q.id = ANY (coalesce(p_fill_ok, '{}'))
        OR (public.norm_answer(s.selected->>0) <> '' AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(q.correct_answers) ca
          WHERE public.norm_answer(ca) = public.norm_answer(s.selected->>0)))
      ELSE public.options_match(s.selected, q.correct_answers)
    END
  FROM public.questions q WHERE q.id = s.question_id;

  SELECT count(*) FILTER (WHERE s.is_correct) INTO got FROM pg_temp.submitted s;
  pct := round(got::NUMERIC * 100 / n, 2);
  IF topic IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.topics t WHERE t.id = topic AND t.course_id = p_course) THEN
    topic := NULL;
  END IF;

  INSERT INTO public.tests (user_id, course_id, topic_id, test_type, score, total_questions, percentage, time_taken, completed_at)
  VALUES (p_user, p_course, topic, p_type, got, n, pct,
          CASE WHEN p_time_taken BETWEEN 0 AND 86400 THEN p_time_taken END, now())
  RETURNING id INTO new_id;

  INSERT INTO public.test_answers (test_id, question_id, selected_answer, is_correct, confidence)
  SELECT new_id, s.question_id, s.selected, s.is_correct, s.confidence FROM pg_temp.submitted s;

  PERFORM public.apply_test_rewards(p_user, got * 10 + CASE WHEN p_type = 'exam_simulation' AND pct >= 70 THEN 50 ELSE 0 END);
  PERFORM public.update_course_grade(p_user, p_course, new_id);

  RETURN QUERY SELECT new_id, got, n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_test(UUID, UUID, UUID, TEXT, JSONB, INTEGER, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_test(UUID, UUID, UUID, TEXT, JSONB, INTEGER, UUID[]) TO service_role;

-- ── What students see ────────────────────────────────────────────────
-- The caller's grade in a course and what the next one needs.
CREATE OR REPLACE FUNCTION public.get_course_grade(p_course UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  me UUID := auth.uid();
  g public.course_grades%ROWTYPE;
  stats JSONB;
  nxt INTEGER;
  free BOOLEAN;
  n_since INTEGER := 0;
  ok_since INTEGER := 0;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF coalesce(public.course_access_for(me, p_course), '') NOT IN ('free', 'paid')
     AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = me AND role IN ('admin', 'super_admin')) THEN
    RETURN jsonb_build_object('access', 'locked');
  END IF;
  SELECT * INTO g FROM public.course_grades WHERE user_id = me AND course_id = p_course;
  g.stage := coalesce(g.stage, 0); g.bar := coalesce(g.bar, 0); g.best_stage := coalesce(g.best_stage, 0);
  stats := public.ladder_stats(me, p_course);
  nxt := least(g.stage + 1, 8);
  free := public.is_free_access(me, p_course);
  IF g.slipping_since IS NOT NULL THEN
    SELECT count(*), count(*) FILTER (WHERE correct) INTO n_since, ok_since FROM (
      SELECT correct FROM public.ladder_answers(me, p_course) WHERE at > g.slipping_since ORDER BY at, answer_id LIMIT 10) s;
  END IF;
  RETURN jsonb_build_object(
    'access', 'ok',
    'stage', g.stage, 'label', public.grade_label(g.stage),
    'best', g.best_stage, 'best_label', public.grade_label(g.best_stage),
    'next', CASE WHEN g.stage < 8 THEN nxt END,
    'next_label', CASE WHEN g.stage < 8 THEN public.grade_label(nxt) END,
    'bar', g.bar, 'bar_needed', CASE WHEN g.stage < 8 THEN public.grade_bar_needed(nxt) END,
    'acc30', stats->'acc30', 'n30', stats->'n30',
    'acc_needed', CASE WHEN g.stage < 8 THEN 40 + 5 * nxt END,
    'coverage', CASE WHEN g.stage < 8 THEN public.ladder_coverage(stats, nxt) END,
    'topics_total', stats->'topics_total',
    'free', free,
    'capped', free AND g.stage < 8 AND nxt >= 4,
    'slipping', g.slipping_since IS NOT NULL,
    'hold', CASE WHEN g.slipping_since IS NOT NULL THEN jsonb_build_object('answered', n_since, 'right', ok_since) END
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_course_grade(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_grade(UUID) TO authenticated;

-- Badges for the dashboard: every course the caller has a grade in.
CREATE OR REPLACE FUNCTION public.get_my_course_grades()
RETURNS TABLE (course_id UUID, stage INTEGER, label TEXT, bar INTEGER, bar_needed INTEGER, next_label TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT g.course_id, g.stage::int, public.grade_label(g.stage), g.bar,
         CASE WHEN g.stage < 8 THEN public.grade_bar_needed(g.stage + 1) END,
         CASE WHEN g.stage < 8 THEN public.grade_label(g.stage + 1) END
  FROM public.course_grades g WHERE g.user_id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_course_grades() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_course_grades() TO authenticated;

-- What a saved test did to the caller's grade (results page).
CREATE OR REPLACE FUNCTION public.get_test_grade_outcome(p_test UUID)
RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'kind', e.kind, 'from', e.from_stage, 'to', e.to_stage,
           'from_label', public.grade_label(e.from_stage), 'to_label', public.grade_label(e.to_stage))
         ORDER BY e.created_at), '[]'::jsonb)
  FROM public.grade_events e JOIN public.tests t ON t.id = e.test_id
  WHERE e.test_id = p_test AND t.user_id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.get_test_grade_outcome(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_test_grade_outcome(UUID) TO authenticated;

-- ── Climb rounds ─────────────────────────────────────────────────────
-- 10 questions for the caller's grade: the difficulty mix and topics in
-- the design, open topics only on a free course, nothing they got right
-- in the last 7 days. Difficulty comes from real answer rates once a
-- question has 20+ answers, else from its tag.
CREATE OR REPLACE FUNCTION public.get_climb_round(p_course UUID)
RETURNS SETOF public.questions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE AS $$
DECLARE
  me UUID := auth.uid();
  st INTEGER;
  want_easy INTEGER; want_med INTEGER; want_hard INTEGER;
  free BOOLEAN;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF coalesce(public.course_access_for(me, p_course), '') NOT IN ('free', 'paid')
     AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = me AND role IN ('admin', 'super_admin')) THEN
    RAISE EXCEPTION 'payment_required';
  END IF;
  SELECT coalesce((SELECT stage FROM public.course_grades WHERE user_id = me AND course_id = p_course), 0) INTO st;
  free := public.is_free_access(me, p_course);
  SELECT e, m, h INTO want_easy, want_med, want_hard FROM (VALUES
    (0, 6, 4, 0), (1, 6, 4, 0), (2, 3, 6, 1), (3, 3, 6, 1), (4, 2, 5, 3), (5, 2, 5, 3), (6, 1, 5, 4), (7, 1, 5, 4), (8, 0, 5, 5)
  ) v(s, e, m, h) WHERE v.s = st;

  RETURN QUERY
  WITH la AS (SELECT * FROM public.ladder_answers(me, p_course)),
  tstats AS (
    SELECT t.topic_key, t.first_order, count(la.answer_id) AS n, avg(la.correct::int) AS acc
    FROM public.ladder_topics(p_course) t LEFT JOIN la ON la.topic_key = t.topic_key
    GROUP BY t.topic_key, t.first_order
  ),
  firsts AS (SELECT topic_key FROM tstats ORDER BY first_order, topic_key LIMIT 3),
  weakest AS (SELECT topic_key FROM tstats WHERE n >= 5 ORDER BY acc, topic_key LIMIT 3),
  pool AS (
    SELECT q.id,
      CASE WHEN coalesce(q.times_answered, 0) >= 20 THEN
             CASE WHEN q.times_correct::numeric / q.times_answered > 0.75 THEN 'easy'
                  WHEN q.times_correct::numeric / q.times_answered < 0.45 THEN 'hard' ELSE 'medium' END
           ELSE coalesce(q.difficulty, 'medium') END AS diff,
      CASE
        WHEN st <= 1 THEN lower(btrim(tp.topic_name)) IN (SELECT topic_key FROM firsts)
        WHEN st <= 3 THEN coalesce((SELECT n FROM tstats s WHERE s.topic_key = lower(btrim(tp.topic_name))), 0) < 5
        WHEN st <= 5 THEN lower(btrim(tp.topic_name)) IN (SELECT topic_key FROM weakest)
        WHEN st <= 7 THEN lower(btrim(tp.topic_name)) IN (SELECT topic_key FROM weakest)
                          OR q.id IN (SELECT question_id FROM la WHERE NOT correct)
        ELSE false END AS pref
    FROM public.questions q
    LEFT JOIN public.topics tp ON tp.id = q.topic_id
    WHERE q.course_id = p_course AND q.is_approved
      AND (NOT free OR q.topic_id IN (SELECT public.free_topic_ids(p_course)))
      AND NOT EXISTS (SELECT 1 FROM la WHERE la.question_id = q.id AND la.correct AND la.at > now() - interval '7 days')
  ),
  ranked AS (
    SELECT p.id, p.diff, row_number() OVER (PARTITION BY p.diff ORDER BY random() * CASE WHEN p.pref THEN 0.4 ELSE 1 END) AS rn
    FROM pool p
  ),
  picked AS (
    SELECT r.id FROM ranked r
    ORDER BY (r.rn <= CASE r.diff WHEN 'easy' THEN want_easy WHEN 'hard' THEN want_hard ELSE want_med END) DESC,
             CASE r.diff WHEN 'medium' THEN 0 ELSE 1 END, r.rn
    LIMIT 10
  )
  SELECT q.* FROM public.questions q JOIN picked p ON p.id = q.id ORDER BY random();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_climb_round(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_climb_round(UUID) TO authenticated;

-- ── Streak reminder names the next grade (as migration 041 otherwise) ──
CREATE OR REPLACE FUNCTION public.generate_my_reminders()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me UUID := auth.uid();
  u public.users%ROWTYPE;
  last_test DATE;
  gap INTEGER;
  m INTEGER;
  made INTEGER := 0;
  n INTEGER;
  goal TEXT;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT * INTO u FROM public.users WHERE id = me;
  IF u.id IS NULL OR u.role <> 'student' THEN RETURN 0; END IF;

  IF u.last_practice_date = CURRENT_DATE - 1 AND u.practice_streak >= 2 THEN
    SELECT ' You’re ' || (public.grade_bar_needed(g.stage + 1) - g.bar) || ' correct from '
           || public.grade_label(g.stage + 1) || ' in ' || c.course_code || '.'
      INTO goal
    FROM public.course_grades g JOIN public.courses c ON c.id = g.course_id
    WHERE g.user_id = me AND g.stage < 8 AND g.bar < public.grade_bar_needed(g.stage + 1)
    ORDER BY g.updated_at DESC LIMIT 1;
    INSERT INTO public.notifications (user_id, type, message, link, dedupe_key)
    VALUES (me, 'streak_risk',
            '🔥 Keep your ' || u.practice_streak || '-day streak going: practise today before midnight.' || coalesce(goal, ''),
            '/courses', 'streak_risk:' || CURRENT_DATE)
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; made := made + n;
  ELSIF u.last_practice_date < CURRENT_DATE - 1 AND u.practice_streak > 0 THEN
    IF u.practice_streak >= 3 THEN
      INSERT INTO public.notifications (user_id, type, message, link, dedupe_key)
      VALUES (me, 'streak_lost',
              'Your ' || u.practice_streak || '-day streak ended. One quiz today starts a new one.',
              '/courses', 'streak_lost:' || u.last_practice_date)
      ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
      GET DIAGNOSTICS n = ROW_COUNT; made := made + n;
    END IF;
    UPDATE public.users SET practice_streak = 0 WHERE id = me;
  END IF;

  SELECT max(created_at)::date INTO last_test FROM public.tests WHERE user_id = me;
  IF last_test IS NOT NULL THEN
    gap := CURRENT_DATE - last_test;
    IF gap >= 7 THEN
      INSERT INTO public.notifications (user_id, type, message, link, dedupe_key)
      VALUES (me, 'inactivity',
              CASE WHEN gap > 60
                THEN '📚 It’s been a while since your last quiz. A quick 10-question session gets you back on track.'
                ELSE '📚 It’s been ' || gap || ' days since your last quiz. A quick 10-question session gets you back on track.'
              END,
              '/courses', 'inactivity:' || last_test)
      ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
      GET DIAGNOSTICS n = ROW_COUNT; made := made + n;
    END IF;
  ELSIF u.created_at < now() - interval '2 days' THEN
    INSERT INTO public.notifications (user_id, type, message, link, dedupe_key)
    VALUES (me, 'inactivity', '📚 Try your first quiz: 10 questions, about 5 minutes.', '/courses', 'first_quiz')
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; made := made + n;
  END IF;

  SELECT max(x) INTO m FROM unnest(ARRAY[1, 10, 25, 50, 100]) x WHERE x <= u.total_tests_taken;
  IF m IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, message, link, dedupe_key)
    VALUES (me, 'milestone', CASE m
              WHEN 1 THEN '🎉 You completed your first test. Great start!'
              WHEN 10 THEN '⚡ 10 tests completed. You’re building real momentum.'
              WHEN 25 THEN '🏆 25 tests done. You’re well on your way to exam readiness.'
              WHEN 50 THEN '🔥 50 tests completed. That’s serious commitment.'
              ELSE '👑 100 tests. Exams don’t stand a chance.'
            END,
            '/leaderboard?tab=achievements', 'milestone:' || m)
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; made := made + n;
  END IF;

  RETURN made;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.generate_my_reminders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_my_reminders() TO authenticated;

-- ── Placing existing students ────────────────────────────────────────
-- Replays each student's past tests through the rules above, capped at
-- D+, so regular users don't start back at F but earn C onwards afresh.
-- Students who already have a grade row are left alone.
DO $$
DECLARE r RECORD; t RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT x.user_id, x.course_id FROM public.tests x
    WHERE x.test_type IN ('practice', 'exam_simulation')
      AND NOT EXISTS (SELECT 1 FROM public.course_grades g WHERE g.user_id = x.user_id AND g.course_id = x.course_id)
  LOOP
    FOR t IN SELECT id FROM public.tests
             WHERE user_id = r.user_id AND course_id = r.course_id AND test_type IN ('practice', 'exam_simulation')
             ORDER BY created_at, id
    LOOP
      PERFORM public.update_course_grade(r.user_id, r.course_id, t.id, true);
    END LOOP;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ================================================================
-- EXAM BOSS — see migration 043
-- ================================================================

CREATE TABLE IF NOT EXISTS public.boss_ratings (
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id  UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  rating     NUMERIC NOT NULL DEFAULT 1000,
  answers    INTEGER NOT NULL DEFAULT 0,
  best_level INTEGER NOT NULL DEFAULT 1,
  wins       INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id)
);

CREATE TABLE IF NOT EXISTS public.question_ratings (
  question_id UUID PRIMARY KEY REFERENCES public.questions(id) ON DELETE CASCADE,
  rating      NUMERIC NOT NULL,
  answers     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.boss_fights (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id   UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  topic_id    UUID REFERENCES public.topics(id) ON DELETE SET NULL,
  is_daily    BOOLEAN NOT NULL DEFAULT false,
  daily_date  DATE,
  level       INTEGER NOT NULL,
  hearts      INTEGER NOT NULL DEFAULT 3,
  boss_hp     INTEGER NOT NULL,
  boss_max_hp INTEGER NOT NULL,
  streak      INTEGER NOT NULL DEFAULT 0,
  misses      INTEGER NOT NULL DEFAULT 0,
  power       BOOLEAN NOT NULL DEFAULT false,
  status      TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'won', 'lost', 'abandoned')),
  xp          INTEGER NOT NULL DEFAULT 0,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at    TIMESTAMPTZ,
  time_ms     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_boss_fights_user ON public.boss_fights(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_boss_fights_daily ON public.boss_fights(course_id, daily_date) WHERE is_daily;

CREATE TABLE IF NOT EXISTS public.boss_fight_answers (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fight_id      UUID NOT NULL REFERENCES public.boss_fights(id) ON DELETE CASCADE,
  idx           INTEGER NOT NULL,
  question_id   UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  countdown     INTEGER NOT NULL,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deadline      TIMESTAMPTZ NOT NULL,
  answered_at   TIMESTAMPTZ,
  selected      JSONB,
  is_correct    BOOLEAN,
  timed_out     BOOLEAN NOT NULL DEFAULT false,
  damage        INTEGER NOT NULL DEFAULT 0,
  rating_before NUMERIC,
  rating_after  NUMERIC,
  UNIQUE (fight_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_boss_answers_question ON public.boss_fight_answers(question_id);

-- topic_id = the nil uuid for a whole-course trophy.
CREATE TABLE IF NOT EXISTS public.boss_trophies (
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id     UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  topic_id      UUID NOT NULL,
  gold          BOOLEAN NOT NULL DEFAULT false,
  best_time_ms  INTEGER,
  first_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id, topic_id)
);

CREATE TABLE IF NOT EXISTS public.boss_daily (
  course_id    UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  day          DATE NOT NULL,
  question_ids UUID[] NOT NULL,
  PRIMARY KEY (course_id, day)
);

ALTER TABLE public.boss_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boss_fights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boss_fight_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boss_trophies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boss_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.boss_ratings, public.question_ratings, public.boss_fights, public.boss_fight_answers,
  public.boss_trophies, public.boss_daily FROM anon, authenticated;

-- ── Rules ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.boss_level(p_rating NUMERIC)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT least(10, greatest(1, floor((p_rating - 900) / 100)::int + 2));
$$;

CREATE OR REPLACE FUNCTION public.boss_name(p_level INTEGER, p_daily BOOLEAN DEFAULT false)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_daily THEN 'The Daily Boss'
              WHEN p_level <= 3 THEN 'Quiz Drone' WHEN p_level <= 6 THEN 'The Examiner'
              WHEN p_level <= 9 THEN 'Chief Invigilator' ELSE 'The Final Paper' END;
$$;

-- Seconds to answer. Multiple choice gets 4 more.
CREATE OR REPLACE FUNCTION public.boss_countdown(p_level INTEGER, p_enraged BOOLEAN, p_multi BOOLEAN)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT (CASE WHEN p_enraged THEN (ARRAY[11, 10, 9, 8, 7, 7, 6, 6, 6, 5])[p_level]
               ELSE (ARRAY[14, 13, 12, 11, 10, 10, 9, 9, 8, 8])[p_level] END)
         + CASE WHEN p_multi THEN 4 ELSE 0 END;
$$;

-- Boss health is counted in half-hits: a normal hit does 2, a fast one 3,
-- a power strike doubles. Level 1 needs 6 hits, level 10 needs 15.
CREATE OR REPLACE FUNCTION public.boss_max_hp(p_level INTEGER)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$ SELECT (5 + p_level) * 2; $$;

-- A question's difficulty rating: learned, else from its answer rate, else its tag.
CREATE OR REPLACE FUNCTION public.boss_question_rating(p_question UUID)
RETURNS NUMERIC
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT coalesce(
    (SELECT r.rating FROM public.question_ratings r WHERE r.question_id = p_question),
    (SELECT CASE
       WHEN coalesce(q.times_answered, 0) >= 20 THEN
         least(1400, greatest(600, 1000 + 400 * log(
           greatest(0.02, least(0.98, 1 - q.times_correct::numeric / q.times_answered))
           / greatest(0.02, least(0.98, q.times_correct::numeric / q.times_answered)))))
       WHEN q.difficulty = 'easy' THEN 850
       WHEN q.difficulty = 'hard' THEN 1150
       ELSE 1000 END
     FROM public.questions q WHERE q.id = p_question),
    1000);
$$;
REVOKE EXECUTE ON FUNCTION public.boss_question_rating(UUID) FROM PUBLIC, anon, authenticated;

-- Questions a fight may use: approved single/multiple choice with options,
-- in the course (and topic), open topics only on free access.
CREATE OR REPLACE FUNCTION public.boss_pool(p_user UUID, p_course UUID, p_topic UUID)
RETURNS SETOF UUID
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT q.id FROM public.questions q
  WHERE q.course_id = p_course AND q.is_approved
    AND q.question_type IN ('single_choice', 'multiple_choice')
    AND jsonb_typeof(q.options) = 'array' AND jsonb_array_length(q.options) >= 2
    AND jsonb_typeof(q.correct_answers) = 'array' AND jsonb_array_length(q.correct_answers) >= 1
    AND (p_topic IS NULL OR q.topic_id = p_topic)
    AND (NOT public.is_free_access(p_user, p_course) OR q.topic_id IN (SELECT public.free_topic_ids(p_course)));
$$;
REVOKE EXECUTE ON FUNCTION public.boss_pool(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;

-- Send the next question of a fight. Its clock starts after p_pause
-- seconds (the "get ready" or the last answer's reveal); until then the
-- phone gets only its start time, not its text.
DROP FUNCTION IF EXISTS public.boss_next_question(UUID);
CREATE OR REPLACE FUNCTION public.boss_next_question(p_fight UUID, p_pause NUMERIC DEFAULT 0)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f public.boss_fights%ROWTYPE;
  s NUMERIC;
  target_e NUMERIC;
  target_q NUMERIC;
  qid UUID;
  qtype TEXT;
  n INTEGER;
  daily_ids UUID[];
BEGIN
  SELECT * INTO f FROM public.boss_fights WHERE id = p_fight;
  SELECT count(*) INTO n FROM public.boss_fight_answers WHERE fight_id = f.id;

  IF f.is_daily THEN
    SELECT question_ids INTO daily_ids FROM public.boss_daily WHERE course_id = f.course_id AND day = f.daily_date;
    qid := daily_ids[n + 1];
  ELSE
    SELECT coalesce((SELECT rating FROM public.boss_ratings WHERE user_id = f.user_id AND course_id = f.course_id), 1000) INTO s;
    target_e := CASE WHEN f.misses >= 2 THEN 0.80
                     WHEN f.streak >= 3 OR f.boss_hp * 2 <= f.boss_max_hp THEN 0.60
                     ELSE 0.70 END;
    target_q := s + 400 * log(1 / target_e - 1);
    -- Nearest to the target difficulty, with a little randomness; never a
    -- question already in this fight, and not one answered right in the
    -- last 7 days unless the pool would run dry.
    SELECT p.id INTO qid FROM public.boss_pool(f.user_id, f.course_id, f.topic_id) AS p(id)
    WHERE p.id NOT IN (SELECT question_id FROM public.boss_fight_answers WHERE fight_id = f.id)
    ORDER BY (EXISTS (
               SELECT 1 FROM public.boss_fight_answers a JOIN public.boss_fights bf ON bf.id = a.fight_id
               WHERE bf.user_id = f.user_id AND a.question_id = p.id AND a.is_correct AND a.answered_at > now() - interval '7 days')
             OR EXISTS (
               SELECT 1 FROM public.test_answers ta JOIN public.tests t ON t.id = ta.test_id
               WHERE t.user_id = f.user_id AND ta.question_id = p.id AND ta.is_correct AND t.created_at > now() - interval '7 days')),
             abs(public.boss_question_rating(p.id) - target_q) + random() * 60
    LIMIT 1;
  END IF;

  IF qid IS NULL THEN RETURN; END IF;
  SELECT question_type INTO qtype FROM public.questions WHERE id = qid;
  INSERT INTO public.boss_fight_answers (fight_id, idx, question_id, countdown, sent_at, deadline)
  VALUES (f.id, n, qid,
          public.boss_countdown(f.level, f.boss_hp * 2 <= f.boss_max_hp, qtype = 'multiple_choice'),
          clock_timestamp() + make_interval(secs => p_pause),
          clock_timestamp() + make_interval(secs => p_pause + public.boss_countdown(f.level, f.boss_hp * 2 <= f.boss_max_hp, qtype = 'multiple_choice')));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.boss_next_question(UUID, NUMERIC) FROM PUBLIC, anon, authenticated;

-- Finish a fight: time, XP, trophies, wins.
CREATE OR REPLACE FUNCTION public.boss_finish(p_fight UUID, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f public.boss_fights%ROWTYPE;
  ms INTEGER;
  gained INTEGER;
BEGIN
  SELECT * INTO f FROM public.boss_fights WHERE id = p_fight FOR UPDATE;
  IF f.status <> 'live' THEN RETURN; END IF;
  ms := (extract(epoch FROM clock_timestamp() - f.started_at) * 1000)::int;
  gained := f.xp + CASE WHEN p_status = 'won' THEN CASE WHEN f.is_daily THEN 100 ELSE 50 END ELSE 0 END;
  UPDATE public.boss_fights SET status = p_status, ended_at = clock_timestamp(), time_ms = ms, xp = gained WHERE id = f.id;
  UPDATE public.users SET xp = xp + gained WHERE id = f.user_id;
  IF p_status = 'won' THEN
    UPDATE public.boss_ratings SET wins = wins + 1 WHERE user_id = f.user_id AND course_id = f.course_id;
    IF NOT f.is_daily THEN
      INSERT INTO public.boss_trophies (user_id, course_id, topic_id, gold, best_time_ms)
      VALUES (f.user_id, f.course_id, coalesce(f.topic_id, '00000000-0000-0000-0000-000000000000'), f.hearts = 3, ms)
      ON CONFLICT (user_id, course_id, topic_id) DO UPDATE
        SET gold = boss_trophies.gold OR EXCLUDED.gold,
            best_time_ms = least(boss_trophies.best_time_ms, EXCLUDED.best_time_ms);
    END IF;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.boss_finish(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- Mark the current question: right (in time) or not, then the ratings,
-- damage, hearts, streak and the end of the fight.
CREATE OR REPLACE FUNCTION public.boss_resolve(p_fight UUID, p_selected JSONB, p_timeout BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f public.boss_fights%ROWTYPE;
  a public.boss_fight_answers%ROWTYPE;
  q public.questions%ROWTYPE;
  s NUMERIC;
  s_answers INTEGER;
  qr NUMERIC;
  e NUMERIC;
  r INTEGER;
  ok BOOLEAN;
  late BOOLEAN;
  dmg INTEGER := 0;
  total INTEGER;
BEGIN
  SELECT * INTO f FROM public.boss_fights WHERE id = p_fight FOR UPDATE;
  IF f.status <> 'live' THEN RETURN; END IF;
  SELECT * INTO a FROM public.boss_fight_answers WHERE fight_id = f.id AND answered_at IS NULL ORDER BY idx DESC LIMIT 1 FOR UPDATE;
  IF a.id IS NULL THEN RETURN; END IF;
  SELECT * INTO q FROM public.questions WHERE id = a.question_id;

  late := clock_timestamp() > a.deadline + interval '1.5 seconds';
  ok := NOT p_timeout AND NOT late AND public.options_match(coalesce(p_selected, '[]'::jsonb), q.correct_answers);
  r := CASE WHEN ok THEN 1 ELSE 0 END;

  -- The learning step.
  INSERT INTO public.boss_ratings (user_id, course_id) VALUES (f.user_id, f.course_id) ON CONFLICT DO NOTHING;
  SELECT rating, answers INTO s, s_answers FROM public.boss_ratings WHERE user_id = f.user_id AND course_id = f.course_id FOR UPDATE;
  qr := public.boss_question_rating(q.id);
  e := 1 / (1 + power(10, (qr - s) / 400));
  UPDATE public.boss_ratings
  SET rating = s + CASE WHEN s_answers < 30 THEN 32 ELSE 16 END * (r - e),
      answers = answers + 1,
      best_level = greatest(best_level, public.boss_level(s + CASE WHEN s_answers < 30 THEN 32 ELSE 16 END * (r - e))),
      updated_at = now()
  WHERE user_id = f.user_id AND course_id = f.course_id;
  INSERT INTO public.question_ratings (question_id, rating, answers) VALUES (q.id, qr - 8 * (r - e), 1)
  ON CONFLICT (question_id) DO UPDATE SET rating = question_ratings.rating - 8 * (r - e), answers = question_ratings.answers + 1;

  IF ok THEN
    -- Fast (within the first 40% of the countdown): 3 half-hits, else 2;
    -- a charged power strike doubles it.
    dmg := CASE WHEN clock_timestamp() <= a.sent_at + make_interval(secs => a.countdown * 0.4) THEN 3 ELSE 2 END;
    IF f.power THEN dmg := dmg * 2; f.power := false; END IF;
    f.boss_hp := greatest(0, f.boss_hp - dmg);
    f.streak := f.streak + 1;
    f.misses := 0;
    IF f.streak % 3 = 0 THEN f.power := true; END IF;
    f.xp := f.xp + 10;
  ELSE
    f.hearts := f.hearts - 1;
    f.streak := 0;
    f.misses := f.misses + 1;
    f.power := false;
  END IF;

  UPDATE public.boss_fight_answers
  SET answered_at = clock_timestamp(), selected = p_selected, is_correct = ok, timed_out = (p_timeout OR late),
      damage = dmg, rating_before = s, rating_after = s + CASE WHEN s_answers < 30 THEN 32 ELSE 16 END * (r - e)
  WHERE id = a.id;
  UPDATE public.boss_fights SET boss_hp = f.boss_hp, hearts = f.hearts, streak = f.streak, misses = f.misses,
    power = f.power, xp = f.xp WHERE id = f.id;

  SELECT count(*) INTO total FROM public.boss_fight_answers WHERE fight_id = f.id;
  IF f.boss_hp <= 0 THEN
    PERFORM public.boss_finish(f.id, 'won');
  ELSIF f.hearts <= 0 OR total >= 30 THEN
    PERFORM public.boss_finish(f.id, 'lost');
  ELSE
    PERFORM public.boss_next_question(f.id, CASE WHEN ok THEN 1.2 ELSE 2.5 END);
    IF NOT EXISTS (SELECT 1 FROM public.boss_fight_answers WHERE fight_id = f.id AND answered_at IS NULL) THEN
      PERFORM public.boss_finish(f.id, 'lost'); -- ran out of questions
    END IF;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.boss_resolve(UUID, JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- ── What students call ───────────────────────────────────────────────
-- Start a fight. p_daily: today's Daily Boss (paid only, once a day).
CREATE OR REPLACE FUNCTION public.start_boss_fight(p_course UUID, p_topic UUID DEFAULT NULL, p_daily BOOLEAN DEFAULT false)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me UUID := auth.uid();
  free BOOLEAN;
  s NUMERIC;
  lvl INTEGER;
  fid UUID;
  pool_size INTEGER;
  ids UUID[];
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF coalesce(public.course_access_for(me, p_course), '') NOT IN ('free', 'paid')
     AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = me AND role IN ('admin', 'super_admin')) THEN
    RAISE EXCEPTION 'payment_required';
  END IF;
  free := public.is_free_access(me, p_course);
  IF p_topic IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.topics WHERE id = p_topic AND course_id = p_course) THEN
    RAISE EXCEPTION 'bad_topic';
  END IF;
  IF free AND p_topic IS NOT NULL AND p_topic NOT IN (SELECT public.free_topic_ids(p_course)) THEN
    RAISE EXCEPTION 'topic_locked';
  END IF;

  -- One live fight at a time: an unfinished one is abandoned.
  UPDATE public.boss_fights SET status = 'abandoned', ended_at = now() WHERE user_id = me AND status = 'live';

  IF p_daily THEN
    IF free THEN RAISE EXCEPTION 'daily_paid_only'; END IF;
    IF EXISTS (SELECT 1 FROM public.boss_fights WHERE user_id = me AND course_id = p_course AND is_daily AND daily_date = CURRENT_DATE) THEN
      RAISE EXCEPTION 'daily_done';
    END IF;
    -- Today's 12 questions, the same for everyone, picked on first use.
    IF NOT EXISTS (SELECT 1 FROM public.boss_daily WHERE course_id = p_course AND day = CURRENT_DATE) THEN
      SELECT array_agg(id) INTO ids FROM (
        SELECT p.id FROM public.boss_pool(NULL, p_course, NULL) AS p(id) ORDER BY random() LIMIT 12) x;
      IF coalesce(array_length(ids, 1), 0) < 12 THEN RAISE EXCEPTION 'not_enough_questions'; END IF;
      INSERT INTO public.boss_daily (course_id, day, question_ids) VALUES (p_course, CURRENT_DATE, ids)
      ON CONFLICT DO NOTHING;
    END IF;
    lvl := 5;
    INSERT INTO public.boss_fights (user_id, course_id, is_daily, daily_date, level, boss_hp, boss_max_hp)
    VALUES (me, p_course, true, CURRENT_DATE, lvl, 20, 20) RETURNING id INTO fid;
  ELSE
    IF free AND (SELECT count(*) FROM public.boss_fights WHERE user_id = me AND NOT is_daily
                 AND started_at::date = CURRENT_DATE) >= 3 THEN
      RAISE EXCEPTION 'free_limit_fights';
    END IF;
    SELECT count(*) INTO pool_size FROM public.boss_pool(me, p_course, p_topic);
    IF pool_size < 15 THEN RAISE EXCEPTION 'not_enough_questions'; END IF;
    SELECT coalesce((SELECT rating FROM public.boss_ratings WHERE user_id = me AND course_id = p_course), 1000) INTO s;
    lvl := public.boss_level(s);
    INSERT INTO public.boss_fights (user_id, course_id, topic_id, level, boss_hp, boss_max_hp)
    VALUES (me, p_course, p_topic, lvl, public.boss_max_hp(lvl), public.boss_max_hp(lvl)) RETURNING id INTO fid;
  END IF;

  PERFORM public.boss_next_question(fid, 3);
  RETURN fid;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.start_boss_fight(UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_boss_fight(UUID, UUID, BOOLEAN) TO authenticated;

-- The fight as the phone shows it. A question past its deadline is
-- resolved as a time-out first. The current question never carries its
-- answer; the last one does.
CREATE OR REPLACE FUNCTION public.get_boss_fight(p_fight UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me UUID := auth.uid();
  f public.boss_fights%ROWTYPE;
  cur RECORD;
  prev RECORD;
  co public.courses%ROWTYPE;
BEGIN
  SELECT * INTO f FROM public.boss_fights WHERE id = p_fight;
  IF me IS NULL OR f.id IS NULL OR f.user_id <> me THEN RAISE EXCEPTION 'not_found'; END IF;
  IF f.status = 'live' AND EXISTS (
    SELECT 1 FROM public.boss_fight_answers WHERE fight_id = f.id AND answered_at IS NULL
      AND deadline + interval '1.5 seconds' < clock_timestamp()) THEN
    PERFORM public.boss_resolve(f.id, NULL, true);
    SELECT * INTO f FROM public.boss_fights WHERE id = p_fight;
  END IF;
  SELECT * INTO co FROM public.courses WHERE id = f.course_id;

  SELECT a.idx, a.sent_at, a.deadline, a.countdown, q.id AS qid, q.question_type, q.question_text, q.options INTO cur
  FROM public.boss_fight_answers a JOIN public.questions q ON q.id = a.question_id
  WHERE a.fight_id = f.id AND a.answered_at IS NULL AND f.status = 'live' ORDER BY a.idx DESC LIMIT 1;
  SELECT a.idx, a.is_correct, a.timed_out, a.damage, a.selected, q.correct_answers, q.explanation INTO prev
  FROM public.boss_fight_answers a JOIN public.questions q ON q.id = a.question_id
  WHERE a.fight_id = f.id AND a.answered_at IS NOT NULL ORDER BY a.idx DESC LIMIT 1;

  RETURN jsonb_build_object(
    'id', f.id, 'status', f.status, 'course_id', f.course_id, 'course_code', co.course_code,
    'topic_id', f.topic_id, 'is_daily', f.is_daily,
    'level', f.level, 'boss_name', public.boss_name(f.level, f.is_daily),
    'hearts', f.hearts, 'boss_hp', f.boss_hp, 'boss_max_hp', f.boss_max_hp,
    'streak', f.streak, 'power', f.power, 'enraged', f.boss_hp * 2 <= f.boss_max_hp,
    'xp', f.xp, 'time_ms', f.time_ms, 'server_now', clock_timestamp(),
    'answered', (SELECT count(*) FROM public.boss_fight_answers WHERE fight_id = f.id AND answered_at IS NOT NULL),
    'right', (SELECT count(*) FROM public.boss_fight_answers WHERE fight_id = f.id AND is_correct),
    'rating', (SELECT round(rating) FROM public.boss_ratings WHERE user_id = me AND course_id = f.course_id),
    'question', CASE WHEN cur.qid IS NOT NULL THEN jsonb_build_object(
      'idx', cur.idx, 'type', cur.question_type, 'starts_at', cur.sent_at, 'deadline', cur.deadline, 'countdown', cur.countdown,
      'text', CASE WHEN cur.sent_at <= clock_timestamp() THEN cur.question_text END,
      'options', CASE WHEN cur.sent_at <= clock_timestamp() THEN cur.options END) END,
    'last', CASE WHEN prev.idx IS NOT NULL THEN jsonb_build_object(
      'idx', prev.idx, 'correct', prev.is_correct, 'timed_out', prev.timed_out, 'damage', prev.damage,
      'selected', prev.selected, 'correct_answers', prev.correct_answers, 'explanation', prev.explanation) END
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_boss_fight(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_boss_fight(UUID) TO authenticated;

-- Answer the current question (p_selected null = gave up / timed out).
CREATE OR REPLACE FUNCTION public.answer_boss_fight(p_fight UUID, p_idx INTEGER, p_selected JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me UUID := auth.uid();
  f public.boss_fights%ROWTYPE;
BEGIN
  SELECT * INTO f FROM public.boss_fights WHERE id = p_fight;
  IF me IS NULL OR f.id IS NULL OR f.user_id <> me THEN RAISE EXCEPTION 'not_found'; END IF;
  IF f.status = 'live' AND EXISTS (SELECT 1 FROM public.boss_fight_answers
                                   WHERE fight_id = f.id AND idx = p_idx AND answered_at IS NULL
                                     AND sent_at <= clock_timestamp()) THEN
    PERFORM public.boss_resolve(f.id, CASE WHEN jsonb_typeof(p_selected) = 'array' THEN p_selected END, p_selected IS NULL);
  END IF;
  RETURN public.get_boss_fight(p_fight);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.answer_boss_fight(UUID, INTEGER, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.answer_boss_fight(UUID, INTEGER, JSONB) TO authenticated;

-- The boss hub for a course: level, rating, fights left, Daily Boss, trophies.
CREATE OR REPLACE FUNCTION public.get_boss_home(p_course UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  me UUID := auth.uid();
  br public.boss_ratings%ROWTYPE;
  free BOOLEAN;
  lvl INTEGER;
  daily public.boss_fights%ROWTYPE;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF coalesce(public.course_access_for(me, p_course), '') NOT IN ('free', 'paid')
     AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = me AND role IN ('admin', 'super_admin')) THEN
    RETURN jsonb_build_object('access', 'locked');
  END IF;
  SELECT * INTO br FROM public.boss_ratings WHERE user_id = me AND course_id = p_course;
  free := public.is_free_access(me, p_course);
  lvl := public.boss_level(coalesce(br.rating, 1000));
  SELECT * INTO daily FROM public.boss_fights WHERE user_id = me AND course_id = p_course AND is_daily AND daily_date = CURRENT_DATE
  ORDER BY started_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'access', 'ok', 'free', free,
    'rating', round(coalesce(br.rating, 1000)), 'level', lvl, 'boss_name', public.boss_name(lvl),
    'next_level_at', CASE WHEN lvl < 10 THEN 900 + (lvl - 1) * 100 END,
    'best_level', coalesce(br.best_level, 1), 'wins', coalesce(br.wins, 0),
    'fights_today', (SELECT count(*) FROM public.boss_fights WHERE user_id = me AND NOT is_daily AND started_at::date = CURRENT_DATE),
    'free_limit', CASE WHEN free THEN 3 END,
    'pool', (SELECT count(*) FROM public.boss_pool(me, p_course, NULL)),
    'daily', jsonb_build_object('status', coalesce(daily.status, 'open'), 'time_ms', daily.time_ms, 'fight_id', daily.id),
    'trophies', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'topic_id', NULLIF(t.topic_id, '00000000-0000-0000-0000-000000000000'),
        'topic_name', (SELECT topic_name FROM public.topics WHERE id = t.topic_id),
        'gold', t.gold, 'best_time_ms', t.best_time_ms) ORDER BY t.first_at)
      FROM public.boss_trophies t WHERE t.user_id = me AND t.course_id = p_course), '[]'::jsonb)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_boss_home(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_boss_home(UUID) TO authenticated;

-- Today's fastest Daily Boss KOs in a course (or within one classroom).
CREATE OR REPLACE FUNCTION public.get_daily_boss_board(p_course UUID, p_classroom UUID DEFAULT NULL)
RETURNS TABLE (rank INTEGER, user_id UUID, first_name TEXT, avatar_url TEXT, time_ms INTEGER, hearts INTEGER, is_me BOOLEAN)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH board AS (
    SELECT f.user_id, f.time_ms, f.hearts,
           rank() OVER (ORDER BY f.time_ms, f.hearts DESC)::int AS rnk
    FROM public.boss_fights f JOIN public.users u ON u.id = f.user_id
    WHERE f.course_id = p_course AND f.is_daily AND f.daily_date = CURRENT_DATE AND f.status = 'won'
      AND u.role = 'student' AND NOT u.is_suspended AND (u.leaderboard_visible OR u.id = auth.uid())
      AND (p_classroom IS NULL OR EXISTS (SELECT 1 FROM public.classroom_members m WHERE m.classroom_id = p_classroom AND m.user_id = f.user_id))
  )
  SELECT b.rnk, b.user_id, coalesce(nullif(split_part(btrim(u.full_name), ' ', 1), ''), 'Student'), u.avatar_url,
         b.time_ms, b.hearts, b.user_id = auth.uid()
  FROM board b JOIN public.users u ON u.id = b.user_id
  WHERE auth.uid() IS NOT NULL AND (b.rnk <= 20 OR b.user_id = auth.uid())
    AND (p_classroom IS NULL OR public.classroom_role(p_classroom) IS NOT NULL)
  ORDER BY b.rnk;
$$;
REVOKE EXECUTE ON FUNCTION public.get_daily_boss_board(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_boss_board(UUID, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ================================================================
-- EXAM BOSS TIMING — see migration 044
-- ================================================================
CREATE OR REPLACE FUNCTION public.boss_countdown(p_level INTEGER, p_enraged BOOLEAN, p_multi BOOLEAN)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_enraged THEN 16 ELSE 20 END + CASE WHEN p_multi THEN 4 ELSE 0 END;
$$;

NOTIFY pgrst, 'reload schema';

-- ================================================================
-- COURSE ACCESS LIST — see migration 045
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

-- ================================================================
-- PUSH FOR EVERY NOTIFICATION — see migration 046
-- (set-up steps are in the migration header)
-- ================================================================

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_net not enabled (%): enable it under Database > Extensions', SQLERRM;
END;
$$;

-- ── Where to send the "drain now" request ────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_settings (
  id        BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  drain_url TEXT CHECK (drain_url IS NULL OR drain_url LIKE 'https://%' OR drain_url LIKE 'http://localhost%'),
  secret    TEXT
);
INSERT INTO public.push_settings (id) VALUES (true) ON CONFLICT DO NOTHING;
ALTER TABLE public.push_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_settings FROM anon, authenticated;

-- ── The queue ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_outbox (
  notification_id UUID PRIMARY KEY REFERENCES public.notifications(id) ON DELETE CASCADE,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  claimed_at      TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_push_outbox_created ON public.push_outbox(created_at);
ALTER TABLE public.push_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_outbox FROM anon, authenticated;

-- Pushed by /api/classrooms/push already.
CREATE OR REPLACE FUNCTION public.push_skips_type(p_type TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT p_type IN ('classroom_call', 'classroom_mention');
$$;
REVOKE EXECUTE ON FUNCTION public.push_skips_type(TEXT) FROM PUBLIC, anon, authenticated;

-- Asks the site to send what's queued. Never lets a push problem undo the
-- notification itself.
CREATE OR REPLACE FUNCTION public.push_kick()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg public.push_settings%ROWTYPE;
BEGIN
  SELECT * INTO cfg FROM public.push_settings WHERE id;
  IF cfg.drain_url IS NULL OR coalesce(cfg.secret, '') = '' THEN RETURN; END IF;
  IF to_regproc('net.http_post') IS NULL THEN RETURN; END IF;
  EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 10000)'
    USING cfg.drain_url, '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', cfg.secret);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'push_kick failed: %', SQLERRM;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.push_kick() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notifications_queue_push()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n INTEGER;
BEGIN
  INSERT INTO public.push_outbox (notification_id)
  SELECT r.id FROM new_rows r
  WHERE NOT public.push_skips_type(r.type)
    AND EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.user_id = r.user_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN PERFORM public.push_kick(); END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notifications_queue_push failed: %', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notifications_queue_push() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS notifications_queue_push ON public.notifications;
CREATE TRIGGER notifications_queue_push AFTER INSERT ON public.notifications
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.notifications_queue_push();

-- ── What the drain route sends ───────────────────────────────────────
-- Takes up to p_limit queued notifications (each exactly once, even with
-- two drains running), and returns one row per device. Anything older
-- than a day is dropped instead: old news on a lock screen is noise.
-- A claim that never finished (the route crashed) is retried after two
-- minutes. unread is the student's bell count, for the app icon badge.
CREATE OR REPLACE FUNCTION public.claim_push_batch(p_limit INTEGER DEFAULT 100)
RETURNS TABLE (notification_id UUID, endpoint TEXT, p256dh TEXT, auth TEXT,
               type TEXT, message TEXT, link TEXT, unread INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.push_outbox o
  WHERE o.created_at < now() - interval '1 day'
     OR (o.claimed_at IS NOT NULL AND o.claimed_at < now() - interval '1 hour');
  -- Already read in the app, or no device left to send to.
  DELETE FROM public.push_outbox o
  USING public.notifications n
  WHERE n.id = o.notification_id
    AND (n.is_read OR NOT EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.user_id = n.user_id));

  RETURN QUERY
  WITH picked AS (
    SELECT o.notification_id FROM public.push_outbox o
    WHERE o.claimed_at IS NULL OR o.claimed_at < now() - interval '2 minutes'
    ORDER BY o.created_at
    LIMIT greatest(1, least(coalesce(p_limit, 100), 500))
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.push_outbox o SET claimed_at = now()
    FROM picked p WHERE o.notification_id = p.notification_id
    RETURNING o.notification_id
  )
  SELECT n.id, s.endpoint, s.p256dh, s.auth, n.type, n.message, n.link,
         (SELECT count(*)::int FROM public.notifications x WHERE x.user_id = n.user_id AND NOT x.is_read)
  FROM claimed c
  JOIN public.notifications n ON n.id = c.notification_id
  JOIN public.push_subscriptions s ON s.user_id = n.user_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_push_batch(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_batch(INTEGER) TO service_role;

-- Sent (or given up on): off the queue.
CREATE OR REPLACE FUNCTION public.finish_push_batch(p_ids UUID[])
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.push_outbox WHERE notification_id = ANY(p_ids);
$$;
REVOKE EXECUTE ON FUNCTION public.finish_push_batch(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_push_batch(UUID[]) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ================================================================
-- LEVEL REPS — see migration 047
-- (commission on sign-ups' payments, a discount for their sign-ups, payouts)
-- ================================================================

CREATE TABLE IF NOT EXISTS public.level_reps (
  user_id        UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  program_id     UUID REFERENCES public.programs(id) ON DELETE SET NULL,
  level          INTEGER NOT NULL CHECK (level IN (100, 200, 300, 400)),
  commission_pct NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (commission_pct BETWEEN 0 AND 50),
  discount_pct   NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 50),
  active         BOOLEAN NOT NULL DEFAULT true,
  created_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_level_reps_level ON public.level_reps(program_id, level);
ALTER TABLE public.level_reps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.level_reps FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.rep_payouts (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rep_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount     INTEGER NOT NULL CHECK (amount > 0),          -- pesewas
  note       TEXT CHECK (note IS NULL OR char_length(note) <= 200),
  paid_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  paid_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rep_payouts_rep ON public.rep_payouts(rep_id, paid_at DESC);
ALTER TABLE public.rep_payouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rep_payouts FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.rep_earnings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rep_id          UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  student_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subscription_id UUID UNIQUE REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  level           INTEGER,
  semester        INTEGER,
  paid_amount     INTEGER NOT NULL,                          -- pesewas the student paid
  commission_pct  NUMERIC(5, 2) NOT NULL,
  commission      INTEGER NOT NULL CHECK (commission >= 0),  -- pesewas
  payout_id       UUID REFERENCES public.rep_payouts(id) ON DELETE SET NULL,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rep_earnings_rep ON public.rep_earnings(rep_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rep_earnings_unpaid ON public.rep_earnings(rep_id) WHERE payout_id IS NULL;
ALTER TABLE public.rep_earnings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rep_earnings FROM anon, authenticated;

-- ── The discount a student gets ──────────────────────────────────────
-- The active rep whose code they signed up with, else 0. Used by the
-- price routes (service role) and shown to the student by
-- get_my_rep_discount.
CREATE OR REPLACE FUNCTION public.rep_discount_for(p_user UUID)
RETURNS NUMERIC
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT coalesce((
    SELECT r.discount_pct FROM public.users u
    JOIN public.level_reps r ON r.user_id = u.referred_by AND r.active
    WHERE u.id = p_user AND u.referred_by IS DISTINCT FROM p_user
  ), 0);
$$;
REVOKE EXECUTE ON FUNCTION public.rep_discount_for(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rep_discount_for(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_rep_discount()
RETURNS NUMERIC
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT public.rep_discount_for(auth.uid()) WHERE auth.uid() IS NOT NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_rep_discount() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_rep_discount() TO authenticated;

-- ── Commission on every paid unlock ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.subscriptions_rep_commission()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rep public.level_reps%ROWTYPE;
BEGIN
  IF NEW.status IS DISTINCT FROM 'active' OR coalesce(NEW.amount, 0) <= 0 THEN RETURN NULL; END IF;
  SELECT r.* INTO rep FROM public.users u
  JOIN public.level_reps r ON r.user_id = u.referred_by AND r.active
  WHERE u.id = NEW.user_id AND u.referred_by IS DISTINCT FROM NEW.user_id;
  IF rep.user_id IS NULL OR rep.commission_pct <= 0 THEN RETURN NULL; END IF;
  -- A rep paying for their own sign-ups' group unlock earns nothing on it
  -- (it would be a refund of their own money).
  IF (to_jsonb(NEW) ->> 'group_payment_id') IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.classroom_group_payments g
    WHERE g.id = (to_jsonb(NEW) ->> 'group_payment_id')::uuid AND g.payer_id = rep.user_id
  ) THEN RETURN NULL; END IF;

  INSERT INTO public.rep_earnings (rep_id, student_id, subscription_id, level, semester, paid_amount, commission_pct, commission)
  VALUES (rep.user_id, NEW.user_id, NEW.id, NEW.level, NEW.semester, NEW.amount, rep.commission_pct,
          floor(NEW.amount * rep.commission_pct / 100)::int)
  ON CONFLICT (subscription_id) DO NOTHING;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- A bookkeeping problem must never lose a payment.
  RAISE WARNING 'subscriptions_rep_commission failed: %', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.subscriptions_rep_commission() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS subscriptions_rep_commission ON public.subscriptions;
CREATE TRIGGER subscriptions_rep_commission AFTER INSERT ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.subscriptions_rep_commission();

-- ── Admin ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_level_rep(
  p_user UUID, p_program UUID, p_level INTEGER, p_commission NUMERIC, p_discount NUMERIC, p_active BOOLEAN DEFAULT true)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN RAISE EXCEPTION 'no_such_user'; END IF;
  IF p_level NOT IN (100, 200, 300, 400) THEN RAISE EXCEPTION 'bad_level'; END IF;
  IF p_commission IS NULL OR p_commission < 0 OR p_commission > 50
     OR p_discount IS NULL OR p_discount < 0 OR p_discount > 50 THEN RAISE EXCEPTION 'bad_rate'; END IF;
  INSERT INTO public.level_reps (user_id, program_id, level, commission_pct, discount_pct, active, created_by)
  VALUES (p_user, p_program, p_level, round(p_commission, 2), round(p_discount, 2), coalesce(p_active, true), auth.uid())
  ON CONFLICT (user_id) DO UPDATE SET
    program_id = EXCLUDED.program_id, level = EXCLUDED.level,
    commission_pct = EXCLUDED.commission_pct, discount_pct = EXCLUDED.discount_pct,
    active = EXCLUDED.active, updated_at = now();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_level_rep(UUID, UUID, INTEGER, NUMERIC, NUMERIC, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_level_rep(UUID, UUID, INTEGER, NUMERIC, NUMERIC, BOOLEAN) TO authenticated;

-- Every rep (active or not) with their numbers. Sign-ups = accounts made
-- with their code; paying = of those, how many have paid at least once.
CREATE OR REPLACE FUNCTION public.admin_list_level_reps()
RETURNS TABLE (user_id UUID, full_name TEXT, email TEXT, referral_code TEXT, program_id UUID, program_name TEXT,
               level INTEGER, commission_pct NUMERIC, discount_pct NUMERIC, active BOOLEAN,
               signups INTEGER, paying INTEGER, revenue BIGINT, earned BIGINT, unpaid BIGINT, paid_out BIGINT,
               created_at TIMESTAMP WITH TIME ZONE)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;
  RETURN QUERY
  SELECT r.user_id, u.full_name, u.email, u.referral_code, r.program_id, p.name, r.level,
         r.commission_pct, r.discount_pct, r.active,
         (SELECT count(*)::int FROM public.users s WHERE s.referred_by = r.user_id AND s.id <> r.user_id),
         (SELECT count(DISTINCT e.student_id)::int FROM public.rep_earnings e WHERE e.rep_id = r.user_id),
         (SELECT coalesce(sum(e.paid_amount), 0)::bigint FROM public.rep_earnings e WHERE e.rep_id = r.user_id),
         (SELECT coalesce(sum(e.commission), 0)::bigint FROM public.rep_earnings e WHERE e.rep_id = r.user_id),
         (SELECT coalesce(sum(e.commission), 0)::bigint FROM public.rep_earnings e WHERE e.rep_id = r.user_id AND e.payout_id IS NULL),
         (SELECT coalesce(sum(o.amount), 0)::bigint FROM public.rep_payouts o WHERE o.rep_id = r.user_id),
         r.created_at
  FROM public.level_reps r
  JOIN public.users u ON u.id = r.user_id
  LEFT JOIN public.programs p ON p.id = r.program_id
  ORDER BY r.level, u.full_name;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_list_level_reps() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_level_reps() TO authenticated;

-- One rep's sign-ups, newest first, with what each has paid.
CREATE OR REPLACE FUNCTION public.admin_rep_signups(p_rep UUID)
RETURNS TABLE (student_id UUID, full_name TEXT, email TEXT, level INTEGER, joined_at TIMESTAMP WITH TIME ZONE,
               paid BIGINT, commission BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;
  RETURN QUERY
  SELECT s.id, s.full_name, s.email, s.selected_level, s.created_at,
         coalesce(sum(e.paid_amount), 0)::bigint, coalesce(sum(e.commission), 0)::bigint
  FROM public.users s
  LEFT JOIN public.rep_earnings e ON e.student_id = s.id AND e.rep_id = p_rep
  WHERE s.referred_by = p_rep AND s.id <> p_rep
  GROUP BY s.id
  ORDER BY s.created_at DESC
  LIMIT 500;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_rep_signups(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_rep_signups(UUID) TO authenticated;

-- "Mark as paid": settles every unpaid commission line in one payout.
CREATE OR REPLACE FUNCTION public.admin_pay_level_rep(p_rep UUID, p_note TEXT DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  owed INTEGER;
  payout UUID;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;
  PERFORM 1 FROM public.rep_earnings WHERE rep_id = p_rep AND payout_id IS NULL FOR UPDATE;
  SELECT coalesce(sum(commission), 0) INTO owed FROM public.rep_earnings WHERE rep_id = p_rep AND payout_id IS NULL;
  IF owed <= 0 THEN RAISE EXCEPTION 'nothing_owed'; END IF;
  INSERT INTO public.rep_payouts (rep_id, amount, note, paid_by)
  VALUES (p_rep, owed, nullif(left(btrim(coalesce(p_note, '')), 200), ''), auth.uid())
  RETURNING id INTO payout;
  UPDATE public.rep_earnings SET payout_id = payout WHERE rep_id = p_rep AND payout_id IS NULL;
  INSERT INTO public.notifications (user_id, type, message, link)
  VALUES (p_rep, 'rep_payout', 'PastCS paid you GHC ' || trim(to_char(owed / 100.0, 'FM999999990.00')) || ' in Level Rep commission. Thank you!', '/rep');
  RETURN owed;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_pay_level_rep(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pay_level_rep(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_rep_payouts(p_rep UUID)
RETURNS TABLE (id UUID, amount INTEGER, note TEXT, paid_at TIMESTAMP WITH TIME ZONE, paid_by_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;
  RETURN QUERY
  SELECT o.id, o.amount, o.note, o.paid_at, a.full_name
  FROM public.rep_payouts o LEFT JOIN public.users a ON a.id = o.paid_by
  WHERE o.rep_id = p_rep ORDER BY o.paid_at DESC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_rep_payouts(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_rep_payouts(UUID) TO authenticated;

-- ── The rep's own page ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.am_i_level_rep()
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.level_reps WHERE user_id = auth.uid());
$$;
REVOKE EXECUTE ON FUNCTION public.am_i_level_rep() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.am_i_level_rep() TO authenticated;

-- Their totals, their sign-ups (first name only, and whether they've
-- paid), and their payouts. NULL for anyone who isn't a rep.
CREATE OR REPLACE FUNCTION public.get_my_rep_dashboard()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  me UUID := auth.uid();
  r public.level_reps%ROWTYPE;
BEGIN
  IF me IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO r FROM public.level_reps WHERE user_id = me;
  IF r.user_id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'active', r.active,
    'level', r.level,
    'program_name', (SELECT name FROM public.programs WHERE id = r.program_id),
    'commission_pct', r.commission_pct,
    'discount_pct', r.discount_pct,
    'referral_code', (SELECT referral_code FROM public.users WHERE id = me),
    'signups', (SELECT count(*) FROM public.users s WHERE s.referred_by = me AND s.id <> me),
    'paying', (SELECT count(DISTINCT student_id) FROM public.rep_earnings WHERE rep_id = me),
    'earned', (SELECT coalesce(sum(commission), 0) FROM public.rep_earnings WHERE rep_id = me),
    'unpaid', (SELECT coalesce(sum(commission), 0) FROM public.rep_earnings WHERE rep_id = me AND payout_id IS NULL),
    'paid_out', (SELECT coalesce(sum(amount), 0) FROM public.rep_payouts WHERE rep_id = me),
    'recent', coalesce((
      SELECT jsonb_agg(x ORDER BY x.joined_at DESC) FROM (
        SELECT coalesce(nullif(split_part(btrim(s.full_name), ' ', 1), ''), 'A student') AS first_name,
               s.selected_level AS level, s.created_at AS joined_at,
               EXISTS (SELECT 1 FROM public.rep_earnings e WHERE e.rep_id = me AND e.student_id = s.id) AS paid,
               (SELECT coalesce(sum(e.commission), 0) FROM public.rep_earnings e WHERE e.rep_id = me AND e.student_id = s.id) AS commission
        FROM public.users s
        WHERE s.referred_by = me AND s.id <> me
        ORDER BY s.created_at DESC
        LIMIT 100
      ) x), '[]'::jsonb),
    'payouts', coalesce((
      SELECT jsonb_agg(jsonb_build_object('amount', o.amount, 'paid_at', o.paid_at, 'note', o.note) ORDER BY o.paid_at DESC)
      FROM public.rep_payouts o WHERE o.rep_id = me), '[]'::jsonb)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_rep_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_rep_dashboard() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ================================================================
-- PAYING BEFORE THE SEMESTER STARTS — see migration 048
-- ================================================================

CREATE OR REPLACE FUNCTION public.paid_in_term(p_paid_at TIMESTAMP WITH TIME ZONE, p_start DATE)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_start IS NULL OR p_paid_at IS NULL
      OR p_paid_at >= ((p_start - 120)::timestamp AT TIME ZONE 'UTC');
$$;
REVOKE EXECUTE ON FUNCTION public.paid_in_term(TIMESTAMP WITH TIME ZONE, DATE) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.course_paid_for(p_user UUID, p_course UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.courses co ON co.id = p_course
    JOIN public.course_programs cp ON cp.course_id = co.id AND cp.program_id = u.program_id
    JOIN public.subscriptions s ON s.user_id = u.id AND s.status = 'active'
      AND s.level = co.level AND s.semester = co.semester AND s.program_id = u.program_id
    LEFT JOIN public.semester_end_dates t ON t.program_id = s.program_id AND t.semester = s.semester
    WHERE u.id = p_user
      AND (t.id IS NULL OR (
        now() < ((t.end_date + t.grace_days + 1)::timestamp AT TIME ZONE 'UTC')
        AND public.paid_in_term(s.paid_at, t.start_date)
      ))
  );
$$;
REVOKE EXECUTE ON FUNCTION public.course_paid_for(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.course_access_for(p_user UUID, p_course UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  u  public.users%ROWTYPE;
  co public.courses%ROWTYPE;
BEGIN
  SELECT * INTO u FROM public.users WHERE id = p_user;
  SELECT * INTO co FROM public.courses WHERE id = p_course;
  IF u.id IS NULL OR co.id IS NULL THEN RETURN 'payment_required'; END IF;

  IF u.free_course_code IS NOT NULL AND upper(u.free_course_code) = upper(co.course_code) THEN
    RETURN 'free';
  END IF;

  IF u.program_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.course_programs cp WHERE cp.course_id = co.id AND cp.program_id = u.program_id
  ) THEN
    RETURN 'wrong_program';
  END IF;

  IF u.program_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.subscriptions s
    LEFT JOIN public.semester_end_dates t ON t.program_id = s.program_id AND t.semester = s.semester
    WHERE s.user_id = p_user
      AND s.status = 'active'
      AND s.level = co.level
      AND s.semester = co.semester
      AND s.program_id = u.program_id
      AND (t.id IS NULL OR (
        now() < ((t.end_date + t.grace_days + 1)::timestamp AT TIME ZONE 'UTC')
        AND public.paid_in_term(s.paid_at, t.start_date)
      ))
  ) THEN
    RETURN 'paid';
  END IF;

  IF u.free_course_code IS NULL AND u.free_course_claimed_at IS NULL THEN RETURN 'available_free'; END IF;
  RETURN 'payment_required';
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ================================================================
-- USERS ADMIN, SPAM SIGN-UPS, DELETING ACCOUNTS — see migration 049
-- ================================================================

CREATE OR REPLACE FUNCTION public.looks_like_spam_name(p TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT p IS NOT NULL AND (
       p ~* '(https?://|www\.|bit\.ly|t\.me/|wa\.me/|tinyurl|discord\.gg|goo\.gl)'
    OR p ~* '[a-z0-9-]{2,}\.(com|net|org|ru|xyz|top|ly|io|info|biz|click|link|site|online|shop|store|vip|bet|win|tk|cn|su)([^a-z]|$)'
    OR p ~ '[<>]'
    OR char_length(p) > 80
  );
$$;
REVOKE EXECUTE ON FUNCTION public.looks_like_spam_name(TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_user_name()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF public.looks_like_spam_name(NEW.full_name)
     AND (TG_OP = 'INSERT' OR NEW.full_name IS DISTINCT FROM OLD.full_name) THEN
    RAISE EXCEPTION 'spam_name' USING HINT = 'Names can’t contain links or web addresses.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_user_name ON public.users;
CREATE TRIGGER guard_user_name BEFORE INSERT OR UPDATE OF full_name ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_name();

CREATE INDEX IF NOT EXISTS idx_users_registration_ip ON public.users(registration_ip) WHERE registration_ip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_created ON public.users(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_messages_unread_reply ON public.admin_messages(user_id) WHERE NOT is_read AND sender_id = user_id;
CREATE INDEX IF NOT EXISTS idx_feature_events_user_created ON public.feature_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tests_user_completed ON public.tests(user_id, completed_at DESC);

-- ── One filter rule, shared by the list and the counts ───────────────
CREATE OR REPLACE FUNCTION public.admin_user_matches(u public.users, p_filter TEXT)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT CASE coalesce(p_filter, 'all')
    WHEN 'all' THEN true
    WHEN 'students' THEN u.role = 'student'
    WHEN 'admins' THEN u.role IN ('admin', 'super_admin')
    WHEN 'suspended' THEN u.is_suspended
    WHEN 'suspicious' THEN public.looks_like_spam_name(u.full_name)
    WHEN 'unconfirmed' THEN EXISTS (SELECT 1 FROM auth.users a WHERE a.id = u.id AND a.email_confirmed_at IS NULL)
    WHEN 'reps' THEN EXISTS (SELECT 1 FROM public.level_reps r WHERE r.user_id = u.id)
    WHEN 'paid' THEN EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = u.id AND s.status = 'active' AND coalesce(s.amount, 0) > 0)
    WHEN 'free_pass' THEN EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = u.id AND s.status = 'active' AND s.payment_reference LIKE 'free\_pass\_%')
    WHEN 'unread' THEN EXISTS (SELECT 1 FROM public.admin_messages m WHERE m.user_id = u.id AND m.sender_id = u.id AND NOT m.is_read)
    WHEN 'shared_ip' THEN u.registration_ip IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.users o WHERE o.registration_ip = u.registration_ip AND o.id <> u.id)
    ELSE false
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_user_matches(public.users, TEXT) FROM PUBLIC, anon, authenticated;

-- A page of accounts, newest first, with what the list shows.
CREATE OR REPLACE FUNCTION public.admin_search_users(p_q TEXT DEFAULT NULL, p_filter TEXT DEFAULT 'all',
                                                     p_limit INTEGER DEFAULT 25, p_offset INTEGER DEFAULT 0)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  q TEXT := nullif(btrim(coalesce(p_q, '')), '');
  lim INTEGER := greatest(1, least(coalesce(p_limit, 25), 100));
  total INTEGER;
  rows JSONB;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;

  SELECT count(*) INTO total FROM public.users u
  WHERE public.admin_user_matches(u, p_filter)
    AND (q IS NULL OR u.full_name ILIKE '%' || q || '%' OR u.email ILIKE '%' || q || '%' OR u.id::text = q);

  SELECT coalesce(jsonb_agg(r ORDER BY r.created_at DESC, r.id), '[]'::jsonb) INTO rows FROM (
    SELECT u.id, u.email, u.full_name, u.role, u.avatar_url, u.program_id,
           p.short_code AS program_code, u.selected_level, u.selected_semester, u.created_at,
           u.is_suspended, u.total_tests_taken, u.practice_streak, u.xp,
           (a.email_confirmed_at IS NOT NULL) AS email_confirmed,
           greatest(
             (SELECT t.completed_at FROM public.tests t WHERE t.user_id = u.id ORDER BY t.completed_at DESC NULLS LAST LIMIT 1),
             (SELECT e.created_at FROM public.feature_events e WHERE e.user_id = u.id ORDER BY e.created_at DESC LIMIT 1)
           ) AS last_active,
           CASE
             WHEN EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = u.id AND s.status = 'active' AND coalesce(s.amount, 0) > 0) THEN 'paid'
             WHEN EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = u.id AND s.status = 'active' AND s.payment_reference LIKE 'free\_pass\_%') THEN 'free_pass'
             ELSE 'none'
           END AS access,
           EXISTS (SELECT 1 FROM public.admin_messages m WHERE m.user_id = u.id AND m.sender_id = u.id AND NOT m.is_read) AS unread_reply,
           CASE WHEN u.registration_ip IS NULL THEN 0
                ELSE (SELECT count(*)::int FROM public.users o WHERE o.registration_ip = u.registration_ip AND o.id <> u.id) END AS shared_ip,
           public.looks_like_spam_name(u.full_name) AS suspicious,
           (SELECT r.level FROM public.level_reps r WHERE r.user_id = u.id) AS rep_level
    FROM (
      SELECT u.id FROM public.users u
      WHERE public.admin_user_matches(u, p_filter)
        AND (q IS NULL OR u.full_name ILIKE '%' || q || '%' OR u.email ILIKE '%' || q || '%' OR u.id::text = q)
      ORDER BY u.created_at DESC, u.id
      LIMIT lim OFFSET greatest(coalesce(p_offset, 0), 0)
    ) h
    JOIN public.users u ON u.id = h.id
    LEFT JOIN public.programs p ON p.id = u.program_id
    LEFT JOIN auth.users a ON a.id = u.id
  ) r;

  RETURN jsonb_build_object('total', total, 'rows', rows);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_search_users(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_users(TEXT, TEXT, INTEGER, INTEGER) TO authenticated;

-- How many accounts each filter holds, for the filter chips.
CREATE OR REPLACE FUNCTION public.admin_user_counts()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  f TEXT;
  out JSONB := '{}'::jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;
  FOREACH f IN ARRAY ARRAY['all', 'students', 'admins', 'reps', 'paid', 'free_pass', 'unread', 'suspicious', 'shared_ip', 'unconfirmed', 'suspended'] LOOP
    out := out || jsonb_build_object(f, (SELECT count(*) FROM public.users u WHERE public.admin_user_matches(u, f)));
  END LOOP;
  RETURN out;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_user_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_user_counts() TO authenticated;

-- Everything the detail panel shows about one account.
CREATE OR REPLACE FUNCTION public.admin_user_detail(p_user UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  u public.users%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins_only'; END IF;
  SELECT * INTO u FROM public.users WHERE id = p_user;
  IF u.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'id', u.id, 'email', u.email, 'full_name', u.full_name, 'role', u.role, 'avatar_url', u.avatar_url,
    'student_id', u.student_id, 'program_id', u.program_id, 'program', u.program,
    'program_name', (SELECT name FROM public.programs WHERE id = u.program_id),
    'selected_level', u.selected_level, 'selected_semester', u.selected_semester,
    'free_course_code', u.free_course_code, 'referral_code', u.referral_code,
    'referred_by', (SELECT jsonb_build_object('id', r.id, 'name', r.full_name, 'email', r.email) FROM public.users r WHERE r.id = u.referred_by),
    'created_at', u.created_at, 'is_suspended', u.is_suspended,
    'total_tests_taken', u.total_tests_taken, 'practice_streak', u.practice_streak, 'xp', u.xp,
    'registration_ip', u.registration_ip,
    'email_confirmed_at', (SELECT email_confirmed_at FROM auth.users WHERE id = u.id),
    'last_sign_in_at', (SELECT last_sign_in_at FROM auth.users WHERE id = u.id),
    'last_active', greatest(
      (SELECT max(completed_at) FROM public.tests WHERE user_id = u.id),
      (SELECT max(created_at) FROM public.feature_events WHERE user_id = u.id)),
    'suspicious', public.looks_like_spam_name(u.full_name),
    'subscriptions', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'level', s.level, 'semester', s.semester, 'program_id', s.program_id,
                                          'program_code', pr.short_code, 'status', s.status, 'amount', s.amount,
                                          'payment_reference', s.payment_reference, 'paid_at', s.paid_at) ORDER BY s.paid_at DESC NULLS LAST)
      FROM public.subscriptions s LEFT JOIN public.programs pr ON pr.id = s.program_id WHERE s.user_id = u.id), '[]'::jsonb),
    'ip_siblings', CASE WHEN u.registration_ip IS NULL THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', o.id, 'name', o.full_name, 'email', o.email, 'suspended', o.is_suspended))
      FROM (SELECT * FROM public.users o WHERE o.registration_ip = u.registration_ip AND o.id <> u.id ORDER BY o.created_at DESC LIMIT 20) o), '[]'::jsonb) END,
    'classrooms', (SELECT count(*) FROM public.classroom_members m WHERE m.user_id = u.id),
    'rep', (SELECT jsonb_build_object('program_id', r.program_id, 'program_name', pr.name, 'level', r.level,
                                      'commission_pct', r.commission_pct, 'discount_pct', r.discount_pct, 'active', r.active,
                                      'signups', (SELECT count(*) FROM public.users s WHERE s.referred_by = r.user_id AND s.id <> r.user_id))
            FROM public.level_reps r LEFT JOIN public.programs pr ON pr.id = r.program_id WHERE r.user_id = u.id),
    'delete_blocked', public.admin_delete_blocker(auth.uid(), u.id)
  );
END;
$$;

-- Why an account can't be deleted, or NULL if it can.
CREATE OR REPLACE FUNCTION public.admin_delete_blocker(p_actor UUID, p_user UUID)
RETURNS TEXT
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN 'not_found'
    WHEN p_actor = p_user THEN 'self'
    WHEN EXISTS (SELECT 1 FROM public.users WHERE id = p_user AND role IN ('admin', 'super_admin')) THEN 'admin_account'
    WHEN EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = p_user AND coalesce(amount, 0) > 0)
      OR EXISTS (SELECT 1 FROM public.ai_tutor_credits WHERE user_id = p_user AND amount_paid > 0)
      OR EXISTS (SELECT 1 FROM public.classroom_group_payments WHERE payer_id = p_user AND status = 'paid') THEN 'has_payments'
    WHEN EXISTS (SELECT 1 FROM public.rep_earnings WHERE rep_id = p_user OR student_id = p_user)
      OR EXISTS (SELECT 1 FROM public.rep_payouts WHERE rep_id = p_user) THEN 'rep_records'
    ELSE NULL
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_delete_blocker(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_blocker(UUID, UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.admin_user_detail(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_user_detail(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
