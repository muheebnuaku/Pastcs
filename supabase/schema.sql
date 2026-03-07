-- ================================================
-- PASTCS - Exam Practice Platform Database Schema
-- University of Ghana - Level 100 IT Students
-- ================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ================================================
-- USERS TABLE
-- ================================================
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  student_id TEXT,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  avatar_url TEXT,
  practice_streak INTEGER DEFAULT 0,
  last_practice_date DATE,
  total_tests_taken INTEGER DEFAULT 0,
  xp INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ================================================
-- COURSES TABLE
-- ================================================
CREATE TABLE courses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_code TEXT NOT NULL UNIQUE,
  course_name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  color TEXT DEFAULT '#3B82F6',
  total_questions INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ================================================
-- TOPICS TABLE
-- ================================================
CREATE TABLE topics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  topic_name TEXT NOT NULL,
  description TEXT,
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ================================================
-- QUESTIONS TABLE
-- ================================================
CREATE TABLE questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
  question_type TEXT NOT NULL CHECK (question_type IN ('single_choice', 'multiple_choice', 'fill_blank')),
  question_text TEXT NOT NULL,
  options JSONB, -- Array of option objects: [{id: string, text: string}]
  correct_answers JSONB NOT NULL, -- Array of correct answer ids or strings for fill_blank
  explanation TEXT,
  difficulty TEXT DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  times_answered INTEGER DEFAULT 0,
  times_correct INTEGER DEFAULT 0,
  is_approved BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ================================================
-- TESTS TABLE
-- ================================================
CREATE TABLE tests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
  test_type TEXT NOT NULL CHECK (test_type IN ('practice', 'exam_simulation')),
  score INTEGER NOT NULL,
  total_questions INTEGER NOT NULL,
  percentage DECIMAL(5,2),
  time_taken INTEGER, -- in seconds
  completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ================================================
-- TEST ANSWERS TABLE
-- ================================================
CREATE TABLE test_answers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_answer JSONB, -- Array of selected option ids or text for fill_blank
  is_correct BOOLEAN NOT NULL,
  time_spent INTEGER, -- in seconds
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ================================================
-- ACHIEVEMENTS TABLE
-- ================================================
CREATE TABLE achievements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  icon TEXT NOT NULL,
  criteria JSONB NOT NULL, -- {type: string, value: number}
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ================================================
-- USER ACHIEVEMENTS TABLE
-- ================================================
CREATE TABLE user_achievements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id UUID NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  earned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, achievement_id)
);

-- ================================================
-- LECTURE SLIDES TABLE (for AI generation)
-- ================================================
CREATE TABLE lecture_slides (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  file_url TEXT,
  questions_generated INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ================================================
-- INSERT DEFAULT COURSES
-- ================================================
INSERT INTO courses (course_code, course_name, description, color) VALUES
  ('DCIT101', 'Introduction to Computer Science', 'Fundamental concepts of computer science including algorithms, data structures, and programming basics.', '#3B82F6'),
  ('DCIT103', 'Office Productivity Tools', 'Master essential office applications including word processing, spreadsheets, and presentations.', '#10B981'),
  ('DCIT105', 'Mathematics for IT Professionals', 'Mathematical foundations including discrete mathematics, logic, and number systems.', '#8B5CF6'),
  ('ECON101', 'Introduction to Economics I', 'Basic economic principles including microeconomics and market dynamics.', '#F59E0B'),
  ('STAT111', 'Introduction to Statistics and Probability I', 'Statistical concepts, probability theory, and data analysis fundamentals.', '#EF4444'),
  ('UGRC150', 'Critical Thinking and Practical Reasoning', 'Develop logical reasoning, critical analysis, and argumentation skills.', '#EC4899');

-- ================================================
-- INSERT DEFAULT ACHIEVEMENTS
-- ================================================
INSERT INTO achievements (name, description, icon, criteria) VALUES
  ('First Practice Test', 'Complete your first practice test', 'trophy', '{"type": "tests_completed", "value": 1}'),
  ('10 Tests Completed', 'Complete 10 practice tests', 'medal', '{"type": "tests_completed", "value": 10}'),
  ('50 Tests Completed', 'Complete 50 practice tests', 'star', '{"type": "tests_completed", "value": 50}'),
  ('Top Performer', 'Score 100% on any test', 'crown', '{"type": "perfect_score", "value": 1}'),
  ('Week Warrior', 'Maintain a 7-day practice streak', 'flame', '{"type": "streak", "value": 7}'),
  ('Month Master', 'Maintain a 30-day practice streak', 'fire', '{"type": "streak", "value": 30}'),
  ('Quick Learner', 'Complete a test in under 5 minutes', 'zap', '{"type": "speed", "value": 300}'),
  ('All-Rounder', 'Practice all 6 courses', 'globe', '{"type": "courses_practiced", "value": 6}');

-- ================================================
-- SAMPLE TOPICS FOR EACH COURSE
-- ================================================

-- DCIT101 Topics
INSERT INTO topics (course_id, topic_name, description, order_index)
SELECT id, 'Introduction to Computing', 'Basic computing concepts and history', 1 FROM courses WHERE course_code = 'DCIT101';
INSERT INTO topics (course_id, topic_name, description, order_index)
SELECT id, 'Number Systems', 'Binary, octal, decimal, and hexadecimal systems', 2 FROM courses WHERE course_code = 'DCIT101';
INSERT INTO topics (course_id, topic_name, description, order_index)
SELECT id, 'Boolean Algebra', 'Logic gates and boolean expressions', 3 FROM courses WHERE course_code = 'DCIT101';
INSERT INTO topics (course_id, topic_name, description, order_index)
SELECT id, 'Computer Hardware', 'CPU, memory, storage, and peripherals', 4 FROM courses WHERE course_code = 'DCIT101';
INSERT INTO topics (course_id, topic_name, description, order_index)
SELECT id, 'Software Concepts', 'Operating systems and application software', 5 FROM courses WHERE course_code = 'DCIT101';

-- DCIT103 Topics
INSERT INTO topics (course_id, topic_name, description, order_index)
SELECT id, 'Word Processing', 'Microsoft Word fundamentals', 1 FROM courses WHERE course_code = 'DCIT103';
INSERT INTO topics (course_id, topic_name, description, order_index)
SELECT id, 'Spreadsheets', 'Microsoft Excel basics and formulas', 2 FROM courses WHERE course_code = 'DCIT103';
INSERT INTO topics (course_id, topic_name, description, order_index)
SELECT id, 'Presentations', 'Microsoft PowerPoint essentials', 3 FROM courses WHERE course_code = 'DCIT103';
INSERT INTO topics (course_id, topic_name, description, order_index)
SELECT id, 'Database Basics', 'Introduction to Microsoft Access', 4 FROM courses WHERE course_code = 'DCIT103';

-- DCIT105 Topics
INSERT INTO topics (course_id, topic_name, description, order_index)
SELECT id, 'Number Theory', 'Prime numbers and divisibility', 1 FROM courses WHERE course_code = 'DCIT105';
INSERT INTO topics (course_id, topic_name, description, order_index)
SELECT id, 'Set Theory', 'Sets, subsets, and operations', 2 FROM courses WHERE course_code = 'DCIT105';
INSERT INTO topics (course_id, topic_name, description, order_index)
SELECT id, 'Logic', 'Propositional and predicate logic', 3 FROM courses WHERE course_code = 'DCIT105';
INSERT INTO topics (course_id, topic_name, description, order_index)
SELECT id, 'Relations and Functions', 'Mathematical relations and functions', 4 FROM courses WHERE course_code = 'DCIT105';

-- ECON101 Topics
INSERT INTO topics (course_id, topic_name, description, order_index)
SELECT id, 'Basic Economic Concepts', 'Scarcity, choice, and opportunity cost', 1 FROM courses WHERE course_code = 'ECON101';
INSERT INTO topics (course_id, topic_name, description, order_index)
SELECT id, 'Demand and Supply', 'Market equilibrium and price determination', 2 FROM courses WHERE course_code = 'ECON101';
INSERT INTO topics (course_id, topic_name, description, order_index)
SELECT id, 'Elasticity', 'Price and income elasticity', 3 FROM courses WHERE course_code = 'ECON101';
INSERT INTO topics (course_id, topic_name, description, order_index)
SELECT id, 'Market Structures', 'Perfect competition and monopoly', 4 FROM courses WHERE course_code = 'ECON101';

-- STAT111 Topics
INSERT INTO topics (course_id, topic_name, description, order_index)
SELECT id, 'Descriptive Statistics', 'Mean, median, mode, and standard deviation', 1 FROM courses WHERE course_code = 'STAT111';
INSERT INTO topics (course_id, topic_name, description, order_index)
SELECT id, 'Probability Basics', 'Probability rules and calculations', 2 FROM courses WHERE course_code = 'STAT111';
INSERT INTO topics (course_id, topic_name, description, order_index)
SELECT id, 'Probability Distributions', 'Normal and binomial distributions', 3 FROM courses WHERE course_code = 'STAT111';
INSERT INTO topics (course_id, topic_name, description, order_index)
SELECT id, 'Sampling', 'Sampling methods and sampling distributions', 4 FROM courses WHERE course_code = 'STAT111';

-- UGRC150 Topics
INSERT INTO topics (course_id, topic_name, description, order_index)
SELECT id, 'Introduction to Logic', 'Basic logical reasoning', 1 FROM courses WHERE course_code = 'UGRC150';
INSERT INTO topics (course_id, topic_name, description, order_index)
SELECT id, 'Arguments and Fallacies', 'Identifying valid arguments and fallacies', 2 FROM courses WHERE course_code = 'UGRC150';
INSERT INTO topics (course_id, topic_name, description, order_index)
SELECT id, 'Critical Analysis', 'Evaluating sources and evidence', 3 FROM courses WHERE course_code = 'UGRC150';
INSERT INTO topics (course_id, topic_name, description, order_index)
SELECT id, 'Problem Solving', 'Systematic problem-solving approaches', 4 FROM courses WHERE course_code = 'UGRC150';

-- ================================================
-- ROW LEVEL SECURITY POLICIES
-- ================================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE lecture_slides ENABLE ROW LEVEL SECURITY;

-- Users policies
CREATE POLICY "Users can view their own profile"
  ON users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON users FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Admins can view all users"
  ON users FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Courses policies (public read)
CREATE POLICY "Anyone can view courses"
  ON courses FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage courses"
  ON courses FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Topics policies (public read)
CREATE POLICY "Anyone can view topics"
  ON topics FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage topics"
  ON topics FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Questions policies
CREATE POLICY "Students can view approved questions"
  ON questions FOR SELECT
  TO authenticated
  USING (is_approved = true);

CREATE POLICY "Admins can manage questions"
  ON questions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Tests policies
CREATE POLICY "Users can view their own tests"
  ON tests FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create tests"
  ON tests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all tests"
  ON tests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Test answers policies
CREATE POLICY "Users can view their own test answers"
  ON test_answers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tests WHERE tests.id = test_id AND tests.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create test answers"
  ON test_answers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tests WHERE tests.id = test_id AND tests.user_id = auth.uid()
    )
  );

-- Achievements policies (public read)
CREATE POLICY "Anyone can view achievements"
  ON achievements FOR SELECT
  TO authenticated
  USING (true);

-- User achievements policies
CREATE POLICY "Users can view their own achievements"
  ON user_achievements FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "System can grant achievements"
  ON user_achievements FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Lecture slides policies
CREATE POLICY "Admins can manage lecture slides"
  ON lecture_slides FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ================================================
-- FUNCTIONS
-- ================================================

-- Function to handle new user creation
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'student')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create user profile on signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Function to update practice streak
CREATE OR REPLACE FUNCTION update_practice_streak(p_user_id UUID)
RETURNS void AS $$
DECLARE
  last_date DATE;
  current_streak INTEGER;
BEGIN
  SELECT last_practice_date, practice_streak INTO last_date, current_streak
  FROM users WHERE id = p_user_id;
  
  IF last_date IS NULL OR last_date < CURRENT_DATE - INTERVAL '1 day' THEN
    -- Reset streak if more than 1 day gap
    UPDATE users SET practice_streak = 1, last_practice_date = CURRENT_DATE
    WHERE id = p_user_id;
  ELSIF last_date = CURRENT_DATE - INTERVAL '1 day' THEN
    -- Increment streak
    UPDATE users SET practice_streak = current_streak + 1, last_practice_date = CURRENT_DATE
    WHERE id = p_user_id;
  ELSIF last_date < CURRENT_DATE THEN
    -- Same logic for any past date
    UPDATE users SET practice_streak = 1, last_practice_date = CURRENT_DATE
    WHERE id = p_user_id;
  END IF;
  -- If last_date = CURRENT_DATE, do nothing (already practiced today)
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get leaderboard
CREATE OR REPLACE FUNCTION get_leaderboard(p_course_id UUID DEFAULT NULL, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
  user_id UUID,
  full_name TEXT,
  avatar_url TEXT,
  total_score BIGINT,
  total_tests BIGINT,
  avg_percentage DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.id as user_id,
    u.full_name,
    u.avatar_url,
    COALESCE(SUM(t.score), 0)::BIGINT as total_score,
    COUNT(t.id)::BIGINT as total_tests,
    COALESCE(AVG(t.percentage), 0)::DECIMAL as avg_percentage
  FROM users u
  LEFT JOIN tests t ON u.id = t.user_id
  WHERE u.role = 'student'
    AND (p_course_id IS NULL OR t.course_id = p_course_id)
  GROUP BY u.id, u.full_name, u.avatar_url
  ORDER BY total_score DESC, avg_percentage DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get weak topics for a user
CREATE OR REPLACE FUNCTION get_weak_topics(p_user_id UUID, p_limit INTEGER DEFAULT 5)
RETURNS TABLE (
  topic_id UUID,
  topic_name TEXT,
  course_code TEXT,
  total_questions INTEGER,
  correct_answers INTEGER,
  accuracy DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.id as topic_id,
    t.topic_name,
    c.course_code,
    COUNT(ta.id)::INTEGER as total_questions,
    SUM(CASE WHEN ta.is_correct THEN 1 ELSE 0 END)::INTEGER as correct_answers,
    (SUM(CASE WHEN ta.is_correct THEN 1 ELSE 0 END)::DECIMAL / NULLIF(COUNT(ta.id), 0) * 100)::DECIMAL as accuracy
  FROM topics t
  JOIN questions q ON t.id = q.topic_id
  JOIN test_answers ta ON q.id = ta.question_id
  JOIN tests ts ON ta.test_id = ts.id
  JOIN courses c ON t.course_id = c.id
  WHERE ts.user_id = p_user_id
  GROUP BY t.id, t.topic_name, c.course_code
  HAVING COUNT(ta.id) >= 3
  ORDER BY accuracy ASC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================
-- INDEXES
-- ================================================

CREATE INDEX idx_questions_course ON questions(course_id);
CREATE INDEX idx_questions_topic ON questions(topic_id);
CREATE INDEX idx_questions_approved ON questions(is_approved);
CREATE INDEX idx_tests_user ON tests(user_id);
CREATE INDEX idx_tests_course ON tests(course_id);
CREATE INDEX idx_test_answers_test ON test_answers(test_id);
CREATE INDEX idx_test_answers_question ON test_answers(question_id);
CREATE INDEX idx_topics_course ON topics(course_id);
CREATE INDEX idx_user_achievements_user ON user_achievements(user_id);
