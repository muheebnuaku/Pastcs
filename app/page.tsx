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
} from 'lucide-react';

const courses = [
  { code: 'DCIT101', name: 'Introduction to Computer Science', color: 'bg-blue-500' },
  { code: 'DCIT103', name: 'Office Productivity Tools', color: 'bg-green-500' },
  { code: 'DCIT105', name: 'Mathematics for IT Professionals', color: 'bg-purple-500' },
  { code: 'ECON101', name: 'Introduction to Economics I', color: 'bg-yellow-500' },
  { code: 'STAT111', name: 'Introduction to Statistics and Probability I', color: 'bg-red-500' },
  { code: 'UGRC150', name: 'Critical Thinking and Practical Reasoning', color: 'bg-pink-500' },
];

const features = [
  {
    icon: BookOpen,
    title: 'Extensive Question Bank',
    description: 'Hundreds of curated practice questions across all your IT courses and topics, built from real course content.',
  },
  {
    icon: Target,
    title: 'Timed Exam Practice',
    description: 'Practice in a realistic timed environment that closely mirrors the pressure of your actual exams.',
  },
  {
    icon: BarChart3,
    title: 'Performance Analytics',
    description: 'Track your progress over time and pinpoint weak areas with detailed per-topic analytics.',
  },
  {
    icon: Trophy,
    title: 'Course Leaderboards',
    description: 'See how you rank among your peers and stay motivated to push your scores higher.',
  },
  {
    icon: TrendingUp,
    title: 'Smart Recommendations',
    description: 'Get personalised topic suggestions based on your recent performance and accuracy trends.',
  },
  {
    icon: Clock,
    title: 'Daily Practice Streaks',
    description: 'Build consistent study habits with daily streaks that reward you for showing up every day.',
  },
];

const steps = [
  {
    number: '01',
    title: 'Create Your Account',
    description: 'Sign up for free with your student email in under a minute — no credit card needed.',
  },
  {
    number: '02',
    title: 'Pick Your Course',
    description: 'Browse courses across all IT levels and select the ones you are currently enrolled in.',
  },
  {
    number: '03',
    title: 'Start Practising',
    description: 'Take practice quizzes or full mock exams, then review your results and improve.',
  },
];

const stats = [
  { value: '500+', label: 'Students' },
  { value: '6+', label: 'Courses' },
  { value: 'All', label: 'IT Levels' },
  { value: '1000+', label: 'Questions' },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />

      {/* ── Hero ── */}
      <section className="relative pt-28 pb-20 px-4 bg-gray-50 overflow-hidden">
        {/* subtle background rings */}
        <div className="pointer-events-none absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full border border-blue-100" />
        <div className="pointer-events-none absolute -top-20 -right-20 w-[400px] h-[400px] rounded-full border border-blue-100" />

        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">

            {/* Left — text */}
            <div>
              <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-100 px-3 py-1.5 rounded-full text-blue-700 text-sm font-medium mb-6">
                <GraduationCap className="w-4 h-4" />
                <span>For IT Students — All Levels</span>
              </div>

              <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-5 leading-tight">
                Ace Your IT Exams with{' '}
                <span className="text-blue-600">Smart Practice</span>
              </h1>

              <p className="text-lg text-gray-600 mb-8 leading-relaxed">
                PastCS gives IT students at every level a structured way to practise for exams —
                with a growing question bank, timed mock exams, and detailed progress tracking built
                around your actual courses.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 mb-10">
                <Link href="/register">
                  <Button size="lg" className="w-full sm:w-auto">
                    Start Practising Free
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </Link>
                <Link href="/courses">
                  <Button size="lg" variant="outline" className="w-full sm:w-auto">
                    Browse Courses
                  </Button>
                </Link>
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-500">
                {['All IT Levels Covered', 'Free to Get Started', 'Tracks Your Progress'].map(
                  (item) => (
                    <div key={item} className="flex items-center gap-1.5">
                      <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                      <span>{item}</span>
                    </div>
                  )
                )}
              </div>
            </div>

            {/* Right — image */}
            <div className="relative">
              <div className="relative rounded-2xl overflow-hidden shadow-xl aspect-[4/3] bg-gray-200">
                <Image
                  src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?q=80&w=1200&auto=format&fit=crop"
                  alt="IT students studying together"
                  fill
                  className="object-cover"
                  priority
                />
              </div>

              {/* floating stat — score improvement */}
              <div className="absolute -bottom-4 -left-4 bg-white rounded-xl shadow-lg p-3.5 flex items-center gap-3 border border-gray-100">
                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <TrendingUp className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 leading-tight">Avg. Score Improvement</p>
                  <p className="font-bold text-gray-900 text-sm">+23% after 1 week</p>
                </div>
              </div>

              {/* floating stat — active students */}
              <div className="absolute -top-4 -right-4 bg-white rounded-xl shadow-lg p-3.5 flex items-center gap-3 border border-gray-100">
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
            {stats.map(({ value, label }) => (
              <div key={label}>
                <p className="text-3xl font-bold">{value}</p>
                <p className="text-blue-200 text-sm mt-1">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="py-20 px-4 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">How It Works</h2>
            <p className="text-gray-600 max-w-xl mx-auto">
              Get started in minutes, build better study habits in days.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {steps.map((step, i) => (
              <div key={step.number} className="relative text-center px-4">
                {/* connector line between steps */}
                {i < steps.length - 1 && (
                  <div className="hidden md:block absolute top-7 left-[calc(50%+2.5rem)] right-[calc(-50%+2.5rem)] h-px bg-blue-100" />
                )}
                <div className="w-14 h-14 bg-blue-600 text-white rounded-2xl flex items-center justify-center text-lg font-bold mx-auto mb-4 relative z-10">
                  {step.number}
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{step.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Courses ── */}
      <section className="py-20 px-4 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Available Courses</h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Practice questions for all your IT courses across all levels.
              Build confidence before your exams.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {courses.map((course) => (
              <Link
                key={course.code}
                href={`/courses/${course.code.toLowerCase()}`}
                className="group"
              >
                <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                  <div
                    className={`w-14 h-14 ${course.color} rounded-xl flex items-center justify-center mb-4 text-white text-2xl`}
                  >
                    {COURSE_ICONS[course.code]}
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
        </div>
      </section>

      {/* ── Features ── */}
      <section className="py-20 px-4 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Everything You Need to Prepare</h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Tools designed to make studying more effective and less stressful.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <div key={index} className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:border-blue-100 transition-colors">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mb-4">
                  <feature.icon className="w-6 h-6 text-blue-600" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-20 px-4 bg-gradient-to-br from-blue-600 to-blue-800">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-5">
            Ready to Start Practising?
          </h2>
          <p className="text-blue-100 text-lg mb-8 max-w-xl mx-auto">
            Join hundreds of IT students already using PastCS to prepare smarter for their exams.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/register">
              <Button size="lg" className="bg-white text-blue-600 hover:bg-blue-50 w-full sm:w-auto">
                Create Free Account
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </Link>
            <Link href="/login">
              <Button
                size="lg"
                variant="outline"
                className="border-white/30 text-white hover:bg-white/10 w-full sm:w-auto"
              >
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
