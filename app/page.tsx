import Link from 'next/link';
import { Button } from '@/components/ui';
import { Navbar, Footer } from '@/components/layout';
import { createClient } from '@/lib/supabase/server';
import {
  GraduationCap,
  BookOpen,
  Target,
  ArrowRight,
  Check,
  BarChart3,
  Clock,
  Trophy,
  Sparkles,
  Layers,
  Star,
} from 'lucide-react';

const ACCENT = '#1f4a3a';

const courses = [
  {
    code: 'DCIT101',
    name: 'Introduction to Computer Science',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#faf7f0" strokeWidth="1.7">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M9 9h6M9 13h6M9 17h3" />
      </svg>
    ),
  },
  {
    code: 'DCIT103',
    name: 'Office Productivity Tools',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#faf7f0" strokeWidth="1.7">
        <rect x="3" y="4" width="18" height="14" rx="2" />
        <path d="M8 21h8M12 18v3" />
      </svg>
    ),
  },
  {
    code: 'DCIT105',
    name: 'Mathematics for IT Professionals',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#faf7f0" strokeWidth="1.7">
        <path d="M4 19V6a2 2 0 0 1 2-2h6l4 4v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
        <path d="M9 12h6M9 16h4" />
      </svg>
    ),
  },
];

const features = [
  {
    icon: BookOpen,
    title: 'Extensive question bank',
    description: 'Hundreds of practice questions across every course, built from real past-exam patterns.',
  },
  {
    icon: Target,
    title: 'Timed exam simulation',
    description: 'Simulate real exam pressure with timed sessions that mirror your actual papers.',
  },
  {
    icon: Sparkles,
    title: 'AI tutor',
    description: 'Upload your slides or paste your notes and get a full lesson explained back to you, with voice reading.',
  },
  {
    icon: BarChart3,
    title: 'Performance analytics',
    description: 'Track your progress over time and pinpoint weak topics with detailed breakdowns.',
  },
  {
    icon: Trophy,
    title: 'Course leaderboards',
    description: 'See how you rank among your coursemates and stay motivated to push higher.',
  },
  {
    icon: Clock,
    title: 'Daily practice streaks',
    description: 'Build consistent study habits with streaks that reward you for showing up every day.',
  },
];

const steps = [
  {
    number: '01',
    title: 'Create your account',
    description: 'Sign up free in under a minute — no card needed.',
  },
  {
    number: '02',
    title: 'Pick your course',
    description: 'Select your level and semester — we load exactly the DCIT courses you need.',
  },
  {
    number: '03',
    title: 'Start practising',
    description: 'Take practice quizzes or mock exams, review results, and keep improving.',
  },
];

const stats = [
  { value: '500+',  label: 'Students' },
  { value: '6+',    label: 'Courses' },
  { value: 'All',   label: 'IT Levels' },
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
    <div className="min-h-screen bg-[#faf7f0] overflow-x-hidden">
      <Navbar />

      {/* ── Hero ── */}
      <section className="pt-14 pb-20 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">

            {/* Left */}
            <div>
              <div className="animate-fade-in-up delay-100 inline-flex items-center gap-2 border border-[#e6e0d4] px-3.5 py-1.5 rounded-full text-[#57534a] text-sm font-medium mb-6">
                <GraduationCap className="w-4 h-4" />
                <span>University of Ghana &middot; DCIT Students</span>
              </div>

              <h1 className="animate-fade-in-up delay-200 font-serif text-4xl md:text-[50px] font-semibold text-[#1c1a17] mb-5 leading-[1.12] tracking-tight">
                Practice like the exam already happened.
              </h1>

              <p className="animate-fade-in-up delay-300 text-lg text-[#57534a] mb-8 leading-relaxed max-w-lg">
                PastCS turns your course outline into real preparation — a growing bank of practice
                questions, timed mock exams, and an AI tutor that explains what you got wrong. Built
                specifically for University of Ghana Computer Science students.
              </p>

              <div className="animate-fade-in-up delay-400 flex flex-col sm:flex-row gap-3 mb-10">
                <Link href="/register">
                  <Button size="lg" className="w-full sm:w-auto bg-[#1f4a3a] hover:bg-[#163a2d] focus:ring-[#1f4a3a]">
                    Start Practising Free
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </Link>
                <Link href="/login">
                  <Button size="lg" variant="outline" className="w-full sm:w-auto border-[#d9d2c2] text-[#1c1a17] hover:bg-[#f0ece0] focus:ring-[#1f4a3a]">
                    Sign In
                  </Button>
                </Link>
              </div>

              <div className="animate-fade-in-up delay-500 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[#57534a]">
                {['All IT levels covered', 'Free to get started', 'Tracks your progress'].map((item) => (
                  <div key={item} className="flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-[#1f4a3a] flex-shrink-0" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right — real product mockup, not a stock photo */}
            <div className="animate-slide-right delay-300 relative">
              <div className="bg-[#fffdf9] border border-[#e6e0d4] rounded-2xl overflow-hidden shadow-sm">
                {/* browser chrome */}
                <div className="flex items-center gap-2 px-4 py-3.5 border-b border-[#e6e0d4]">
                  <span className="w-2 h-2 rounded-full bg-[#e6e0d4]" />
                  <span className="w-2 h-2 rounded-full bg-[#e6e0d4]" />
                  <span className="w-2 h-2 rounded-full bg-[#e6e0d4]" />
                  <span className="mx-auto text-xs text-[#a39c8a]">app.pastcs.com/dashboard</span>
                </div>

                <div className="p-6">
                  <p className="text-[15px] font-semibold text-[#1c1a17] mb-0.5">Welcome back, Ama</p>
                  <p className="text-xs text-[#a39c8a] mb-5">12-day streak — keep it going</p>

                  <div className="grid grid-cols-4 gap-2.5 mb-5">
                    <div className="border border-[#e6e0d4] rounded-xl p-3">
                      <div className="w-7 h-7 rounded-lg bg-orange-100 flex items-center justify-center mb-2">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="#ea580c" stroke="none"><path d="M12 2.5c.5 4.5 6 6.7 6 12.2a6 6 0 0 1-12 0c0-1.6.5-2.8 1.2-3.9.5 1.4 1.7 2 2.3 1.1-.7-2.6.3-5.3 2.5-9.4Z"/></svg>
                      </div>
                      <p className="text-xl font-bold text-[#1c1a17] leading-none">12</p>
                      <p className="text-[10px] text-[#a39c8a] mt-1">Day Streak</p>
                    </div>
                    <div className="border border-[#e6e0d4] rounded-xl p-3">
                      <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center mb-2">
                        <Target className="w-3.5 h-3.5 text-blue-600" />
                      </div>
                      <p className="text-xl font-bold text-[#1c1a17] leading-none">34</p>
                      <p className="text-[10px] text-[#a39c8a] mt-1">Tests Taken</p>
                    </div>
                    <div className="border border-[#e6e0d4] rounded-xl p-3">
                      <div className="w-7 h-7 rounded-lg bg-green-100 flex items-center justify-center mb-2">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-9"/></svg>
                      </div>
                      <p className="text-xl font-bold text-[#1c1a17] leading-none">78%</p>
                      <p className="text-[10px] text-[#a39c8a] mt-1">Avg. Score</p>
                    </div>
                    <div className="border border-[#e6e0d4] rounded-xl p-3">
                      <div className="w-7 h-7 rounded-lg bg-purple-100 flex items-center justify-center mb-2">
                        <BookOpen className="w-3.5 h-3.5 text-purple-600" />
                      </div>
                      <p className="text-xl font-bold text-[#1c1a17] leading-none">5/6</p>
                      <p className="text-[10px] text-[#a39c8a] mt-1">Courses</p>
                    </div>
                  </div>

                  <div className="border border-[#e6e0d4] rounded-xl overflow-hidden">
                    <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-[#f0ece0]">
                      <span className="w-7 h-7 rounded-lg bg-[#f4efe4] flex-shrink-0" />
                      <span className="flex-1 text-[13px] font-semibold text-[#1c1a17]">DCIT101 — Intro to Computer Science</span>
                      <span className="text-[10px] text-[#a39c8a]">120q</span>
                    </div>
                    <div className="flex items-center gap-2.5 px-3.5 py-2.5">
                      <span className="w-7 h-7 rounded-lg bg-[#f4efe4] flex-shrink-0" />
                      <span className="flex-1 text-[13px] font-semibold text-[#1c1a17]">DCIT105 — Math for IT Professionals</span>
                      <span className="text-[10px] text-[#a39c8a]">95q</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="animate-float absolute -bottom-5 -left-5 bg-[#fffdf9] border border-[#e6e0d4] rounded-xl shadow-lg p-3.5 flex items-center gap-3">
                <div className="w-9 h-9 bg-[#1f4a3a] rounded-lg flex items-center justify-center flex-shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#faf7f0" strokeWidth="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                </div>
                <div>
                  <p className="text-xs text-[#a39c8a] leading-tight">Active Students</p>
                  <p className="font-bold text-[#1c1a17] text-sm">500+</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Trust / stats bar ── */}
      <section className="border-y border-[#e6e0d4]">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 py-9 px-4">
          {stats.map(({ value, label }, i) => (
            <div
              key={label}
              className={`text-center ${i < stats.length - 1 ? 'md:border-r border-[#e6e0d4]' : ''} animate-scale-in delay-${(i + 1) * 100}`}
            >
              <p className="font-serif text-3xl font-semibold text-[#1c1a17]">{value}</p>
              <p className="text-[#a39c8a] text-xs mt-1 uppercase tracking-wider">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="py-24 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="max-w-xl mb-14">
            <p className="animate-fade-in-up text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: ACCENT }}>
              How it works
            </p>
            <h2 className="animate-fade-in-up delay-100 font-serif text-3xl md:text-[34px] font-semibold text-[#1c1a17] tracking-tight">
              Get started in minutes, build better habits in days.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {steps.map((step, i) => (
              <div key={step.number} className={`animate-fade-in-up delay-${(i + 1) * 200}`}>
                <p className="font-serif text-base text-[#a39c8a] mb-3.5">{step.number}</p>
                <h3 className="font-semibold text-[#1c1a17] mb-2">{step.title}</h3>
                <p className="text-sm text-[#57534a] leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Courses ── */}
      <section className="py-24 px-4 bg-[#f4efe4] border-y border-[#e6e0d4]">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-wrap items-end justify-between gap-4 mb-11">
            <div>
              <p className="animate-fade-in-up text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: ACCENT }}>
                Level 100 &middot; Semester 1
              </p>
              <h2 className="animate-fade-in-up delay-100 font-serif text-3xl md:text-[34px] font-semibold text-[#1c1a17] tracking-tight">
                Available courses
              </h2>
            </div>
            <p className="animate-fade-in-up delay-200 text-[#57534a] max-w-sm text-sm">
              Showing Level 100, Semester 1. Every level unlocks after sign-up.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {courses.map((course, i) => (
              <Link key={course.code} href="/register" className="group">
                <div className={`animate-fade-in-up delay-${(i + 1) * 200} bg-[#fffdf9] rounded-xl p-6 border border-[#e6e0d4] hover:border-[#1f4a3a]/30 transition-colors`}>
                  <div className="flex items-start justify-between mb-5">
                    <div className="w-11 h-11 rounded-lg flex items-center justify-center" style={{ background: ACCENT }}>
                      {course.icon}
                    </div>
                    <span className="text-xs font-medium text-[#57534a] border border-[#e6e0d4] px-2.5 py-1 rounded-full">L100 &middot; S1</span>
                  </div>
                  <h3 className="font-semibold text-[#1c1a17] mb-1">{course.code}</h3>
                  <p className="text-sm text-[#57534a] mb-5">{course.name}</p>
                  <div className="flex items-center text-sm font-semibold" style={{ color: ACCENT }}>
                    Start Practice
                    <ArrowRight className="w-4 h-4 ml-1.5 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              </Link>
            ))}
          </div>

          <div className="animate-fade-in-up delay-400 mt-6 bg-[#fffdf9] rounded-xl border border-[#e6e0d4] p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: ACCENT }}>
                <Layers className="w-5 h-5 text-[#faf7f0]" />
              </div>
              <div>
                <p className="font-semibold text-[#1c1a17]">Courses for every level are included</p>
                <p className="text-sm text-[#57534a]">Level 200, 300 &amp; 400 courses unlock right after sign-up.</p>
              </div>
            </div>
            <Link href="/register" className="w-full sm:w-auto flex-shrink-0">
              <Button className="w-full sm:w-auto bg-[#1f4a3a] hover:bg-[#163a2d] focus:ring-[#1f4a3a]">
                Get Full Access <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="py-24 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="max-w-xl mb-14">
            <p className="animate-fade-in-up text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: ACCENT }}>
              What you get
            </p>
            <h2 className="animate-fade-in-up delay-100 font-serif text-3xl md:text-[34px] font-semibold text-[#1c1a17] tracking-tight">
              Everything you need to prepare, nothing you don&rsquo;t.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-[#e6e0d4] border border-[#e6e0d4] rounded-2xl overflow-hidden">
            {features.map((feature, i) => (
              <div
                key={i}
                className={`animate-fade-in-up delay-${(i % 3 + 1) * 100} bg-[#fffdf9] p-7`}
              >
                <feature.icon className="w-[22px] h-[22px] mb-4" style={{ color: ACCENT }} strokeWidth={1.6} />
                <h3 className="font-semibold text-[#1c1a17] mb-2">{feature.title}</h3>
                <p className="text-sm text-[#57534a] leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ── */}
      {testimonials.length > 0 && (
        <section className="py-24 px-4 bg-[#f4efe4] border-y border-[#e6e0d4]">
          <div className="max-w-7xl mx-auto">
            <div className="max-w-xl mb-12">
              <p className="animate-fade-in-up text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: ACCENT }}>
                Student voices
              </p>
              <h2 className="animate-fade-in-up delay-100 font-serif text-3xl md:text-[34px] font-semibold text-[#1c1a17] tracking-tight mb-4">
                What students are saying.
              </h2>
              <div className="animate-fade-in-up delay-200 flex items-center gap-2">
                <div className="flex gap-0.5">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-3.5 h-3.5 text-[#b8862c] fill-[#b8862c]" />
                  ))}
                </div>
                <span className="text-sm text-[#57534a]">4.9 / 5 from 200+ students</span>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {testimonials.map((t, i) => (
                <div
                  key={t.id}
                  className={`animate-fade-in-up delay-${(i % 3 + 1) * 100} bg-[#fffdf9] rounded-xl p-7 border border-[#e6e0d4] flex flex-col`}
                >
                  <span className="font-serif text-4xl text-[#d9d2c2] leading-none mb-2 block">&ldquo;</span>
                  <p className="text-[#3a372f] text-sm leading-relaxed flex-1">{t.quote}</p>
                  <div className="flex items-center gap-3 mt-6 pt-4 border-t border-[#f0ece0]">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-[#faf7f0] text-sm font-bold flex-shrink-0" style={{ background: ACCENT }}>
                      {(t.user?.full_name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[#1c1a17]">{t.user?.full_name || 'Student'}</p>
                      {t.user?.program && <p className="text-xs text-[#a39c8a]">{t.user.program}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── CTA ── */}
      <section className="py-24 px-4" style={{ background: ACCENT }}>
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="animate-fade-in-up font-serif text-3xl md:text-4xl font-semibold text-[#faf7f0] mb-4 tracking-tight">
            Ready to start practising?
          </h2>
          <p className="animate-fade-in-up delay-100 text-[#c9d6cd] text-lg mb-9 max-w-xl mx-auto">
            Join students already using PastCS to prepare smarter for their DCIT exams.
          </p>
          <div className="animate-fade-in-up delay-200 flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/register">
              <Button size="lg" className="bg-[#faf7f0] text-[#1f4a3a] hover:bg-[#f0ece0] w-full sm:w-auto">
                Create Free Account <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline" className="border-[#faf7f0]/35 text-[#faf7f0] hover:bg-white/10 w-full sm:w-auto">
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
