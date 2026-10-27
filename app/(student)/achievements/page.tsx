import { redirect } from 'next/navigation';

// Achievements now live on the leaderboard page, as its own tab.
export default function AchievementsPage() {
  redirect('/leaderboard?tab=achievements');
}
