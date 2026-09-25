'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, Button, Select, Textarea, Badge, QuestionContent } from '@/components/ui';
import { chunkContent } from '@/lib/utils';
import { coursesForProgram } from '@/lib/programs';
import type { Course, Topic, Program } from '@/types';
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
  Puzzle,
  History,
  Clock,
  Layers,
  OctagonPause,
  RotateCcw,
  AlertTriangle,
} from 'lucide-react';

interface GeneratedQuestion {
  question_text: string;
  question_type: 'single_choice' | 'multiple_choice' | 'fill_in_blank';
  options: string[] | null;
  correct_answer: string | string[];
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
  is_scenario?: boolean;
  selected?: boolean;
  // Topic this question's batch was actually detected to be about — set
  // per-batch by the server, not reused from one global guess. Only
  // meaningful when no topic was manually selected (see handleSaveSelected).
  batchTopic?: string | null;
}

const LEVELS = [100, 200, 300, 400] as const;

// A merged, whole-course upload (hundreds of pages) is split into batches
// this large instead of being sent as one request — keeps each batch's
// GPT-4o call well within a normal response time, and sequential (never
// parallel) requests are what actually keeps this off any per-minute AI
// usage/rate limit, not the size of any single call.
const BATCH_TARGET_CHARS = 45000;
// A deliberate pause between batches on top of the per-call retry/backoff
// already in withOpenAIRetry — extra headroom against bursting a
// requests-per-minute limit across many sequential batches.
const BATCH_DELAY_MS = 1200;

type BatchStatus = 'pending' | 'running' | 'done' | 'error';

interface GenerationHistoryRow {
  id: string;
  created_at: string;
  total_tokens: number;
  metadata: {
    courseId?: string;
    topicName?: string | null;
    questionCount?: number;
    batch?: { index: number; total: number };
  } | null;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export default function AdminGeneratePage() {
  const [allCourses, setAllCourses] = useState<Course[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [selectedProgram, setSelectedProgram] = useState('');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const [saveCount, setSaveCount] = useState(0);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Batched generation — a large upload is split into sequential chunks
  // (see chunkContent) so the whole document gets covered instead of a
  // single lossy 3-slice sample. chunksRef/batchStatusesRef are the source
  // of truth read/mutated inside the run loop; batchStatuses state mirrors
  // them for rendering.
  const chunksRef = useRef<string[]>([]);
  const batchStatusesRef = useRef<BatchStatus[]>([]);
  const batchErrorsRef = useRef<Record<number, string>>({});
  const cancelBatchRef = useRef(false);
  const [batchStatuses, setBatchStatuses] = useState<BatchStatus[]>([]);

  const [selectedLevel, setSelectedLevel] = useState('');
  const [selectedSemester, setSelectedSemester] = useState('');
  const [selectedCourse, setSelectedCourse] = useState('');
  const [selectedTopic, setSelectedTopic] = useState('');
  const [slideContent, setSlideContent] = useState('');
  const [generatedQuestions, setGeneratedQuestions] = useState<GeneratedQuestion[]>([]);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // File upload state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState('');
  const [pdfTopic, setPdfTopic] = useState('');

  // Generation history — recent AI question-generation runs
  const [history, setHistory] = useState<GenerationHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  // Unscoped course-code lookup for history rows — allCourses is
  // program-scoped for the dropdown, but a past run may have used a
  // course from a different program than the one currently selected.
  const [courseCodeById, setCourseCodeById] = useState<Record<string, string>>({});

  const loadHistory = () => {
    setHistoryLoading(true);
    const supabase = createClient();
    supabase
      .from('ai_usage_log')
      .select('id, created_at, total_tokens, metadata')
      .eq('feature', 'generate_questions')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }: { data: GenerationHistoryRow[] | null }) => {
        setHistory(data ?? []);
        setHistoryLoading(false);
      });
  };

  // Load programs once, auto-selecting the first
  useEffect(() => {
    const supabase = createClient();
    supabase.from('programs').select('*').order('name').then(({ data }: { data: Program[] | null }) => {
      setPrograms(data ?? []);
      if (data && data.length > 0) setSelectedProgram(data[0].id);
    });
    supabase.from('courses').select('id, course_code').then(({ data }: { data: { id: string; course_code: string }[] | null }) => {
      setCourseCodeById(Object.fromEntries((data ?? []).map(c => [c.id, c.course_code])));
    });
    loadHistory();
  }, []);

  // Courses are program-scoped — a course only shows up here once an
  // admin has explicitly assigned it to the selected program, same rule
  // Courses/Analytics/Pricing already enforce.
  useEffect(() => {
    if (!selectedProgram) return;
    const supabase = createClient();
    coursesForProgram(supabase, selectedProgram).order('level').then(({ data }: { data: Course[] | null }) => {
      setAllCourses(data ?? []);
      setSelectedCourse('');
      setGeneratedQuestions([]);
      setBatchStatuses([]);
      chunksRef.current = [];
      batchStatusesRef.current = [];
      batchErrorsRef.current = {};
    });
  }, [selectedProgram]);

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
    if (file.size > 500 * 1024 * 1024) {
      setError('File is too large (max 500 MB).');
      setPdfFile(null);
      return;
    }

    const name = file.name.toLowerCase();
    const isOldPpt = file.type === 'application/vnd.ms-powerpoint' || (name.endsWith('.ppt') && !name.endsWith('.pptx'));
    const isOldDoc = file.type === 'application/msword' || (name.endsWith('.doc') && !name.endsWith('.docx'));
    if (isOldPpt) { setError('Old .ppt format isn’t supported — open it in PowerPoint and use Save As → .pptx, then upload that instead. Slides that are mostly images convert fine and will still be read correctly.'); setPdfFile(null); return; }
    if (isOldDoc) { setError('Old .doc format not supported. Save as .docx in Word and try again.'); setPdfFile(null); return; }

    setIsParsing(true);
    setParseProgress('');
    setError('');

    try {
      // All text extraction is done client-side — no file upload to server, no size limit
      const { extractFileText } = await import('@/lib/extractPdfText');
      const { text, pageCount } = await extractFileText(file, (page, total) => {
        setParseProgress(`Extracting page ${page} of ${total}…`);
      });

      const isPptx = file.type.includes('presentationml') || name.endsWith('.pptx');
      const isDocx = file.type.includes('wordprocessingml') || name.endsWith('.docx');
      const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf');

      // A page/slide whose content was flattened into a picture (an exported
      // image, or a scanned page) has essentially no extractable text — not
      // because extraction failed, but because there's genuinely none there.
      // A whole-file average catches that even when a handful of characters
      // (a repeated footer, a slide number) technically make text non-empty.
      const avgCharsPerUnit = pageCount > 0 ? text.length / pageCount : text.length;
      const looksImageOnly = avgCharsPerUnit < 80;

      let finalText = text;

      if (looksImageOnly && (isPptx || isDocx || isPdf)) {
        setParseProgress('Slides look like images — reading them with AI vision…');
        const { extractPptxImages, extractDocxImages, extractPdfPageImages, visionOcrImages } =
          await import('@/lib/extractPdfText');

        const images = isPptx ? await extractPptxImages(file)
          : isDocx ? await extractDocxImages(file)
          : await extractPdfPageImages(file, (page, total) => {
              setParseProgress(`Rendering page ${page} of ${total}…`);
            });

        if (images.length === 0) {
          if (!text.trim()) throw new Error('Could not extract text and found no embedded images to read visually either.');
        } else {
          const visionText = await visionOcrImages(images, (done, total) => {
            setParseProgress(`Reading slide images with AI vision (${done}/${total})…`);
          });
          if (!visionText.trim() && !text.trim()) {
            throw new Error('AI vision could not read any content from these slide images.');
          }
          finalText = text.trim() ? `${text}\n\n${visionText}` : visionText;
        }
      }

      if (!finalText.trim()) throw new Error('Could not extract text. If this is a scanned PDF, it must be text-based.');

      // Send the (possibly vision-recovered) text to the server for topic detection
      setParseProgress('Detecting topic…');
      const res = await fetch('/api/parse-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: finalText, pageCount }),
      });
      const data = await res.json() as { text?: string; detectedTopic?: string; error?: string };
      if (!res.ok) throw new Error(data.error || 'Topic detection failed');
      setSlideContent(data.text || finalText);
      setPdfTopic(data.detectedTopic || '');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to parse file');
      setPdfFile(null);
    } finally {
      setIsParsing(false);
      setParseProgress('');
    }
  };

  const clearPdf = () => {
    setPdfFile(null);
    setPdfTopic('');
    setSlideContent('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Runs (or re-runs) a set of batch indices sequentially against
  // chunksRef.current — shared by the initial full run and by "Retry
  // failed batches" so a partial failure doesn't force redoing the whole
  // document. Never runs batches in parallel: one request in flight at a
  // time, with a pause between, is what actually avoids bursting a
  // per-minute AI usage/rate limit — the per-call retry in
  // withOpenAIRetry only covers a single request's own transient errors.
  const runBatchIndices = async (indices: number[]) => {
    cancelBatchRef.current = false;
    setIsGenerating(true);
    setError('');

    for (const i of indices) {
      if (cancelBatchRef.current) break;

      batchStatusesRef.current[i] = 'running';
      setBatchStatuses([...batchStatusesRef.current]);

      try {
        const response = await fetch('/api/generate-questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slideContent: chunksRef.current[i] || null,
            courseId: selectedCourse,
            topicId: selectedTopic || null,
            // Deliberately NOT falling back to the single whole-document
            // pdfTopic guess here — each batch detects its own topic from
            // its own content server-side (data.detectedTopic below) when
            // no topic was manually chosen, so a multi-topic document
            // batched into several requests doesn't get every batch's
            // questions forced under one topic.
            topicName: selectedTopicObj?.topic_name || null,
            batchIndex: i,
            batchTotal: chunksRef.current.length,
          }),
        });

        const data = await response.json() as { questions: GeneratedQuestion[]; detectedTopic?: string | null; error?: string };
        if (!response.ok) throw new Error(data.error || 'Failed to generate questions');

        const batchTopic = selectedTopicObj?.topic_name || data.detectedTopic || pdfTopic || null;
        const newQuestions = data.questions.map(q => ({ ...q, selected: true, batchTopic }));
        setGeneratedQuestions(prev => [...prev, ...newQuestions]);
        batchStatusesRef.current[i] = 'done';
        delete batchErrorsRef.current[i];
      } catch (err) {
        batchStatusesRef.current[i] = 'error';
        batchErrorsRef.current[i] = err instanceof Error ? err.message : 'Failed to generate questions';
      }
      setBatchStatuses([...batchStatusesRef.current]);

      const isLastInRun = i === indices[indices.length - 1];
      if (!isLastInRun && !cancelBatchRef.current) await sleep(BATCH_DELAY_MS);
    }

    setIsGenerating(false);
    loadHistory();

    const total = batchStatusesRef.current.length;
    if (total > 1) {
      const doneCount = batchStatusesRef.current.filter(s => s === 'done').length;
      const errorCount = batchStatusesRef.current.filter(s => s === 'error').length;
      if (cancelBatchRef.current && errorCount === 0 && doneCount < total) {
        setSuccessMessage(`Stopped after ${doneCount} of ${total} batches — resume anytime by generating again, or review what's been produced so far below.`);
      } else if (errorCount === 0) {
        setSuccessMessage(`Generated questions from all ${total} batches (~50 pages each) — review and save below.`);
      } else {
        const sampleReason = Object.values(batchErrorsRef.current)[0];
        setError(`${errorCount} of ${total} batches failed${sampleReason ? ` (${sampleReason})` : ''} — the rest succeeded and are ready to review below. Retry the failed ones with the button above the questions.`);
      }
    }
  };

  const handleGenerate = async () => {
    if (!canGenerate) {
      setError('Please select a course and either upload a PDF/PPTX, paste slide content, or choose a topic');
      return;
    }

    setError('');
    setSuccessMessage('');
    setGeneratedQuestions([]);

    const content = slideContent.trim();
    const chunks = content ? chunkContent(content, BATCH_TARGET_CHARS) : [''];
    chunksRef.current = chunks;
    batchStatusesRef.current = chunks.map(() => 'pending');
    batchErrorsRef.current = {};
    setBatchStatuses([...batchStatusesRef.current]);

    await runBatchIndices(chunks.map((_, i) => i));
  };

  const handleRetryFailedBatches = () => {
    const failed = batchStatusesRef.current
      .map((s, i) => (s === 'error' ? i : -1))
      .filter(i => i !== -1);
    if (failed.length > 0) runBatchIndices(failed);
  };

  const handleStopBatches = () => {
    cancelBatchRef.current = true;
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
      // Resolve topics: when an admin manually picked one, every question
      // uses it (unchanged). Otherwise each question carries its own
      // batch-detected topic (see runBatchIndices) — a merged, multi-topic
      // document batched into several requests can produce several
      // distinct topics here instead of one global guess forced onto
      // everything. find-or-create is called once per distinct name
      // (case-insensitive match in /api/topics/ensure keeps re-runs from
      // creating near-duplicate topics).
      const topicIdCache = new Map<string, string>();
      let topicsCreated = 0;
      const distinctTopicNames = new Set<string>();

      const resolveTopicId = async (name: string): Promise<string | null> => {
        const trimmed = name.trim();
        if (!trimmed) return null;
        const cached = topicIdCache.get(trimmed.toLowerCase());
        if (cached) return cached;

        const topicRes = await fetch('/api/topics/ensure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courseId: selectedCourse, topicName: trimmed }),
        });
        if (!topicRes.ok) return null;
        const topicData = await topicRes.json();
        topicIdCache.set(trimmed.toLowerCase(), topicData.topicId);
        if (topicData.created) topicsCreated += 1;
        distinctTopicNames.add(trimmed);
        return topicData.topicId;
      };

      const fixedTopicId = selectedTopic || null;

      const questionsToInsert = [];
      for (const q of selectedQuestions) {
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

        const topicId = fixedTopicId ?? (q.batchTopic ? await resolveTopicId(q.batchTopic) : null);

        questionsToInsert.push({
          course_id: selectedCourse,
          topic_id: topicId,
          question_type: q.question_type,
          question_text: q.question_text,
          options,
          correct_answers,
          explanation: q.explanation,
          difficulty: q.difficulty,
          // Not live to students until reviewed on the Question Bank
          // page — nothing checked this before, so every AI-generated
          // question shipped straight to students with no human look.
          is_approved: false,
          is_scenario: !!q.is_scenario,
        });
      }

      const response = await fetch('/api/save-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: questionsToInsert, courseId: selectedCourse }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to save questions');

      const topicNote = fixedTopicId
        ? ''
        : distinctTopicNames.size === 0
          ? ''
          : distinctTopicNames.size === 1
            ? ` Saved under topic "${[...distinctTopicNames][0]}".`
            : ` Grouped into ${distinctTopicNames.size} topics (${topicsCreated} new).`;
      setSuccessMessage(`Saved ${result.saved} questions — pending review before they go live to students.${topicNote}`);
      setSaveProgress(100);
      setGeneratedQuestions([]);
      setSlideContent('');
      clearPdf();
      chunksRef.current = [];
      batchStatusesRef.current = [];
      batchErrorsRef.current = {};
      setBatchStatuses([]);

      // Refresh topics list so the newly created topic appears in the dropdown
      const supabase = createClient();
      supabase
        .from('topics')
        .select('*')
        .eq('course_id', selectedCourse)
        .order('order_index')
        .then(({ data }: { data: Topic[] | null }) => {
          const unique = (data || []).filter((t: Topic, i: number, arr: Topic[]) =>
            arr.findIndex((x: Topic) => x.topic_name === t.topic_name) === i
          );
          setTopics(unique);
        });
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
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">AI Question Generator</h1>
        <p className="text-gray-600 dark:text-gray-400">Generate exam questions from PDF or PPTX slides, or by topic</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Section */}
        <Card>
          <div className="px-6 py-4 border-b border-gray-100 dark:border-white/10">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2 dark:text-gray-100">
              <FileText className="w-5 h-5" />
              Generation Settings
            </h2>
          </div>
          <CardContent className="space-y-4">
            {/* Program selector — hidden while only one program exists */}
            {programs.length > 1 && (
              <Select
                label="Program"
                value={selectedProgram}
                onChange={e => setSelectedProgram(e.target.value)}
              >
                {programs.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            )}

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
              onChange={(e) => { setSelectedCourse(e.target.value); setGeneratedQuestions([]); setBatchStatuses([]); chunksRef.current = []; batchStatusesRef.current = []; batchErrorsRef.current = {}; }}
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
                  <div className="mt-2 flex items-center gap-2 p-2.5 bg-purple-50 dark:bg-purple-500/10 border border-purple-100 dark:border-purple-500/20 rounded-lg">
                    <BookOpen className="w-4 h-4 text-purple-600 dark:text-purple-400 flex-shrink-0" />
                    <p className="text-xs text-purple-700 dark:text-purple-400">
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
                <p className="text-sm font-medium text-gray-700 mb-2 dark:text-gray-300">Upload Slide (PDF, PPTX, DOCX)</p>

                {!pdfFile ? (
                  <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer bg-gray-50 hover:bg-blue-50 hover:border-blue-400 transition-colors dark:border-white/15 dark:bg-white/[0.03] dark:hover:bg-blue-500/10 dark:hover:border-blue-500/40">
                    <FileUp className="w-7 h-7 text-gray-400 mb-1 dark:text-gray-500" />
                    <span className="text-sm text-gray-500 dark:text-gray-400">Click to upload PDF, PPTX, or DOCX</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">AI will scan and extract topic &amp; content</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/pdf,.pdf,.pptx,.ppt,.docx,.doc,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
                      className="hidden"
                      onChange={handlePdfSelect}
                    />
                  </label>
                ) : (
                  <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-xl">
                    {isParsing ? (
                      <>
                        <ScanText className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-pulse flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
                            {parseProgress || 'Processing file…'}
                          </p>
                          <p className="text-xs text-blue-500 dark:text-blue-400">Extracting content and detecting topic</p>
                        </div>
                        <RefreshCw className="w-4 h-4 text-blue-500 dark:text-blue-400 animate-spin flex-shrink-0" />
                      </>
                    ) : (
                      <>
                        <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-blue-800 dark:text-blue-300 truncate">{pdfFile.name}</p>
                          {pdfTopic && (
                            <p className="text-xs text-blue-600 dark:text-blue-400">
                              Detected topic: <span className="font-semibold">{pdfTopic}</span>
                            </p>
                          )}
                        </div>
                        <button
                          onClick={clearPdf}
                          className="p-1 hover:bg-blue-200 dark:hover:bg-blue-500/20 rounded-full transition-colors flex-shrink-0"
                        >
                          <X className="w-4 h-4 text-blue-700 dark:text-blue-400" />
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
                  ? 'Slide content will appear here after scanning...'
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
              <div className="bg-blue-50 dark:bg-blue-500/10 rounded-lg p-4">
                <h4 className="font-medium text-blue-900 dark:text-blue-300 mb-2">Tips for better results:</h4>
                <ul className="text-sm text-blue-700 dark:text-blue-400 space-y-1">
                  <li>• Upload a PDF or PPTX, or paste slide text above</li>
                  <li>• Include key concepts and definitions</li>
                  <li>• More content = more questions generated</li>
                </ul>
              </div>
            )}

            {(() => {
              const preview = slideContent.trim() ? chunkContent(slideContent.trim(), BATCH_TARGET_CHARS) : [];
              const willBatch = preview.length > 1;
              // A document large enough to batch almost always spans more
              // than one topic — forcing every batch under one manually
              // picked topic anyway (see handleSaveSelected) is rarely what
              // was intended if the dropdown just happened to still hold a
              // selection from an earlier, unrelated task. Block the normal
              // one-click Generate here and make the admin explicitly choose,
              // instead of silently misfiling dozens of questions.
              const topicBatchConflict = willBatch && !!selectedTopic;

              if (topicBatchConflict) {
                return (
                  <div className="rounded-xl border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-4 space-y-3">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-amber-800 dark:text-amber-300">
                        This content is large enough to process in <strong>{preview.length} batches</strong>, but you also have <strong>&ldquo;{selectedTopicObj?.topic_name}&rdquo;</strong> selected above — every batch&rsquo;s questions will be saved under that one topic, even though a document this size usually covers more than one. If the topic selection is left over from something else, clear it so each batch gets its own correctly detected topic instead.
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => setSelectedTopic('')}
                      >
                        Clear Topic Selection
                      </Button>
                      <Button
                        onClick={handleGenerate}
                        disabled={isGenerating || isParsing}
                        className="flex-1 !bg-amber-600 hover:!bg-amber-700"
                      >
                        {isGenerating ? (
                          <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Generating…</>
                        ) : (
                          `Generate Anyway — All Under "${selectedTopicObj?.topic_name}"`
                        )}
                      </Button>
                    </div>
                  </div>
                );
              }

              return (
                <>
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
                          : pdfTopic && !selectedTopic && !willBatch
                            ? `Generate from "${pdfTopic}"`
                            : 'Generate Questions with AI'}
                      </>
                    )}
                  </Button>

                  {willBatch && (
                    <p className="flex items-center justify-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                      <Layers className="w-3.5 h-3.5 flex-shrink-0" />
                      Large document — will process in {preview.length} sequential batches (~50 pages each), each grouped under its own detected topic.
                    </p>
                  )}
                </>
              );
            })()}
          </CardContent>
        </Card>

        {/* Generated Questions Section */}
        <Card>
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between dark:border-white/10">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2 dark:text-gray-100">
              <Sparkles className="w-5 h-5" />
              Generated Questions
            </h2>
            {generatedQuestions.length > 0 && (
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {generatedQuestions.filter(q => q.selected).length} selected
                {' · '}
                {generatedQuestions.filter(q => q.is_scenario).length} scenario-based
              </span>
            )}
          </div>
          <div className="p-6">
            {batchStatuses.length > 1 && (
              <div className="mb-4 p-3 rounded-lg border border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10">
                <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-300 flex items-center gap-1.5">
                    <Layers className="w-4 h-4 flex-shrink-0" />
                    Batch {batchStatuses.filter(s => s !== 'pending').length} of {batchStatuses.length}
                  </p>
                  {isGenerating ? (
                    <button
                      onClick={handleStopBatches}
                      className="flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline"
                    >
                      <OctagonPause className="w-3.5 h-3.5" />
                      Stop after current batch
                    </button>
                  ) : batchStatuses.some(s => s === 'error') && (
                    <button
                      onClick={handleRetryFailedBatches}
                      className="flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Retry failed batches
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {batchStatuses.map((s, i) => (
                    <span
                      key={i}
                      title={s === 'error' && batchErrorsRef.current[i] ? `Batch ${i + 1}: ${batchErrorsRef.current[i]}` : `Batch ${i + 1}: ${s}`}
                      className={`w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-semibold flex-shrink-0 ${
                        s === 'done' ? 'bg-green-500 text-white'
                        : s === 'error' ? 'bg-red-500 text-white'
                        : s === 'running' ? 'bg-blue-500 text-white animate-pulse'
                        : 'bg-gray-200 dark:bg-white/10 text-gray-500 dark:text-gray-400'
                      }`}
                    >
                      {i + 1}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 p-4 rounded-lg mb-4">
                <AlertCircle className="w-5 h-5" />
                {error}
              </div>
            )}

            {successMessage && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 p-4 rounded-lg mb-4">
                <div className="flex items-start gap-2 flex-1">
                  <Check className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <span>{successMessage}</span>
                </div>
                {selectedCourse && (() => {
                  const courseObj = allCourses.find(c => c.id === selectedCourse);
                  const params = new URLSearchParams({ course: selectedCourse, pending: '1' });
                  if (courseObj) {
                    params.set('level', String(courseObj.level));
                    params.set('semester', String(courseObj.semester));
                  }
                  return (
                    <Link
                      href={`/admin/questions?${params.toString()}`}
                      className="flex-shrink-0 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg text-center transition-colors"
                    >
                      Review &amp; Approve Now →
                    </Link>
                  );
                })()}
              </div>
            )}

            {generatedQuestions.length === 0 ? (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                <Sparkles className="w-12 h-12 mx-auto mb-4 text-gray-300 dark:text-white/10" />
                <p>Generated questions will appear here</p>
              </div>
            ) : (
              <div className="space-y-4 max-h-[600px] overflow-y-auto">
                {generatedQuestions.map((question, idx) => (
                  <div
                    key={idx}
                    className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                      question.selected
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
                        : 'border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.04] hover:border-gray-300 dark:hover:border-white/20'
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
                          {question.is_scenario && (
                            <Badge variant="info" size="sm" className="!bg-purple-100 dark:!bg-purple-500/15 !text-purple-700 dark:!text-purple-400">
                              <Puzzle className="w-3 h-3 mr-1" />
                              Scenario
                            </Badge>
                          )}
                          {!selectedTopic && question.batchTopic && (
                            <Badge variant="default" size="sm" className="!bg-blue-50 dark:!bg-blue-500/10 !text-blue-700 dark:!text-blue-400">
                              <BookOpen className="w-3 h-3 mr-1" />
                              {question.batchTopic}
                            </Badge>
                          )}
                        </div>
                        <div className="mb-2">
                          <QuestionContent text={question.question_text} textClassName="font-medium text-gray-900 dark:text-gray-100" />
                        </div>
                        {question.options && (
                          <div className="space-y-1 mb-2">
                            {question.options.map((opt, i) => (
                              <div
                                key={i}
                                className={`text-sm px-2 py-1 rounded ${
                                  (Array.isArray(question.correct_answer)
                                    ? question.correct_answer.includes(opt)
                                    : question.correct_answer === opt)
                                    ? 'bg-green-100 dark:bg-green-500/15 text-green-800 dark:text-green-400'
                                    : 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-400'
                                }`}
                              >
                                {String.fromCharCode(65 + i)}. {opt}
                              </div>
                            ))}
                          </div>
                        )}
                        {question.question_type === 'fill_in_blank' && (
                          <p className="text-sm text-green-600 dark:text-green-400">
                            Answer: {question.correct_answer}
                          </p>
                        )}
                        {question.explanation && (
                          <div className="text-sm text-gray-500 mt-2 dark:text-gray-400">
                            💡 <QuestionContent text={question.explanation} />
                          </div>
                        )}
                      </div>
                      <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                        question.selected
                          ? 'bg-blue-500 border-blue-500'
                          : 'border-gray-300 dark:border-white/20'
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
                  <div className="rounded-lg border border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-blue-700 dark:text-blue-400">
                        Saving {saveCount} question{saveCount !== 1 ? 's' : ''} to database...
                      </span>
                      <span className="text-sm font-semibold text-blue-700 dark:text-blue-400">
                        {Math.round(saveProgress)}%
                      </span>
                    </div>
                    <div className="w-full bg-blue-200 dark:bg-blue-500/20 rounded-full h-2 overflow-hidden">
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

      {/* Generation History */}
      <Card>
        <div className="px-6 py-4 border-b border-gray-100 dark:border-white/10">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2 dark:text-gray-100">
            <History className="w-5 h-5" />
            Generation History
          </h2>
        </div>
        <CardContent>
          {historyLoading ? (
            <div className="flex items-center justify-center py-8 text-gray-400 dark:text-gray-500">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" />
              Loading history...
            </div>
          ) : history.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8 dark:text-gray-400">No generation runs yet</p>
          ) : (
            <div className="space-y-2">
              {history.map(row => {
                const courseCode = row.metadata?.courseId ? courseCodeById[row.metadata.courseId] : undefined;
                return (
                  <div
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-2 p-3 bg-gray-50 rounded-lg text-sm dark:bg-white/[0.03]"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900 dark:text-gray-100">
                        {courseCode ?? 'Unknown course'}
                      </span>
                      {row.metadata?.topicName && (
                        <span className="text-gray-500 dark:text-gray-400">— {row.metadata.topicName}</span>
                      )}
                      <Badge variant="default" size="sm">
                        {row.metadata?.questionCount ?? '?'} questions
                      </Badge>
                      {row.metadata?.batch && (
                        <Badge variant="info" size="sm">
                          Batch {row.metadata.batch.index}/{row.metadata.batch.total}
                        </Badge>
                      )}
                      <span className="text-xs text-gray-400 dark:text-gray-500">{row.total_tokens.toLocaleString()} tokens</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                      <Clock className="w-3.5 h-3.5" />
                      {new Date(row.created_at).toLocaleString()}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
