'use client';

import Link from 'next/link';
import { Button } from '@/components/ui';
import { Navbar, Footer } from '@/components/layout';
import { COURSE_ICONS } from '@/lib/utils';
import {
  GraduationCap,
  BookOpen,
  Trophy,
  Zap,
  Target,
  Users,
  ArrowRight,
  CheckCircle,
  Sparkles,
  Brain,
  Clock,
  BarChart3,
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
    icon: Brain,
    title: 'AI-Generated Questions',
    description: 'Questions generated directly from your lecture slides using advanced AI technology.',
  },
  {
    icon: Target,
    title: 'Exam Simulation',
    description: 'Practice in a realistic timed environment that mirrors your actual exams.',
  },
  {
    icon: BarChart3,
    title: 'Performance Analytics',
    description: 'Track your progress and identify weak areas with detailed analytics.',
  },
  {
    icon: Trophy,
    title: 'Leaderboards',
    description: 'Compete with classmates and stay motivated with course leaderboards.',
  },
  {
    icon: Zap,
    title: 'Smart Recommendations',
    description: 'Get personalized topic suggestions based on your performance.',
  },
  {
    icon: Clock,
    title: 'Daily Streaks',
    description: 'Build consistent study habits with daily practice streaks.',
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <Navbar />
      
      {/* Hero Section */}
      <section className="relative bg-gradient-to-br from-blue-600 via-blue-700 to-purple-700 pt-32 pb-20 px-4 overflow-hidden">
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />
        <div className="absolute top-20 left-10 w-72 h-72 bg-blue-400 rounded-full filter blur-3xl opacity-20" />
        <div className="absolute bottom-10 right-10 w-96 h-96 bg-purple-400 rounded-full filter blur-3xl opacity-20" />
        
        <div className="relative max-w-7xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm px-4 py-2 rounded-full text-white/90 text-sm mb-8">
            <Sparkles className="w-4 h-4" />
            <span>Powered by AI - Made for UG Students</span>
          </div>
          
          <h1 className="text-4xl md:text-6xl font-bold text-white mb-6">
            Practice Smarter,
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-200 to-purple-200">
              Score Higher
            </span>
          </h1>
          
          <p className="text-lg md:text-xl text-blue-100 max-w-2xl mx-auto mb-10">
            The AI-powered exam practice platform designed specifically for Level 100 IT students 
            at the University of Ghana. No past questions? No problem.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/register">
              <Button size="lg" className="bg-white text-blue-600 hover:bg-blue-50 w-full sm:w-auto">
                Start Practicing Free
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </Link>
            <Link href="/courses">
              <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10 w-full sm:w-auto">
                Explore Courses
              </Button>
            </Link>
          </div>
          
          <div className="flex flex-wrap justify-center gap-6 mt-12 text-white/80 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-400" />
              <span>6 Courses Available</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-400" />
              <span>AI-Generated Questions</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-400" />
              <span>Exam Simulation Mode</span>
            </div>
          </div>
        </div>
      </section>

      {/* Courses Section */}
      <section className="py-20 px-4 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">
              Level 100 Courses
            </h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Practice questions for all your first-year IT courses. Build confidence before your exams.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {courses.map((course) => (
              <Link 
                key={course.code}
                href={`/courses/${course.code.toLowerCase()}`}
                className="group"
              >
                <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 card-hover">
                  <div className={`w-14 h-14 ${course.color} rounded-xl flex items-center justify-center mb-4 text-white text-2xl`}>
                    {COURSE_ICONS[course.code]}
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-1">{course.code}</h3>
                  <p className="text-sm text-gray-600">{course.name}</p>
                  <div className="mt-4 flex items-center text-blue-600 text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                    Start Practice
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 px-4 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">
              Why Students Love PastCS
            </h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Built with persuasive technology to keep you motivated and help you succeed.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, index) => (
              <div key={index} className="bg-white rounded-2xl p-6 border border-gray-100">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mb-4">
                  <feature.icon className="w-6 h-6 text-blue-600" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-sm text-gray-600">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 bg-gradient-to-r from-blue-600 to-purple-600">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
            Ready to Ace Your Exams?
          </h2>
          <p className="text-blue-100 text-lg mb-8">
            Join hundreds of UG students who are already practicing smarter.
            Start your journey to better grades today.
          </p>
          <Link href="/register">
            <Button size="lg" className="bg-white text-blue-600 hover:bg-blue-50">
              Create Free Account
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  );
}
