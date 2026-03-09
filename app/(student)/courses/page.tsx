'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers';
import { useSubscriptionStore } from '@/lib/store';
import { Card, CardContent, Badge } from '@/components/ui';
import { COURSE_ICONS } from '@/lib/utils';
import { LevelSemesterModal } from './components/LevelSemesterModal';
import { PaywallModal } from './components/PaywallModal';
import type { Course } from '@/types';
import {
  FileQuestion,
  ArrowRight,
  Lock,
  CheckCircle,
  RefreshCw,
  GraduationCap,
  Sparkles,
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

  const fetchCourses = async () => {
    if (!level || !semester) return;
    setIsLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from('courses')
        .select('*')
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
  }, [user?.selected_level, user?.selected_semester]);

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
          <h1 className="text-2xl font-bold text-gray-900">Courses</h1>
          {level && semester ? (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-gray-500 text-sm">
                Level {level} — Semester {semester}
              </span>
              <button
                onClick={() => setShowLevelModal(true)}
                className="text-xs text-blue-600 hover:underline"
              >
                Change
              </button>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">Select your level to get started</p>
          )}
        </div>

        {level && !isPaid && freeCourseCode && (
          <button
            onClick={() => setPaywallCourse(courses.find(c => c.course_code !== freeCourseCode) ?? null)}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            Unlock All — GHC 1
          </button>
        )}
      </div>

      {/* Banners */}
      {level && !isPaid && !freeCourseCode && courses.length > 0 && (
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex items-center gap-4">
          <CheckCircle className="w-5 h-5 text-blue-600 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-blue-900">Pick one course to try for free</p>
            <p className="text-xs text-blue-600 mt-0.5">
              Click any course below to select it as your free trial. Unlock all {courses.length} for just GHC 1.
            </p>
          </div>
        </div>
      )}

      {isPaid && (
        <div className="bg-green-50 border border-green-100 rounded-2xl p-4 flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
          <p className="text-sm font-medium text-green-800">
            Full access unlocked — all {courses.length} courses available this semester
          </p>
        </div>
      )}

      {/* No selection */}
      {!level && !showLevelModal && (
        <div className="text-center py-16">
          <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <GraduationCap className="w-8 h-8 text-blue-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Select your level to begin</h2>
          <button
            onClick={() => setShowLevelModal(true)}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-xl font-medium hover:bg-blue-700 transition-colors"
          >
            Get Started <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-200 p-6 animate-pulse">
              <div className="w-16 h-16 bg-gray-200 rounded-2xl mb-4" />
              <div className="h-5 bg-gray-200 rounded w-1/2 mb-2" />
              <div className="h-4 bg-gray-100 rounded w-3/4 mb-4" />
              <div className="h-4 bg-gray-100 rounded w-1/4" />
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {courses.map((course) => {
            const isFreeCourse = course.course_code === freeCourseCode;
            const isLocked = !isPaid && !isFreeCourse && !!freeCourseCode;
            const isPickable = !isPaid && !freeCourseCode;

            if (isLocked) {
              return (
                <button
                  key={course.id}
                  className="w-full text-left"
                  onClick={() => setPaywallCourse(course)}
                >
                  <Card className="h-full opacity-90 hover:opacity-100 transition-opacity cursor-pointer border-2 border-dashed border-gray-200">
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div
                          className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl grayscale opacity-60"
                          style={{ backgroundColor: `${course.color}20` }}
                        >
                          {COURSE_ICONS[course.course_code] ?? '📚'}
                        </div>
                        <div className="flex items-center gap-1.5 bg-gray-100 text-gray-500 px-2.5 py-1 rounded-full text-xs font-medium">
                          <Lock className="w-3 h-3" />
                          Locked
                        </div>
                      </div>
                      <h2 className="text-lg font-bold text-gray-600">{course.course_code}</h2>
                      <p className="text-gray-400 text-sm mb-3">{course.course_name}</p>
                      <div className="flex items-center gap-1 text-gray-400 text-xs mb-3">
                        <FileQuestion className="w-3.5 h-3.5" />
                        {course.total_questions} questions locked
                      </div>
                      <p className="text-xs font-medium text-blue-600">Unlock All for GHC 1 →</p>
                    </CardContent>
                  </Card>
                </button>
              );
            }

            if (isPickable) {
              return (
                <button
                  key={course.id}
                  className="w-full text-left"
                  onClick={() => handleSelectFreeCourse(course.course_code)}
                >
                  <Card className="h-full transition-shadow hover:shadow-md cursor-pointer">
                    <CardContent className="p-6">
                      <div
                        className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-4"
                        style={{ backgroundColor: `${course.color}20` }}
                      >
                        {COURSE_ICONS[course.course_code] ?? '📚'}
                      </div>
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <h2 className="text-lg font-bold text-gray-900">{course.course_code}</h2>
                        <Badge variant="info" size="sm">
                          <FileQuestion className="w-3 h-3 mr-1" />
                          {course.total_questions}
                        </Badge>
                      </div>
                      <p className="text-gray-600 text-sm mb-4">{course.course_name}</p>
                      <div className="flex items-center justify-center gap-2 bg-green-600 text-white rounded-xl py-2 text-sm font-medium">
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

            /* Free or paid course */
            return (
              <Link key={course.id} href={`/courses/${course.course_code.toLowerCase()}`}>
                <Card className="h-full card-hover cursor-pointer">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div
                        className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
                        style={{ backgroundColor: `${course.color}20` }}
                      >
                        {COURSE_ICONS[course.course_code] ?? '📚'}
                      </div>
                      {isFreeCourse && !isPaid && (
                        <span className="bg-green-100 text-green-700 text-xs font-semibold px-2.5 py-1 rounded-full">
                          Free
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <h2 className="text-lg font-bold text-gray-900">{course.course_code}</h2>
                      <Badge variant="info" size="sm">
                        <FileQuestion className="w-3 h-3 mr-1" />
                        {course.total_questions}
                      </Badge>
                    </div>
                    <p className="text-gray-600 text-sm mb-4">{course.course_name}</p>
                    <div className="flex items-center text-blue-600 font-medium text-sm">
                      Start Practice
                      <ArrowRight className="w-4 h-4 ml-2" />
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
          <p className="text-gray-500">No courses available for Level {level} Semester {semester} yet.</p>
        </div>
      )}
    </div>
  );
}
