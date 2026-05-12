'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, Avatar } from '@/components/ui';
import { CheckCircle, XCircle, Clock, MessageSquareQuote } from 'lucide-react';

interface TestimonialRow {
  id: string;
  quote: string;
  is_approved: boolean;
  created_at: string;
  user: { full_name: string | null; email: string; avatar_url: string | null; program: string | null } | null;
}

export default function AdminTestimonialsPage() {
  const [rows, setRows] = useState<TestimonialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from('testimonials')
      .select('*, user:users(full_name, email, avatar_url, program)')
      .order('created_at', { ascending: false });
    setRows((data ?? []) as TestimonialRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const approve = async (id: string) => {
    setActing(id);
    const supabase = createClient();
    await supabase.from('testimonials').update({ is_approved: true }).eq('id', id);
    setRows(prev => prev.map(r => r.id === id ? { ...r, is_approved: true } : r));
    setActing(null);
  };

  const reject = async (id: string) => {
    setActing(id);
    const supabase = createClient();
    await supabase.from('testimonials').delete().eq('id', id);
    setRows(prev => prev.filter(r => r.id !== id));
    setActing(null);
  };

  const pending = rows.filter(r => !r.is_approved);
  const approved = rows.filter(r => r.is_approved);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <MessageSquareQuote className="w-6 h-6 text-blue-600" />
          Testimonials
        </h1>
        <p className="text-gray-500 text-sm mt-0.5">
          {pending.length} pending · {approved.length} approved
        </p>
      </div>

      {/* Pending */}
      {pending.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-amber-500" /> Pending Review
          </h2>
          {pending.map(r => (
            <Card key={r.id} className="p-4">
              <div className="flex items-start gap-3">
                <Avatar src={r.user?.avatar_url} name={r.user?.full_name || r.user?.email} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm">{r.user?.full_name || r.user?.email}</p>
                  {r.user?.program && <p className="text-xs text-gray-400">{r.user.program}</p>}
                  <p className="mt-2 text-gray-700 text-sm leading-relaxed">&ldquo;{r.quote}&rdquo;</p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => approve(r.id)}
                    disabled={acting === r.id}
                    className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg disabled:opacity-50 transition-colors"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    Approve
                  </button>
                  <button
                    onClick={() => reject(r.id)}
                    disabled={acting === r.id}
                    className="flex items-center gap-1 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-medium rounded-lg disabled:opacity-50 transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Reject
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Approved */}
      {approved.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
            <CheckCircle className="w-4 h-4 text-green-500" /> Approved & Live
          </h2>
          {approved.map(r => (
            <Card key={r.id} className="p-4 opacity-80">
              <div className="flex items-start gap-3">
                <Avatar src={r.user?.avatar_url} name={r.user?.full_name || r.user?.email} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm">{r.user?.full_name || r.user?.email}</p>
                  {r.user?.program && <p className="text-xs text-gray-400">{r.user.program}</p>}
                  <p className="mt-2 text-gray-600 text-sm leading-relaxed">&ldquo;{r.quote}&rdquo;</p>
                </div>
                <button
                  onClick={() => reject(r.id)}
                  disabled={acting === r.id}
                  className="text-xs text-red-400 hover:text-red-600 font-medium disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <MessageSquareQuote className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No testimonials yet</p>
        </div>
      )}
    </div>
  );
}
