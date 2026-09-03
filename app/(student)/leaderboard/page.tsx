'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers';
import { Card, CardContent, Badge, Avatar, Select } from '@/components/ui';
import { COURSE_ICONS, formatPercentage } from '@/lib/utils';
import type { Course, LeaderboardEntry } from '@/types';
import { Trophy, Medal, Award, Crown, TrendingUp } from 'lucide-react';

export default function LeaderboardPage() {
  const { user } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<string>('all');

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();

      // Fetch courses
      const { data: coursesData } = await supabase
        .from('courses')
        .select('*')
        .order('course_code');

      if (coursesData) setCourses(coursesData);

      // Fetch leaderboard
      const courseId = selectedCourse === 'all' ? null : selectedCourse;
      const { data: leaderboardData } = await supabase
        .rpc('get_leaderboard', { p_course_id: courseId, p_limit: 25 });

      if (leaderboardData) setLeaderboard(leaderboardData);
    };

    fetchData();
  }, [selectedCourse]);

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Crown className="w-6 h-6 text-yellow-500" />;
      case 2:
        return <Medal className="w-6 h-6 text-gray-400 dark:text-gray-500" />;
      case 3:
        return <Award className="w-6 h-6 text-amber-600" />;
      default:
        return null;
    }
  };

  const getRankBg = (rank: number) => {
    switch (rank) {
      case 1:
        return 'bg-gradient-to-r from-yellow-50 to-orange-50 border-yellow-200 dark:from-yellow-500/10 dark:to-orange-500/10 dark:border-yellow-500/20';
      case 2:
        return 'bg-gradient-to-r from-gray-50 to-slate-50 border-gray-200 dark:from-white/5 dark:to-white/5 dark:border-white/10';
      case 3:
        return 'bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200 dark:from-amber-500/10 dark:to-orange-500/10 dark:border-amber-500/20';
      default:
        return 'bg-white border-gray-100 dark:bg-white/[0.04] dark:border-white/10';
    }
  };

  const userRank = leaderboard.findIndex(e => e.user_id === user?.id) + 1;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Leaderboard</h1>
          <p className="text-gray-600 dark:text-gray-400">See how you rank against other students</p>
        </div>
        <Select
          options={[
            { value: 'all', label: 'All Courses' },
            ...courses.map(c => ({ value: c.id, label: `${c.course_code} - ${c.course_name}` })),
          ]}
          value={selectedCourse}
          onChange={(e) => setSelectedCourse(e.target.value)}
          className="w-full sm:w-64"
        />
      </div>

      {/* User's Position */}
      {userRank > 0 && (
        <Card className="bg-blue-50 border-blue-200 dark:bg-blue-500/10 dark:border-blue-500/20">
          <CardContent className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-lg">
              #{userRank}
            </div>
            <div className="flex-1">
              <p className="font-semibold text-gray-900 dark:text-gray-100">Your Rank</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {userRank === 1 ? 'You\'re leading!' : `${userRank - 1} spots to go!`}
              </p>
            </div>
            <TrendingUp className="w-6 h-6 text-blue-600" />
          </CardContent>
        </Card>
      )}

      {/* Leaderboard Table */}
      <Card>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2 dark:border-white/10">
          <Trophy className="w-5 h-5 text-yellow-500" />
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Top Performers</h2>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-white/10">
          {leaderboard.length > 0 ? (
            leaderboard.map((entry, index) => {
              const rank = index + 1;
              const isCurrentUser = entry.user_id === user?.id;

              return (
                <div
                  key={entry.user_id}
                  className={`flex items-center gap-4 px-6 py-4 transition-colors ${
                    isCurrentUser ? 'bg-blue-50 dark:bg-blue-500/10' : ''
                  } ${getRankBg(rank)} border-l-4 ${rank <= 3 ? '' : 'border-l-transparent'}`}
                >
                  <div className="w-10 text-center">
                    {getRankIcon(rank) || (
                      <span className="font-semibold text-gray-500 dark:text-gray-400">#{rank}</span>
                    )}
                  </div>
                  <Avatar
                    src={entry.avatar_url}
                    fallback={entry.full_name.split(' ')[0]}
                    size="md"
                  />
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium truncate ${isCurrentUser ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-gray-100'}`}>
                      {entry.full_name.split(' ')[0]}
                      {isCurrentUser && ' (You)'}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {entry.total_tests} tests completed
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-gray-900 dark:text-gray-100">{entry.total_score} pts</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {formatPercentage(Number(entry.avg_percentage))} avg
                    </p>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="p-12 text-center text-gray-500 dark:text-gray-400">
              <Trophy className="w-12 h-12 mx-auto mb-4 text-gray-300 dark:text-white/10" />
              <p>No rankings yet for this selection.</p>
              <p className="text-sm mt-1">Be the first to take a test!</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
