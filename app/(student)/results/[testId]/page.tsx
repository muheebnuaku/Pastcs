'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, Button, Badge } from '@/components/ui';
import { formatPercentage, formatTime, getGradeBadgeColor } from '@/lib/utils';
import type { Test, TestAnswer, Question } from '@/types';
import {
  Trophy, Target, Clock, CheckCircle, XCircle,
  ArrowLeft, RotateCcw, BookOpen, BotMessageSquare, Loader2,
} from 'lucide-react';

// Lightweight markdown → HTML for AI panel
function mdToHtml(text: string): string {
  return text
    .replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre class="bg-gray-900 text-green-300 rounded-lg p-3 text-xs overflow-x-auto my-2 font-mono"><code>$1</code></pre>')
    .replace(/`([^`\n]+)`/g, '<code class="bg-purple-100 text-purple-700 px-1 py-0.5 rounded text-xs font-mono">$1</code>')
    .replace(/^## (.+)$/gm, '<h3 class="text-sm font-bold text-purple-900 mt-3 mb-1">$1</h3>')
    .replace(/^### (.+)$/gm, '<h4 class="text-sm font-semibold text-purple-800 mt-2 mb-1">$1</h4>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/^---$/gm, '<hr class="my-3 border-purple-200" />')
    .replace(/^[*-] (.+)$/gm, '<li class="ml-4 list-disc text-sm leading-relaxed">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal text-sm leading-relaxed">$2</li>')
    .replace(/(<li[\s\S]*?<\/li>\n?)+/g, '<ul class="my-1.5 space-y-1">$&</ul>')
    .replace(/\[🎬 ([^\]]+)\]\((https:\/\/www\.youtube[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-red-600 hover:underline text-sm font-medium">▶ $1</a>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline text-sm">$1</a>')
    .replace(/\n{2,}/g, '</p><p class="text-sm text-gray-800 leading-relaxed mb-2">')
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
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setAiPanels(prev => ({ ...prev, [qId]: (prev[qId] ?? '') + chunk }));
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
        <h2 className="text-xl font-semibold text-gray-900">Test not found</h2>
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
      <Link href="/dashboard" className="inline-flex items-center text-gray-600 hover:text-gray-900">
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
            <div className="text-center p-4 bg-gray-50 rounded-xl">
              <Target className="w-6 h-6 text-blue-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-gray-900">{test.score}/{test.total_questions}</p>
              <p className="text-sm text-gray-600">Score</p>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-xl">
              <div className={`text-2xl font-bold ${getGradeBadgeColor(test.percentage).split(' ')[1]}`}>
                {formatPercentage(test.percentage)}
              </div>
              <p className="text-sm text-gray-600 mt-1">Percentage</p>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-xl">
              <CheckCircle className="w-6 h-6 text-green-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-green-700">{correctCount}</p>
              <p className="text-sm text-green-600">Correct</p>
            </div>
            <div className="text-center p-4 bg-red-50 rounded-xl">
              <XCircle className="w-6 h-6 text-red-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-red-700">{wrongCount}</p>
              <p className="text-sm text-red-600">Wrong</p>
            </div>
          </div>
          {test.time_taken && (
            <div className="mt-4 flex items-center justify-center gap-2 text-gray-600">
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
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Question Review</h2>
          <p className="text-xs text-gray-500 flex items-center gap-1">
            <BotMessageSquare className="w-3.5 h-3.5 text-purple-500" />
            Click &ldquo;Ask AI&rdquo; on any question for a detailed explanation
          </p>
        </div>
        <div className="divide-y divide-gray-100">
          {answers.map((answer, index) => {
            const qId = answer.question.id;
            const isAIOpen = openAI.has(qId);
            const isAILoading = loadingAI.has(qId);

            return (
              <div key={answer.id} className="p-6">
                <div className="flex items-start gap-4">
                  {/* Correct / wrong indicator */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    answer.is_correct ? 'bg-green-100' : 'bg-red-100'
                  }`}>
                    {answer.is_correct
                      ? <CheckCircle className="w-5 h-5 text-green-600" />
                      : <XCircle className="w-5 h-5 text-red-600" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Header */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-medium text-gray-500">Question {index + 1}</span>
                      <Badge variant={
                        answer.question.question_type === 'single_choice' ? 'default' :
                        answer.question.question_type === 'multiple_choice' ? 'info' : 'warning'
                      } size="sm">
                        {answer.question.question_type.replace(/_/g, ' ')}
                      </Badge>
                    </div>

                    <p className="text-gray-900 font-medium mb-3">{answer.question.question_text}</p>

                    {/* MCQ options */}
                    {answer.question.options && (
                      <div className="space-y-2 mb-3">
                        {answer.question.options.map((option) => {
                          const isSelected = answer.selected_answer?.includes(option.id);
                          const isCorrect = answer.question.correct_answers.includes(option.id);
                          return (
                            <div key={option.id} className={`p-3 rounded-lg text-sm ${
                              isCorrect
                                ? 'bg-green-50 border border-green-200'
                                : isSelected
                                  ? 'bg-red-50 border border-red-200'
                                  : 'bg-gray-50 border border-gray-200'
                            }`}>
                              <div className="flex items-center gap-2">
                                {isCorrect && <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />}
                                {isSelected && !isCorrect && <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />}
                                <span className={isCorrect ? 'text-green-800' : isSelected ? 'text-red-800' : 'text-gray-700'}>
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
                          answer.is_correct ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
                        }`}>
                          Your answer: <strong>{answer.selected_answer?.[0] || '(no answer)'}</strong>
                        </div>
                        {!answer.is_correct && (
                          <div className="p-3 rounded-lg text-sm bg-green-50 border border-green-200">
                            Correct answer: <strong>{answer.question.correct_answers[0]}</strong>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Stored explanation */}
                    {answer.question.explanation && (
                      <div className="p-3 bg-blue-50 rounded-lg mb-3">
                        <p className="text-sm text-blue-800">
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
                          ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                          : 'bg-purple-50 text-purple-600 hover:bg-purple-100'
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
                      <div className="mt-3 rounded-xl border border-purple-200 bg-purple-50 overflow-hidden">
                        <div className="flex items-center gap-2 px-4 py-2 bg-purple-100 border-b border-purple-200">
                          <BotMessageSquare className="w-4 h-4 text-purple-600" />
                          <span className="text-xs font-semibold text-purple-700 tracking-wide uppercase">
                            AI Tutor Explanation
                          </span>
                          {isAILoading && (
                            <span className="ml-auto flex gap-1">
                              {[0, 1, 2].map(i => (
                                <span
                                  key={i}
                                  className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce"
                                  style={{ animationDelay: `${i * 0.15}s` }}
                                />
                              ))}
                            </span>
                          )}
                        </div>
                        <div className="p-4">
                          {aiPanels[qId] ? (
                            <div
                              className="text-sm text-gray-800 leading-relaxed"
                              dangerouslySetInnerHTML={{ __html: mdToHtml(aiPanels[qId]) }}
                            />
                          ) : (
                            <p className="text-sm text-purple-500 italic">Generating explanation…</p>
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
