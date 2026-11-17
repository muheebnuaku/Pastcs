import type { Metadata } from 'next';
import { Navbar, Footer } from '@/components/layout';
import { SkillCard } from '@/components/skills/SkillCard';
import { getSkillCourses } from '@/lib/skillsData';
import { CalendarDays, MessagesSquare, Rocket, Wallet } from 'lucide-react';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Skills — PastCS',
  description: 'Learn Vibe Coding, AI Automation and WhatsApp AI bots with live teaching from PastCS.',
};

const how = [
  { icon: Wallet, title: 'Pay once', text: 'Pay with Mobile Money or card. No subscription.' },
  { icon: MessagesSquare, title: 'Join the class', text: 'Your class link appears on the course page the moment you pay.' },
  { icon: CalendarDays, title: 'Learn with a teacher', text: 'Live teaching and help with your project for the length of the course.' },
];

export default async function SkillsPage() {
  const courses = await getSkillCourses();

  return (
    <div className="font-jakarta min-h-screen bg-[#fdf8f2] overflow-x-hidden">
      <Navbar />

      <section className="max-w-7xl mx-auto px-4 pt-14 pb-12">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 bg-[#f7ede1] px-3.5 py-1.5 rounded-full mb-5">
            <Rocket className="w-4 h-4 text-[#e8603c]" />
            <span className="text-sm font-semibold text-[#8a6a52]">PastCS Skills</span>
          </div>
          <h1 className="text-4xl md:text-[46px] font-extrabold text-[#2b2420] leading-[1.1] tracking-tight mb-4">
            Learn a skill people will pay you for.
          </h1>
          <p className="text-lg text-[#8a7f6f] leading-relaxed">
            Short, hands-on courses in building with AI, taught live. You finish with something
            working: an app, an automation or a bot you can show, use or sell.
          </p>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 pb-16">
        {courses.length === 0 ? (
          <div className="bg-[#fffdf9] border border-dashed border-[#e3d3bd] rounded-[20px] p-10 text-center">
            <p className="font-bold text-[#2b2420] mb-1">New courses are on the way</p>
            <p className="text-sm text-[#8a7f6f]">Check back soon.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {courses.map((c, i) => <SkillCard key={c.id} course={c} index={i} />)}
          </div>
        )}
      </section>

      <section className="bg-[#f7ede1] py-16 px-4">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-2xl md:text-[30px] font-extrabold text-[#2b2420] tracking-tight mb-8">How it works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {how.map(({ icon: Icon, title, text }, i) => (
              <div key={title} className="bg-[#fffdf9] border border-[#efe2d0] rounded-[20px] p-6">
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-9 h-9 rounded-xl bg-[#fde3da] text-[#e8603c] font-extrabold flex items-center justify-center">{i + 1}</span>
                  <Icon className="w-5 h-5 text-[#8a7f6f]" />
                </div>
                <h3 className="font-bold text-[#2b2420] mb-1">{title}</h3>
                <p className="text-sm text-[#8a7f6f] leading-relaxed">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
