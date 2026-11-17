import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Navbar, Footer } from '@/components/layout';
import { SkillIcon, skillAccent } from '@/components/skills/SkillCard';
import { getSkillCourses } from '@/lib/skillsData';
import { weeksLabel } from '@/lib/skills';
import { ArrowLeft, Check } from 'lucide-react';
import { EnrolPanel } from './EnrolPanel';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const course = (await getSkillCourses()).find(c => c.slug === slug);
  return course
    ? { title: `${course.title} — PastCS Skills`, description: course.tagline }
    : { title: 'Skills — PastCS' };
}

export default async function SkillPage({ params }: Props) {
  const { slug } = await params;
  const courses = await getSkillCourses();
  const index = courses.findIndex(c => c.slug === slug);
  if (index < 0) notFound();
  const course = courses[index];
  const a = skillAccent(index);

  return (
    <div className="font-jakarta min-h-screen bg-[#fdf8f2] overflow-x-hidden">
      <Navbar />

      <main className="max-w-6xl mx-auto px-4 pt-10 pb-20">
        <Link href="/skills" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#8a7f6f] hover:text-[#2b2420] mb-8">
          <ArrowLeft className="w-4 h-4" /> All skills
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8 lg:gap-12 items-start">
          <div className="min-w-0">
            <div className="flex items-center gap-4 mb-5">
              <SkillIcon slug={course.slug} index={index} size="lg" />
              <span className="text-[12px] font-bold px-2.5 py-1 rounded-full" style={{ background: a.bg, color: a.fg }}>
                {weeksLabel(course.duration_days)} of live teaching
              </span>
            </div>
            <h1 className="text-3xl md:text-[42px] font-extrabold text-[#2b2420] leading-[1.12] tracking-tight mb-3">{course.title}</h1>
            <p className="text-lg text-[#8a7f6f] leading-relaxed mb-8">{course.tagline}</p>

            {course.description && (
              <div className="space-y-4 text-[15.5px] text-[#4a4038] leading-relaxed mb-10">
                {course.description.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}
              </div>
            )}

            {course.outcomes.length > 0 && (
              <section className="bg-[#fffdf9] border border-[#efe2d0] rounded-[20px] p-6">
                <h2 className="font-extrabold text-[#2b2420] mb-4">What you’ll be able to do</h2>
                <ul className="space-y-3">
                  {course.outcomes.map(o => (
                    <li key={o} className="flex gap-3 text-[15px] text-[#4a4038] leading-snug">
                      <span className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: a.bg }}>
                        <Check className="w-3.5 h-3.5" style={{ color: a.fg }} strokeWidth={2.6} />
                      </span>
                      <span className="pt-0.5">{o}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <div className="lg:sticky lg:top-24">
            <EnrolPanel course={course} />
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
