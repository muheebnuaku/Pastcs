import Link from 'next/link';
import { ArrowRight, Bot, Check, Code2, Workflow } from 'lucide-react';
import { ghc } from '@/lib/groupPayments';
import { weeksLabel, type SkillCourse } from '@/lib/skills';

const ACCENTS = [
  { fg: '#e8603c', bg: '#fde3da' },
  { fg: '#2f9e8f', bg: '#dcf1ee' },
  { fg: '#b8860b', bg: '#fbe9b8' },
];

// A known course gets its own icon; one an admin adds later gets the
// automation one.
function iconKind(slug: string): 'bot' | 'code' | 'flow' {
  if (slug.includes('whatsapp') || slug.includes('bot')) return 'bot';
  if (slug.includes('cod')) return 'code';
  return 'flow';
}

export function skillAccent(i: number) {
  return ACCENTS[i % ACCENTS.length];
}

export function SkillIcon({ slug, index, size = 'md' }: { slug: string; index: number; size?: 'md' | 'lg' }) {
  const kind = iconKind(slug);
  const a = skillAccent(index);
  const iconProps = { className: size === 'lg' ? 'w-7 h-7' : 'w-6 h-6', style: { color: a.fg }, strokeWidth: 1.8 };
  const box = size === 'lg' ? 'w-14 h-14 rounded-2xl' : 'w-12 h-12 rounded-2xl';
  return (
    <div className={`${box} flex items-center justify-center flex-shrink-0`} style={{ background: a.bg }}>
      {kind === 'bot' ? <Bot {...iconProps} /> : kind === 'code' ? <Code2 {...iconProps} /> : <Workflow {...iconProps} />}
    </div>
  );
}

export function SkillCard({ course, index, compact = false }: { course: SkillCourse; index: number; compact?: boolean }) {
  const a = skillAccent(index);
  const outcomes = compact ? course.outcomes.slice(0, 3) : course.outcomes;
  return (
    <Link href={`/skills/${course.slug}`} className="group block h-full">
      <article className="bg-[#fffdf9] border border-[#efe2d0] rounded-[20px] p-6 h-full flex flex-col transition-shadow group-hover:shadow-[0_14px_32px_-16px_rgba(43,36,32,0.25)]">
        <div className="flex items-start justify-between gap-3 mb-5">
          <SkillIcon slug={course.slug} index={index} />
          <span className="text-[12px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: a.bg, color: a.fg }}>
            {weeksLabel(course.duration_days)} of teaching
          </span>
        </div>
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
      </article>
    </Link>
  );
}
