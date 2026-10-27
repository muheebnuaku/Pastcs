'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Modal } from '@/components/ui';
import { accuracyNumber, gradeShareUrl, nextStepText, useCourseGrade, type GradeEvent } from '@/lib/gradeLadder';
import { GradeBadge } from '../../courses/[courseCode]/GradeLadder';
import { AlertTriangle, CheckCircle2, Lock, Mountain, Share2 } from 'lucide-react';

// What this test did to the student's grade (migration 042): the
// promotion moment, a slip warning, a held grade, a drop, or a free
// course's earned-but-locked C — and the one next goal.

export function GradeOutcome({ testId, courseId, courseCode, courseSlug, isClimb, onUnlock }: {
  testId: string;
  courseId: string;
  courseCode: string;
  courseSlug: string;
  isClimb: boolean;
  onUnlock: () => void;
}) {
  const { grade } = useCourseGrade(courseId);
  const [events, setEvents] = useState<GradeEvent[]>([]);
  const [celebrate, setCelebrate] = useState<GradeEvent | null>(null);

  useEffect(() => {
    createClient().rpc('get_test_grade_outcome', { p_test: testId })
      .then(({ data, error }: { data: GradeEvent[] | null; error: unknown }) => {
        if (error || !data) return;
        setEvents(data);
        const promo = data.find(e => e.kind === 'promote');
        // The celebration shows once per test, not on every revisit.
        const key = `pastcs_grade_seen_${testId}`;
        let seen = false;
        try { seen = localStorage.getItem(key) === '1'; localStorage.setItem(key, '1'); } catch { /* private mode */ }
        if (promo && !seen) setCelebrate(promo);
      });
  }, [testId]);

  if (!grade || grade.access !== 'ok') return null;
  const promo = events.find(e => e.kind === 'promote');
  const warn = events.find(e => e.kind === 'warn');
  const drop = events.find(e => e.kind === 'drop');
  const held = events.find(e => e.kind === 'clear');
  const capped = events.find(e => e.kind === 'capped');
  const acc = accuracyNumber(grade);
  const pct = grade.bar_needed ? Math.min(100, (grade.bar / grade.bar_needed) * 100) : 100;
  const nearMiss = !promo && grade.bar_needed !== null && (grade.bar_needed - grade.bar <= 2 || grade.bar >= grade.bar_needed);

  return (
    <>
      {celebrate && (
        <Modal isOpen onClose={() => setCelebrate(null)} title="New grade" size="sm">
          <div className="text-center space-y-4">
            <div className="flex justify-center"><GradeBadge label={celebrate.to_label} /></div>
            <div>
              <p className="text-xl font-bold text-gray-900 dark:text-gray-100">You reached {celebrate.to_label} in {courseCode}</p>
              <p className="text-sm text-gray-600 mt-1 dark:text-gray-400">
                Up from {celebrate.from_label}. +{celebrate.to === 8 ? 200 : 50} XP.
                {celebrate.to < 8 && <> Next: {['F', 'E', 'D', 'D+', 'C', 'C+', 'B', 'B+', 'A'][celebrate.to + 1]}.</>}
              </p>
            </div>
            <a href={gradeShareUrl(celebrate.to_label, courseCode)} target="_blank" rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-3 font-semibold text-white hover:bg-green-700">
              <Share2 className="w-4 h-4" />Share on WhatsApp
            </a>
            <button onClick={() => setCelebrate(null)} className="w-full text-sm font-semibold text-gray-500 hover:text-gray-700 dark:text-gray-400">Keep going</button>
          </div>
        </Modal>
      )}

      <section aria-label="Your grade" className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 space-y-3 dark:bg-white/[0.04] dark:border-white/10">
        {promo && (
          <p className="flex items-start gap-2 rounded-xl bg-green-50 px-3 py-2.5 text-sm text-green-800 dark:bg-green-500/10 dark:text-green-300">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />You moved up to {promo.to_label} in {courseCode}.
          </p>
        )}
        {warn && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />Your {warn.from_label} in {courseCode} is slipping. Get 7 of your next 10 right to hold it.
          </p>
        )}
        {held && (
          <p className="flex items-start gap-2 rounded-xl bg-green-50 px-3 py-2.5 text-sm text-green-800 dark:bg-green-500/10 dark:text-green-300">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />You held your {held.from_label}. Well done.
          </p>
        )}
        {drop && (
          <p className="flex items-start gap-2 rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-700 dark:bg-white/[0.04] dark:text-gray-300">
            Your grade moved to {drop.to_label}. Your best is still {grade.best_label}, and the climb back to {drop.from_label} is already half done.
          </p>
        )}
        {capped && (
          <div className="flex flex-col min-[400px]:flex-row min-[400px]:items-center gap-2 rounded-xl bg-blue-50 px-3 py-2.5 text-sm text-blue-900 dark:bg-blue-500/10 dark:text-blue-200">
            <span className="flex-1">You&rsquo;ve earned {capped.to_label}-level work in {courseCode}. Unlock all topics to take your {capped.to_label}.</span>
            <button onClick={onUnlock} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 flex-shrink-0">
              <Lock className="w-3.5 h-3.5" />Unlock
            </button>
          </div>
        )}

        <div className="flex items-center gap-3">
          <GradeBadge label={grade.label} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{nextStepText(grade)}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {grade.bar_needed !== null && <>{grade.bar} of {grade.bar_needed} correct · </>}
              {acc === null ? 'no answers counted yet' : <>last {grade.n30} answers {Math.round(acc)}%{grade.acc_needed !== null && <> (need {grade.acc_needed}%)</>}</>}
            </p>
          </div>
        </div>
        {grade.bar_needed !== null && (
          <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden dark:bg-white/10">
            <div className="h-full rounded-full bg-blue-600" style={{ width: `${pct}%` }} />
          </div>
        )}
        {isClimb && nearMiss && !grade.capped && (
          <p className="text-sm text-gray-700 dark:text-gray-300">So close. One more round could take you to {grade.next_label}.</p>
        )}
        {!grade.capped || grade.bar_needed === null || grade.bar < grade.bar_needed ? (
          <Link href={`/practice/${courseSlug}?mode=climb`} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
            <Mountain className="w-4 h-4" />{isClimb ? 'One more round' : grade.next_label ? `Climb to ${grade.next_label}` : 'Climb: hold your A'}
          </Link>
        ) : null}
      </section>
    </>
  );
}
