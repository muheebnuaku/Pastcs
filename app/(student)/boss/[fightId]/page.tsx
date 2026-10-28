'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { QuestionContent } from '@/components/ui';
import { BossOwl, type BossMood } from '@/components/boss/BossOwl';
import {
  BOSS_HEARTS, FIGHTS_BEFORE_BREAK, bossErrorMessage, bossShareUrl, buzz, formatFightTime,
  isBossMuted, playBossSound, setBossMuted, type BossFight, type BossQuestion,
} from '@/lib/examBoss';
import { ArrowLeft, Check, Flame, Heart, Loader2, RotateCcw, Share2, Trophy, Volume2, VolumeX, X, Zap } from 'lucide-react';

// One Exam Boss fight (migration 043). The server keeps the clock: each
// question has a start time (its text arrives only then) and a deadline,
// and the server decides every hit, heart and KO. The page looks again
// when a question starts and just after its deadline, and keeps the last
// question on screen during the pause so the answer can be shown.

const STREAK_KEY = 'pastcs_boss_streak';
const wallClock = () => Date.now();

export default function BossFightPage() {
  const params = useParams();
  const router = useRouter();
  const fightId = params.fightId as string;

  const [fight, setFight] = useState<BossFight | null>(null);
  const [missing, setMissing] = useState(false);
  const [now, setNow] = useState(() => Date.now()); // on the server's clock
  const [picked, setPicked] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [shown, setShown] = useState<BossQuestion | null>(null); // the question on screen
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState('');
  const [rematching, setRematching] = useState(false);
  const [inARow, setInARow] = useState(0);

  const offsetRef = useRef(0);
  const seenLastRef = useRef<number | null>(null);
  const wasEnragedRef = useRef<boolean | null>(null);
  const endedRef = useRef(false);
  const tickRef = useRef(-1);

  useEffect(() => { setMuted(isBossMuted()); }, []);

  const apply = useCallback((s: BossFight, sentAt: number) => {
    offsetRef.current = new Date(s.server_now).getTime() - (sentAt + Date.now()) / 2;
    setNow(Date.now() + offsetRef.current);
    setFight(s);
  }, []);

  const fetchFight = useCallback(async () => {
    const sentAt = Date.now();
    const { data, error: err } = await createClient().rpc('get_boss_fight', { p_fight: fightId });
    if (err || !data) { setFight(f => { if (!f) setMissing(true); return f; }); return; }
    apply(data as BossFight, sentAt);
  }, [fightId, apply]);

  useEffect(() => { fetchFight(); }, [fetchFight]);

  // Look again when the next question starts, and just after its deadline
  // (the server marks a time-out then).
  const q = fight?.question ?? null;
  const startsAt = q ? new Date(q.starts_at).getTime() : null;
  const deadline = q ? new Date(q.deadline).getTime() : null;
  const started = !!q && q.text !== null;
  useEffect(() => {
    if (!startsAt || !deadline || fight?.status !== 'live') return;
    const local = (t: number) => Math.max(0, t - (Date.now() + offsetRef.current));
    const timer = started
      ? window.setTimeout(fetchFight, local(deadline) + 1700)
      : window.setTimeout(fetchFight, local(startsAt) + 60);
    return () => window.clearTimeout(timer);
  }, [startsAt, deadline, started, fight?.status, fetchFight]);

  useEffect(() => {
    if (fight?.status !== 'live') return;
    const t = window.setInterval(() => setNow(Date.now() + offsetRef.current), 100);
    const onVisible = () => { if (document.visibilityState === 'visible') fetchFight(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [fight?.status, fetchFight]);

  // A question whose clock has started goes on screen.
  useEffect(() => {
    if (q && q.text !== null && q.idx !== shown?.idx) {
      setShown(q);
      setPicked([]);
      setSending(false);
      if (q.idx === 0) playBossSound('start');
    }
  }, [q, shown?.idx]);

  // Sounds and buzzes for what just happened.
  const last = fight?.last ?? null;
  useEffect(() => {
    if (!fight) return;
    if (seenLastRef.current === null) {
      seenLastRef.current = last?.idx ?? -1;
      wasEnragedRef.current = fight.enraged;
      endedRef.current = fight.status !== 'live';
      return;
    }
    if (last && last.idx !== seenLastRef.current) {
      seenLastRef.current = last.idx;
      if (last.correct) { playBossSound(last.damage >= 4 ? 'power' : 'hit'); buzz(30); }
      else { playBossSound('hurt'); buzz([80, 40, 160]); }
    }
    if (fight.enraged && wasEnragedRef.current === false && fight.status === 'live') playBossSound('rage');
    wasEnragedRef.current = fight.enraged;
    if (fight.status !== 'live' && !endedRef.current) {
      endedRef.current = true;
      if (fight.status === 'won') { window.setTimeout(() => playBossSound('win'), 350); buzz([60, 60, 60, 60, 200]); }
      if (fight.status === 'lost') window.setTimeout(() => playBossSound('lose'), 350);
      try {
        const n = Number(sessionStorage.getItem(STREAK_KEY) ?? 0) + 1;
        sessionStorage.setItem(STREAK_KEY, String(n));
        setInARow(n);
      } catch { /* private mode */ }
    }
  }, [fight, last]);

  // Tick in the last 3 seconds.
  const secondsLeft = started && deadline ? Math.max(0, (deadline - now) / 1000) : null;
  useEffect(() => {
    if (secondsLeft === null || fight?.status !== 'live' || sending) return;
    const whole = Math.ceil(secondsLeft);
    if (whole <= 3 && whole > 0 && whole !== tickRef.current) { tickRef.current = whole; playBossSound('tick'); }
  }, [secondsLeft, fight?.status, sending]);

  const submit = async (selected: string[]) => {
    if (!shown || sending || selected.length === 0 || fight?.status !== 'live' || q?.idx !== shown.idx) return;
    setPicked(selected);
    setSending(true);
    setError('');
    const sentAt = wallClock();
    const { data, error: err } = await createClient().rpc('answer_boss_fight', { p_fight: fightId, p_idx: shown.idx, p_selected: selected });
    if (err || !data) { setError(bossErrorMessage(err)); setSending(false); await fetchFight(); return; }
    apply(data as BossFight, sentAt);
  };

  const tap = (id: string) => {
    if (!shown || sending || revealing) return;
    if (shown.type === 'single_choice') submit([id]);
    else setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  };

  const rematch = async () => {
    if (!fight) return;
    setRematching(true);
    setError('');
    const { data, error: err } = await createClient().rpc('start_boss_fight', { p_course: fight.course_id, p_topic: fight.topic_id, p_daily: false });
    if (err || !data) { setError(bossErrorMessage(err)); setRematching(false); return; }
    router.push(`/boss/${data as string}`);
  };

  const toggleMute = () => { setBossMuted(!muted); setMuted(!muted); };

  if (missing) {
    return (
      <div className="text-center py-16">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Fight not found</h1>
        <p className="text-gray-500 mt-1 dark:text-gray-400">It may belong to someone else, or it no longer exists.</p>
        <Link href="/boss" className="inline-block mt-4 text-blue-600 font-medium hover:underline dark:text-blue-400">Back to Exam Boss</Link>
      </div>
    );
  }
  if (!fight) {
    return <div className="max-w-xl mx-auto h-[28rem] rounded-3xl bg-gray-900 animate-pulse" />;
  }

  const live = fight.status === 'live';
  // During the pause after an answer the last question stays up, marked.
  const revealing = live && !!shown && !!last && last.idx === shown.idx && (!q || q.idx !== shown.idx || !started);
  const waitingFirst = live && !shown && !!q && !started;
  const countdownLeft = startsAt && !started ? Math.max(0, Math.ceil((startsAt - now) / 1000)) : 0;
  const total = shown?.countdown ?? q?.countdown ?? 10;
  const charge = secondsLeft !== null && !revealing ? 1 - secondsLeft / total : 0;

  const mood: BossMood = fight.status === 'won' ? 'ko'
    : fight.status === 'lost' ? 'taunt'
    : revealing ? (last?.correct ? 'hurt' : 'attack')
    : fight.enraged ? 'enraged'
    : charge > 0.65 ? 'charge'
    : 'idle';
  const hpPct = Math.max(0, (fight.boss_hp / fight.boss_max_hp) * 100);
  const correct = new Set(last?.correct_answers ?? []);

  // The last blow gets its popup too, over the KO or the loss.
  const popup = (revealing || (!live && fight.status !== 'abandoned')) && last
    ? last.correct
      ? { text: last.damage >= 4 ? 'POWER STRIKE!' : last.damage === 3 ? 'FAST HIT!' : 'HIT!', tone: 'text-yellow-300' }
      : { text: last.timed_out ? 'TOO SLOW!' : 'OUCH!', tone: 'text-red-400' }
    : null;

  return (
    <div className="max-w-xl mx-auto space-y-3 animate-fade-in">
      <div className="flex items-center justify-between gap-2">
        <Link href="/boss" onClick={(e: React.MouseEvent) => { if (live && !window.confirm('Leave this fight? It won’t count as a win.')) e.preventDefault(); }}
          className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100">
          <ArrowLeft className="w-4 h-4 mr-1.5" />Exam Boss
        </Link>
        <button onClick={toggleMute} aria-label={muted ? 'Turn sound on' : 'Mute sound'} aria-pressed={muted}
          className="w-9 h-9 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10">
          {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
        </button>
      </div>

      {/* The arena */}
      <section aria-label="The fight"
        className={`relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-[#0b0f14] via-[#10161d] to-[#0b0f14] px-3 pt-3 pb-3 sm:px-5 sm:pt-4 text-white ${revealing && last && !last.correct ? 'boss-hit-screen' : ''}`}>
        <div className="flex items-center gap-2 min-w-0">
          <p className="font-bold truncate min-w-0">{fight.boss_name}</p>
          <span className="flex-shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold">Level {fight.level}</span>
          {fight.enraged && live && <span className="flex-shrink-0 rounded-full bg-red-500/20 px-2 py-0.5 text-[11px] font-bold text-red-300">ENRAGED</span>}
          <span className="ml-auto flex-shrink-0 text-xs text-gray-400">{fight.course_code}</span>
        </div>
        <div className="mt-2 h-3 rounded-full bg-white/10 overflow-hidden" role="meter" aria-label="Boss health" aria-valuemin={0} aria-valuemax={fight.boss_max_hp} aria-valuenow={fight.boss_hp}>
          <div className={`h-full rounded-full transition-[width] duration-500 ${fight.enraged ? 'bg-gradient-to-r from-red-600 to-orange-500' : 'bg-gradient-to-r from-green-500 to-emerald-400'}`} style={{ width: `${hpPct}%` }} />
        </div>

        <div className="relative mx-auto mt-2 w-36 sm:w-48">
          <BossOwl mood={mood} beat={last?.idx ?? -1} label={`${fight.boss_name}, ${mood === 'ko' ? 'knocked out' : mood}`} />
          {popup && (
            <p key={`pop-${last?.idx}`} className={`boss-pop pointer-events-none absolute inset-x-0 top-1/3 text-center text-xl sm:text-2xl font-black tracking-wide drop-shadow ${popup.tone}`} aria-hidden="true">
              {popup.text}
            </p>
          )}
        </div>

        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1" aria-label={`${fight.hearts} of ${BOSS_HEARTS} hearts left`}>
            {Array.from({ length: BOSS_HEARTS }).map((_, i) => (
              <Heart key={`${i}-${i < fight.hearts}`} className={`w-5 h-5 ${i < fight.hearts ? 'fill-red-500 text-red-500' : 'text-white/25 boss-heart-lost'}`} />
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold">
            {fight.streak > 0 && <span className="flex items-center gap-0.5 text-orange-300"><Flame className="w-4 h-4" />{fight.streak}</span>}
            <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 ${fight.power ? 'bg-yellow-400 text-gray-900' : 'bg-white/10 text-gray-300'}`}
              aria-label={fight.power ? 'Power strike ready: your next hit does double damage' : `Power strike charging: ${fight.streak % 3} of 3`}>
              <Zap className="w-3.5 h-3.5" />
              {fight.power ? 'Power strike ready' : <span className="flex gap-0.5" aria-hidden="true">{[0, 1, 2].map(i => <span key={i} className={`w-1.5 h-1.5 rounded-full ${i < fight.streak % 3 ? 'bg-yellow-300' : 'bg-white/25'}`} />)}</span>}
            </span>
          </div>
        </div>

        {live && (
          <div className="mt-2">
            <div className="flex items-center justify-between text-[11px] font-semibold text-gray-400">
              <span>{revealing ? (last?.correct ? 'Direct hit' : 'The boss struck') : started ? 'Boss attack charging' : 'Get ready'}</span>
              {started && !revealing && secondsLeft !== null && (
                <span className={`tabular-nums ${secondsLeft <= 3 ? 'text-red-400' : 'text-gray-300'}`} aria-live="off">{Math.ceil(secondsLeft)}s</span>
              )}
            </div>
            <div className="mt-1 h-2 rounded-full bg-white/10 overflow-hidden">
              <div className={`h-full rounded-full ${charge > 0.7 ? 'bg-red-500' : 'bg-orange-400'}`} style={{ width: `${Math.min(100, charge * 100)}%` }} />
            </div>
          </div>
        )}
      </section>

      {/* The question */}
      {live && (waitingFirst ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center dark:bg-white/[0.04] dark:border-white/10" role="status">
          <p className="text-sm font-semibold text-gray-600 dark:text-gray-400">Answer before the bar fills. Quick hits do more damage.</p>
          <p className="text-6xl font-black text-gray-900 tabular-nums mt-2 dark:text-gray-100">{Math.max(1, countdownLeft)}</p>
        </div>
      ) : shown && shown.options ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:bg-white/[0.04] dark:border-white/10">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">
            Question {shown.idx + 1}{shown.type === 'multiple_choice' && ' · Pick all that apply'}
          </p>
          <div className="mt-2 [overflow-wrap:anywhere]">
            <QuestionContent text={shown.text ?? ''} textClassName="text-base sm:text-lg font-medium text-gray-900 dark:text-gray-100" />
          </div>
          <div className="mt-3 grid gap-2">
            {shown.options.map((o, i) => {
              const mine = (revealing ? last?.selected ?? [] : picked).includes(o.id);
              const isRight = revealing && correct.has(o.id);
              const wrongPick = revealing && mine && !correct.has(o.id);
              const tone = isRight ? 'border-green-500 bg-green-50 dark:bg-green-500/10'
                : wrongPick ? 'border-red-400 bg-red-50 dark:bg-red-500/10'
                : mine ? 'border-orange-500 bg-orange-50 dark:bg-orange-500/10'
                : 'border-gray-200 hover:border-gray-300 dark:border-white/15 dark:hover:border-white/25';
              return (
                <button key={o.id} onClick={() => tap(o.id)} disabled={revealing || sending} aria-pressed={mine}
                  className={`flex items-center gap-3 w-full text-left rounded-xl border-2 px-3 py-3 text-sm transition-colors disabled:cursor-default ${tone}`}>
                  <span className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600 flex-shrink-0 dark:bg-white/10 dark:text-gray-300">
                    {isRight ? <Check className="w-4 h-4 text-green-600 dark:text-green-400" /> : wrongPick ? <X className="w-4 h-4 text-red-600 dark:text-red-400" /> : String.fromCharCode(65 + i)}
                  </span>
                  <span className="min-w-0 flex-1 text-gray-900 [overflow-wrap:anywhere] dark:text-gray-100">{o.text}</span>
                </button>
              );
            })}
          </div>
          {shown.type === 'multiple_choice' && !revealing && (
            <button onClick={() => submit(picked)} disabled={picked.length === 0 || sending}
              className="mt-3 w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-orange-600 text-white font-semibold hover:bg-orange-700 disabled:opacity-60">
              {sending && <Loader2 className="w-4 h-4 animate-spin" />}Strike
            </button>
          )}
          <p className="mt-2 min-h-[1.25rem] text-sm text-center" role="status">
            {revealing && last ? (
              last.correct ? <span className="font-semibold text-green-700 dark:text-green-400">Right! Next question coming…</span>
                : last.timed_out ? <span className="font-semibold text-red-600 dark:text-red-400">Too slow. The right answer is marked.</span>
                : <span className="font-semibold text-red-600 dark:text-red-400">Not quite. The right answer is marked.</span>
            ) : sending ? <span className="text-gray-500 dark:text-gray-400">Striking…</span> : null}
          </p>
          {error && <p role="alert" className="text-sm text-center text-red-600 dark:text-red-400">{error}</p>}
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500 dark:bg-white/[0.04] dark:border-white/10 dark:text-gray-400" role="status">
          Next question coming…
        </div>
      ))}

      {/* The end */}
      {!live && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 text-center dark:bg-white/[0.04] dark:border-white/10">
          {fight.status === 'won' ? (
            <>
              <h1 className="text-3xl font-black text-gray-900 dark:text-gray-100">K.O.!</h1>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                You knocked out {fight.is_daily ? 'today’s Daily Boss' : fight.boss_name} in {formatFightTime(fight.time_ms)}
                {fight.hearts === BOSS_HEARTS ? ' without losing a heart.' : '.'}
              </p>
              {!fight.is_daily && (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                  <Trophy className="w-4 h-4" />{fight.hearts === BOSS_HEARTS ? 'Gold trophy' : 'Trophy'} earned
                </p>
              )}
            </>
          ) : fight.status === 'lost' ? (
            <>
              <h1 className="text-2xl font-black text-gray-900 dark:text-gray-100">So close!</h1>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                {fight.boss_name} had {Math.ceil(fight.boss_hp / 2)} {Math.ceil(fight.boss_hp / 2) === 1 ? 'hit' : 'hits'} left. Have another go.
              </p>
            </>
          ) : (
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">You left this fight</h1>
          )}

          <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-gray-50 p-2 dark:bg-white/[0.04]"><dt className="text-[11px] text-gray-500 dark:text-gray-400">Right</dt><dd className="font-bold text-gray-900 tabular-nums dark:text-gray-100">{fight.right}/{fight.answered}</dd></div>
            <div className="rounded-xl bg-gray-50 p-2 dark:bg-white/[0.04]"><dt className="text-[11px] text-gray-500 dark:text-gray-400">XP</dt><dd className="font-bold text-gray-900 tabular-nums dark:text-gray-100">+{fight.xp}</dd></div>
            <div className="rounded-xl bg-gray-50 p-2 dark:bg-white/[0.04]"><dt className="text-[11px] text-gray-500 dark:text-gray-400">Boss rating</dt><dd className="font-bold text-gray-900 tabular-nums dark:text-gray-100">{fight.rating ?? '—'}</dd></div>
          </dl>

          <div className="mt-4 flex flex-col sm:flex-row gap-2">
            {fight.status === 'won' && (
              <a href={bossShareUrl(fight)} target="_blank" rel="noopener noreferrer"
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700">
                <Share2 className="w-4 h-4" />Share on WhatsApp
              </a>
            )}
            {!fight.is_daily && (
              <button onClick={rematch} disabled={rematching}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-orange-600 text-white font-semibold hover:bg-orange-700 disabled:opacity-60">
                {rematching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}{fight.status === 'won' ? 'Fight again' : 'Rematch'}
              </button>
            )}
            <Link href={`/boss?course=${fight.course_id}`} className="flex-1 inline-flex items-center justify-center px-4 py-2.5 rounded-xl border border-gray-200 text-gray-700 font-semibold hover:bg-gray-50 dark:border-white/15 dark:text-gray-200 dark:hover:bg-white/10">
              {fight.is_daily ? 'See today’s board' : 'Back to Exam Boss'}
            </Link>
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
              {error}{/Unlock all courses/.test(error) && <> <Link href="/courses" className="font-semibold underline">See unlock options</Link></>}
            </p>
          )}
          {inARow >= FIGHTS_BEFORE_BREAK && (
            <p className="mt-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-500/10 dark:text-blue-200">
              That&rsquo;s {inARow} fights in a row. A short break helps it all sink in. The boss will still be here.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
