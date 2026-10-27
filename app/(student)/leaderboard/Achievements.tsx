'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, Badge } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import type { Achievement, UserAchievement } from '@/types';
import { Trophy, Lock, CheckCircle } from 'lucide-react';

const ACHIEVEMENT_ICONS: Record<string, string> = {
  trophy: '🏆',
  medal: '🥇',
  star: '⭐',
  crown: '👑',
  flame: '🔥',
  fire: '🔥',
  zap: '⚡',
  globe: '🌍',
};

/** The Achievements tab of the leaderboard page (formerly /achievements). */
export function AchievementsPanel({ userId }: { userId: string }) {
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [userAchievements, setUserAchievements] = useState<UserAchievement[]>([]);

  useEffect(() => {
    const fetchAchievements = async () => {
      const supabase = createClient();
      const [{ data: achievementsData }, { data: userAchievementsData }] = await Promise.all([
        supabase.from('achievements').select('*').order('name'),
        supabase.from('user_achievements').select('*, achievement:achievements(*)').eq('user_id', userId),
      ]);
      if (achievementsData) setAchievements(achievementsData);
      if (userAchievementsData) setUserAchievements(userAchievementsData);
    };
    fetchAchievements();
  }, [userId]);

  const earnedIds = new Set(userAchievements.map(ua => ua.achievement_id));
  const earnedCount = userAchievements.length;

  return (
    <div className="space-y-6">
      <Card className="bg-gradient-to-r from-yellow-50 to-orange-50 dark:from-yellow-500/10 dark:to-orange-500/10 border-yellow-200 dark:border-yellow-500/20">
        <CardContent className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
          <div className="flex items-center gap-4 sm:contents">
            <div className="w-16 h-16 bg-yellow-100 dark:bg-yellow-500/15 rounded-2xl flex items-center justify-center flex-shrink-0">
              <Trophy className="w-8 h-8 text-yellow-600 dark:text-yellow-400" />
            </div>
            <div>
              <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                {earnedCount}/{achievements.length}
              </p>
              <p className="text-gray-600 dark:text-gray-400">Achievements earned</p>
            </div>
          </div>
          <div className="flex-1">
            <div className="bg-white rounded-full h-4 overflow-hidden dark:bg-white/10">
              <div
                className="h-full bg-gradient-to-r from-yellow-400 to-orange-500 transition-all duration-500"
                style={{ width: `${achievements.length ? (earnedCount / achievements.length) * 100 : 0}%` }}
              />
            </div>
            <p className="text-sm text-gray-600 mt-1 dark:text-gray-400">
              {Math.max(0, achievements.length - earnedCount)} more to unlock
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {achievements.map((achievement) => {
          const earned = userAchievements.find(ua => ua.achievement_id === achievement.id);
          const isEarned = earnedIds.has(achievement.id);
          return (
            <Card
              key={achievement.id}
              className={`transition-all duration-300 ${
                isEarned
                  ? 'border-yellow-200 dark:border-yellow-500/20 bg-gradient-to-br from-yellow-50 to-orange-50 dark:from-yellow-500/10 dark:to-orange-500/10'
                  : 'opacity-60 grayscale'
              }`}
            >
              <CardContent className="p-6 text-center">
                <div className={`w-20 h-20 mx-auto rounded-2xl flex items-center justify-center text-4xl mb-4 ${
                  isEarned ? 'bg-yellow-100 dark:bg-yellow-500/15' : 'bg-gray-100 dark:bg-white/10'
                }`}>
                  {isEarned ? (
                    ACHIEVEMENT_ICONS[achievement.icon] || '🏅'
                  ) : (
                    <Lock className="w-8 h-8 text-gray-400 dark:text-gray-500" />
                  )}
                </div>
                <h3 className="font-semibold text-gray-900 mb-1 dark:text-gray-100">{achievement.name}</h3>
                <p className="text-sm text-gray-600 mb-4 dark:text-gray-400">{achievement.description}</p>
                {earned ? (
                  <div className="flex items-center justify-center gap-2 text-green-600 text-sm">
                    <CheckCircle className="w-4 h-4" />
                    <span>Earned {formatDate(earned.earned_at)}</span>
                  </div>
                ) : (
                  <Badge variant="default" size="sm">Locked</Badge>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
