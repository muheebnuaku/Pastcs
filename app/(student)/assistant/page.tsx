'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useSpeech } from '@/lib/hooks/useSpeech';
import { SpeechHighlight } from '@/lib/hooks/SpeechHighlight';
import { trackEvent } from '@/lib/track';
import { useAuth } from '@/components/providers';
import { TutorPricingModal } from './components/TutorPricingModal';
import { PasteTextModal } from './components/PasteTextModal';
import { coursesForProgram } from '@/lib/programs';
import { chunkContent, courseCodeSlug } from '@/lib/utils';
import { Modal } from '@/components/ui';
import Link from 'next/link';
import { renderMarkdownTables, escapeHtml } from '@/lib/markdown';
import { extractMath, restoreMath } from '@/lib/math';
import type { Course } from '@/types';
import type { TutorQuota } from '@/lib/tutorCredits';
import type { TutorAction } from '@/lib/tutorContext';
import {
  BotMessageSquare, Send, Trash2, Loader2, BookOpen, ChevronDown,
  Volume2, VolumeX, Paperclip, FileText, Play, StopCircle, PauseCircle,
  ChevronLeft, ChevronRight, X, Lock, ClipboardPaste, Library, MessageSquare,
} from 'lucide-react';

// A document longer than this is split into sequential batches (see
// runLessonPipeline) instead of one single generate-lesson call — same
// page/slide-boundary chunking the AI Question Generator uses, just
// applied to a lesson's narrative structure instead of a flat question
// list. Smaller than generate-lesson's own 250k-char safety ceiling on
// purpose: a single big call can technically see everything up to that
// ceiling, but asking it to independently enumerate "every concept" in
// one enormous excerpt is a harder, more compressible task than asking
// several smaller, fully-attended calls to each do the same for their
// own slice — batching gets more thorough coverage out of a large
// document than raising the single-call ceiling alone did.
//
// Set low on purpose: a slide deck's actual extracted text is far
// sparser than its page count suggests — a typical bullet-heavy slide
// runs only 250-400 characters once extracted, so even a substantial
// 100+ slide deck can land well under a 60k threshold and silently
// skip batching entirely (confirmed happening in practice). 25,000
// chars is roughly 60-100 typical slides, so most "big" uploads that
// actually need batching's more-thorough-per-chunk coverage get it,
// while a genuinely small single-lecture upload (a handful of slides)
// still stays on the plain single-call path untouched.
const LESSON_BATCH_TARGET_CHARS = 25000;

// ── Types ──────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface LessonSection {
  title: string;
  content: string;
}

// One lesson's progress, kept so a failed part can be retried from where
// it stopped instead of starting over. The credit is charged by the first
// delivered part, so retrying the rest is free.
interface LessonJob {
  token: string;
  chunks: string[];
  context: string;
  full: string;
  priorTitles: string[];
  // 0..chunks.length-1 = lesson parts; chunks.length = the closing
  // Practice Review + Summary call (multi-part lessons only).
  nextIndex: number;
  imageTopic: string;
  title: string;
}

interface LibraryItem {
  id: string;
  title: string;
  course_id: string | null;
  created_at: string;
}

// ── Markdown renderer ──────────────────────────────────────────────────────

function mdToHtml(source: string): string {
  // Formulas come out first (rendered by KaTeX) so the markdown steps below
  // can't mangle them, and go back in at the very end.
  const { text, rendered } = extractMath(source);
  // Code fences first (before table detection could misfire on pipe
  // characters inside an example), then tables (before the header/list/
  // paragraph steps below, which depend on the original newlines a
  // table's rows need to stay intact).
  const withCodeBlocks = escapeHtml(text).replace(/```(\w*)\n?([\s\S]*?)```/g,
    '<pre class="bg-gray-900 text-green-300 rounded-xl p-4 overflow-x-auto text-sm my-3 font-mono"><code>$2</code></pre>');

  return restoreMath(
    renderMarkdownTables(withCodeBlocks)
      .replace(/`([^`\n]+)`/g, '<code class="bg-gray-100 dark:bg-white/10 text-pink-600 dark:text-pink-400 px-1.5 py-0.5 rounded text-sm font-mono">$1</code>')
      .replace(/^## (.+)$/gm, '<h2 class="text-base font-bold text-gray-900 dark:text-gray-100 mt-4 mb-1.5">$1</h2>')
      .replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold text-gray-800 dark:text-gray-200 mt-3 mb-1">$1</h3>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong class="font-semibold text-gray-900 dark:text-gray-100">$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/\[🎬 ([^\]]+)\]\((https:\/\/www\.youtube\.com\/results[^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 mt-1 px-3 py-1.5 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 rounded-lg text-sm font-medium hover:bg-red-100 dark:hover:bg-red-500/15 transition-colors no-underline">▶ $1</a>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline decoration-blue-300 dark:decoration-blue-500/40 font-medium break-words">$1</a>')
      .replace(/^---$/gm, '<hr class="my-4 border-gray-200 dark:border-white/10" />')
      .replace(/^[*-] (.+)$/gm, '<li class="flex gap-2"><span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0"></span><span>$1</span></li>')
      .replace(/^(\d+)\. (.+)$/gm, '<li class="flex gap-2"><span class="font-semibold text-blue-600 flex-shrink-0">$1.</span><span>$2</span></li>')
      .replace(/(<li[\s\S]*?<\/li>\n?)+/g, '<ul class="space-y-1.5 my-2">$&</ul>')
      .replace(/\n{2,}/g, '</p><p class="mb-2 leading-relaxed">')
      .replace(/\n/g, '<br />'),
    rendered
  );
}

function MessageContent({ content }: { content: string }) {
  return (
    <div
      className="prose-sm text-sm leading-relaxed text-gray-800 break-words [&_p]:mb-2 [&_p]:leading-relaxed [&_ul]:my-2 dark:text-gray-200"
      dangerouslySetInnerHTML={{ __html: '<p class="mb-2 leading-relaxed">' + mdToHtml(content) + '</p>' }}
    />
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  "Explain this topic like I'm a beginner",
  'Give me a practical example',
  'What are common exam questions on this?',
  'How does this compare to similar concepts?',
  'Summarise the key points',
];

// Fixed sections get a specific icon; every concept section in between
// (one per topic in the document, so the name is different every time)
// falls back to a consistent "idea" icon.
const SECTION_ICONS: Record<string, string> = {
  'introduction': '📚',
  'practice review': '🎯',
  'summary': '📝',
};

function sectionIcon(title: string) {
  return SECTION_ICONS[title.toLowerCase()] ?? '💡';
}

function splitParas(content: string): string[] {
  return content.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 5);
}

interface PracticeQA { question: string; answer: string }

// Parses the "**Q1.** ... / *Answer:* ..." pairs the lesson prompt asks
// for, so the UI can hide each answer behind a tap instead of printing
// it right under the question — an answer key isn't a practice test.
function parsePracticeQA(content: string): PracticeQA[] {
  const pairs: PracticeQA[] = [];
  const re = /\*\*Q\d+\.?\*\*\s*([\s\S]*?)\n\*Answer:?\*\s*([\s\S]*?)(?=\n\*\*Q\d+\.?\*\*|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const question = match[1].trim();
    const answer = match[2].trim();
    if (question && answer) pairs.push({ question, answer });
  }
  return pairs;
}

function PracticeReviewPanel({ content, practiseHref, practiseLabel }: { content: string; practiseHref?: string; practiseLabel?: string }) {
  const pairs = parsePracticeQA(content);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<Record<number, 'got' | 'missed'>>({});

  useEffect(() => { setRevealed(new Set()); setResults({}); }, [content]);

  if (pairs.length === 0) {
    // The model didn't follow the Q/A format — fall back to raw rendering
    // rather than showing nothing.
    return <div className="text-[15px] text-gray-800 leading-7 break-words dark:text-gray-200" dangerouslySetInnerHTML={{ __html: mdToHtml(content) }} />;
  }

  const marked = Object.keys(results).length;
  const got = Object.values(results).filter(r => r === 'got').length;
  const missed = pairs.map((_, i) => i).filter(i => results[i] === 'missed');
  const done = marked === pairs.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-blue-50 px-3 py-2.5 dark:bg-blue-500/10">
        <p className="text-xs sm:text-sm text-blue-800 dark:text-blue-300">
          Answer in your head, reveal it, then mark yourself honestly.
        </p>
        <span className="text-sm font-bold text-blue-700 tabular-nums flex-shrink-0 dark:text-blue-300">{got}/{marked || 0}</span>
      </div>

      {pairs.map((pair, i) => {
        const isRevealed = revealed.has(i);
        const result = results[i];
        return (
          <div key={i} className={`rounded-xl border p-3 sm:p-4 ${
            result === 'got' ? 'border-green-200 dark:border-green-500/30'
              : result === 'missed' ? 'border-red-200 dark:border-red-500/30'
              : 'border-gray-200 dark:border-white/10'
          }`}>
            <p className="text-sm font-semibold text-gray-900 mb-2.5 break-words dark:text-gray-100">
              <span className="text-blue-600 dark:text-blue-400">Q{i + 1}.</span>{' '}
              <span dangerouslySetInnerHTML={{ __html: mdToHtml(pair.question) }} />
            </p>
            {!isRevealed ? (
              <button
                onClick={() => setRevealed(prev => new Set([...prev, i]))}
                className="w-full sm:w-auto text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-100 dark:hover:bg-blue-500/15 px-4 py-2 rounded-lg transition-colors"
              >
                Show answer
              </button>
            ) : (
              <>
                <div className="text-sm text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 break-words"
                  dangerouslySetInnerHTML={{ __html: mdToHtml(pair.answer) }} />
                {result ? (
                  <p className={`mt-2 text-xs font-semibold ${result === 'got' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {result === 'got' ? '✓ You got this one' : '✗ Worth another look'}
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 mt-2.5">
                    <button
                      onClick={() => setResults(prev => ({ ...prev, [i]: 'missed' }))}
                      className="text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 py-2 rounded-lg transition-colors dark:text-red-300 dark:bg-red-500/10 dark:hover:bg-red-500/15"
                    >
                      ✗ I missed it
                    </button>
                    <button
                      onClick={() => setResults(prev => ({ ...prev, [i]: 'got' }))}
                      className="text-sm font-medium text-green-700 bg-green-50 hover:bg-green-100 py-2 rounded-lg transition-colors dark:text-green-300 dark:bg-green-500/10 dark:hover:bg-green-500/15"
                    >
                      ✓ I got it
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}

      {done && (
        <div className="rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white p-4">
          <p className="text-lg font-bold">You got {got} of {pairs.length}</p>
          <p className="text-sm text-blue-100 mt-0.5">
            {missed.length === 0
              ? 'Excellent — you know this lesson. Lock it in with real exam questions.'
              : `Re-read the parts behind question${missed.length === 1 ? '' : 's'} ${missed.map(i => i + 1).join(', ')}, then try real exam questions.`}
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            {practiseHref && (
              <Link href={practiseHref} className="text-sm font-semibold bg-white text-blue-700 px-3 py-2 rounded-lg hover:bg-blue-50">
                Practise {practiseLabel ?? 'this course'} questions →
              </Link>
            )}
            <button
              onClick={() => { setRevealed(new Set()); setResults({}); }}
              className="text-sm font-semibold bg-white/15 hover:bg-white/25 px-3 py-2 rounded-lg"
            >
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function parseSections(markdown: string): LessonSection[] {
  const sections: LessonSection[] = [];
  let currentTitle = '';
  let currentLines: string[] = [];

  for (const line of markdown.split('\n')) {
    if (line.startsWith('## ')) {
      if (currentTitle) sections.push({ title: currentTitle, content: currentLines.join('\n').trim() });
      currentTitle = line.replace(/^## /, '').trim();
      currentLines = [];
    } else if (currentTitle) {
      currentLines.push(line);
    }
  }
  if (currentTitle) sections.push({ title: currentTitle, content: currentLines.join('\n').trim() });
  return sections;
}

// Reads a fetch Response's body stream to completion, calling onChunk
// with the growing text after every chunk (for live-typing UI) and
// resolving with the final full text. Shared by every generate-lesson
// call in runLessonPipeline — single-shot, and each batch of a
// multi-part lesson.
async function streamToText(body: ReadableStream<Uint8Array>, onChunk: (partial: string) => void): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    full += decoder.decode(value, { stream: true });
    onChunk(full);
  }
  return full;
}

// Pulls out "## Title" headers from a lesson markdown fragment — used to
// tell each later batch in a multi-part lesson what's already been
// covered, so it doesn't repeat a concept from an earlier part.
function extractSectionTitles(markdown: string): string[] {
  return [...markdown.matchAll(/^## (.+)$/gm)].map(m => m[1].trim());
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function AssistantPage() {
  const { user } = useAuth();

  // Chat state
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState('');
  const [topic, setTopic] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [showCourseMenu, setShowCourseMenu] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);

  // Document lesson state
  const [docStage, setDocStage] = useState<'idle' | 'uploading' | 'generating' | 'ready'>('idle');
  const [docProgress, setDocProgress] = useState('');
  const [docError, setDocError] = useState('');
  const [lessonFileName, setLessonFileName] = useState('');
  const [lessonText, setLessonText] = useState('');
  const [lessonSections, setLessonSections] = useState<LessonSection[]>([]);
  const [teaching, setTeaching] = useState(false);
  const [teachIdx, setTeachIdx] = useState(0);
  const [teachParas, setTeachParas] = useState<string[]>([]);
  const [teachParaIdx, setTeachParaIdx] = useState(0);
  const [paraReady, setParaReady] = useState(false);
  // True once teaching has started at least once for the current lesson —
  // drives the "Teach Me" vs "Resume" label. Stays true across a jump to a
  // different sub-heading (jumpToSection stops the audio but this is a
  // separate flag), so clicking play again after jumping resumes teaching
  // at the newly selected section instead of restarting from the top.
  const [hasStartedTeaching, setHasStartedTeaching] = useState(false);
  const [keywordImages, setKeywordImages] = useState<Record<string, { url: string; caption: string; pageUrl: string }>>({});
  // Phones show the lesson OR the chat (switch at the top); desktop shows both.
  const [view, setView] = useState<'lesson' | 'chat'>('chat');
  const [libraryAvailable, setLibraryAvailable] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);

  // Lesson balance — computed and enforced server-side (/api/tutor/quota)
  const [quota, setQuota] = useState<TutorQuota | null>(null);
  const [showTutorPricing, setShowTutorPricing] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [currentImage, setCurrentImage] = useState<{ url: string; caption: string; keyword: string } | null>(null);
  const [fetchingImages, setFetchingImages] = useState(false);

  const uploadChecked = quota !== null;
  const uploadRemaining = quota?.remaining ?? 0;
  const limitReached = !!quota && quota.remaining <= 0;

  const { speak, stop, pause, resume, primeSpeech, isSpeaking, isPaused, position, speakingText, isSupported: voiceSupported } = useSpeech();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lessonAbortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const teachingRef = useRef(false);
  const lessonSectionsRef = useRef<LessonSection[]>([]);

  useEffect(() => {
    const supabase = createClient();
    // Only the student's current level and semester: the courses they're
    // actually taking, not every course in the programme.
    let query = user?.program_id
      ? coursesForProgram(supabase, user.program_id).order('course_code')
      : supabase.from('courses').select('*').order('course_code');
    if (user?.selected_level) query = query.eq('level', user.selected_level);
    if (user?.selected_semester) query = query.eq('semester', user.selected_semester);
    query.then(({ data }: { data: Course[] | null }) => { if (data) setCourses(data); });
  }, [user?.program_id, user?.selected_level, user?.selected_semester]);

  // Remember which course the student was studying, per user.
  const courseKey = user?.id ? `pastcs_tutor_course_${user.id}` : null;
  useEffect(() => {
    if (!courseKey) return;
    // A link from elsewhere (e.g. a results page's "Continue in AI Tutor")
    // can pick the course and pre-type a question.
    const params = new URLSearchParams(window.location.search);
    const linkedCourse = params.get('course');
    const linkedQuestion = params.get('q');
    let saved: string | null = null;
    try { saved = localStorage.getItem(courseKey); } catch { /* storage unavailable */ }
    const course = linkedCourse || saved;
    if (course) setSelectedCourse(course);
    if (linkedQuestion) {
      setInput(linkedQuestion.slice(0, 4000));
      inputRef.current?.focus();
    }
    if (linkedCourse || linkedQuestion) window.history.replaceState(null, '', window.location.pathname);
  }, [courseKey]);
  useEffect(() => {
    if (!courseKey) return;
    try {
      if (selectedCourse) localStorage.setItem(courseKey, selectedCourse);
      else localStorage.removeItem(courseKey);
    } catch { /* storage unavailable */ }
  }, [courseKey, selectedCourse]);

  // One conversation per course (course_id null = general questions), so
  // switching course doesn't mix topics together. Loads the NEWEST 50 —
  // the old query took the oldest 50, so once a student passed 50
  // messages, everything new vanished on reload.
  useEffect(() => {
    if (!user?.id) return;
    abortRef.current?.abort();
    // Only the chat's own reading — a lesson being read keeps going.
    if (!teachingRef.current) stop();
    setIsStreaming(false);
    setMessages([]);
    let cancelled = false;
    const supabase = createClient();
    let query = supabase.from('chat_messages').select('role, content').eq('user_id', user.id);
    query = selectedCourse ? query.eq('course_id', selectedCourse) : query.is('course_id', null);
    query
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }: { data: Message[] | null }) => {
        if (!cancelled && data) setMessages([...data].reverse());
      })
      .catch(() => {}); // chat_messages not migrated on this environment yet
    return () => { cancelled = true; };
  }, [user?.id, selectedCourse, stop]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Keep sections ref in sync so teaching callbacks don't go stale
  useEffect(() => { lessonSectionsRef.current = lessonSections; }, [lessonSections]);

  const loadQuota = useCallback(async () => {
    try {
      const res = await fetch('/api/tutor/quota');
      if (res.ok) setQuota(await res.json() as TutorQuota);
    } catch { /* keep the last known balance */ }
  }, []);
  useEffect(() => { loadQuota(); }, [loadQuota]);

  // ── Lesson persistence ─────────────────────────────────────────────────────
  // A finished lesson survives a refresh until the student closes it or
  // starts a new one — otherwise a reload threw away a lesson that took
  // minutes and an upload credit to produce. Per-user key so a shared
  // device never shows one student another's lesson.
  const lessonStorageKey = user?.id ? `pastcs_lesson_${user.id}` : null;
  const restoredLessonRef = useRef(false);

  const clearStoredLesson = useCallback(() => {
    if (!lessonStorageKey) return;
    try { localStorage.removeItem(lessonStorageKey); } catch { /* storage unavailable */ }
  }, [lessonStorageKey]);

  useEffect(() => {
    if (!lessonStorageKey || restoredLessonRef.current) return;
    restoredLessonRef.current = true;
    try {
      const raw = localStorage.getItem(lessonStorageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        fileName?: string;
        text?: string;
        sections?: LessonSection[];
        images?: Record<string, { url: string; caption: string; pageUrl: string }>;
        teachIdx?: number;
      };
      if (!Array.isArray(saved.sections) || saved.sections.length === 0) return;
      setLessonFileName(saved.fileName ?? 'Lesson');
      setLessonText(saved.text ?? '');
      setLessonSections(saved.sections);
      setKeywordImages(saved.images ?? {});
      setTeachIdx(Math.min(Math.max(0, saved.teachIdx ?? 0), saved.sections.length - 1));
      setDocStage('ready');
      setView('lesson');
    } catch { /* corrupt or unavailable storage — start fresh */ }
  }, [lessonStorageKey]);

  useEffect(() => {
    if (!lessonStorageKey || docStage !== 'ready' || lessonSections.length === 0) return;
    try {
      localStorage.setItem(lessonStorageKey, JSON.stringify({
        fileName: lessonFileName,
        text: lessonText,
        sections: lessonSections,
        images: keywordImages,
        teachIdx,
      }));
    } catch { /* quota exceeded or storage unavailable */ }
  }, [lessonStorageKey, docStage, lessonFileName, lessonText, lessonSections, keywordImages, teachIdx]);

  // A lesson still being written can't survive a reload (the stream dies
  // with the page), so warn before leaving mid-generation.
  useEffect(() => {
    if (docStage !== 'uploading' && docStage !== 'generating') return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [docStage]);

  // Show a keyword's picture when the voice reaches it. Subscribes to the
  // speech position directly, so word-by-word progress never re-renders
  // this (large) page — only an actual new picture does.
  useEffect(() => {
    if (!isSpeaking || !speakingText || Object.keys(keywordImages).length === 0) return;
    const lower = speakingText.toLowerCase();
    // Longest first so multi-word keywords match before single-word prefixes
    const keywords = Object.keys(keywordImages)
      .sort((a, b) => b.length - a.length)
      .map(kw => [kw, kw.toLowerCase()] as const);
    let lastWordStart = -1;
    return position.subscribe(() => {
      let start = position.get();
      // The position may be estimated mid-word — match from the word's start.
      while (start > 0 && /\S/.test(lower[start - 1])) start--;
      if (start === lastWordStart) return;
      lastWordStart = start;
      for (const [kw, kwLower] of keywords) {
        if (lower.startsWith(kwLower, start)) {
          const after = lower[start + kwLower.length];
          if (!after || /\W/.test(after)) {
            setCurrentImage(prev => (prev?.keyword === kw ? prev : { ...keywordImages[kw], keyword: kw }));
            return;
          }
        }
      }
    });
  }, [isSpeaking, speakingText, keywordImages, position]);

  // Clear image when speech stops
  useEffect(() => {
    if (!isSpeaking) setCurrentImage(null);
  }, [isSpeaking]);

  // Advance to next paragraph / section when one finishes
  useEffect(() => {
    if (!paraReady || !teaching) return;
    setParaReady(false);
    const nextPara = teachParaIdx + 1;
    if (nextPara < teachParas.length) {
      setTeachParaIdx(nextPara);
      speak(teachParas[nextPara], () => setParaReady(true));
    } else {
      const nextSec = teachIdx + 1;
      const sections = lessonSectionsRef.current;
      if (nextSec >= sections.length) {
        teachingRef.current = false;
        setTeaching(false);
      } else {
        setTeachIdx(nextSec);
        const paras = splitParas(sections[nextSec].content);
        setTeachParas(paras);
        setTeachParaIdx(0);
        if (paras.length > 0) speak(paras[0], () => setParaReady(true));
        else setParaReady(true); // skip empty section
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paraReady]);

  const selectedCourseObj = courses.find(c => c.id === selectedCourse);

  const getContext = () => {
    const parts: string[] = [];
    if (selectedCourseObj) parts.push(`${selectedCourseObj.course_code} — ${selectedCourseObj.course_name} (Level ${selectedCourseObj.level})`);
    if (topic.trim()) parts.push(`Topic: ${topic.trim()}`);
    return parts.join(', ');
  };

  // ── Teaching ──────────────────────────────────────────────────────────────

  // Starts (or resumes) reading at whatever section teachIdx currently
  // points to — NOT always section 0. teachIdx is updated by
  // jumpToSection whenever the student clicks a different sub-heading,
  // so pressing play again after a jump correctly picks up in the new
  // section's context instead of restarting the whole lesson from the
  // Introduction.
  const startTeaching = useCallback(() => {
    if (!voiceSupported || lessonSections.length === 0) return;
    const paras = splitParas(lessonSections[teachIdx]?.content ?? '');
    teachingRef.current = true;
    setTeaching(true);
    setHasStartedTeaching(true);
    setTeachParas(paras);
    setTeachParaIdx(0);
    setParaReady(false);
    if (paras.length > 0) speak(paras[0], () => setParaReady(true));
  }, [voiceSupported, lessonSections, teachIdx, speak]);

  // Safety net: if speech stops while the lesson still thinks it's reading
  // (another tab or app took over the voice, the OS interrupted it), reset
  // the reader so Listen works again instead of showing a dead Pause.
  useEffect(() => {
    if (!teaching || isSpeaking || isPaused) return;
    const timer = window.setTimeout(() => {
      if (teachingRef.current && !window.speechSynthesis?.speaking) {
        teachingRef.current = false;
        setTeaching(false);
        setParaReady(false);
      }
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [teaching, isSpeaking, isPaused]);

  const stopTeaching = useCallback(() => {
    teachingRef.current = false;
    stop();
    setTeaching(false);
    setParaReady(false);
  }, [stop]);

  const jumpToSection = (idx: number) => {
    stopTeaching();
    setTeachIdx(idx);
    setTeachParas(splitParas(lessonSections[idx]?.content ?? ''));
    setTeachParaIdx(0);
  };

  // ── Document upload / pasted text → lesson ──────────────────────────────────

  const lessonJobRef = useRef<LessonJob | null>(null);
  const [lessonRetry, setLessonRetry] = useState<string | null>(null);

  // Gets a lesson pass from the server. Returns null (and opens the top-up
  // modal) when the student has no lessons left.
  const startLessonSession = async (): Promise<string | null> => {
    const res = await fetch('/api/tutor/lesson-start', { method: 'POST' });
    const data = await res.json().catch(() => ({})) as { token?: string; error?: string; code?: string; quota?: TutorQuota };
    if (data.quota) setQuota(data.quota);
    if (res.status === 402 || data.code === 'no_credits') {
      setShowTutorPricing(true);
      return null;
    }
    if (!res.ok || !data.token) throw new Error(data.error || 'Could not start the lesson. Please try again.');
    return data.token;
  };

  const newLessonJob = (token: string, text: string, imageTopic: string, title: string): LessonJob => {
    const chunks = chunkContent(text, LESSON_BATCH_TARGET_CHARS);
    return {
      token,
      chunks: chunks.length > 0 ? chunks : [text],
      context: getContext(),
      full: '',
      priorTitles: [],
      nextIndex: 0,
      imageTopic,
      title,
    };
  };

  const postLessonCall = async (job: LessonJob, payload: Record<string, unknown>) => {
    const res = await fetch('/api/generate-lesson', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, context: job.context, lessonToken: job.token }),
      signal: lessonAbortRef.current?.signal,
    });
    if (!res.ok || !res.body) {
      const e = await res.json().catch(() => ({})) as { error?: string; code?: string };
      if (e.code === 'no_credits') setShowTutorPricing(true);
      throw new Error(e.error || 'Failed to create lesson');
    }
    return res.body;
  };

  // Runs (or resumes) a lesson from job.nextIndex. Small documents are one
  // call; long ones are written in parts, then a closing call adds the
  // Practice Review + Summary once every part is covered.
  const runLessonJob = async (job: LessonJob) => {
    lessonJobRef.current = job;
    setLessonRetry(null);
    setDocError('');
    setDocStage('generating');
    setDocProgress('');
    lessonAbortRef.current = new AbortController();
    const multi = job.chunks.length > 1;
    const totalParts = multi ? job.chunks.length + 1 : 1;

    try {
      if (!multi) {
        if (job.nextIndex === 0) {
          job.full = await streamToText(await postLessonCall(job, { text: job.chunks[0] }), setLessonText);
          job.nextIndex = 1;
        }
      } else {
        for (let i = job.nextIndex; i < job.chunks.length; i++) {
          setDocProgress(`Writing lesson — part ${i + 1} of ${totalParts}…`);
          const base = job.full;
          const body = await postLessonCall(job, {
            text: job.chunks[i],
            mode: i === 0 ? 'first' : 'continue',
            batchIndex: i,
            batchTotal: job.chunks.length,
            priorConceptTitles: job.priorTitles,
          });
          const batchText = await streamToText(body, partial => setLessonText(base ? `${base}\n\n${partial}` : partial));
          job.full = base ? `${base}\n\n${batchText}` : batchText;
          job.priorTitles.push(...extractSectionTitles(batchText));
          job.nextIndex = i + 1;
        }
        if (job.nextIndex === job.chunks.length) {
          setDocProgress('Adding practice questions and a summary…');
          const base = job.full;
          const body = await postLessonCall(job, { mode: 'synthesize', conceptSections: base });
          const synthText = await streamToText(body, partial => setLessonText(`${base}\n\n${partial}`));
          job.full = `${base}\n\n${synthText}`;
          job.nextIndex = job.chunks.length + 1;
        }
      }

      lessonJobRef.current = null;
      setLessonText(job.full);
      setLessonSections(parseSections(job.full));
      setDocStage('ready');
      loadQuota();
      const savedId = await saveLessonToLibrary(job.full, job.title);

      // Fetch keyword images for the whole lesson in the background
      setFetchingImages(true);
      fetch('/api/lesson-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonText: job.full, topic: job.imageTopic }),
      })
        .then(r => r.json())
        .then(({ images }) => {
          const found = (images ?? {}) as Record<string, { url: string; caption: string; pageUrl: string }>;
          setKeywordImages(found);
          if (savedId && Object.keys(found).length > 0) {
            createClient().from('tutor_lessons').update({ images: found }).eq('id', savedId).then(() => {}, () => {});
          }
        })
        .catch(() => {})
        .finally(() => setFetchingImages(false));
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      const msg = e instanceof Error ? e.message : 'Something went wrong';
      loadQuota();
      if (job.full.trim()) {
        // Keep everything already written and offer to carry on from the
        // part that failed.
        setLessonText(job.full);
        setLessonSections(parseSections(job.full));
        setDocStage('ready');
        setLessonRetry(`Part ${Math.min(job.nextIndex + 1, totalParts)} of ${totalParts} didn't finish — ${msg}`);
      } else {
        lessonJobRef.current = null;
        setDocError(msg);
        setDocStage('idle');
      }
    } finally {
      setDocProgress('');
    }
  };

  const retryLesson = () => {
    if (lessonJobRef.current) runLessonJob(lessonJobRef.current);
  };

  const resetLessonState = (fileName: string) => {
    stopTeaching();
    clearStoredLesson();
    lessonJobRef.current = null;
    savedLessonIdRef.current = null;
    setView('lesson');
    setLessonRetry(null);
    setDocStage('uploading');
    setDocProgress('');
    setDocError('');
    setLessonFileName(fileName);
    setLessonText('');
    setLessonSections([]);
    setKeywordImages({});
    setTeachIdx(0);
    setHasStartedTeaching(false);
  };

  const handleFileUpload = async (file: File) => {
    if (limitReached) {
      setShowTutorPricing(true);
      return;
    }

    const name = file.name.toLowerCase();
    const isOldPpt = file.type === 'application/vnd.ms-powerpoint' || (name.endsWith('.ppt') && !name.endsWith('.pptx'));
    const isOldDoc = file.type === 'application/msword' || (name.endsWith('.doc') && !name.endsWith('.docx'));
    if (isOldPpt) { setDocError('Old .ppt format isn’t supported — open it in PowerPoint and use Save As → .pptx, then upload that instead. Slides that are mostly images convert fine and will still be read correctly.'); return; }
    if (isOldDoc) { setDocError('Old .doc format is not supported. Please save as .docx in Word and try again.'); return; }

    let token: string | null;
    try {
      token = await startLessonSession();
    } catch (e) {
      setDocError(e instanceof Error ? e.message : 'Something went wrong');
      return;
    }
    if (!token) return;

    trackEvent('tutor_lesson_started', { fileName: file.name, fileType: file.type });
    resetLessonState(file.name);

    try {
      // Extraction happens entirely in the browser — sending the raw file
      // straight to the server blows past a serverless request-body limit
      // for anything but a tiny deck. See admin/generate/page.tsx's
      // handlePdfParse for the same pipeline.
      const { extractFileText } = await import('@/lib/extractPdfText');
      const { text, pageCount } = await extractFileText(file, (page, total) => {
        setDocProgress(`Extracting page ${page} of ${total}…`);
      });

      const isPptx = file.type.includes('presentationml') || name.endsWith('.pptx');
      const isDocx = file.type.includes('wordprocessingml') || name.endsWith('.docx');
      const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf');

      // A page/slide whose content was flattened into a picture has
      // essentially no extractable text. Caught by a low whole-file
      // average rather than "is it empty", since a repeated footer or
      // slide number alone can make text technically non-empty.
      const avgCharsPerUnit = pageCount > 0 ? text.length / pageCount : text.length;
      const looksImageOnly = avgCharsPerUnit < 80;

      let finalText = text;

      if (looksImageOnly && (isPptx || isDocx || isPdf)) {
        setDocProgress('Slides look like images — reading them with AI vision…');
        const { extractPptxImages, extractDocxImages, extractPdfPageImages, visionOcrImages } =
          await import('@/lib/extractPdfText');

        const images = isPptx ? await extractPptxImages(file)
          : isDocx ? await extractDocxImages(file)
          : await extractPdfPageImages(file, (page, total) => {
              setDocProgress(`Rendering page ${page} of ${total}…`);
            });

        if (images.length === 0) {
          if (!text.trim()) throw new Error('Could not extract text and found no embedded images to read visually either.');
        } else {
          const visionText = await visionOcrImages(images, (done, total) => {
            setDocProgress(`Reading slide images with AI vision (${done}/${total})…`);
          }, token);
          if (!visionText.trim() && !text.trim()) {
            throw new Error('AI vision could not read any content from these slide images.');
          }
          finalText = text.trim() ? `${text}\n\n${visionText}` : visionText;
        }
      }

      if (!finalText.trim()) throw new Error('Could not extract text. If this is a scanned PDF, it must be text-based.');

      setDocProgress(`Read ${finalText.length.toLocaleString()} characters from ${pageCount} pages — detecting topic…`);
      const parseRes = await fetch('/api/parse-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: finalText, pageCount }),
      });
      const parseData = await parseRes.json() as { text?: string; detectedTopic?: string; error?: string };
      if (!parseRes.ok || !parseData.text) throw new Error(parseData.error || 'Could not read the document');

      if (parseData.detectedTopic) setTopic(parseData.detectedTopic);
      await runLessonJob(newLessonJob(token, parseData.text, parseData.detectedTopic || file.name, parseData.detectedTopic || file.name));
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setDocError(e instanceof Error ? e.message : 'Something went wrong');
      setDocStage('idle');
    } finally {
      setDocProgress('');
    }
  };

  // Same pipeline as a file upload, just skipping the file-parsing step —
  // a student with notes as plain text (pasted from WhatsApp, a textbook
  // excerpt, an old assignment) shouldn't have to turn it into a document
  // first just to get a lesson out of it.
  const handlePastedText = async (text: string) => {
    setShowPasteModal(false);
    if (!text.trim()) return;
    if (limitReached) {
      setShowTutorPricing(true);
      return;
    }

    let token: string | null;
    try {
      token = await startLessonSession();
    } catch (e) {
      setDocError(e instanceof Error ? e.message : 'Something went wrong');
      return;
    }
    if (!token) return;

    trackEvent('tutor_lesson_started', { fileName: 'pasted-text', fileType: 'text/plain' });
    resetLessonState('Pasted text');

    let detectedTopic = '';
    try {
      const topicRes = await fetch('/api/parse-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const topicData = await topicRes.json() as { detectedTopic?: string };
      detectedTopic = topicData.detectedTopic || '';
      if (detectedTopic) setTopic(detectedTopic);
    } catch { /* topic detection optional */ }

    await runLessonJob(newLessonJob(token, text, detectedTopic || 'Pasted text', detectedTopic || 'Pasted notes'));
  };

  // ── Lesson reader view + "My lessons" library ────────────────────────────

  const savedLessonIdRef = useRef<string | null>(null);

  // Hidden until the tutor_lessons table exists (migration 027) — the
  // query errors before then, and students never see a broken button.
  const loadLibrary = useCallback(async () => {
    if (!user?.id) return;
    const { data, error } = await createClient()
      .from('tutor_lessons')
      .select('id, title, course_id, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) { setLibraryAvailable(false); return; }
    setLibraryAvailable(true);
    setLibraryItems((data ?? []) as LibraryItem[]);
  }, [user?.id]);

  useEffect(() => { loadLibrary(); }, [loadLibrary]);

  const saveLessonToLibrary = async (content: string, title: string): Promise<string | null> => {
    if (!user?.id) return null;
    const { data, error } = await createClient()
      .from('tutor_lessons')
      .insert({ user_id: user.id, course_id: selectedCourse || null, title: title.slice(0, 200), content })
      .select('id')
      .single();
    if (error || !data) return null;
    savedLessonIdRef.current = (data as { id: string }).id;
    loadLibrary();
    return savedLessonIdRef.current;
  };

  const openLibraryLesson = async (id: string) => {
    const { data } = await createClient()
      .from('tutor_lessons')
      .select('title, content, images')
      .eq('id', id)
      .single();
    if (!data) return;
    const lesson = data as { title: string; content: string; images: Record<string, { url: string; caption: string; pageUrl: string }> | null };
    stopTeaching();
    lessonAbortRef.current?.abort();
    lessonJobRef.current = null;
    setLessonRetry(null);
    savedLessonIdRef.current = id;
    setLessonFileName(lesson.title);
    setLessonText(lesson.content);
    setLessonSections(parseSections(lesson.content));
    setKeywordImages(lesson.images ?? {});
    setTeachIdx(0);
    setHasStartedTeaching(false);
    setDocError('');
    setDocStage('ready');
    setView('lesson');
    setShowLibrary(false);
  };

  const deleteLibraryLesson = async (id: string) => {
    if (!window.confirm('Delete this saved lesson? This can\'t be undone.')) return;
    await createClient().from('tutor_lessons').delete().eq('id', id);
    if (savedLessonIdRef.current === id) savedLessonIdRef.current = null;
    setLibraryItems(prev => prev.filter(item => item.id !== id));
  };

  const askAboutSection = (title: string) => {
    setInput(`Explain "${title}" from my lesson again in simpler words, with a different example.`);
    setView('chat');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const dismissLesson = () => {
    setView('chat');
    savedLessonIdRef.current = null;
    stopTeaching();
    lessonAbortRef.current?.abort();
    clearStoredLesson();
    lessonJobRef.current = null;
    setLessonRetry(null);
    setDocStage('idle');
    setLessonText('');
    setLessonSections([]);
    setLessonFileName('');
    setDocError('');
    setTeachParas([]);
    setTeachParaIdx(0);
    setHasStartedTeaching(false);
    setKeywordImages({});
    setCurrentImage(null);
    setFetchingImages(false);
  };

  // ── Chat ──────────────────────────────────────────────────────────────────

  const saveMessage = (role: 'user' | 'assistant', content: string) => {
    if (!user?.id || !content.trim()) return;
    const supabase = createClient();
    supabase.from('chat_messages').insert({
      user_id: user.id,
      course_id: selectedCourse || null,
      role,
      content,
    }).then(() => {}).catch(() => {}); // chat_messages not migrated on this environment yet
  };

  const sendMessage = async (text: string, action?: TutorAction) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    setView('chat');
    // Asking a question while a lesson is being read used to call stop(),
    // which silenced the lesson but left it "playing" (dead Pause button
    // until a refresh). The lesson now keeps reading; only a previous chat
    // reply being read aloud is stopped.
    if (!teachingRef.current) stop();
    if (messages.length === 0) trackEvent('ai_chat', { course: selectedCourseObj?.course_code });

    const userMsg: Message = { role: 'user', content: trimmed };
    setMessages(prev => [...prev, userMsg, { role: 'assistant', content: '' }]);
    saveMessage('user', trimmed);
    setInput('');
    setIsStreaming(true);
    abortRef.current = new AbortController();
    let full = '';

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          message: trimmed,
          courseId: selectedCourse || undefined,
          action,
          context: getContext() || undefined,
          history: messages.slice(-10),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to get response' })) as { error?: string };
        throw new Error(err.error);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setMessages(prev => [...prev.slice(0, -1), { role: 'assistant', content: full }]);
      }
      if (full) saveMessage('assistant', full);
      // Don't talk over a lesson that's being read.
      if (voiceEnabled && full && !teachingRef.current) speak(full);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Stopped by the student (or by switching course): keep whatever
        // had arrived, and drop the empty "Thinking…" bubble if nothing had.
        if (full) saveMessage('assistant', full);
        else setMessages(prev => {
          const last = prev[prev.length - 1];
          return last?.role === 'assistant' && !last.content ? prev.slice(0, -1) : prev;
        });
        return;
      }
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      // A limit message already says what to do; others get a retry nudge.
      const reply = /limit/i.test(msg) ? msg : `Sorry — ${msg.replace(/[.!\s]+$/, '')}. Please try again.`;
      setMessages(prev => [...prev.slice(0, -1), { role: 'assistant', content: reply }]);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  const clearChat = () => {
    abortRef.current?.abort();
    if (!teachingRef.current) stop();
    setMessages([]);
    setIsStreaming(false);
    if (user?.id) {
      const supabase = createClient();
      let query = supabase.from('chat_messages').delete().eq('user_id', user.id);
      query = selectedCourse ? query.eq('course_id', selectedCourse) : query.is('course_id', null);
      query.then(() => {}).catch(() => {});
    }
  };

  const isEmpty = messages.length === 0;
  const isProcessing = docStage === 'uploading' || docStage === 'generating';

  // One-tap personal actions — the server fills in the student's own data
  // (latest test mistakes, weak topics, exam date) for each of these.
  const courseCode = selectedCourseObj?.course_code;
  const quickActions: { label: string; hint: string; icon: string; message: string; action: TutorAction }[] = [
    ...(courseCode ? [{
      label: "Explain my last test's mistakes",
      hint: `Goes through what you got wrong in ${courseCode}`,
      icon: '📝',
      message: `Explain the mistakes from my last ${courseCode} test.`,
      action: 'explain_mistakes' as const,
    }] : []),
    {
      label: 'Quiz me on my weak topics',
      hint: 'One question at a time, with feedback',
      icon: '🎯',
      message: courseCode ? `Quiz me on my weak topics in ${courseCode}.` : 'Quiz me on my weak topics.',
      action: 'quiz_weak',
    },
    {
      label: 'Make me a revision plan',
      hint: 'Day by day, up to your exam date',
      icon: '🗓️',
      message: courseCode ? `Make me a revision plan for ${courseCode} before my exam.` : 'Make me a revision plan before my exams.',
      action: 'revision_plan',
    },
  ];

  const hasLesson = docStage !== 'idle';
  const currentSection = docStage === 'ready' ? lessonSections[teachIdx] : undefined;
  const practiseHref = selectedCourseObj ? `/courses/${courseCodeSlug(selectedCourseObj.course_code)}` : undefined;

  return (
    // The parent (student) layout pads every page with pt-16 on top and
    // 5rem + the safe-area inset at the bottom below lg (room for the
    // hamburger and the bottom tab bar), and pt-0+lg:py-8 at lg and up —
    // this has to match that exactly, or the internal scroll area below
    // is either too short (dead space) or too tall (pushes the composer
    // off-screen / creates a second page-level scrollbar). 100dvh instead
    // of 100vh so mobile Safari/Chrome's address bar showing or hiding
    // doesn't make the layout jump.
    // On phones the header is pulled up level with the menu button
    // (-mt-12, 3rem), so the page is 3rem taller than the rule above.
    <div className="-mt-12 lg:mt-0 flex flex-col h-[calc(100dvh-6rem-env(safe-area-inset-bottom))] lg:h-[calc(100dvh-2rem)] max-h-[900px]">

      {showTutorPricing && (
        <TutorPricingModal
          remaining={uploadRemaining}
          hasPurchased={(quota?.purchased ?? 0) > 0}
          onClose={() => setShowTutorPricing(false)}
          onSuccess={() => {
            loadQuota();
            setShowTutorPricing(false);
          }}
        />
      )}

      {showPasteModal && (
        <PasteTextModal
          onClose={() => setShowPasteModal(false)}
          onSubmit={handlePastedText}
        />
      )}

      <Modal isOpen={showLibrary} onClose={() => setShowLibrary(false)} title="My lessons" size="lg">
        {libraryItems.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">
            Lessons you create are saved here so you can reopen them any time, on any device, without using another lesson.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-white/10 -my-2">
            {libraryItems.map(item => {
              const itemCourse = courses.find(c => c.id === item.course_id);
              return (
                <li key={item.id} className="flex items-center gap-3 py-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0 dark:bg-blue-500/15 dark:text-blue-400">
                    <FileText className="w-4 h-4" />
                  </div>
                  <button onClick={() => openLibraryLesson(item.id)} className="flex-1 min-w-0 text-left">
                    <p className="text-sm font-medium text-gray-900 truncate dark:text-gray-100">{item.title}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {[itemCourse?.course_code, new Date(item.created_at).toLocaleDateString()].filter(Boolean).join(' · ')}
                    </p>
                  </button>
                  <button
                    onClick={() => openLibraryLesson(item.id)}
                    className="text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg flex-shrink-0"
                  >
                    Open
                  </button>
                  <button
                    onClick={() => deleteLibraryLesson(item.id)}
                    aria-label={`Delete ${item.title}`}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 flex-shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Modal>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.pptx"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) handleFileUpload(file);
          e.target.value = '';
        }}
      />

      {/* ── Header ── */}
      <div className="flex-shrink-0 pb-2 sm:pb-3">
        <div className="flex items-center sm:items-start justify-between gap-3 min-h-[40px] pl-14 lg:pl-0">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-2xl font-bold text-gray-900 flex items-center gap-2 dark:text-gray-100">
              <BotMessageSquare className="w-5 h-5 sm:w-7 sm:h-7 text-blue-600 flex-shrink-0" />
              <span className="truncate">AI Tutor</span>
            </h1>
            <p className="hidden sm:block text-gray-500 text-sm mt-0.5 dark:text-gray-400">Ask anything, or turn your slides and notes into a full lesson.</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {voiceSupported && (
              <button
                onClick={() => { if (isSpeaking && !teachingRef.current) stop(); if (!voiceEnabled) { trackEvent('voice_enabled'); primeSpeech(); } setVoiceEnabled(v => !v); }}
                title={voiceEnabled ? 'Replies are read aloud — tap to turn off' : 'Tap to have replies read aloud'}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  voiceEnabled
                    ? 'text-blue-600 bg-blue-50 hover:bg-blue-100 dark:bg-blue-500/10 dark:hover:bg-blue-500/15'
                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:text-gray-500 dark:hover:text-gray-300 dark:hover:bg-white/10'
                }`}
              >
                {voiceEnabled
                  ? <Volume2 className={`w-4 h-4 ${isSpeaking && !teaching ? 'animate-pulse' : ''}`} />
                  : <VolumeX className="w-4 h-4" />}
                <span className="hidden sm:inline">{voiceEnabled ? 'Voice on' : 'Voice off'}</span>
              </button>
            )}
            {!isEmpty && (!hasLesson || view === 'chat') && (
              <button onClick={clearChat} title="Clear this conversation" className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors dark:text-gray-400 dark:hover:bg-red-500/10">
                <Trash2 className="w-4 h-4" /><span className="hidden sm:inline">Clear chat</span>
              </button>
            )}
          </div>
        </div>

        {/* Context bar */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mt-2 sm:mt-3">
          {/* Course picker */}
          <div className="relative">
            <button
              onClick={() => setShowCourseMenu(v => !v)}
              className="flex items-center gap-1.5 sm:gap-2 px-2.5 py-1.5 sm:px-3 sm:py-2 bg-white border border-gray-200 rounded-lg sm:rounded-xl text-xs sm:text-sm text-gray-700 hover:border-blue-400 transition-colors shadow-sm dark:bg-white/[0.04] dark:border-white/10 dark:text-gray-300"
            >
              <BookOpen className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-500" />
              <span className="max-w-[110px] sm:max-w-[160px] truncate">{selectedCourseObj ? selectedCourseObj.course_code : 'Pick a course'}</span>
              <ChevronDown className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
            </button>
            {showCourseMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowCourseMenu(false)} />
                <div className="absolute top-full left-0 mt-1 w-72 max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-xl shadow-lg z-20 max-h-64 overflow-y-auto dark:bg-[#1c1a15] dark:border-white/10">
                  <button onClick={() => { setSelectedCourse(''); setShowCourseMenu(false); }} className="w-full text-left px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-50 border-b border-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.03] dark:border-white/10">
                    General (no specific course)
                  </button>
                  {[100, 200, 300, 400].map(level => {
                    const lc = courses.filter(c => c.level === level);
                    if (!lc.length) return null;
                    return (
                      <div key={level}>
                        <p className="px-4 py-1.5 text-xs font-semibold text-gray-400 uppercase bg-gray-50 dark:text-gray-500 dark:bg-white/[0.03]">Level {level}{user?.selected_semester ? ` · Semester ${user.selected_semester}` : ''}</p>
                        {lc.map(c => (
                          <button key={c.id} onClick={() => { setSelectedCourse(c.id); setShowCourseMenu(false); }}
                            className={`w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors ${selectedCourse === c.id ? 'text-blue-600 font-medium bg-blue-50 dark:bg-blue-500/10' : 'text-gray-700 dark:text-gray-300'}`}>
                            <span className="font-medium">{c.course_code}</span>
                            <span className="text-gray-500 ml-1.5 text-xs dark:text-gray-400">{c.course_name}</span>
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Topic */}
          <input
            type="text"
            placeholder="Topic (optional)"
            value={topic}
            onChange={e => setTopic(e.target.value)}
            className="hidden sm:block flex-1 min-w-[140px] px-3 py-2 bg-white border border-gray-200 rounded-lg sm:rounded-xl text-xs sm:text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm dark:bg-white/[0.04] dark:border-white/10 dark:text-gray-300 dark:placeholder-gray-500"
          />

          {/* Upload, paste, my lessons: one even row on phones */}
          <div className="flex w-full sm:w-auto gap-1.5 sm:gap-2">
          {/* Upload doc button */}
          {limitReached ? (
            <button
              onClick={() => setShowTutorPricing(true)}
              className="flex flex-1 sm:flex-none justify-center items-center gap-1.5 sm:gap-2 px-2.5 py-1.5 sm:px-3 sm:py-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg sm:rounded-xl text-xs sm:text-sm text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/15 transition-colors shadow-sm whitespace-nowrap"
              title="No lessons left — top up to make more"
            >
              <Lock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span>Get more lessons</span>
            </button>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              title="Upload PDF, Word, or PowerPoint to get a full AI lesson"
              className="flex flex-1 sm:flex-none justify-center items-center gap-1.5 sm:gap-2 px-2.5 py-1.5 sm:px-3 sm:py-2 bg-white border border-gray-200 rounded-lg sm:rounded-xl text-xs sm:text-sm text-gray-700 hover:border-blue-400 hover:text-blue-600 transition-colors shadow-sm disabled:opacity-50 whitespace-nowrap dark:bg-white/[0.04] dark:border-white/10 dark:text-gray-300"
            >
              {isProcessing
                ? <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin text-blue-500" />
                : <Paperclip className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
              <span>
                {docStage === 'uploading' ? 'Reading…' : docStage === 'generating' ? 'Building…' : <><span className="sm:hidden">Upload</span><span className="hidden sm:inline">Upload slides</span></>}
              </span>
              {uploadChecked && (
                <span className={`hidden sm:inline text-xs font-medium tabular-nums ${
                  uploadRemaining <= 2 ? 'text-amber-500' : 'text-gray-400 dark:text-gray-500'
                }`}>
                  {quota?.freeWindow && !quota.purchased
                    ? `${uploadRemaining} of ${quota.freeWindow.limit} left`
                    : `${uploadRemaining} ${uploadRemaining === 1 ? 'lesson' : 'lessons'} left`}
                </span>
              )}
            </button>
          )}

          {/* Paste text button — same lesson pipeline, no file needed */}
          {!limitReached && (
            <button
              onClick={() => setShowPasteModal(true)}
              disabled={isProcessing}
              title="Paste text — notes, an excerpt, anything — to get a full AI lesson"
              className="flex flex-1 sm:flex-none justify-center items-center gap-1.5 sm:gap-2 px-2.5 py-1.5 sm:px-3 sm:py-2 bg-white border border-gray-200 rounded-lg sm:rounded-xl text-xs sm:text-sm text-gray-700 hover:border-blue-400 hover:text-blue-600 transition-colors shadow-sm disabled:opacity-50 whitespace-nowrap dark:bg-white/[0.04] dark:border-white/10 dark:text-gray-300"
            >
              <ClipboardPaste className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span><span className="sm:hidden">Paste</span><span className="hidden sm:inline">Paste text</span></span>
            </button>
          )}

          {libraryAvailable && (
            <button
              onClick={() => { loadLibrary(); setShowLibrary(true); }}
              title="Reopen lessons you've already made — free"
              className="flex flex-1 sm:flex-none justify-center items-center gap-1.5 sm:gap-2 px-2.5 py-1.5 sm:px-3 sm:py-2 bg-white border border-gray-200 rounded-lg sm:rounded-xl text-xs sm:text-sm text-gray-700 hover:border-blue-400 hover:text-blue-600 transition-colors shadow-sm whitespace-nowrap dark:bg-white/[0.04] dark:border-white/10 dark:text-gray-300"
            >
              <Library className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span><span className="sm:hidden">Lessons</span><span className="hidden sm:inline">My lessons</span>{libraryItems.length > 0 ? ` (${libraryItems.length})` : ''}</span>
            </button>
          )}
          </div>
        </div>

        {/* Phones: the uploads count lives here, not in the button. */}
        {uploadChecked && !limitReached && (!quota?.freeWindow || quota.freeWindow.used === 0) && (
          <p className="sm:hidden mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            {quota?.freeWindow ? `${quota.freeWindow.limit} of ${quota.freeWindow.limit} free uploads left` : `${uploadRemaining} ${uploadRemaining === 1 ? 'lesson' : 'lessons'} left`}
          </p>
        )}

        {/* Free accounts: uploads come back one at a time, 3 hours after use */}
        {quota?.freeWindow && quota.freeWindow.used > 0 && quota.freeWindow.nextAt && (
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {Math.max(0, quota.freeWindow.limit - quota.freeWindow.used)} of {quota.freeWindow.limit} free uploads left
            {' · '}next one back at {new Date(quota.freeWindow.nextAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </p>
        )}

        {/* Upload error */}
        {docError && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400 flex items-start gap-1">
            <X className="w-3 h-3 mt-0.5 flex-shrink-0" /><span>{docError}</span>
          </p>
        )}
      </div>

      {/* Lesson / Chat switch — phones and tablets; side by side on desktop */}
      {hasLesson && (
        <div className="lg:hidden flex-shrink-0 grid grid-cols-2 gap-1 p-1 mb-3 bg-gray-100 rounded-xl dark:bg-white/10">
          {([
            ['lesson', 'Lesson', BookOpen],
            ['chat', 'Ask questions', MessageSquare],
          ] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                view === key
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-white/15 dark:text-gray-100'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <Icon className="w-4 h-4" />{label}
            </button>
          ))}
        </div>
      )}

      <div className={`flex-1 min-h-0 flex flex-col ${hasLesson ? 'lg:grid lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)] lg:gap-4' : ''}`}>
        {/* ── Lesson reader ── */}
        {hasLesson && (
          <div className={`${view === 'lesson' ? 'flex' : 'hidden'} lg:flex flex-1 min-h-0 flex-col rounded-2xl border border-blue-200 bg-white overflow-hidden shadow-sm dark:bg-[#1c1a15] dark:border-blue-500/20`}>

            <div className="flex items-center gap-2 px-3 sm:px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
              <FileText className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm font-semibold flex-1 truncate min-w-0">{lessonFileName}</span>
              {(docStage === 'uploading' || docStage === 'generating') && (
                <Loader2 className="w-4 h-4 animate-spin text-blue-100 flex-shrink-0" />
              )}
              {docStage === 'ready' && fetchingImages && (
                <span className="flex items-center gap-1 text-blue-100 text-xs flex-shrink-0">
                  <Loader2 className="w-3 h-3 animate-spin" /><span className="hidden sm:inline">Finding pictures…</span>
                </span>
              )}
              <button onClick={dismissLesson} title="Close lesson" aria-label="Close lesson" className="p-1 hover:bg-white/20 rounded-lg transition-colors flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>

            {lessonRetry && docStage === 'ready' && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-2.5 bg-amber-50 border-b border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/20">
                <p className="flex-1 text-xs text-amber-800 dark:text-amber-300">
                  {lessonRetry} What&rsquo;s below is saved — retrying won&rsquo;t use another lesson.
                </p>
                <button
                  onClick={retryLesson}
                  className="self-start sm:self-auto flex-shrink-0 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 px-3 py-1.5 rounded-lg transition-colors"
                >
                  Retry the rest
                </button>
              </div>
            )}

            {docStage === 'ready' && lessonSections.length > 0 && (
              <div className="flex gap-1.5 px-3 py-2 overflow-x-auto border-b border-gray-100 bg-gray-50 dark:border-white/10 dark:bg-white/[0.03]">
                {lessonSections.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => jumpToSection(i)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs whitespace-nowrap transition-colors ${
                      i === teachIdx
                        ? 'bg-blue-600 text-white font-semibold'
                        : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600 dark:bg-white/[0.04] dark:border-white/10 dark:text-gray-400'
                    }`}
                  >
                    <span>{sectionIcon(s.title)}</span>
                    <span>{s.title}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5">
              {(docStage === 'uploading' || docStage === 'generating') && (
                <>
                  <p className="text-sm text-blue-600 dark:text-blue-400 flex items-center gap-2 mb-3">
                    <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                    {docProgress || (docStage === 'uploading' ? 'Reading your document…' : 'Writing your lesson…')}
                  </p>
                  {lessonText && (
                    <div className="text-[15px] text-gray-700 leading-7 break-words dark:text-gray-300" dangerouslySetInnerHTML={{ __html: mdToHtml(lessonText) }} />
                  )}
                </>
              )}

              {currentSection && (
                <>
                  <div className="flex items-start gap-2 mb-3">
                    <span className="text-xl leading-none mt-0.5">{sectionIcon(currentSection.title)}</span>
                    <h3 className="flex-1 font-bold text-gray-900 text-base sm:text-lg leading-snug dark:text-gray-100">{currentSection.title}</h3>
                    {teaching && isPaused && (
                      <span className="text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 rounded-full flex-shrink-0">
                        Paused
                      </span>
                    )}
                  </div>

                  {teaching && teachParas.length > 0 ? (
                    <div className="space-y-3">
                      {teachParas.map((para, i) => {
                        const isActive = i === teachParaIdx;
                        const isPast = i < teachParaIdx;
                        return (
                          <div key={i} className={`rounded-xl transition-all duration-300 ${
                            isActive ? 'ring-2 ring-blue-400 bg-blue-50 dark:bg-blue-500/10 px-3 py-2'
                              : isPast ? 'opacity-40 px-1' : 'px-1'
                          }`}>
                            {isActive && isSpeaking && speakingText
                              ? <SpeechHighlight text={speakingText} position={position} className="!text-[15px] leading-7" />
                              : <div className="text-[15px] text-gray-800 leading-7 break-words dark:text-gray-200" dangerouslySetInnerHTML={{ __html: mdToHtml(para) }} />
                            }
                          </div>
                        );
                      })}
                    </div>
                  ) : currentSection.title.toLowerCase() === 'practice review' ? (
                    <PracticeReviewPanel content={currentSection.content} practiseHref={practiseHref} practiseLabel={selectedCourseObj?.course_code} />
                  ) : (
                    <div className="text-[15px] text-gray-800 leading-7 break-words dark:text-gray-200" dangerouslySetInnerHTML={{ __html: mdToHtml(currentSection.content) }} />
                  )}

                  {currentSection.title.toLowerCase() !== 'practice review' && (
                    <button
                      onClick={() => askAboutSection(currentSection.title)}
                      className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-100 dark:hover:bg-blue-500/15 px-3 py-2 rounded-lg transition-colors"
                    >
                      <MessageSquare className="w-4 h-4" />
                      Still confused? Ask about this part
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Keyword image panel — appears when the voice reaches a visual term */}
            {currentImage && (
              <div className="flex-shrink-0 border-t border-indigo-100 bg-gradient-to-r from-indigo-50 to-blue-50 px-4 py-3 flex items-center gap-4 dark:border-indigo-500/20 dark:from-indigo-500/10 dark:to-blue-500/10"
                key={currentImage.keyword}>
                <img
                  src={currentImage.url}
                  alt={currentImage.caption}
                  className="w-28 h-20 object-contain rounded-xl bg-white border border-indigo-100 dark:border-indigo-500/20 shadow-sm flex-shrink-0 dark:bg-white/[0.04]"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">{currentImage.keyword}</span>
                    <span className="text-[10px] bg-indigo-100 dark:bg-indigo-500/15 text-indigo-500 dark:text-indigo-400 px-1.5 py-0.5 rounded-full font-medium">visual</span>
                  </div>
                  <p className="text-xs text-gray-500 leading-snug line-clamp-2 dark:text-gray-400">{currentImage.caption}</p>
                </div>
              </div>
            )}

            {/* Reader controls */}
            {docStage === 'ready' && lessonSections.length > 0 && (
              <div className="flex-shrink-0 border-t border-gray-100 bg-gray-50 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="h-1 bg-gray-200 dark:bg-white/10">
                  <div
                    className="h-1 bg-blue-600 transition-all duration-500"
                    style={{ width: `${((teachIdx + 1) / lessonSections.length) * 100}%` }}
                  />
                </div>
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button
                    onClick={() => jumpToSection(Math.max(0, teachIdx - 1))}
                    disabled={teachIdx === 0}
                    className="flex items-center gap-1 h-9 px-3 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 disabled:opacity-40 hover:bg-gray-100 transition-colors dark:bg-white/[0.04] dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/10"
                  >
                    <ChevronLeft className="w-4 h-4" /><span className="hidden sm:inline">Back</span>
                  </button>

                  <div className="flex-1 flex items-center justify-center gap-2 min-w-0">
                    {voiceSupported && (teaching ? (
                      <>
                        <button
                          onClick={() => (isPaused ? resume() : pause())}
                          className="flex items-center gap-1.5 h-9 px-3 rounded-lg bg-blue-50 text-blue-700 text-sm font-semibold hover:bg-blue-100 transition-colors dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/15"
                        >
                          {isPaused ? <Play className="w-4 h-4" /> : <PauseCircle className="w-4 h-4" />}
                          {isPaused ? 'Resume' : 'Pause'}
                        </button>
                        <button
                          onClick={stopTeaching}
                          aria-label="Stop reading"
                          className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-gray-600 text-sm font-medium hover:bg-gray-100 transition-colors dark:text-gray-400 dark:hover:bg-white/10"
                        >
                          <StopCircle className="w-4 h-4" /><span className="hidden sm:inline">Stop</span>
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={startTeaching}
                        className="flex items-center gap-1.5 h-9 px-3 rounded-lg bg-blue-50 text-blue-700 text-sm font-semibold hover:bg-blue-100 transition-colors dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/15"
                      >
                        <Volume2 className="w-4 h-4" />
                        {hasStartedTeaching ? 'Resume' : 'Listen'}
                      </button>
                    ))}
                    <span className="text-xs text-gray-500 tabular-nums dark:text-gray-400">{teachIdx + 1}/{lessonSections.length}</span>
                  </div>

                  <button
                    onClick={() => jumpToSection(Math.min(lessonSections.length - 1, teachIdx + 1))}
                    disabled={teachIdx === lessonSections.length - 1}
                    className="flex items-center gap-1 h-9 px-3 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-40 hover:bg-blue-700 transition-colors"
                  >
                    <span className="hidden sm:inline">Next</span><ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Chat ── */}
        <div className={`${hasLesson && view === 'lesson' ? 'hidden' : 'flex'} lg:flex flex-1 min-h-0 flex-col`}>
          <div className="flex-1 min-h-0 overflow-y-auto rounded-2xl border border-gray-200 bg-gray-50 relative dark:border-white/10 dark:bg-white/[0.03]">
            {isEmpty ? (
              <div className="flex flex-col items-center justify-center min-h-full px-4 sm:px-6 py-6 text-center gap-5">
                <div className="w-14 h-14 bg-blue-100 dark:bg-blue-500/15 rounded-2xl flex items-center justify-center">
                  <BotMessageSquare className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 mb-1 dark:text-gray-100">
                    {courseCode ? `Your ${courseCode} tutor` : 'Ready to help you learn'}
                  </h2>
                  <p className="text-gray-500 text-sm max-w-sm dark:text-gray-400">
                    {courseCode
                      ? 'I know your weak topics and recent test results for this course. Pick one to start, or ask anything.'
                      : 'Ask anything, or upload your slides for a full lesson you can listen to.'}
                  </p>
                </div>
                <div className={`grid grid-cols-1 gap-2.5 w-full max-w-2xl ${quickActions.length === 3 && !hasLesson ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                  {quickActions.map(a => (
                    <button
                      key={a.action}
                      onClick={() => sendMessage(a.message, a.action)}
                      className="flex sm:flex-col items-center sm:items-start gap-3 sm:gap-2 p-3.5 text-left bg-white border border-gray-200 rounded-2xl shadow-sm hover:border-blue-400 hover:shadow-md active:scale-[0.98] transition-all dark:bg-white/[0.04] dark:border-white/10 dark:hover:border-blue-500/40"
                    >
                      <span className="text-2xl flex-shrink-0">{a.icon}</span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">{a.label}</span>
                        <span className="block text-xs text-gray-500 mt-0.5 dark:text-gray-400">{a.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
                {!courseCode && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm">
                    Tip: pick your course at the top so I can use your own test results and weak topics.
                  </p>
                )}
                <div className="flex flex-wrap gap-2 justify-center max-w-md">
                  {SUGGESTIONS.map(s => (
                    <button key={s} onClick={() => sendMessage(s)}
                      className="px-3 py-1.5 bg-white border border-gray-200 rounded-full text-sm text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors shadow-sm dark:bg-white/[0.04] dark:border-white/10 dark:text-gray-400">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-3 sm:p-4 space-y-4">
                {messages.map((msg, i) => (
                  <div key={i} className={`flex gap-2.5 sm:gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {msg.role === 'assistant' && (
                      <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <BotMessageSquare className="w-5 h-5 text-white" />
                      </div>
                    )}
                    <div className={`min-w-0 max-w-[85%] rounded-2xl px-4 py-3 [overflow-wrap:anywhere] ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white rounded-tr-sm'
                        : 'bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/10 rounded-tl-sm shadow-sm'
                    }`}>
                      {msg.role === 'user' ? (
                        <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{msg.content}</p>
                      ) : msg.content === '' ? (
                        <div className="flex items-center gap-2 py-1">
                          <div className="flex gap-1">
                            {[0, 1, 2].map(n => (
                              <span key={n} className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: `${n * 150}ms` }} />
                            ))}
                          </div>
                          <span className="text-xs text-gray-400 dark:text-gray-500">Thinking…</span>
                        </div>
                      ) : (
                        isSpeaking && voiceEnabled && !teaching && i === messages.length - 1 && speakingText
                          ? <SpeechHighlight text={speakingText} position={position} />
                          : <MessageContent content={msg.content} />
                      )}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* ── Input area ── */}
          <div className="flex-shrink-0 pt-3">
            {teaching && (
              <div className="lg:hidden flex items-center gap-2 mb-2 px-3 py-2 rounded-xl bg-blue-50 border border-blue-100 dark:bg-blue-500/10 dark:border-blue-500/20">
                <Volume2 className={`w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 ${isPaused ? '' : 'animate-pulse'}`} />
                <button
                  onClick={() => setView('lesson')}
                  className="flex-1 min-w-0 text-left text-xs font-medium text-blue-800 truncate dark:text-blue-300"
                >
                  {isPaused ? 'Paused' : 'Reading'}: {lessonSections[teachIdx]?.title ?? 'your lesson'}
                </button>
                <button
                  onClick={() => (isPaused ? resume() : pause())}
                  className="text-xs font-semibold text-blue-700 bg-white px-2.5 py-1 rounded-lg border border-blue-100 dark:text-blue-300 dark:bg-white/10 dark:border-white/10"
                >
                  {isPaused ? 'Resume' : 'Pause'}
                </button>
                <button
                  onClick={stopTeaching}
                  className="text-xs font-medium text-gray-600 px-2 py-1 rounded-lg hover:bg-white dark:text-gray-400 dark:hover:bg-white/10"
                >
                  Stop
                </button>
              </div>
            )}
            {!isEmpty && !isStreaming && (
              <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
                {quickActions.map(a => (
                  <button
                    key={a.action}
                    onClick={() => sendMessage(a.message, a.action)}
                    className="flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 bg-white border border-gray-200 rounded-full text-xs font-medium text-gray-700 hover:border-blue-400 hover:text-blue-600 transition-colors dark:bg-white/[0.04] dark:border-white/10 dark:text-gray-300"
                  >
                    <span>{a.icon}</span>{a.label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2 bg-white border border-gray-200 rounded-2xl p-2 shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all dark:bg-white/[0.04] dark:border-white/10 dark:focus-within:ring-blue-500/20">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isStreaming}
                placeholder={docStage === 'ready' ? 'Ask anything about this lesson…' : courseCode ? `Ask anything about ${courseCode}…` : 'Ask anything…'}
                className="flex-1 resize-none text-sm text-gray-800 placeholder-gray-400 outline-none bg-transparent px-2 py-1.5 max-h-32 overflow-y-auto dark:text-gray-200 dark:placeholder-gray-500"
                style={{ height: 'auto', minHeight: '38px' }}
                onInput={e => {
                  const t = e.currentTarget;
                  t.style.height = 'auto';
                  t.style.height = Math.min(t.scrollHeight, 128) + 'px';
                }}
              />
              {isStreaming ? (
                <button
                  onClick={() => abortRef.current?.abort()}
                  title="Stop answering"
                  aria-label="Stop answering"
                  className="w-9 h-9 rounded-xl bg-gray-900 hover:bg-gray-700 dark:bg-white/15 dark:hover:bg-white/25 flex items-center justify-center flex-shrink-0 transition-colors"
                >
                  <StopCircle className="w-4 h-4 text-white" />
                </button>
              ) : (
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim()}
                  aria-label="Send"
                  className="w-9 h-9 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center flex-shrink-0 transition-colors"
                >
                  <Send className="w-4 h-4 text-white" />
                </button>
              )}
            </div>
            <p className="text-center text-xs text-gray-400 mt-2 dark:text-gray-500">
              AI can make mistakes — check important answers against your course materials.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
