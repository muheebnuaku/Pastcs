'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/providers';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, Button, Input, Avatar, Badge } from '@/components/ui';
import { formatPercentage } from '@/lib/utils';
import {
  User,
  Mail,
  BookOpen,
  Target,
  Flame,
  Sparkles,
  Edit,
  Check,
  X,
} from 'lucide-react';

interface UserStats {
  totalTests: number;
  avgScore: number;
  coursesTaken: number;
  perfectScores: number;
}

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [stats, setStats] = useState<UserStats | null>(null);

  useEffect(() => {
    if (user) {
      setFullName(user.full_name || '');
      setStudentId(user.student_id || '');
      fetchStats();
    }
  }, [user]);

  const fetchStats = async () => {
    if (!user) return;
    const supabase = createClient();

    const { data: tests } = await supabase
      .from('tests')
      .select('course_id, percentage')
      .eq('user_id', user.id);

    if (tests) {
      const uniqueCourses = new Set(tests.map((t: { course_id: string }) => t.course_id));
      const avgScore = tests.length > 0
        ? tests.reduce((acc: number, t: { percentage?: number }) => acc + (t.percentage || 0), 0) / tests.length
        : 0;
      const perfectScores = tests.filter((t: { percentage?: number }) => t.percentage === 100).length;

      setStats({
        totalTests: tests.length,
        avgScore,
        coursesTaken: uniqueCourses.size,
        perfectScores,
      });
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setIsSaving(true);

    const supabase = createClient();
    const { error } = await supabase
      .from('users')
      .update({
        full_name: fullName,
        student_id: studentId,
      })
      .eq('id', user.id);

    if (!error) {
      refreshUser();
      setIsEditing(false);
    }
    setIsSaving(false);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>

      {!user ? (
        <p className="text-gray-500">No profile available.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Card */}
        <Card className="lg:col-span-2">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Profile Information</h2>
            {!isEditing ? (
              <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
                <Edit className="w-4 h-4 mr-1" />
                Edit
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => {
                    setIsEditing(false);
                    setFullName(user?.full_name || '');
                    setStudentId(user?.student_id || '');
                  }}
                >
                  <X className="w-4 h-4" />
                </Button>
                <Button 
                  size="sm" 
                  onClick={handleSave}
                  disabled={isSaving}
                >
                  <Check className="w-4 h-4 mr-1" />
                  Save
                </Button>
              </div>
            )}
          </div>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-6">
              <Avatar
                src={user.avatar_url}
                name={user.full_name || user.email}
                size="xl"
              />
              <div>
                <h3 className="text-xl font-semibold text-gray-900">
                  {user.full_name || 'No Name Set'}
                </h3>
                <p className="text-gray-600">{user.email}</p>
                <Badge variant="info" className="mt-2">
                  {user.role === 'admin' ? 'Administrator' : 'Student'}
                </Badge>
              </div>
            </div>

            {isEditing ? (
              <div className="space-y-4">
                <Input
                  label="Full Name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Enter your full name"
                />
                <Input
                  label="Student ID"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  placeholder="Enter your student ID"
                />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <User className="w-5 h-5 text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-500">Full Name</p>
                    <p className="font-medium text-gray-900">
                      {user.full_name || 'Not set'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <Mail className="w-5 h-5 text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-500">Email</p>
                    <p className="font-medium text-gray-900">{user.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <BookOpen className="w-5 h-5 text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-500">Student ID</p>
                    <p className="font-medium text-gray-900">
                      {user.student_id || 'Not set'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stats Card */}
        <div className="space-y-4">
          <Card>
            <CardContent className="text-center">
              <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-8 h-8 text-purple-600" />
              </div>
              <p className="text-3xl font-bold text-gray-900">{user.xp}</p>
              <p className="text-gray-600">Total XP</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="text-center">
              <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Flame className="w-8 h-8 text-orange-600" />
              </div>
              <p className="text-3xl font-bold text-gray-900">{user.practice_streak}</p>
              <p className="text-gray-600">Day Streak</p>
            </CardContent>
          </Card>

          {stats && (
            <>
              <Card>
                <CardContent className="text-center">
                  <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Target className="w-8 h-8 text-blue-600" />
                  </div>
                  <p className="text-3xl font-bold text-gray-900">{stats.totalTests}</p>
                  <p className="text-gray-600">Tests Completed</p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="text-center">
                  <p className="text-3xl font-bold text-green-600">
                    {formatPercentage(stats.avgScore)}
                  </p>
                  <p className="text-gray-600">Average Score</p>
                  <p className="text-sm text-gray-500 mt-2">
                    {stats.perfectScores} perfect scores
                  </p>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}
