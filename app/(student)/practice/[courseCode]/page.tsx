'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers';
import { useSubscriptionStore } from '@/lib/store';
import { Card, Button, Badge, Progress } from '@/components/ui';
import { shuffleArray, QUESTIONS_PER_PRACTICE } from '@/lib/utils';
import type { Question, Course } from '@/types';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  XCircle,
  Flag,
  BookOpen,
  Sparkles,
  PauseCircle,
  Lock,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { PaywallModal } from '../../courses/components/PaywallModal';

// ── Pause/resume ────────────────────────────────────────────────────────────

interface PausedState {
  questionIds: string[];
  answers: Record<string, string[]>;
  checkedQuestions: string[];
  semanticResults: Record<string, boolean>;
  currentIndex: number;
  savedAt: string;
}

function storageKey(courseCode: string, topicId: string | null) {
  return `pastcs_practice_${courseCode}_${topicId ?? 'all'}`;
}

// ── Page wrapper ────────────────────────────────────────────────────────────

export default function PracticePage() {
  return (
    <Suspense>
      <PracticeContent />
    </Suspense>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

function PracticeContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const { hasActiveSub } = useSubscriptionStore();

  const courseCode = (params.courseCode as string).toUpperCase();
  const topicId = searchParams.get('topic');

  const [course, setCourse] = useState<Course | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});

  // Set of question IDs where feedback has been revealed — locks them
  const [checkedQuestions, setCheckedQuestions] = useState<Set<string>>(new Set());
  // AI-verified correctness for fill_in_blank questions
  const [semanticResults, setSemanticResults] = useState<Record<string, boolean>>({});
  // Loading while AI grades a fill_in_blank answer
  const [isFillChecking, setIsFillChecking] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [showPaywall, setShowPaywall] = useState(false);
  const [allLevelCourses, setAllLevelCourses] = useState(0);
  const [resumeOffer, setResumeOffer] = useState<PausedState | null>(null);
  const [isLoadingResume, setIsLoadingResume] = useState(false);

  const isPaid = hasActiveSub(user?.selected_level, user?.selected_semester);
  const isFree = courseCode === user?.free_course_code;

  // Keep a ref so the auto-save effect always has fresh values
  const stateForSave = useRef({ questions, answers, checkedQuestions, semanticResults, currentIndex });
  useEffect(() => {
    stateForSave.current = { questions, answers, checkedQuestions, semanticResults, currentIndex };
  });

  // ── Auto-save ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (questions.length === 0) return;
    const state: PausedState = {
      questionIds: questions.map(q => q.id),
      answers,
      checkedQuestions: [...checkedQuestions],
      semanticResults,
      currentIndex,
      savedAt: new Date().toISOString(),
    };
    try { localStorage.setItem(storageKey(courseCode, topicId), JSON.stringify(state)); } catch { /* ignore */ }
  }, [questions, answers, checkedQuestions, semanticResults, currentIndex, courseCode, topicId]);

  // ── Fetch fresh questions ────────────────────────────────────────────────────
  const fetchFresh = useCallback(async () => {
    const supabase = createClient();
    const { data: courseData } = await supabase
      .from('courses').select('*').eq('course_code', courseCode).single();

    if (!courseData) { router.push('/courses'); return; }
    setCourse(courseData);

    if (!isPaid && !isFree) { router.push(`/courses/${courseCode.toLowerCase()}`); return; }

    if (user?.selected_level && user?.selected_semester) {
      const { count } = await supabase.from('courses')
        .select('id', { count: 'exact', head: true })
        .eq('level', user.selected_level).eq('semester', user.selected_semester);
      setAllLevelCourses(count ?? 0);
    }

    let query = supabase.from('questions').select('*')
      .eq('course_id', courseData.id).eq('is_approved', true);
    if (topicId) query = query.eq('topic_id', topicId);

    const { data: qs } = await query.limit(200);
    if (qs && qs.length > 0) {
      const shuffled = shuffleArray(qs as unknown as Question[]).slice(0, QUESTIONS_PER_PRACTICE);
      setQuestions(shuffled);
    }
  }, [courseCode, topicId, router, isPaid, isFree, user?.selected_level, user?.selected_semester]);

  // ── Initial load: detect saved session ─────────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(courseCode, topicId));
      if (raw) {
        const saved = JSON.parse(raw) as PausedState;
        if (saved.questionIds?.length > 0) { setResumeOffer(saved); return; }
      }
    } catch { /* corrupt */ }
    fetchFresh();
  }, [courseCode, topicId, fetchFresh]);

  // ── Resume ──────────────────────────────────────────────────────────────────
  const handleResume = async () => {
    if (!resumeOffer) return;
    setIsLoadingResume(true);
    try {
      const supabase = createClient();
      const { data: courseData } = await supabase
        .from('courses').select('*').eq('course_code', courseCode).single();
      if (courseData) setCourse(courseData);

      if (user?.selected_level && user?.selected_semester) {
        const { count } = await supabase.from('courses')
          .select('id', { count: 'exact', head: true })
          .eq('level', user.selected_level).eq('semester', user.selected_semester);
        setAllLevelCourses(count ?? 0);
      }

      const { data: qs } = await supabase.from('questions').select('*').in('id', resumeOffer.questionIds);
      if (qs) {
        const ordered = resumeOffer.questionIds
          .map(id => (qs as unknown as Question[]).find(q => q.id === id))
          .filter(Boolean) as Question[];
        setQuestions(ordered);
        setAnswers(resumeOffer.answers);
        setCheckedQuestions(new Set(resumeOffer.checkedQuestions));
        setSemanticResults(resumeOffer.semanticResults);
        setCurrentIndex(Math.min(resumeOffer.currentIndex, ordered.length - 1));
      }
    } finally {
      setIsLoadingResume(false);
      setResumeOffer(null);
    }
  };

  const handleStartFresh = () => {
    localStorage.removeItem(storageKey(courseCode, topicId));
    setResumeOffer(null);
    fetchFresh();
  };

  const handlePause = () => router.push('/courses');

  // ── Derived ─────────────────────────────────────────────────────────────────
  const currentQuestion = questions[currentIndex];
  const showFeedback = currentQuestion ? checkedQuestions.has(currentQuestion.id) : false;
  const isAnswered = !!(currentQuestion && (answers[currentQuestion.id]?.length ?? 0) > 0);

  const getIsCorrect = useCallback((q: Question) => {
    if (q.question_type === 'fill_in_blank') return semanticResults[q.id] ?? false;
    const answer = answers[q.id] ?? [];
    return JSON.stringify([...answer].sort()) === JSON.stringify([...q.correct_answers].sort());
  }, [answers, semanticResults]);

  const isCorrect = showFeedback && currentQuestion ? getIsCorrect(currentQuestion) : false;

  // ── Answer handlers ─────────────────────────────────────────────────────────
  const handleSelectAnswer = (optionId: string) => {
    if (showFeedback) return;
    if (currentQuestion.question_type === 'single_choice') {
      setAnswers(prev => ({ ...prev, [currentQuestion.id]: [optionId] }));
    } else {
      const cur = answers[currentQuestion.id] ?? [];
      setAnswers(prev => ({
        ...prev,
        [currentQuestion.id]: cur.includes(optionId)
          ? cur.filter(id => id !== optionId)
          : [...cur, optionId],
      }));
    }
  };

  const handleFillBlank = (value: string) => {
    if (showFeedback) return;
    setAnswers(prev => ({ ...prev, [currentQuestion.id]: [value] }));
  };

  // ── Check Answer (with AI semantic grading for fill_in_blank) ───────────────
  const handleCheckAnswer = async () => {
    if (!currentQuestion || !isAnswered) return;

    if (currentQuestion.question_type === 'fill_in_blank') {
      setIsFillChecking(true);
      try {
        const res = await fetch('/api/check-answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentAnswer: answers[currentQuestion.id]?.[0] ?? '',
            correctAnswer: currentQuestion.correct_answers[0] ?? '',
            questionText: currentQuestion.question_text,
          }),
        });
        const { isCorrect: correct } = await res.json() as { isCorrect: boolean };
        setSemanticResults(prev => ({ ...prev, [currentQuestion.id]: correct }));
      } catch {
        // Fallback: normalised string compare
        const s = (answers[currentQuestion.id]?.[0] ?? '').trim().toLowerCase();
        const c = (currentQuestion.correct_answers[0] ?? '').trim().toLowerCase();
        setSemanticResults(prev => ({ ...prev, [currentQuestion.id]: s === c }));
      } finally {
        setIsFillChecking(false);
      }
    }

    setCheckedQuestions(prev => new Set([...prev, currentQuestion.id]));
  };

  // ── Navigation ───────────────────────────────────────────────────────────────
  const goTo = (idx: number) => setCurrentIndex(Math.max(0, Math.min(questions.length - 1, idx)));

  // ── Finish ───────────────────────────────────────────────────────────────────
  const handleFinish = async () => {
    setIsSubmitting(true);
    setSubmitError('');
    let score = 0;
    questions.forEach(q => { if (getIsCorrect(q)) score++; });

    try {
      const supabase = createClient();
      const { data: testData, error: testError } = await supabase
        .from('tests')
        .insert({
          user_id: user?.id ?? null,
          course_id: course!.id,
          topic_id: topicId || null,
          test_type: 'practice',
          score,
          total_questions: questions.length,
          percentage: Math.round((score / questions.length) * 100 * 100) / 100,
          completed_at: new Date().toISOString(),
        })
        .select().single();

      if (testError) throw testError;

      const testAnswers = questions.map(q => ({
        test_id: testData.id,
        question_id: q.id,
        selected_answer: answers[q.id] ?? [],
        is_correct: getIsCorrect(q),
      }));
      await supabase.from('test_answers').insert(testAnswers);
      if (user?.id) await supabase.rpc('update_practice_streak', { p_user_id: user.id });

      localStorage.removeItem(storageKey(courseCode, topicId));
      router.push(`/results/${testData.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit practice.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Resume offer screen ──────────────────────────────────────────────────────
  if (resumeOffer) {
    const mins = Math.round((Date.now() - new Date(resumeOffer.savedAt).getTime()) / 60000);
    const ago = mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
    return (
      <div className="max-w-md mx-auto mt-12 animate-fade-in">
        <Card className="p-8 text-center">
          <div className="w-16 h-16 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <PauseCircle className="w-9 h-9 text-amber-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Resume Practice?</h2>
          <p className="text-gray-500 text-sm mb-1">Paused <strong>{ago}</strong></p>
          <p className="text-gray-500 text-sm mb-6">
            Question {(resumeOffer.currentIndex ?? 0) + 1} of {resumeOffer.questionIds.length}
            {' · '}{resumeOffer.checkedQuestions.length} checked
          </p>
          <div className="flex flex-col gap-3">
            <Button onClick={handleResume} isLoading={isLoadingResume} className="w-full">
              Resume Where I Left Off
            </Button>
            <Button variant="outline" onClick={handleStartFresh} className="w-full flex items-center justify-center gap-2">
              <RotateCcw className="w-4 h-4" />
              Start Fresh
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="text-center py-12">
        <BookOpen className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">No Questions Available</h2>
        <p className="text-gray-500 mb-4">No questions available for this selection yet.</p>
        <Button onClick={() => router.back()}>Go Back</Button>
      </div>
    );
  }

  const allChecked = checkedQuestions.size === questions.length;

  // ── Quiz UI ──────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      {isFree && !isPaid && allLevelCourses > 1 && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-blue-800">
            <Sparkles className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <span>
              <span className="font-medium">You&rsquo;re on your free course.</span>{' '}
              Unlock {allLevelCourses - 1} more for just GHC 50.
            </span>
          </div>
          <button onClick={() => setShowPaywall(true)}
            className="flex-shrink-0 text-xs font-medium text-blue-700 border border-blue-300 px-2.5 py-1.5 rounded-lg hover:bg-blue-100">
            Upgrade →
          </button>
        </div>
      )}

      {showPaywall && course && (
        <PaywallModal courseName={course.course_name} courseCode={course.course_code}
          totalCourses={allLevelCourses} onClose={() => setShowPaywall(false)} onSuccess={() => setShowPaywall(false)} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <button onClick={handlePause} className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900 text-sm">
          <ArrowLeft className="w-4 h-4" /> Exit
        </button>
        <Badge variant="info">Question {currentIndex + 1} of {questions.length}</Badge>
        <button onClick={handlePause}
          className="flex items-center gap-1.5 text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-amber-100 transition-colors">
          <PauseCircle className="w-4 h-4" /> Pause
        </button>
      </div>

      <Progress value={checkedQuestions.size} max={questions.length} color="blue" size="md" />

      {/* Question Card */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <Badge variant={
            currentQuestion.question_type === 'single_choice' ? 'default' :
            currentQuestion.question_type === 'multiple_choice' ? 'info' : 'warning'
          }>
            {currentQuestion.question_type === 'single_choice' && 'Single Choice'}
            {currentQuestion.question_type === 'multiple_choice' && 'Multiple Choice'}
            {currentQuestion.question_type === 'fill_in_blank' && 'Fill in the Blank'}
          </Badge>
          <div className="flex items-center gap-2">
            {currentQuestion.question_type === 'multiple_choice' && (
              <span className="text-sm text-gray-500">Select all that apply</span>
            )}
            {showFeedback && (
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <Lock className="w-3 h-3" /> Locked
              </span>
            )}
          </div>
        </div>

        <h2 className="text-lg font-medium text-gray-900 mb-6">{currentQuestion.question_text}</h2>

        {/* Options */}
        {currentQuestion.question_type !== 'fill_in_blank' && currentQuestion.options && (
          <div className="space-y-3">
            {currentQuestion.options.map((option) => {
              const isSelected = (answers[currentQuestion.id] ?? []).includes(option.id);
              const isCorrectOption = currentQuestion.correct_answers.includes(option.id);
              let bg = 'bg-gray-50 hover:bg-gray-100';
              let border = 'border-gray-200';
              if (showFeedback) {
                if (isCorrectOption) { bg = 'bg-green-50'; border = 'border-green-500'; }
                else if (isSelected) { bg = 'bg-red-50'; border = 'border-red-400'; }
              } else if (isSelected) { bg = 'bg-blue-50'; border = 'border-blue-500'; }

              return (
                <button key={option.id} onClick={() => handleSelectAnswer(option.id)}
                  disabled={showFeedback}
                  className={`w-full p-4 border-2 ${border} ${bg} rounded-xl text-left transition-colors flex items-center gap-3 disabled:cursor-not-allowed`}>
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    isSelected ? 'border-blue-500 bg-blue-500' : 'border-gray-300'}`}>
                    {isSelected && (
                      currentQuestion.question_type === 'single_choice'
                        ? <div className="w-2 h-2 bg-white rounded-full" />
                        : <CheckCircle className="w-4 h-4 text-white" />
                    )}
                  </div>
                  <span className="text-gray-900 flex-1">{option.text}</span>
                  {showFeedback && isCorrectOption && <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />}
                  {showFeedback && isSelected && !isCorrectOption && <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        )}

        {/* Fill in blank */}
        {currentQuestion.question_type === 'fill_in_blank' && (
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Type your answer..."
              value={answers[currentQuestion.id]?.[0] ?? ''}
              onChange={e => handleFillBlank(e.target.value)}
              disabled={showFeedback || isFillChecking}
              className={`w-full p-4 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed transition-colors ${
                showFeedback ? isCorrect ? 'border-green-500 bg-green-50' : 'border-red-400 bg-red-50' : 'border-gray-200'
              }`}
            />
            {isFillChecking && (
              <div className="flex items-center gap-2 text-sm text-blue-600">
                <Loader2 className="w-4 h-4 animate-spin" /> AI is checking your answer…
              </div>
            )}
            {showFeedback && !isCorrect && (
              <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                Correct answer: <strong>{currentQuestion.correct_answers[0]}</strong>
              </p>
            )}
          </div>
        )}

        {/* Explanation (shown for ALL checked questions) */}
        {showFeedback && (
          <div className={`mt-6 rounded-xl p-4 border ${
            isCorrect ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
          }`}>
            <p className={`font-semibold text-sm mb-2 flex items-center gap-1.5 ${
              isCorrect ? 'text-green-800' : 'text-amber-800'
            }`}>
              {isCorrect
                ? <><CheckCircle className="w-4 h-4" /> Correct!</>
                : <><XCircle className="w-4 h-4" /> Incorrect</>}
            </p>
            {currentQuestion.explanation ? (
              <p className="text-gray-700 text-sm leading-relaxed">
                <span className="font-medium">Why: </span>{currentQuestion.explanation}
              </p>
            ) : (
              <p className="text-gray-500 text-sm italic">No explanation stored for this question.</p>
            )}
          </div>
        )}
      </Card>

      {submitError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{submitError}</div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={() => goTo(currentIndex - 1)} disabled={currentIndex === 0}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Previous
        </Button>
        <div className="flex gap-3">
          {!showFeedback && isAnswered && (
            <Button onClick={handleCheckAnswer} disabled={isFillChecking}>
              {isFillChecking
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Checking…</>
                : 'Check Answer'}
            </Button>
          )}
          {showFeedback && currentIndex < questions.length - 1 && (
            <Button onClick={() => goTo(currentIndex + 1)}>
              Next <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          )}
          {allChecked && (
            <Button onClick={handleFinish} isLoading={isSubmitting} className="bg-green-600 hover:bg-green-700">
              <Flag className="w-4 h-4 mr-2" /> Finish Practice
            </Button>
          )}
        </div>
      </div>

      {/* Question navigator */}
      <div className="flex flex-wrap gap-2 justify-center">
        {questions.map((q, idx) => {
          const isChecked = checkedQuestions.has(q.id);
          const hasAnswer = (answers[q.id]?.length ?? 0) > 0;
          const correct = isChecked ? getIsCorrect(q) : null;
          return (
            <button key={q.id} onClick={() => goTo(idx)}
              title={isChecked ? (correct ? 'Correct ✓' : 'Incorrect ✗') : hasAnswer ? 'Answered (not checked)' : 'Not answered'}
              className={`w-8 h-8 rounded-full text-xs font-medium transition-colors relative ${
                idx === currentIndex ? 'bg-blue-600 text-white ring-2 ring-blue-300'
                : isChecked && correct ? 'bg-green-500 text-white'
                : isChecked ? 'bg-red-400 text-white'
                : hasAnswer ? 'bg-amber-100 text-amber-800 border border-amber-300'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}>
              {idx + 1}
              {isChecked && <Lock className="w-2 h-2 absolute -top-0.5 -right-0.5 opacity-80" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
