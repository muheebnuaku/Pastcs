'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, Button, Input, Modal, Badge, Loading } from '@/components/ui';
import { COURSE_ICONS } from '@/lib/utils';
import type { Course, Topic } from '@/types';
import {
  Plus,
  Edit,
  Trash2,
  BookOpen,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

export default function AdminCoursesPage() {
  const [courses, setCourses] = useState<(Course & { topics: Topic[] })[]>([]);
  const [isLoading, setIsLoading] = useState(true);
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
    setIsLoading(false);
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
    } else {
      setEditingCourse(null);
      setCourseCode('');
      setCourseName('');
      setCourseDescription('');
      setCourseColor('#3B82F6');
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
    const supabase = createClient();

    if (editingCourse) {
      await supabase
        .from('courses')
        .update({
          course_code: courseCode,
          course_name: courseName,
          description: courseDescription,
          color: courseColor,
        })
        .eq('id', editingCourse.id);
    } else {
      await supabase
        .from('courses')
        .insert({
          course_code: courseCode,
          course_name: courseName,
          description: courseDescription,
          color: courseColor,
        });
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loading size="lg" text="Loading courses..." />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Course Management</h1>
          <p className="text-gray-600">Manage courses and topics</p>
        </div>
        <Button onClick={() => openCourseModal()}>
          <Plus className="w-4 h-4 mr-2" />
          Add Course
        </Button>
      </div>

      <div className="space-y-4">
        {courses.map((course) => (
          <Card key={course.id}>
            <div
              className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-gray-50"
              onClick={() => toggleCourseExpand(course.id)}
            >
              <div className="flex items-center gap-4">
                {expandedCourses.has(course.id) ? (
                  <ChevronDown className="w-5 h-5 text-gray-400" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                )}
                <span className="text-3xl">{COURSE_ICONS[course.course_code]}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900">{course.course_code}</h3>
                    <Badge variant="info" size="sm">{course.total_questions} questions</Badge>
                    <Badge variant="default" size="sm">{course.topics.length} topics</Badge>
                  </div>
                  <p className="text-sm text-gray-600">{course.course_name}</p>
                </div>
              </div>
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="ghost" onClick={() => openCourseModal(course)}>
                  <Edit className="w-4 h-4" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleDeleteCourse(course.id)}>
                  <Trash2 className="w-4 h-4 text-red-500" />
                </Button>
              </div>
            </div>

            {expandedCourses.has(course.id) && (
              <div className="px-6 pb-4 border-t border-gray-100 pt-4">
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
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-medium text-gray-500">{idx + 1}.</span>
                          <div>
                            <p className="font-medium text-gray-900">{topic.topic_name}</p>
                            {topic.description && (
                              <p className="text-sm text-gray-500">{topic.description}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
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
        ))}
      </div>

      {/* Course Modal */}
      <Modal
        isOpen={showCourseModal}
        onClose={() => setShowCourseModal(false)}
        title={editingCourse ? 'Edit Course' : 'Add New Course'}
      >
        <div className="space-y-4">
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
            <Button variant="outline" className="flex-1" onClick={() => setShowCourseModal(false)}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleSaveCourse}>
              {editingCourse ? 'Update' : 'Create'}
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
