'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers';
import { createClient } from '@/lib/supabase/client';
import { Card, Badge } from '@/components/ui';
import { ScrollText, Loader2, RefreshCw } from 'lucide-react';

interface ActorInfo { full_name: string | null; email: string; }
interface AuditRow {
  id: string;
  actor_id: string | null;
  action: string;
  target: string;
  metadata: Record<string, unknown>;
  created_at: string;
  actor?: ActorInfo | null;
}

// Coarse category per action prefix — just enough to color-code the feed.
function actionVariant(action: string): 'danger' | 'warning' | 'info' | 'default' {
  if (action.includes('delete')) return 'danger';
  if (action.includes('revoke')) return 'warning';
  if (action.includes('grant') || action.includes('update')) return 'info';
  return 'default';
}

export default function AdminAuditLogPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Same independent guard pattern as Tracker — the nav link is already
  // hidden from regular admins, but a direct URL visit must still be
  // turned away before any audit data loads.
  useEffect(() => {
    if (!authLoading && user && user.role !== 'super_admin') {
      router.replace('/admin');
    }
  }, [user, authLoading, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const supabase = createClient();

    const { data, error: fetchError } = await supabase
      .from('admin_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    const entries = (data ?? []) as AuditRow[];
    const actorIds = [...new Set(entries.map(r => r.actor_id).filter(Boolean))] as string[];
    let actorMap: Record<string, ActorInfo> = {};

    if (actorIds.length > 0) {
      const { data: uData } = await supabase
        .from('users')
        .select('id, full_name, email')
        .in('id', actorIds);
      actorMap = Object.fromEntries((uData ?? []).map((u: ActorInfo & { id: string }) => [u.id, u]));
    }

    setRows(entries.map(r => ({ ...r, actor: r.actor_id ? actorMap[r.actor_id] ?? null : null })));
    setLoading(false);
  }, []);

  useEffect(() => {
    if (user?.role === 'super_admin') load();
  }, [user?.role, load]);

  if (user && user.role !== 'super_admin') return null;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 dark:text-gray-100">
            <ScrollText className="w-6 h-6 text-amber-500" />
            Audit Log
          </h1>
          <p className="text-gray-500 text-sm mt-0.5 dark:text-gray-400">
            Super admin only — the highest-value admin actions, most recent first.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors self-start sm:self-auto dark:text-gray-400 dark:border-white/10 dark:hover:bg-white/[0.03]"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-gray-400 dark:text-gray-500">
            <ScrollText className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No audited actions yet</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-white/5">
            {rows.map(r => (
              <div key={r.id} className="flex items-start gap-3 px-6 py-3.5">
                <Badge variant={actionVariant(r.action)} size="sm" className="mt-0.5 flex-shrink-0">
                  {r.action}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 dark:text-gray-100 truncate">{r.target}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    {r.actor?.full_name || r.actor?.email || 'Unknown actor'} · {new Date(r.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
