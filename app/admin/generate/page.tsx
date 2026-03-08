'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, Button, Select, Textarea, Badge } from '@/components/ui';
import type { Course, Question } from '@/types';
import {
  Sparkles,
  Upload,
  FileText,
  Check,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

interface GeneratedQuestion {
  question_text: string;
  question_type: 'single_choice' | 'multiple_choice' | 'fill_in_blank';
  options: string[] | null;
  correct_answer: string | string[];
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
  selected?: boolean;
}

export default function AdminGeneratePage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const [saveCount, setSaveCount] = useState(0);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [selectedCourse, setSelectedCourse] = useState('');
  const [slideContent, setSlideContent] = useState('');
  const [generatedQuestions, setGeneratedQuestions] = useState<GeneratedQuestion[]>([]);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();
      const { data } = await supabase.from('courses').select('*').order('course_code');
      if (data) setCourses(data);
    };
    fetchData();
  }, []);

  const handleGenerate = async () => {
    if (!selectedCourse || !slideContent.trim()) {
      setError('Please select a course and enter slide content');
      return;
    }

    setIsGenerating(true);
    setError('');
    setSuccessMessage('');
    setGeneratedQuestions([]);

    try {
      const response = await fetch('/api/generate-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slideContent,
          courseId: selectedCourse,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate questions');
      }

      setGeneratedQuestions(data.questions.map((q: GeneratedQuestion) => ({ ...q, selected: true })));
    } catch (err: any) {
      setError(err?.message || 'Failed to generate questions');
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleQuestionSelection = (index: number) => {
    setGeneratedQuestions(prev =>
      prev.map((q, i) => i === index ? { ...q, selected: !q.selected } : q)
    );
  };

  const handleSaveSelected = async () => {
    const selectedQuestions = generatedQuestions.filter(q => q.selected);
    if (selectedQuestions.length === 0) {
      setError('Please select at least one question to save');
      return;
    }

    setIsSaving(true);
    setSaveProgress(0);
    setSaveCount(selectedQuestions.length);
    setError('');

    // Animate progress bar — advances quickly at first then slows near 90%
    // so it never falsely hits 100% before the request finishes
    progressRef.current = setInterval(() => {
      setSaveProgress(prev => {
        if (prev >= 90) { clearInterval(progressRef.current!); return prev; }
        return prev + (90 - prev) * 0.08;
      });
    }, 150);

    try {
      const questionsToInsert = selectedQuestions.map(q => {
        const options = q.options
          ? q.options.map((text, i) => ({ id: `opt_${i}`, text }))
          : null;

        let correct_answers: string[];
        if (q.question_type === 'fill_in_blank') {
          correct_answers = [Array.isArray(q.correct_answer) ? q.correct_answer[0] : q.correct_answer];
        } else if (options) {
          const correctTexts = Array.isArray(q.correct_answer) ? q.correct_answer : [q.correct_answer];
          correct_answers = options
            .filter(opt => correctTexts.includes(opt.text))
            .map(opt => opt.id);
        } else {
          correct_answers = Array.isArray(q.correct_answer) ? q.correct_answer : [q.correct_answer];
        }

        return {
          course_id: selectedCourse,
          question_type: q.question_type,
          question_text: q.question_text,
          options,
          correct_answers,
          explanation: q.explanation,
          difficulty: q.difficulty,
          is_approved: true,
        };
      });

      const response = await fetch('/api/save-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: questionsToInsert, courseId: selectedCourse }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to save questions');

      setSuccessMessage(`Successfully saved ${result.saved} questions!`);
      setSaveProgress(100);
      setGeneratedQuestions([]);
      setSlideContent('');
    } catch (err: any) {
      setError(err?.message || 'Failed to save questions');
    } finally {
      if (progressRef.current) clearInterval(progressRef.current);
      setIsSaving(false);
    }
  };

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'easy': return 'success';
      case 'medium': return 'warning';
      case 'hard': return 'danger';
      default: return 'default';
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">AI Question Generator</h1>
        <p className="text-gray-600">Generate exam questions from lecture slides using AI</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Section */}
        <Card>
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Slide Content
            </h2>
          </div>
          <CardContent className="space-y-4">
            <Select
              label="Course"
              value={selectedCourse}
              onChange={(e) => setSelectedCourse(e.target.value)}
            >
              <option value="">Select Course</option>
              {courses.map(c => (
                <option key={c.id} value={c.id}>{c.course_code} — {c.course_name}</option>
              ))}
            </Select>

            <Textarea
              label="Paste Lecture Slide Content"
              placeholder="Paste the text content from your lecture slides here...

Example:
Chapter 3: Number Systems

Binary Number System
- Base 2 system using digits 0 and 1
- Each position represents a power of 2
- Conversion to decimal: multiply each digit by its positional value

Hexadecimal Number System
- Base 16 system using digits 0-9 and A-F
- Used in computing for compact representation
- 4 binary digits = 1 hexadecimal digit"
              value={slideContent}
              onChange={(e) => setSlideContent(e.target.value)}
              rows={12}
            />

            <div className="bg-blue-50 rounded-lg p-4">
              <h4 className="font-medium text-blue-900 mb-2">Tips for better results:</h4>
              <ul className="text-sm text-blue-700 space-y-1">
                <li>• Include key concepts and definitions</li>
                <li>• Add examples and formulas</li>
                <li>• Paste content from multiple slides</li>
                <li>• More content = better questions</li>
              </ul>
            </div>

            <Button
              onClick={handleGenerate}
              disabled={isGenerating || !selectedCourse || !slideContent.trim()}
              className="w-full"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Generating Questions...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate Questions with AI
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Generated Questions Section */}
        <Card>
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              Generated Questions
            </h2>
            {generatedQuestions.length > 0 && (
              <span className="text-sm text-gray-500">
                {generatedQuestions.filter(q => q.selected).length} selected
              </span>
            )}
          </div>
          <div className="p-6">
            {error && (
              <div className="flex items-center gap-2 text-red-600 bg-red-50 p-4 rounded-lg mb-4">
                <AlertCircle className="w-5 h-5" />
                {error}
              </div>
            )}

            {successMessage && (
              <div className="flex items-center gap-2 text-green-600 bg-green-50 p-4 rounded-lg mb-4">
                <Check className="w-5 h-5" />
                {successMessage}
              </div>
            )}

            {generatedQuestions.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Sparkles className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                <p>Generated questions will appear here</p>
              </div>
            ) : (
              <div className="space-y-4 max-h-[600px] overflow-y-auto">
                {generatedQuestions.map((question, idx) => (
                  <div
                    key={idx}
                    className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                      question.selected
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                    onClick={() => toggleQuestionSelection(idx)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant={getDifficultyColor(question.difficulty)} size="sm">
                            {question.difficulty}
                          </Badge>
                          <Badge variant="default" size="sm">
                            {question.question_type.replace('_', ' ')}
                          </Badge>
                        </div>
                        <p className="font-medium text-gray-900 mb-2">{question.question_text}</p>
                        {question.options && (
                          <div className="space-y-1 mb-2">
                            {question.options.map((opt, i) => (
                              <div
                                key={i}
                                className={`text-sm px-2 py-1 rounded ${
                                  (Array.isArray(question.correct_answer)
                                    ? question.correct_answer.includes(opt)
                                    : question.correct_answer === opt)
                                    ? 'bg-green-100 text-green-800'
                                    : 'bg-gray-100 text-gray-600'
                                }`}
                              >
                                {String.fromCharCode(65 + i)}. {opt}
                              </div>
                            ))}
                          </div>
                        )}
                        {question.question_type === 'fill_in_blank' && (
                          <p className="text-sm text-green-600">
                            Answer: {question.correct_answer}
                          </p>
                        )}
                        {question.explanation && (
                          <p className="text-sm text-gray-500 mt-2">
                            💡 {question.explanation}
                          </p>
                        )}
                      </div>
                      <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                        question.selected
                          ? 'bg-blue-500 border-blue-500'
                          : 'border-gray-300'
                      }`}>
                        {question.selected && <Check className="w-4 h-4 text-white" />}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {generatedQuestions.length > 0 && (
              <div className="mt-4 space-y-3">
                {isSaving && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-blue-700">
                        Saving {saveCount} question{saveCount !== 1 ? 's' : ''} to database...
                      </span>
                      <span className="text-sm font-semibold text-blue-700">
                        {Math.round(saveProgress)}%
                      </span>
                    </div>
                    <div className="w-full bg-blue-200 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-2 rounded-full bg-blue-600 transition-all duration-150"
                        style={{ width: `${saveProgress}%` }}
                      />
                    </div>
                  </div>
                )}
                <Button
                  onClick={handleSaveSelected}
                  disabled={isSaving || generatedQuestions.filter(q => q.selected).length === 0}
                  className="w-full"
                >
                  {isSaving ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Saving {saveCount} questions...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      Save Selected Questions ({generatedQuestions.filter(q => q.selected).length})
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
