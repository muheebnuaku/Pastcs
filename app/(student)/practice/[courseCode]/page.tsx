'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers';
import { Card, Button, Badge, Progress, Loading } from '@/components/ui';
import { shuffleArray, QUESTIONS_PER_PRACTICE } from '@/lib/utils';
import type { Question, Course } from '@/types';
import { 
  ArrowLeft, 
  ArrowRight, 
  CheckCircle, 
  XCircle,
  Flag,
  BookOpen,
} from 'lucide-react';

export default function PracticePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  
  const courseCode = (params.courseCode as string).toUpperCase();
  const topicId = searchParams.get('topic');

  const [course, setCourse] = useState<Course | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [showFeedback, setShowFeedback] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const fetchQuestions = async () => {
      const supabase = createClient();
      
      // Fetch course
      const { data: courseData } = await supabase
        .from('courses')
        .select('*')
        .eq('course_code', courseCode)
        .single();

      if (!courseData) {
        router.push('/courses');
        return;
      }

      setCourse(courseData);

      // Fetch questions
      let query = supabase
        .from('questions')
        .select('*')
        .eq('course_id', courseData.id)
        .eq('is_approved', true);

      if (topicId) {
        query = query.eq('topic_id', topicId);
      }

      const { data: questionsData } = await query.limit(50);

      if (questionsData && questionsData.length > 0) {
        const typedQuestions = questionsData as unknown as Question[];
        const shuffled = shuffleArray(typedQuestions).slice(0, QUESTIONS_PER_PRACTICE);
        setQuestions(shuffled);
      }

      setIsLoading(false);
    };

    fetchQuestions();
  }, [courseCode, topicId, router]);

  const currentQuestion = questions[currentIndex];
  const isAnswered = currentQuestion && answers[currentQuestion.id]?.length > 0;
  const isCorrect = isAnswered && showFeedback && 
    JSON.stringify(answers[currentQuestion.id]?.sort()) === 
    JSON.stringify(currentQuestion.correct_answers?.sort());

  const handleSelectAnswer = (optionId: string) => {
    if (showFeedback) return;

    const currentAnswer = answers[currentQuestion.id] || [];

    if (currentQuestion.question_type === 'single_choice') {
      setAnswers({ ...answers, [currentQuestion.id]: [optionId] });
    } else if (currentQuestion.question_type === 'multiple_choice') {
      if (currentAnswer.includes(optionId)) {
        setAnswers({ 
          ...answers, 
          [currentQuestion.id]: currentAnswer.filter(id => id !== optionId) 
        });
      } else {
        setAnswers({ 
          ...answers, 
          [currentQuestion.id]: [...currentAnswer, optionId] 
        });
      }
    }
  };

  const handleFillBlank = (value: string) => {
    if (showFeedback) return;
    setAnswers({ ...answers, [currentQuestion.id]: [value.trim().toLowerCase()] });
  };

  const handleCheckAnswer = () => {
    setShowFeedback(true);
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setShowFeedback(false);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setShowFeedback(false);
    }
  };

  const handleFinish = async () => {
    setIsSubmitting(true);
    const supabase = createClient();

    // Calculate score
    let score = 0;
    questions.forEach(q => {
      const answer = answers[q.id] || [];
      if (JSON.stringify(answer.sort()) === JSON.stringify(q.correct_answers.sort())) {
        score++;
      }
    });

    // Save test
    const { data: testData } = await supabase
      .from('tests')
      .insert({
        user_id: user?.id,
        course_id: course?.id,
        topic_id: topicId || null,
        test_type: 'practice',
        score,
        total_questions: questions.length,
        percentage: (score / questions.length) * 100,
      })
      .select()
      .single();

    if (testData) {
      // Save individual answers
      const testAnswers = questions.map(q => ({
        test_id: testData.id,
        question_id: q.id,
        selected_answer: answers[q.id] || [],
        is_correct: JSON.stringify((answers[q.id] || []).sort()) === JSON.stringify(q.correct_answers.sort()),
      }));

      await supabase.from('test_answers').insert(testAnswers);

      // Update practice streak
      await supabase.rpc('update_practice_streak', { p_user_id: user?.id });

      router.push(`/results/${testData.id}`);
    }

    setIsSubmitting(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loading size="lg" text="Loading questions..." />
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="text-center py-12">
        <BookOpen className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">No Questions Available</h2>
        <p className="text-gray-500 mb-4">There are no questions available for this selection yet.</p>
        <Button onClick={() => router.back()}>Go Back</Button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      {/* Progress Header */}
      <div className="flex items-center justify-between">
        <button 
          onClick={() => router.back()}
          className="flex items-center text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Exit Practice
        </button>
        <Badge variant="info">
          Question {currentIndex + 1} of {questions.length}
        </Badge>
      </div>

      <Progress 
        value={currentIndex + 1} 
        max={questions.length} 
        color="blue" 
        size="md" 
      />

      {/* Question Card */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <Badge variant={
            currentQuestion.question_type === 'single_choice' ? 'default' :
            currentQuestion.question_type === 'multiple_choice' ? 'info' : 'warning'
          }>
            {currentQuestion.question_type === 'single_choice' && 'Single Choice'}
            {currentQuestion.question_type === 'multiple_choice' && 'Multiple Choice'}
            {currentQuestion.question_type === 'fill_in_blank' && 'Fill in the Blank'}
          </Badge>
          {currentQuestion.question_type === 'multiple_choice' && (
            <span className="text-sm text-gray-500">Select all that apply</span>
          )}
        </div>

        <h2 className="text-lg font-medium text-gray-900 mb-6">
          {currentQuestion.question_text}
        </h2>

        {/* Options */}
        {currentQuestion.question_type !== 'fill_in_blank' && currentQuestion.options && (
          <div className="space-y-3">
            {currentQuestion.options.map((option) => {
              const isSelected = (answers[currentQuestion.id] || []).includes(option.id);
              const isCorrectOption = currentQuestion.correct_answers.includes(option.id);
              
              let bgColor = 'bg-gray-50 hover:bg-gray-100';
              let borderColor = 'border-gray-200';
              
              if (showFeedback) {
                if (isCorrectOption) {
                  bgColor = 'bg-green-50';
                  borderColor = 'border-green-500';
                } else if (isSelected && !isCorrectOption) {
                  bgColor = 'bg-red-50';
                  borderColor = 'border-red-500';
                }
              } else if (isSelected) {
                bgColor = 'bg-blue-50';
                borderColor = 'border-blue-500';
              }

              return (
                <button
                  key={option.id}
                  onClick={() => handleSelectAnswer(option.id)}
                  disabled={showFeedback}
                  className={`w-full p-4 border-2 ${borderColor} ${bgColor} rounded-xl text-left transition-colors flex items-center gap-3`}
                >
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    isSelected ? 'border-blue-500 bg-blue-500' : 'border-gray-300'
                  }`}>
                    {isSelected && (
                      currentQuestion.question_type === 'single_choice' 
                        ? <div className="w-2 h-2 bg-white rounded-full" />
                        : <CheckCircle className="w-4 h-4 text-white" />
                    )}
                  </div>
                  <span className="text-gray-900">{option.text}</span>
                  {showFeedback && isCorrectOption && (
                    <CheckCircle className="w-5 h-5 text-green-600 ml-auto" />
                  )}
                  {showFeedback && isSelected && !isCorrectOption && (
                    <XCircle className="w-5 h-5 text-red-600 ml-auto" />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Fill in the Blank */}
        {currentQuestion.question_type === 'fill_in_blank' && (
          <div>
            <input
              type="text"
              placeholder="Type your answer..."
              value={answers[currentQuestion.id]?.[0] || ''}
              onChange={(e) => handleFillBlank(e.target.value)}
              disabled={showFeedback}
              className={`w-full p-4 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                showFeedback 
                  ? isCorrect 
                    ? 'border-green-500 bg-green-50' 
                    : 'border-red-500 bg-red-50'
                  : 'border-gray-200'
              }`}
            />
            {showFeedback && !isCorrect && (
              <p className="mt-2 text-green-600">
                Correct answer: <strong>{currentQuestion.correct_answers[0]}</strong>
              </p>
            )}
          </div>
        )}

        {/* Feedback */}
        {showFeedback && currentQuestion.explanation && (
          <div className={`mt-6 p-4 rounded-xl ${isCorrect ? 'bg-green-50' : 'bg-yellow-50'}`}>
            <p className={`font-medium mb-1 ${isCorrect ? 'text-green-800' : 'text-yellow-800'}`}>
              {isCorrect ? '✓ Correct!' : '✗ Incorrect'}
            </p>
            <p className="text-gray-700 text-sm">{currentQuestion.explanation}</p>
          </div>
        )}
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={handlePrevious}
          disabled={currentIndex === 0}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Previous
        </Button>

        <div className="flex gap-3">
          {!showFeedback && isAnswered && (
            <Button onClick={handleCheckAnswer}>
              Check Answer
            </Button>
          )}

          {showFeedback && currentIndex < questions.length - 1 && (
            <Button onClick={handleNext}>
              Next
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          )}

          {(showFeedback && currentIndex === questions.length - 1) || 
           Object.keys(answers).length === questions.length ? (
            <Button 
              onClick={handleFinish}
              isLoading={isSubmitting}
              className="bg-green-600 hover:bg-green-700"
            >
              <Flag className="w-4 h-4 mr-2" />
              Finish Practice
            </Button>
          ) : null}
        </div>
      </div>

      {/* Question Navigation Dots */}
      <div className="flex flex-wrap gap-2 justify-center">
        {questions.map((q, idx) => {
          const hasAnswer = answers[q.id]?.length > 0;
          return (
            <button
              key={q.id}
              onClick={() => {
                setCurrentIndex(idx);
                setShowFeedback(false);
              }}
              className={`w-8 h-8 rounded-full text-sm font-medium transition-colors ${
                idx === currentIndex 
                  ? 'bg-blue-600 text-white' 
                  : hasAnswer 
                    ? 'bg-green-100 text-green-700' 
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {idx + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}
