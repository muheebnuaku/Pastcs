'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/providers';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, Button, Input, Avatar, Badge } from '@/components/ui';
import { formatPercentage } from '@/lib/utils';
import { useSpeech, VOICE_PREF_KEY } from '@/lib/hooks/useSpeech';
import { LevelSemesterModal } from '../courses/components/LevelSemesterModal';
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
  GraduationCap,
  AlertTriangle,
  Volume2,
  Loader2,
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
  const [program, setProgram] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [stats, setStats] = useState<UserStats | null>(null);
  const [showLevelModal, setShowLevelModal] = useState(false);
  const [showLevelWarning, setShowLevelWarning] = useState(false);

  const { speak, isSpeaking, isSupported: voiceSupported } = useSpeech();
  const [voiceGender, setVoiceGender] = useState<'female' | 'male'>('female');

  useEffect(() => {
    const stored = localStorage.getItem(VOICE_PREF_KEY) as 'female' | 'male' | null;
    if (stored) setVoiceGender(stored);
  }, []);

  const handleVoiceChange = (gender: 'female' | 'male') => {
    setVoiceGender(gender);
    localStorage.setItem(VOICE_PREF_KEY, gender);
  };

  const testVoice = () => {
    speak("Hi! I'm your AI study assistant. I'll help you understand your courses and ace your exams.");
  };

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

  useEffect(() => {
    if (user) {
      setFullName(user.full_name || '');
      setStudentId(user.student_id || '');
      setProgram(user.program || '');
      fetchStats();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setIsSaving(true);
    setSaveError('');

    const supabase = createClient();
    const { error } = await supabase
      .from('users')
      .update({
        full_name: fullName,
        student_id: studentId,
        program: program || null,
      })
      .eq('id', user.id);

    if (!error) {
      await refreshUser();
      setIsEditing(false);
    } else {
      setSaveError(error.message);
    }
    setIsSaving(false);
  };

  const handleChangeLevelClick = () => {
    if (user?.selected_level) {
      setShowLevelWarning(true);
    } else {
      setShowLevelModal(true);
    }
  };

  const levelLabel = user?.selected_level ? `Level ${user.selected_level}` : 'Not set';
  const semesterLabel = user?.selected_semester ? `Semester ${user.selected_semester}` : 'Not set';

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>

      {/* Program missing banner */}
      {user && !user.program && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-900 text-sm">Please update your program</p>
            <p className="text-amber-700 text-sm mt-0.5">
              Tell us which programme you&apos;re enrolled in so we can personalise your experience. Click <strong>Edit</strong> below to set it.
            </p>
          </div>
        </div>
      )}

      {showLevelModal && (
        <LevelSemesterModal
          isChanging={!!user?.selected_level}
          onClose={() => { setShowLevelModal(false); setShowLevelWarning(false); }}
          onSuccess={() => {
            setShowLevelModal(false);
            setShowLevelWarning(false);
          }}
        />
      )}

      {!user ? (
        <p className="text-gray-500">No profile available.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Card */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
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
                      setProgram(user?.program || '');
                    }}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={isSaving}
                  >
                    {isSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                    {isSaving ? 'Saving…' : 'Save'}
                  </Button>
                </div>
                {saveError && (
                  <p className="text-xs text-red-500 mt-1">{saveError}</p>
                )}
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
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Programme <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={['BSc Information Technology','BSc Computer Science','BSc Management Information Systems','BSc Data Science','BSc Cyber Security'].includes(program) ? program : program ? 'Other' : ''}
                      onChange={(e) => {
                        if (e.target.value !== 'Other') setProgram(e.target.value);
                        else setProgram('');
                      }}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      <option value="">— Select your programme —</option>
                      <option value="BSc Information Technology">BSc Information Technology</option>
                      <option value="BSc Computer Science">BSc Computer Science</option>
                      <option value="BSc Management Information Systems">BSc Management Information Systems</option>
                      <option value="BSc Data Science">BSc Data Science</option>
                      <option value="BSc Cyber Security">BSc Cyber Security</option>
                      <option value="Other">Other (type below)</option>
                    </select>
                    {!['BSc Information Technology','BSc Computer Science','BSc Management Information Systems','BSc Data Science','BSc Cyber Security',''].includes(program) && (
                      <input
                        type="text"
                        value={program}
                        onChange={(e) => setProgram(e.target.value)}
                        placeholder="Type your programme name"
                        className="mt-2 w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        autoFocus
                      />
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                    <User className="w-5 h-5 text-gray-400" />
                    <div>
                      <p className="text-sm text-gray-500">Full Name</p>
                      <p className="font-medium text-gray-900">{user.full_name || 'Not set'}</p>
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
                      <p className="font-medium text-gray-900">{user.student_id || 'Not set'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                    <GraduationCap className="w-5 h-5 text-gray-400" />
                    <div>
                      <p className="text-sm text-gray-500">Programme</p>
                      <p className={`font-medium ${user.program ? 'text-gray-900' : 'text-amber-600'}`}>
                        {user.program || 'Not set — please edit'}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Level & Semester Card */}
          <Card>
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <GraduationCap className="w-5 h-5 text-blue-600" />
                Level &amp; Semester
              </h2>
              <Button variant="ghost" size="sm" onClick={handleChangeLevelClick}>
                <Edit className="w-4 h-4 mr-1" />
                Change
              </Button>
            </div>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-blue-50 rounded-xl text-center">
                  <p className="text-sm text-blue-600 font-medium mb-1">Current Level</p>
                  <p className="text-2xl font-bold text-blue-900">{levelLabel}</p>
                </div>
                <div className="p-4 bg-purple-50 rounded-xl text-center">
                  <p className="text-sm text-purple-600 font-medium mb-1">Semester</p>
                  <p className="text-2xl font-bold text-purple-900">{semesterLabel}</p>
                </div>
              </div>

              {user.free_course_code && (
                <div className="p-3 bg-green-50 border border-green-100 rounded-lg flex items-center gap-3">
                  <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <BookOpen className="w-4 h-4 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-green-800">Free Course</p>
                    <p className="text-xs text-green-600">{user.free_course_code}</p>
                  </div>
                  <Badge variant="success" size="sm" className="ml-auto">Active</Badge>
                </div>
              )}

              {showLevelWarning && (
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-xl space-y-3">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-yellow-900 text-sm">Are you sure?</p>
                      <p className="text-sm text-yellow-700 mt-1">
                        Changing your level or semester will reset your free course selection. Your payment history is preserved.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => setShowLevelWarning(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => { setShowLevelWarning(false); setShowLevelModal(true); }}
                    >
                      Yes, Change
                    </Button>
                  </div>
                </div>
              )}

              {!user.selected_level && (
                <p className="text-sm text-gray-500 text-center">
                  You haven&apos;t selected a level yet.{' '}
                  <button
                    onClick={() => setShowLevelModal(true)}
                    className="text-blue-600 hover:underline font-medium"
                  >
                    Select now
                  </button>
                </p>
              )}
            </CardContent>
          </Card>
          {/* Voice Preferences Card */}
          {voiceSupported && (
            <Card>
              <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
                <Volume2 className="w-5 h-5 text-blue-600" />
                <h2 className="font-semibold text-gray-900">AI Voice Preference</h2>
              </div>
              <CardContent className="space-y-4">
                <p className="text-sm text-gray-500">
                  Choose the voice used when the AI reads explanations and tutor responses aloud.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  {/* Female */}
                  <button
                    onClick={() => handleVoiceChange('female')}
                    className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                      voiceGender === 'female'
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <span className="text-3xl">👩</span>
                    <span className={`text-sm font-semibold ${voiceGender === 'female' ? 'text-blue-700' : 'text-gray-700'}`}>
                      Female
                    </span>
                    {voiceGender === 'female' && (
                      <span className="absolute top-2 right-2 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                        <Check className="w-2.5 h-2.5 text-white" />
                      </span>
                    )}
                  </button>

                  {/* Male */}
                  <button
                    onClick={() => handleVoiceChange('male')}
                    className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                      voiceGender === 'male'
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <span className="text-3xl">👨</span>
                    <span className={`text-sm font-semibold ${voiceGender === 'male' ? 'text-blue-700' : 'text-gray-700'}`}>
                      Male
                    </span>
                    {voiceGender === 'male' && (
                      <span className="absolute top-2 right-2 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                        <Check className="w-2.5 h-2.5 text-white" />
                      </span>
                    )}
                  </button>
                </div>

                <button
                  onClick={testVoice}
                  disabled={isSpeaking}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  {isSpeaking
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Playing…</>
                    : <><Volume2 className="w-4 h-4 text-blue-500" /> Test Voice</>
                  }
                </button>
              </CardContent>
            </Card>
          )}
        </div>

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
        </div>
      )}
    </div>
  );
}
