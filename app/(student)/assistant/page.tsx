'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Course } from '@/types';
import {
  BotMessageSquare,
  Send,
  Trash2,
  Loader2,
  BookOpen,
  ChevronDown,
  User,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// ── Simple markdown → HTML renderer ───────────────────────────────────────

function mdToHtml(text: string): string {
  return (
    text
      // Fenced code blocks
      .replace(
        /```(\w*)\n?([\s\S]*?)```/g,
        '<pre class="bg-gray-900 text-green-300 rounded-xl p-4 overflow-x-auto text-sm my-3 font-mono"><code>$2</code></pre>'
      )
      // Inline code
      .replace(/`([^`\n]+)`/g, '<code class="bg-gray-100 text-pink-600 px-1.5 py-0.5 rounded text-sm font-mono">$1</code>')
      // h2
      .replace(/^## (.+)$/gm, '<h2 class="text-base font-bold text-gray-900 mt-4 mb-1.5">$1</h2>')
      // h3
      .replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold text-gray-800 mt-3 mb-1">$1</h3>')
      // Bold
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>')
      // Italic
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      // YouTube links — special styling
      .replace(
        /\[🎬 ([^\]]+)\]\((https:\/\/www\.youtube\.com\/results[^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 mt-1 px-3 py-1.5 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors no-underline">▶ $1</a>'
      )
      // Regular links
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:text-blue-800 underline decoration-blue-300 font-medium break-words">$1</a>'
      )
      // HR
      .replace(/^---$/gm, '<hr class="my-4 border-gray-200" />')
      // Bullet list items
      .replace(/^[*-] (.+)$/gm, '<li class="flex gap-2"><span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0"></span><span>$1</span></li>')
      // Numbered list items
      .replace(/^(\d+)\. (.+)$/gm, '<li class="flex gap-2"><span class="font-semibold text-blue-600 flex-shrink-0">$1.</span><span>$2</span></li>')
      // Wrap consecutive <li> elements
      .replace(/(<li[\s\S]*?<\/li>\n?)+/g, '<ul class="space-y-1.5 my-2">$&</ul>')
      // Newlines → breaks (avoid double-breaking after block elements)
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

// ── Suggestions ────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  'Explain this topic like I\'m a beginner',
  'Give me a practical example',
  'What are common exam questions on this?',
  'How does this compare to similar concepts?',
  'Summarise the key points',
];

// ── Page ───────────────────────────────────────────────────────────────────

export default function AssistantPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState('');
  const [topic, setTopic] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [showCourseMenu, setShowCourseMenu] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load courses
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from('courses')
      .select('*')
      .order('level')
      .then(({ data }: { data: Course[] | null }) => {
        if (data) setCourses(data);
      });
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const selectedCourseObj = courses.find(c => c.id === selectedCourse);

  const getContext = () => {
    const parts: string[] = [];
    if (selectedCourseObj) parts.push(`${selectedCourseObj.course_code} — ${selectedCourseObj.course_name} (Level ${selectedCourseObj.level})`);
    if (topic.trim()) parts.push(`Topic: ${topic.trim()}`);
    return parts.join(', ');
  };

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    const userMsg: Message = { role: 'user', content: trimmed };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput('');
    setIsStreaming(true);

    // Placeholder for streaming response
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    abortRef.current = new AbortController();

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          message: trimmed,
          context: getContext() || undefined,
          history: messages.slice(-10), // last 10 for context window efficiency
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to get response' }));
        throw new Error(err.error);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let full = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setMessages(prev => [
          ...prev.slice(0, -1),
          { role: 'assistant', content: full },
        ]);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const errMsg = err instanceof Error ? err.message : 'Something went wrong';
      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'assistant', content: `Sorry, I encountered an error: ${errMsg}. Please try again.` },
      ]);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const clearChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setIsStreaming(false);
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] lg:h-[calc(100vh-4rem)] max-h-[900px]">
      {/* Header */}
      <div className="flex-shrink-0 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <BotMessageSquare className="w-7 h-7 text-blue-600" />
              AI Study Assistant
            </h1>
            <p className="text-gray-500 text-sm mt-0.5">Ask anything about your courses — I explain, you understand.</p>
          </div>
          {!isEmpty && (
            <button
              onClick={clearChat}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Clear
            </button>
          )}
        </div>

        {/* Context bar */}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          {/* Course picker */}
          <div className="relative">
            <button
              onClick={() => setShowCourseMenu(v => !v)}
              className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 hover:border-blue-400 transition-colors shadow-sm"
            >
              <BookOpen className="w-4 h-4 text-blue-500" />
              <span className="max-w-[160px] truncate">
                {selectedCourseObj ? selectedCourseObj.course_code : 'Select course'}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
            </button>

            {showCourseMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowCourseMenu(false)} />
                <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-lg z-20 max-h-64 overflow-y-auto">
                  <button
                    onClick={() => { setSelectedCourse(''); setShowCourseMenu(false); }}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-50 border-b border-gray-100"
                  >
                    No specific course
                  </button>
                  {[100, 200, 300, 400].map(level => {
                    const levelCourses = courses.filter(c => c.level === level);
                    if (!levelCourses.length) return null;
                    return (
                      <div key={level}>
                        <p className="px-4 py-1.5 text-xs font-semibold text-gray-400 uppercase bg-gray-50">Level {level}</p>
                        {levelCourses.map(c => (
                          <button
                            key={c.id}
                            onClick={() => { setSelectedCourse(c.id); setShowCourseMenu(false); }}
                            className={`w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 transition-colors ${selectedCourse === c.id ? 'text-blue-600 font-medium bg-blue-50' : 'text-gray-700'}`}
                          >
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

          {/* Topic input */}
          <input
            type="text"
            placeholder="Topic (e.g. Binary Trees, TCP/IP...)"
            value={topic}
            onChange={e => setTopic(e.target.value)}
            className="flex-1 min-w-[180px] px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
          />
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto rounded-2xl border border-gray-200 bg-gray-50 relative">
        {isEmpty ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full px-6 text-center gap-6">
            <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center">
              <BotMessageSquare className="w-9 h-9 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Ready to help you learn</h2>
              <p className="text-gray-500 text-sm max-w-sm">
                Select a course and topic above, then ask me anything. I&apos;ll explain it step by step with examples and learning resources.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center max-w-md">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  className="px-3 py-1.5 bg-white border border-gray-200 rounded-full text-sm text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors shadow-sm"
                >
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
                    <BotMessageSquare className="w-4.5 h-4.5 text-white w-5 h-5" />
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
                          <span
                            key={n}
                            className="w-2 h-2 rounded-full bg-blue-400 animate-bounce"
                            style={{ animationDelay: `${n * 150}ms` }}
                          />
                        ))}
                      </div>
                      <span className="text-xs text-gray-400">Thinking...</span>
                    </div>
                  ) : (
                    <MessageContent content={msg.content} />
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

      {/* Input area */}
      <div className="flex-shrink-0 pt-3">
        <div className="flex gap-2 bg-white border border-gray-200 rounded-2xl p-2 shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
            placeholder="Ask anything… (Enter to send, Shift+Enter for new line)"
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
            {isStreaming ? (
              <Loader2 className="w-4 h-4 text-white animate-spin" />
            ) : (
              <Send className="w-4 h-4 text-white" />
            )}
          </button>
        </div>
        <p className="text-center text-xs text-gray-400 mt-2">
          AI can make mistakes — always verify important information with your course materials.
        </p>
      </div>
    </div>
  );
}
