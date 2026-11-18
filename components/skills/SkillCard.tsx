import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { ghc } from '@/lib/groupPayments';
import { weeksLabel, type SkillCourse } from '@/lib/skills';
import { SkillArt } from './SkillArt';

const ACCENTS = [
  { fg: '#e8603c', bg: '#fde3da' },
  { fg: '#2f9e8f', bg: '#dcf1ee' },
  { fg: '#b8860b', bg: '#fbe9b8' },
];

export function skillAccent(i: number) {
  return ACCENTS[i % ACCENTS.length];
}

export function SkillCard({ course, index, compact = false }: { course: SkillCourse; index: number; compact?: boolean }) {
  const a = skillAccent(index);
  const outcomes = compact ? course.outcomes.slice(0, 3) : course.outcomes;
  return (
    <Link href={`/skills/${course.slug}`} className="group block h-full">
      <article className="bg-[#fffdf9] border border-[#efe2d0] rounded-[20px] overflow-hidden h-full flex flex-col transition-shadow group-hover:shadow-[0_14px_32px_-16px_rgba(43,36,32,0.25)]">
        <SkillArt slug={course.slug} title={course.title} imageUrl={course.image_url} />
        <div className="p-6 flex-1 flex flex-col">
          <span className="self-start text-[12px] font-bold px-2.5 py-1 rounded-full mb-3 whitespace-nowrap" style={{ background: a.bg, color: a.fg }}>
            {weeksLabel(course.duration_days)} of teaching
          </span>
          <h3 className="text-lg font-extrabold text-[#2b2420] mb-1">{course.title}</h3>
          <p className="text-sm text-[#8a7f6f] mb-4 leading-relaxed">{course.tagline}</p>
          {outcomes.length > 0 && (
            <ul className="space-y-2 mb-6 flex-1">
              {outcomes.map(o => (
                <li key={o} className="flex gap-2 text-[13.5px] text-[#4a4038] leading-snug">
                  <Check className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: a.fg }} strokeWidth={2.4} />
                  <span>{o}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-end justify-between gap-3 pt-4 border-t border-[#f3e9db] mt-auto">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#a89a86]">One payment</p>
              <p className="text-2xl font-extrabold text-[#2b2420] leading-tight">{ghc(course.price)}</p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-sm font-bold whitespace-nowrap" style={{ color: a.fg }}>
              View course
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}
