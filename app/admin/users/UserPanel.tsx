'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Avatar } from '@/components/ui';
import { RepForm } from '@/components/admin/RepForm';
import {
  DELETE_BLOCKED, dateLabel, roleLabel, timeAgo, type AdminUserDetail,
} from '@/lib/adminUsers';
import type { AdminMessage, Program } from '@/types';
import {
  AlertTriangle, Ban, Gift, KeyRound, Loader2, RotateCcw, Send, ShieldCheck, Trash2, X,
} from 'lucide-react';

// Everything about one account, opened straight from the Users list:
// details first, then access (passes, payments) and the message thread.

type Tab = 'overview' | 'access' | 'messages';

const isFreePass = (ref: string | null) => !!ref?.startsWith('free_pass_');
const ghs = (pesewas: number | null) => `GHC ${((pesewas ?? 0) / 100).toFixed(2).replace(/\.00$/, '')}`;

export function UserPanel({ userId, programs, onClose, onChanged, onDeleted }: {
  userId: string;
  programs: Program[];
  onClose: () => void;
  /** Something about this account changed: refresh the list row. */
  onChanged: () => void;
  onDeleted: (id: string) => void;
}) {
  const [u, setU] = useState<AdminUserDetail | null>(null);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [editingRep, setEditingRep] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await createClient().rpc('admin_user_detail', { p_user: userId });
    if (err) { setLoadError(/admin_user_detail|Could not find the function/.test(err.message) ? 'Run migration 049 in Supabase to see account details.' : 'Couldn’t load this account.'); return; }
    if (!data) { setLoadError('This account no longer exists.'); return; }
    setU(data as AdminUserDetail);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // Focus the panel once when it opens; Escape closes it.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const act = async (key: string, run: () => Promise<string | void>) => {
    setBusy(key);
    setError('');
    setNote('');
    try {
      const msg = await run();
      if (msg) setNote(msg);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
    setBusy(null);
  };

  const post = async (url: string, body: unknown, method = 'POST') => {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? 'Something went wrong.');
    return json;
  };

  const isAdmin = u?.role === 'admin' || u?.role === 'super_admin';
  const activeSubs = (u?.subscriptions ?? []).filter(s => s.status === 'active');

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="user-panel-title">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/40" tabIndex={-1} />
      <div className="relative flex h-full w-full flex-col bg-white shadow-2xl sm:max-w-xl dark:bg-[#1c1a15]">
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-gray-100 p-4 dark:border-white/10">
          {u ? <Avatar src={u.avatar_url} name={u.full_name || u.email} size="md" /> : <div className="h-10 w-10 rounded-full bg-gray-100 dark:bg-white/5" />}
          <div className="min-w-0 flex-1">
            <h2 id="user-panel-title" className="truncate font-semibold text-gray-900 dark:text-gray-100">{u ? (u.full_name || 'No name') : 'Loading…'}</h2>
            <p className="truncate text-sm text-gray-500 dark:text-gray-400">{u?.email}</p>
            {u && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Chip tone={isAdmin ? 'purple' : 'gray'}>{roleLabel(u.role)}</Chip>
                {u.rep && <Chip tone="green">Rep L{u.rep.level}{u.rep.active ? '' : ' · paused'}</Chip>}
                {u.is_suspended && <Chip tone="red">Suspended</Chip>}
                {u.suspicious && <Chip tone="red">Suspicious</Chip>}
                {!u.email_confirmed_at && <Chip tone="amber">Email not confirmed</Chip>}
              </div>
            )}
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="Close details" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/5">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div role="tablist" className="flex gap-1 border-b border-gray-100 px-3 dark:border-white/10">
          {([['overview', 'Overview'], ['access', `Access${activeSubs.length ? ` (${activeSubs.length})` : ''}`], ['messages', 'Messages']] as const).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium ${tab === key ? 'border-[#e8603c] text-[#e8603c]' : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loadError ? (
            <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
          ) : !u ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
          ) : (
            <>
              {(error || note) && (
                <p role={error ? 'alert' : 'status'} className={`mb-3 rounded-xl p-3 text-sm ${error ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300' : 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300'}`}>
                  {error || note}
                </p>
              )}

              {tab === 'overview' && (
                <div className="space-y-4">
                  {u.suspicious && (
                    <Banner tone="red">
                      This name looks like spam (it contains a link or web address). Accounts like this are usually bots: delete it.
                    </Banner>
                  )}
                  {u.ip_siblings.length > 0 && (
                    <Banner tone="amber">
                      Registered from {u.registration_ip}, the same address as {u.ip_siblings.length} other account{u.ip_siblings.length === 1 ? '' : 's'}:{' '}
                      {u.ip_siblings.slice(0, 6).map(s => s.name || s.email).join(', ')}{u.ip_siblings.length > 6 ? '…' : ''}. A shared campus network is common; several free courses claimed from one address is not.
                    </Banner>
                  )}

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border border-gray-100 p-4 text-sm dark:border-white/10">
                    <Field label="Programme">{u.program_name ?? (u.program ? `${u.program} (not on the list)` : 'Not chosen yet')}</Field>
                    <Field label="Level">{u.selected_level ? `Level ${u.selected_level}${u.selected_semester ? ` · Semester ${u.selected_semester}` : ''}` : 'Not chosen yet'}</Field>
                    <Field label="Joined">{dateLabel(u.created_at)}</Field>
                    <Field label="Last active">{timeAgo(u.last_active)}</Field>
                    <Field label="Email">{u.email_confirmed_at ? `Confirmed ${dateLabel(u.email_confirmed_at)}` : 'Not confirmed'}</Field>
                    <Field label="Last sign-in">{timeAgo(u.last_sign_in_at)}</Field>
                    <Field label="Tests · streak · XP">{u.total_tests_taken ?? 0} · {u.practice_streak ?? 0} days · {u.xp ?? 0}</Field>
                    <Field label="Classrooms">{u.classrooms}</Field>
                    <Field label="Free course">{u.free_course_code ?? 'Not picked'}</Field>
                    <Field label="Invited by">{u.referred_by ? (u.referred_by.name || u.referred_by.email) : '—'}</Field>
                    <Field label="Referral code"><span className="font-mono">{u.referral_code ?? '—'}</span></Field>
                    <Field label="Student ID">{u.student_id || '—'}</Field>
                  </dl>

                  <section className="rounded-2xl border border-green-200 bg-green-50/60 p-4 dark:border-green-500/20 dark:bg-green-500/[0.06]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Level Rep</h3>
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                          {u.rep
                            ? `${u.rep.active ? '' : 'Paused · '}${u.rep.program_name ? `${u.rep.program_name} · ` : ''}Level ${u.rep.level} · ${Number(u.rep.commission_pct)}% commission · ${Number(u.rep.discount_pct)}% discount · ${u.rep.signups} sign-up${u.rep.signups === 1 ? '' : 's'}`
                            : 'Earns commission on payments from students who sign up with their code.'}
                        </p>
                      </div>
                      {!editingRep && (
                        <button onClick={() => setEditingRep(true)} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-200">
                          {u.rep ? 'Edit' : 'Make Level Rep'}
                        </button>
                      )}
                    </div>
                    {editingRep && (
                      <div className="mt-3">
                        <RepForm
                          userId={u.id}
                          programs={programs}
                          initial={u.rep
                            ? { program_id: u.rep.program_id, level: u.rep.level, commission_pct: Number(u.rep.commission_pct), discount_pct: Number(u.rep.discount_pct), active: u.rep.active }
                            : { program_id: u.program_id, level: u.selected_level ?? 100, commission_pct: 30, discount_pct: 10, active: true }}
                          onCancel={() => setEditingRep(false)}
                          onSaved={() => { setEditingRep(false); load(); onChanged(); }}
                        />
                      </div>
                    )}
                  </section>

                  <section className="space-y-2">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Account</h3>
                    <div className="flex flex-wrap gap-2">
                      <ActionButton
                        icon={KeyRound}
                        busy={busy === 'reset'}
                        onClick={() => {
                          if (!confirm(`Reset ${u.full_name || u.email}'s password? Their current password stops working now, and a temporary one is sent to them in Messages.`)) return;
                          act('reset', async () => {
                            setTempPassword('');
                            const json = await post('/api/admin/reset-password', { userId: u.id });
                            if (json.messageDelivered === false) { setTempPassword(json.tempPassword ?? ''); return 'Password reset, but the message didn’t send. Give them the temporary password below.'; }
                            return 'Password reset. The temporary password is in their Messages.';
                          });
                        }}
                      >Reset password</ActionButton>
                      {!isAdmin && (
                        <ActionButton
                          icon={u.is_suspended ? RotateCcw : Ban}
                          tone={u.is_suspended ? 'default' : 'red'}
                          busy={busy === 'suspend'}
                          onClick={() => {
                            if (!u.is_suspended && !confirm(`Suspend ${u.full_name || u.email}? They can't sign in until reactivated; sign-in just says the account wasn't found.`)) return;
                            act('suspend', async () => {
                              await post('/api/admin/users/suspend', { userId: u.id, suspended: !u.is_suspended });
                              return u.is_suspended ? 'Account reactivated.' : 'Account suspended.';
                            });
                          }}
                        >{u.is_suspended ? 'Reactivate' : 'Suspend'}</ActionButton>
                      )}
                    </div>
                    {tempPassword && (
                      <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                        Temporary password: <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono dark:bg-amber-500/20">{tempPassword}</code>
                      </p>
                    )}
                  </section>

                  <section className="rounded-2xl border border-red-200 p-4 dark:border-red-500/25">
                    <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">Delete account</h3>
                    {u.delete_blocked ? (
                      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">Can’t be deleted: {DELETE_BLOCKED[u.delete_blocked] ?? 'not allowed.'}</p>
                    ) : !confirmDelete ? (
                      <>
                        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">Permanently removes the account and everything in it: tests, classroom memberships and messages. It can’t be undone.</p>
                        <button onClick={() => setConfirmDelete(true)} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10">
                          <Trash2 className="h-4 w-4" />Delete account
                        </button>
                      </>
                    ) : (
                      <div className="mt-2 space-y-2">
                        <p className="text-sm text-gray-800 dark:text-gray-200">Delete <strong>{u.full_name || u.email}</strong> for good?</p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            disabled={busy === 'delete'}
                            onClick={async () => {
                              setBusy('delete');
                              setError('');
                              try {
                                const json = await post('/api/admin/users/delete', { ids: [u.id] });
                                if (json.deleted?.includes(u.id)) { onDeleted(u.id); return; }
                                setError(json.skipped?.[0]?.reason ?? 'It wasn’t deleted.');
                              } catch (e) {
                                setError(e instanceof Error ? e.message : 'It wasn’t deleted.');
                              }
                              setBusy(null);
                              setConfirmDelete(false);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                          >
                            <Trash2 className="h-4 w-4" />{busy === 'delete' ? 'Deleting…' : 'Yes, delete it'}
                          </button>
                          <button onClick={() => setConfirmDelete(false)} className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-white/5">Cancel</button>
                        </div>
                      </div>
                    )}
                  </section>
                </div>
              )}

              {tab === 'access' && <AccessTab u={u} programs={programs} busy={busy} act={act} post={post} />}
              {tab === 'messages' && <MessagesTab userId={u.id} onRead={onChanged} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AccessTab({ u, programs, busy, act, post }: {
  u: AdminUserDetail;
  programs: Program[];
  busy: string | null;
  act: (key: string, run: () => Promise<string | void>) => Promise<void>;
  post: (url: string, body: unknown, method?: string) => Promise<{ message?: string }>;
}) {
  const [level, setLevel] = useState(u.selected_level ?? 100);
  const [semester, setSemester] = useState(u.selected_semester ?? 1);
  const [programId, setProgramId] = useState(u.program_id ?? programs[0]?.id ?? '');
  const field = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-100';

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">Unlocks</h3>
        {u.subscriptions.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">None. They have their free course only.</p>
        ) : (
          <ul className="space-y-2">
            {u.subscriptions.map(s => {
              const pass = isFreePass(s.payment_reference);
              return (
                <li key={s.id} className="flex items-center gap-3 rounded-xl bg-gray-50 p-3 dark:bg-white/[0.03]">
                  {pass ? <Gift className="h-4 w-4 flex-shrink-0 text-green-600 dark:text-green-400" /> : <ShieldCheck className="h-4 w-4 flex-shrink-0 text-blue-600 dark:text-blue-400" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {s.program_code ? `${s.program_code} · ` : ''}Level {s.level} · Semester {s.semester}
                    </p>
                    <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                      {pass ? 'Free pass' : `Paid ${ghs(s.amount)}`} · {dateLabel(s.paid_at)}{s.status !== 'active' ? ` · ${s.status}` : ''}
                    </p>
                  </div>
                  {pass && s.status === 'active' && (
                    <button
                      disabled={busy === `revoke-${s.id}`}
                      onClick={() => act(`revoke-${s.id}`, async () => {
                        await post('/api/admin/free-pass', { userId: u.id, level: s.level, semester: s.semester, programId: s.program_id }, 'DELETE');
                        return 'Free pass revoked.';
                      })}
                      className="flex-shrink-0 text-xs font-semibold text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                    >
                      {busy === `revoke-${s.id}` ? 'Revoking…' : 'Revoke'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-gray-100 p-4 dark:border-white/10">
        <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Grant a free pass</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="grant-level" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Level</label>
            <select id="grant-level" value={level} onChange={e => setLevel(Number(e.target.value))} className={field}>
              {[100, 200, 300, 400].map(l => <option key={l} value={l}>Level {l}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="grant-semester" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Semester</label>
            <select id="grant-semester" value={semester} onChange={e => setSemester(Number(e.target.value))} className={field}>
              <option value={1}>Semester 1</option>
              <option value={2}>Semester 2</option>
            </select>
          </div>
          <div className="col-span-2">
            <label htmlFor="grant-program" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Programme</label>
            <select id="grant-program" value={programId} onChange={e => setProgramId(e.target.value)} className={field}>
              <option value="">Choose a programme…</option>
              {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
        <button
          disabled={!programId || busy === 'grant'}
          onClick={() => act('grant', async () => {
            const json = await post('/api/admin/free-pass', { userId: u.id, level, semester, programId });
            return json.message === 'Already has active access' ? 'They already have access for that level and semester.' : `Free pass granted: Level ${level}, Semester ${semester}.`;
          })}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          <Gift className="h-4 w-4" />{busy === 'grant' ? 'Granting…' : 'Grant free pass'}
        </button>
      </section>
    </div>
  );
}

function MessagesTab({ userId, onRead }: { userId: string; onRead: () => void }) {
  const [messages, setMessages] = useState<AdminMessage[] | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    // Opening the thread marks the student's messages read (server-side).
    fetch(`/api/admin/messages?userId=${userId}`).then(r => r.json()).then(json => {
      if (cancelled) return;
      setMessages(json.messages ?? []);
      onRead();
    }).catch(() => { if (!cancelled) setMessages([]); });
    const supabase = createClient();
    const channel = supabase
      .channel(`admin_messages_admin:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'admin_messages', filter: `user_id=eq.${userId}` }, (payload) => {
        const incoming = payload.new as AdminMessage;
        setMessages(prev => (prev ?? []).some(m => m.id === incoming.id) ? prev : [...(prev ?? []), incoming]);
        if (incoming.sender_id === userId) supabase.from('admin_messages').update({ is_read: true }).eq('id', incoming.id);
      })
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [userId, onRead]);

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    setError('');
    const res = await fetch('/api/admin/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, message: text.trim() }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) setError(json.error ?? 'Couldn’t send.');
    else { setText(''); setMessages(prev => [...(prev ?? []), json.message]); }
    setSending(false);
  };

  return (
    <div className="flex h-full flex-col gap-3">
      {!messages ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
      ) : messages.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No messages yet.</p>
      ) : (
        <ul className="space-y-2">
          {messages.map(m => {
            const fromStudent = m.sender_id === userId;
            return (
              <li key={m.id} className={`flex ${fromStudent ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${fromStudent ? 'bg-gray-100 text-gray-900 dark:bg-white/5 dark:text-gray-100' : 'bg-blue-600 text-white'}`}>
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className={`mt-0.5 text-[11px] ${fromStudent ? 'text-gray-500 dark:text-gray-400' : 'text-blue-100'}`}>{timeAgo(m.created_at)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-auto space-y-2 border-t border-gray-100 pt-3 dark:border-white/10">
        <label htmlFor="admin-message" className="sr-only">Message</label>
        <textarea
          id="admin-message"
          value={text}
          onChange={e => setText(e.target.value)}
          rows={3}
          placeholder="Write a message…"
          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-100"
        />
        {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        <button onClick={send} disabled={sending || !text.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          <Send className="h-4 w-4" />{sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-0.5 break-words text-gray-900 dark:text-gray-100">{children}</dd>
    </div>
  );
}

const TONES = {
  gray: 'bg-gray-100 text-gray-700 dark:bg-white/5 dark:text-gray-300',
  purple: 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
  green: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
} as const;

export function Chip({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

function Banner({ tone, children }: { tone: 'red' | 'amber'; children: React.ReactNode }) {
  return (
    <div className={`flex items-start gap-2 rounded-xl p-3 text-xs ${tone === 'red' ? 'bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300' : 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300'}`}>
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function ActionButton({ icon: Icon, tone = 'default', busy, onClick, children }: {
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'default' | 'red';
  busy: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${tone === 'red'
        ? 'border-red-200 text-red-700 hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10'
        : 'border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/5'}`}
    >
      <Icon className="h-4 w-4" />{busy ? 'Working…' : children}
    </button>
  );
}
