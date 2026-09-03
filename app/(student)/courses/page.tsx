'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers';
import { useSubscriptionStore } from '@/lib/store';
import { usePricing } from '@/lib/hooks/usePricing';
import { Card, CardContent, Badge } from '@/components/ui';
import { COURSE_ICONS } from '@/lib/utils';
import { LevelSemesterModal } from './components/LevelSemesterModal';
import { PaywallModal } from './components/PaywallModal';
import { coursesForProgram } from '@/lib/programs';
import type { Course } from '@/types';
import {
  FileQuestion,
  ArrowRight,
  Lock,
  CheckCircle,
  RefreshCw,
  GraduationCap,
  Sparkles,
  Zap,
  ShieldCheck,
  BookOpen,
} from 'lucide-react';

export default function CoursesPage() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const { hasActiveSub } = useSubscriptionStore();

  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settingFreeCourse, setSettingFreeCourse] = useState<string | null>(null);
  const [paywallCourse, setPaywallCourse] = useState<Course | null>(null);
  const [showLevelModal, setShowLevelModal] = useState(false);

  const level = user?.selected_level;
  const semester = user?.selected_semester;
  const freeCourseCode = user?.free_course_code;
  const isPaid = hasActiveSub(level, semester);
  const { label: priceLabel } = usePricing(level);
  const lockedCount = !isPaid && freeCourseCode
    ? courses.filter(c => c.course_code !== freeCourseCode).length
    : 0;

  const fetchCourses = async () => {
    if (!level || !semester || !user?.program_id) return;
    setIsLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: fetchError } = await coursesForProgram(supabase, user.program_id)
        .eq('level', level)
        .eq('semester', semester)
        .order('course_code');
      if (fetchError) throw fetchError;
      setCourses(data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load courses.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    if (!user.selected_level) {
      setShowLevelModal(true);
      setIsLoading(false);
    } else {
      fetchCourses();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.selected_level, user?.selected_semester, user?.program_id]);

  const handleSelectFreeCourse = async (courseCode: string) => {
    setSettingFreeCourse(courseCode);
    try {
      const res = await fetch('/api/user/free-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseCode }),
      });
      if (res.ok) {
        await refreshUser();
        router.push(`/courses/${courseCode.toLowerCase()}`);
      }
    } finally {
      setSettingFreeCourse(null);
    }
  };

  if (!user) return null;

  const totalQuestions = courses.reduce((sum, c) => sum + (c.total_questions ?? 0), 0);

  return (
    <div className="space-y-6 animate-fade-in">
      {showLevelModal && (
        <LevelSemesterModal
          isChanging={!!user?.selected_level}
          onClose={() => setShowLevelModal(false)}
          onSuccess={() => {
            setShowLevelModal(false);
            fetchCourses();
          }}
        />
      )}

      {paywallCourse && (
        <PaywallModal
          courseName={paywallCourse.course_name}
          courseCode={paywallCourse.course_code}
          totalCourses={courses.length}
          onClose={() => setPaywallCourse(null)}
          onSuccess={() => setPaywallCourse(null)}
        />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Courses</h1>
          {level && semester ? (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-gray-500 text-sm dark:text-gray-400">Level {level} — Semester {semester}</span>
              <button onClick={() => setShowLevelModal(true)} className="text-xs text-blue-600 hover:underline">
                Change
              </button>
            </div>
          ) : (
            <p className="text-gray-500 text-sm dark:text-gray-400">Select your level to get started</p>
          )}
        </div>

        {level && !isPaid && freeCourseCode && (
          <button
            onClick={() => setPaywallCourse(courses.find(c => c.course_code !== freeCourseCode) ?? null)}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Sparkles className="w-4 h-4" />
            Unlock All — {priceLabel}
          </button>
        )}
      </div>

      {/* Free-pick banner */}
      {level && !isPaid && !freeCourseCode && courses.length > 0 && (
        <div className="bg-blue-600 rounded-2xl p-5 text-white">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-base">Try one course for free</p>
              <p className="text-sm text-blue-200 mt-0.5">
                Pick any course below to start practicing — no payment needed.
                Unlock all {courses.length} courses &amp; {totalQuestions}+ questions for just{' '}
                <strong className="text-white">{priceLabel}</strong>.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Locked-courses upgrade banner */}
      {level && !isPaid && freeCourseCode && lockedCount > 0 && (
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50 p-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900 dark:text-gray-100">
                {lockedCount} course{lockedCount > 1 ? 's' : ''} locked — unlock everything for {priceLabel}
              </p>
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2">
                {[
                  { icon: Zap, text: `All ${courses.length} courses this semester` },
                  { icon: ShieldCheck, text: 'Exam simulation mode' },
                  { icon: Sparkles, text: 'AI explanations on every question' },
                ].map(({ icon: Icon, text }) => (
                  <span key={text} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                    <Icon className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                    {text}
                  </span>
                ))}
              </div>
            </div>
            <button
              onClick={() => setPaywallCourse(courses.find(c => c.course_code !== freeCourseCode) ?? null)}
              className="flex-shrink-0 bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors whitespace-nowrap"
            >
              Unlock All — {priceLabel}
            </button>
          </div>
        </div>
      )}

      {/* Full-access banner */}
      {isPaid && (
        <div className="bg-green-50 dark:bg-green-500/10 border border-green-100 dark:border-green-500/20 rounded-2xl p-4 flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
          <p className="text-sm font-medium text-green-800 dark:text-green-400">
            Full access unlocked — all {courses.length} courses available this semester
          </p>
        </div>
      )}

      {/* No level selected */}
      {!level && !showLevelModal && (
        <div className="text-center py-16">
          <div className="w-16 h-16 bg-blue-100 dark:bg-blue-500/15 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <GraduationCap className="w-8 h-8 text-blue-600 dark:text-blue-400" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2 dark:text-gray-100">Select your level to begin</h2>
          <button
            onClick={() => setShowLevelModal(true)}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-xl font-medium hover:bg-blue-700 transition-colors"
          >
            Get Started <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-200 p-6 animate-pulse dark:bg-white/[0.04] dark:border-white/10">
              <div className="w-14 h-14 bg-gray-200 rounded-2xl mb-4 dark:bg-white/15" />
              <div className="h-5 bg-gray-200 rounded w-1/2 mb-2 dark:bg-white/15" />
              <div className="h-4 bg-gray-100 rounded w-3/4 mb-4 dark:bg-white/10" />
              <div className="h-4 bg-gray-100 rounded w-1/4 dark:bg-white/10" />
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {!isLoading && error && (
        <div className="text-center py-12">
          <p className="text-red-500 mb-4">{error}</p>
          <button
            onClick={fetchCourses}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      )}

      {/* Course Grid */}
      {!isLoading && !error && courses.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {courses.map((course) => {
            const isFreeCourse = course.course_code === freeCourseCode;
            const isLocked = !isPaid && !isFreeCourse && !!freeCourseCode;
            const isPickable = !isPaid && !freeCourseCode;

            if (isLocked) {
              return (
                <button
                  key={course.id}
                  className="w-full text-left group"
                  onClick={() => setPaywallCourse(course)}
                >
                  <Card className="h-full border-2 border-dashed border-gray-200 group-hover:border-blue-300 group-hover:shadow-md transition-all cursor-pointer dark:border-white/10">
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div
                          className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl grayscale opacity-50"
                          style={{ backgroundColor: `${course.color}20` }}
                        >
                          {course.icon || COURSE_ICONS[course.course_code] || '📚'}
                        </div>
                        <span className="flex items-center gap-1 bg-gray-100 text-gray-400 px-2.5 py-1 rounded-full text-xs font-medium dark:bg-white/10 dark:text-gray-500">
                          <Lock className="w-3 h-3" /> Locked
                        </span>
                      </div>
                      <h2 className="text-base font-bold text-gray-500 mb-0.5 dark:text-gray-400">{course.course_code}</h2>
                      <p className="text-gray-400 text-sm mb-3 leading-snug dark:text-gray-500">{course.course_name}</p>
                      <div className="flex items-center gap-1 text-gray-400 text-xs mb-4 dark:text-gray-500">
                        <FileQuestion className="w-3.5 h-3.5" />
                        {course.total_questions ?? 0} questions inside
                      </div>
                      <div className="flex items-center justify-center gap-1.5 bg-blue-600 group-hover:bg-blue-700 text-white rounded-xl py-2 text-xs font-semibold transition-colors">
                        <Sparkles className="w-3.5 h-3.5" />
                        Unlock for {priceLabel}
                      </div>
                    </CardContent>
                  </Card>
                </button>
              );
            }

            if (isPickable) {
              return (
                <button
                  key={course.id}
                  className="w-full text-left group"
                  onClick={() => handleSelectFreeCourse(course.course_code)}
                >
                  <Card className="h-full border-2 border-transparent group-hover:border-green-400 group-hover:shadow-md transition-all cursor-pointer">
                    <CardContent className="p-6">
                      <div
                        className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl mb-4"
                        style={{ backgroundColor: `${course.color}20` }}
                      >
                        {course.icon || COURSE_ICONS[course.course_code] || '📚'}
                      </div>
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">{course.course_code}</h2>
                        <Badge variant="info" size="sm">
                          <FileQuestion className="w-3 h-3 mr-1" />
                          {course.total_questions ?? 0}
                        </Badge>
                      </div>
                      <p className="text-gray-500 text-sm mb-4 leading-snug dark:text-gray-400">{course.course_name}</p>
                      <div className="flex items-center justify-center gap-2 bg-green-600 group-hover:bg-green-700 text-white rounded-xl py-2 text-sm font-semibold transition-colors">
                        {settingFreeCourse === course.course_code ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <CheckCircle className="w-4 h-4" />
                            Try This Free
                          </>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </button>
              );
            }

            return (
              <Link key={course.id} href={`/courses/${course.course_code.toLowerCase()}`} className="group">
                <Card className="h-full border-2 border-transparent group-hover:border-blue-200 group-hover:shadow-md transition-all cursor-pointer">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div
                        className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl"
                        style={{ backgroundColor: `${course.color}20` }}
                      >
                        {course.icon || COURSE_ICONS[course.course_code] || '📚'}
                      </div>
                      {isFreeCourse && !isPaid && (
                        <span className="bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400 text-xs font-semibold px-2.5 py-1 rounded-full">
                          Free
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">{course.course_code}</h2>
                      <Badge variant="info" size="sm">
                        <FileQuestion className="w-3 h-3 mr-1" />
                        {course.total_questions ?? 0}
                      </Badge>
                    </div>
                    <p className="text-gray-500 text-sm mb-4 leading-snug dark:text-gray-400">{course.course_name}</p>
                    <div className="flex items-center text-blue-600 font-semibold text-sm">
                      Start Practice
                      <ArrowRight className="w-4 h-4 ml-1.5 group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {!isLoading && !error && level && courses.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 dark:text-gray-400">No courses available for Level {level} Semester {semester} yet.</p>
        </div>
      )}
    </div>
  );
}