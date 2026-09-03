'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { trackEvent } from '@/lib/track';
import { useAuth } from '@/components/providers';
import { useSubscriptionStore } from '@/lib/store';
import { usePricing } from '@/lib/hooks/usePricing';
import { Card, Button, Badge, Progress } from '@/components/ui';
import { shuffleArray, QUESTIONS_PER_PRACTICE, decodeRouteParam } from '@/lib/utils';
import { updateReviewSchedule } from '@/lib/spacedRepetition';
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
  Users,
  HelpCircle,
  ShieldCheck,
  CalendarClock,
} from 'lucide-react';
import { PaywallModal } from '../../courses/components/PaywallModal';

// ── Pause/resume ────────────────────────────────────────────────────────────

type Confidence = 'sure' | 'unsure';

interface PausedState {
  questionIds: string[];
  answers: Record<string, string[]>;
  checkedQuestions: string[];
  semanticResults: Record<string, boolean>;
  confidence: Record<string, Confidence>;
  currentIndex: number;
  savedAt: string;
}

function storageKey(courseCode: string, topicId: string | null, mode?: string | null) {
  // Use only the first ID in a group so the key stays stable
  const key = topicId ? topicId.split(',')[0] : 'all';
  // Mode-scoped so a paused "mistakes" session doesn't collide with (or
  // get silently offered as a resume for) a regular practice session.
  return `pastcs_practice_${courseCode}_${key}${mode ? `_${mode}` : ''}`;
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

  const courseCode = decodeRouteParam(params.courseCode as string).toUpperCase();
  const topicId = searchParams.get('topic');
  const mode = searchParams.get('mode'); // 'mistakes' | 'due' (spaced repetition)
  const isMistakesMode = mode === 'mistakes';
  const isDueMode = mode === 'due';

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
  // Self-reported confidence, tapped in the same action as "Check Answer"
  const [confidence, setConfidence] = useState<Record<string, Confidence>>({});

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [showPaywall, setShowPaywall] = useState(false);
  const [allLevelCourses, setAllLevelCourses] = useState(0);
  const [resumeOffer, setResumeOffer] = useState<PausedState | null>(null);
  const [isLoadingResume, setIsLoadingResume] = useState(false);

  const isPaid = hasActiveSub(user?.selected_level, user?.selected_semester);
  const { label: priceLabel } = usePricing(user?.selected_level);
  const isFree = courseCode === user?.free_course_code;

  // Keep a ref so the auto-save effect always has fresh values
  const stateForSave = useRef({ questions, answers, checkedQuestions, semanticResults, confidence, currentIndex });
  useEffect(() => {
    stateForSave.current = { questions, answers, checkedQuestions, semanticResults, confidence, currentIndex };
  });

  // ── Auto-save ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (questions.length === 0) return;
    const state: PausedState = {
      questionIds: questions.map(q => q.id),
      answers,
      checkedQuestions: [...checkedQuestions],
      semanticResults,
      confidence,
      currentIndex,
      savedAt: new Date().toISOString(),
    };
    try { localStorage.setItem(storageKey(courseCode, topicId, mode), JSON.stringify(state)); } catch { /* ignore */ }
  }, [questions, answers, checkedQuestions, semanticResults, confidence, currentIndex, courseCode, topicId, mode]);

  // ── Fetch fresh questions ────────────────────────────────────────────────────
  const fetchFresh = useCallback(async () => {
    const supabase = createClient();
    const { data: courseData } = await supabase
      // Case-insensitive — see courses/[courseCode]/page.tsx for why.
      .from('courses').select('*').ilike('course_code', courseCode).single();

    if (!courseData) { router.push('/courses'); return; }
    setCourse(courseData);
    trackEvent('practice_start', { course: courseCode, topicId: topicId ?? undefined });

    if (!isPaid && !isFree) { router.push(`/courses/${courseCode.toLowerCase()}`); return; }

    if (user?.selected_level && user?.selected_semester) {
      const { count } = await supabase.from('courses')
        .select('id', { count: 'exact', head: true })
        .eq('level', user.selected_level).eq('semester', user.selected_semester);
      setAllLevelCourses(count ?? 0);
    }

    // Mistakes mode: only questions this student has answered wrong before
    // in this course, instead of a random draw across the question bank.
    if (isMistakesMode) {
      if (!user?.id) return;
      const { data: pastTests } = await supabase
        .from('tests').select('id').eq('user_id', user.id).eq('course_id', courseData.id);
      const testIds = ((pastTests ?? []) as { id: string }[]).map(t => t.id);
      if (testIds.length === 0) { setQuestions([]); return; }

      const { data: wrongAnswers } = await supabase
        .from('test_answers').select('question_id')
        .in('test_id', testIds).eq('is_correct', false);
      const missedIds = [...new Set(((wrongAnswers ?? []) as { question_id: string }[]).map(a => a.question_id))];
      if (missedIds.length === 0) { setQuestions([]); return; }

      const { data: qs } = await supabase.from('questions').select('*')
        .in('id', missedIds).eq('is_approved', true);
      if (qs && qs.length > 0) {
        setQuestions(shuffleArray(qs as unknown as Question[]).slice(0, QUESTIONS_PER_PRACTICE));
      }
      return;
    }

    // Due-for-review mode: the spaced-repetition queue — whatever this
    // student has previously answered (right or wrong) and is now due
    // again, per review_schedule's 1/3/7/14/30-day ladder.
    if (isDueMode) {
      if (!user?.id) return;
      const today = new Date().toISOString().slice(0, 10);
      const { data: due } = await supabase
        .from('review_schedule')
        .select('question_id')
        .eq('user_id', user.id)
        .lte('next_review_at', today);
      const dueIds = ((due ?? []) as { question_id: string }[]).map(r => r.question_id);
      if (dueIds.length === 0) { setQuestions([]); return; }

      const { data: qs } = await supabase.from('questions').select('*')
        .eq('course_id', courseData.id).in('id', dueIds).eq('is_approved', true);
      if (qs && qs.length > 0) {
        setQuestions(shuffleArray(qs as unknown as Question[]).slice(0, QUESTIONS_PER_PRACTICE));
      }
      return;
    }

    let query = supabase.from('questions').select('*')
      .eq('course_id', courseData.id).eq('is_approved', true);
    if (topicId) {
      const ids = topicId.split(',');
      query = ids.length === 1 ? query.eq('topic_id', ids[0]) : query.in('topic_id', ids);
    }

    const { data: qs } = await query.limit(200);
    if (qs && qs.length > 0) {
      const shuffled = shuffleArray(qs as unknown as Question[]).slice(0, QUESTIONS_PER_PRACTICE);
      setQuestions(shuffled);
    }
  }, [courseCode, topicId, router, isPaid, isFree, isMistakesMode, isDueMode, user?.id, user?.selected_level, user?.selected_semester]);

  // ── Initial load: detect saved session ─────────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(courseCode, topicId, mode));
      if (raw) {
        const saved = JSON.parse(raw) as PausedState;
        if (saved.questionIds?.length > 0) { setResumeOffer(saved); return; }
      }
    } catch { /* corrupt */ }
    fetchFresh();
  }, [courseCode, topicId, mode, fetchFresh]);

  // ── Resume ──────────────────────────────────────────────────────────────────
  const handleResume = async () => {
    if (!resumeOffer) return;
    setIsLoadingResume(true);
    try {
      const supabase = createClient();
      const { data: courseData } = await supabase
        // Case-insensitive — see courses/[courseCode]/page.tsx for why.
      .from('courses').select('*').ilike('course_code', courseCode).single();
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
        setConfidence(resumeOffer.confidence ?? {}); // older paused sessions predate this field
        setCurrentIndex(Math.min(resumeOffer.currentIndex, ordered.length - 1));
      }
    } finally {
      setIsLoadingResume(false);
      setResumeOffer(null);
    }
  };

  const handleStartFresh = () => {
    localStorage.removeItem(storageKey(courseCode, topicId, mode));
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
  const handleCheckAnswer = async (tappedConfidence: Confidence) => {
    if (!currentQuestion || !isAnswered) return;
    setConfidence(prev => ({ ...prev, [currentQuestion.id]: tappedConfidence }));

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

      // Verify topic_id is still valid — a deleted topic causes a FK violation
      let safeTopicId: string | null = topicId || null;
      if (safeTopicId) {
        const { data: topicCheck } = await supabase
          .from('topics').select('id').eq('id', safeTopicId).single();
        if (!topicCheck) safeTopicId = null;
      }

      const { data: testData, error: testError } = await supabase
        .from('tests')
        .insert({
          user_id: user?.id,
          course_id: course!.id,
          topic_id: safeTopicId,
          test_type: 'practice',
          score,
          total_questions: questions.length,
          percentage: Math.round((score / questions.length) * 100 * 100) / 100,
          completed_at: new Date().toISOString(),
        })
        .select().single();

      if (testError) {
        // Surface the actual Supabase error message
        const msg = (testError as { message?: string }).message ?? JSON.stringify(testError);
        throw new Error(msg);
      }

      // Save answers — errors here don't block the result page
      const testAnswers = questions.map(q => ({
        test_id: testData.id,
        question_id: q.id,
        selected_answer: answers[q.id] ?? [],
        is_correct: getIsCorrect(q),
        confidence: confidence[q.id] ?? null,
      }));
      await supabase.from('test_answers').insert(testAnswers).then((result: { error: { message?: string } | null }) => {
        if (result.error) console.warn('test_answers insert failed:', result.error.message);
      });

      if (user?.id) await supabase.rpc('update_practice_streak', { p_user_id: user.id });
      fetch('/api/referrals/complete', { method: 'POST' }).catch(() => {});
      if (user?.id) {
        updateReviewSchedule(supabase, user.id, questions.map(q => ({ questionId: q.id, correct: getIsCorrect(q) }))).catch(() => {});
      }

      localStorage.removeItem(storageKey(courseCode, topicId, mode));
      router.push(`/results/${testData.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit practice. Please try again.');
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
          <div className="w-16 h-16 bg-amber-100 dark:bg-amber-500/15 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <PauseCircle className="w-9 h-9 text-amber-600 dark:text-amber-400" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2 dark:text-gray-100">Resume Practice?</h2>
          <p className="text-gray-500 text-sm mb-1 dark:text-gray-400">Paused <strong>{ago}</strong></p>
          <p className="text-gray-500 text-sm mb-6 dark:text-gray-400">
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
        {isMistakesMode ? (
          <>
            <CheckCircle className="w-16 h-16 text-green-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2 dark:text-gray-100">No mistakes to review</h2>
            <p className="text-gray-500 mb-4 dark:text-gray-400">
              Either you haven&rsquo;t practiced this course yet, or you&rsquo;ve gotten everything right so far. Nice work!
            </p>
          </>
        ) : isDueMode ? (
          <>
            <CheckCircle className="w-16 h-16 text-green-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2 dark:text-gray-100">Nothing due right now</h2>
            <p className="text-gray-500 mb-4 dark:text-gray-400">
              You&rsquo;re all caught up on this course&rsquo;s review schedule — come back once something&rsquo;s due again.
            </p>
          </>
        ) : (
          <>
            <BookOpen className="w-16 h-16 text-gray-300 dark:text-white/10 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2 dark:text-gray-100">No Questions Available</h2>
            <p className="text-gray-500 mb-4 dark:text-gray-400">No questions available for this selection yet.</p>
          </>
        )}
        <Button onClick={() => router.back()}>Go Back</Button>
      </div>
    );
  }

  const allChecked = checkedQuestions.size === questions.length;

  // ── Quiz UI ──────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      {isFree && !isPaid && allLevelCourses > 1 && (
        <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-blue-800 dark:text-blue-300">
            <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
            <span>
              <span className="font-medium">You&rsquo;re on your free course.</span>{' '}
              Unlock {allLevelCourses - 1} more for just {priceLabel}.
            </span>
          </div>
          <button onClick={() => setShowPaywall(true)}
            className="flex-shrink-0 text-xs font-medium text-blue-700 dark:text-blue-400 border border-blue-300 dark:border-blue-500/30 px-2.5 py-1.5 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-500/15">
            Upgrade →
          </button>
        </div>
      )}

      {showPaywall && course && (
        <PaywallModal courseName={course.course_name} courseCode={course.course_code}
          totalCourses={allLevelCourses} onClose={() => setShowPaywall(false)} onSuccess={() => setShowPaywall(false)} />
      )}

      {isMistakesMode && (
        <div className="flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg px-3 py-2">
          <RotateCcw className="w-3.5 h-3.5" />
          Practicing your mistakes — questions you got wrong before
        </div>
      )}

      {isDueMode && (
        <div className="flex items-center gap-1.5 text-sm text-violet-700 dark:text-violet-400 bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/20 rounded-lg px-3 py-2">
          <CalendarClock className="w-3.5 h-3.5" />
          Due for review — spaced out so it actually sticks before the exam
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <button onClick={handlePause} className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900 text-sm dark:text-gray-400 dark:hover:text-gray-100">
          <ArrowLeft className="w-4 h-4" /> Exit
        </button>
        <Badge variant="info">Question {currentIndex + 1} of {questions.length}</Badge>
        <button onClick={handlePause}
          className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-amber-100 dark:hover:bg-amber-500/15 transition-colors">
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
              <span className="text-sm text-gray-500 dark:text-gray-400">Select all that apply</span>
            )}
            {showFeedback && (
              <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                <Lock className="w-3 h-3" /> Locked
              </span>
            )}
          </div>
        </div>

        <h2 className="text-lg font-medium text-gray-900 mb-6 dark:text-gray-100">{currentQuestion.question_text}</h2>

        {/* Options */}
        {currentQuestion.question_type !== 'fill_in_blank' && currentQuestion.options && (
          <div className="space-y-3">
            {currentQuestion.options.map((option) => {
              const isSelected = (answers[currentQuestion.id] ?? []).includes(option.id);
              const isCorrectOption = currentQuestion.correct_answers.includes(option.id);
              let bg = 'bg-gray-50 dark:bg-white/[0.03] hover:bg-gray-100 dark:hover:bg-white/5';
              let border = 'border-gray-200 dark:border-white/10';
              if (showFeedback) {
                if (isCorrectOption) { bg = 'bg-green-50 dark:bg-green-500/10'; border = 'border-green-500'; }
                else if (isSelected) { bg = 'bg-red-50 dark:bg-red-500/10'; border = 'border-red-400'; }
              } else if (isSelected) { bg = 'bg-blue-50 dark:bg-blue-500/10'; border = 'border-blue-500'; }

              return (
                <button key={option.id} onClick={() => handleSelectAnswer(option.id)}
                  disabled={showFeedback}
                  className={`w-full p-4 border-2 ${border} ${bg} rounded-xl text-left transition-colors flex items-center gap-3 disabled:cursor-not-allowed`}>
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    isSelected ? 'border-blue-500 bg-blue-500' : 'border-gray-300 dark:border-white/20'}`}>
                    {isSelected && (
                      currentQuestion.question_type === 'single_choice'
                        ? <div className="w-2 h-2 bg-white rounded-full" />
                        : <CheckCircle className="w-4 h-4 text-white" />
                    )}
                  </div>
                  <span className="text-gray-900 flex-1 dark:text-gray-100">{option.text}</span>
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
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className={`w-full p-4 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed transition-colors dark:bg-white/[0.03] dark:text-gray-100 ${
                showFeedback
                  ? isCorrect
                    ? 'border-green-500 bg-green-50 dark:bg-green-500/10'
                    : 'border-red-400 bg-red-50 dark:bg-red-500/10'
                  : 'border-gray-200 dark:border-white/10'
              }`}
            />
            {isFillChecking && (
              <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
                <Loader2 className="w-4 h-4 animate-spin" /> AI is checking your answer…
              </div>
            )}
            {showFeedback && !isCorrect && (
              <p className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-lg px-3 py-2">
                Correct answer: <strong>{currentQuestion.correct_answers[0]}</strong>
              </p>
            )}
          </div>
        )}

        {/* Explanation (shown for ALL checked questions) */}
        {showFeedback && (
          <div className={`mt-6 rounded-xl p-4 border ${
            isCorrect ? 'bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/20' : 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20'
          }`}>
            <p className={`font-semibold text-sm mb-2 flex items-center gap-1.5 ${
              isCorrect ? 'text-green-800 dark:text-green-400' : 'text-amber-800 dark:text-amber-400'
            }`}>
              {isCorrect
                ? <><CheckCircle className="w-4 h-4" /> Correct!</>
                : <><XCircle className="w-4 h-4" /> Incorrect</>}
            </p>
            {isCorrect && confidence[currentQuestion.id] === 'unsure' && (
              <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-100/70 dark:bg-amber-500/10 rounded-lg px-2.5 py-1.5 mb-2 inline-block">
                You got it right, but you weren&rsquo;t sure — worth another look before the exam.
              </p>
            )}
            {currentQuestion.explanation ? (
              <p className="text-gray-700 text-sm leading-relaxed dark:text-gray-300">
                <span className="font-medium">Why: </span>{currentQuestion.explanation}
              </p>
            ) : (
              <p className="text-gray-500 text-sm italic dark:text-gray-400">No explanation stored for this question.</p>
            )}
            {currentQuestion.times_answered >= 5 && (
              <p className="mt-3 pt-3 border-t border-black/5 text-xs text-gray-500 flex items-center gap-1.5 dark:text-gray-400">
                <Users className="w-3.5 h-3.5 flex-shrink-0" />
                {(() => {
                  const missRate = Math.round(
                    ((currentQuestion.times_answered - currentQuestion.times_correct) / currentQuestion.times_answered) * 100
                  );
                  return isCorrect
                    ? `${100 - missRate}% of students who've tried this also got it right.`
                    : `${missRate}% of students who've tried this also got it wrong — you're not alone.`;
                })()}
              </p>
            )}
          </div>
        )}
      </Card>

      {submitError && (
        <div className="p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl text-sm text-red-700 dark:text-red-400">{submitError}</div>
      )}

      {/* Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={() => goTo(currentIndex - 1)} disabled={currentIndex === 0}>
          <ArrowLeft className="w-4 h-4 sm:mr-2" /> <span className="hidden sm:inline">Previous</span>
        </Button>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {!showFeedback && isAnswered && !isFillChecking && (
            <span className="text-xs text-gray-500 mr-1 hidden md:inline dark:text-gray-400">How sure are you?</span>
          )}
          {!showFeedback && isAnswered && (
            <>
              <Button variant="outline" size="sm" onClick={() => handleCheckAnswer('unsure')} disabled={isFillChecking}>
                {isFillChecking
                  ? <><Loader2 className="w-4 h-4 sm:mr-2 animate-spin" /><span className="hidden sm:inline">Checking…</span></>
                  : <><HelpCircle className="w-4 h-4 sm:mr-2" /><span className="hidden sm:inline">Not Sure</span></>}
              </Button>
              <Button size="sm" onClick={() => handleCheckAnswer('sure')} disabled={isFillChecking}>
                {isFillChecking
                  ? <><Loader2 className="w-4 h-4 sm:mr-2 animate-spin" /><span className="hidden sm:inline">Checking…</span></>
                  : <><ShieldCheck className="w-4 h-4 sm:mr-2" /><span className="hidden sm:inline">Sure</span></>}
              </Button>
            </>
          )}
          {showFeedback && currentIndex < questions.length - 1 && (
            <Button size="sm" onClick={() => goTo(currentIndex + 1)}>
              <span className="hidden sm:inline">Next</span> <ArrowRight className="w-4 h-4 sm:ml-2" />
            </Button>
          )}
          {allChecked && (
            <Button size="sm" onClick={handleFinish} isLoading={isSubmitting} className="bg-green-600 hover:bg-green-700">
              <Flag className="w-4 h-4 sm:mr-2" /> <span className="hidden sm:inline">Finish Practice</span>
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
                idx === currentIndex ? 'bg-blue-600 text-white ring-2 ring-blue-300 dark:ring-blue-500/40'
                : isChecked && correct ? 'bg-green-500 text-white'
                : isChecked ? 'bg-red-400 text-white'
                : hasAnswer ? 'bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-400 border border-amber-300 dark:border-amber-500/30'
                : 'bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/15'
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
