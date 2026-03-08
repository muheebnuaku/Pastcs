'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, Button, Select, Textarea, Badge, Loading } from '@/components/ui';
import type { Course, Topic, Question } from '@/types';
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
  const [topics, setTopics] = useState<Topic[]>([]);
  const [filteredTopics, setFilteredTopics] = useState<Topic[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [selectedCourse, setSelectedCourse] = useState('');
  const [selectedTopic, setSelectedTopic] = useState('');
  const [slideContent, setSlideContent] = useState('');
  const [generatedQuestions, setGeneratedQuestions] = useState<GeneratedQuestion[]>([]);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();
      const [coursesRes, topicsRes] = await Promise.all([
        supabase.from('courses').select('*').order('course_code'),
        supabase.from('topics').select('*').order('order_index'),
      ]);

      if (coursesRes.data) setCourses(coursesRes.data);
      if (topicsRes.data) setTopics(topicsRes.data);
      setIsLoading(false);
    };

    fetchData();
  }, []);

  useEffect(() => {
    if (selectedCourse) {
      setFilteredTopics(topics.filter(t => t.course_id === selectedCourse));
    } else {
      setFilteredTopics([]);
    }
  }, [selectedCourse, topics]);

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
          topicId: selectedTopic || null,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate questions');
      }

      const data = await response.json();
      setGeneratedQuestions(data.questions.map((q: GeneratedQuestion) => ({ ...q, selected: true })));
    } catch (err) {
      setError('Failed to generate questions. Please check your OpenAI API key and try again.');
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
    setError('');

    try {
      const supabase = createClient();
      
      const questionsToInsert = selectedQuestions.map(q => ({
        course_id: selectedCourse,
        topic_id: selectedTopic || null,
        question_type: q.question_type,
        question_text: q.question_text,
        options: q.options,
        correct_answer: q.correct_answer,
        explanation: q.explanation,
        difficulty: q.difficulty,
      }));

      const { error: insertError } = await supabase
        .from('questions')
        .insert(questionsToInsert);

      if (insertError) throw insertError;

      setSuccessMessage(`Successfully saved ${selectedQuestions.length} questions!`);
      setGeneratedQuestions([]);
      setSlideContent('');
    } catch (err) {
      setError('Failed to save questions');
    } finally {
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loading size="lg" text="Loading..." />
      </div>
    );
  }

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
            <div className="grid grid-cols-2 gap-4">
              <Select
                label="Course"
                value={selectedCourse}
                onChange={(e) => {
                  setSelectedCourse(e.target.value);
                  setSelectedTopic('');
                }}
              >
                <option value="">Select Course</option>
                {courses.map(c => (
                  <option key={c.id} value={c.id}>{c.course_code}</option>
                ))}
              </Select>
              <Select
                label="Topic (optional)"
                value={selectedTopic}
                onChange={(e) => setSelectedTopic(e.target.value)}
                disabled={!selectedCourse}
              >
                <option value="">Select Topic</option>
                {filteredTopics.map(t => (
                  <option key={t.id} value={t.id}>{t.topic_name}</option>
                ))}
              </Select>
            </div>

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
              <Button
                onClick={handleSaveSelected}
                disabled={isSaving || generatedQuestions.filter(q => q.selected).length === 0}
                className="w-full mt-4"
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Save Selected Questions ({generatedQuestions.filter(q => q.selected).length})
                  </>
                )}
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
