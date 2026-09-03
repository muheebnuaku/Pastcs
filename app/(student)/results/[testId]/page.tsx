'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, Button, Badge } from '@/components/ui';
import { formatPercentage, formatTime, getGradeBadgeColor } from '@/lib/utils';
import { useSpeech } from '@/lib/hooks/useSpeech';
import { SpeechHighlight } from '@/lib/hooks/SpeechHighlight';
import type { Test, TestAnswer, Question } from '@/types';
import {
  Trophy, Target, Clock, CheckCircle, XCircle,
  ArrowLeft, RotateCcw, BookOpen, BotMessageSquare, Loader2,
  Volume2, VolumeX, HelpCircle,
} from 'lucide-react';

// Lightweight markdown → HTML for AI panel
function mdToHtml(text: string): string {
  return text
    .replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre class="bg-gray-900 text-green-300 rounded-lg p-3 text-xs overflow-x-auto my-2 font-mono"><code>$1</code></pre>')
    .replace(/`([^`\n]+)`/g, '<code class="bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 px-1 py-0.5 rounded text-xs font-mono">$1</code>')
    .replace(/^## (.+)$/gm, '<h3 class="text-sm font-bold text-purple-900 dark:text-purple-300 mt-3 mb-1">$1</h3>')
    .replace(/^### (.+)$/gm, '<h4 class="text-sm font-semibold text-purple-800 dark:text-purple-400 mt-2 mb-1">$1</h4>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong class="font-semibold text-gray-900 dark:text-gray-100">$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/^---$/gm, '<hr class="my-3 border-purple-200 dark:border-purple-500/20" />')
    .replace(/^[*-] (.+)$/gm, '<li class="ml-4 list-disc text-sm leading-relaxed">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal text-sm leading-relaxed">$2</li>')
    .replace(/(<li[\s\S]*?<\/li>\n?)+/g, '<ul class="my-1.5 space-y-1">$&</ul>')
    .replace(/\[🎬 ([^\]]+)\]\((https:\/\/www\.youtube[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-red-600 hover:underline text-sm font-medium">▶ $1</a>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline text-sm">$1</a>')
    .replace(/\n{2,}/g, '</p><p class="text-sm text-gray-800 dark:text-gray-200 leading-relaxed mb-2">')
    .replace(/\n/g, '<br />');
}

export default function ResultsPage() {
  const params = useParams();
  const testId = params.testId as string;

  const [test, setTest] = useState<Test | null>(null);
  const [answers, setAnswers] = useState<(TestAnswer & { question: Question })[]>([]);

  // AI explain state per question
  const [aiPanels, setAiPanels] = useState<Record<string, string>>({});
  const [loadingAI, setLoadingAI] = useState<Set<string>>(new Set());
  const [openAI, setOpenAI] = useState<Set<string>>(new Set());
  const abortControllers = useRef<Record<string, AbortController>>({});

  // Voice
  const { speak, stop, charIndex, speakingText, isSupported: voiceSupported } = useSpeech();
  const [speakingQId, setSpeakingQId] = useState<string | null>(null);

  useEffect(() => {
    const fetchResults = async () => {
      const supabase = createClient();
      const { data: testData } = await supabase
        .from('tests')
        .select('*, course:courses(*)')
        .eq('id', testId)
        .single();

      if (testData) {
        setTest(testData);
        const { data: answersData } = await supabase
          .from('test_answers')
          .select('*, question:questions(*)')
          .eq('test_id', testId);
        if (answersData) {
          setAnswers(answersData as (TestAnswer & { question: Question })[]);
        }
      }
    };
    fetchResults();
  }, [testId]);

  const handleAskAI = async (answer: TestAnswer & { question: Question }) => {
    const qId = answer.question.id;

    // Toggle off if already done
    if (openAI.has(qId) && !loadingAI.has(qId)) {
      setOpenAI(prev => { const s = new Set(prev); s.delete(qId); return s; });
      if (speakingQId === qId) { stop(); setSpeakingQId(null); }
      return;
    }
    if (loadingAI.has(qId)) return;

    setOpenAI(prev => new Set([...prev, qId]));
    setLoadingAI(prev => new Set([...prev, qId]));
    setAiPanels(prev => ({ ...prev, [qId]: '' }));

    // Build full question context
    const q = answer.question;
    let questionContext = `**Question:** ${q.question_text}\n\n`;

    if (q.options && q.options.length > 0) {
      questionContext += '**Options:**\n';
      q.options.forEach((opt, i) => {
        const isCorrect = q.correct_answers.includes(opt.id);
        questionContext += `${String.fromCharCode(65 + i)}. ${opt.text}${isCorrect ? ' ✅ (CORRECT)' : ''}\n`;
      });
      const studentPicked = q.options
        .filter(o => answer.selected_answer?.includes(o.id))
        .map(o => o.text).join(', ');
      if (studentPicked) {
        questionContext += `\n**Student selected:** ${studentPicked} (${answer.is_correct ? 'Correct ✅' : 'Incorrect ❌'})\n`;
      }
    } else if (q.question_type === 'fill_in_blank') {
      questionContext += `**Correct answer:** ${q.correct_answers[0]}\n`;
      if (answer.selected_answer?.[0]) {
        questionContext += `**Student answered:** ${answer.selected_answer[0]} (${answer.is_correct ? 'Correct ✅' : 'Incorrect ❌'})\n`;
      }
    }

    if (q.explanation) {
      questionContext += `\n**Existing hint:** ${q.explanation}`;
    }

    const message =
      `Explain this exam question in full detail:\n\n${questionContext}\n\n` +
      `Please cover:\n` +
      `1. What concept this question is testing\n` +
      `2. Step-by-step reasoning for why the correct answer is right\n` +
      `3. Why the wrong options are incorrect (for MCQ)\n` +
      `4. A memorable real-world example or analogy\n` +
      `5. Common mistakes students make on this topic`;

    const context = test?.course?.course_code
      ? `Course: ${test.course.course_code}`
      : '';

    if (abortControllers.current[qId]) abortControllers.current[qId].abort();
    const controller = new AbortController();
    abortControllers.current[qId] = controller;

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, context, history: [] }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) throw new Error('Request failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        accumulated += chunk;
        setAiPanels(prev => ({ ...prev, [qId]: (prev[qId] ?? '') + chunk }));
      }
      if (voiceSupported && accumulated) {
        setSpeakingQId(qId);
        speak(accumulated, () => setSpeakingQId(null));
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setAiPanels(prev => ({
          ...prev,
          [qId]: 'Could not load explanation — please try again.',
        }));
      }
    } finally {
      setLoadingAI(prev => { const s = new Set(prev); s.delete(qId); return s; });
    }
  };

  if (!test) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Test not found</h2>
        <Link href="/dashboard" className="text-blue-600 hover:underline mt-2 inline-block">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  const correctCount = answers.filter(a => a.is_correct).length;
  const wrongCount = answers.filter(a => !a.is_correct).length;

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      {/* Back */}
      <Link href="/dashboard" className="inline-flex items-center text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100">
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Dashboard
      </Link>

      {/* Score header */}
      <Card className="overflow-hidden">
        <div className={`p-8 text-center ${
          test.percentage >= 70
            ? 'bg-gradient-to-r from-green-500 to-emerald-500'
            : test.percentage >= 50
              ? 'bg-gradient-to-r from-yellow-500 to-orange-500'
              : 'bg-gradient-to-r from-red-500 to-pink-500'
        } text-white`}>
          <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Trophy className="w-10 h-10" />
          </div>
          <h1 className="text-3xl font-bold mb-2">
            {test.percentage >= 70 ? 'Great Job!' : test.percentage >= 50 ? 'Good Effort!' : 'Keep Practicing!'}
          </h1>
          <p className="text-white/90">
            {test.course?.course_code} — {test.test_type === 'exam_simulation' ? 'Exam Simulation' : 'Practice Test'}
          </p>
        </div>

        <CardContent className="p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-gray-50 rounded-xl dark:bg-white/[0.03]">
              <Target className="w-6 h-6 text-blue-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{test.score}/{test.total_questions}</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Score</p>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-xl dark:bg-white/[0.03]">
              <div className={`text-2xl font-bold ${getGradeBadgeColor(test.percentage).split(' ')[1]}`}>
                {formatPercentage(test.percentage)}
              </div>
              <p className="text-sm text-gray-600 mt-1 dark:text-gray-400">Percentage</p>
            </div>
            <div className="text-center p-4 bg-green-50 dark:bg-green-500/10 rounded-xl">
              <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-green-700 dark:text-green-400">{correctCount}</p>
              <p className="text-sm text-green-600 dark:text-green-400">Correct</p>
            </div>
            <div className="text-center p-4 bg-red-50 dark:bg-red-500/10 rounded-xl">
              <XCircle className="w-6 h-6 text-red-600 dark:text-red-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-red-700 dark:text-red-400">{wrongCount}</p>
              <p className="text-sm text-red-600 dark:text-red-400">Wrong</p>
            </div>
          </div>
          {test.time_taken && (
            <div className="mt-4 flex items-center justify-center gap-2 text-gray-600 dark:text-gray-400">
              <Clock className="w-4 h-4" />
              <span>Completed in {formatTime(test.time_taken)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-wrap gap-4 justify-center">
        <Link href={`/courses/${test.course?.course_code.toLowerCase()}`}>
          <Button><RotateCcw className="w-4 h-4 mr-2" />Practice Again</Button>
        </Link>
        <Link href="/courses">
          <Button variant="outline"><BookOpen className="w-4 h-4 mr-2" />Other Courses</Button>
        </Link>
      </div>

      {/* Question Review */}
      <Card>
        <div className="px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-1 dark:border-white/10">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Question Review</h2>
          <p className="text-xs text-gray-500 flex items-center gap-1 dark:text-gray-400">
            <BotMessageSquare className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
            Click &ldquo;Ask AI&rdquo; on any question for a detailed explanation
          </p>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-white/10">
          {answers.map((answer, index) => {
            const qId = answer.question.id;
            const isAIOpen = openAI.has(qId);
            const isAILoading = loadingAI.has(qId);

            return (
              <div key={answer.id} className="p-6">
                <div className="flex items-start gap-4">
                  {/* Correct / wrong indicator */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    answer.is_correct ? 'bg-green-100 dark:bg-green-500/15' : 'bg-red-100 dark:bg-red-500/15'
                  }`}>
                    {answer.is_correct
                      ? <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                      : <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Header */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Question {index + 1}</span>
                      <Badge variant={
                        answer.question.question_type === 'single_choice' ? 'default' :
                        answer.question.question_type === 'multiple_choice' ? 'info' : 'warning'
                      } size="sm">
                        {answer.question.question_type.replace(/_/g, ' ')}
                      </Badge>
                      {answer.is_correct && answer.confidence === 'unsure' && (
                        <Badge variant="warning" size="sm">
                          <HelpCircle className="w-3 h-3 mr-1" />
                          Lucky guess?
                        </Badge>
                      )}
                    </div>

                    <p className="text-gray-900 font-medium mb-3 dark:text-gray-100">{answer.question.question_text}</p>

                    {/* MCQ options */}
                    {answer.question.options && (
                      <div className="space-y-2 mb-3">
                        {answer.question.options.map((option) => {
                          const isSelected = answer.selected_answer?.includes(option.id);
                          const isCorrect = answer.question.correct_answers.includes(option.id);
                          return (
                            <div key={option.id} className={`p-3 rounded-lg text-sm ${
                              isCorrect
                                ? 'bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20'
                                : isSelected
                                  ? 'bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20'
                                  : 'bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/10'
                            }`}>
                              <div className="flex items-center gap-2">
                                {isCorrect && <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />}
                                {isSelected && !isCorrect && <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />}
                                <span className={isCorrect ? 'text-green-800 dark:text-green-400' : isSelected ? 'text-red-800 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'}>
                                  {option.text}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Fill in blank */}
                    {answer.question.question_type === 'fill_in_blank' && (
                      <div className="space-y-2 mb-3">
                        <div className={`p-3 rounded-lg text-sm ${
                          answer.is_correct ? 'bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20' : 'bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20'
                        }`}>
                          Your answer: <strong>{answer.selected_answer?.[0] || '(no answer)'}</strong>
                        </div>
                        {!answer.is_correct && (
                          <div className="p-3 rounded-lg text-sm bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20">
                            Correct answer: <strong>{answer.question.correct_answers[0]}</strong>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Stored explanation */}
                    {answer.question.explanation && (
                      <div className="p-3 bg-blue-50 dark:bg-blue-500/10 rounded-lg mb-3">
                        <p className="text-sm text-blue-800 dark:text-blue-300">
                          <strong>Explanation:</strong> {answer.question.explanation}
                        </p>
                      </div>
                    )}

                    {/* ── AI Explain button ── */}
                    <button
                      onClick={() => handleAskAI(answer)}
                      disabled={isAILoading}
                      className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${
                        isAIOpen
                          ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-500/25'
                          : 'bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-500/15'
                      } disabled:opacity-60`}
                    >
                      {isAILoading ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          AI is explaining…
                        </>
                      ) : isAIOpen ? (
                        <>
                          <BotMessageSquare className="w-3.5 h-3.5" />
                          Hide AI explanation
                        </>
                      ) : (
                        <>
                          <BotMessageSquare className="w-3.5 h-3.5" />
                          Ask AI to explain
                        </>
                      )}
                    </button>

                    {/* ── Streaming AI panel ── */}
                    {isAIOpen && (
                      <div className="mt-3 rounded-xl border border-purple-200 dark:border-purple-500/20 bg-purple-50 dark:bg-purple-500/[0.06] overflow-hidden">
                        <div className="flex items-center gap-2 px-4 py-2 bg-purple-100 dark:bg-purple-500/15 border-b border-purple-200 dark:border-purple-500/20">
                          <BotMessageSquare className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                          <span className="text-xs font-semibold text-purple-700 dark:text-purple-300 tracking-wide uppercase">
                            AI Tutor Explanation
                          </span>
                          {isAILoading ? (
                            <span className="ml-auto flex gap-1">
                              {[0, 1, 2].map(i => (
                                <span
                                  key={i}
                                  className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce"
                                  style={{ animationDelay: `${i * 0.15}s` }}
                                />
                              ))}
                            </span>
                          ) : voiceSupported && aiPanels[qId] ? (
                            <button
                              onClick={() => {
                                if (speakingQId === qId) {
                                  stop(); setSpeakingQId(null);
                                } else {
                                  setSpeakingQId(qId);
                                  speak(aiPanels[qId], () => setSpeakingQId(null));
                                }
                              }}
                              className="ml-auto p-1 rounded-lg hover:bg-purple-200 dark:hover:bg-purple-500/20 transition-colors"
                              title={speakingQId === qId ? 'Stop reading' : 'Read aloud'}
                            >
                              {speakingQId === qId
                                ? <VolumeX className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                                : <Volume2 className="w-4 h-4 text-purple-500 dark:text-purple-400" />}
                            </button>
                          ) : null}
                        </div>
                        <div className="p-4">
                          {aiPanels[qId] ? (
                            speakingQId === qId && speakingText ? (
                              <SpeechHighlight text={speakingText} charIndex={charIndex} />
                            ) : (
                              <div
                                className="text-sm text-gray-800 leading-relaxed dark:text-gray-200"
                                dangerouslySetInnerHTML={{ __html: mdToHtml(aiPanels[qId]) }}
                              />
                            )
                          ) : (
                            <p className="text-sm text-purple-500 dark:text-purple-400 italic">Generating explanation…</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
