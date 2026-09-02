'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
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
  MessageSquareQuote,
  Gift,
  Copy,
  Share2,
  Sun,
  Moon,
  Monitor,
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
  const [testimonial, setTestimonial] = useState('');
  const [testimonialSaving, setTestimonialSaving] = useState(false);
  const [testimonialDone, setTestimonialDone] = useState(false);
  const [testimonialError, setTestimonialError] = useState('');

  const [referralStats, setReferralStats] = useState({ referred: 0, rewarded: 0 });
  const [codeCopied, setCodeCopied] = useState(false);

  const { speak, isSpeaking, isSupported: voiceSupported } = useSpeech();
  const [voiceGender, setVoiceGender] = useState<'female' | 'male'>('female');

  // next-themes reads the persisted/system value only after mount — using
  // `theme` before that would render whatever the server guessed and then
  // flip, so the appearance card waits for `mounted` before showing state.
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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

  const fetchReferralStats = async () => {
    if (!user) return;
    const supabase = createClient();
    try {
      const { data } = await supabase
        .from('referrals')
        .select('referred_rewarded_at')
        .eq('referrer_id', user.id);
      if (data) {
        setReferralStats({
          referred: data.length,
          rewarded: data.filter((r: { referred_rewarded_at: string | null }) => r.referred_rewarded_at).length,
        });
      }
    } catch {
      // referrals table not migrated on this environment yet
    }
  };

  const copyReferralLink = () => {
    if (!user?.referral_code) return;
    const link = `${window.location.origin}/register?ref=${user.referral_code}`;
    navigator.clipboard.writeText(link).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }).catch(() => {});
  };

  useEffect(() => {
    if (user) {
      setFullName(user.full_name || '');
      setStudentId(user.student_id || '');
      setProgram(user.program || '');
      fetchStats();
      fetchReferralStats();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setIsSaving(true);
    setSaveError('');

    const supabase = createClient();

    // Save name + student ID first
    const { error: baseError } = await supabase
      .from('users')
      .update({ full_name: fullName, student_id: studentId })
      .eq('id', user.id);

    if (baseError) {
      setSaveError(baseError.message);
      setIsSaving(false);
      return;
    }

    // Save program separately (column may not exist yet in DB)
    if (program !== (user.program || '')) {
      const { error: progError } = await supabase
        .from('users')
        .update({ program: program || null })
        .eq('id', user.id);

      if (progError) {
        setSaveError('Programme not saved — please run the SQL migration in Supabase: ALTER TABLE public.users ADD COLUMN IF NOT EXISTS program TEXT;');
        await refreshUser();
        setIsEditing(false);
        setIsSaving(false);
        return;
      }
    }

    await refreshUser();
    setIsEditing(false);
    setIsSaving(false);
  };

  const handleSubmitTestimonial = async () => {
    if (!user || !testimonial.trim()) return;
    setTestimonialSaving(true);
    setTestimonialError('');
    const supabase = createClient();
    const { error } = await supabase
      .from('testimonials')
      .insert({ user_id: user.id, quote: testimonial.trim() });
    if (error) {
      setTestimonialError(error.message);
    } else {
      setTestimonialDone(true);
      setTestimonial('');
    }
    setTestimonialSaving(false);
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
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">My Profile</h1>

      {/* Program missing banner */}
      {user && !user.program && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-900 dark:text-amber-300 text-sm">Please update your program</p>
            <p className="text-amber-700 dark:text-amber-400 text-sm mt-0.5">
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
        <p className="text-gray-500 dark:text-gray-400">No profile available.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Card */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <div className="px-6 py-4 border-b border-gray-100 dark:border-white/10 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Profile Information</h2>
              {!isEditing ? (
                <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
                  <Edit className="w-4 h-4 mr-1" />
                  Edit
                </Button>
              ) : (
                <div className="flex flex-col items-end gap-1">
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
                    <p className="text-xs text-red-500">{saveError}</p>
                  )}
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
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                    {user.full_name || 'No Name Set'}
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400">{user.email}</p>
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
                  <Input
                    label="Programme"
                    value={program}
                    onChange={(e) => setProgram(e.target.value)}
                    placeholder="e.g. BSc Computer Science"
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-white/[0.03] rounded-lg">
                    <User className="w-5 h-5 text-gray-400 dark:text-gray-500" />
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Full Name</p>
                      <p className="font-medium text-gray-900 dark:text-gray-100">{user.full_name || 'Not set'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-white/[0.03] rounded-lg">
                    <Mail className="w-5 h-5 text-gray-400 dark:text-gray-500" />
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Email</p>
                      <p className="font-medium text-gray-900 dark:text-gray-100">{user.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-white/[0.03] rounded-lg">
                    <BookOpen className="w-5 h-5 text-gray-400 dark:text-gray-500" />
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Student ID</p>
                      <p className="font-medium text-gray-900 dark:text-gray-100">{user.student_id || 'Not set'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-white/[0.03] rounded-lg">
                    <GraduationCap className="w-5 h-5 text-gray-400 dark:text-gray-500" />
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Programme</p>
                      <p className={`font-medium ${user.program ? 'text-gray-900 dark:text-gray-100' : 'text-amber-600 dark:text-amber-400'}`}>
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
            <div className="px-6 py-4 border-b border-gray-100 dark:border-white/10 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <GraduationCap className="w-5 h-5 text-[#e8603c]" />
                Level &amp; Semester
              </h2>
              <Button variant="ghost" size="sm" onClick={handleChangeLevelClick}>
                <Edit className="w-4 h-4 mr-1" />
                Change
              </Button>
            </div>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-[#fde3da] dark:bg-[#e8603c]/10 rounded-xl text-center">
                  <p className="text-sm text-[#c94f2f] dark:text-[#f0906f] font-medium mb-1">Current Level</p>
                  <p className="text-2xl font-bold text-[#a13f22] dark:text-[#f0906f]">{levelLabel}</p>
                </div>
                <div className="p-4 bg-[#dcf1ee] dark:bg-[#2f9e8f]/10 rounded-xl text-center">
                  <p className="text-sm text-[#227568] dark:text-[#5fc2b3] font-medium mb-1">Semester</p>
                  <p className="text-2xl font-bold text-[#1a5850] dark:text-[#5fc2b3]">{semesterLabel}</p>
                </div>
              </div>

              {user.free_course_code && (
                <div className="p-3 bg-green-50 dark:bg-green-500/10 border border-green-100 dark:border-green-500/20 rounded-lg flex items-center gap-3">
                  <div className="w-8 h-8 bg-green-100 dark:bg-green-500/15 rounded-full flex items-center justify-center flex-shrink-0">
                    <BookOpen className="w-4 h-4 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-green-800 dark:text-green-300">Free Course</p>
                    <p className="text-xs text-green-600 dark:text-green-400">{user.free_course_code}</p>
                  </div>
                  <Badge variant="success" size="sm" className="ml-auto">Active</Badge>
                </div>
              )}

              {showLevelWarning && (
                <div className="p-4 bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/20 rounded-xl space-y-3">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-yellow-900 dark:text-yellow-300 text-sm">Are you sure?</p>
                      <p className="text-sm text-yellow-700 dark:text-yellow-400 mt-1">
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
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
                  You haven&apos;t selected a level yet.{' '}
                  <button
                    onClick={() => setShowLevelModal(true)}
                    className="text-[#e8603c] hover:underline font-medium"
                  >
                    Select now
                  </button>
                </p>
              )}
            </CardContent>
          </Card>

          {/* Refer a Friend */}
          {user.referral_code && (
            <Card>
              <div className="px-6 py-4 border-b border-gray-100 dark:border-white/10">
                <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <Gift className="w-5 h-5 text-green-600 dark:text-green-400" />
                  Refer a Friend
                </h2>
              </div>
              <CardContent className="space-y-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Share your link. When a friend joins and finishes their first test, you <strong>both</strong> get a free pass.
                </p>
                <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/10 rounded-xl">
                  <code className="flex-1 text-sm text-gray-700 dark:text-gray-300 truncate">
                    pastcs.com/register?ref={user.referral_code}
                  </code>
                  <Button size="sm" variant={codeCopied ? 'secondary' : 'outline'} onClick={copyReferralLink} className="flex-shrink-0">
                    {codeCopied ? <Check className="w-3.5 h-3.5 mr-1.5" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
                    {codeCopied ? 'Copied!' : 'Copy Link'}
                  </Button>
                </div>
                {referralStats.referred > 0 && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Share2 className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    {referralStats.referred} friend{referralStats.referred !== 1 ? 's' : ''} joined with your code
                    {referralStats.rewarded > 0 && ` · ${referralStats.rewarded} free pass${referralStats.rewarded !== 1 ? 'es' : ''} earned`}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Appearance Card */}
          <Card>
            <div className="px-6 py-4 border-b border-gray-100 dark:border-white/10 flex items-center gap-2">
              <Sun className="w-5 h-5 text-[#e8603c]" />
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Appearance</h2>
            </div>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Choose how PastCS looks on this device.
              </p>
              <div className="grid grid-cols-3 gap-3">
                {([
                  { value: 'light', label: 'Light', icon: Sun },
                  { value: 'dark', label: 'Dark', icon: Moon },
                  { value: 'system', label: 'System', icon: Monitor },
                ] as const).map(({ value, label, icon: Icon }) => {
                  const isActive = mounted && theme === value;
                  return (
                    <button
                      key={value}
                      onClick={() => setTheme(value)}
                      className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                        isActive
                          ? 'border-[#e8603c] bg-[#fde3da] dark:bg-[#e8603c]/10'
                          : 'border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.02] hover:border-gray-300 dark:hover:border-white/20'
                      }`}
                    >
                      <Icon className={`w-5 h-5 ${isActive ? 'text-[#e8603c]' : 'text-gray-400 dark:text-gray-500'}`} />
                      <span className={`text-sm font-semibold ${isActive ? 'text-[#a13f22] dark:text-[#f0906f]' : 'text-gray-700 dark:text-gray-300'}`}>
                        {label}
                      </span>
                      {isActive && (
                        <span className="absolute top-2 right-2 w-4 h-4 bg-[#e8603c] rounded-full flex items-center justify-center">
                          <Check className="w-2.5 h-2.5 text-white" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Voice Preferences Card */}
          {voiceSupported && (
            <Card>
              <div className="px-6 py-4 border-b border-gray-100 dark:border-white/10 flex items-center gap-2">
                <Volume2 className="w-5 h-5 text-[#e8603c]" />
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">AI Voice Preference</h2>
              </div>
              <CardContent className="space-y-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Choose the voice used when the AI reads explanations and tutor responses aloud.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  {/* Female */}
                  <button
                    onClick={() => handleVoiceChange('female')}
                    className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                      voiceGender === 'female'
                        ? 'border-[#e8603c] bg-[#fde3da] dark:bg-[#e8603c]/10'
                        : 'border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.02] hover:border-gray-300 dark:hover:border-white/20'
                    }`}
                  >
                    <span className="text-3xl">👩</span>
                    <span className={`text-sm font-semibold ${voiceGender === 'female' ? 'text-[#a13f22] dark:text-[#f0906f]' : 'text-gray-700 dark:text-gray-300'}`}>
                      Female
                    </span>
                    {voiceGender === 'female' && (
                      <span className="absolute top-2 right-2 w-4 h-4 bg-[#e8603c] rounded-full flex items-center justify-center">
                        <Check className="w-2.5 h-2.5 text-white" />
                      </span>
                    )}
                  </button>

                  {/* Male */}
                  <button
                    onClick={() => handleVoiceChange('male')}
                    className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                      voiceGender === 'male'
                        ? 'border-[#e8603c] bg-[#fde3da] dark:bg-[#e8603c]/10'
                        : 'border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.02] hover:border-gray-300 dark:hover:border-white/20'
                    }`}
                  >
                    <span className="text-3xl">👨</span>
                    <span className={`text-sm font-semibold ${voiceGender === 'male' ? 'text-[#a13f22] dark:text-[#f0906f]' : 'text-gray-700 dark:text-gray-300'}`}>
                      Male
                    </span>
                    {voiceGender === 'male' && (
                      <span className="absolute top-2 right-2 w-4 h-4 bg-[#e8603c] rounded-full flex items-center justify-center">
                        <Check className="w-2.5 h-2.5 text-white" />
                      </span>
                    )}
                  </button>
                </div>

                <button
                  onClick={testVoice}
                  disabled={isSpeaking}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-gray-200 dark:border-white/10 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50 transition-colors"
                >
                  {isSpeaking
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Playing…</>
                    : <><Volume2 className="w-4 h-4 text-[#e8603c]" /> Test Voice</>
                  }
                </button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar: Testimonial + Stats */}
        <div className="space-y-4">
          {/* Testimonial Card */}
          <Card>
            <div className="px-6 py-4 border-b border-gray-100 dark:border-white/10 flex items-center gap-2">
              <MessageSquareQuote className="w-5 h-5 text-[#e8603c]" />
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Share Your Experience</h2>
            </div>
            <CardContent className="space-y-4">
              {testimonialDone ? (
                <div className="text-center py-4 space-y-2">
                  <p className="text-2xl">🎉</p>
                  <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Thanks for sharing!</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Your testimonial is under review and will appear on the homepage once approved.</p>
                  <button onClick={() => setTestimonialDone(false)} className="text-xs text-[#e8603c] hover:underline">Submit another</button>
                </div>
              ) : (
                <>
                  <p className="text-sm text-gray-500 dark:text-gray-400">How has PastCS helped your studies? Your words encourage other students.</p>
                  <textarea
                    value={testimonial}
                    onChange={e => setTestimonial(e.target.value)}
                    rows={3}
                    maxLength={300}
                    placeholder="e.g. PastCS helped me go from 52% to 81% in DCIT101 in just two weeks…"
                    className="w-full border border-gray-200 dark:border-white/15 dark:bg-white/5 dark:text-gray-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#e8603c] resize-none"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400 dark:text-gray-500">{testimonial.length}/300</span>
                    {testimonialError && <p className="text-xs text-red-500 dark:text-red-400">{testimonialError}</p>}
                    <Button size="sm" onClick={handleSubmitTestimonial} disabled={testimonialSaving || !testimonial.trim()}>
                      {testimonialSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                      Submit
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Stats Card */}
          <Card>
            <CardContent className="text-center">
              <div className="w-16 h-16 bg-[#fbe9b8] dark:bg-[#dba514]/15 rounded-full flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-8 h-8 text-[#b0842a] dark:text-[#dba514]" />
              </div>
              <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">{user.xp}</p>
              <p className="text-gray-600 dark:text-gray-400">Total XP</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="text-center">
              <div className="w-16 h-16 bg-[#fde3da] dark:bg-[#e8603c]/15 rounded-full flex items-center justify-center mx-auto mb-4">
                <Flame className="w-8 h-8 text-[#e8603c]" />
              </div>
              <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">{user.practice_streak}</p>
              <p className="text-gray-600 dark:text-gray-400">Day Streak</p>
            </CardContent>
          </Card>

          {stats && (
            <>
              <Card>
                <CardContent className="text-center">
                  <div className="w-16 h-16 bg-[#dcf1ee] dark:bg-[#2f9e8f]/15 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Target className="w-8 h-8 text-[#2f9e8f]" />
                  </div>
                  <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">{stats.totalTests}</p>
                  <p className="text-gray-600 dark:text-gray-400">Tests Completed</p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="text-center">
                  <p className="text-3xl font-bold text-green-600 dark:text-green-400">
                    {formatPercentage(stats.avgScore)}
                  </p>
                  <p className="text-gray-600 dark:text-gray-400">Average Score</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
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
