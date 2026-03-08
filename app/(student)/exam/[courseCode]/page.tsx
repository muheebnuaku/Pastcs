'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers';
import { Card, Button, Badge, Progress, Modal } from '@/components/ui';
import { shuffleArray, formatTime, QUESTIONS_PER_EXAM, EXAM_DURATION_MINUTES } from '@/lib/utils';
import type { Question, Course } from '@/types';
import { 
  ArrowLeft, 
  ArrowRight, 
  Clock,
  AlertTriangle,
  Flag,
  CheckCircle,
} from 'lucide-react';

export default function ExamPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  
  const courseCode = (params.courseCode as string).toUpperCase();

  const [course, setCourse] = useState<Course | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [timeRemaining, setTimeRemaining] = useState(EXAM_DURATION_MINUTES * 60);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [showTimeWarning, setShowTimeWarning] = useState(false);
  const [examStarted, setExamStarted] = useState(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const submitExam = useCallback(async () => {
    if (isSubmitting) return;
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

    const timeTaken = (EXAM_DURATION_MINUTES * 60) - timeRemaining;

    // Save test
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
      // Save individual answers
      const testAnswers = questions.map(q => ({
        test_id: testData.id,
        question_id: q.id,
        selected_answer: answers[q.id] || [],
        is_correct: JSON.stringify((answers[q.id] || []).sort()) === JSON.stringify(q.correct_answers.sort()),
      }));

      await supabase.from('test_answers').insert(testAnswers);

      // Update streak
      await supabase.rpc('update_practice_streak', { p_user_id: user?.id });

      router.push(`/results/${testData.id}`);
    }
  }, [isSubmitting, questions, answers, timeRemaining, course, user, router]);

  useEffect(() => {
    const fetchQuestions = async () => {
      const supabase = createClient();
      
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
  }, [courseCode, router]);

  // Timer effect
  useEffect(() => {
    if (!examStarted || isSubmitting) return;

    timerRef.current = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          submitExam();
          return 0;
        }
        if (prev === 300 && !showTimeWarning) { // 5 minutes warning
          setShowTimeWarning(true);
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [examStarted, isSubmitting, showTimeWarning, submitExam]);

  const currentQuestion = questions[currentIndex];

  const handleSelectAnswer = (optionId: string) => {
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
    setAnswers({ ...answers, [currentQuestion.id]: [value.trim().toLowerCase()] });
  };

  const answeredCount = Object.keys(answers).filter(id => answers[id]?.length > 0).length;

  if (!examStarted) {
    return (
      <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
        <Card className="p-8 text-center">
          <div className="w-20 h-20 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Clock className="w-10 h-10 text-purple-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Exam Simulation</h1>
          <p className="text-gray-600 mb-6">{course?.course_code} - {course?.course_name}</p>
          
          <div className="bg-gray-50 rounded-xl p-6 mb-6 text-left">
            <h2 className="font-semibold text-gray-900 mb-4">Exam Rules:</h2>
            <ul className="space-y-2 text-gray-600">
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
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      {/* Sticky Header */}
      <div className="sticky top-0 z-10 bg-gray-50 py-4 -mx-6 px-6">
        <div className="flex items-center justify-between mb-4">
          <Badge variant="info">{course?.course_code}</Badge>
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full font-mono font-semibold ${
            timeRemaining <= 300 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'
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
          <Badge variant={
            currentQuestion.question_type === 'single_choice' ? 'default' :
            currentQuestion.question_type === 'multiple_choice' ? 'info' : 'warning'
          }>
            {currentQuestion.question_type === 'single_choice' && 'Single Choice'}
            {currentQuestion.question_type === 'multiple_choice' && 'Multiple Choice (Select all)'}
            {currentQuestion.question_type === 'fill_in_blank' && 'Fill in the Blank'}
          </Badge>
        </div>

        <h2 className="text-lg font-medium text-gray-900 mb-6">
          {currentQuestion.question_text}
        </h2>

        {/* Options */}
        {currentQuestion.question_type !== 'fill_in_blank' && currentQuestion.options && (
          <div className="space-y-3">
            {currentQuestion.options.map((option) => {
              const isSelected = (answers[currentQuestion.id] || []).includes(option.id);
              
              return (
                <button
                  key={option.id}
                  onClick={() => handleSelectAnswer(option.id)}
                  className={`w-full p-4 border-2 rounded-xl text-left transition-colors flex items-center gap-3 ${
                    isSelected 
                      ? 'border-blue-500 bg-blue-50' 
                      : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                  }`}
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
                </button>
              );
            })}
          </div>
        )}

        {/* Fill in the Blank */}
        {currentQuestion.question_type === 'fill_in_blank' && (
          <input
            type="text"
            placeholder="Type your answer..."
            value={answers[currentQuestion.id]?.[0] || ''}
            onChange={(e) => handleFillBlank(e.target.value)}
            className="w-full p-4 border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
            <Button onClick={() => setCurrentIndex(currentIndex + 1)}>
              Next
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <Button 
              onClick={() => setShowSubmitModal(true)}
              className="bg-green-600 hover:bg-green-700"
            >
              <Flag className="w-4 h-4 mr-2" />
              Submit Exam
            </Button>
          )}
        </div>
      </div>

      {/* Question Navigator */}
      <Card className="p-4">
        <p className="text-sm text-gray-600 mb-3">Question Navigator:</p>
        <div className="flex flex-wrap gap-2">
          {questions.map((q, idx) => {
            const hasAnswer = answers[q.id]?.length > 0;
            return (
              <button
                key={q.id}
                onClick={() => setCurrentIndex(idx)}
                className={`w-10 h-10 rounded-lg text-sm font-medium transition-colors ${
                  idx === currentIndex 
                    ? 'bg-blue-600 text-white' 
                    : hasAnswer 
                      ? 'bg-green-100 text-green-700 border border-green-300' 
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {idx + 1}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Submit Modal */}
      <Modal
        isOpen={showSubmitModal}
        onClose={() => setShowSubmitModal(false)}
        title="Submit Exam?"
      >
        <div className="space-y-4">
          <p className="text-gray-600">
            You have answered <strong>{answeredCount}</strong> out of <strong>{questions.length}</strong> questions.
          </p>
          {answeredCount < questions.length && (
            <div className="p-4 bg-yellow-50 rounded-lg flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-yellow-800">
                You have {questions.length - answeredCount} unanswered questions. 
                Are you sure you want to submit?
              </p>
            </div>
          )}
          <div className="flex gap-3 pt-4">
            <Button 
              variant="outline" 
              className="flex-1"
              onClick={() => setShowSubmitModal(false)}
            >
              Continue Exam
            </Button>
            <Button 
              className="flex-1 bg-green-600 hover:bg-green-700"
              onClick={() => submitExam()}
              isLoading={isSubmitting}
            >
              Submit Exam
            </Button>
          </div>
        </div>
      </Modal>

      {/* Time Warning Modal */}
      <Modal
        isOpen={showTimeWarning}
        onClose={() => setShowTimeWarning(false)}
        title="⚠️ Time Warning"
      >
        <p className="text-gray-600 mb-4">
          You have <strong>5 minutes</strong> remaining! The exam will auto-submit when time runs out.
        </p>
        <Button className="w-full" onClick={() => setShowTimeWarning(false)}>
          Continue
        </Button>
      </Modal>
    </div>
  );
}
