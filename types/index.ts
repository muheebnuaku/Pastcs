// TypeScript types for the entire application

// ================================================
// DATABASE TYPES
// ================================================

export type UserRole = 'student' | 'admin';
export type QuestionType = 'single_choice' | 'multiple_choice' | 'fill_in_blank';
export type TestType = 'practice' | 'exam_simulation';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  student_id: string | null;
  role: UserRole;
  avatar_url: string | null;
  practice_streak: number;
  last_practice_date: string | null;
  total_tests_taken: number;
  xp: number;
  created_at: string;
  updated_at: string;
}

export interface Course {
  id: string;
  course_code: string;
  course_name: string;
  description: string | null;
  icon: string | null;
  color: string;
  level: 100 | 200 | 300 | 400;
  semester: 1 | 2;
  total_questions: number;
  created_at: string;
  updated_at: string;
}

export interface Topic {
  id: string;
  course_id: string;
  topic_name: string;
  description: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
  course?: Course;
}

export interface QuestionOption {
  id: string;
  text: string;
}

export interface Question {
  id: string;
  course_id: string;
  topic_id: string | null;
  question_type: QuestionType;
  question_text: string;
  options: QuestionOption[] | null;
  correct_answers: string[];
  explanation: string | null;
  difficulty: Difficulty;
  times_answered: number;
  times_correct: number;
  is_approved: boolean;
  created_at: string;
  updated_at: string;
  course?: Course;
  topic?: Topic;
}

export interface Test {
  id: string;
  user_id: string;
  course_id: string;
  topic_id: string | null;
  test_type: TestType;
  score: number;
  total_questions: number;
  percentage: number;
  time_taken: number | null;
  completed_at: string;
  created_at: string;
  course?: Course;
  topic?: Topic;
  user?: User;
}

export interface TestAnswer {
  id: string;
  test_id: string;
  question_id: string;
  selected_answer: string[] | null;
  is_correct: boolean;
  time_spent: number | null;
  created_at: string;
  question?: Question;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  criteria: {
    type: string;
    value: number;
  };
  created_at: string;
}

export interface UserAchievement {
  id: string;
  user_id: string;
  achievement_id: string;
  earned_at: string;
  achievement?: Achievement;
}

export interface LectureSlide {
  id: string;
  course_id: string;
  topic_id: string | null;
  title: string;
  content: string;
  file_url: string | null;
  questions_generated: number;
  created_at: string;
  updated_at: string;
}

// ================================================
// API TYPES
// ================================================

export interface GeneratedQuestion {
  question_type: QuestionType;
  question_text: string;
  options?: QuestionOption[];
  correct_answers: string[];
  explanation: string;
  difficulty: Difficulty;
}

export interface AIGenerationRequest {
  course_id: string;
  topic_id?: string;
  slide_text: string;
}

export interface AIGenerationResponse {
  questions: GeneratedQuestion[];
  error?: string;
}

// ================================================
// COMPONENT TYPES
// ================================================

export interface LeaderboardEntry {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  total_score: number;
  total_tests: number;
  avg_percentage: number;
}

export interface WeakTopic {
  topic_id: string;
  topic_name: string;
  course_code: string;
  total_questions: number;
  correct_answers: number;
  accuracy: number;
}

export interface TestResult {
  test: Test;
  answers: TestAnswer[];
  questions: Question[];
}

export interface ExamState {
  questions: Question[];
  currentIndex: number;
  answers: Record<string, string[]>;
  timeRemaining: number;
  isSubmitted: boolean;
}

// ================================================
// STATISTICS TYPES
// ================================================

export interface CourseStats {
  course_id: string;
  course_code: string;
  course_name: string;
  total_questions: number;
  total_tests: number;
  avg_score: number;
}

export interface AdminStats {
  total_students: number;
  total_questions: number;
  total_tests: number;
  most_difficult_topics: WeakTopic[];
}

export interface StudentStats {
  total_tests: number;
  avg_score: number;
  practice_streak: number;
  courses_practiced: number;
  recent_tests: Test[];
  weak_topics: WeakTopic[];
  achievements: UserAchievement[];
}
