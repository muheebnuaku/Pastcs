'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Avatar } from '@/components/ui';
import { useClassroomUnreadStore } from '@/lib/store';
import { requestClassroomPush } from '@/lib/push';
import type { ClassroomMemberProgress } from '@/lib/classrooms';
import { hasJoinedCall, left, rememberJoinedCall, type ClassroomLimits } from '@/lib/classroomLimits';
import { LimitReached, type LimitKind } from './FreeLimits';
import { Send, Video, Trash2, Loader2, Paperclip, PhoneCall, PhoneOff, AtSign, Swords } from 'lucide-react';

export interface ChatMessage {
  id: string;
  classroom_id: string;
  user_id: string;
  kind: 'text' | 'call' | 'call_end' | 'resource' | 'battle';
  body: string;
  meta: { url?: string; resource_id?: string; mentions?: string[]; battle_id?: string } | null;
  created_at: string;
}

interface Props {
  classroomId: string;
  myId: string;
  myName: string;
  members: ClassroomMemberProgress[];
  canModerate: boolean;
  /** Shown in the video call. */
  displayName: string;
  /** Free-access allowances (migration 039); null means none apply. */
  limits: ClassroomLimits | null;
  level?: number;
  onLimit: (kind: LimitKind) => void;
  onUsed: () => void;
  onOpenResources: () => void;
}

// The video room opens in a new tab (meet.jit.si cuts embedded calls off
// after a few minutes), so the site can't see anyone hang up. A call stays
// "live" here until its starter or a class leader ends it, or this long.
const CALL_FRESH_MS = 2 * 60 * 60 * 1000;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Plain text with web links made clickable and @mentions in bold — never
// rendered as HTML.
function Linkified({ text, mentions = [] }: { text: string; mentions?: string[] }) {
  const parts = text.split(/(https?:\/\/[^\s<]+)/g);
  const mentionRe = mentions.length ? new RegExp(`(${mentions.map(n => `@${escapeRegExp(n)}`).join('|')})`, 'g') : null;
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part)
          ? <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow" className="underline break-all">{part}</a>
          : mentionRe
            ? <Fragment key={i}>{part.split(mentionRe).map((bit, j) => (j % 2 === 1 ? <strong key={j} className="font-semibold">{bit}</strong> : bit))}</Fragment>
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

export function ChatPanel({ classroomId, myId, myName, members, canModerate, displayName, limits, level, onLimit, onUsed, onOpenResources }: Props) {
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
  const clearUnread = useClassroomUnreadStore(s => s.clear);
  // @mentions: what's typed after "@", and the names picked from the list
  // (name → user id) so the message can say who to alert.
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const pickedRef = useRef(new Map<string, string>());

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

  // Reading the chat clears its unread badge: on open, on each new message
  // from a classmate, and on coming back to the tab.
  const lastFromOthers = [...messages].reverse().find(m => m.user_id !== myId)?.id;
  useEffect(() => {
    if (loading) return;
    const markRead = () => {
      if (document.visibilityState !== 'visible') return;
      clearUnread(classroomId);
      createClient().rpc('mark_classroom_read', { p_classroom: classroomId }).then(() => {}, () => {});
    };
    markRead();
    document.addEventListener('visibilitychange', markRead);
    return () => document.removeEventListener('visibilitychange', markRead);
  }, [loading, lastFromOthers, classroomId, clearUnread]);

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
      if (err?.message?.includes('free_limit_messages')) { onUsed(); onLimit('messages'); return null; }
      setError(err?.message?.includes('slow_down')
        ? "You're sending messages too fast. Wait a moment and try again."
        : 'Message not sent. Check your connection and try again.');
      return null;
    }
    addMessage(data as ChatMessage);
    return data as ChatMessage;
  };

  const send = async () => {
    const body = text.trim().slice(0, 2000);
    if (!body || sending) return;
    const mentions = [...pickedRef.current].filter(([name]) => body.includes(`@${name}`)).map(([, id]) => id);
    const msg = await post(body, 'text', mentions.length ? { mentions } : {});
    if (!msg) return;
    if (limits?.free) onUsed();
    setText('');
    setMentionQuery(null);
    pickedRef.current.clear();
    // The database keeps only real classmates; push goes to those.
    if (msg.meta?.mentions?.length) requestClassroomPush(msg.id);
  };

  // Start a call, or join the one in progress. The room link only comes
  // from the server, which counts the join for students on a free course.
  const openCall = async (start: boolean) => {
    const wasLive = callLive && !!lastCall;
    const rejoining = wasLive && hasJoinedCall(classroomId, lastCall!.id);
    if (limits?.free && left(limits.calls) <= 0 && !rejoining) { onLimit('calls'); return; }
    // Opened during the tap, so pop-up blockers allow it; pointed at the
    // room once the server answers.
    const tab = window.open('', '_blank');
    setSending(true);
    setError('');
    const { data, error: err } = await createClient().rpc('join_classroom_call', { p_classroom: classroomId, p_start: start });
    setSending(false);
    if (err || !data) {
      tab?.close();
      if (err?.message?.includes('free_limit_calls')) { onUsed(); onLimit('calls'); return; }
      setError(err?.message?.includes('no_call') ? 'That call has ended.' : "Couldn't open the call. Check your connection and try again.");
      return;
    }
    const { url, message_id } = data as { url: string; message_id: string };
    const roomUrl = `${url}#userInfo.displayName=${encodeURIComponent(JSON.stringify(displayName))}`;
    if (tab) { tab.opener = null; tab.location.href = roomUrl; } else window.open(roomUrl, '_blank', 'noopener,noreferrer');
    rememberJoinedCall(classroomId, message_id);
    if (limits?.free) onUsed();
    if (start && !wasLive) {
      startedCallRef.current = true;
      requestClassroomPush(message_id);
      const { data: row } = await createClient().from('classroom_messages').select('*').eq('id', message_id).maybeSingle();
      if (row) addMessage(row as ChatMessage);
    }
  };

  const suggestions = mentionQuery === null ? [] : members
    .filter(m => !m.is_me && m.full_name && (
      m.full_name.toLowerCase().startsWith(mentionQuery)
      || m.full_name.toLowerCase().split(/\s+/).some(w => w.startsWith(mentionQuery))
    ))
    .slice(0, 5);

  const onType = (value: string, caret: number) => {
    setText(value);
    const typed = value.slice(0, caret).match(/(?:^|\s)@([^\s@]{0,20})$/);
    setMentionQuery(typed ? typed[1].toLowerCase() : null);
  };

  const pickMention = (m: ClassroomMemberProgress) => {
    const el = inputRef.current;
    const name = (m.full_name ?? '').trim();
    if (!el || !name) return;
    const caret = el.selectionStart ?? text.length;
    const start = text.slice(0, caret).lastIndexOf('@');
    if (start < 0) return;
    const next = `${text.slice(0, start)}@${name} ${text.slice(caret)}`;
    pickedRef.current.set(name, m.user_id);
    setText(next);
    setMentionQuery(null);
    const at = start + name.length + 2;
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(at, at); });
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
            onClick={() => openCall(true)}
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
              {limits?.free && limits.calls && (
                <span className="block text-xs font-normal">{left(limits.calls)} of {limits.calls.limit} free call joins left</span>
              )}
            </span>
            <button
              onClick={() => openCall(false)}
              disabled={sending}
              className="flex-shrink-0 text-xs font-semibold text-white bg-green-600 hover:bg-green-700 disabled:opacity-60 px-3 py-1.5 rounded-lg"
            >
              Join
            </button>
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
          const mentionNames = (m.meta?.mentions ?? []).map(id => people.get(id)?.full_name?.trim()).filter((n): n is string => !!n);
          const mentionsMe = !mine && !!m.meta?.mentions?.includes(myId);

          if (m.kind === 'call' || m.kind === 'call_end' || m.kind === 'resource' || m.kind === 'battle') {
            const isLiveCall = m.id === lastCall?.id && callLive;
            return (
              <div key={m.id} className="flex justify-center">
                <div className="flex items-center gap-2 max-w-full text-xs text-gray-600 bg-gray-100 rounded-full px-3 py-1.5 dark:text-gray-300 dark:bg-white/10">
                  {m.kind === 'call' ? <Video className="w-3.5 h-3.5 flex-shrink-0 text-green-600" />
                    : m.kind === 'call_end' ? <PhoneOff className="w-3.5 h-3.5 flex-shrink-0 text-gray-500 dark:text-gray-400" />
                    : m.kind === 'battle' ? <Swords className="w-3.5 h-3.5 flex-shrink-0 text-purple-600 dark:text-purple-400" />
                    : <Paperclip className="w-3.5 h-3.5 flex-shrink-0 text-blue-600" />}
                  <span className="min-w-0 truncate">{m.body}</span>
                  <span className="text-[10px] text-gray-400 flex-shrink-0 dark:text-gray-500">{timeLabel(m.created_at)}</span>
                  {isLiveCall && (
                    <button onClick={() => openCall(false)} disabled={sending} className="font-semibold text-green-700 dark:text-green-400">Join</button>
                  )}
                  {m.kind === 'battle' && m.meta?.battle_id && (
                    <Link href={`/classrooms/${classroomId}/battles/${m.meta.battle_id}`} className="font-semibold text-purple-700 dark:text-purple-400">Open</Link>
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
                }${mentionsMe ? ' ring-2 ring-amber-400 dark:ring-amber-500/70' : ''}`}>
                  <Linkified text={m.body} mentions={mentionNames} />
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
      {suggestions.length > 0 && (
        <div className="border-t border-gray-100 py-1 dark:border-white/10" role="listbox" aria-label="Mention a classmate">
          {suggestions.map((m, i) => (
            <button
              key={m.user_id}
              role="option"
              aria-selected={i === 0}
              onMouseDown={e => e.preventDefault()}
              onClick={() => pickMention(m)}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-sm hover:bg-gray-50 dark:hover:bg-white/5 ${i === 0 ? 'bg-gray-50 dark:bg-white/5' : ''}`}
            >
              <Avatar src={m.avatar_url} name={m.full_name || 'Classmate'} size="sm" />
              <span className="min-w-0 flex-1 truncate text-gray-900 dark:text-gray-100">{m.full_name}</span>
              <AtSign className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 dark:text-gray-500" />
            </button>
          ))}
        </div>
      )}
      {limits?.free && limits.messages && left(limits.messages) <= 0 ? (
        <div className="p-2 border-t border-gray-100 dark:border-white/10">
          <LimitReached kind="messages" level={level} onUnlock={() => onLimit('messages')} />
        </div>
      ) : (<>
      {limits?.free && limits.messages && (
        <p className="px-3 pt-1.5 text-[11px] text-gray-500 border-t border-gray-100 dark:text-gray-400 dark:border-white/10">
          {left(limits.messages)} of {limits.messages.limit} free messages left in this class
        </p>
      )}
      <div className={`flex items-end gap-2 p-2 ${limits?.free ? '' : 'border-t border-gray-100 dark:border-white/10'}`}>
        <textarea
          ref={inputRef}
          value={text}
          onChange={e => onType(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onKeyDown={e => {
            if (suggestions.length > 0 && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pickMention(suggestions[0]); return; }
            if (e.key === 'Escape') { setMentionQuery(null); return; }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          rows={1}
          maxLength={2000}
          placeholder="Message your class… (@ to mention)"
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
      </>)}
    </div>
  );
}
