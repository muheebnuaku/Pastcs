'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, Button, Input, Modal, Badge } from '@/components/ui';
import { COURSE_ICONS } from '@/lib/utils';
import type { Course, Topic } from '@/types';
import {
  Plus,
  Edit,
  Trash2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

export default function AdminCoursesPage() {
  const [courses, setCourses] = useState<(Course & { topics: Topic[] })[]>([]);
  const [showCourseModal, setShowCourseModal] = useState(false);
  const [showTopicModal, setShowTopicModal] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [editingTopic, setEditingTopic] = useState<Topic | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [expandedCourses, setExpandedCourses] = useState<Set<string>>(new Set());

  // Course form
  const [courseCode, setCourseCode] = useState('');
  const [courseName, setCourseName] = useState('');
  const [courseDescription, setCourseDescription] = useState('');
  const [courseColor, setCourseColor] = useState('#3B82F6');
  const [courseLevel, setCourseLevel] = useState<100 | 200 | 300 | 400>(100);
  const [courseSemester, setCourseSemester] = useState<1 | 2>(1);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Topic form
  const [topicName, setTopicName] = useState('');
  const [topicDescription, setTopicDescription] = useState('');

  const fetchCourses = async () => {
    const supabase = createClient();
    const { data: coursesData } = await supabase
      .from('courses')
      .select('*, topics(*)')
      .order('course_code');

    if (coursesData) {
      setCourses((coursesData as (Course & { topics: Topic[] })[]).map(c => ({
        ...c,
        topics: c.topics.sort((a: Topic, b: Topic) => a.order_index - b.order_index)
      })));
    }
  };

  useEffect(() => {
    fetchCourses();
  }, []);

  const toggleCourseExpand = (courseId: string) => {
    setExpandedCourses(prev => {
      const newSet = new Set(prev);
      if (newSet.has(courseId)) {
        newSet.delete(courseId);
      } else {
        newSet.add(courseId);
      }
      return newSet;
    });
  };

  const openCourseModal = (course?: Course) => {
    if (course) {
      setEditingCourse(course);
      setCourseCode(course.course_code);
      setCourseName(course.course_name);
      setCourseDescription(course.description || '');
      setCourseColor(course.color);
      setCourseLevel(course.level);
      setCourseSemester(course.semester);
    } else {
      setEditingCourse(null);
      setCourseCode('');
      setCourseName('');
      setCourseDescription('');
      setCourseColor('#3B82F6');
      setCourseLevel(100);
      setCourseSemester(1);
    }
    setShowCourseModal(true);
  };

  const openTopicModal = (courseId: string, topic?: Topic) => {
    setSelectedCourseId(courseId);
    if (topic) {
      setEditingTopic(topic);
      setTopicName(topic.topic_name);
      setTopicDescription(topic.description || '');
    } else {
      setEditingTopic(null);
      setTopicName('');
      setTopicDescription('');
    }
    setShowTopicModal(true);
  };

  const handleSaveCourse = async () => {
    setSaving(true);
    setSaveError('');
    const supabase = createClient();

    let error;
    if (editingCourse) {
      ({ error } = await supabase
        .from('courses')
        .update({
          course_code: courseCode,
          course_name: courseName,
          description: courseDescription,
          color: courseColor,
          level: courseLevel,
          semester: courseSemester,
        })
        .eq('id', editingCourse.id));
    } else {
      ({ error } = await supabase
        .from('courses')
        .insert({
          course_code: courseCode,
          course_name: courseName,
          description: courseDescription,
          color: courseColor,
          level: courseLevel,
          semester: courseSemester,
        }));
    }

    setSaving(false);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setShowCourseModal(false);
    fetchCourses();
  };

  const handleDeleteCourse = async (courseId: string) => {
    if (!confirm('Are you sure? This will delete all topics and questions.')) return;
    
    const supabase = createClient();
    await supabase.from('courses').delete().eq('id', courseId);
    fetchCourses();
  };

  const handleSaveTopic = async () => {
    if (!selectedCourseId) return;
    const supabase = createClient();

    if (editingTopic) {
      await supabase
        .from('topics')
        .update({
          topic_name: topicName,
          description: topicDescription,
        })
        .eq('id', editingTopic.id);
    } else {
      const course = courses.find(c => c.id === selectedCourseId);
      const maxOrder = course?.topics.reduce((max, t) => Math.max(max, t.order_index), 0) || 0;

      await supabase
        .from('topics')
        .insert({
          course_id: selectedCourseId,
          topic_name: topicName,
          description: topicDescription,
          order_index: maxOrder + 1,
        });
    }

    setShowTopicModal(false);
    fetchCourses();
  };

  const handleDeleteTopic = async (topicId: string) => {
    if (!confirm('Are you sure?')) return;
    
    const supabase = createClient();
    await supabase.from('topics').delete().eq('id', topicId);
    fetchCourses();
  };

  // Group courses: level → semester → courses[]
  const grouped = courses.reduce((acc, course) => {
    if (!acc[course.level]) acc[course.level] = {};
    if (!acc[course.level][course.semester]) acc[course.level][course.semester] = [];
    acc[course.level][course.semester].push(course);
    return acc;
  }, {} as Record<number, Record<number, (Course & { topics: Topic[] })[]>>);

  const renderCourse = (course: Course & { topics: Topic[] }) => (
    <Card key={course.id}>
      <div
        className="px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 gap-2"
        onClick={() => toggleCourseExpand(course.id)}
      >
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {expandedCourses.has(course.id) ? (
            <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
          )}
          <span className="text-xl sm:text-3xl flex-shrink-0">{COURSE_ICONS[course.course_code]}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="font-semibold text-gray-900 text-sm sm:text-base">{course.course_code}</h3>
              <Badge variant="info" size="sm">{course.total_questions} q</Badge>
              <Badge variant="default" size="sm">{course.topics.length} topics</Badge>
            </div>
            <p className="text-xs sm:text-sm text-gray-600 truncate">{course.course_name}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" onClick={() => openCourseModal(course)}>
            <Edit className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => handleDeleteCourse(course.id)}>
            <Trash2 className="w-4 h-4 text-red-500" />
          </Button>
        </div>
      </div>

      {expandedCourses.has(course.id) && (
        <div className="px-3 sm:px-6 pb-4 border-t border-gray-100 pt-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-gray-700">Topics</h4>
            <Button size="sm" variant="outline" onClick={() => openTopicModal(course.id)}>
              <Plus className="w-4 h-4 mr-1" />
              Add Topic
            </Button>
          </div>
          {course.topics.length > 0 ? (
            <div className="space-y-2">
              {course.topics.map((topic, idx) => (
                <div
                  key={topic.id}
                  className="flex items-center justify-between p-2 sm:p-3 bg-gray-50 rounded-lg gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-gray-500 flex-shrink-0">{idx + 1}.</span>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 text-sm truncate">{topic.topic_name}</p>
                      {topic.description && (
                        <p className="text-xs text-gray-500 truncate">{topic.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openTopicModal(course.id, topic)}
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDeleteTopic(topic.id)}
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 text-center py-4">No topics yet</p>
          )}
        </div>
      )}
    </Card>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Course Management</h1>
          <p className="text-gray-600">Manage courses and topics</p>
        </div>
        <Button onClick={() => openCourseModal()}>
          <Plus className="w-4 h-4 mr-2" />
          Add Course
        </Button>
      </div>

      <div className="space-y-8">
        {[100, 200, 300, 400].map((level) => {
          if (!grouped[level]) return null;
          return (
            <div key={level}>
              <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-8 h-8 bg-blue-600 text-white text-sm font-bold rounded-lg">
                  {level / 100}
                </span>
                Level {level}
              </h2>
              <div className="space-y-6 pl-1 sm:pl-2 border-l-2 border-blue-100">
                {[1, 2].map((sem) => {
                  if (!grouped[level][sem]) return null;
                  return (
                    <div key={sem}>
                      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 ml-2 sm:ml-4">
                        Semester {sem}
                      </h3>
                      <div className="space-y-3 ml-2 sm:ml-4">
                        {grouped[level][sem].map(renderCourse)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {courses.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-12">No courses yet. Add one to get started.</p>
        )}
      </div>

      {/* Course Modal */}
      <Modal
        isOpen={showCourseModal}
        onClose={() => { setShowCourseModal(false); setSaveError(''); }}
        title={editingCourse ? 'Edit Course' : 'Add New Course'}
      >
        <div className="space-y-4">
          {saveError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {saveError}
            </div>
          )}
          <Input
            label="Course Code"
            placeholder="e.g., DCIT101"
            value={courseCode}
            onChange={(e) => setCourseCode(e.target.value)}
          />
          <Input
            label="Course Name"
            placeholder="e.g., Introduction to Computer Science"
            value={courseName}
            onChange={(e) => setCourseName(e.target.value)}
          />
          <Input
            label="Description"
            placeholder="Brief description of the course"
            value={courseDescription}
            onChange={(e) => setCourseDescription(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Level</label>
              <select
                value={courseLevel}
                onChange={(e) => setCourseLevel(Number(e.target.value) as 100 | 200 | 300 | 400)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {[100, 200, 300, 400].map((l) => (
                  <option key={l} value={l}>Level {l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Semester</label>
              <select
                value={courseSemester}
                onChange={(e) => setCourseSemester(Number(e.target.value) as 1 | 2)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value={1}>Semester 1</option>
                <option value={2}>Semester 2</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
            <input
              type="color"
              value={courseColor}
              onChange={(e) => setCourseColor(e.target.value)}
              className="w-full h-10 rounded-lg cursor-pointer"
            />
          </div>
          <div className="flex gap-3 pt-4">
            <Button variant="outline" className="flex-1" onClick={() => { setShowCourseModal(false); setSaveError(''); }}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleSaveCourse} disabled={saving}>
              {saving ? 'Saving...' : editingCourse ? 'Update' : 'Create'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Topic Modal */}
      <Modal
        isOpen={showTopicModal}
        onClose={() => setShowTopicModal(false)}
        title={editingTopic ? 'Edit Topic' : 'Add New Topic'}
      >
        <div className="space-y-4">
          <Input
            label="Topic Name"
            placeholder="e.g., Number Systems"
            value={topicName}
            onChange={(e) => setTopicName(e.target.value)}
          />
          <Input
            label="Description (optional)"
            placeholder="Brief description"
            value={topicDescription}
            onChange={(e) => setTopicDescription(e.target.value)}
          />
          <div className="flex gap-3 pt-4">
            <Button variant="outline" className="flex-1" onClick={() => setShowTopicModal(false)}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleSaveTopic}>
              {editingTopic ? 'Update' : 'Create'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
