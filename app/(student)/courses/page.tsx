'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, Badge } from '@/components/ui';
import { COURSE_ICONS } from '@/lib/utils';
import type { Course } from '@/types';
import { FileQuestion, ArrowRight, Search } from 'lucide-react';

const LEVELS = [100, 200, 300, 400] as const;
const SEMESTERS = [1, 2] as const;

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState<number | null>(null);
  const [semesterFilter, setSemesterFilter] = useState<number | null>(null);

  useEffect(() => {
    const fetchCourses = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('courses')
        .select('*')
        .order('level')
        .order('semester')
        .order('course_code');
      if (data) setCourses(data);
    };
    fetchCourses();
  }, []);

  const filteredCourses = courses.filter((course) => {
    const matchesSearch =
      course.course_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      course.course_name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesLevel = levelFilter === null || course.level === levelFilter;
    const matchesSemester = semesterFilter === null || course.semester === semesterFilter;
    return matchesSearch && matchesLevel && matchesSemester;
  });

  const filterBtn = (active: boolean) =>
    `px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
      active
        ? 'bg-blue-600 text-white border-blue-600'
        : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-600'
    }`;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Courses</h1>
          <p className="text-gray-600">Select a course to start practicing</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search courses..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-500">Level:</span>
          <button className={filterBtn(levelFilter === null)} onClick={() => setLevelFilter(null)}>
            All
          </button>
          {LEVELS.map((l) => (
            <button
              key={l}
              className={filterBtn(levelFilter === l)}
              onClick={() => setLevelFilter(levelFilter === l ? null : l)}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-500">Semester:</span>
          <button className={filterBtn(semesterFilter === null)} onClick={() => setSemesterFilter(null)}>
            All
          </button>
          {SEMESTERS.map((s) => (
            <button
              key={s}
              className={filterBtn(semesterFilter === s)}
              onClick={() => setSemesterFilter(semesterFilter === s ? null : s)}
            >
              Sem {s}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredCourses.map((course) => (
          <Link key={course.id} href={`/courses/${course.course_code.toLowerCase()}`}>
            <Card className="h-full card-hover cursor-pointer">
              <CardContent className="p-6">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-4"
                  style={{ backgroundColor: `${course.color}20` }}
                >
                  {COURSE_ICONS[course.course_code]}
                </div>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <h2 className="text-lg font-bold text-gray-900">{course.course_code}</h2>
                  <Badge variant="info" size="sm">
                    <FileQuestion className="w-3 h-3 mr-1" />
                    {course.total_questions}
                  </Badge>
                  <Badge variant="success" size="sm">Level {course.level}</Badge>
                  <Badge variant="warning" size="sm">Sem {course.semester}</Badge>
                </div>
                <p className="text-gray-600 text-sm mb-4">{course.course_name}</p>
                {course.description && (
                  <p className="text-gray-500 text-sm line-clamp-2 mb-4">{course.description}</p>
                )}
                <div className="flex items-center text-blue-600 font-medium text-sm">
                  Start Practice
                  <ArrowRight className="w-4 h-4 ml-2" />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {filteredCourses.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500">No courses found.</p>
        </div>
      )}
    </div>
  );
}
