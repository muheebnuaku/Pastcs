'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { trackEvent } from '@/lib/track';
import { useAuth } from '@/components/providers';
import { useSubscriptionStore } from '@/lib/store';
import { usePricing } from '@/lib/hooks/usePricing';
import { Card, Button, Badge, Modal, Progress } from '@/components/ui';
import { shuffleArray, formatTime, QUESTIONS_PER_EXAM, EXAM_DURATION_MINUTES, decodeRouteParam } from '@/lib/utils';
import { updateReviewSchedule } from '@/lib/spacedRepetition';
import { recordTestGamification } from '@/lib/gamification';
import { courseCountForProgram } from '@/lib/programs';
import { PaywallModal } from '../../courses/components/PaywallModal';
import type { Question, Course } from '@/types';
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  AlertTriangle,
  Flag,
  CheckCircle,
  Sparkles,
  Lock,
} from 'lucide-react';

export default function ExamPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { hasActiveSub } = useSubscriptionStore();

  const courseCode = decodeRouteParam(params.courseCode as string).toUpperCase();

  const [course, setCourse] = useState<Course | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  // Questions that can no longer be changed (navigated away from with Next)
  const [lockedQuestions, setLockedQuestions] = useState<Set<string>>(new Set());
  const [timeRemaining, setTimeRemaining] = useState(EXAM_DURATION_MINUTES * 60);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [showTimeWarning, setShowTimeWarning] = useState(false);
  const [examStarted, setExamStarted] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [allLevelCourses, setAllLevelCourses] = useState(0);

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const isPaid = hasActiveSub(user?.selected_level, user?.selected_semester);
  const { label: priceLabel } = usePricing(user?.selected_level);
  const isFree = courseCode === user?.free_course_code;

  const submitExam = useCallback(async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    const supabase = createClient();
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
    const isAnswerCorrect = (q: typeof questions[number]) => {
      const answer = answers[q.id] || [];
      if (q.question_type === 'fill_in_blank') {
        const userAns = norm(answer[0] ?? '');
        return (q.correct_answers ?? []).some(ca => norm(ca) === userAns);
      }
      return JSON.stringify(answer.sort()) === JSON.stringify(q.correct_answers.sort());
    };
    let score = 0;
    questions.forEach(q => { if (isAnswerCorrect(q)) score++; });

    const timeTaken = (EXAM_DURATION_MINUTES * 60) - timeRemaining;

    const { data: testData } = await supabase
      .from('tests')
      .insert({
        user_id: user?.id,
        course_id: course?.id,
        test_type: 'exam_simulation',
        score,
        total_questions: questions.length,
        percentage: (score / questions.length) * 100,
        time_taken: timeTaken,
      })
      .select()
      .single();

    if (testData) {
      const testAnswers = questions.map(q => ({
        test_id: testData.id,
        question_id: q.id,
        selected_answer: answers[q.id] || [],
        is_correct: isAnswerCorrect(q),
      }));
      await supabase.from('test_answers').insert(testAnswers);
      await supabase.rpc('update_practice_streak', { p_user_id: user?.id });
      fetch('/api/referrals/complete', { method: 'POST' }).catch(() => {});
      if (user?.id) {
        updateReviewSchedule(supabase, user.id, questions.map(q => ({ questionId: q.id, correct: isAnswerCorrect(q) }))).catch(() => {});
        recordTestGamification(supabase, user.id, {
          courseId: course!.id,
          testType: 'exam_simulation',
          score,
          totalQuestions: questions.length,
          percentage: (score / questions.length) * 100,
          timeTaken,
        }).catch(() => {});
      }
      router.push(`/results/${testData.id}`);
    }
  }, [isSubmitting, questions, answers, timeRemaining, course, user, router]);

  useEffect(() => {
    const fetchQuestions = async () => {
      const supabase = createClient();

      const { data: courseData } = await supabase
        .from('courses')
        .select('*')
        // Case-insensitive — see courses/[courseCode]/page.tsx for why.
        .ilike('course_code', courseCode)
        .single();

      if (!courseData) {
        router.push('/courses');
        return;
      }

      setCourse(courseData);
      trackEvent('exam_start', { course: courseData.course_code });

      // Access check
      if (!isPaid && !isFree) {
        router.push(`/courses/${courseCode.toLowerCase()}`);
        return;
      }

      if (user?.selected_level && user?.selected_semester && user?.program_id) {
        const { count } = await courseCountForProgram(supabase, user.program_id)
          .eq('level', user.selected_level)
          .eq('semester', user.selected_semester);
        setAllLevelCourses(count ?? 0);
      }

      const { data: questionsData } = await supabase
        .from('questions')
        .select('*')
        .eq('course_id', courseData.id)
        .eq('is_approved', true)
        .limit(100);

      if (questionsData && questionsData.length > 0) {
        const shuffled = shuffleArray(questionsData as Question[]).slice(0, QUESTIONS_PER_EXAM);
        setQuestions(shuffled);
      }
    };

    fetchQuestions();
  }, [courseCode, router, isPaid, isFree, user?.selected_level, user?.selected_semester, user?.program_id]);

  useEffect(() => {
    if (!examStarted || isSubmitting) return;
    timerRef.current = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          submitExam();
          return 0;
        }
        if (prev === 300 && !showTimeWarning) setShowTimeWarning(true);
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [examStarted, isSubmitting, showTimeWarning, submitExam]);

  const currentQuestion = questions[currentIndex];

  const handleSelectAnswer = (optionId: string) => {
    if (lockedQuestions.has(currentQuestion.id)) return; // locked
    const currentAnswer = answers[currentQuestion.id] || [];
    if (currentQuestion.question_type === 'single_choice') {
      setAnswers({ ...answers, [currentQuestion.id]: [optionId] });
    } else if (currentQuestion.question_type === 'multiple_choice') {
      if (currentAnswer.includes(optionId)) {
        setAnswers({ ...answers, [currentQuestion.id]: currentAnswer.filter(id => id !== optionId) });
      } else {
        setAnswers({ ...answers, [currentQuestion.id]: [...currentAnswer, optionId] });
      }
    }
  };

  const handleFillBlank = (value: string) => {
    if (lockedQuestions.has(currentQuestion.id)) return; // locked
    setAnswers({ ...answers, [currentQuestion.id]: [value] });
  };

  const answeredCount = Object.keys(answers).filter(id => answers[id]?.length > 0).length;

  if (!examStarted) {
    return (
      <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
        {/* Pre-exam upgrade banner */}
        {isFree && !isPaid && allLevelCourses > 1 && (
          <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-blue-800 dark:text-blue-300">
              <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
              <span>
                <span className="font-medium">Free course.</span>{' '}
                Unlock {allLevelCourses - 1} more for just {priceLabel}.
              </span>
            </div>
            <button
              onClick={() => setShowPaywall(true)}
              className="flex-shrink-0 text-xs font-medium text-blue-700 dark:text-blue-400 border border-blue-300 dark:border-blue-500/30 px-2.5 py-1.5 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-500/15"
            >
              Upgrade →
            </button>
          </div>
        )}

        <Card className="p-8 text-center">
          <div className="w-20 h-20 bg-purple-100 dark:bg-purple-500/15 rounded-full flex items-center justify-center mx-auto mb-6">
            <Clock className="w-10 h-10 text-purple-600 dark:text-purple-400" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2 dark:text-gray-100">Exam Simulation</h1>
          <p className="text-gray-600 mb-6 dark:text-gray-400">{course?.course_code} - {course?.course_name}</p>

          <div className="bg-gray-50 rounded-xl p-6 mb-6 text-left dark:bg-white/[0.03]">
            <h2 className="font-semibold text-gray-900 mb-4 dark:text-gray-100">Exam Rules:</h2>
            <ul className="space-y-2 text-gray-600 dark:text-gray-400">
              <li className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                {questions.length} questions to answer
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                {EXAM_DURATION_MINUTES} minutes time limit
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                Auto-submit when time runs out
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                Navigate between questions freely
              </li>
              <li className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-500" />
                No feedback until exam is submitted
              </li>
            </ul>
          </div>

          <Button size="lg" onClick={() => setExamStarted(true)} className="w-full">
            Start Exam
          </Button>
        </Card>

        {showPaywall && course && (
          <PaywallModal
            courseName={course.course_name}
            courseCode={course.course_code}
            totalCourses={allLevelCourses}
            onClose={() => setShowPaywall(false)}
            onSuccess={() => setShowPaywall(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      {/* Sticky Header */}
      <div className="sticky top-0 z-10 bg-gray-50 py-4 -mx-6 px-6 dark:bg-white/[0.03]">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <Badge variant="info">{course?.course_code}</Badge>
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full font-mono font-semibold ${
            timeRemaining <= 300 ? 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400' : 'bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-300'
          }`}>
            <Clock className="w-4 h-4" />
            {formatTime(timeRemaining)}
          </div>
          <Badge variant={answeredCount === questions.length ? 'success' : 'default'}>
            {answeredCount}/{questions.length} answered
          </Badge>
        </div>
        <Progress value={answeredCount} max={questions.length} color="blue" size="sm" />
      </div>

      {/* Question Card */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <Badge variant="default">Question {currentIndex + 1}</Badge>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={
              currentQuestion.question_type === 'single_choice' ? 'default' :
              currentQuestion.question_type === 'multiple_choice' ? 'info' : 'warning'
            }>
              {currentQuestion.question_type === 'single_choice' && 'Single Choice'}
              {currentQuestion.question_type === 'multiple_choice' && 'Multiple Choice (Select all)'}
              {currentQuestion.question_type === 'fill_in_blank' && 'Fill in the Blank'}
            </Badge>
            {lockedQuestions.has(currentQuestion.id) && (
              <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                <Lock className="w-3 h-3" /> Locked
              </span>
            )}
          </div>
        </div>

        <h2 className="text-lg font-medium text-gray-900 mb-6 dark:text-gray-100">{currentQuestion.question_text}</h2>

        {currentQuestion.question_type !== 'fill_in_blank' && currentQuestion.options && (
          <div className="space-y-3">
            {currentQuestion.options.map((option) => {
              const isSelected = (answers[currentQuestion.id] || []).includes(option.id);
              const isLocked = lockedQuestions.has(currentQuestion.id);
              return (
                <button
                  key={option.id}
                  onClick={() => handleSelectAnswer(option.id)}
                  disabled={isLocked}
                  className={`w-full p-4 border-2 rounded-xl text-left transition-colors flex items-center gap-3 disabled:cursor-not-allowed ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
                      : 'border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.03] hover:bg-gray-100 dark:hover:bg-white/5'
                  } ${isLocked ? 'opacity-80' : ''}`}
                >
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    isSelected ? 'border-blue-500 bg-blue-500' : 'border-gray-300 dark:border-white/20'
                  }`}>
                    {isSelected && (
                      currentQuestion.question_type === 'single_choice'
                        ? <div className="w-2 h-2 bg-white rounded-full" />
                        : <CheckCircle className="w-4 h-4 text-white" />
                    )}
                  </div>
                  <span className="text-gray-900 dark:text-gray-100">{option.text}</span>
                </button>
              );
            })}
          </div>
        )}

        {currentQuestion.question_type === 'fill_in_blank' && (
          <input
            type="text"
            placeholder="Type your answer..."
            value={answers[currentQuestion.id]?.[0] || ''}
            onChange={(e) => handleFillBlank(e.target.value)}
            disabled={lockedQuestions.has(currentQuestion.id)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className={`w-full p-4 border-2 border-gray-200 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-80 ${
              lockedQuestions.has(currentQuestion.id) ? 'bg-gray-50 dark:bg-white/5' : ''
            }`}
          />
        )}
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
          disabled={currentIndex === 0}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Previous
        </Button>
        <div className="flex gap-3">
          {currentIndex < questions.length - 1 ? (
            <Button onClick={() => {
              // Lock current question when moving forward
              if (answers[currentQuestion.id]?.length > 0) {
                setLockedQuestions(prev => new Set([...prev, currentQuestion.id]));
              }
              setCurrentIndex(currentIndex + 1);
            }}>
              Next <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <Button onClick={() => setShowSubmitModal(true)} className="bg-green-600 hover:bg-green-700">
              <Flag className="w-4 h-4 mr-2" />
              Submit Exam
            </Button>
          )}
        </div>
      </div>

      {/* Question Navigator */}
      <Card className="p-4">
        <p className="text-sm text-gray-600 mb-3 dark:text-gray-400">Question Navigator:</p>
        <div className="flex flex-wrap gap-2">
          {questions.map((q, idx) => {
            const hasAnswer = answers[q.id]?.length > 0;
            const isLocked = lockedQuestions.has(q.id);
            return (
              <button
                key={q.id}
                onClick={() => setCurrentIndex(idx)}
                className={`w-10 h-10 rounded-lg text-sm font-medium transition-colors relative ${
                  idx === currentIndex ? 'bg-blue-600 text-white'
                  : isLocked ? 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400 border border-green-300 dark:border-green-500/30 opacity-75'
                  : hasAnswer ? 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400 border border-green-300 dark:border-green-500/30'
                  : 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/15'
                }`}
              >
                {idx + 1}
                {isLocked && (
                  <Lock className="w-2.5 h-2.5 absolute -top-1 -right-1 text-gray-500 dark:text-gray-300 bg-white dark:bg-gray-700 rounded-full p-0.5 shadow-sm" />
                )}
              </button>
            );
          })}
        </div>
      </Card>

      <Modal isOpen={showSubmitModal} onClose={() => setShowSubmitModal(false)} title="Submit Exam?">
        <div className="space-y-4">
          <p className="text-gray-600 dark:text-gray-400">
            You have answered <strong>{answeredCount}</strong> out of <strong>{questions.length}</strong> questions.
          </p>
          {answeredCount < questions.length && (
            <div className="p-4 bg-yellow-50 dark:bg-yellow-500/10 rounded-lg flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-yellow-800 dark:text-yellow-300">
                You have {questions.length - answeredCount} unanswered questions. Are you sure you want to submit?
              </p>
            </div>
          )}
          <div className="flex gap-3 pt-4">
            <Button variant="outline" className="flex-1" onClick={() => setShowSubmitModal(false)}>
              Continue Exam
            </Button>
            <Button className="flex-1 bg-green-600 hover:bg-green-700" onClick={() => submitExam()} isLoading={isSubmitting}>
              Submit Exam
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showTimeWarning} onClose={() => setShowTimeWarning(false)} title="⚠️ Time Warning">
        <p className="text-gray-600 mb-4 dark:text-gray-400">
          You have <strong>5 minutes</strong> remaining! The exam will auto-submit when time runs out.
        </p>
        <Button className="w-full" onClick={() => setShowTimeWarning(false)}>Continue</Button>
      </Modal>
    </div>
  );
}
