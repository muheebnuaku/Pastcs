'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Avatar } from '@/components/ui';
import type { ClassroomMemberProgress } from '@/lib/classrooms';
import { Send, Video, Trash2, Loader2, Paperclip, PhoneCall, PhoneOff } from 'lucide-react';

export interface ChatMessage {
  id: string;
  classroom_id: string;
  user_id: string;
  kind: 'text' | 'call' | 'call_end' | 'resource';
  body: string;
  meta: { url?: string; resource_id?: string } | null;
  created_at: string;
}

interface Props {
  classroomId: string;
  myId: string;
  myName: string;
  members: ClassroomMemberProgress[];
  canModerate: boolean;
  callUrl: string;
  onOpenResources: () => void;
}

// The video room opens in a new tab (meet.jit.si cuts embedded calls off
// after a few minutes), so the site can't see anyone hang up. A call stays
// "live" here until its starter or a class leader ends it, or this long.
const CALL_FRESH_MS = 2 * 60 * 60 * 1000;

// Plain text with web links made clickable — never rendered as HTML.
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part)
          ? <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow" className="underline break-all">{part}</a>
          : <Fragment key={i}>{part}</Fragment>
      )}
    </>
  );
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === today.toDateString() ? time : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
}

export function ChatPanel({ classroomId, myId, myName, members, canModerate, callUrl, onOpenResources }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  // Set when I start a call; coming back to this tab afterwards asks
  // whether the call is over, so it ends on the site too.
  const startedCallRef = useRef(false);
  const [askEnd, setAskEnd] = useState(false);

  const people = useMemo(() => new Map(members.map(m => [m.user_id, m])), [members]);

  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages(prev => (prev.some(m => m.id === msg.id) ? prev : [...prev, msg]));
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    supabase
      .from('classroom_messages')
      .select('*')
      .eq('classroom_id', classroomId)
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data }: { data: ChatMessage[] | null }) => {
        if (cancelled) return;
        setMessages((data ?? []).slice().reverse());
        setLoading(false);
      });

    // Live: new messages from classmates appear without refreshing.
    const channel = supabase
      .channel(`classroom-chat-${classroomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'classroom_messages', filter: `classroom_id=eq.${classroomId}` },
        (payload: { new: ChatMessage }) => addMessage(payload.new))
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [classroomId, addMessage]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages.length]);

  // Keeps "call in progress" fresh without a reload.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(t);
  }, []);

  const post = async (body: string, kind: ChatMessage['kind'] = 'text', meta: ChatMessage['meta'] = {}) => {
    setSending(true);
    setError('');
    const { data, error: err } = await createClient()
      .from('classroom_messages')
      .insert({ classroom_id: classroomId, user_id: myId, kind, body, meta })
      .select()
      .single();
    setSending(false);
    if (err || !data) {
      setError(err?.message?.includes('slow_down')
        ? "You're sending messages too fast. Wait a moment and try again."
        : 'Message not sent. Check your connection and try again.');
      return false;
    }
    addMessage(data as ChatMessage);
    return true;
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    if (await post(body.slice(0, 2000))) setText('');
  };

  const startCall = async () => {
    window.open(callUrl, '_blank', 'noopener,noreferrer');
    if (await post(`${myName} started a video call`, 'call', { url: callUrl })) startedCallRef.current = true;
  };

  const endCall = async () => {
    setAskEnd(false);
    startedCallRef.current = false;
    await post(`${myName} ended the call`, 'call_end');
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this message?')) return;
    const { error: err } = await createClient().from('classroom_messages').delete().eq('id', id);
    if (!err) setMessages(prev => prev.filter(m => m.id !== id));
  };

  const lastCallEvent = [...messages].reverse().find(m => m.kind === 'call' || m.kind === 'call_end');
  const lastCall = lastCallEvent?.kind === 'call' ? lastCallEvent : undefined;
  const callLive = !!lastCall && now - new Date(lastCall.created_at).getTime() < CALL_FRESH_MS;
  const canEndCall = callLive && (lastCall?.user_id === myId || canModerate);
  const callStarter = lastCall ? (lastCall.user_id === myId ? 'You' : people.get(lastCall.user_id)?.full_name?.split(' ')[0] || 'A classmate') : '';

  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState === 'visible' && startedCallRef.current) setAskEnd(true);
    };
    document.addEventListener('visibilitychange', onReturn);
    return () => document.removeEventListener('visibilitychange', onReturn);
  }, []);

  return (
    <div className="flex flex-col h-[62vh] min-h-[380px] rounded-2xl border border-gray-200 bg-white overflow-hidden dark:bg-white/[0.04] dark:border-white/10">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 dark:border-white/10">
        <p className="flex-1 text-sm font-semibold text-gray-900 dark:text-gray-100">Class chat</p>
        <button
          onClick={onOpenResources}
          className="flex items-center gap-1.5 text-xs font-medium text-gray-600 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10"
        >
          <Paperclip className="w-3.5 h-3.5" />Resources
        </button>
        {!callLive && (
          <button
            onClick={startCall}
            disabled={sending}
            className="flex items-center gap-1.5 text-xs font-semibold text-white bg-green-600 hover:bg-green-700 disabled:opacity-60 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Video className="w-3.5 h-3.5" />Start call
          </button>
        )}
      </div>

      {callLive && lastCall && (
        <div className="border-b border-green-100 bg-green-50 dark:bg-green-500/10 dark:border-green-500/20">
          <div className="flex items-center gap-2 px-3 py-2 text-sm text-green-800 dark:text-green-300">
            <PhoneCall className="w-4 h-4 flex-shrink-0 animate-pulse" />
            <span className="flex-1 min-w-0 truncate">
              <span className="font-semibold">Call in progress</span>
              <span className="hidden sm:inline"> · {callStarter} started it {timeLabel(lastCall.created_at)}</span>
            </span>
            {lastCall.meta?.url && (
              <a
                href={lastCall.meta.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 text-xs font-semibold text-white bg-green-600 hover:bg-green-700 px-3 py-1.5 rounded-lg"
              >
                Join
              </a>
            )}
            {canEndCall && (
              <button
                onClick={endCall}
                disabled={sending}
                className="flex-shrink-0 flex items-center gap-1 text-xs font-semibold text-red-700 bg-white border border-red-200 hover:bg-red-50 px-2.5 py-1.5 rounded-lg dark:bg-transparent dark:text-red-300 dark:border-red-500/40 dark:hover:bg-red-500/10"
              >
                <PhoneOff className="w-3.5 h-3.5" />End
              </button>
            )}
          </div>
          {askEnd && canEndCall && (
            <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5 text-sm text-gray-700 dark:text-gray-300">
              <span className="flex-1 min-w-[10rem]">Finished the call? End it so classmates don&rsquo;t join an empty room.</span>
              <button onClick={endCall} className="text-xs font-semibold text-white bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded-lg">End for everyone</button>
              <button onClick={() => setAskEnd(false)} className="text-xs font-medium text-gray-600 px-2.5 py-1.5 rounded-lg hover:bg-white/70 dark:text-gray-300 dark:hover:bg-white/10">Still on it</button>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-500 dark:text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading chat…</div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <p className="font-semibold text-gray-900 dark:text-gray-100">Say hello to your class</p>
            <p className="text-sm text-gray-500 mt-1 dark:text-gray-400">Ask a question, share a tip, or start a call to revise together.</p>
          </div>
        ) : messages.map((m, i) => {
          const mine = m.user_id === myId;
          const person = people.get(m.user_id);
          const name = person?.full_name || 'Former member';
          const showName = !mine && (i === 0 || messages[i - 1].user_id !== m.user_id || messages[i - 1].kind !== 'text');
          const canDelete = mine || canModerate;

          if (m.kind === 'call' || m.kind === 'call_end' || m.kind === 'resource') {
            const isLiveCall = m.id === lastCall?.id && callLive;
            return (
              <div key={m.id} className="flex justify-center">
                <div className="flex items-center gap-2 max-w-full text-xs text-gray-600 bg-gray-100 rounded-full px-3 py-1.5 dark:text-gray-300 dark:bg-white/10">
                  {m.kind === 'call' ? <Video className="w-3.5 h-3.5 flex-shrink-0 text-green-600" />
                    : m.kind === 'call_end' ? <PhoneOff className="w-3.5 h-3.5 flex-shrink-0 text-gray-500 dark:text-gray-400" />
                    : <Paperclip className="w-3.5 h-3.5 flex-shrink-0 text-blue-600" />}
                  <span className="min-w-0 truncate">{m.body}</span>
                  <span className="text-[10px] text-gray-400 flex-shrink-0 dark:text-gray-500">{timeLabel(m.created_at)}</span>
                  {isLiveCall && m.meta?.url && (
                    <a href={m.meta.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-green-700 dark:text-green-400">Join</a>
                  )}
                  {m.kind === 'resource' && (
                    <button onClick={onOpenResources} className="font-semibold text-blue-700 dark:text-blue-400">Open</button>
                  )}
                </div>
              </div>
            );
          }

          return (
            <div key={m.id} className={`flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'}`}>
              {!mine && (
                <div className="w-7 flex-shrink-0">{showName && <Avatar src={person?.avatar_url} name={name} size="sm" />}</div>
              )}
              <div className={`group max-w-[78%] min-w-0 ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                {showName && <p className="text-[11px] font-semibold text-gray-500 mb-0.5 ml-1 dark:text-gray-400">{name}</p>}
                <div className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap [overflow-wrap:anywhere] ${
                  mine ? 'bg-blue-600 text-white rounded-br-md' : 'bg-gray-100 text-gray-900 rounded-bl-md dark:bg-white/10 dark:text-gray-100'
                }`}>
                  <Linkified text={m.body} />
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 mx-1">
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">{timeLabel(m.created_at)}</span>
                  {canDelete && (
                    <button onClick={() => remove(m.id)} aria-label="Delete message" className="text-gray-300 hover:text-red-500 dark:text-gray-600">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {error && <p className="px-3 pb-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex items-end gap-2 p-2 border-t border-gray-100 dark:border-white/10">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1}
          maxLength={2000}
          placeholder="Message your class…"
          className="flex-1 resize-none max-h-28 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-white/5 dark:border-white/10 dark:text-gray-100"
        />
        <button
          onClick={send}
          disabled={!text.trim() || sending}
          aria-label="Send"
          className="w-10 h-10 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white flex items-center justify-center flex-shrink-0"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
