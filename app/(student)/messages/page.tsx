'use client';

import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/components/providers';
import { createClient } from '@/lib/supabase/client';
import { Card, Button } from '@/components/ui';
import { MessageSquare, Send, Loader2 } from 'lucide-react';
import type { AdminMessage } from '@/types';

export default function MessagesPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    const supabase = createClient();

    const load = async () => {
      const { data } = await supabase
        .from('admin_messages')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });
      setMessages(data ?? []);
      setLoading(false);

      // Mark the team's messages read now that the student is looking.
      await supabase
        .from('admin_messages')
        .update({ is_read: true })
        .eq('user_id', user.id)
        .neq('sender_id', user.id)
        .eq('is_read', false);
    };
    load();
  }, [user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!user || !text.trim()) return;
    setSending(true);
    setError('');
    const supabase = createClient();
    const { data, error: insertError } = await supabase
      .from('admin_messages')
      .insert({ user_id: user.id, sender_id: user.id, body: text.trim() })
      .select()
      .single();

    if (insertError) {
      setError(insertError.message);
    } else {
      setMessages(prev => [...prev, data]);
      setText('');
    }
    setSending(false);
  };

  return (
    <div className="space-y-5 sm:space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">Messages</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
          Direct messages from the PastCS team, and your replies.
        </p>
      </div>

      <Card>
        <div className="flex flex-col h-[60vh]">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {loading ? (
              <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 dark:text-gray-500 gap-2">
                <MessageSquare className="w-8 h-8" />
                <p className="text-sm">No messages yet. The PastCS team will reach out here if they need to.</p>
              </div>
            ) : (
              messages.map(m => {
                const fromMe = m.sender_id === user?.id;
                return (
                  <div key={m.id} className={`flex ${fromMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] sm:max-w-[65%] rounded-2xl px-4 py-2.5 text-sm ${
                      fromMe
                        ? 'bg-[#e8603c] text-white'
                        : 'bg-gray-100 dark:bg-white/10 text-gray-800 dark:text-gray-200'
                    }`}>
                      {!fromMe && (
                        <p className="text-[10px] font-semibold uppercase tracking-wide mb-1 text-[#e8603c] dark:text-[#f0906f]">
                          PastCS Team
                        </p>
                      )}
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p className={`text-[10px] mt-1 ${fromMe ? 'text-white/70' : 'text-gray-400 dark:text-gray-500'}`}>
                        {new Date(m.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-gray-100 dark:border-white/10 p-3">
            {error && <p className="text-xs text-red-500 dark:text-red-400 mb-2">{error}</p>}
            <div className="flex items-end gap-2">
              <textarea
                value={text}
                onChange={e => { setText(e.target.value); setError(''); }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                rows={1}
                maxLength={500}
                placeholder="Type a message…"
                className="flex-1 min-w-0 resize-none border border-gray-300 dark:border-white/15 dark:bg-white/5 dark:text-gray-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#e8603c]"
              />
              <Button onClick={handleSend} disabled={sending || !text.trim()} className="flex-shrink-0">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
