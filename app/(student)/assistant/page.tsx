'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useSpeech } from '@/lib/hooks/useSpeech';
import { SpeechHighlight } from '@/lib/hooks/SpeechHighlight';
import { trackEvent } from '@/lib/track';
import { useAuth } from '@/components/providers';
import { useSubscriptionStore } from '@/lib/store';
import { TutorPricingModal } from './components/TutorPricingModal';
import type { Course } from '@/types';
import {
  BotMessageSquare, Send, Trash2, Loader2, BookOpen, ChevronDown,
  User, Volume2, VolumeX, Paperclip, FileText, Play, StopCircle,
  ChevronLeft, ChevronRight, X, Lock,
} from 'lucide-react';

const FREE_UPLOAD_LIMIT = 5;
const PAID_UPLOAD_LIMIT = 100;

// ── Types ──────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface LessonSection {
  title: string;
  content: string;
}

// ── Markdown renderer ──────────────────────────────────────────────────────

function mdToHtml(text: string): string {
  return (
    text
      .replace(/```(\w*)\n?([\s\S]*?)```/g,
        '<pre class="bg-gray-900 text-green-300 rounded-xl p-4 overflow-x-auto text-sm my-3 font-mono"><code>$2</code></pre>')
      .replace(/`([^`\n]+)`/g, '<code class="bg-gray-100 text-pink-600 px-1.5 py-0.5 rounded text-sm font-mono">$1</code>')
      .replace(/^## (.+)$/gm, '<h2 class="text-base font-bold text-gray-900 mt-4 mb-1.5">$1</h2>')
      .replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold text-gray-800 mt-3 mb-1">$1</h3>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/\[🎬 ([^\]]+)\]\((https:\/\/www\.youtube\.com\/results[^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 mt-1 px-3 py-1.5 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors no-underline">▶ $1</a>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:text-blue-800 underline decoration-blue-300 font-medium break-words">$1</a>')
      .replace(/^---$/gm, '<hr class="my-4 border-gray-200" />')
      .replace(/^[*-] (.+)$/gm, '<li class="flex gap-2"><span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0"></span><span>$1</span></li>')
      .replace(/^(\d+)\. (.+)$/gm, '<li class="flex gap-2"><span class="font-semibold text-blue-600 flex-shrink-0">$1.</span><span>$2</span></li>')
      .replace(/(<li[\s\S]*?<\/li>\n?)+/g, '<ul class="space-y-1.5 my-2">$&</ul>')
      .replace(/\n{2,}/g, '</p><p class="mb-2 leading-relaxed">')
      .replace(/\n/g, '<br />')
  );
}

function MessageContent({ content }: { content: string }) {
  return (
    <div
      className="prose-sm text-sm leading-relaxed text-gray-800 [&_p]:mb-2 [&_p]:leading-relaxed [&_ul]:my-2"
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

function PracticeReviewPanel({ content }: { content: string }) {
  const pairs = parsePracticeQA(content);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());

  useEffect(() => { setRevealed(new Set()); }, [content]);

  if (pairs.length === 0) {
    // The model didn't follow the Q/A format — fall back to raw rendering
    // rather than showing nothing.
    return <div className="text-sm text-gray-800 leading-relaxed" dangerouslySetInnerHTML={{ __html: mdToHtml(content) }} />;
  }

  return (
    <div className="space-y-3">
      {pairs.map((pair, i) => {
        const isRevealed = revealed.has(i);
        return (
          <div key={i} className="rounded-xl border border-gray-200 p-3">
            <p className="text-sm font-semibold text-gray-900 mb-2">
              <span className="text-blue-600">Q{i + 1}.</span>{' '}
              <span dangerouslySetInnerHTML={{ __html: mdToHtml(pair.question) }} />
            </p>
            {isRevealed ? (
              <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2"
                dangerouslySetInnerHTML={{ __html: mdToHtml(pair.answer) }} />
            ) : (
              <button
                onClick={() => setRevealed(prev => new Set([...prev, i]))}
                className="text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
              >
                Think it through, then show answer
              </button>
            )}
          </div>
        );
      })}
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

// ── Page ───────────────────────────────────────────────────────────────────

export default function AssistantPage() {
  const { user } = useAuth();
  const { hasActiveSub } = useSubscriptionStore();
  const isPaid = hasActiveSub(user?.selected_level, user?.selected_semester);

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
  const [docError, setDocError] = useState('');
  const [lessonFileName, setLessonFileName] = useState('');
  const [lessonText, setLessonText] = useState('');
  const [lessonSections, setLessonSections] = useState<LessonSection[]>([]);
  const [teaching, setTeaching] = useState(false);
  const [teachIdx, setTeachIdx] = useState(0);
  const [teachParas, setTeachParas] = useState<string[]>([]);
  const [teachParaIdx, setTeachParaIdx] = useState(0);
  const [paraReady, setParaReady] = useState(false);
  const [keywordImages, setKeywordImages] = useState<Record<string, { url: string; caption: string; pageUrl: string }>>({});

  // Upload quota
  const [uploadCount, setUploadCount] = useState(0);
  const [tutorCreditsPurchased, setTutorCreditsPurchased] = useState(0);
  const [uploadChecked, setUploadChecked] = useState(false);
  const [showTutorPricing, setShowTutorPricing] = useState(false);
  const [currentImage, setCurrentImage] = useState<{ url: string; caption: string; keyword: string } | null>(null);
  const [fetchingImages, setFetchingImages] = useState(false);

  // Effective limit: course sub → 100, tutor credits → purchased amount, free → 5
  const uploadLimit = isPaid
    ? PAID_UPLOAD_LIMIT
    : tutorCreditsPurchased > 0
      ? tutorCreditsPurchased
      : FREE_UPLOAD_LIMIT;
  const uploadRemaining = Math.max(0, uploadLimit - uploadCount);
  const limitReached = uploadChecked && uploadCount >= uploadLimit;

  const { speak, stop, isSpeaking, charIndex, speakingText, isSupported: voiceSupported } = useSpeech();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lessonAbortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const teachingRef = useRef(false);
  const lessonSectionsRef = useRef<LessonSection[]>([]);

  useEffect(() => {
    const supabase = createClient();
    supabase.from('courses').select('*').order('level')
      .then(({ data }: { data: Course[] | null }) => { if (data) setCourses(data); });
  }, []);

  // Restore the ongoing conversation — previously lived only in page
  // state, so closing the tab erased everything.
  useEffect(() => {
    if (!user?.id) return;
    const supabase = createClient();
    supabase
      .from('chat_messages')
      .select('role, content')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(50)
      .then(({ data }: { data: Message[] | null }) => {
        if (data && data.length > 0) setMessages(data);
      })
      .catch(() => {}); // chat_messages not migrated on this environment yet
  }, [user?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Keep sections ref in sync so teaching callbacks don't go stale
  useEffect(() => { lessonSectionsRef.current = lessonSections; }, [lessonSections]);

  // Load upload count + purchased AI Tutor credits
  const loadUploadCount = useCallback(async () => {
    const supabase = createClient();
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) return;

    // How many uploads they've done
    let used = 0;
    try {
      const { count } = await supabase
        .from('feature_events')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', authUser.id)
        .eq('event', 'document_upload');
      used = count ?? 0;
    } catch { /* feature_events table not created yet */ }

    // How many tutor credits they've purchased
    let purchased = 0;
    try {
      const { data } = await supabase
        .from('ai_tutor_credits')
        .select('total_credits')
        .eq('user_id', authUser.id);
      purchased = (data ?? []).reduce((sum: number, r: { total_credits: number }) => sum + r.total_credits, 0);
    } catch { /* ai_tutor_credits table not created yet */ }

    setUploadCount(used);
    setTutorCreditsPurchased(purchased);
    setUploadChecked(true);
  }, []);

  useEffect(() => { loadUploadCount(); }, [loadUploadCount]);

  // Detect spoken keyword and update the image panel
  useEffect(() => {
    if (!isSpeaking || !speakingText || charIndex === 0 || Object.keys(keywordImages).length === 0) return;
    const fromHere = speakingText.slice(charIndex).toLowerCase();
    // Sort longest first so multi-word keywords match before single-word prefixes
    const sorted = Object.keys(keywordImages).sort((a, b) => b.length - a.length);
    for (const kw of sorted) {
      const kwLower = kw.toLowerCase();
      if (fromHere.startsWith(kwLower)) {
        const after = fromHere[kwLower.length];
        if (!after || /\W/.test(after)) {
          setCurrentImage({ ...keywordImages[kw], keyword: kw });
          return;
        }
      }
    }
  }, [charIndex, speakingText, isSpeaking, keywordImages]);

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

  const startTeaching = useCallback(() => {
    if (!voiceSupported || lessonSections.length === 0) return;
    const paras = splitParas(lessonSections[0].content);
    teachingRef.current = true;
    setTeaching(true);
    setTeachIdx(0);
    setTeachParas(paras);
    setTeachParaIdx(0);
    setParaReady(false);
    if (paras.length > 0) speak(paras[0], () => setParaReady(true));
  }, [voiceSupported, lessonSections, speak]);

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

  // ── Document upload ───────────────────────────────────────────────────────

  const handleFileUpload = async (file: File) => {
    if (limitReached) {
      setShowTutorPricing(true);
      return;
    }
    trackEvent('document_upload', { fileName: file.name, fileType: file.type });
    setUploadCount(prev => prev + 1);
    setDocStage('uploading');
    setDocError('');
    setLessonFileName(file.name);
    setLessonText('');
    setLessonSections([]);
    setTeachIdx(0);

    try {
      const formData = new FormData();
      formData.append('file', file);
      const parseRes = await fetch('/api/parse-pdf', { method: 'POST', body: formData });
      const parseData = await parseRes.json() as { text?: string; detectedTopic?: string; error?: string };
      if (!parseRes.ok || !parseData.text) throw new Error(parseData.error || 'Could not read the document');

      if (parseData.detectedTopic) setTopic(parseData.detectedTopic);

      setDocStage('generating');

      lessonAbortRef.current = new AbortController();
      const lessonRes = await fetch('/api/generate-lesson', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: parseData.text, context: getContext() }),
        signal: lessonAbortRef.current.signal,
      });

      if (!lessonRes.ok || !lessonRes.body) {
        const e = await lessonRes.json().catch(() => ({ error: 'Failed to create lesson' })) as { error?: string };
        throw new Error(e.error);
      }

      const reader = lessonRes.body.getReader();
      const decoder = new TextDecoder();
      let full = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setLessonText(full);
      }

      const sections = parseSections(full);
      setLessonSections(sections);
      setDocStage('ready');

      // Fetch keyword images for the whole lesson in the background
      setFetchingImages(true);
      fetch('/api/lesson-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonText: full, topic: parseData.detectedTopic || file.name }),
      })
        .then(r => r.json())
        .then(({ images }) => setKeywordImages(images as Record<string, { url: string; caption: string; pageUrl: string }>))
        .catch(() => {})
        .finally(() => setFetchingImages(false));
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setDocError(e instanceof Error ? e.message : 'Something went wrong');
      setDocStage('idle');
    }
  };

  const dismissLesson = () => {
    stopTeaching();
    lessonAbortRef.current?.abort();
    setDocStage('idle');
    setLessonText('');
    setLessonSections([]);
    setLessonFileName('');
    setDocError('');
    setTeachParas([]);
    setTeachParaIdx(0);
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

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    stop();
    if (messages.length === 0) trackEvent('ai_chat', { course: selectedCourseObj?.course_code });

    const userMsg: Message = { role: 'user', content: trimmed };
    setMessages(prev => [...prev, userMsg, { role: 'assistant', content: '' }]);
    saveMessage('user', trimmed);
    setInput('');
    setIsStreaming(true);
    abortRef.current = new AbortController();

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          message: trimmed,
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
      let full = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setMessages(prev => [...prev.slice(0, -1), { role: 'assistant', content: full }]);
      }
      if (full) saveMessage('assistant', full);
      if (voiceEnabled && full) speak(full);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      setMessages(prev => [...prev.slice(0, -1), { role: 'assistant', content: `Sorry — ${msg}. Please try again.` }]);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  const clearChat = () => {
    abortRef.current?.abort();
    stop();
    setMessages([]);
    setIsStreaming(false);
    if (user?.id) {
      const supabase = createClient();
      supabase.from('chat_messages').delete().eq('user_id', user.id).then(() => {}).catch(() => {});
    }
  };

  const isEmpty = messages.length === 0;
  const isProcessing = docStage === 'uploading' || docStage === 'generating';

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-h-[900px]">

      {showTutorPricing && (
        <TutorPricingModal
          usedCredits={uploadCount}
          purchasedCredits={tutorCreditsPurchased}
          onClose={() => setShowTutorPricing(false)}
          onSuccess={(newCredits) => {
            setTutorCreditsPurchased(prev => prev + newCredits);
            setShowTutorPricing(false);
          }}
        />
      )}

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
      <div className="flex-shrink-0 pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <BotMessageSquare className="w-7 h-7 text-blue-600" />
              AI Study Assistant
            </h1>
            <p className="text-gray-500 text-sm mt-0.5">Ask anything, or upload a document to get a full lesson.</p>
          </div>
          <div className="flex items-center gap-2">
            {voiceSupported && (
              <button
                onClick={() => { if (isSpeaking) stop(); if (!voiceEnabled) trackEvent('voice_enabled'); setVoiceEnabled(v => !v); }}
                title={voiceEnabled ? 'Voice on — click to turn off' : 'Voice off — click to turn on'}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  voiceEnabled ? 'text-blue-600 bg-blue-50 hover:bg-blue-100' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                }`}
              >
                {voiceEnabled
                  ? <Volume2 className={`w-4 h-4 ${isSpeaking && !teaching ? 'animate-pulse' : ''}`} />
                  : <VolumeX className="w-4 h-4" />}
                <span>{voiceEnabled ? 'Voice on' : 'Voice off'}</span>
              </button>
            )}
            {!isEmpty && (
              <button onClick={clearChat} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                <Trash2 className="w-4 h-4" />Clear
              </button>
            )}
          </div>
        </div>

        {/* Context bar */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {/* Course picker */}
          <div className="relative">
            <button
              onClick={() => setShowCourseMenu(v => !v)}
              className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 hover:border-blue-400 transition-colors shadow-sm"
            >
              <BookOpen className="w-4 h-4 text-blue-500" />
              <span className="max-w-[160px] truncate">{selectedCourseObj ? selectedCourseObj.course_code : 'Select course'}</span>
              <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
            </button>
            {showCourseMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowCourseMenu(false)} />
                <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-lg z-20 max-h-64 overflow-y-auto">
                  <button onClick={() => { setSelectedCourse(''); setShowCourseMenu(false); }} className="w-full text-left px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-50 border-b border-gray-100">
                    No specific course
                  </button>
                  {[100, 200, 300, 400].map(level => {
                    const lc = courses.filter(c => c.level === level);
                    if (!lc.length) return null;
                    return (
                      <div key={level}>
                        <p className="px-4 py-1.5 text-xs font-semibold text-gray-400 uppercase bg-gray-50">Level {level}</p>
                        {lc.map(c => (
                          <button key={c.id} onClick={() => { setSelectedCourse(c.id); setShowCourseMenu(false); }}
                            className={`w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 transition-colors ${selectedCourse === c.id ? 'text-blue-600 font-medium bg-blue-50' : 'text-gray-700'}`}>
                            <span className="font-medium">{c.course_code}</span>
                            <span className="text-gray-500 ml-1.5 text-xs">{c.course_name}</span>
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
            placeholder="Topic (e.g. Binary Trees, TCP/IP...)"
            value={topic}
            onChange={e => setTopic(e.target.value)}
            className="flex-1 min-w-[160px] px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
          />

          {/* Upload doc button */}
          {limitReached ? (
            <button
              onClick={() => setShowTutorPricing(true)}
              className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700 hover:bg-amber-100 transition-colors shadow-sm whitespace-nowrap"
              title="Upload limit reached — get more credits"
            >
              <Lock className="w-4 h-4" />
              <span>Get more uploads</span>
            </button>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              title="Upload PDF, Word, or PowerPoint to get a full AI lesson"
              className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 hover:border-blue-400 hover:text-blue-600 transition-colors shadow-sm disabled:opacity-50 whitespace-nowrap"
            >
              {isProcessing
                ? <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                : <Paperclip className="w-4 h-4" />}
              <span>
                {docStage === 'uploading' ? 'Reading…' : docStage === 'generating' ? 'Building lesson…' : 'Upload Doc'}
              </span>
              {uploadChecked && (
                <span className={`text-xs font-medium tabular-nums ${
                  uploadRemaining <= 2 ? 'text-amber-500' : 'text-gray-400'
                }`}>
                  {uploadRemaining} left
                </span>
              )}
            </button>
          )}
        </div>

        {/* Upload error */}
        {docError && (
          <p className="mt-2 text-xs text-red-600 flex items-center gap-1">
            <X className="w-3 h-3" />{docError}
          </p>
        )}
      </div>

      {/* ── Lesson Panel ── */}
      {docStage !== 'idle' && (
        <div className="flex-shrink-0 mb-3 rounded-2xl border border-blue-200 bg-white overflow-hidden shadow-sm">

          {/* Panel header */}
          <div className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
            <FileText className="w-4 h-4 flex-shrink-0" />
            <span className="text-sm font-semibold flex-1 truncate">{lessonFileName}</span>

            {docStage === 'generating' && (
              <span className="flex items-center gap-1.5 text-blue-200 text-xs">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />Building your lesson…
              </span>
            )}
            {docStage === 'ready' && fetchingImages && (
              <span className="flex items-center gap-1 text-blue-200 text-xs">
                <Loader2 className="w-3 h-3 animate-spin" />Finding images…
              </span>
            )}

            {docStage === 'ready' && voiceSupported && (
              teaching ? (
                <button onClick={stopTeaching} className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors">
                  <StopCircle className="w-3.5 h-3.5" />Stop
                </button>
              ) : (
                <button onClick={startTeaching} className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors">
                  <Play className="w-3.5 h-3.5" />Teach Me
                </button>
              )
            )}

            <button onClick={dismissLesson} className="p-1 hover:bg-white/20 rounded-lg transition-colors ml-1">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Section tabs */}
          {docStage === 'ready' && lessonSections.length > 0 && (
            <div className="flex gap-1 px-3 py-2 overflow-x-auto border-b border-gray-100 bg-gray-50">
              {lessonSections.map((s, i) => (
                <button
                  key={i}
                  onClick={() => jumpToSection(i)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs whitespace-nowrap transition-colors ${
                    i === teachIdx
                      ? 'bg-blue-600 text-white font-semibold'
                      : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600'
                  }`}
                >
                  <span>{sectionIcon(s.title)}</span>
                  <span>{s.title}</span>
                </button>
              ))}
            </div>
          )}

          {/* Section content */}
          <div className="max-h-64 overflow-y-auto p-4">
            {/* Still generating — show streaming text */}
            {docStage === 'generating' && (
              lessonText
                ? <div className="text-sm text-gray-700 leading-relaxed" dangerouslySetInnerHTML={{ __html: mdToHtml(lessonText) }} />
                : <p className="text-sm text-blue-500 italic flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" />Generating your lesson…</p>
            )}

            {/* Ready — show current section */}
            {docStage === 'ready' && lessonSections[teachIdx] && (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">{sectionIcon(lessonSections[teachIdx].title)}</span>
                  <h3 className="font-semibold text-gray-900">{lessonSections[teachIdx].title}</h3>
                  {teaching && isSpeaking && (
                    <span className="ml-auto flex gap-1">
                      {[0, 1, 2].map(i => (
                        <span key={i} className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
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
                          isActive ? 'ring-2 ring-blue-400 bg-blue-50 px-3 py-2'
                            : isPast ? 'opacity-40 px-1' : 'px-1'
                        }`}>
                          {isActive && isSpeaking && speakingText
                            ? <SpeechHighlight text={speakingText} charIndex={charIndex} className="leading-7" />
                            : <div className="text-sm text-gray-800 leading-relaxed" dangerouslySetInnerHTML={{ __html: mdToHtml(para) }} />
                          }
                        </div>
                      );
                    })}
                  </div>
                ) : lessonSections[teachIdx].title.toLowerCase() === 'practice review' ? (
                  <PracticeReviewPanel content={lessonSections[teachIdx].content} />
                ) : (
                  <div className="text-sm text-gray-800 leading-relaxed" dangerouslySetInnerHTML={{ __html: mdToHtml(lessonSections[teachIdx].content) }} />
                )}
              </>
            )}
          </div>

          {/* Keyword image panel — appears when AI speaks a visual term */}
          {currentImage && (
            <div className="flex-shrink-0 border-t border-indigo-100 bg-gradient-to-r from-indigo-50 to-blue-50 px-4 py-3 flex items-center gap-4"
              key={currentImage.keyword}>
              <img
                src={currentImage.url}
                alt={currentImage.caption}
                className="w-28 h-20 object-contain rounded-xl bg-white border border-indigo-100 shadow-sm flex-shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold text-indigo-700 uppercase tracking-wider">{currentImage.keyword}</span>
                  <span className="text-[10px] bg-indigo-100 text-indigo-500 px-1.5 py-0.5 rounded-full font-medium">visual</span>
                </div>
                <p className="text-xs text-gray-500 leading-snug line-clamp-2">{currentImage.caption}</p>
              </div>
            </div>
          )}

          {/* Progress + navigation */}
          {docStage === 'ready' && lessonSections.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 border-t border-gray-100 bg-gray-50">
              <button
                onClick={() => jumpToSection(Math.max(0, teachIdx - 1))}
                disabled={teachIdx === 0}
                className="p-1 rounded-lg hover:bg-gray-200 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="w-4 h-4 text-gray-600" />
              </button>
              <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                <div
                  className="bg-blue-600 h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${((teachIdx + 1) / lessonSections.length) * 100}%` }}
                />
              </div>
              <span className="text-xs text-gray-500 tabular-nums">{teachIdx + 1} / {lessonSections.length}</span>
              <button
                onClick={() => jumpToSection(Math.min(lessonSections.length - 1, teachIdx + 1))}
                disabled={teachIdx === lessonSections.length - 1}
                className="p-1 rounded-lg hover:bg-gray-200 disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="w-4 h-4 text-gray-600" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Chat area ── */}
      <div className="flex-1 overflow-y-auto rounded-2xl border border-gray-200 bg-gray-50 relative">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full px-6 text-center gap-6">
            <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center">
              <BotMessageSquare className="w-9 h-9 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Ready to help you learn</h2>
              <p className="text-gray-500 text-sm max-w-sm">
                Ask me anything, or upload a <strong>PDF, Word, or PowerPoint</strong> file to instantly generate a full beginner lesson with voice reading.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center max-w-md">
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => sendMessage(s)}
                  className="px-3 py-1.5 bg-white border border-gray-200 rounded-full text-sm text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors shadow-sm">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <BotMessageSquare className="w-5 h-5 text-white" />
                  </div>
                )}
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white rounded-tr-sm'
                    : 'bg-white border border-gray-200 rounded-tl-sm shadow-sm'
                }`}>
                  {msg.role === 'user' ? (
                    <p className="text-sm leading-relaxed">{msg.content}</p>
                  ) : msg.content === '' ? (
                    <div className="flex items-center gap-2 py-1">
                      <div className="flex gap-1">
                        {[0, 1, 2].map(n => (
                          <span key={n} className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: `${n * 150}ms` }} />
                        ))}
                      </div>
                      <span className="text-xs text-gray-400">Thinking...</span>
                    </div>
                  ) : (
                    isSpeaking && voiceEnabled && i === messages.length - 1 && speakingText
                      ? <SpeechHighlight text={speakingText} charIndex={charIndex} />
                      : <MessageContent content={msg.content} />
                  )}
                </div>
                {msg.role === 'user' && (
                  <div className="w-8 h-8 rounded-xl bg-gray-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <User className="w-4 h-4 text-gray-600" />
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ── Input area ── */}
      <div className="flex-shrink-0 pt-3">
        <div className="flex gap-2 bg-white border border-gray-200 rounded-2xl p-2 shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
            placeholder={docStage === 'ready' ? `Ask anything about "${lessonFileName}"…` : 'Ask anything… (Enter to send, Shift+Enter for new line)'}
            className="flex-1 resize-none text-sm text-gray-800 placeholder-gray-400 outline-none bg-transparent px-2 py-1.5 max-h-32 overflow-y-auto"
            style={{ height: 'auto', minHeight: '38px' }}
            onInput={e => {
              const t = e.currentTarget;
              t.style.height = 'auto';
              t.style.height = Math.min(t.scrollHeight, 128) + 'px';
            }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={isStreaming || !input.trim()}
            className="w-9 h-9 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center flex-shrink-0 transition-colors"
          >
            {isStreaming ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Send className="w-4 h-4 text-white" />}
          </button>
        </div>
        <p className="text-center text-xs text-gray-400 mt-2">
          AI can make mistakes — always verify with your course materials.
        </p>
      </div>
    </div>
  );
}
