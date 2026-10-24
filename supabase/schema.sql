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
