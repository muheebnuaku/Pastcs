'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Avatar } from '@/components/ui';
import {
  USER_FILTERS, dateLabel, roleLabel, timeAgo, type AdminUserRow, type UserFilter,
} from '@/lib/adminUsers';
import type { Program } from '@/types';
import { UserPanel, Chip } from './UserPanel';
import { ChevronLeft, ChevronRight, Download, Loader2, Search, Trash2, X } from 'lucide-react';

// Users, at any size: search, filters and paging run in the database
// (admin_search_users, migration 049), 25 accounts at a time. Tapping an
// account opens everything about it in a side panel.

const PAGE_SIZE = 25;

interface Counts { [filter: string]: number }

function csvEscape(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export default function AdminUsersPage() {
  const [filter, setFilter] = useState<UserFilter>('all');
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Counts>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNote, setBulkNote] = useState('');
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [exporting, setExporting] = useState(false);
  const reqId = useRef(0);

  // Debounce typing into the search.
  useEffect(() => {
    const t = setTimeout(() => { setQ(query.trim()); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const loadCounts = useCallback(async () => {
    const { data } = await createClient().rpc('admin_user_counts');
    if (data) setCounts(data as Counts);
  }, []);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    const { data, error: err } = await createClient().rpc('admin_search_users', {
      p_q: q || null, p_filter: filter, p_limit: PAGE_SIZE, p_offset: page * PAGE_SIZE,
    });
    if (id !== reqId.current) return; // a newer search has started
    if (err) {
      setError(/admin_search_users|Could not find the function/.test(err.message)
        ? 'The new Users page needs migration 049: run it in the Supabase SQL editor.'
        : `Couldn’t load users: ${err.message}`);
      setRows([]); setTotal(0);
    } else {
      const r = data as { total: number; rows: AdminUserRow[] } | null;
      setRows(r?.rows ?? []); setTotal(r?.total ?? 0); setError('');
    }
    setLoading(false);
  }, [q, filter, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    loadCounts();
    createClient().from('programs').select('*').order('name')
      .then(({ data }: { data: Program[] | null }) => setPrograms(data ?? []));
  }, [loadCounts]);

  // A student's reply lights up "Needs a reply" without a reload.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('admin_messages_list')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'admin_messages' }, (payload) => {
        const row = payload.new as { user_id: string; sender_id: string };
        if (row.sender_id === row.user_id) { loadCounts(); load(); }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load, loadCounts]);

  const refresh = useCallback(() => { load(); loadCounts(); }, [load, loadCounts]);
  const pickFilter = (f: UserFilter) => { setFilter(f); setPage(0); setSelected(new Set()); setBulkNote(''); };

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allOnPage = rows.length > 0 && rows.every(r => selected.has(r.id));
  const togglePage = () => setSelected(prev => {
    const next = new Set(prev);
    if (allOnPage) rows.forEach(r => next.delete(r.id)); else rows.forEach(r => next.add(r.id));
    return next;
  });

  const bulkDelete = async () => {
    setBulkBusy(true);
    setBulkNote('');
    const res = await fetch('/api/admin/users/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [...selected] }),
    });
    const json = await res.json().catch(() => ({})) as { deleted?: string[]; skipped?: { id: string; reason: string }[]; error?: string };
    setBulkBusy(false);
    setConfirmBulk(false);
    if (!res.ok) { setBulkNote(json.error ?? 'Nothing was deleted.'); return; }
    const kept = json.skipped ?? [];
    setBulkNote(`Deleted ${json.deleted?.length ?? 0} account${json.deleted?.length === 1 ? '' : 's'}.${kept.length ? ` Kept ${kept.length}: ${[...new Set(kept.map(k => k.reason))].join(' ')}` : ''}`);
    setSelected(new Set(kept.map(k => k.id)));
    refresh();
  };

  // Every account in the current filter and search, a page at a time.
  const exportCsv = async () => {
    setExporting(true);
    const all: AdminUserRow[] = [];
    for (let off = 0; off < total && off < 20000; off += 100) {
      const { data } = await createClient().rpc('admin_search_users', { p_q: q || null, p_filter: filter, p_limit: 100, p_offset: off });
      const r = data as { rows: AdminUserRow[] } | null;
      if (!r?.rows?.length) break;
      all.push(...r.rows);
    }
    const header = ['Name', 'Email', 'Role', 'Programme', 'Level', 'Tests', 'Streak', 'XP', 'Access', 'Email confirmed', 'Suspended', 'Joined', 'Last active'];
    const lines = all.map(u => [
      u.full_name ?? '', u.email, roleLabel(u.role), u.program_code ?? '', u.selected_level ? String(u.selected_level) : '',
      String(u.total_tests_taken ?? 0), String(u.practice_streak ?? 0), String(u.xp ?? 0), u.access,
      u.email_confirmed ? 'yes' : 'no', u.is_suspended ? 'yes' : 'no', u.created_at, u.last_active ?? '',
    ]);
    const csv = [header, ...lines].map(l => l.map(csvEscape).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `pastcs-users-${filter}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setExporting(false);
  };

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Users</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{counts.all ?? '…'} accounts. Tap anyone to see everything about them.</p>
        </div>
        <button
          onClick={exportCsv}
          disabled={exporting || total === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-200"
        >
          <Download className="h-4 w-4" />{exporting ? 'Exporting…' : `Export ${total} to CSV`}
        </button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <label htmlFor="user-search" className="sr-only">Search by name or email</label>
        <input
          id="user-search"
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by name or email"
          className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-900 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-100"
        />
      </div>

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="group" aria-label="Filter users">
        <div className="flex w-max gap-2 pb-1 sm:w-auto sm:flex-wrap">
          {USER_FILTERS.map(([key, label]) => {
            const n = counts[key];
            const warn = (key === 'suspicious' || key === 'unread') && (n ?? 0) > 0;
            return (
              <button
                key={key}
                onClick={() => pickFilter(key)}
                aria-pressed={filter === key}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium ${filter === key
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                  : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-300'}`}
              >
                {label}
                {n !== undefined && (
                  <span className={`ml-1.5 tabular-nums ${filter === key ? 'opacity-70' : warn ? 'font-semibold text-red-600 dark:text-red-400' : 'text-gray-400'}`}>{n}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {filter === 'suspicious' && (counts.suspicious ?? 0) > 0 && (
        <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-300">
          These names contain links or web addresses: almost always bots. Select them and delete. New sign-ups like this are now refused.
        </p>
      )}

      {selected.size > 0 && (
        <div className="sticky top-14 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-2.5 shadow-sm lg:top-2 dark:border-white/10 dark:bg-[#1c1a15]">
          <span className="px-1 text-sm font-medium text-gray-900 dark:text-gray-100">{selected.size} selected</span>
          {!confirmBulk ? (
            <button onClick={() => setConfirmBulk(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700">
              <Trash2 className="h-4 w-4" />Delete
            </button>
          ) : (
            <>
              <span className="text-sm text-gray-700 dark:text-gray-300">Delete {selected.size} for good?</span>
              <button onClick={bulkDelete} disabled={bulkBusy} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                {bulkBusy ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button onClick={() => setConfirmBulk(false)} className="rounded-lg px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-white/5">Cancel</button>
            </>
          )}
          <button onClick={() => { setSelected(new Set()); setConfirmBulk(false); }} aria-label="Clear selection" className="ml-auto rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {bulkNote && <p role="status" className="rounded-xl bg-gray-50 p-3 text-sm text-gray-700 dark:bg-white/[0.04] dark:text-gray-300">{bulkNote}</p>}

      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/10 dark:bg-white/[0.04]">
          <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-2.5 text-xs text-gray-500 dark:border-white/10 dark:text-gray-400">
            <input type="checkbox" checked={allOnPage} onChange={togglePage} aria-label="Select everyone on this page" className="h-4 w-4" />
            <span className="flex-1">{loading ? 'Loading…' : total === 0 ? 'No accounts match.' : `${from}–${to} of ${total}`}</span>
            <span className="hidden w-28 md:block">Programme</span>
            <span className="hidden w-32 md:block">Activity</span>
            <span className="hidden w-24 md:block">Access</span>
            <span className="hidden w-24 text-right lg:block">Joined</span>
          </div>
          {loading && rows.length === 0 ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
          ) : (
            <ul className={`divide-y divide-gray-100 dark:divide-white/10 ${loading ? 'opacity-60' : ''}`}>
              {rows.map(u => (
                <li key={u.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/[0.03]">
                  <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} aria-label={`Select ${u.full_name || u.email}`} className="h-4 w-4 flex-shrink-0" />
                  <button onClick={() => setOpenId(u.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <Avatar src={u.avatar_url} name={u.full_name || u.email} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className={`max-w-full truncate font-medium ${u.suspicious ? 'text-red-700 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'}`}>{u.full_name || 'No name'}</span>
                        {u.role !== 'student' && <Chip tone="purple">{roleLabel(u.role)}</Chip>}
                        {u.rep_level && <Chip tone="green">Rep L{u.rep_level}</Chip>}
                        {u.suspicious && <Chip tone="red">Suspicious</Chip>}
                        {u.is_suspended && <Chip tone="red">Suspended</Chip>}
                        {u.unread_reply && <Chip tone="amber">Needs a reply</Chip>}
                        {!u.email_confirmed && <Chip tone="gray">Unconfirmed</Chip>}
                        {u.shared_ip > 0 && <Chip tone="amber">Shared IP</Chip>}
                      </div>
                      <p className="truncate text-sm text-gray-500 dark:text-gray-400">{u.email}</p>
                      <p className="truncate text-xs text-gray-500 md:hidden dark:text-gray-400">
                        {[u.program_code, u.selected_level ? `L${u.selected_level}` : null].filter(Boolean).join(' · ') || 'No programme yet'} · {u.total_tests_taken ?? 0} tests · {timeAgo(u.last_active)}
                        {u.access !== 'none' ? ` · ${u.access === 'paid' ? 'Paid' : 'Free pass'}` : ''}
                      </p>
                    </div>
                    <span className="hidden w-28 truncate text-sm text-gray-700 md:block dark:text-gray-300">
                      {u.program_code ? `${u.program_code}${u.selected_level ? ` · L${u.selected_level}` : ''}` : <span className="text-gray-400">Not chosen</span>}
                    </span>
                    <span className="hidden w-32 text-sm text-gray-700 md:block dark:text-gray-300">
                      {u.total_tests_taken ?? 0} tests<br /><span className="text-xs text-gray-500 dark:text-gray-400">{timeAgo(u.last_active)}</span>
                    </span>
                    <span className="hidden w-24 md:block">
                      {u.access === 'paid' ? <Chip tone="green">Paid</Chip> : u.access === 'free_pass' ? <Chip tone="purple">Free pass</Chip> : <span className="text-xs text-gray-400">Free course</span>}
                    </span>
                    <span className="hidden w-24 text-right text-xs text-gray-500 lg:block dark:text-gray-400">{dateLabel(u.created_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {pages > 1 && (
            <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-4 py-2.5 dark:border-white/10">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-white/5">
                <ChevronLeft className="h-4 w-4" />Previous
              </button>
              <span className="text-xs text-gray-500 dark:text-gray-400">Page {page + 1} of {pages}</span>
              <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-white/5">
                Next<ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {openId && (
        <UserPanel
          userId={openId}
          programs={programs}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
          onDeleted={(id) => { setOpenId(null); setSelected(prev => { const n = new Set(prev); n.delete(id); return n; }); setBulkNote('Account deleted.'); refresh(); }}
        />
      )}
    </div>
  );
}
