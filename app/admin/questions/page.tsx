'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, Button, Input, Select, Modal, Badge, Textarea } from '@/components/ui';
import { QUESTION_TYPE_LABELS } from '@/lib/utils';
import type { Question, Course, Topic } from '@/types';
import {
  Plus,
  Edit,
  Trash2,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

export default function AdminQuestionsPage() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  // Separate topic lists for filter bar and modal to avoid state collision
  const [filterBarTopics, setFilterBarTopics] = useState<Topic[]>([]);
  const [formTopics, setFormTopics] = useState<Topic[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);

  // Level / Semester filters
  const [filterLevel, setFilterLevel] = useState('');
  const [filterSemester, setFilterSemester] = useState('');

  // Other filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCourse, setFilterCourse] = useState('');
  const [filterTopic, setFilterTopic] = useState('');
  const [filterType, setFilterType] = useState('');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Form state
  const [formCourseId, setFormCourseId] = useState('');
  const [formTopicId, setFormTopicId] = useState('');
  const [formType, setFormType] = useState<'single_choice' | 'multiple_choice' | 'fill_in_blank'>('single_choice');
  const [formQuestionText, setFormQuestionText] = useState('');
  const [formOptions, setFormOptions] = useState<string[]>(['', '', '', '']);
  const [formCorrectAnswer, setFormCorrectAnswer] = useState<string | string[]>('');
  const [formExplanation, setFormExplanation] = useState('');
  const [formDifficulty, setFormDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');

  const fetchData = async () => {
    const supabase = createClient();
    const [coursesRes, topicsRes] = await Promise.all([
      supabase.from('courses').select('*').order('course_code'),
      supabase.from('topics').select('*').order('order_index'),
    ]);
    if (coursesRes.data) setCourses(coursesRes.data);
    if (topicsRes.data) {
      const unique = topicsRes.data.filter((t: Topic, i: number, arr: Topic[]) =>
        arr.findIndex((x: Topic) => x.topic_name === t.topic_name) === i
      );
      setTopics(unique);
    }
  };

  const fetchQuestions = async () => {
    if (!filterLevel) { setQuestions([]); setSelectedIds(new Set()); return; }
    const supabase = createClient();
    let query = supabase
      .from('questions')
      .select('*, course:courses(course_code), topic:topics(topic_name)')
      .order('created_at', { ascending: false });

    if (filterCourse) {
      query = query.eq('course_id', filterCourse);
    } else {
      const ids = courses
        .filter(c => {
          if (c.level !== Number(filterLevel)) return false;
          if (filterSemester && c.semester !== Number(filterSemester)) return false;
          return true;
        })
        .map(c => c.id);
      if (ids.length > 0) query = query.in('course_id', ids);
    }

    if (filterTopic) query = query.eq('topic_id', filterTopic);
    if (filterType) query = query.eq('question_type', filterType);

    const { data } = await query;
    if (data) {
      setQuestions(data);
      setSelectedIds(new Set());
    }
  };

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    fetchQuestions();
    setCurrentPage(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterLevel, filterSemester, filterCourse, filterTopic, filterType]);

  useEffect(() => {
    setFilterCourse('');
    setFilterTopic('');
  }, [filterLevel, filterSemester]);

  // Filter bar topics — keyed to filterCourse
  useEffect(() => {
    setFilterBarTopics(filterCourse ? topics.filter(t => t.course_id === filterCourse) : topics);
  }, [filterCourse, topics]);

  // Modal form topics — keyed to formCourseId
  useEffect(() => {
    setFormTopics(formCourseId ? topics.filter(t => t.course_id === formCourseId) : []);
  }, [formCourseId, topics]);

  const levelCourses = courses.filter(c => {
    if (filterLevel && c.level !== Number(filterLevel)) return false;
    if (filterSemester && c.semester !== Number(filterSemester)) return false;
    return true;
  });

  const filteredQuestions = questions.filter(q =>
    q.question_text.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalPages = Math.ceil(filteredQuestions.length / pageSize);
  const paginatedQuestions = filteredQuestions.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  // Selection helpers
  const allOnPageSelected = paginatedQuestions.length > 0 &&
    paginatedQuestions.every(q => selectedIds.has(q.id));

  const toggleOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllFiltered = () => {
    if (selectedIds.size === filteredQuestions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredQuestions.map(q => q.id)));
    }
  };

  const togglePageSelection = () => {
    if (allOnPageSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        paginatedQuestions.forEach(q => next.delete(q.id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        paginatedQuestions.forEach(q => next.add(q.id));
        return next;
      });
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} question${selectedIds.size !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    setIsDeleting(true);
    const supabase = createClient();
    await supabase.from('questions').delete().in('id', [...selectedIds]);
    setIsDeleting(false);
    setSelectedIds(new Set());
    fetchQuestions();
  };

  const openModal = (question?: Question) => {
    if (question) {
      setEditingQuestion(question);
      setFormCourseId(question.course_id);
      setFormTopicId(question.topic_id || '');
      setFormType(question.question_type);
      setFormQuestionText(question.question_text);
      setFormOptions(question.options?.map(o => o.text) || ['', '', '', '']);
      setFormCorrectAnswer(question.question_type === 'multiple_choice' ? question.correct_answers : (question.correct_answers[0] || ''));
      setFormExplanation(question.explanation || '');
      setFormDifficulty(question.difficulty);
    } else {
      setEditingQuestion(null);
      setFormCourseId('');
      setFormTopicId('');
      setFormType('single_choice');
      setFormQuestionText('');
      setFormOptions(['', '', '', '']);
      setFormCorrectAnswer('');
      setFormExplanation('');
      setFormDifficulty('medium');
    }
    setShowModal(true);
  };

  const handleSave = async () => {
    const supabase = createClient();
    const questionData = {
      course_id: formCourseId,
      topic_id: formTopicId || null,
      question_type: formType,
      question_text: formQuestionText,
      options: formType !== 'fill_in_blank' ? formOptions.filter(o => o.trim()) : null,
      correct_answer: formCorrectAnswer,
      explanation: formExplanation || null,
      difficulty: formDifficulty,
    };

    if (editingQuestion) {
      await supabase.from('questions').update(questionData).eq('id', editingQuestion.id);
    } else {
      await supabase.from('questions').insert(questionData);
    }
    setShowModal(false);
    fetchQuestions();
  };

  const handleDelete = async (questionId: string) => {
    if (!confirm('Delete this question?')) return;
    const supabase = createClient();
    await supabase.from('questions').delete().eq('id', questionId);
    fetchQuestions();
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Question Bank</h1>
          <p className="text-gray-600">{filteredQuestions.length} questions total</p>
        </div>
        <Button onClick={() => openModal()}>
          <Plus className="w-4 h-4 mr-2" />
          Add Question
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Select value={filterLevel} onChange={(e) => setFilterLevel(e.target.value)}>
              <option value="">All Levels</option>
              <option value="100">Level 100</option>
              <option value="200">Level 200</option>
              <option value="300">Level 300</option>
              <option value="400">Level 400</option>
            </Select>
            <Select
              value={filterSemester}
              onChange={(e) => setFilterSemester(e.target.value)}
              disabled={!filterLevel}
            >
              <option value="">All Semesters</option>
              <option value="1">Semester 1</option>
              <option value="2">Semester 2</option>
            </Select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search questions..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                className="pl-10"
              />
            </div>
            <Select
              value={filterCourse}
              onChange={(e) => { setFilterCourse(e.target.value); setFilterTopic(''); }}
              disabled={!filterLevel}
            >
              <option value="">All Courses</option>
              {levelCourses.map(c => (
                <option key={c.id} value={c.id}>{c.course_code}</option>
              ))}
            </Select>
            <Select
              value={filterTopic}
              onChange={(e) => setFilterTopic(e.target.value)}
              disabled={!filterCourse}
            >
              <option value="">All Topics</option>
              {filterBarTopics.map(t => (
                <option key={t.id} value={t.id}>{t.topic_name}</option>
              ))}
            </Select>
            <Select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="">All Types</option>
              <option value="single_choice">Single Choice</option>
              <option value="multiple_choice">Multiple Choice</option>
              <option value="fill_in_blank">Fill in Blank</option>
            </Select>
          </div>
        </div>
      </Card>

      {/* Questions List */}
      {!filterLevel ? (
        <Card>
          <div className="py-16 text-center text-gray-500">
            <Filter className="w-10 h-10 mx-auto mb-3 text-gray-300" />
            <p className="font-medium text-gray-700 mb-1">Select a Level to view questions</p>
            <p className="text-sm">Use the Level filter above to load questions for a specific year</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {/* Bulk action bar */}
          {filteredQuestions.length > 0 && (
            <div className="flex items-center gap-3 px-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={selectedIds.size === filteredQuestions.length && filteredQuestions.length > 0}
                  ref={el => {
                    if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < filteredQuestions.length;
                  }}
                  onChange={toggleAllFiltered}
                  className="w-4 h-4 rounded text-blue-600"
                />
                <span className="text-sm text-gray-600">
                  {selectedIds.size > 0
                    ? `${selectedIds.size} of ${filteredQuestions.length} selected`
                    : `Select all ${filteredQuestions.length}`}
                </span>
              </label>

              {selectedIds.size > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleBulkDelete}
                  disabled={isDeleting}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 ml-auto"
                >
                  <Trash2 className="w-4 h-4 mr-1.5" />
                  {isDeleting ? 'Deleting…' : `Delete ${selectedIds.size} selected`}
                </Button>
              )}

              {totalPages > 1 && selectedIds.size < filteredQuestions.length && (
                <button
                  onClick={togglePageSelection}
                  className="text-xs text-blue-600 hover:underline ml-auto"
                >
                  {allOnPageSelected ? 'Deselect this page' : `Select this page (${paginatedQuestions.length})`}
                </button>
              )}
            </div>
          )}

          {paginatedQuestions.length === 0 && (
            <Card>
              <div className="py-12 text-center text-gray-500">
                <p>No questions found for the selected filters</p>
              </div>
            </Card>
          )}

          {paginatedQuestions.map((question) => {
            const isSelected = selectedIds.has(question.id);
            return (
              <Card key={question.id} className={isSelected ? 'ring-2 ring-blue-400' : ''}>
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleOne(question.id)}
                      className="w-4 h-4 mt-1 rounded text-blue-600 flex-shrink-0 cursor-pointer"
                    />
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <Badge variant="info" size="sm">{question.course?.course_code}</Badge>
                            {question.topic && (
                              <Badge variant="default" size="sm">{question.topic.topic_name}</Badge>
                            )}
                            <Badge variant={getDifficultyColor(question.difficulty)} size="sm">
                              {question.difficulty}
                            </Badge>
                            <Badge variant="default" size="sm">
                              {QUESTION_TYPE_LABELS[question.question_type]}
                            </Badge>
                          </div>
                          <p className="text-gray-900 font-medium">{question.question_text}</p>
                          {question.options && (
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              {question.options.map((opt, i) => (
                                <div
                                  key={i}
                                  className={`text-sm px-3 py-2 rounded ${
                                    question.correct_answers.includes(opt.text)
                                      ? 'bg-green-100 text-green-800'
                                      : 'bg-gray-100 text-gray-600'
                                  }`}
                                >
                                  {String.fromCharCode(65 + i)}. {opt.text}
                                </div>
                              ))}
                            </div>
                          )}
                          {question.question_type === 'fill_in_blank' && (
                            <p className="mt-2 text-sm text-green-600">
                              Answer: {question.correct_answers[0]}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Button size="sm" variant="ghost" onClick={() => openModal(question)}>
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDelete(question.id)}>
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm text-gray-600">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Question Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingQuestion ? 'Edit Question' : 'Add New Question'}
        size="lg"
      >
        <div className="space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Course"
              value={formCourseId}
              onChange={(e) => { setFormCourseId(e.target.value); setFormTopicId(''); }}
            >
              <option value="">Select Course</option>
              {courses.map(c => (
                <option key={c.id} value={c.id}>{c.course_code} - {c.course_name}</option>
              ))}
            </Select>
            <Select
              label="Topic (optional)"
              value={formTopicId}
              onChange={(e) => setFormTopicId(e.target.value)}
              disabled={!formCourseId}
            >
              <option value="">Select Topic</option>
              {formTopics.map(t => (
                <option key={t.id} value={t.id}>{t.topic_name}</option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Question Type"
              value={formType}
              onChange={(e) => {
                setFormType(e.target.value as import('@/types').QuestionType);
                setFormCorrectAnswer(e.target.value === 'multiple_choice' ? [] : '');
              }}
            >
              <option value="single_choice">Single Choice</option>
              <option value="multiple_choice">Multiple Choice</option>
              <option value="fill_in_blank">Fill in Blank</option>
            </Select>
            <Select
              label="Difficulty"
              value={formDifficulty}
              onChange={(e) => setFormDifficulty(e.target.value as import('@/types').Difficulty)}
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </Select>
          </div>

          <Textarea
            label="Question Text"
            placeholder="Enter your question..."
            value={formQuestionText}
            onChange={(e) => setFormQuestionText(e.target.value)}
            rows={3}
          />

          {formType !== 'fill_in_blank' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Options</label>
              <div className="space-y-2">
                {formOptions.map((opt, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    {formType === 'single_choice' ? (
                      <input
                        type="radio"
                        name="correct"
                        checked={formCorrectAnswer === opt && opt !== ''}
                        onChange={() => setFormCorrectAnswer(opt)}
                        className="w-4 h-4 text-blue-600"
                      />
                    ) : (
                      <input
                        type="checkbox"
                        checked={Array.isArray(formCorrectAnswer) && formCorrectAnswer.includes(opt) && opt !== ''}
                        onChange={(e) => {
                          const current = Array.isArray(formCorrectAnswer) ? formCorrectAnswer : [];
                          setFormCorrectAnswer(
                            e.target.checked ? [...current, opt] : current.filter(a => a !== opt)
                          );
                        }}
                        className="w-4 h-4 text-blue-600"
                      />
                    )}
                    <Input
                      placeholder={`Option ${String.fromCharCode(65 + idx)}`}
                      value={opt}
                      onChange={(e) => {
                        const newOpts = [...formOptions];
                        const oldVal = newOpts[idx];
                        newOpts[idx] = e.target.value;
                        setFormOptions(newOpts);
                        if (formType === 'single_choice' && formCorrectAnswer === oldVal) {
                          setFormCorrectAnswer(e.target.value);
                        } else if (formType === 'multiple_choice' && Array.isArray(formCorrectAnswer)) {
                          setFormCorrectAnswer(formCorrectAnswer.map(a => a === oldVal ? e.target.value : a));
                        }
                      }}
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {formType === 'single_choice' ? 'Select the correct answer' : 'Check all correct answers'}
              </p>
            </div>
          )}

          {formType === 'fill_in_blank' && (
            <Input
              label="Correct Answer"
              placeholder="Enter the correct answer"
              value={formCorrectAnswer as string}
              onChange={(e) => setFormCorrectAnswer(e.target.value)}
            />
          )}

          <Textarea
            label="Explanation (optional)"
            placeholder="Explain why this is the correct answer..."
            value={formExplanation}
            onChange={(e) => setFormExplanation(e.target.value)}
            rows={2}
          />

          <div className="flex gap-3 pt-4">
            <Button variant="outline" className="flex-1" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={handleSave}
              disabled={!formCourseId || !formQuestionText || !formCorrectAnswer}
            >
              {editingQuestion ? 'Update' : 'Create'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
