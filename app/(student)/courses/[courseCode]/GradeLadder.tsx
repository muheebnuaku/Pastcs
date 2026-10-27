'use client';

import Link from 'next/link';
import { Lock, Mountain, AlertTriangle } from 'lucide-react';
import { GRADE_LABELS, accuracyNumber, coverageText, nextStepText, type CourseGrade } from '@/lib/gradeLadder';

// The course's grade ladder (migration 042): the grade, the one goal for
// the next grade, and the way to climb. Shown on the course page.

const RULES = [
  'where every course starts',
  '45%+',
  '50%+',
  '55%+ · 2 topics',
  '60%+ · half the topics',
  '65%+',
  '70%+ · three quarters of topics',
  '75%+',
  '80%+ · every topic · mock 70%',
];

export function GradeBadge({ label, size = 'md' }: { label: string; size?: 'sm' | 'md' }) {
  return (
    <span className={`inline-flex items-center justify-center rounded-full border-2 border-blue-500 bg-blue-50 font-bold text-blue-700 flex-shrink-0 dark:bg-blue-500/15 dark:text-blue-300 ${
      size === 'sm' ? 'w-8 h-8 text-xs' : 'w-16 h-16 text-2xl'
    }`}>{label}</span>
  );
}

export function GradeLadder({ grade, slug, onUnlock }: { grade: CourseGrade; slug: string; onUnlock: () => void }) {
  const acc = accuracyNumber(grade);
  const cov = coverageText(grade.coverage, grade.topics_total);
  const pct = grade.bar_needed ? Math.min(100, (grade.bar / grade.bar_needed) * 100) : 100;
  const readyButCapped = grade.capped && grade.bar_needed !== null && grade.bar >= grade.bar_needed;
  const holdLeft = grade.hold ? Math.max(0, 7 - grade.hold.right) : 0;

  return (
    <section aria-label="Your grade in this course" className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 dark:bg-white/[0.04] dark:border-white/10">
      <div className="flex items-center gap-4">
        <GradeBadge label={grade.label} />
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 dark:text-gray-100">Your grade: {grade.label}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Best: {grade.best_label}{grade.next_label ? <> · next: {grade.next_label}</> : <> · top grade</>}
          </p>
        </div>
      </div>

      {grade.slipping && (
        <p role="status" className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Your {grade.label} is slipping. Get 7 of your next 10 right to hold it
            {grade.hold && grade.hold.answered > 0 ? <> ({grade.hold.right} of {grade.hold.answered} so far{holdLeft > 0 ? `, ${holdLeft} more right needed` : ''})</> : null}.
          </span>
        </p>
      )}

      <div className="mt-4">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{nextStepText(grade)}</p>
        {grade.bar_needed !== null && (
          <>
            <div className="mt-2 h-3 rounded-full bg-gray-100 overflow-hidden dark:bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={grade.bar_needed} aria-valuenow={grade.bar} aria-label={`Correct answers towards ${grade.next_label}`}>
              <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1 text-xs text-gray-500 tabular-nums dark:text-gray-400">{grade.bar} of {grade.bar_needed} correct for {grade.next_label}</p>
          </>
        )}
        <ul className="mt-3 space-y-1 text-sm text-gray-700 dark:text-gray-300">
          <li>{acc === null ? 'No answers counted yet' : <>Last {grade.n30} answers: {Math.round(acc)}%{grade.acc_needed !== null && <> (need {grade.acc_needed}%)</>}</>}</li>
          {cov && <li>{cov}</li>}
          {grade.coverage?.kind === 'at60' && <li>Mock exam at 70%+ in the last 30 days: {grade.coverage.mock ? 'done' : 'not yet'}</li>}
        </ul>
      </div>

      <ol className="mt-4 space-y-1" aria-label="The grades, A at the top">
        {[...GRADE_LABELS].map((label, stage) => ({ label, stage })).reverse().map(({ label, stage }) => {
          const current = stage === grade.stage;
          const locked = grade.free && stage >= 4;
          return (
            <li key={label} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
              current
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/15 dark:border-blue-400'
                : 'border-gray-200 dark:border-white/10'
            } ${locked ? 'opacity-60' : ''}`}>
              <span className="w-7 font-semibold text-gray-900 dark:text-gray-100">{label}</span>
              {current && <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">you are here</span>}
              <span className="ml-auto min-w-0 truncate text-right text-xs text-gray-500 dark:text-gray-400">{RULES[stage]}</span>
              {locked && <Lock className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" aria-label="Locked on a free course" />}
            </li>
          );
        })}
      </ol>

      {readyButCapped ? (
        <button onClick={onUnlock} className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700">
          <Lock className="w-4 h-4" />Unlock all topics to take your {grade.next_label}
        </button>
      ) : (
        <Link href={`/practice/${slug}?mode=climb`} className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700">
          <Mountain className="w-4 h-4" />{grade.next_label ? `Climb to ${grade.next_label}: 10 questions` : 'Climb: hold your A'}
        </Link>
      )}
      {grade.free && !readyButCapped && (
        <p className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400">On your free course you can climb to D+. C to A need every topic.</p>
      )}
    </section>
  );
}
