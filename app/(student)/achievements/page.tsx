'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers';
import { Card, CardContent, Badge, Loading } from '@/components/ui';
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

export default function AchievementsPage() {
  const { user } = useAuth();
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [userAchievements, setUserAchievements] = useState<UserAchievement[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchAchievements = async () => {
      const supabase = createClient();

      // Fetch all achievements
      const { data: achievementsData } = await supabase
        .from('achievements')
        .select('*')
        .order('name');

      // Fetch user's earned achievements
      const { data: userAchievementsData } = await supabase
        .from('user_achievements')
        .select('*, achievement:achievements(*)')
        .eq('user_id', user?.id);

      if (achievementsData) setAchievements(achievementsData);
      if (userAchievementsData) setUserAchievements(userAchievementsData);

      setIsLoading(false);
    };

    if (user) fetchAchievements();
  }, [user]);

  const earnedIds = new Set(userAchievements.map(ua => ua.achievement_id));
  const earnedCount = userAchievements.length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loading size="lg" text="Loading achievements..." />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Achievements</h1>
        <p className="text-gray-600">Complete challenges to earn badges</p>
      </div>

      {/* Progress Card */}
      <Card className="bg-gradient-to-r from-yellow-50 to-orange-50 border-yellow-200">
        <CardContent className="flex items-center gap-6">
          <div className="w-16 h-16 bg-yellow-100 rounded-2xl flex items-center justify-center">
            <Trophy className="w-8 h-8 text-yellow-600" />
          </div>
          <div>
            <p className="text-3xl font-bold text-gray-900">
              {earnedCount}/{achievements.length}
            </p>
            <p className="text-gray-600">Achievements Earned</p>
          </div>
          <div className="flex-1">
            <div className="bg-white rounded-full h-4 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-yellow-400 to-orange-500 transition-all duration-500"
                style={{ width: `${(earnedCount / achievements.length) * 100}%` }}
              />
            </div>
            <p className="text-sm text-gray-600 mt-1">
              {achievements.length - earnedCount} more to unlock
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Achievements Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {achievements.map((achievement) => {
          const isEarned = earnedIds.has(achievement.id);
          const earnedAchievement = userAchievements.find(
            ua => ua.achievement_id === achievement.id
          );

          return (
            <Card
              key={achievement.id}
              className={`transition-all duration-300 ${
                isEarned 
                  ? 'border-yellow-200 bg-gradient-to-br from-yellow-50 to-orange-50' 
                  : 'opacity-60 grayscale'
              }`}
            >
              <CardContent className="p-6 text-center">
                <div className={`w-20 h-20 mx-auto rounded-2xl flex items-center justify-center text-4xl mb-4 ${
                  isEarned ? 'bg-yellow-100' : 'bg-gray-100'
                }`}>
                  {isEarned ? (
                    ACHIEVEMENT_ICONS[achievement.icon] || '🏅'
                  ) : (
                    <Lock className="w-8 h-8 text-gray-400" />
                  )}
                </div>
                <h3 className="font-semibold text-gray-900 mb-1">{achievement.name}</h3>
                <p className="text-sm text-gray-600 mb-4">{achievement.description}</p>
                {isEarned ? (
                  <div className="flex items-center justify-center gap-2 text-green-600 text-sm">
                    <CheckCircle className="w-4 h-4" />
                    <span>Earned {formatDate(earnedAchievement!.earned_at)}</span>
                  </div>
                ) : (
                  <Badge variant="default" size="sm">
                    Locked
                  </Badge>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
