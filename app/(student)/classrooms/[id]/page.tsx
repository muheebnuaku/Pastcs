'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers';
import { useSubscriptionStore } from '@/lib/store';
import { Avatar, Button, Modal } from '@/components/ui';
import { CLASS_DEAL_MIN_PAID, CLASS_DEAL_PERCENT } from '@/lib/classDeal';
import { ChatPanel } from './ChatPanel';
import { ResourcesPanel } from './ResourcesPanel';
import { AlertSettings, PushPrompt } from './Alerts';
import { COURSE_ICONS, courseCodeSlug } from '@/lib/utils';
import {
  accuracyNumber, classroomErrorMessage, inviteUrl, timeAgo, whatsappShareUrl,
  type Classroom, type ClassroomMemberProgress, type ClassroomTopicStat,
} from '@/lib/classrooms';
import {
  ArrowLeft, Users, UserPlus, Play, Trophy, Flame, Copy, Check, RefreshCw, Crown, Shield,
  Lock, Eye, EyeOff, LogOut, Trash2, BarChart3, Target, MessageCircle, FolderOpen, Gift, Tag,
} from 'lucide-react';

type Tab = 'chat' | 'week' | 'progress' | 'resources' | 'members';

const TABS: { key: Tab; label: string; icon: typeof Trophy }[] = [
  { key: 'chat', label: 'Chat', icon: MessageCircle },
  { key: 'week', label: 'This week', icon: Trophy },
  { key: 'progress', label: 'Progress', icon: BarChart3 },
  { key: 'resources', label: 'Resources', icon: FolderOpen },
  { key: 'members', label: 'Members', icon: Users },
];

function accuracyTone(acc: number | null): string {
  if (acc === null) return 'bg-gray-300 dark:bg-white/20';
  if (acc < 50) return 'bg-red-500';
  if (acc < 70) return 'bg-amber-500';
  return 'bg-green-500';
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function ClassroomPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [room, setRoom] = useState<Classroom | null>(null);
  const [members, setMembers] = useState<ClassroomMemberProgress[]>([]);
  const [topics, setTopics] = useState<ClassroomTopicStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<Tab>('chat');
  const { user } = useAuth();
  const { hasActiveSub } = useSubscriptionStore();
  const [paidClassmates, setPaidClassmates] = useState<number | null>(null);
  const [freeWelcome, setFreeWelcome] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    const supabase = createClient();
    const [roomRes, progRes, topicRes] = await Promise.all([
      supabase.from('classrooms').select('*, course:courses(course_code, course_name, icon, level, semester)').eq('id', id).maybeSingle(),
      supabase.rpc('get_classroom_progress', { p_classroom: id, p_days: 7 }),
      supabase.rpc('get_classroom_topic_stats', { p_classroom: id, p_days: 30 }),
    ]);
    if (roomRes.error || !roomRes.data || progRes.error) {
      setMissing(true);
      setLoading(false);
      return;
    }
    setRoom(roomRes.data as Classroom);
    setMembers((progRes.data ?? []) as ClassroomMemberProgress[]);
    setTopics((topicRes.data ?? []) as ClassroomTopicStat[]);
    setLoading(false);
    // Class deal progress (counts only); absent until migration 029 runs.
    supabase.rpc('get_class_deal', { p_classroom: id })
      .then(({ data, error }: { data: number | null; error: unknown }) => { if (!error && typeof data === 'number') setPaidClassmates(data); });
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // A freshly created classroom opens straight on the invite step.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('welcome') === '1') setShowInvite(true);
    if (params.get('free') === '1') setFreeWelcome(true);
    if (params.has('welcome') || params.has('free')) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const me = members.find(m => m.is_me);
  const myRole = me?.role ?? 'member';
  const courseCode = room?.course?.course_code ?? '';
  const courseSlug = courseCode ? courseCodeSlug(courseCode) : '';

  const ranked = useMemo(() => members
    .filter(m => (m.questions_answered ?? 0) > 0)
    .sort((a, b) => (b.correct_answers ?? 0) - (a.correct_answers ?? 0)
      || (accuracyNumber(b.accuracy) ?? 0) - (accuracyNumber(a.accuracy) ?? 0)), [members]);
  const notYet = members.filter(m => m.questions_answered === 0);
  const hiddenCount = members.filter(m => m.questions_answered === null).length;
  const myRank = me ? ranked.findIndex(m => m.is_me) + 1 : 0;

  const visible = members.filter(m => m.questions_answered !== null);
  const activeThisWeek = visible.filter(m => (m.questions_answered ?? 0) > 0).length;
  const totalAnswered = visible.reduce((s, m) => s + (m.questions_answered ?? 0), 0);
  const totalCorrect = visible.reduce((s, m) => s + (m.correct_answers ?? 0), 0);
  const classAccuracy = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : null;

  const run = async (key: string, fn: () => PromiseLike<{ error: { message?: string } | null }>) => {
    setBusy(key);
    setActionError('');
    const { error } = await fn();
    setBusy(null);
    if (error) { setActionError(classroomErrorMessage(error)); return false; }
    await load();
    return true;
  };

  const handleCopy = async (what: 'link' | 'code') => {
    if (!room) return;
    if (await copyText(what === 'link' ? inviteUrl(room.join_code) : room.join_code)) {
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
    }
  };

  const setShare = (level: 'totals' | 'hidden') =>
    run('share', () => createClient().rpc('set_my_share_level', { p_classroom: id, p_level: level }));
  const setRole = (userId: string, role: 'leader' | 'member') =>
    run(`role-${userId}`, () => createClient().rpc('set_member_role', { p_classroom: id, p_user: userId, p_role: role }));
  const removeMember = (userId: string, name: string) => {
    if (!window.confirm(`Remove ${name} from this classroom?`)) return;
    run(`remove-${userId}`, () => createClient().from('classroom_members').delete().eq('classroom_id', id).eq('user_id', userId));
  };
  const regenerate = () => {
    if (!window.confirm('Make a new code? The old link and code will stop working.')) return;
    run('code', () => createClient().rpc('regenerate_classroom_code', { p_classroom: id }));
  };
  const leave = async () => {
    if (!me || !window.confirm('Leave this classroom?')) return;
    const ok = await run('leave', () => createClient().from('classroom_members').delete().eq('classroom_id', id).eq('user_id', me.user_id));
    if (ok) router.push('/classrooms');
  };
  const destroy = async () => {
    if (!window.confirm('Delete this classroom for everyone? This cannot be undone.')) return;
    setBusy('delete');
    const { error } = await createClient().from('classrooms').delete().eq('id', id);
    setBusy(null);
    if (error) { setActionError(classroomErrorMessage(error)); return; }
    router.push('/classrooms');
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-36 rounded-2xl bg-white border border-gray-200 animate-pulse dark:bg-white/[0.04] dark:border-white/10" />
        <div className="h-64 rounded-2xl bg-white border border-gray-200 animate-pulse dark:bg-white/[0.04] dark:border-white/10" />
      </div>
    );
  }

  if (missing || !room) {
    return (
      <div className="text-center py-16">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Classroom not found</h1>
        <p className="text-gray-500 mt-1 dark:text-gray-400">It may have been deleted, or you&rsquo;re not a member.</p>
        <Link href="/classrooms" className="inline-block mt-4 text-blue-600 font-medium hover:underline dark:text-blue-400">Back to classrooms</Link>
      </div>
    );
  }

  const nameOf = (m: ClassroomMemberProgress) => m.full_name || 'Classmate';
  const myName = me?.full_name?.split(' ')[0] || user?.full_name?.split(' ')[0] || 'A classmate';
  const canModerate = myRole === 'owner' || myRole === 'leader';
  const callUrl = `https://meet.jit.si/PastCS-${id.replace(/-/g, '')}#userInfo.displayName=${encodeURIComponent(JSON.stringify(me?.full_name || myName))}`;
  const courseLevel = (room.course as { level?: number } | null | undefined)?.level;
  const courseSemester = (room.course as { semester?: number } | null | undefined)?.semester;
  const unlocked = hasActiveSub(courseLevel, courseSemester, user?.program_id);
  const showDeal = !unlocked && paidClassmates !== null && !!courseLevel;

  return (
    <div className="space-y-4 animate-fade-in">
      <Link href="/classrooms" className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100">
        <ArrowLeft className="w-4 h-4 mr-1.5" />All classrooms
      </Link>

      {/* Header: one compact row on tablets and up, two short rows on phones */}
      <div className="rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 px-4 py-3.5 sm:px-5 sm:py-4 text-white">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-white/20 flex items-center justify-center text-xl sm:text-2xl flex-shrink-0">
              {room.course?.icon || COURSE_ICONS[courseCode] || '📚'}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-base sm:text-xl font-bold leading-tight truncate" title={room.name}>{room.name}</h1>
              <p className="text-blue-100 text-xs sm:text-sm truncate" title={room.course?.course_name}>
                {courseCode}<span className="hidden min-[400px]:inline"> · {room.course?.course_name}</span>
              </p>
              <p className="text-blue-100 text-xs mt-0.5 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 flex-shrink-0" />{members.length} {members.length === 1 ? 'member' : 'members'}
                {myRole !== 'member' && <span className="px-1.5 py-px rounded-full bg-white/20 text-[10px] font-semibold uppercase tracking-wide">{myRole === 'owner' ? 'Owner' : 'Leader'}</span>}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:flex gap-2 flex-shrink-0">
            <button
              onClick={() => setShowInvite(true)}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white text-blue-700 font-semibold text-xs sm:text-sm hover:bg-blue-50 transition-colors"
            >
              <UserPlus className="w-4 h-4" />Invite
            </button>
            <Link
              href={`/courses/${courseSlug}`}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/15 font-semibold text-xs sm:text-sm hover:bg-white/25 transition-colors"
            >
              <Play className="w-4 h-4" />Practise
            </Link>
          </div>
        </div>
      </div>

      {freeWelcome && (
        <div className="flex items-start gap-3 rounded-2xl border border-green-200 bg-green-50 p-4 dark:border-green-500/20 dark:bg-green-500/10">
          <Gift className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5 dark:text-green-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-green-900 dark:text-green-200">{courseCode} is now your free course</p>
            <p className="text-sm text-green-800 dark:text-green-300">Start practising with your class right away — no payment needed.</p>
          </div>
          <Link href={`/practice/${courseSlug}?mode=quick`} className="text-sm font-semibold text-white bg-green-600 hover:bg-green-700 px-3 py-1.5 rounded-lg flex-shrink-0">Start</Link>
        </div>
      )}

      <PushPrompt />

      <div className="grid grid-cols-5 gap-1 p-1 rounded-xl bg-gray-100 dark:bg-white/10">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 py-1.5 sm:py-2 rounded-lg text-[11px] sm:text-sm font-medium transition-colors ${
              tab === key
                ? 'bg-white text-gray-900 shadow-sm dark:bg-white/15 dark:text-gray-100'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {actionError && <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p>}

      {/* ── Chat ── */}
      {tab === 'chat' && me && (
        <ChatPanel
          classroomId={id}
          myId={me.user_id}
          myName={myName}
          members={members}
          canModerate={canModerate}
          callUrl={callUrl}
          onOpenResources={() => setTab('resources')}
        />
      )}

      {/* ── Resources ── */}
      {tab === 'resources' && me && (
        <ResourcesPanel classroomId={id} myId={me.user_id} myName={myName} members={members} canModerate={canModerate} />
      )}

      {/* ── This week ── */}
      {tab === 'week' && (
        <div className="space-y-4">
          {showDeal && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/20 dark:bg-amber-500/10">
              <p className="text-sm font-semibold text-amber-900 flex items-center gap-1.5 dark:text-amber-200">
                <Tag className="w-4 h-4" />Class deal: {CLASS_DEAL_PERCENT}% off
              </p>
              <p className="text-sm text-amber-800 mt-1 dark:text-amber-300">
                {(paidClassmates ?? 0) >= CLASS_DEAL_MIN_PAID
                  ? <>{paidClassmates} classmates have unlocked Level {courseLevel}, so you get {CLASS_DEAL_PERCENT}% off.</>
                  : <>{paidClassmates} of {CLASS_DEAL_MIN_PAID} classmates have unlocked Level {courseLevel}. At {CLASS_DEAL_MIN_PAID}, everyone else gets {CLASS_DEAL_PERCENT}% off.</>}
              </p>
              <div className="h-1.5 rounded-full bg-amber-100 mt-2.5 overflow-hidden dark:bg-white/10">
                <div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.min(100, ((paidClassmates ?? 0) / CLASS_DEAL_MIN_PAID) * 100)}%` }} />
              </div>
              <Link href="/courses" className="inline-block mt-3 text-sm font-semibold text-amber-900 underline dark:text-amber-200">See unlock options</Link>
            </div>
          )}
          {me && (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-500/20 dark:bg-blue-500/10">
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">Your week in {courseCode}</p>
              {(me.questions_answered ?? 0) > 0 ? (
                <p className="text-sm text-blue-800 mt-1 dark:text-blue-300">
                  {me.correct_answers} correct out of {me.questions_answered} ({Math.round(accuracyNumber(me.accuracy) ?? 0)}%)
                  {myRank > 0 && <> · <span className="font-semibold">#{myRank}</span> of {ranked.length} practising</>}
                </p>
              ) : (
                <p className="text-sm text-blue-800 mt-1 dark:text-blue-300">You haven&rsquo;t practised {courseCode} this week. One quick session puts you on the board.</p>
              )}
              {me.share_level === 'hidden' && (
                <p className="text-xs text-blue-700 mt-2 flex items-center gap-1 dark:text-blue-300"><EyeOff className="w-3.5 h-3.5" />Your progress is hidden from classmates. Change it under Members.</p>
              )}
            </div>
          )}

          {ranked.length === 0 ? (
            <div className="text-center rounded-2xl border border-dashed border-gray-300 p-8 dark:border-white/15">
              <Trophy className="w-10 h-10 text-amber-400 mx-auto mb-2" />
              <p className="font-semibold text-gray-900 dark:text-gray-100">No one has practised yet this week</p>
              <p className="text-sm text-gray-500 mt-1 dark:text-gray-400">Be first on the board.</p>
              <Link href={`/practice/${courseSlug}?mode=quick`} className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
                <Play className="w-4 h-4" />Start practising
              </Link>
            </div>
          ) : (
            <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden dark:bg-white/[0.04] dark:border-white/10 dark:divide-white/10">
              {ranked.map((m, i) => (
                <div key={m.user_id} className={`flex items-center gap-3 px-4 py-3 ${m.is_me ? 'bg-blue-50/70 dark:bg-blue-500/10' : ''}`}>
                  <span className="w-7 text-center font-bold text-gray-500 tabular-nums flex-shrink-0 dark:text-gray-400">
                    {i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}
                  </span>
                  <Avatar src={m.avatar_url} name={nameOf(m)} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900 truncate dark:text-gray-100">{nameOf(m)}{m.is_me && <span className="text-blue-600 dark:text-blue-400"> (you)</span>}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{m.correct_answers} correct · {Math.round(accuracyNumber(m.accuracy) ?? 0)}% accuracy</p>
                  </div>
                  {(m.practice_streak ?? 0) > 0 && (
                    <span className="flex items-center gap-0.5 text-xs font-semibold text-orange-600 flex-shrink-0 dark:text-orange-400">
                      <Flame className="w-3.5 h-3.5" />{m.practice_streak}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {(notYet.length > 0 || hiddenCount > 0) && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {notYet.length > 0 && <>{notYet.length} {notYet.length === 1 ? 'member hasn’t' : 'members haven’t'} practised yet this week. </>}
              {hiddenCount > 0 && <>{hiddenCount} {hiddenCount === 1 ? 'member keeps' : 'members keep'} their progress private.</>}
            </p>
          )}
        </div>
      )}

      {/* ── Progress ── */}
      {tab === 'progress' && (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {[
              { label: 'Practised this week', value: `${activeThisWeek}/${members.length}` },
              { label: 'Questions answered', value: totalAnswered.toLocaleString() },
              { label: 'Class accuracy', value: classAccuracy === null ? '—' : `${classAccuracy}%` },
            ].map(s => (
              <div key={s.label} className="rounded-2xl border border-gray-200 bg-white p-3 sm:p-4 text-center dark:bg-white/[0.04] dark:border-white/10">
                <p className="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums dark:text-gray-100">{s.value}</p>
                <p className="text-[11px] sm:text-xs text-gray-500 mt-0.5 dark:text-gray-400">{s.label}</p>
              </div>
            ))}
          </div>

          <section>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Topics the class finds hardest</h2>
            <p className="text-xs text-gray-500 mb-3 dark:text-gray-400">Last 30 days, from members who share their progress. Weakest first.</p>
            {topics.length === 0 ? (
              <p className="text-sm text-gray-500 rounded-2xl border border-dashed border-gray-300 p-6 text-center dark:text-gray-400 dark:border-white/15">
                Topic results appear once classmates practise {courseCode}.
              </p>
            ) : (
              <div className="space-y-2">
                {topics.slice(0, 8).map(t => {
                  const acc = accuracyNumber(t.accuracy);
                  return (
                    <div key={t.topic_id} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:bg-white/[0.04] dark:border-white/10">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-gray-900 truncate dark:text-gray-100">{t.topic_name}</p>
                          <span className="text-sm font-bold tabular-nums text-gray-900 flex-shrink-0 dark:text-gray-100">{acc === null ? '—' : `${Math.round(acc)}%`}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-gray-100 mt-1.5 overflow-hidden dark:bg-white/10">
                          <div className={`h-full rounded-full ${accuracyTone(acc)}`} style={{ width: `${Math.max(4, acc ?? 0)}%` }} />
                        </div>
                        <p className="text-[11px] text-gray-500 mt-1 dark:text-gray-400">{t.attempts} answers from {t.students} {t.students === 1 ? 'student' : 'students'}</p>
                      </div>
                      <Link
                        href={`/practice/${courseSlug}?topic=${t.topic_id}`}
                        className="flex items-center gap-1 text-xs font-semibold text-blue-600 bg-blue-50 px-2.5 py-1.5 rounded-lg hover:bg-blue-100 flex-shrink-0 dark:text-blue-400 dark:bg-blue-500/10 dark:hover:bg-blue-500/15"
                      >
                        <Target className="w-3.5 h-3.5" />Practise
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <h2 className="font-semibold text-gray-900 mb-3 dark:text-gray-100">Members this week</h2>
            <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden dark:bg-white/[0.04] dark:border-white/10 dark:divide-white/10">
              {members
                .slice()
                .sort((a, b) => (b.questions_answered ?? -1) - (a.questions_answered ?? -1))
                .map(m => {
                  const hidden = m.questions_answered === null;
                  const acc = accuracyNumber(m.accuracy);
                  return (
                    <div key={m.user_id} className="flex items-center gap-3 px-4 py-3">
                      <Avatar src={m.avatar_url} name={nameOf(m)} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate dark:text-gray-100">{nameOf(m)}{m.is_me && <span className="text-blue-600 dark:text-blue-400"> (you)</span>}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {hidden ? <span className="inline-flex items-center gap-1"><Lock className="w-3 h-3" />Private</span> : timeAgo(m.last_active)}
                        </p>
                      </div>
                      {!hidden && (
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">{acc === null ? '—' : `${Math.round(acc)}%`}</p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">{m.questions_answered} answered</p>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </section>
        </div>
      )}

      {/* ── Members ── */}
      {tab === 'members' && (
        <div className="space-y-5">
          {me && <AlertSettings classroomId={id} userId={me.user_id} />}

          <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:bg-white/[0.04] dark:border-white/10">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Your progress</h2>
            <p className="text-xs text-gray-500 mb-3 dark:text-gray-400">Classmates only ever see weekly totals, never your individual answers.</p>
            <div className="grid grid-cols-2 gap-2">
              {([
                ['totals', 'Share with class', Eye],
                ['hidden', 'Keep private', EyeOff],
              ] as const).map(([level, label, Icon]) => {
                const active = level === 'hidden' ? me?.share_level === 'hidden' : me?.share_level !== 'hidden';
                return (
                  <button
                    key={level}
                    onClick={() => !active && setShare(level)}
                    disabled={busy === 'share'}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                      active
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-white border-gray-200 text-gray-700 hover:border-blue-300 dark:bg-white/[0.04] dark:border-white/10 dark:text-gray-300'
                    }`}
                  >
                    <Icon className="w-4 h-4" />{label}
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <h2 className="font-semibold text-gray-900 mb-3 dark:text-gray-100">{members.length} {members.length === 1 ? 'member' : 'members'}</h2>
            <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden dark:bg-white/[0.04] dark:border-white/10 dark:divide-white/10">
              {members
                .slice()
                .sort((a, b) => ['owner', 'leader', 'member'].indexOf(a.role) - ['owner', 'leader', 'member'].indexOf(b.role))
                .map(m => (
                  <div key={m.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <Avatar src={m.avatar_url} name={nameOf(m)} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate dark:text-gray-100">{nameOf(m)}{m.is_me && <span className="text-blue-600 dark:text-blue-400"> (you)</span>}</p>
                      <p className="text-xs text-gray-500 flex items-center gap-1 dark:text-gray-400">
                        {m.role === 'owner' && <><Crown className="w-3 h-3" />Owner</>}
                        {m.role === 'leader' && <><Shield className="w-3 h-3" />Leader</>}
                        {m.role === 'member' && 'Member'}
                      </p>
                    </div>
                    {!m.is_me && m.role !== 'owner' && (
                      <div className="flex items-center gap-1.5">
                        {myRole === 'owner' && (
                          <button
                            onClick={() => setRole(m.user_id, m.role === 'leader' ? 'member' : 'leader')}
                            disabled={busy === `role-${m.user_id}`}
                            className="text-xs font-medium text-blue-600 bg-blue-50 px-2.5 py-1.5 rounded-lg hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-500/10"
                          >
                            {m.role === 'leader' ? 'Make member' : 'Make leader'}
                          </button>
                        )}
                        {(myRole === 'owner' || myRole === 'leader') && m.role === 'member' && (
                          <button
                            onClick={() => removeMember(m.user_id, nameOf(m))}
                            disabled={busy === `remove-${m.user_id}`}
                            className="text-xs font-medium text-red-600 bg-red-50 px-2.5 py-1.5 rounded-lg hover:bg-red-100 dark:text-red-400 dark:bg-red-500/10"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </section>

          {myRole === 'owner' ? (
            <Button variant="outline" onClick={destroy} isLoading={busy === 'delete'} className="w-full sm:w-auto text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-500/30 dark:hover:bg-red-500/10">
              <Trash2 className="w-4 h-4 mr-2" />Delete classroom
            </Button>
          ) : (
            <Button variant="outline" onClick={leave} isLoading={busy === 'leave'} className="w-full sm:w-auto">
              <LogOut className="w-4 h-4 mr-2" />Leave classroom
            </Button>
          )}
        </div>
      )}

      {/* Invite */}
      <Modal isOpen={showInvite} onClose={() => setShowInvite(false)} title="Invite your classmates" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">Share the link in your class WhatsApp group, or give people the code.</p>
          <div className="rounded-2xl bg-gray-50 border border-gray-200 p-4 text-center dark:bg-white/[0.04] dark:border-white/10">
            <p className="text-xs text-gray-500 dark:text-gray-400">Classroom code</p>
            <p className="text-3xl font-bold font-mono tracking-[0.3em] text-gray-900 mt-1 dark:text-gray-100">{room.join_code}</p>
          </div>
          <a
            href={whatsappShareUrl(room.name, courseCode, room.join_code)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-green-600 hover:bg-green-700 text-white font-semibold text-sm transition-colors"
          >
            Share on WhatsApp
          </a>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => handleCopy('link')}>
              {copied === 'link' ? <Check className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
              {copied === 'link' ? 'Copied' : 'Copy link'}
            </Button>
            <Button variant="outline" onClick={() => handleCopy('code')}>
              {copied === 'code' ? <Check className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
              {copied === 'code' ? 'Copied' : 'Copy code'}
            </Button>
          </div>
          {myRole === 'owner' && (
            <button onClick={regenerate} disabled={busy === 'code'} className="flex items-center gap-1.5 mx-auto text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
              <RefreshCw className="w-3.5 h-3.5" />Make a new code (stops the old one)
            </button>
          )}
        </div>
      </Modal>
    </div>
  );
}
