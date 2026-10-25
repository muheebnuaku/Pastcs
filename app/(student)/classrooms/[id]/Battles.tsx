'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Modal } from '@/components/ui';
import { battleErrorMessage, battlePath, ordinal, type BattleSummary } from '@/lib/battles';
import { timeAgo } from '@/lib/classrooms';
import { Loader2, Swords } from 'lucide-react';

/** The open lobby or live battle, above the tabs. */
export function BattleBanner({ classroomId, battle }: { classroomId: string; battle: BattleSummary }) {
  const live = battle.status === 'live';
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-purple-200 bg-purple-50 p-3 sm:p-4 dark:border-purple-500/25 dark:bg-purple-500/10">
      <span className="w-9 h-9 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center flex-shrink-0 dark:bg-purple-500/20 dark:text-purple-300">
        <Swords className="w-5 h-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-purple-900 dark:text-purple-200">{live ? 'Battle in progress' : 'Battle lobby open'}</p>
        <p className="text-xs text-purple-800 truncate dark:text-purple-300">
          {(battle.host_name || 'A classmate').split(' ')[0]} · {battle.players} {battle.players === 1 ? 'player' : 'players'} · {battle.question_count} questions
        </p>
      </div>
      <Link
        href={battlePath(classroomId, battle.id)}
        className="text-sm font-semibold text-white bg-purple-600 hover:bg-purple-700 px-3 py-1.5 rounded-lg flex-shrink-0"
      >
        {live ? 'Watch' : 'Join'}
      </Link>
    </div>
  );
}

/** Recent results on the This week tab. */
export function RecentBattles({ classroomId, battles, onNew }: { classroomId: string; battles: BattleSummary[]; onNew?: () => void }) {
  const done = battles.filter(b => b.status === 'finished').slice(0, 5);
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:bg-white/[0.04] dark:border-white/10">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5 dark:text-gray-100">
          <Swords className="w-4 h-4 text-purple-600 dark:text-purple-400" />Class battles
        </p>
        {onNew && (
          <button onClick={onNew} className="text-sm font-semibold text-purple-700 hover:underline dark:text-purple-300">New battle</button>
        )}
      </div>
      {done.length === 0 ? (
        <p className="text-sm text-gray-500 mt-1 dark:text-gray-400">A live 10-question quiz against your classmates. Battle answers count toward this leaderboard.</p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100 dark:divide-white/10">
          {done.map(b => (
            <li key={b.id}>
              <Link href={battlePath(classroomId, b.id)} className="flex items-center gap-3 py-2 min-w-0 hover:bg-gray-50 -mx-2 px-2 rounded-lg dark:hover:bg-white/[0.03]">
                <span className="text-lg flex-shrink-0">🏆</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate dark:text-gray-100">{b.winner_name ? `${b.winner_name.split(' ')[0]} won` : 'No winner'} · {b.players} players</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{timeAgo(b.created_at)}</p>
                </div>
                {b.my_rank && <span className="text-xs font-semibold text-purple-700 flex-shrink-0 dark:text-purple-300">You: {ordinal(b.my_rank)}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Pick topics (or none for the whole course) and open a lobby. */
export function NewBattleModal({ classroomId, courseId, onClose }: { classroomId: string; courseId: string; onClose: () => void }) {
  const router = useRouter();
  const [topics, setTopics] = useState<{ id: string; topic_name: string }[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    createClient().from('topics').select('id, topic_name').eq('course_id', courseId).order('topic_name')
      .then(({ data }: { data: { id: string; topic_name: string }[] | null }) => setTopics(data ?? []));
  }, [courseId]);

  const create = async () => {
    setBusy(true);
    setError('');
    const { data, error: err } = await createClient().rpc('create_classroom_battle', { p_classroom: classroomId, p_topic_ids: chosen });
    if (err || !data) {
      setBusy(false);
      setError(battleErrorMessage(err));
      return;
    }
    router.push(battlePath(classroomId, data as string));
  };

  const toggle = (id: string) => setChosen(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  return (
    <Modal isOpen onClose={onClose} title="Start a class battle" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          10 questions, 20 seconds each. Classmates join your lobby, then you start it for everyone at once.
        </p>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Topics</p>
          {topics === null ? (
            <div className="h-24 mt-2 rounded-xl bg-gray-100 animate-pulse dark:bg-white/10" />
          ) : (
            <div className="mt-2 max-h-56 overflow-y-auto space-y-1 pr-1">
              <label className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-gray-50 text-sm dark:hover:bg-white/[0.04]">
                <input type="checkbox" checked={chosen.length === 0} onChange={() => setChosen([])} className="w-4 h-4 accent-purple-600" />
                <span className="text-gray-900 dark:text-gray-100">All topics</span>
              </label>
              {topics.map(t => (
                <label key={t.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-gray-50 text-sm dark:hover:bg-white/[0.04]">
                  <input type="checkbox" checked={chosen.includes(t.id)} onChange={() => toggle(t.id)} className="w-4 h-4 accent-purple-600 flex-shrink-0" />
                  <span className="min-w-0 text-gray-900 [overflow-wrap:anywhere] dark:text-gray-100">{t.topic_name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-700 font-semibold hover:bg-gray-50 dark:border-white/15 dark:text-gray-200 dark:hover:bg-white/10">Cancel</button>
          <button onClick={create} disabled={busy || topics === null}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-purple-600 text-white font-semibold hover:bg-purple-700 disabled:opacity-60">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}Open lobby
          </button>
        </div>
      </div>
    </Modal>
  );
}
