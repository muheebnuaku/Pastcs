'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Lock, Mountain, AlertTriangle, ChevronDown } from 'lucide-react';
import { GRADE_LABELS, accuracyNumber, coverageText, nextStepText, type CourseGrade } from '@/lib/gradeLadder';

// The course's grade ladder (migration 042), kept compact: the grade, the
// one goal for the next grade, a strip of all nine grades and a Climb
// button. What each grade needs folds away under "How grades work".

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
      size === 'sm' ? 'w-9 h-9 text-xs' : 'w-16 h-16 text-2xl'
    }`}>{label}</span>
  );
}

export function GradeLadder({ grade, slug, onUnlock }: { grade: CourseGrade; slug: string; onUnlock: () => void }) {
  const [open, setOpen] = useState(false);
  const acc = accuracyNumber(grade);
  const cov = coverageText(grade.coverage, grade.topics_total);
  const pct = grade.bar_needed ? Math.min(100, (grade.bar / grade.bar_needed) * 100) : 100;
  const readyButCapped = grade.capped && grade.bar_needed !== null && grade.bar >= grade.bar_needed;
  const holdLeft = grade.hold ? Math.max(0, 7 - grade.hold.right) : 0;

  return (
    <section aria-label="Your grade in this course" className="rounded-2xl border border-gray-200 bg-white p-3 sm:p-4 dark:bg-white/[0.04] dark:border-white/10">
      <div className="flex items-center gap-3">
        <GradeBadge label={grade.label} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 truncate dark:text-gray-100">
            Grade {grade.label}{grade.next_label ? <> · next {grade.next_label}</> : <> · top grade</>}
          </p>
          <p className="text-xs text-gray-500 line-clamp-2 dark:text-gray-400">{nextStepText(grade)}</p>
        </div>
        {readyButCapped ? (
          <button onClick={onUnlock} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 flex-shrink-0">
            <Lock className="w-3.5 h-3.5" />Unlock
          </button>
        ) : (
          <Link href={`/practice/${slug}?mode=climb`} aria-label={grade.next_label ? `Climb to ${grade.next_label}: 10 questions` : 'Climb: hold your A'}
            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 flex-shrink-0">
            <Mountain className="w-3.5 h-3.5" />Climb
          </Link>
        )}
      </div>

      {grade.bar_needed !== null && (
        <div className="mt-2.5 flex items-center gap-2">
          <div className="h-2 flex-1 rounded-full bg-gray-100 overflow-hidden dark:bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={grade.bar_needed} aria-valuenow={grade.bar} aria-label={`Correct answers towards ${grade.next_label}`}>
            <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[11px] text-gray-500 tabular-nums flex-shrink-0 dark:text-gray-400">{grade.bar}/{grade.bar_needed}</span>
        </div>
      )}

      {grade.slipping && (
        <p role="status" className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
          <span>
            Your {grade.label} is slipping. Get 7 of your next 10 right to hold it
            {grade.hold && grade.hold.answered > 0 ? <> ({grade.hold.right} of {grade.hold.answered} so far{holdLeft > 0 ? `, ${holdLeft} more right needed` : ''})</> : null}.
          </span>
        </p>
      )}

      <ol className="mt-2.5 grid grid-cols-9 gap-1" aria-label="The grades, F to A">
        {GRADE_LABELS.map((label, stage) => {
          const current = stage === grade.stage;
          const done = stage < grade.stage;
          const locked = grade.free && stage >= 4;
          return (
            <li key={label} title={`${label}: ${RULES[stage]}`}
              aria-current={current ? 'step' : undefined}
              className={`flex items-center justify-center rounded-md py-1 text-[11px] font-semibold ${
                current ? 'bg-blue-600 text-white'
                  : done ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                  : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400'
              } ${locked ? 'opacity-50' : ''}`}>
              {locked && !current ? <Lock className="w-2.5 h-2.5" aria-label={`${label}, locked on a free course`} /> : label}
            </li>
          );
        })}
      </ol>

      <button onClick={() => setOpen(v => !v)} aria-expanded={open}
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
        How grades work <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-xs text-gray-600 dark:text-gray-400">
          <ul className="space-y-0.5">
            <li>{acc === null ? 'No answers counted yet' : <>Last {grade.n30} answers: {Math.round(acc)}%{grade.acc_needed !== null && <> (need {grade.acc_needed}%)</>}</>}</li>
            {cov && <li>{cov}</li>}
            {grade.coverage?.kind === 'at60' && <li>Mock exam at 70%+ in the last 30 days: {grade.coverage.mock ? 'done' : 'not yet'}</li>}
            <li>Best grade: {grade.best_label}</li>
          </ul>
          <ul className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-x-4 gap-y-0.5">
            {[...GRADE_LABELS].map((label, stage) => ({ label, stage })).reverse().map(({ label, stage }) => (
              <li key={label} className="flex gap-2"><span className="w-6 font-semibold text-gray-900 dark:text-gray-100">{label}</span><span className="min-w-0">{RULES[stage]}</span></li>
            ))}
          </ul>
          {grade.free && <p>On your free course you can climb to D+. C to A need every topic.</p>}
        </div>
      )}
    </section>
  );
}
