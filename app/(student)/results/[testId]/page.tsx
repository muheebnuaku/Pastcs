'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, Button, Badge, Progress, Loading } from '@/components/ui';
import { formatPercentage, formatTime, getGradeBadgeColor, COURSE_ICONS } from '@/lib/utils';
import type { Test, TestAnswer, Question } from '@/types';
import {
  Trophy,
  Target,
  Clock,
  CheckCircle,
  XCircle,
  ArrowLeft,
  RotateCcw,
  Share2,
  BookOpen,
} from 'lucide-react';

export default function ResultsPage() {
  const params = useParams();
  const router = useRouter();
  const testId = params.testId as string;

  const [test, setTest] = useState<Test | null>(null);
  const [answers, setAnswers] = useState<(TestAnswer & { question: Question })[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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

      setIsLoading(false);
    };

    fetchResults();
  }, [testId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loading size="lg" text="Loading results..." />
      </div>
    );
  }

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
      {/* Back Button */}
      <Link 
        href="/dashboard" 
        className="inline-flex items-center text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Dashboard
      </Link>

      {/* Result Header */}
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
            {test.course?.course_code} - {test.test_type === 'exam_simulation' ? 'Exam Simulation' : 'Practice Test'}
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

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-4 justify-center">
        <Link href={`/courses/${test.course?.course_code.toLowerCase()}`}>
          <Button>
            <RotateCcw className="w-4 h-4 mr-2" />
            Practice Again
          </Button>
        </Link>
        <Link href="/courses">
          <Button variant="outline">
            <BookOpen className="w-4 h-4 mr-2" />
            Other Courses
          </Button>
        </Link>
      </div>

      {/* Detailed Results */}
      <Card>
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Question Review</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {answers.map((answer, index) => (
            <div key={answer.id} className="p-6">
              <div className="flex items-start gap-4">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  answer.is_correct ? 'bg-green-100' : 'bg-red-100'
                }`}>
                  {answer.is_correct ? (
                    <CheckCircle className="w-5 h-5 text-green-600" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-600" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-medium text-gray-500">Question {index + 1}</span>
                    <Badge variant={
                      answer.question.question_type === 'single_choice' ? 'default' :
                      answer.question.question_type === 'multiple_choice' ? 'info' : 'warning'
                    } size="sm">
                      {answer.question.question_type.replace('_', ' ')}
                    </Badge>
                  </div>
                  <p className="text-gray-900 font-medium mb-3">{answer.question.question_text}</p>

                  {/* Options */}
                  {answer.question.options && (
                    <div className="space-y-2 mb-3">
                      {answer.question.options.map((option) => {
                        const isSelected = answer.selected_answer?.includes(option.id);
                        const isCorrect = answer.question.correct_answers.includes(option.id);

                        return (
                          <div
                            key={option.id}
                            className={`p-3 rounded-lg text-sm ${
                              isCorrect 
                                ? 'bg-green-50 border border-green-200' 
                                : isSelected 
                                  ? 'bg-red-50 border border-red-200' 
                                  : 'bg-gray-50 border border-gray-200'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              {isCorrect && <CheckCircle className="w-4 h-4 text-green-600" />}
                              {isSelected && !isCorrect && <XCircle className="w-4 h-4 text-red-600" />}
                              <span className={isCorrect ? 'text-green-800' : isSelected ? 'text-red-800' : 'text-gray-700'}>
                                {option.text}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Fill in the blank answer */}
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

                  {/* Explanation */}
                  {answer.question.explanation && (
                    <div className="p-3 bg-blue-50 rounded-lg">
                      <p className="text-sm text-blue-800">
                        <strong>Explanation:</strong> {answer.question.explanation}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
