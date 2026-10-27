'use client';

import { useAuth } from '@/components/providers';
import { usePricing } from '@/lib/hooks/usePricing';
import { PaywallModal } from '../../courses/components/PaywallModal';
import { Lock } from 'lucide-react';

// What students on a free course see when a classroom limit (migration
// 039) runs out, and the paywall it opens.

export type LimitKind = 'messages' | 'battles' | 'calls';

const COPY: Record<LimitKind, { title: string; blurb: string }> = {
  messages: {
    title: 'You’ve used your 5 free messages in this class',
    blurb: 'On a free course you can send 5 messages in each classroom. Unlock all courses to chat as much as you like.',
  },
  battles: {
    title: 'You’ve played your 2 free battles in this class',
    blurb: 'On a free course you can play 2 class battles in each classroom. Unlock all courses for unlimited battles.',
  },
  calls: {
    title: 'You’ve used your 2 free call joins in this class',
    blurb: 'On a free course you can join 2 class calls in each classroom. Unlock all courses to join every call.',
  },
};

/** An inline "used up" notice with an unlock button. */
export function LimitReached({ kind, level, onUnlock }: { kind: LimitKind; level?: number; onUnlock: () => void }) {
  const { user } = useAuth();
  const { label } = usePricing(level ?? user?.selected_level, user?.program_id);
  return (
    <div className="flex flex-col min-[400px]:flex-row min-[400px]:items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm dark:border-blue-500/20 dark:bg-blue-500/10">
      <p className="flex-1 min-w-0 text-blue-900 dark:text-blue-200">
        <Lock className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />{COPY[kind].title}.
      </p>
      <button onClick={onUnlock} className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700">
        Unlock all courses — {label}
      </button>
    </div>
  );
}

/** The paywall for a classroom's course, explaining which limit ran out. */
export function LimitPaywall({ kind, level, semester, onClose, onUnlocked }: {
  kind: LimitKind;
  level?: number;
  semester?: number;
  onClose: () => void;
  onUnlocked: () => void;
}) {
  return (
    <PaywallModal
      courseName=""
      courseCode=""
      totalCourses={0}
      level={level}
      semester={semester}
      heading={COPY[kind].title}
      blurb={COPY[kind].blurb}
      onClose={onClose}
      onSuccess={onUnlocked}
    />
  );
}
