'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { Avatar, QuestionContent } from '@/components/ui';
import {
  battleErrorMessage, battleShareUrl, ordinal,
  type BattlePlayer, type BattleState,
} from '@/lib/battles';
import { ArrowLeft, Check, Clock, Loader2, Share2, Swords, Users, X } from 'lucide-react';

// A live class battle (migration 034). The database owns the clock: every
// phone asks get_classroom_battle where the battle is and schedules its
// next look for the moment the current phase ends, so everyone sees the
// same question at the same time and a phone that drops out just asks
// again. Realtime only makes that faster — lobby joins and the start
// arrive as row changes, and the host's phone broadcasts a tick at each
// phase change. Nothing secret travels that way.

const POLL_DURING_QUESTION_MS = 4000;

function nameOf(p: { full_name: string | null }) {
  return p.full_name || 'Classmate';
}

export default function BattlePage() {
  const params = useParams();
  const classroomId = params.id as string;
  const battleId = params.battleId as string;

  const [battle, setBattle] = useState<BattleState | null>(null);
  const [room, setRoom] = useState<{ name: string; course_code?: string } | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now()); // on the server's clock

  const offsetRef = useRef(0); // server clock minus this phone's clock
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastPhaseRef = useRef('');
  const loadedRef = useRef(false);

  const fetchState = useCallback(async () => {
    const sentAt = Date.now();
    const { data, error: err } = await createClient().rpc('get_classroom_battle', { p_battle: battleId });
    const gotAt = Date.now();
    if (err || !data) {
      // A blip mid-battle keeps the last state; the next look catches up.
      if (!loadedRef.current) setMissing(true);
      return;
    }
    const s = data as BattleState;
    offsetRef.current = new Date(s.server_now).getTime() - (sentAt + gotAt) / 2;
    loadedRef.current = true;
    setNow(Date.now() + offsetRef.current);
    setBattle(s);
    setMissing(false);
  }, [battleId]);

  useEffect(() => { fetchState(); }, [fetchState]);

  useEffect(() => {
    createClient().from('classrooms').select('name, course:courses(course_code)').eq('id', classroomId).maybeSingle()
      .then(({ data }: { data: { name: string; course: { course_code: string } | null } | null }) => {
        if (data) setRoom({ name: data.name, course_code: data.course?.course_code });
      });
  }, [classroomId]);

  // Lobby joins, the start and the finish come in live.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`battle-${battleId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'classroom_battle_players', filter: `battle_id=eq.${battleId}` }, () => fetchState())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'classroom_battles', filter: `id=eq.${battleId}` }, () => fetchState())
      .on('broadcast', { event: 'tick' }, () => fetchState())
      .subscribe();
    channelRef.current = channel as unknown as RealtimeChannel;
    const onVisible = () => { if (document.visibilityState === 'visible') fetchState(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', fetchState);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', fetchState);
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [battleId, fetchState]);

  // Look again the moment this phase ends (plus a hair, so the server
  // agrees it has ended), and every few seconds during a question for
  // the "locked in" count.
  const phaseEndsAt = battle?.phase_ends_at ? new Date(battle.phase_ends_at).getTime() : null;
  const phase = battle?.phase;
  useEffect(() => {
    if (!phaseEndsAt) return;
    const wait = Math.max(0, phaseEndsAt - (Date.now() + offsetRef.current)) + 250;
    const t = window.setTimeout(fetchState, wait);
    return () => window.clearTimeout(t);
  }, [phaseEndsAt, fetchState]);
  useEffect(() => {
    if (phase !== 'question') return;
    const t = window.setInterval(fetchState, POLL_DURING_QUESTION_MS);
    return () => window.clearInterval(t);
  }, [phase, fetchState]);

  // The countdown numbers.
  useEffect(() => {
    if (!phaseEndsAt) return;
    const t = window.setInterval(() => setNow(Date.now() + offsetRef.current), 200);
    return () => window.clearInterval(t);
  }, [phaseEndsAt]);

  // A new question clears the picks; the host's phone nudges everyone.
  const phaseKey = battle ? `${battle.phase}-${battle.idx}` : '';
  useEffect(() => {
    if (!battle || phaseKey === lastPhaseRef.current) return;
    lastPhaseRef.current = phaseKey;
    setPicked(battle.my_answer?.selected ?? []);
    setError('');
    const me = battle.players.find(p => p.is_me);
    if (me && me.user_id === battle.host_id && battle.phase !== 'lobby') {
      channelRef.current?.send({ type: 'broadcast', event: 'tick', payload: { phase: battle.phase, idx: battle.idx } });
    }
  }, [phaseKey, battle]);

  const run = async (key: string, fn: () => PromiseLike<{ error: { message?: string } | null }>) => {
    setBusy(key);
    setError('');
    const { error: err } = await fn();
    setBusy(null);
    if (err) setError(battleErrorMessage(err));
    await fetchState();
    return !err;
  };

  if (missing) {
    return (
      <div className="text-center py-16">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Battle not found</h1>
        <p className="text-gray-500 mt-1 dark:text-gray-400">It may have been removed, or you&rsquo;re not in this classroom.</p>
        <Link href={`/classrooms/${classroomId}`} className="inline-block mt-4 text-blue-600 font-medium hover:underline dark:text-blue-400">Back to the classroom</Link>
      </div>
    );
  }

  if (!battle) {
    return (
      <div className="space-y-4">
        <div className="h-28 rounded-2xl bg-white border border-gray-200 animate-pulse dark:bg-white/[0.04] dark:border-white/10" />
        <div className="h-64 rounded-2xl bg-white border border-gray-200 animate-pulse dark:bg-white/[0.04] dark:border-white/10" />
      </div>
    );
  }

  const me = battle.players.find(p => p.is_me);
  const isHost = me?.user_id === battle.host_id;
  const host = battle.players.find(p => p.user_id === battle.host_id);
  const secondsLeft = phaseEndsAt ? Math.max(0, Math.ceil((phaseEndsAt - now) / 1000)) : 0;
  const q = battle.question;
  const lockedIn = !!battle.my_answer;

  const join = () => run('join', () => createClient().rpc('join_classroom_battle', { p_battle: battleId }));
  const leave = () => run('leave', () => createClient().rpc('leave_classroom_battle', { p_battle: battleId }));
  const cancel = () => {
    if (!window.confirm('Cancel this battle for everyone?')) return;
    run('cancel', () => createClient().rpc('cancel_classroom_battle', { p_battle: battleId }));
  };
  const start = async () => {
    if (await run('start', () => createClient().rpc('start_classroom_battle', { p_battle: battleId }))) {
      channelRef.current?.send({ type: 'broadcast', event: 'tick', payload: { phase: 'countdown' } });
    }
  };
  const submit = (selected: string[]) => {
    if (!q || lockedIn || busy || selected.length === 0) return;
    setPicked(selected);
    run('answer', () => createClient().rpc('submit_battle_answer', { p_battle: battleId, p_idx: q.idx, p_selected: selected }));
  };
  const tapOption = (id: string) => {
    if (!q || lockedIn || !battle.am_player || battle.phase !== 'question') return;
    if (q.type === 'single_choice') submit([id]);
    else setPicked(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const backLink = (
    <Link href={`/classrooms/${classroomId}`} className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100">
      <ArrowLeft className="w-4 h-4 mr-1.5" />{room?.name ?? 'Classroom'}
    </Link>
  );

  const header = (
    <div className="rounded-2xl bg-gradient-to-br from-purple-600 to-blue-600 px-4 py-3.5 sm:px-5 sm:py-4 text-white">
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0"><Swords className="w-5 h-5" /></span>
        <div className="min-w-0 flex-1">
          <h1 className="text-base sm:text-xl font-bold leading-tight">Class battle</h1>
          <p className="text-purple-100 text-xs sm:text-sm truncate">
            {battle.question_count} questions{battle.topics.length > 0 ? ` · ${battle.topics.join(', ')}` : room?.course_code ? ` · All of ${room.course_code}` : ''}
          </p>
        </div>
        {(battle.phase === 'question' || battle.phase === 'reveal') && (
          <span className="text-sm font-semibold tabular-nums flex-shrink-0">{battle.idx + 1}/{battle.question_count}</span>
        )}
      </div>
    </div>
  );

  // ── Lobby ──
  if (battle.phase === 'lobby') {
    return (
      <div className="space-y-4 animate-fade-in max-w-2xl mx-auto">
        {backLink}
        {header}
        <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 dark:bg-white/[0.04] dark:border-white/10">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {nameOf(host ?? { full_name: null })} opened this battle. Everyone gets the same question at the same time, with {battle.seconds_per_question} seconds to answer. Quick right answers score more.
          </p>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1.5 dark:text-gray-400">
            <Users className="w-3.5 h-3.5" />In the lobby ({battle.players.length})
          </p>
          <ul className="mt-2 flex flex-wrap gap-2" aria-label="Players">
            {battle.players.map(p => (
              <li key={p.user_id} className="flex items-center gap-1.5 rounded-full bg-gray-100 pl-1 pr-3 py-1 text-sm min-w-0 max-w-full dark:bg-white/10">
                <Avatar src={p.avatar_url} name={nameOf(p)} size="sm" />
                <span className="truncate text-gray-900 dark:text-gray-100">{nameOf(p)}{p.is_me && ' (you)'}</span>
              </li>
            ))}
          </ul>

          <div className="mt-5 flex flex-col sm:flex-row gap-2">
            {!battle.am_player ? (
              <button onClick={join} disabled={!!busy} className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-purple-600 text-white font-semibold hover:bg-purple-700 disabled:opacity-60">
                {busy === 'join' && <Loader2 className="w-4 h-4 animate-spin" />}Join the battle
              </button>
            ) : isHost ? (
              <>
                <button onClick={start} disabled={!!busy || battle.players.length < 2} className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-purple-600 text-white font-semibold hover:bg-purple-700 disabled:opacity-60">
                  {busy === 'start' && <Loader2 className="w-4 h-4 animate-spin" />}
                  {battle.players.length < 2 ? 'Waiting for classmates…' : `Start for ${battle.players.length} players`}
                </button>
                <button onClick={cancel} disabled={!!busy} className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-700 font-semibold hover:bg-gray-50 dark:border-white/15 dark:text-gray-200 dark:hover:bg-white/10">Cancel battle</button>
              </>
            ) : (
              <>
                <p className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-green-50 text-green-800 text-sm font-semibold dark:bg-green-500/10 dark:text-green-300">
                  <Check className="w-4 h-4" />You&rsquo;re in. Waiting for {host ? nameOf(host).split(' ')[0] : 'the host'} to start…
                </p>
                <button onClick={leave} disabled={!!busy} className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-700 font-semibold hover:bg-gray-50 dark:border-white/15 dark:text-gray-200 dark:hover:bg-white/10">Leave</button>
              </>
            )}
          </div>
          {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
      </div>
    );
  }

  if (battle.phase === 'cancelled') {
    return (
      <div className="space-y-4 animate-fade-in max-w-2xl mx-auto">
        {backLink}
        {header}
        <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center dark:border-white/15">
          <p className="font-semibold text-gray-900 dark:text-gray-100">This battle was cancelled</p>
          <Link href={`/classrooms/${classroomId}`} className="inline-block mt-3 text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400">Back to the classroom</Link>
        </div>
      </div>
    );
  }

  // ── Countdown ──
  if (battle.phase === 'countdown') {
    return (
      <div className="space-y-4 animate-fade-in max-w-2xl mx-auto">
        {backLink}
        {header}
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center dark:bg-white/[0.04] dark:border-white/10" role="status">
          <p className="text-sm font-semibold text-purple-700 dark:text-purple-300">Get ready…</p>
          <p className="text-6xl font-bold text-gray-900 tabular-nums mt-2 dark:text-gray-100">{Math.max(1, secondsLeft)}</p>
          {!battle.am_player && <p className="text-sm text-gray-500 mt-3 dark:text-gray-400">You&rsquo;re watching this one.</p>}
        </div>
      </div>
    );
  }

  // ── Finished: podium ──
  if (battle.phase === 'finished') {
    const ranked = [...battle.players].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || b.score - a.score);
    const podium = ranked.filter(p => p.rank !== null && p.rank <= 3).slice(0, 3);
    const order = [podium[1], podium[0], podium[2]].filter(Boolean) as BattlePlayer[];
    const contenders = ranked.filter(p => p.rank !== null).length;
    return (
      <div className="space-y-4 animate-fade-in max-w-2xl mx-auto">
        {backLink}
        {header}
        <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-6 dark:bg-white/[0.04] dark:border-white/10">
          <h2 className="text-center text-lg font-bold text-gray-900 dark:text-gray-100">Final results</h2>
          {order.length > 0 && (
            <div className="mt-4 flex items-end justify-center gap-2 sm:gap-4" aria-label="Podium">
              {order.map(p => {
                const h = p.rank === 1 ? 'h-24' : p.rank === 2 ? 'h-16' : 'h-12';
                return (
                  <div key={p.user_id} className="flex flex-col items-center min-w-0 w-24 sm:w-28">
                    <Avatar src={p.avatar_url} name={nameOf(p)} size={p.rank === 1 ? 'md' : 'sm'} />
                    <p className="mt-1 text-xs sm:text-sm font-semibold text-gray-900 truncate max-w-full dark:text-gray-100">{nameOf(p).split(' ')[0]}{p.is_me && ' (you)'}</p>
                    <p className="text-[11px] text-gray-500 tabular-nums dark:text-gray-400">{p.score.toLocaleString('en-GB')} pts</p>
                    <div className={`mt-1 w-full ${h} rounded-t-xl flex items-start justify-center pt-1.5 text-2xl ${
                      p.rank === 1 ? 'bg-amber-100 dark:bg-amber-500/20' : p.rank === 2 ? 'bg-gray-100 dark:bg-white/10' : 'bg-orange-100 dark:bg-orange-500/15'}`}>
                      {['🥇', '🥈', '🥉'][(p.rank ?? 1) - 1]}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {me && (
            <div className="mt-5 rounded-xl bg-purple-50 p-3 text-center dark:bg-purple-500/10">
              {me.rank ? (
                <p className="text-sm text-purple-900 dark:text-purple-200">
                  You came <strong>{ordinal(me.rank)}</strong> of {contenders} with <strong>{me.correct}/{battle.question_count}</strong> correct and {me.score.toLocaleString('en-GB')} points.
                </p>
              ) : (
                <p className="text-sm text-purple-900 dark:text-purple-200">You didn&rsquo;t answer any questions this time.</p>
              )}
              {me.rank && (
                <a
                  href={battleShareUrl({ rank: me.rank, players: contenders, correct: me.correct, total: battle.question_count, score: me.score, room: room?.name ?? 'my class', courseCode: room?.course_code })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-green-600 text-white text-sm font-semibold hover:bg-green-700"
                >
                  <Share2 className="w-4 h-4" />Share on WhatsApp
                </a>
              )}
            </div>
          )}

          <ol className="mt-5 divide-y divide-gray-100 dark:divide-white/10" aria-label="Final leaderboard">
            {ranked.map(p => <LeaderRow key={p.user_id} p={p} place={p.rank} />)}
          </ol>
          <p className="mt-4 text-xs text-gray-500 text-center dark:text-gray-400">Battle answers count toward this week&rsquo;s class leaderboard and your XP.</p>
        </div>
        <Link href={`/classrooms/${classroomId}`} className="block text-center text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400">Back to the classroom</Link>
      </div>
    );
  }

  // ── Question / reveal ──
  if (!q) return null;
  const revealing = battle.phase === 'reveal';
  const answeredCount = battle.players.filter(p => p.answered_current).length;
  const correct = new Set(q.correct_answers ?? []);
  const total = battle.seconds_per_question;
  const top = battle.players.slice(0, 5);
  const myPlace = me ? battle.players.findIndex(p => p.is_me) + 1 : 0;

  return (
    <div className="space-y-4 animate-fade-in max-w-2xl mx-auto">
      {backLink}
      {header}

      <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 dark:bg-white/[0.04] dark:border-white/10">
        <div className="flex items-center justify-between gap-3 text-xs font-semibold text-gray-500 dark:text-gray-400">
          <span>Question {q.idx + 1} of {battle.question_count}{q.type === 'multiple_choice' && ' · Pick all that apply'}</span>
          {!revealing && (
            <span className={`flex items-center gap-1 tabular-nums ${secondsLeft <= 5 ? 'text-red-600 dark:text-red-400' : ''}`} aria-live="polite">
              <Clock className="w-3.5 h-3.5" />{secondsLeft}s
            </span>
          )}
        </div>
        {!revealing && (
          <div className="mt-2 h-1.5 rounded-full bg-gray-100 overflow-hidden dark:bg-white/10">
            <div className={`h-full rounded-full transition-[width] duration-200 ${secondsLeft <= 5 ? 'bg-red-500' : 'bg-purple-500'}`}
              style={{ width: `${Math.min(100, (secondsLeft / total) * 100)}%` }} />
          </div>
        )}

        <div className="mt-4 [overflow-wrap:anywhere]">
          <QuestionContent text={q.text} textClassName="text-base sm:text-lg font-medium text-gray-900 dark:text-gray-100" />
        </div>

        <div className="mt-4 grid gap-2">
          {q.options.map((o, i) => {
            const mine = picked.includes(o.id);
            const isRight = revealing && correct.has(o.id);
            const isWrongPick = revealing && mine && !correct.has(o.id);
            const tone = isRight ? 'border-green-500 bg-green-50 dark:bg-green-500/10'
              : isWrongPick ? 'border-red-400 bg-red-50 dark:bg-red-500/10'
              : mine ? 'border-purple-500 bg-purple-50 dark:bg-purple-500/10'
              : 'border-gray-200 hover:border-gray-300 dark:border-white/15 dark:hover:border-white/25';
            return (
              <button
                key={o.id}
                onClick={() => tapOption(o.id)}
                disabled={revealing || lockedIn || !battle.am_player}
                aria-pressed={mine}
                className={`flex items-center gap-3 w-full text-left rounded-xl border-2 px-3 py-2.5 text-sm transition-colors disabled:cursor-default ${tone}`}
              >
                <span className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600 flex-shrink-0 dark:bg-white/10 dark:text-gray-300">
                  {isRight ? <Check className="w-4 h-4 text-green-600 dark:text-green-400" /> : isWrongPick ? <X className="w-4 h-4 text-red-600 dark:text-red-400" /> : String.fromCharCode(65 + i)}
                </span>
                <span className="min-w-0 flex-1 text-gray-900 [overflow-wrap:anywhere] dark:text-gray-100">{o.text}</span>
              </button>
            );
          })}
        </div>

        {!revealing && battle.am_player && q.type === 'multiple_choice' && !lockedIn && (
          <button onClick={() => submit(picked)} disabled={picked.length === 0 || !!busy}
            className="mt-3 w-full px-4 py-2.5 rounded-xl bg-purple-600 text-white font-semibold hover:bg-purple-700 disabled:opacity-60">
            Lock in
          </button>
        )}

        <p className="mt-3 text-sm text-center text-gray-600 dark:text-gray-400" role="status">
          {revealing ? (
            !battle.am_player ? 'You’re watching this battle.'
              : battle.my_answer?.is_correct ? <span className="font-semibold text-green-700 dark:text-green-400">Correct! +{battle.my_answer.points} points</span>
              : battle.my_answer ? <span className="font-semibold text-red-600 dark:text-red-400">Not this time. No points.</span>
              : <span className="font-semibold text-gray-700 dark:text-gray-300">Time ran out. No points.</span>
          ) : !battle.am_player ? 'You’re watching this battle.'
            : lockedIn ? <>Locked in. {answeredCount}/{battle.players.length} answered…</>
            : busy === 'answer' ? 'Locking in…'
            : `${answeredCount}/${battle.players.length} answered`}
        </p>
        {error && <p role="alert" className="mt-2 text-sm text-center text-red-600 dark:text-red-400">{error}</p>}

        {revealing && q.explanation && (
          <div className="mt-3 rounded-xl bg-gray-50 p-3 text-sm text-gray-700 dark:bg-white/[0.03] dark:text-gray-300 [overflow-wrap:anywhere]">
            <QuestionContent text={q.explanation} />
          </div>
        )}
      </div>

      {revealing && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:bg-white/[0.04] dark:border-white/10">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Leaderboard</p>
            <p className="text-xs text-gray-500 tabular-nums dark:text-gray-400">
              {battle.idx + 1 < battle.question_count ? `Next question in ${secondsLeft}s` : `Results in ${secondsLeft}s`}
            </p>
          </div>
          <ol className="mt-2 divide-y divide-gray-100 dark:divide-white/10" aria-label="Leaderboard">
            {top.map((p, i) => <LeaderRow key={p.user_id} p={p} place={i + 1} showLast />)}
            {me && myPlace > 5 && <LeaderRow p={me} place={myPlace} showLast />}
          </ol>
        </div>
      )}
    </div>
  );
}

function LeaderRow({ p, place, showLast }: { p: BattlePlayer; place: number | null; showLast?: boolean }) {
  return (
    <li className={`flex items-center gap-3 py-2 ${p.is_me ? 'bg-purple-50/70 -mx-2 px-2 rounded-lg dark:bg-purple-500/10' : ''}`}>
      <span className="w-7 text-center font-bold text-gray-500 tabular-nums flex-shrink-0 dark:text-gray-400">
        {place === null ? '—' : place <= 3 ? ['🥇', '🥈', '🥉'][place - 1] : place}
      </span>
      <Avatar src={p.avatar_url} name={nameOf(p)} size="sm" />
      <p className="min-w-0 flex-1 text-sm font-semibold text-gray-900 truncate dark:text-gray-100">
        {nameOf(p)}{p.is_me && <span className="text-purple-600 dark:text-purple-400"> (you)</span>}
      </p>
      {showLast && p.last_points !== null && p.last_points > 0 && (
        <span className="text-xs font-semibold text-green-600 tabular-nums flex-shrink-0 dark:text-green-400">+{p.last_points}</span>
      )}
      <span className="text-sm font-bold text-gray-900 tabular-nums flex-shrink-0 dark:text-gray-100">{p.score.toLocaleString('en-GB')}</span>
    </li>
  );
}
