'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, Button, Badge } from '@/components/ui';
import { COURSE_ICONS, QUESTIONS_PER_PRACTICE, QUESTIONS_PER_EXAM, EXAM_DURATION_MINUTES } from '@/lib/utils';
import type { Course, Topic } from '@/types';
import { 
  ArrowLeft, 
  BookOpen, 
  Clock, 
  Target, 
  FileQuestion,
  Play,
  Zap,
} from 'lucide-react';

export default function CourseDetailPage() {
  const params = useParams();
  const courseCode = (params.courseCode as string).toUpperCase();
  
  const [course, setCourse] = useState<Course | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);

  useEffect(() => {
    const fetchCourseData = async () => {
      const supabase = createClient();
      
      // Fetch course
      const { data: courseData } = await supabase
        .from('courses')
        .select('*')
        .eq('course_code', courseCode)
        .single();

      if (courseData) {
        setCourse(courseData);
        
        // Fetch topics
        const { data: topicsData } = await supabase
          .from('topics')
          .select('*')
          .eq('course_id', courseData.id)
          .order('order_index');

        if (topicsData) setTopics(topicsData);
      }
    };

    fetchCourseData();
  }, [courseCode]);

  if (!course) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Course not found</h2>
        <Link href="/courses" className="text-blue-600 hover:underline mt-2 inline-block">
          Back to courses
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Back Button */}
      <Link 
        href="/courses" 
        className="inline-flex items-center text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Courses
      </Link>

      {/* Course Header */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl p-8 text-white">
        <div className="flex items-start gap-6">
          <div 
            className="w-20 h-20 rounded-2xl flex items-center justify-center text-4xl bg-white/20"
          >
            {COURSE_ICONS[course.course_code]}
          </div>
          <div className="flex-1">
            <h1 className="text-3xl font-bold mb-2">{course.course_code}</h1>
            <p className="text-blue-100 text-lg">{course.course_name}</p>
            {course.description && (
              <p className="text-blue-200 mt-2">{course.description}</p>
            )}
            <div className="flex items-center gap-4 mt-4">
              <Badge variant="default" className="bg-white/20 text-white">
                <FileQuestion className="w-4 h-4 mr-1" />
                {course.total_questions} Questions
              </Badge>
              <Badge variant="default" className="bg-white/20 text-white">
                <BookOpen className="w-4 h-4 mr-1" />
                {topics.length} Topics
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Practice Options */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Quick Practice */}
        <Card className="border-2 border-blue-100 bg-blue-50/50">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                <Zap className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">Quick Practice</h2>
                <p className="text-sm text-gray-600">{QUESTIONS_PER_PRACTICE} random questions</p>
              </div>
            </div>
            <p className="text-gray-600 text-sm mb-4">
              Practice random questions from all topics. No time limit, instant feedback.
            </p>
            <Link href={`/practice/${course.course_code.toLowerCase()}?mode=quick`}>
              <Button className="w-full">
                <Play className="w-4 h-4 mr-2" />
                Start Quick Practice
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Exam Simulation */}
        <Card className="border-2 border-purple-100 bg-purple-50/50">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                <Clock className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">Exam Simulation</h2>
                <p className="text-sm text-gray-600">{QUESTIONS_PER_EXAM} questions • {EXAM_DURATION_MINUTES} minutes</p>
              </div>
            </div>
            <p className="text-gray-600 text-sm mb-4">
              Simulate the real exam experience with timed questions and auto-submit.
            </p>
            <Link href={`/exam/${course.course_code.toLowerCase()}`}>
              <Button variant="secondary" className="w-full bg-purple-600 hover:bg-purple-700 text-white">
                <Target className="w-4 h-4 mr-2" />
                Start Exam Simulation
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Topics */}
      <Card>
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Practice by Topic</h2>
        </div>
        <CardContent>
          {topics.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {topics.map((topic) => (
                <Link 
                  key={topic.id}
                  href={`/practice/${course.course_code.toLowerCase()}?topic=${topic.id}`}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors"
                >
                  <div>
                    <h3 className="font-medium text-gray-900">{topic.topic_name}</h3>
                    {topic.description && (
                      <p className="text-sm text-gray-500 mt-1">{topic.description}</p>
                    )}
                  </div>
                  <ArrowLeft className="w-5 h-5 text-gray-400 rotate-180" />
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">
              No topics available yet for this course.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
