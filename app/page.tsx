import Link from 'next/link';
import { Button } from '@/components/ui';
import { Navbar, Footer } from '@/components/layout';
import { createClient } from '@/lib/supabase/server';
import {
  GraduationCap,
  BookOpen,
  Target,
  ArrowRight,
  BarChart3,
  Clock,
  Trophy,
  Sparkles,
  Star,
  ArrowLeft,
  PauseCircle,
  Send,
} from 'lucide-react';

const ACCENTS = ['#e8603c', '#2f9e8f', '#dba514'];
const ACCENT_BG = ['#fde3da', '#dcf1ee', '#fbe9b8'];

const courses = [
  {
    code: 'DCIT101',
    name: 'Introduction to Computer Science',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={ACCENTS[0]} strokeWidth="1.8">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M9 9h6M9 13h6M9 17h3" />
      </svg>
    ),
  },
  {
    code: 'DCIT103',
    name: 'Office Productivity Tools',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={ACCENTS[1]} strokeWidth="1.8">
        <rect x="3" y="4" width="18" height="14" rx="2" />
        <path d="M8 21h8M12 18v3" />
      </svg>
    ),
  },
  {
    code: 'DCIT105',
    name: 'Mathematics for IT Professionals',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={ACCENTS[2]} strokeWidth="1.8">
        <path d="M4 19V6a2 2 0 0 1 2-2h6l4 4v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
        <path d="M9 12h6M9 16h4" />
      </svg>
    ),
  },
];

const features = [
  { icon: BookOpen, title: 'Extensive question bank', description: 'Hundreds of practice questions, built from real past-exam patterns.' },
  { icon: Target, title: 'Timed exam simulation', description: 'Sessions that mirror the pressure of your actual papers.' },
  { icon: Sparkles, title: 'AI tutor', description: 'Upload slides or paste notes and get a full lesson read back to you.' },
  { icon: BarChart3, title: 'Performance analytics', description: 'Track progress and pinpoint weak topics with detailed breakdowns.' },
  { icon: Trophy, title: 'Course leaderboards', description: 'See how you rank among coursemates and stay motivated.' },
  { icon: Clock, title: 'Daily practice streaks', description: 'Build a study habit that sticks, one day at a time.' },
];

const stats = [
  { value: '500+', label: 'Students' },
  { value: '6+', label: 'Courses' },
  { value: 'All', label: 'IT Levels' },
  { value: '1000+', label: 'Questions' },
];

interface Testimonial {
  id: string;
  quote: string;
  user: { full_name: string | null; program: string | null; avatar_url: string | null } | null;
}

async function getTestimonials(): Promise<Testimonial[]> {
  try {
    const supabase = await createClient();

    const { data: tData } = await supabase
      .from('testimonials')
      .select('id, quote, user_id')
      .eq('is_approved', true)
      .order('created_at', { ascending: false })
      .limit(6);

    const testimonials = (tData ?? []) as Array<{ id: string; quote: string; user_id: string | null }>;
    const userIds = testimonials.map(t => t.user_id).filter(Boolean) as string[];

    const userMap: Record<string, { full_name: string | null; program: string | null; avatar_url: string | null }> = {};
    if (userIds.length > 0) {
      const { data: uData } = await supabase
        .from('users')
        .select('id, full_name, program, avatar_url')
        .in('id', userIds);
      for (const u of (uData ?? []) as Array<{ id: string; full_name: string | null; program: string | null; avatar_url: string | null }>) {
        userMap[u.id] = u;
      }
    }

    return testimonials.map(t => ({
      id: t.id,
      quote: t.quote,
      user: t.user_id ? userMap[t.user_id] ?? null : null,
    }));
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const testimonials = await getTestimonials();
  return (
    <div className="font-jakarta min-h-screen bg-[#fdf8f2] overflow-x-hidden">
      <Navbar />

      {/* ── Hero ── */}
      <section className="max-w-7xl mx-auto px-4 pt-16 pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">
          <div>
            <div className="animate-fade-in-up delay-100 inline-flex items-center gap-2 bg-[#f7ede1] px-3.5 py-1.5 rounded-full mb-6">
              <GraduationCap className="w-4 h-4 text-[#e8603c]" />
              <span className="text-sm font-semibold text-[#8a6a52]">University of Ghana &middot; DCIT Students</span>
            </div>

            <h1 className="animate-fade-in-up delay-200 text-4xl md:text-[50px] font-extrabold text-[#2b2420] mb-5 leading-[1.1] tracking-tight">
              Practice like the exam<br />
              <span className="relative inline-block">
                already happened.
                <svg width="100%" height="10" viewBox="0 0 300 10" preserveAspectRatio="none" className="absolute left-0 -bottom-1.5 w-full">
                  <path d="M2 7 Q 75 1 150 6 T 298 5" fill="none" stroke="#f2b705" strokeWidth="5" strokeLinecap="round" />
                </svg>
              </span>
            </h1>

            <p className="animate-fade-in-up delay-300 text-lg text-[#8a7f6f] mb-8 leading-relaxed max-w-lg">
              PastCS turns your course outline into real preparation — a growing bank of practice
              questions, timed mock exams, and an AI tutor that explains what you got wrong. Built
              for University of Ghana Computer Science students.
            </p>

            <div className="animate-fade-in-up delay-400 flex flex-col sm:flex-row gap-3.5 mb-8">
              <Link href="/register">
                <Button size="lg" className="w-full sm:w-auto rounded-2xl bg-[#e8603c] hover:bg-[#c94f2f] focus:ring-[#e8603c] shadow-[0_10px_24px_-8px_rgba(232,96,60,0.55)]">
                  Start Practising Free
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </Link>
              <Link href="/login">
                <Button size="lg" variant="outline" className="w-full sm:w-auto rounded-2xl border-[#efe2d0] text-[#2b2420] hover:bg-[#f7ede1] focus:ring-[#e8603c]">
                  Sign In
                </Button>
              </Link>
            </div>

            <div className="animate-fade-in-up delay-500 flex flex-wrap gap-2.5">
              {[
                { label: '500+ students', color: '#e8603c' },
                { label: '1000+ questions', color: '#2f9e8f' },
                { label: 'Free to start', color: '#dba514' },
              ].map(({ label, color }) => (
                <span key={label} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#8a7f6f] bg-white border border-[#efe2d0] px-3 py-1.5 rounded-full">
                  <span className="w-[7px] h-[7px] rounded-full" style={{ background: color }} />
                  {label}
                </span>
              ))}
            </div>
          </div>

          {/* Hero visual */}
          <div className="animate-slide-right delay-300 relative p-5">
            <div className="absolute w-[220px] h-[220px] rounded-full opacity-35 blur-sm -top-2 right-2.5" style={{ background: '#f2b705' }} />
            <div className="absolute w-[180px] h-[180px] rounded-full opacity-25 blur-sm -bottom-2 left-0" style={{ background: '#2f9e8f' }} />

            <div className="relative bg-[#fffdf9] border border-[#efe2d0] rounded-[28px] overflow-hidden shadow-2xl" style={{ transform: 'rotate(-1.2deg)' }}>
              <div className="flex items-center gap-2 px-[18px] py-3.5 border-b border-[#f3e9db]">
                <span className="w-2 h-2 rounded-full bg-[#f0e3d2]" />
                <span className="w-2 h-2 rounded-full bg-[#f0e3d2]" />
                <span className="w-2 h-2 rounded-full bg-[#f0e3d2]" />
                <span className="mx-auto text-xs text-[#a89a86]">app.pastcs.com/dashboard</span>
              </div>
              <div className="p-6">
                <p className="text-[15px] font-bold text-[#2b2420] mb-0.5">Welcome back, Ama</p>
                <p className="text-xs text-[#a89a86] mb-5">12-day streak — keep it going</p>

                <div className="grid grid-cols-4 gap-2.5 mb-5">
                  <div className="bg-[#fdf8f2] border border-[#f3e9db] rounded-2xl p-3">
                    <div className="w-[26px] h-[26px] rounded-lg bg-[#fde3da] flex items-center justify-center mb-2">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="#e8603c" stroke="none"><path d="M12 2.5c.5 4.5 6 6.7 6 12.2a6 6 0 0 1-12 0c0-1.6.5-2.8 1.2-3.9.5 1.4 1.7 2 2.3 1.1-.7-2.6.3-5.3 2.5-9.4Z"/></svg>
                    </div>
                    <p className="text-xl font-extrabold text-[#2b2420] leading-none">12</p>
                    <p className="text-[10.5px] text-[#a89a86] mt-1">Day Streak</p>
                  </div>
                  <div className="bg-[#fdf8f2] border border-[#f3e9db] rounded-2xl p-3">
                    <div className="w-[26px] h-[26px] rounded-lg bg-[#dcf1ee] flex items-center justify-center mb-2">
                      <Target className="w-3.5 h-3.5" style={{ color: '#2f9e8f' }} />
                    </div>
                    <p className="text-xl font-extrabold text-[#2b2420] leading-none">34</p>
                    <p className="text-[10.5px] text-[#a89a86] mt-1">Tests Taken</p>
                  </div>
                  <div className="bg-[#fdf8f2] border border-[#f3e9db] rounded-2xl p-3">
                    <div className="w-[26px] h-[26px] rounded-lg bg-[#fbe9b8] flex items-center justify-center mb-2">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#dba514" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-9"/></svg>
                    </div>
                    <p className="text-xl font-extrabold text-[#2b2420] leading-none">78%</p>
                    <p className="text-[10.5px] text-[#a89a86] mt-1">Avg. Score</p>
                  </div>
                  <div className="bg-[#fdf8f2] border border-[#f3e9db] rounded-2xl p-3">
                    <div className="w-[26px] h-[26px] rounded-lg bg-[#fde3da] flex items-center justify-center mb-2">
                      <BookOpen className="w-3.5 h-3.5" style={{ color: '#e8603c' }} />
                    </div>
                    <p className="text-xl font-extrabold text-[#2b2420] leading-none">5/6</p>
                    <p className="text-[10.5px] text-[#a89a86] mt-1">Courses</p>
                  </div>
                </div>

                <div className="border border-[#f3e9db] rounded-2xl overflow-hidden">
                  <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-[#f7efe4]">
                    <span className="w-7 h-7 rounded-lg bg-[#f7ede1] flex-shrink-0" />
                    <span className="flex-1 text-[12.5px] font-bold text-[#2b2420]">DCIT101 — Intro to Computer Science</span>
                    <span className="text-[10.5px] text-[#a89a86]">120q</span>
                  </div>
                  <div className="flex items-center gap-2.5 px-3.5 py-3">
                    <span className="w-7 h-7 rounded-lg bg-[#f7ede1] flex-shrink-0" />
                    <span className="flex-1 text-[12.5px] font-bold text-[#2b2420]">DCIT105 — Math for IT Professionals</span>
                    <span className="text-[10.5px] text-[#a89a86]">95q</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Trust / stats ── */}
      <section className="border-y border-[#efe2d0]">
        <div className="max-w-3xl mx-auto grid grid-cols-2 md:grid-cols-4 py-9 px-4">
          {stats.map(({ value, label }) => (
            <div key={label} className="text-center">
              <p className="text-[28px] font-extrabold text-[#2b2420]">{value}</p>
              <p className="text-[#a89a86] text-xs mt-1 uppercase tracking-wider">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── See it in action ── */}
      <section className="max-w-7xl mx-auto px-4 py-24">
        <div className="max-w-xl mb-13">
          <p className="text-[13px] font-bold text-[#e8603c] uppercase tracking-wide mb-3">See it in action</p>
          <h2 className="text-3xl md:text-[34px] font-extrabold text-[#2b2420] tracking-tight">The actual product, not a promise.</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Quiz screen mockup */}
          <div className="bg-[#fffdf9] border border-[#efe2d0] rounded-3xl overflow-hidden shadow-lg">
            <div className="px-[22px] pt-[22px]">
              <div className="flex items-center justify-between mb-3.5">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-[#8a7f6f]"><ArrowLeft className="w-3.5 h-3.5" /> Exit</span>
                <span className="bg-[#eaf1fb] text-[#2563eb] text-[11.5px] font-bold px-2.5 py-1 rounded-full">Question 4 of 15</span>
                <span className="flex items-center gap-1 text-[#b0842a] bg-[#fbf1de] text-[11.5px] font-semibold px-2.5 py-1 rounded-lg">
                  <PauseCircle className="w-3 h-3" /> Pause
                </span>
              </div>
              <div className="h-1.5 bg-[#f3e9db] rounded-full overflow-hidden mb-4.5">
                <div className="w-[27%] h-full bg-[#2563eb] rounded-full" />
              </div>
            </div>
            <div className="px-[22px] pb-6">
              <span className="inline-block bg-[#f7ede1] text-[#8a7f6f] text-[11px] font-bold px-2.5 py-1 rounded-md mb-3.5">Single Choice</span>
              <p className="text-[15px] font-semibold text-[#2b2420] mb-4 leading-relaxed">Which data structure uses LIFO (Last In, First Out) ordering?</p>
              <div className="flex flex-col gap-2.5">
                <div className="border-2 border-[#efe2d0] rounded-xl px-3.5 py-2.5 flex items-center gap-2.5">
                  <span className="w-[18px] h-[18px] rounded-full border-2 border-[#d8cbb8] flex-shrink-0" />
                  <span className="text-[13.5px] text-[#4a4038]">Queue</span>
                </div>
                <div className="border-2 border-[#2563eb] bg-[#eaf1fb] rounded-xl px-3.5 py-2.5 flex items-center gap-2.5">
                  <span className="w-[18px] h-[18px] rounded-full border-2 border-[#2563eb] bg-[#2563eb] flex-shrink-0" />
                  <span className="text-[13.5px] text-[#1e3a6b] font-semibold">Stack</span>
                </div>
                <div className="border-2 border-[#efe2d0] rounded-xl px-3.5 py-2.5 flex items-center gap-2.5">
                  <span className="w-[18px] h-[18px] rounded-full border-2 border-[#d8cbb8] flex-shrink-0" />
                  <span className="text-[13.5px] text-[#4a4038]">Linked List</span>
                </div>
              </div>
            </div>
          </div>

          {/* AI Tutor mockup */}
          <div className="bg-[#fffdf9] border border-[#efe2d0] rounded-3xl overflow-hidden shadow-lg flex flex-col">
            <div className="px-[22px] py-[18px] border-b border-[#f3e9db] flex items-center gap-2.5">
              <div className="w-[30px] h-[30px] rounded-lg bg-[#2563eb] flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <span className="text-sm font-bold text-[#2b2420]">AI Study Assistant</span>
            </div>
            <div className="px-[22px] py-5 flex flex-col gap-3 flex-1">
              <div className="flex justify-end">
                <div className="max-w-[80%] bg-[#2563eb] text-white rounded-2xl rounded-tr-sm px-3.5 py-2.5">
                  <p className="text-[13px] leading-relaxed m-0">Why does a stack overflow happen with deep recursion?</p>
                </div>
              </div>
              <div className="flex gap-2">
                <div className="w-[26px] h-[26px] rounded-lg bg-[#2563eb] flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-3.5 h-3.5 text-white" />
                </div>
                <div className="max-w-[82%] bg-[#fdf8f2] border border-[#f3e9db] rounded-2xl rounded-tl-sm px-3.5 py-2.5">
                  <p className="text-[13px] leading-relaxed text-[#4a4038] m-0">Each recursive call reserves its own slice of the call stack. Go deep enough — say, recursion with no base case — and you run out of that reserved memory. Think of it like plates stacking up until the table gives way.</p>
                </div>
              </div>
            </div>
            <div className="px-[22px] py-3.5 border-t border-[#f3e9db] flex items-center gap-2.5">
              <span className="flex-1 text-[12.5px] text-[#a89a86] border border-[#f3e9db] rounded-full px-3.5 py-2.5">Ask anything, or upload a document...</span>
              <div className="w-8 h-8 rounded-full bg-[#2563eb] flex items-center justify-center flex-shrink-0">
                <Send className="w-3.5 h-3.5 text-white" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="bg-[#f7ede1] py-24 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-xl mx-auto mb-16">
            <p className="text-[13px] font-bold text-[#e8603c] uppercase tracking-wide mb-3">How it works</p>
            <h2 className="text-3xl md:text-[34px] font-extrabold text-[#2b2420] tracking-tight">Get started in minutes, build better habits in days.</h2>
          </div>

          <div className="flex flex-col md:flex-row gap-6">
            {[
              { n: '1', bg: '#fde3da', color: '#e8603c', title: 'Create your account', desc: 'Sign up free in under a minute — no card needed.' },
              { n: '2', bg: '#dcf1ee', color: '#2f9e8f', title: 'Pick your course', desc: 'Select your level and semester — we load exactly the DCIT courses you need.', lift: true },
              { n: '3', bg: '#fbe9b8', color: '#dba514', title: 'Start practising', desc: 'Take practice quizzes or mock exams, review results, and keep improving.' },
            ].map((step) => (
              <div key={step.n} className={`flex-1 bg-[#fffdf9] border border-[#efe2d0] rounded-[20px] p-7 ${step.lift ? 'md:-translate-y-5' : ''}`}>
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-4.5 font-extrabold text-[17px]" style={{ background: step.bg, color: step.color }}>
                  {step.n}
                </div>
                <h3 className="text-[17px] font-bold text-[#2b2420] mb-2">{step.title}</h3>
                <p className="text-[14.5px] leading-relaxed text-[#8a7f6f]">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Courses ── */}
      <section className="max-w-7xl mx-auto px-4 py-24">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-11">
          <div>
            <p className="text-[13px] font-bold text-[#e8603c] uppercase tracking-wide mb-3">Level 100 &middot; Semester 1</p>
            <h2 className="text-3xl md:text-[34px] font-extrabold text-[#2b2420] tracking-tight">Available courses</h2>
          </div>
          <p className="text-[14.5px] text-[#8a7f6f] max-w-xs">Showing Level 100, Semester 1. Every level unlocks after sign-up.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {courses.map((course, i) => (
            <Link key={course.code} href="/register" className="group">
              <div className="bg-[#fffdf9] border border-[#efe2d0] rounded-[20px] p-6 h-full">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-5" style={{ background: ACCENT_BG[i] }}>
                  {course.icon}
                </div>
                <h3 className="font-bold text-[#2b2420] mb-1">{course.code}</h3>
                <p className="text-sm text-[#8a7f6f] mb-5">{course.name}</p>
                <div className="flex items-center text-sm font-bold gap-1.5" style={{ color: ACCENTS[i] }}>
                  Start Practice
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-5 bg-[#2b2420] rounded-[20px] p-7 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <p className="font-bold text-[#fdf8f2] mb-1">Courses for every level are included</p>
            <p className="text-sm text-[#c4b8a6]">Level 200, 300 &amp; 400 courses unlock right after sign-up.</p>
          </div>
          <Link href="/register" className="w-full sm:w-auto flex-shrink-0">
            <Button className="w-full sm:w-auto rounded-2xl bg-[#e8603c] hover:bg-[#c94f2f] focus:ring-[#e8603c]">
              Get Full Access <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="bg-[#f7ede1] py-24 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="max-w-xl mb-13">
            <p className="text-[13px] font-bold text-[#e8603c] uppercase tracking-wide mb-3">What you get</p>
            <h2 className="text-3xl md:text-[34px] font-extrabold text-[#2b2420] tracking-tight">Everything you need to prepare, nothing you don&rsquo;t.</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {features.map((feature, i) => {
              const idx = i % 3;
              return (
                <div key={i} className="bg-[#fffdf9] border border-[#efe2d0] rounded-[20px] p-6 flex gap-4">
                  <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: ACCENT_BG[idx] }}>
                    <feature.icon className="w-5 h-5" style={{ color: ACCENTS[idx] }} strokeWidth={1.7} />
                  </div>
                  <div>
                    <h3 className="font-bold text-[#2b2420] mb-1.5">{feature.title}</h3>
                    <p className="text-sm leading-relaxed text-[#8a7f6f]">{feature.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Testimonials ── */}
      {testimonials.length > 0 && (
        <section className="py-24 px-4">
          <div className="max-w-7xl mx-auto">
            <div className="max-w-xl mb-5">
              <p className="text-[13px] font-bold text-[#e8603c] uppercase tracking-wide mb-3">Student voices</p>
              <h2 className="text-3xl md:text-[34px] font-extrabold text-[#2b2420] tracking-tight mb-4">What students are saying.</h2>
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-3.5 h-3.5 text-[#f2b705] fill-[#f2b705]" />
                  ))}
                </div>
                <span className="text-sm text-[#8a7f6f]">4.9 / 5 from 200+ students</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-9">
              {testimonials.map((t, i) => (
                <div key={t.id} className="bg-[#fffdf9] border border-[#efe2d0] rounded-[20px] p-6 flex flex-col">
                  <span className="text-[38px] font-extrabold text-[#f0e1cf] leading-[0.6] block mb-2.5">&ldquo;</span>
                  <p className="text-[14.5px] leading-relaxed text-[#4a4038] flex-1 mb-5 min-h-[96px]">{t.quote}</p>
                  <div className="flex items-center gap-2.5 pt-4 border-t border-[#f3e9db]">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[13px] font-extrabold flex-shrink-0" style={{ background: ACCENTS[i % 3] }}>
                      {(t.user?.full_name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-[13.5px] font-bold text-[#2b2420]">{t.user?.full_name || 'Student'}</p>
                      {t.user?.program && <p className="text-[11.5px] text-[#a89a86]">{t.user.program}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── CTA ── */}
      <section className="max-w-7xl mx-auto px-4 pb-24">
        <div className="rounded-[32px] px-6 py-20 text-center" style={{ background: 'linear-gradient(135deg, #e8603c 0%, #dba514 100%)' }}>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4 tracking-tight">Ready to start practising?</h2>
          <p className="text-white/90 text-lg mb-8 max-w-lg mx-auto">Join students already using PastCS to prepare smarter for their DCIT exams.</p>
          <div className="flex flex-col sm:flex-row gap-3.5 justify-center">
            <Link href="/register">
              <Button size="lg" className="rounded-2xl bg-white text-[#e8603c] hover:bg-[#fff5ef] w-full sm:w-auto">
                Create Free Account <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline" className="rounded-2xl border-white/50 text-white hover:bg-white/10 w-full sm:w-auto">
                Sign In
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
