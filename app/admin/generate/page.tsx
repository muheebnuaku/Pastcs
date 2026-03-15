'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, Button, Select, Textarea, Badge } from '@/components/ui';
import type { Course, Topic } from '@/types';
import {
  Sparkles,
  Upload,
  FileText,
  Check,
  AlertCircle,
  RefreshCw,
  BookOpen,
  FileUp,
  X,
  ScanText,
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

const LEVELS = [100, 200, 300, 400] as const;

export default function AdminGeneratePage() {
  const [allCourses, setAllCourses] = useState<Course[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const [saveCount, setSaveCount] = useState(0);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedLevel, setSelectedLevel] = useState('');
  const [selectedSemester, setSelectedSemester] = useState('');
  const [selectedCourse, setSelectedCourse] = useState('');
  const [selectedTopic, setSelectedTopic] = useState('');
  const [slideContent, setSlideContent] = useState('');
  const [generatedQuestions, setGeneratedQuestions] = useState<GeneratedQuestion[]>([]);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // PDF upload state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [pdfTopic, setPdfTopic] = useState('');

  // Load all courses once
  useEffect(() => {
    const supabase = createClient();
    supabase.from('courses').select('*').order('level').then(({ data }: { data: Course[] | null }) => {
      if (data) setAllCourses(data);
    });
  }, []);

  // Filter courses by level + semester
  const filteredCourses = allCourses.filter(c => {
    if (selectedLevel && c.level !== Number(selectedLevel)) return false;
    if (selectedSemester && c.semester !== Number(selectedSemester)) return false;
    return true;
  });

  // Reset course when level/semester changes
  useEffect(() => {
    setSelectedCourse('');
    setSelectedTopic('');
    setTopics([]);
  }, [selectedLevel, selectedSemester]);

  // Load topics when course changes
  useEffect(() => {
    if (!selectedCourse) {
      setTopics([]);
      setSelectedTopic('');
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from('topics')
      .select('*')
      .eq('course_id', selectedCourse)
      .order('order_index')
      .then(({ data }: { data: Topic[] | null }) => {
        if (!cancelled) {
          const unique = (data || []).filter((t: Topic, i: number, arr: Topic[]) =>
            arr.findIndex((x: Topic) => x.topic_name === t.topic_name) === i
          );
          setTopics(unique);
          setSelectedTopic('');
        }
      });
    return () => { cancelled = true; };
  }, [selectedCourse]);

  const selectedTopicObj = topics.find(t => t.id === selectedTopic);
  const canGenerate = selectedCourse && (slideContent.trim() || selectedTopic);

  // Handle PDF file selection
  const handlePdfSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfFile(file);
    setPdfTopic('');
    setSlideContent('');
    handlePdfParse(file);
  };

  const handlePdfParse = async (file: File) => {
    setIsParsing(true);
    setError('');
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/parse-pdf', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to parse PDF');
      setSlideContent(data.text || '');
      setPdfTopic(data.detectedTopic || '');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to parse PDF');
      setPdfFile(null);
    } finally {
      setIsParsing(false);
    }
  };

  const clearPdf = () => {
    setPdfFile(null);
    setPdfTopic('');
    setSlideContent('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleGenerate = async () => {
    if (!canGenerate) {
      setError('Please select a course and either upload a PDF, paste slide content, or choose a topic');
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
          slideContent: slideContent.trim() || null,
          courseId: selectedCourse,
          topicId: selectedTopic || null,
          topicName: selectedTopicObj?.topic_name || pdfTopic || null,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to generate questions');

      setGeneratedQuestions(data.questions.map((q: GeneratedQuestion) => ({ ...q, selected: true })));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate questions');
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
          topic_id: selectedTopic || null,
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
      clearPdf();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save questions');
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
        <p className="text-gray-600">Generate exam questions from PDF slides or by topic</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Section */}
        <Card>
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Generation Settings
            </h2>
          </div>
          <CardContent className="space-y-4">
            {/* Level + Semester row */}
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Level"
                value={selectedLevel}
                onChange={e => setSelectedLevel(e.target.value)}
              >
                <option value="">All Levels</option>
                {LEVELS.map(l => (
                  <option key={l} value={l}>Level {l}</option>
                ))}
              </Select>
              <Select
                label="Semester"
                value={selectedSemester}
                onChange={e => setSelectedSemester(e.target.value)}
              >
                <option value="">All Semesters</option>
                <option value="1">Semester 1</option>
                <option value="2">Semester 2</option>
              </Select>
            </div>

            {/* Course selector */}
            <Select
              label="Course"
              value={selectedCourse}
              onChange={(e) => { setSelectedCourse(e.target.value); setGeneratedQuestions([]); }}
            >
              <option value="">Select Course</option>
              {filteredCourses.map(c => (
                <option key={c.id} value={c.id}>
                  {c.course_code} — {c.course_name}
                </option>
              ))}
            </Select>

            {/* Topic selector */}
            {selectedCourse && (
              <div>
                <Select
                  label="Topic (optional — AI generates without slides when set)"
                  value={selectedTopic}
                  onChange={(e) => setSelectedTopic(e.target.value)}
                >
                  <option value="">All topics / use slide content</option>
                  {topics.map(t => (
                    <option key={t.id} value={t.id}>{t.topic_name}</option>
                  ))}
                </Select>
                {selectedTopic && (
                  <div className="mt-2 flex items-center gap-2 p-2.5 bg-purple-50 border border-purple-100 rounded-lg">
                    <BookOpen className="w-4 h-4 text-purple-600 flex-shrink-0" />
                    <p className="text-xs text-purple-700">
                      <span className="font-semibold">Topic mode:</span> AI will generate questions
                      specifically for <span className="font-semibold">{selectedTopicObj?.topic_name}</span>.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* PDF Upload area */}
            {selectedCourse && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Upload PDF Slide</p>

                {!pdfFile ? (
                  <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer bg-gray-50 hover:bg-blue-50 hover:border-blue-400 transition-colors">
                    <FileUp className="w-7 h-7 text-gray-400 mb-1" />
                    <span className="text-sm text-gray-500">Click to upload a PDF</span>
                    <span className="text-xs text-gray-400">AI will scan and extract topic &amp; content</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={handlePdfSelect}
                    />
                  </label>
                ) : (
                  <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-xl">
                    {isParsing ? (
                      <>
                        <ScanText className="w-5 h-5 text-blue-600 animate-pulse flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-blue-800">Scanning PDF...</p>
                          <p className="text-xs text-blue-500">AI is extracting topic and content</p>
                        </div>
                        <RefreshCw className="w-4 h-4 text-blue-500 animate-spin flex-shrink-0" />
                      </>
                    ) : (
                      <>
                        <FileText className="w-5 h-5 text-blue-600 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-blue-800 truncate">{pdfFile.name}</p>
                          {pdfTopic && (
                            <p className="text-xs text-blue-600">
                              Detected topic: <span className="font-semibold">{pdfTopic}</span>
                            </p>
                          )}
                        </div>
                        <button
                          onClick={clearPdf}
                          className="p-1 hover:bg-blue-200 rounded-full transition-colors flex-shrink-0"
                        >
                          <X className="w-4 h-4 text-blue-700" />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Slide content textarea */}
            {selectedCourse && (
              <Textarea
                label={pdfFile
                  ? 'Extracted Slide Content (editable)'
                  : selectedTopic
                    ? 'Slide Content (optional when topic is selected)'
                    : 'Paste Lecture Slide Content'}
                placeholder={pdfFile
                  ? 'PDF content will appear here after scanning...'
                  : selectedTopic
                    ? 'Optionally paste slide content to improve question quality...'
                    : `Paste the text content from your lecture slides here...

Example:
Chapter 3: Number Systems

Binary Number System
- Base 2 system using digits 0 and 1
- Each position represents a power of 2`}
                value={slideContent}
                onChange={(e) => setSlideContent(e.target.value)}
                rows={selectedTopic || pdfFile ? 6 : 10}
              />
            )}

            {!selectedTopic && !pdfFile && selectedCourse && (
              <div className="bg-blue-50 rounded-lg p-4">
                <h4 className="font-medium text-blue-900 mb-2">Tips for better results:</h4>
                <ul className="text-sm text-blue-700 space-y-1">
                  <li>• Upload a PDF or paste slide text above</li>
                  <li>• Include key concepts and definitions</li>
                  <li>• More content = more questions generated</li>
                </ul>
              </div>
            )}

            <Button
              onClick={handleGenerate}
              disabled={isGenerating || !canGenerate || isParsing}
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
                  {selectedTopic && !slideContent.trim()
                    ? `Generate from "${selectedTopicObj?.topic_name}"`
                    : pdfTopic && !selectedTopic
                      ? `Generate from "${pdfTopic}"`
                      : 'Generate Questions with AI'}
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
                      <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
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
