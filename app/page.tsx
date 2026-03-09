'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui';
import { Navbar, Footer } from '@/components/layout';
import { COURSE_ICONS } from '@/lib/utils';
import {
  GraduationCap,
  BookOpen,
  Trophy,
  Target,
  Users,
  ArrowRight,
  CheckCircle,
  BarChart3,
  Clock,
  TrendingUp,
  Layers,
  Zap,
  Star,
} from 'lucide-react';

const courses = [
  { code: 'DCIT101', name: 'Introduction to Computer Science', color: 'bg-blue-500' },
  { code: 'DCIT103', name: 'Office Productivity Tools',        color: 'bg-green-500' },
  { code: 'DCIT105', name: 'Mathematics for IT Professionals', color: 'bg-purple-500' },
];

const features = [
  {
    image: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?q=80&w=800&auto=format&fit=crop',
    icon: BookOpen,
    title: 'Extensive Question Bank',
    description: 'Hundreds of curated practice questions across all your IT courses, built from real course content.',
  },
  {
    image: 'https://images.unsplash.com/photo-1606326608606-aa0b62935f2b?q=80&w=800&auto=format&fit=crop',
    icon: Target,
    title: 'Timed Exam Practice',
    description: 'Simulate real exam pressure with timed sessions that mirror the format of your actual papers.',
  },
  {
    image: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?q=80&w=800&auto=format&fit=crop',
    icon: BarChart3,
    title: 'Performance Analytics',
    description: 'Track your progress over time and pinpoint weak areas with detailed per-topic breakdowns.',
  },
  {
    image: 'https://images.unsplash.com/photo-1541339907198-e08756dedf3f?q=80&w=800&auto=format&fit=crop',
    icon: Trophy,
    title: 'Course Leaderboards',
    description: 'See how you rank among your peers and stay motivated to push your scores higher.',
  },
  {
    image: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=800&auto=format&fit=crop',
    icon: Zap,
    title: 'Smart Recommendations',
    description: 'Get personalised topic suggestions based on your recent performance and accuracy trends.',
  },
  {
    image: 'https://images.unsplash.com/photo-1517842645767-c639042777db?q=80&w=800&auto=format&fit=crop',
    icon: Clock,
    title: 'Daily Practice Streaks',
    description: 'Build consistent study habits with daily streaks that reward you for showing up every day.',
  },
];

const steps = [
  {
    number: '01',
    image: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?q=80&w=800&auto=format&fit=crop',
    title: 'Create Your Account',
    description: 'Sign up for free in under a minute — no credit card needed.',
  },
  {
    number: '02',
    image: 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?q=80&w=800&auto=format&fit=crop',
    title: 'Pick Your Course',
    description: 'Select your level and semester — we load exactly the courses you need.',
  },
  {
    number: '03',
    image: 'https://images.unsplash.com/photo-1488190211105-8b0e65b80b4e?q=80&w=800&auto=format&fit=crop',
    title: 'Start Practising',
    description: 'Take practice quizzes or mock exams, review results, and keep improving.',
  },
];

const stats = [
  { value: '500+',  label: 'Students' },
  { value: '6+',    label: 'Courses' },
  { value: 'All',   label: 'IT Levels' },
  { value: '1000+', label: 'Questions' },
];

const studentPhotos = [
  'https://images.unsplash.com/photo-1517486808906-6ca8b3f04846?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1529390079861-591de354faf5?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?q=80&w=800&auto=format&fit=crop',
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white overflow-x-hidden">
      <Navbar />

      {/* ── Hero ── */}
      <section className="relative pt-28 pb-20 px-4 bg-gray-50 overflow-hidden">
        <div className="pointer-events-none absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full border border-blue-100" />
        <div className="pointer-events-none absolute -top-20 -right-20 w-[400px] h-[400px] rounded-full border border-blue-100" />

        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">

            {/* Left */}
            <div>
              <div className="animate-fade-in-up delay-100 inline-flex items-center gap-2 bg-blue-50 border border-blue-100 px-3 py-1.5 rounded-full text-blue-700 text-sm font-medium mb-6">
                <GraduationCap className="w-4 h-4" />
                <span>For IT Students — All Levels</span>
              </div>

              <h1 className="animate-fade-in-up delay-200 text-4xl md:text-5xl font-bold text-gray-900 mb-5 leading-tight">
                Ace Your IT Exams with{' '}
                <span className="text-blue-600">Smart Practice</span>
              </h1>

              <p className="animate-fade-in-up delay-300 text-lg text-gray-600 mb-8 leading-relaxed">
                PastCS gives IT students at every level a structured way to practise for exams —
                with a growing question bank, timed mock exams, and detailed progress tracking.
              </p>

              <div className="animate-fade-in-up delay-400 flex flex-col sm:flex-row gap-3 mb-10">
                <Link href="/register">
                  <Button size="lg" className="w-full sm:w-auto">
                    Start Practising Free
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </Link>
                <Link href="/login">
                  <Button size="lg" variant="outline" className="w-full sm:w-auto">
                    Sign In
                  </Button>
                </Link>
              </div>

              <div className="animate-fade-in-up delay-500 flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-500">
                {['All IT Levels Covered', 'Free to Get Started', 'Tracks Your Progress'].map((item) => (
                  <div key={item} className="flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right — hero image */}
            <div className="animate-slide-right delay-300 relative">
              <div className="relative rounded-2xl overflow-hidden shadow-xl aspect-[4/3] bg-gray-200">
                <Image
                  src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?q=80&w=1200&auto=format&fit=crop"
                  alt="IT students studying together"
                  fill
                  className="object-cover"
                  priority
                />
              </div>
              <div className="animate-float absolute -bottom-4 -left-4 bg-white rounded-xl shadow-lg p-3.5 flex items-center gap-3 border border-gray-100">
                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <TrendingUp className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 leading-tight">Avg. Score Improvement</p>
                  <p className="font-bold text-gray-900 text-sm">+23% after 1 week</p>
                </div>
              </div>
              <div className="animate-float delay-400 absolute -top-4 -right-4 bg-white rounded-xl shadow-lg p-3.5 flex items-center gap-3 border border-gray-100">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <Users className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 leading-tight">Active Students</p>
                  <p className="font-bold text-gray-900 text-sm">500+</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats bar ── */}
      <section className="py-10 px-4 bg-blue-600">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center text-white">
            {stats.map(({ value, label }, i) => (
              <div key={label} className={`animate-scale-in delay-${(i + 1) * 100}`}>
                <p className="text-3xl font-bold">{value}</p>
                <p className="text-blue-200 text-sm mt-1">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Student photos strip ── */}
      <section className="py-14 px-4 bg-white">
        <div className="max-w-7xl mx-auto">
          <p className="animate-fade-in-up text-center text-gray-500 text-sm font-medium uppercase tracking-widest mb-8">
            Trusted by students across all levels
          </p>
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            {studentPhotos.map((src, i) => (
              <div
                key={i}
                className={`animate-fade-in-up delay-${(i + 1) * 200} relative rounded-2xl overflow-hidden aspect-video shadow-md`}
              >
                <Image src={src} alt="Student studying" fill className="object-cover" />
                <div className="absolute inset-0 bg-blue-900/10" />
              </div>
            ))}
          </div>
          <div className="animate-fade-in-up delay-400 flex justify-center items-center mt-6 gap-1">
            {[...Array(5)].map((_, i) => (
              <Star key={i} className="w-5 h-5 text-yellow-400 fill-yellow-400" />
            ))}
            <span className="ml-2 text-sm text-gray-600 font-medium">4.9 / 5 from 200+ students</span>
          </div>
        </div>
      </section>

      {/* ── How It Works — swipeable on mobile ── */}
      <section className="py-20 px-4 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="animate-fade-in-up text-3xl font-bold text-gray-900 mb-3">How It Works</h2>
            <p className="animate-fade-in-up delay-100 text-gray-600 max-w-xl mx-auto">
              Get started in minutes, build better study habits in days.
            </p>
            <p className="animate-fade-in-up delay-200 text-xs text-blue-500 mt-2 md:hidden">
              ← swipe to see all steps →
            </p>
          </div>

          {/* mobile: horizontal scroll / desktop: grid */}
          <div className="flex overflow-x-auto scrollbar-hide snap-x snap-mandatory gap-5 pb-4 -mx-4 px-4 md:grid md:grid-cols-3 md:overflow-x-visible md:mx-0 md:px-0 md:pb-0 md:gap-8">
            {steps.map((step, i) => (
              <div
                key={step.number}
                className={`flex-none w-72 md:w-auto snap-start animate-fade-in-up delay-${(i + 1) * 200} bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 hover:shadow-md transition-shadow`}
              >
                <div className="relative h-44 overflow-hidden">
                  <Image src={step.image} alt={step.title} fill className="object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                  <div className="absolute bottom-3 left-4 w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow">
                    {step.number}
                  </div>
                </div>
                <div className="p-5">
                  <h3 className="font-semibold text-gray-900 mb-2">{step.title}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{step.description}</p>
                </div>
              </div>
            ))}
          </div>

          {/* dot indicator on mobile */}
          <div className="flex justify-center gap-2 mt-5 md:hidden">
            <div className="h-1.5 w-5 rounded-full bg-blue-600" />
            <div className="h-1.5 w-2 rounded-full bg-blue-200" />
            <div className="h-1.5 w-2 rounded-full bg-blue-200" />
          </div>
        </div>
      </section>

      {/* ── Courses ── */}
      <section className="py-20 px-4 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-4">
            <div className="animate-fade-in-up inline-flex items-center gap-2 bg-blue-50 border border-blue-100 px-3 py-1.5 rounded-full text-blue-700 text-sm font-medium mb-4">
              <Layers className="w-4 h-4" />
              <span>Level 100 — Semester 1</span>
            </div>
            <h2 className="animate-fade-in-up delay-100 text-3xl font-bold text-gray-900 mb-4">Available Courses</h2>
            <p className="animate-fade-in-up delay-200 text-gray-600 max-w-xl mx-auto">
              Showing Level 100, Semester 1 courses. All levels available after sign-up.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-10">
            {courses.map((course, i) => (
              <Link key={course.code} href="/register" className="group">
                <div className={`animate-fade-in-up delay-${(i + 1) * 200} bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all duration-200`}>
                  <div className="flex items-start justify-between mb-4">
                    <div className={`w-14 h-14 ${course.color} rounded-xl flex items-center justify-center text-white text-2xl`}>
                      {COURSE_ICONS[course.code]}
                    </div>
                    <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded-full">L100 • Sem 1</span>
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-1">{course.code}</h3>
                  <p className="text-sm text-gray-600 mb-4">{course.name}</p>
                  <div className="flex items-center text-blue-600 text-sm font-medium">
                    Start Practice
                    <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              </Link>
            ))}
          </div>

          <div className="animate-fade-in-up delay-400 mt-8 bg-blue-50 rounded-2xl border border-blue-100 p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0">
                <Layers className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">Courses for all levels covered</p>
                <p className="text-sm text-gray-500">Level 200, 300 &amp; 400 courses are included — sign up to access them all.</p>
              </div>
            </div>
            <Link href="/register" className="w-full sm:w-auto flex-shrink-0">
              <Button className="w-full sm:w-auto">
                Get Full Access <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="py-20 px-4 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="animate-fade-in-up text-3xl font-bold text-gray-900 mb-4">Everything You Need to Prepare</h2>
            <p className="animate-fade-in-up delay-100 text-gray-600 max-w-2xl mx-auto">
              Tools designed to make studying more effective and less stressful.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, i) => (
              <div
                key={i}
                className={`animate-fade-in-up delay-${(i % 3 + 1) * 100} bg-white rounded-2xl overflow-hidden border border-gray-100 hover:border-blue-100 hover:shadow-md transition-all duration-200`}
              >
                <div className="relative h-40 overflow-hidden">
                  <Image src={feature.image} alt={feature.title} fill className="object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-white/70 to-transparent" />
                  <div className="absolute bottom-3 left-4 w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-md">
                    <feature.icon className="w-5 h-5 text-blue-600" />
                  </div>
                </div>
                <div className="p-5">
                  <h3 className="font-semibold text-gray-900 mb-2">{feature.title}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-20 px-4 bg-gradient-to-br from-blue-600 to-blue-800">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="animate-fade-in-up text-3xl md:text-4xl font-bold text-white mb-5">
            Ready to Start Practising?
          </h2>
          <p className="animate-fade-in-up delay-100 text-blue-100 text-lg mb-8 max-w-xl mx-auto">
            Join hundreds of IT students already using PastCS to prepare smarter for their exams.
          </p>
          <div className="animate-fade-in-up delay-200 flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/register">
              <Button size="lg" className="bg-white text-blue-600 hover:bg-blue-50 w-full sm:w-auto">
                Create Free Account <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10 w-full sm:w-auto">
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
